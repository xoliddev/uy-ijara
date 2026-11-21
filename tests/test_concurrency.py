"""One slot, one tenant: tenants racing for the same viewing time, on one connection and across two connections
(like two server processes), and the database refusing a second live request even if the app had a bug."""

from __future__ import annotations

import asyncio
import sqlite3

import pytest

from uyijara.common import Refused
from uyijara.db import Database
from uyijara.service import Service

from .helpers import AZIZ, CHEAP, KAMOLA, Clock, draft, service_env, slot_of


async def _try(svc: Service, uid: int, sid: int):
    try:
        return await svc.request_viewing(uid, sid)
    except Refused as err:
        return err.code


async def test_two_tenants_race_for_one_slot():
    async with service_env() as (svc, _):
        sid = await slot_of(svc, CHEAP)
        results = await asyncio.gather(_try(svc, AZIZ, sid), _try(svc, KAMOLA, sid))
        assert sorted(r if isinstance(r, str) else "ok" for r in results) == ["ok", "slot_taken"]
        rows = await svc.db.all("SELECT * FROM viewings WHERE slot_id = ?", (sid,))
        assert len(rows) == 1


async def test_two_connections_never_double_book(tmp_path):
    path = str(tmp_path / "race.db")
    clock = Clock()
    async with service_env(clock, path=path) as (svc_a, _):
        sid = await slot_of(svc_a, CHEAP)
        db_b = await Database.open(path)
        svc_b = Service(db_b, svc_a.districts, clock=clock)
        tenants = list(range(5001, 5013))
        for uid in tenants:
            await svc_a.touch_user(uid, f"T{uid}", "uz")
            await svc_a.set_phone(uid, f"+99893{uid:07d}")
        try:
            calls = [_try(svc_a if i % 2 else svc_b, uid, sid) for i, uid in enumerate(tenants)]
            results = await asyncio.gather(*calls)
        finally:
            await db_b.close()
        ok = [r for r in results if not isinstance(r, str)]
        assert len(ok) == 1 and {r for r in results if isinstance(r, str)} == {"slot_taken"}
        slot = await svc_a.db.one("SELECT status FROM slots WHERE id = ?", (sid,))
        assert slot["status"] == "held"


async def test_database_refuses_a_second_live_request_even_if_the_app_had_a_bug():
    async with service_env() as (svc, clock):
        sid = await slot_of(svc, CHEAP)
        await svc.request_viewing(AZIZ, sid)
        with pytest.raises(sqlite3.IntegrityError):
            await svc.db.run("INSERT INTO viewings (slot_id, listing_id, tenant_id, landlord_id, created_at) "
                             "VALUES (?, ?, ?, 3001, ?)", (sid, CHEAP, KAMOLA, clock()))


async def test_two_identical_listings_posted_at_once_only_one_lands():
    async with service_env() as (svc, _):
        async def post():
            try:
                return (await svc.create_listing(3001, draft()))["id"]
            except Refused as err:
                return err.code

        results = await asyncio.gather(post(), post(), post())
        assert sorted(str(r) for r in results).count("duplicate") == 2
