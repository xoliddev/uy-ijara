"""Landlord and admin actions, mixed into Service.

A landlord can only ever touch their own listings: every query below has ``landlord_id = ?`` with the caller's id
in it, never an id taken from the request. Admins are configured by ``ADMIN_IDS`` and only moderate reports.
"""

from __future__ import annotations

import json
import sqlite3

from .common import Refused
from .core import fair
from .core import viewing as rules
from .core.listing import ListingError, approx_point, expires_at, fingerprint, owner_key, validate
from .db import listing_row

EDITABLE = ("price", "currency", "note", "furnished", "pets", "amenities", "renovation", "audience", "address")
DRAFT_DEFAULTS = {"district": "chilonzor", "rooms": 2, "area": 50, "floor": 2, "floors": 5, "building": "brick",
                  "renovation": "cosmetic", "furnished": 0, "pets": 0, "audience": "any", "amenities": [],
                  "price": 5_000_000, "currency": "UZS", "address": "-----", "note": "", "photo_seed": 1}


class LandlordMixin:
    # ── the live suggestion while typing ──
    async def preview(self, uid: int, data: dict) -> dict:
        """Fair band for a draft (and the verdict once a price is typed). Nothing is stored."""
        if not isinstance(data, dict):
            raise Refused("generic")
        has_price = data.get("price") not in (None, "", 0)
        draft = {**DRAFT_DEFAULTS, **{k: v for k, v in data.items() if k in DRAFT_DEFAULTS and v is not None}}
        try:
            clean = validate(draft, set(self.dmap))
        except ListingError as err:
            raise Refused(f"l_{err.code}") from err
        _, live = await self.pool()
        clean["id"] = data.get("id") if isinstance(data.get("id"), int) else None
        pool = [x for x in live if x["id"] != clean["id"]]
        out = fair.evaluate(clean, pool, self.rate) if has_price else fair.estimate(clean, pool, self.rate)
        return {**out, "has_price": has_price}

    # ── own listings ──
    async def owned(self, uid: int, lid: int) -> dict:
        row = await self.db.one("SELECT * FROM listings WHERE id = ? AND landlord_id = ?", (lid, uid))
        if row is None:
            raise Refused("not_found")  # also for someone else's listing: do not even confirm it exists
        return listing_row(row)

    async def my_listings(self, uid: int) -> list[dict]:
        rows = await self.db.all("SELECT * FROM listings WHERE landlord_id = ? AND status != 'removed' ORDER BY "
                                 "status != 'active', id DESC LIMIT 50", (uid,))
        evals, _ = await self.pool()
        out = []
        for r in rows:
            x = listing_row(r)
            item = self.public(x, evals.get(x["id"]))
            item.update(address=x["address"], hidden=x["hidden"],
                        pending=(await self.db.one("SELECT COUNT(*) AS n FROM viewings WHERE listing_id = ? AND "
                                                   "status = 'pending'", (x["id"],)))["n"],
                        slots=await self.open_slots(x["id"]))
            out.append(item)
        return out

    async def _check_duplicates(self, c, uid: int, clean: dict, skip: int | None = None) -> None:
        fp, key = fingerprint(clean, self.rate), owner_key(uid, clean)
        sql = ("SELECT id FROM listings WHERE status IN ('active', 'paused') AND (fingerprint = ? OR owner_key = ?) "
               "AND id != ?")
        async with c.execute(sql, (fp, key, skip or 0)) as cur:
            if await cur.fetchone():
                raise Refused("duplicate")

    async def create_listing(self, uid: int, data: dict) -> dict:
        user = await self.user(uid)
        if not user or not user["phone"]:
            raise Refused("no_phone")
        try:
            clean = validate(data, set(self.dmap))
        except ListingError as err:
            raise Refused(f"l_{err.code}") from err
        now = self.now()
        district = self.dmap[clean["district"]]
        async with self.db.tx() as c:
            async with c.execute("SELECT COUNT(*) FROM listings WHERE landlord_id = ? AND status IN ('active', "
                                 "'paused')", (uid,)) as cur:
                if (await cur.fetchone())[0] >= 20:
                    raise Refused("too_many_listings")
            await self._check_duplicates(c, uid, clean)
            row = {**clean, "landlord_id": uid, "lat": None, "lon": None, "pin_lat": district["lat"],
                   "pin_lon": district["lon"], "status": "active", "published_at": now, "updated_at": now,
                   "expires_at": expires_at(now)}
            try:
                lid = await self.db.insert_listing(c, row, self.rate)
            except sqlite3.IntegrityError as err:  # a twin slipped in between: the unique index refuses it
                raise Refused("duplicate") from err
            pin_lat, pin_lon = approx_point(lid, district)
            await c.execute("UPDATE listings SET pin_lat = ?, pin_lon = ? WHERE id = ?", (pin_lat, pin_lon, lid))
        self.changed()
        return await self.card(uid, lid)

    async def update_listing(self, uid: int, lid: int, changes: dict) -> dict:
        if not isinstance(changes, dict) or not changes or any(k not in EDITABLE for k in changes):
            raise Refused("generic")
        x = await self.owned(uid, lid)
        if x["status"] == "removed":
            raise Refused("not_found")
        try:
            clean = validate({**x, **changes}, set(self.dmap))
        except ListingError as err:
            raise Refused(f"l_{err.code}") from err
        async with self.db.tx() as c:
            await self._check_duplicates(c, uid, clean, skip=lid)
            await self._write_update(c, uid, lid, clean)
        self.changed()
        return await self.card(uid, lid)

    async def _write_update(self, c, uid: int, lid: int, clean: dict) -> None:
        try:
            await c.execute("UPDATE listings SET price = ?, currency = ?, note = ?, furnished = ?, pets = ?, "
                            "amenities = ?, renovation = ?, audience = ?, address = ?, fingerprint = ?, updated_at = ? "
                            "WHERE id = ? AND landlord_id = ?",
                            (clean["price"], clean["currency"], clean["note"], clean["furnished"], clean["pets"],
                             json.dumps(clean["amenities"]), clean["renovation"], clean["audience"], clean["address"],
                             fingerprint(clean, self.rate), self.now(), lid, uid))
        except sqlite3.IntegrityError as err:  # a twin slipped in between: the unique index refuses it
            raise Refused("duplicate") from err

    async def set_status(self, uid: int, lid: int, action: str) -> dict:
        """pause / resume / renew (another 30 days from now; also brings an expired listing back)."""
        x = await self.owned(uid, lid)
        now = self.now()
        moves = {"pause": ("active",), "resume": ("paused",), "renew": ("active", "paused", "expired")}
        if action not in moves or x["status"] not in moves[action]:
            raise Refused("state")
        try:
            if action == "pause":
                await self.db.run("UPDATE listings SET status = 'paused' WHERE id = ? AND landlord_id = ?", (lid, uid))
            elif action == "resume":
                if x["expires_at"] <= now:
                    raise Refused("expired")
                await self.db.run("UPDATE listings SET status = 'active' WHERE id = ? AND landlord_id = ?", (lid, uid))
            else:
                await self.db.run("UPDATE listings SET status = CASE status WHEN 'paused' THEN 'paused' ELSE 'active' "
                                  "END, expires_at = ?, updated_at = ? WHERE id = ? AND landlord_id = ?",
                                  (expires_at(now), now, lid, uid))
        except sqlite3.IntegrityError as err:  # an expired twin came back while another copy is live
            raise Refused("duplicate") from err
        self.changed()
        return await self.card(uid, lid)

    # ── viewing slots and requests ──
    async def add_slot(self, uid: int, lid: int, start_at: int) -> list[dict]:
        x = await self.owned(uid, lid)
        if x["status"] not in ("active", "paused"):
            raise Refused("state")
        try:
            rules.check_time(start_at, self.now())
        except rules.ViewingError as err:
            raise Refused(err.code) from err
        async with self.db.tx() as c:
            async with c.execute("SELECT COUNT(*) FROM slots WHERE listing_id = ? AND status = 'open' AND start_at > ?",
                                 (lid, self.now())) as cur:
                if (await cur.fetchone())[0] >= rules.MAX_OPEN_SLOTS:
                    raise Refused("too_many_slots")
            cur = await c.execute("INSERT OR IGNORE INTO slots (listing_id, start_at) VALUES (?, ?)", (lid, start_at))
            if cur.rowcount != 1:
                await c.execute("UPDATE slots SET status = 'open' WHERE listing_id = ? AND start_at = ? AND status = "
                                "'cancelled'", (lid, start_at))
        return await self.open_slots(lid)

    async def remove_slot(self, uid: int, lid: int, slot_id: int) -> list[dict]:
        await self.owned(uid, lid)
        sql = "UPDATE slots SET status = 'cancelled' WHERE id = ? AND listing_id = ? AND status = 'open'"
        if await self.db.run(sql, (slot_id, lid)) != 1:
            raise Refused("slot_taken")
        return await self.open_slots(lid)

    async def incoming(self, uid: int, limit: int = 30) -> list[dict]:
        rows = await self.db.all("SELECT v.*, s.start_at FROM viewings v JOIN slots s ON s.id = v.slot_id WHERE "
                                 "v.landlord_id = ? AND v.status IN ('pending', 'accepted') ORDER BY v.status != "
                                 "'pending', s.start_at LIMIT ?", (uid, limit))
        out = []
        for r in rows:
            item = await self._with_contacts(r, uid)
            tenant = await self.user(r["tenant_id"])
            item["tenant_name"] = (tenant or {}).get("name", "")
            out.append(item)
        return out

    async def decide(self, uid: int, vid: int, accept: bool) -> dict:
        """The landlord accepts or declines a request. Only then do both sides see each other's phone."""
        action = "accept" if accept else "decline"
        async with self.db.tx() as c:
            async with c.execute("SELECT v.*, s.start_at FROM viewings v JOIN slots s ON s.id = v.slot_id WHERE "
                                 "v.id = ? AND v.landlord_id = ?", (vid, uid)) as cur:
                v = await cur.fetchone()
            if v is None:
                raise Refused("not_found")
            try:
                status = rules.move(v["status"], action)
            except rules.ViewingError as err:
                raise Refused("state") from err
            if accept and v["start_at"] <= self.now():
                raise Refused("slot_time")
            cur = await c.execute("UPDATE viewings SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
                                  (status, self.now(), vid))
            if cur.rowcount != 1:
                raise Refused("state")
            await c.execute("UPDATE slots SET status = ? WHERE id = ?", ("booked" if accept else "open", v["slot_id"]))
        return await self._with_contacts(await self.viewing(vid), uid)

    # ── scheduler: the 30-day lifetime and past requests ──
    async def expire_due(self) -> dict:
        now = self.now()
        async with self.db.tx() as c:
            async with c.execute("SELECT id, landlord_id FROM listings WHERE status IN ('active', 'paused') AND "
                                 "expires_at <= ? LIMIT 500", (now,)) as cur:
                gone = [dict(r) for r in await cur.fetchall()]
            for x in gone:
                await c.execute("UPDATE listings SET status = 'expired' WHERE id = ? AND status IN "
                                "('active', 'paused')", (x["id"],))
            async with c.execute("SELECT v.id, v.tenant_id, v.slot_id FROM viewings v JOIN slots s ON s.id = v.slot_id "
                                 "WHERE v.status = 'pending' AND s.start_at <= ? LIMIT 500", (now,)) as cur:
                late = [dict(r) for r in await cur.fetchall()]
            for v in late:
                await c.execute("UPDATE viewings SET status = 'expired', decided_at = ? WHERE id = ? AND status = "
                                "'pending'", (now, v["id"]))
        if gone:
            self.changed()
        return {"listings": gone, "viewings": late}

    # ── admin: reports ──
    def _admin(self, uid: int) -> None:
        if uid not in self.admins:
            raise Refused("forbidden")

    async def open_reports(self, uid: int) -> list[dict]:
        self._admin(uid)
        return await self.db.all("SELECT r.listing_id, COUNT(*) AS n, GROUP_CONCAT(r.reason) AS reasons, MIN(r.id) AS "
                                 "first FROM reports r WHERE r.status = 'open' GROUP BY r.listing_id ORDER BY n DESC, "
                                 "first LIMIT 20")

    async def moderate(self, uid: int, lid: int, remove: bool) -> None:
        self._admin(uid)
        async with self.db.tx() as c:
            cur = await c.execute("UPDATE reports SET status = ?, decided_by = ?, decided_at = ? WHERE listing_id = ? "
                                  "AND status = 'open'", ("removed" if remove else "dismissed", uid, self.now(), lid))
            if cur.rowcount == 0:
                raise Refused("not_found")
            if remove:
                await c.execute("UPDATE listings SET status = 'removed', hidden = 1 WHERE id = ?", (lid,))
                await c.execute("UPDATE viewings SET status = 'cancelled', decided_at = ? WHERE listing_id = ? AND "
                                "status IN ('pending', 'accepted')", (self.now(), lid))
            else:
                await c.execute("UPDATE listings SET hidden = 0 WHERE id = ?", (lid,))
        self.changed()
