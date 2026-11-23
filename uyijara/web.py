"""aiohttp server: the Mini App's static files and its JSON API.

Every /api call must carry ``Authorization: tma <initData>``; the HMAC and ``auth_date`` are checked, then the call
runs *as* that Telegram user through the same Service the bot uses. Ownership is checked inside the service, so a
landlord can only reach their own listings and nobody gets a phone or an exact address before a viewing is accepted.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from aiohttp import web

from .common import Refused
from .core.viewing import presets
from .security import AuthError, RateLimiter, validate_init_data
from .service import Service

log = logging.getLogger(__name__)
ME = web.RequestKey("me", int)
ROOT = Path(__file__).resolve().parent.parent
MAX_BODY = 16 * 1024
CSP = ("default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; "
       "frame-ancestors https://web.telegram.org https://*.telegram.org; base-uri 'none'; form-action 'none'")
STATUS = {"forbidden": 403, "not_found": 404, "auth": 401}
ID = r"{id:\d{1,9}}"


def _id(request: web.Request, key: str = "id") -> int:
    return int(request.match_info[key])


def _int(value: object, lo: int, hi: int, code: str = "generic") -> int:
    """Whole numbers only: an int, or a short string of ASCII digits. Floats and booleans are refused."""
    if isinstance(value, str) and 0 < len(value) <= 15 and value.isascii() and value.isdigit():
        n = int(value)
    elif isinstance(value, int) and not isinstance(value, bool):
        n = value
    else:
        raise Refused(code)
    if not lo <= n <= hi:
        raise Refused(code)
    return n


def _str(value: object, limit: int) -> str:
    if not isinstance(value, str) or len(value) > limit:
        raise Refused("generic")
    return value


def _dict(value: object) -> dict:
    if not isinstance(value, dict) or len(value) > 24:
        raise Refused("generic")
    return value


async def _body(request: web.Request) -> dict:
    try:
        data = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        raise Refused("generic") from err
    return _dict(data)


def make_app(service: Service, bot_token: str, notifier=None, max_age: int = 3600,
             rate_per_minute: int = 60) -> web.Application:
    limiter = RateLimiter(rate_per_minute)

    @web.middleware
    async def guard(request: web.Request, handler):
        try:
            if request.path.startswith("/api/"):
                header = request.headers.get("Authorization", "")
                if not header.startswith("tma "):
                    raise AuthError("missing")
                user = validate_init_data(header[4:], bot_token, max_age, now=service.now() / 1000)
                if not limiter.allow(user["id"]):
                    return web.json_response({"error": "rate"}, status=429)
                await service.touch_user(user["id"], user["first_name"], user["language_code"])
                request[ME] = user["id"]
            resp = await handler(request)
        except AuthError:
            resp = web.json_response({"error": "auth"}, status=401)
        except Refused as err:
            resp = web.json_response({"error": err.code}, status=STATUS.get(err.code, 400))
        resp.headers.update({"Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff",
                             "Referrer-Policy": "no-referrer", "Cache-Control": "no-store"})
        return resp

    async def notify(kind: str, *args) -> None:
        if notifier is not None:
            await getattr(notifier, kind)(*args)

    async def me(request: web.Request) -> web.Response:
        uid = request[ME]
        user = await service.user(uid)
        return web.json_response({"id": uid, "name": user["name"], "lang": user["lang"], "phone": user["phone"],
                                  "admin": uid in service.admins, "now": service.now(), "rate": service.rate,
                                  "filter": await service.last_filter(uid)})

    async def lang(request: web.Request) -> web.Response:
        d = await _body(request)
        await service.set_lang(request[ME], _str(d.get("lang"), 2))
        return web.json_response({"lang": d["lang"]})

    async def phone(request: web.Request) -> web.Response:
        d = await _body(request)
        return web.json_response({"phone": await service.set_phone(request[ME], _str(d.get("phone"), 32))})

    async def search(request: web.Request) -> web.Response:
        d = await _body(request)
        f, items, total = await service.search(request[ME], _dict(d.get("filter", {})), limit=60)
        return web.json_response({"filter": f, "items": items, "total": total, "now": service.now()})

    async def listing(request: web.Request) -> web.Response:
        return web.json_response({**await service.card(request[ME], _id(request)), "now": service.now()})

    async def report(request: web.Request) -> web.Response:
        d = await _body(request)
        await service.report(request[ME], _id(request), _str(d.get("reason"), 10))
        return web.json_response({"ok": True})

    async def request_viewing(request: web.Request) -> web.Response:
        d = await _body(request)
        v = await service.request_viewing(request[ME], _int(d.get("slot"), 1, 10**9, "not_found"))
        await notify("new_request", v)
        return web.json_response(v)

    async def viewings(request: web.Request) -> web.Response:
        return web.json_response({"items": await service.my_viewings(request[ME]), "now": service.now()})

    async def cancel(request: web.Request) -> web.Response:
        v = await service.cancel_viewing(request[ME], _id(request))
        await notify("cancelled", v, request[ME])
        return web.json_response(v)

    async def decide(request: web.Request) -> web.Response:
        d = await _body(request)
        accept = d.get("accept")
        if not isinstance(accept, bool):
            raise Refused("generic")
        v = await service.decide(request[ME], _id(request), accept)
        await notify("decided", v)
        return web.json_response(v)

    async def subs(request: web.Request) -> web.Response:
        return web.json_response({"items": await service.my_subs(request[ME])})

    async def sub_add(request: web.Request) -> web.Response:
        d = await _body(request)
        return web.json_response(await service.add_sub(request[ME], _dict(d.get("filter", {}))))

    async def sub_del(request: web.Request) -> web.Response:
        await service.delete_sub(request[ME], _id(request))
        return web.json_response({"ok": True})

    # ── landlord: everything is scoped to the caller inside the service ──
    async def landlord(request: web.Request) -> web.Response:
        uid = request[ME]
        return web.json_response({"listings": await service.my_listings(uid), "incoming": await service.incoming(uid),
                                  "presets": presets(service.now()), "now": service.now()})

    async def preview(request: web.Request) -> web.Response:
        d = await _body(request)
        return web.json_response(await service.preview(request[ME], _dict(d.get("draft", {}))))

    async def create(request: web.Request) -> web.Response:
        d = await _body(request)
        return web.json_response(await service.create_listing(request[ME], _dict(d.get("listing", {}))))

    async def update(request: web.Request) -> web.Response:
        d = await _body(request)
        return web.json_response(await service.update_listing(request[ME], _id(request), _dict(d.get("changes", {}))))

    async def status(request: web.Request) -> web.Response:
        d = await _body(request)
        return web.json_response(await service.set_status(request[ME], _id(request), _str(d.get("action"), 8)))

    async def slot_add(request: web.Request) -> web.Response:
        d = await _body(request)
        start = _int(d.get("start_at"), 0, 10**14, "slot_time")
        return web.json_response({"slots": await service.add_slot(request[ME], _id(request), start)})

    async def slot_del(request: web.Request) -> web.Response:
        out = await service.remove_slot(request[ME], _id(request), _id(request, "sid"))
        return web.json_response({"slots": out})

    async def health(_: web.Request) -> web.Response:
        return web.json_response({"ok": True})

    async def index(_: web.Request) -> web.Response:
        raise web.HTTPFound("/webapp/")

    app = web.Application(middlewares=[guard], client_max_size=MAX_BODY)
    r = app.router
    r.add_get("/api/me", me)
    r.add_post("/api/lang", lang)
    r.add_post("/api/phone", phone)
    r.add_post("/api/search", search)
    r.add_get(f"/api/listings/{ID}", listing)
    r.add_post(f"/api/listings/{ID}/report", report)
    r.add_post("/api/viewings", request_viewing)
    r.add_get("/api/viewings", viewings)
    r.add_post(f"/api/viewings/{ID}/cancel", cancel)
    r.add_post(f"/api/viewings/{ID}/decide", decide)
    r.add_get("/api/subs", subs)
    r.add_post("/api/subs", sub_add)
    r.add_delete(f"/api/subs/{ID}", sub_del)
    r.add_get("/api/landlord", landlord)
    r.add_post("/api/landlord/preview", preview)
    r.add_post("/api/landlord/listings", create)
    r.add_post(f"/api/landlord/listings/{ID}", update)
    r.add_post(f"/api/landlord/listings/{ID}/status", status)
    r.add_post(f"/api/landlord/listings/{ID}/slots", slot_add)
    r.add_delete(f"/api/landlord/listings/{ID}/slots/" + r"{sid:\d{1,9}}", slot_del)
    r.add_get("/healthz", health)
    r.add_get("/", index)
    async def webapp_index(_: web.Request) -> web.FileResponse:
        """The Mini App's address is /webapp/; add_static alone answers 403 for a folder."""
        return web.FileResponse(ROOT / "webapp" / "index.html")

    r.add_get("/webapp/", webapp_index)
    r.add_static("/webapp/", ROOT / "webapp", append_version=False)
    r.add_static("/shared/", ROOT / "shared", append_version=False)
    return app
