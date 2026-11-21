"""Mini App initData validation and per-user rate limiting."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from collections.abc import Callable
from urllib.parse import parse_qsl, urlencode


class AuthError(Exception):
    pass


def _secret(bot_token: str) -> bytes:
    return hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()


def sign_init_data(fields: dict[str, str], bot_token: str) -> str:
    """Build a signed initData string (used by tests and the local dev page, never in production)."""
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    digest = hmac.new(_secret(bot_token), check.encode(), hashlib.sha256).hexdigest()
    return urlencode({**fields, "hash": digest})


def validate_init_data(init_data: str, bot_token: str, max_age: int, now: float | None = None) -> dict:
    """Check Telegram's HMAC over initData and its freshness; return the ``user`` object.

    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    if not init_data or len(init_data) > 4096:
        raise AuthError("missing")
    try:
        pairs = parse_qsl(init_data, keep_blank_values=True, strict_parsing=True)
    except ValueError as err:
        raise AuthError("malformed") from err
    fields = dict(pairs)
    if len(fields) != len(pairs):
        raise AuthError("duplicate field")
    received = fields.pop("hash", "")
    check = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    expected = hmac.new(_secret(bot_token), check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        raise AuthError("bad signature")
    try:
        auth_date = int(fields["auth_date"])
        user = json.loads(fields["user"])
        user_id = int(user["id"])
    except (KeyError, ValueError, TypeError) as err:
        raise AuthError("incomplete") from err
    now = time.time() if now is None else now
    if auth_date > now + 60 or now - auth_date > max_age:
        raise AuthError("expired")
    if user_id <= 0:
        raise AuthError("bad user")
    return {"id": user_id, "first_name": str(user.get("first_name", ""))[:64],
            "language_code": str(user.get("language_code", ""))[:8]}


class RateLimiter:
    """Token bucket per key: ``rate`` actions per ``per`` seconds, bursts up to ``rate``."""

    def __init__(self, rate: int, per: float = 60.0, clock: Callable[[], float] = time.monotonic) -> None:
        self.rate, self.per, self.clock = rate, per, clock
        self._buckets: dict[object, tuple[float, float]] = {}

    def allow(self, key: object) -> bool:
        now = self.clock()
        tokens, last = self._buckets.get(key, (float(self.rate), now))
        tokens = min(float(self.rate), tokens + (now - last) * self.rate / self.per)
        if tokens < 1:
            self._buckets[key] = (tokens, now)
            return False
        self._buckets[key] = (tokens - 1, now)
        if len(self._buckets) > 50_000:  # forget idle users so memory stays bounded
            self._buckets = {k: v for k, v in self._buckets.items() if now - v[1] < self.per}
        return True
