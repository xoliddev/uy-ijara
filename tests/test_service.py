"""Service rules: search with verdicts, contacts only after acceptance, own listings only, duplicates, expiry,
saved searches that fire once, reports and moderation."""

from __future__ import annotations

import pytest

from uyijara.common import Refused

from .helpers import (
    ADMIN,
    AZIZ,
    CHEAP,
    EXPENSIVE,
    JAVOHIR,
    KAMOLA,
    NODIRA,
    OTHER,
    PAUSED,
    SUSPICIOUS,
    TIMUR,
    draft,
    service_env,
    slot_of,
)


async def refused(coro) -> str:
    with pytest.raises(Refused) as err:
        await coro
    return err.value.code


async def test_search_gives_verdicts_and_hides_private_fields():
    async with service_env() as (svc, _):
        f, hits, total = await svc.search(AZIZ, {"district": "chilonzor", "rooms": 2})
        assert total == len(hits) == 8 and f["sort"] == "fair"
        assert hits[0]["eval"]["verdict"] == "cheap" and not hits[0]["eval"]["suspicious"]  # fair-price score order
        assert hits[-1]["id"] == SUSPICIOUS and hits[-2]["id"] == EXPENSIVE  # too-good-to-be-true sorts last
        assert all("address" not in h and "lat" not in h for h in hits)
        exp = next(h for h in hits if h["id"] == EXPENSIVE)
        assert exp["eval"]["verdict"] == "expensive" and exp["currency"] == "USD" and exp["price"] == 470
        assert (await svc.last_filter(AZIZ))["district"] == "chilonzor"  # remembered for the bot's Back button
        _, cyr, _ = await svc.search(AZIZ, {"q": "Чиланзар 2 xonali"})
        assert {h["id"] for h in cyr} == {h["id"] for h in hits}
        assert PAUSED not in {h["id"] for h in (await svc.search(AZIZ, {}))[1]}
        assert await refused(svc.search(AZIZ, {"rooms": 9})) == "filter"


async def test_viewing_contacts_appear_only_after_acceptance():
    async with service_env() as (svc, _):
        card = await svc.card(AZIZ, CHEAP)
        assert card["contact"] is None and card["eval"]["verdict"] == "cheap" and len(card["slots"]) == 3
        assert await refused(svc.request_viewing(TIMUR, card["slots"][0]["id"])) == "no_phone"
        v = await svc.request_viewing(AZIZ, card["slots"][0]["id"])
        assert v["status"] == "pending"
        assert (await svc.card(AZIZ, CHEAP))["contact"] is None  # pending: still hidden
        assert (await svc.my_viewings(AZIZ))[0]["contact"] is None
        incoming = await svc.incoming(NODIRA)
        assert {i["tenant_name"] for i in incoming} == {"Aziz", "Kamola"}
        assert all(i["contact"] is None for i in incoming)
        assert await refused(svc.decide(JAVOHIR, v["id"], True)) == "not_found"  # not his listing
        done = await svc.decide(NODIRA, v["id"], True)
        assert done["contact"]["phone"] == "+998930001001"  # the landlord now sees the tenant's phone
        mine = (await svc.card(AZIZ, CHEAP))["contact"]
        assert mine["phone"] == "+998900003001" and "ko'chasi" in mine["address"] and mine["lat"]
        assert await refused(svc.decide(NODIRA, v["id"], False)) == "state"
        assert len((await svc.card(KAMOLA, CHEAP))["slots"]) == 2  # the booked slot is gone for others


async def test_one_request_per_slot_listing_and_rules():
    async with service_env() as (svc, _):
        sid = await slot_of(svc, CHEAP)
        await svc.request_viewing(AZIZ, sid)
        assert await refused(svc.request_viewing(KAMOLA, sid)) == "slot_taken"
        assert await refused(svc.request_viewing(AZIZ, await slot_of(svc, CHEAP))) == "already_requested"
        assert await refused(svc.request_viewing(NODIRA, await slot_of(svc, CHEAP))) == "own_listing"
        v = (await svc.my_viewings(AZIZ))[0]
        await svc.cancel_viewing(AZIZ, v["id"])
        assert len(await svc.open_slots(CHEAP)) == 3  # the slot is open again
        assert await refused(svc.cancel_viewing(KAMOLA, v["id"])) == "not_found"


async def test_landlord_touches_only_own_listings_and_sees_the_band():
    async with service_env() as (svc, _):
        pv = await svc.preview(NODIRA, {"district": "chilonzor", "rooms": 2, "area": 54, "floor": 3, "floors": 9})
        assert pv["band"][0] < pv["band"][1] and pv["has_price"] is False and pv["scope"] == "rooms"
        high = await svc.preview(NODIRA, {**draft(), "price": 9_000_000})
        assert high["verdict"] == "expensive"
        created = await svc.create_listing(NODIRA, draft())
        assert created["own"] and created["contact"]["address"].startswith("Bog'bon")
        lid = created["id"]
        assert await refused(svc.update_listing(JAVOHIR, lid, {"price": 1_000_000})) == "not_found"
        assert await refused(svc.set_status(JAVOHIR, lid, "pause")) == "not_found"
        assert await refused(svc.update_listing(NODIRA, lid, {"district": "sergeli"})) == "generic"
        assert await refused(svc.update_listing(NODIRA, lid, {"price": 10})) == "l_price"
        upd = await svc.update_listing(NODIRA, lid, {"price": 480, "currency": "USD"})
        assert upd["price"] == 480 and upd["currency"] == "USD"
        assert (await svc.set_status(NODIRA, lid, "pause"))["status"] == "paused"
        assert await refused(svc.card(AZIZ, lid)) == "not_found"
        assert (await svc.set_status(NODIRA, lid, "resume"))["status"] == "active"
        assert await refused(svc.add_slot(NODIRA, OTHER + 1, 0)) == "not_found"


async def test_duplicates_are_refused():
    async with service_env() as (svc, _):
        await svc.create_listing(NODIRA, draft())
        assert await refused(svc.create_listing(NODIRA, draft(price=5_300_000, photo_seed=5))) == "duplicate"
        await svc.set_phone(TIMUR, "93 000 10 03")
        # someone else re-posting the same flat: same district, area, rent and photos
        assert await refused(svc.create_listing(TIMUR, draft(address="Boshqa ko'cha 1"))) == "duplicate"
        assert (await svc.create_listing(TIMUR, draft(photo_seed=778)))["id"] > 60


async def test_listings_expire_after_30_days_and_can_be_renewed():
    async with service_env() as (svc, clock):
        lid = (await svc.create_listing(NODIRA, draft()))["id"]
        clock.skip(days=29)
        assert lid not in [x["id"] for x in (await svc.expire_due())["listings"]]
        clock.skip(days=1, minutes=1)
        gone = await svc.expire_due()
        assert lid in [x["id"] for x in gone["listings"]]
        assert await refused(svc.card(AZIZ, lid)) == "not_found"
        assert (await svc.set_status(NODIRA, lid, "renew"))["status"] == "active"
        assert (await svc.expire_due())["listings"] == []


async def test_saved_search_fires_once_per_listing_and_survives_restart(tmp_path):
    from uyijara.db import Database
    from uyijara.service import Service

    path = str(tmp_path / "alerts.db")
    async with service_env(path=path) as (svc, clock):
        await svc.add_sub(AZIZ, {"district": "chilonzor", "rooms": 2, "price_max": 6_000_000})
        assert await svc.run_alerts() == []  # old listings never fire
        clock.skip(minutes=5)
        lid = (await svc.create_listing(NODIRA, draft()))["id"]
        fired = await svc.run_alerts()
        assert [(f["user_id"], f["listing_id"]) for f in fired] == [(AZIZ, lid)]
        assert await svc.run_alerts() == []
        db2 = await Database.open(path)  # a restart: a fresh process on the same file
        try:
            again = Service(db2, svc.districts, clock=clock)
            assert await again.run_alerts() == []
        finally:
            await db2.close()
        await svc.create_listing(NODIRA, draft(district="sergeli", area=40, photo_seed=9))
        assert await svc.run_alerts() == []  # does not match


async def test_reports_hide_after_three_and_admin_decides():
    async with service_env() as (svc, _):
        await svc.report(AZIZ, EXPENSIVE, "price")
        assert await refused(svc.report(AZIZ, EXPENSIVE, "scam")) == "already_reported"
        assert await refused(svc.report(JAVOHIR, EXPENSIVE, "scam")) == "not_found"  # own listing
        await svc.report(KAMOLA, EXPENSIVE, "scam")
        await svc.set_phone(TIMUR, "+998 93 000 10 03")
        await svc.report(TIMUR, EXPENSIVE, "rented")
        assert await refused(svc.card(AZIZ, EXPENSIVE)) == "not_found"  # hidden until moderated
        assert await refused(svc.open_reports(AZIZ)) == "forbidden"
        rep = await svc.open_reports(ADMIN)
        assert rep[0]["listing_id"] == EXPENSIVE and rep[0]["n"] == 3
        await svc.moderate(ADMIN, EXPENSIVE, remove=False)
        assert (await svc.card(AZIZ, EXPENSIVE))["id"] == EXPENSIVE
        await svc.report(TIMUR, CHEAP, "scam")
        await svc.moderate(ADMIN, CHEAP, remove=True)
        assert await refused(svc.card(AZIZ, CHEAP)) == "not_found"
        assert await refused(svc.report(AZIZ, CHEAP, "bogus")) == "generic"
