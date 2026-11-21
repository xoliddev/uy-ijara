"""Viewing slots ("ko'rishga yozilish"): the times a landlord offers, and the life of a tenant's request.

A slot is taken by one tenant at a time. The database enforces it twice: one conditional UPDATE
(``... WHERE status = 'open'``) inside ``BEGIN IMMEDIATE``, and a unique index on live requests per slot.
Only after the landlord accepts do both sides see each other's phone and the exact address.
"""

from __future__ import annotations

from .clock import DAY_MS, HOUR_MS, MIN_MS, at_local, local_day

SLOT_HOURS = (10, 14, 18)
PRESET_DAYS = (1, 2)  # tomorrow and the day after
MAX_OPEN_SLOTS = 6
MAX_PENDING_PER_TENANT = 3
MIN_LEAD_MS = HOUR_MS
MAX_AHEAD_MS = 14 * DAY_MS
# request status -> action -> new status
MOVES = {
    "pending": {"accept": "accepted", "decline": "declined", "cancel": "cancelled", "expire": "expired"},
    "accepted": {"cancel": "cancelled"},
}
LIVE = ("pending", "accepted")


class ViewingError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def presets(now_ms: int) -> list[int]:
    """Slot times a landlord can add with one tap: tomorrow and the day after at 10:00, 14:00 and 18:00."""
    today = local_day(now_ms)
    return [at_local(today + d, h * 60) for d in PRESET_DAYS for h in SLOT_HOURS]


def check_time(start_ms: int, now_ms: int) -> int:
    """A slot starts on a whole half hour, at least an hour from now and at most two weeks ahead."""
    if isinstance(start_ms, bool) or not isinstance(start_ms, int) or start_ms % (30 * MIN_MS):
        raise ViewingError("slot_time")
    if start_ms < now_ms + MIN_LEAD_MS or start_ms > now_ms + MAX_AHEAD_MS:
        raise ViewingError("slot_time")
    return start_ms


def check_request(slot_status: str, slot_start: int, now_ms: int, pending: int, own_listing: bool,
                  already: bool) -> None:
    """May this tenant ask for this slot? (The atomic UPDATE is the real guard against two tenants at once.)"""
    if own_listing:
        raise ViewingError("own_listing")
    if slot_status != "open" or slot_start <= now_ms:
        raise ViewingError("slot_taken")
    if already:
        raise ViewingError("already_requested")
    if pending >= MAX_PENDING_PER_TENANT:
        raise ViewingError("too_many_requests")


def move(status: str, action: str) -> str:
    nxt = MOVES.get(status, {}).get(action)
    if nxt is None:
        raise ViewingError("state")
    return nxt


def contacts_visible(status: str) -> bool:
    """Phones and the exact address are shown to both sides only once a viewing is accepted."""
    return status == "accepted"
