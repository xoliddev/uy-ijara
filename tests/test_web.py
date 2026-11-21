"""Mini App API: initData HMAC + freshness, own listings only, contacts only after acceptance, strict validation,
rate limits, CSP and the static Mini App."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager

from aiohttp.test_utils import TestClient, TestServer

from uyijara.security import sign_init_data
from uyijara.web import make_app

from .helpers import AZIZ, CHEAP, EXPENSIVE, JAVOHIR, NODIRA, OTHER, TIMUR, draft, service_env

TOKEN = "123456:TEST-ONLY-NOT-A-REAL-TOKEN"


def init_data(uid: int, clock, age: int = 0, token: str = TOKEN) -> str:
    fields = {"auth_date": str(clock() // 1000 - age), "query_id": "AAE-test",
              "user": json.dumps({"id": uid, "first_name": f"U{uid}", "language_code": "uz"})}
    return sign_init_data(fields, token)


@asynccontextmanager
async def api(rate: int = 1000):
    async with service_env() as (svc, clock):
        client = TestClient(TestServer(make_app(svc, TOKEN, notifier=None, max_age=3600, rate_per_minute=rate)))
        await client.start_server()

        def h(uid: int, age: int = 0, token: str = TOKEN) -> dict:
            return {"Authorization": "tma " + init_data(uid, clock, age, token)}

        try:
            yield client, svc, clock, h
        finally:
            await client.close()


async def test_auth_signature_and_freshness():
    async with api() as (c, _, _, h):
        assert (await c.get("/api/me")).status == 401
        assert (await c.get("/api/me", headers=h(AZIZ, token="999:WRONG"))).status == 401
        assert (await c.get("/api/me", headers=h(AZIZ, age=4000))).status == 401  # older than INITDATA_MAX_AGE
        assert (await c.get("/api/me", headers=h(AZIZ, age=-600))).status == 401  # from the future
        tampered = h(AZIZ)["Authorization"].replace("U1001", "U1002")
        assert (await c.get("/api/me", headers={"Authorization": tampered})).status == 401
        r = await c.get("/api/me", headers=h(AZIZ))
        assert r.status == 200 and (await r.json())["phone"] == "+998930001001"
        assert "frame-ancestors" in r.headers["Content-Security-Policy"] and r.headers["X-Content-Type-Options"]


async def test_search_and_card_hide_contacts_until_accepted():
    async with api() as (c, _, _, h):
        r = await c.post("/api/search", headers=h(AZIZ), json={"filter": {"district": "chilonzor", "rooms": 2}})
        body = await r.json()
        assert body["total"] == 8 and all("address" not in x for x in body["items"])
        card = await (await c.get(f"/api/listings/{CHEAP}", headers=h(AZIZ))).json()
        assert card["contact"] is None and card["eval"]["verdict"] == "cheap"
        slot = card["slots"][0]["id"]
        v = await (await c.post("/api/viewings", headers=h(AZIZ), json={"slot": slot})).json()
        assert (await c.post("/api/viewings", headers=h(TIMUR), json={"slot": slot})).status == 400  # no phone
        bad = await c.post(f"/api/viewings/{v['id']}/decide", headers=h(JAVOHIR), json={"accept": True})
        assert bad.status == 404
        assert (await c.post(f"/api/viewings/{v['id']}/decide", headers=h(NODIRA), json={"accept": 1})).status == 400
        ok = await (await c.post(f"/api/viewings/{v['id']}/decide", headers=h(NODIRA), json={"accept": True})).json()
        assert ok["contact"]["phone"] == "+998930001001"
        card = await (await c.get(f"/api/listings/{CHEAP}", headers=h(AZIZ))).json()
        assert card["contact"]["phone"] == "+998900003001" and card["contact"]["address"]


async def test_landlord_routes_are_scoped_to_the_caller():
    async with api() as (c, svc, _, h):
        mine = await (await c.get("/api/landlord", headers=h(NODIRA))).json()
        assert {x["id"] for x in mine["listings"]} >= {CHEAP, OTHER} and len(mine["presets"]) == 6
        assert len(mine["incoming"]) == 1 and mine["incoming"][0]["contact"] is None
        other = await (await c.get("/api/landlord", headers=h(JAVOHIR))).json()
        assert CHEAP not in {x["id"] for x in other["listings"]}
        for path, body in ((f"/api/landlord/listings/{CHEAP}", {"changes": {"price": 1_000_000}}),
                           (f"/api/landlord/listings/{CHEAP}/status", {"action": "pause"}),
                           (f"/api/landlord/listings/{CHEAP}/slots", {"start_at": mine["presets"][5]})):
            assert (await c.post(path, headers=h(JAVOHIR), json=body)).status == 404
        assert (await svc.listing_row(CHEAP))["status"] == "active"
        pv = await (await c.post("/api/landlord/preview", headers=h(NODIRA), json={"draft": draft()})).json()
        assert pv["verdict"] in ("cheap", "fair") and pv["band"][0] < pv["band"][1]
        made = await c.post("/api/landlord/listings", headers=h(NODIRA), json={"listing": draft()})
        assert made.status == 200 and (await made.json())["own"]
        assert (await c.post("/api/landlord/listings", headers=h(NODIRA), json={"listing": draft()})).status == 400


async def test_strict_validation():
    async with api() as (c, _, _, h):
        hd = h(AZIZ)
        assert (await c.post("/api/search", headers=hd, json={"filter": {"rooms": 2.0}})).status == 400
        assert (await c.post("/api/search", headers=hd, json={"filter": {"district": ["x"]}})).status == 400
        assert (await c.post("/api/search", headers=hd, data="not json")).status == 400
        assert (await c.post("/api/search", headers=hd, json=[1, 2])).status == 400
        assert (await c.post("/api/viewings", headers=hd, json={"slot": True})).status == 404
        assert (await c.post("/api/phone", headers=hd, json={"phone": "12345"})).status == 400
        big = {"listing": {**draft(), "note": "x" * 20_000}}
        assert (await c.post("/api/landlord/listings", headers=h(NODIRA), json=big)).status == 413
        floaty = {"listing": draft(area=54.0)}
        assert (await c.post("/api/landlord/listings", headers=h(NODIRA), json=floaty)).status == 400
        assert (await c.post(f"/api/listings/{EXPENSIVE}/report", headers=hd, json={"reason": "<b>"})).status == 400
        assert (await c.get("/api/listings/99999", headers=hd)).status == 404


async def test_rate_limit_static_files_and_health():
    async with api(rate=3) as (c, _, _, h):
        codes = [(await c.get("/api/me", headers=h(AZIZ))).status for _ in range(5)]
        assert codes[:3] == [200, 200, 200] and codes[-1] == 429
        page = await c.get("/webapp/index.html")
        assert page.status == 200 and "Content-Security-Policy" in page.headers
        assert (await c.get("/shared/fair.js")).status == 200
        assert (await c.get("/healthz")).status == 200
