"""Everything a tenant can do, shared by the bot and the Mini App API: search with fair-price verdicts, a listing's
card, viewing requests, saved searches and reports. Landlord and admin actions live in landlord.py (mixed in).

Every method re-checks who is asking; nothing the client sends is trusted for authorization. Contacts and exact
addresses leave this module only for the two people of an accepted viewing (and for the landlord's own listings).
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable

from .common import LANGS, Refused, clean_text, norm_lang
from .core import fair, search
from .core import viewing as rules
from .core.listing import ListingError, normalize_phone
from .core.money import DEFAULT_RATE
from .db import Database, listing_row
from .landlord import LandlordMixin

PUBLIC = ("id", "district", "rooms", "area", "floor", "floors", "building", "renovation", "furnished", "pets",
          "audience", "amenities", "price", "currency", "note", "photo_seed", "pin_lat", "pin_lon", "status",
          "published_at", "updated_at", "expires_at", "landlord_id")
EVAL = ("verdict", "pct", "expected", "band", "scope", "n", "n_all", "factors", "rooms_lo", "rooms_hi", "suspicious",
        "score", "price_uzs")
REASONS = ("scam", "price", "rented", "other")
HIDE_AFTER_REPORTS = 3


class Service(LandlordMixin):
    def __init__(self, db: Database, districts: list[dict], clock: Callable[[], float] | None = None,
                 admins: frozenset[int] = frozenset(), rate: int = DEFAULT_RATE) -> None:
        self.db, self.admins, self.rate = db, frozenset(admins), rate
        self.districts = districts
        self.dmap = {d["id"]: d for d in districts}
        self.clock = clock or (lambda: time.time() * 1000)
        self._evals: tuple[int, dict, list] | None = None
        self.version = 0  # bumped on every listing write; the verdict cache follows it

    def now(self) -> int:
        return int(self.clock())

    # ── users ──
    async def user(self, uid: int) -> dict | None:
        return await self.db.one("SELECT * FROM users WHERE id = ?", (uid,))

    async def touch_user(self, uid: int, name: str, lang_code: str | None = None) -> dict:
        name = clean_text(name, 64) or "-"
        row = await self.user(uid)
        if row is None:
            await self.db.run("INSERT OR IGNORE INTO users (id, name, lang, created_at) VALUES (?, ?, ?, ?)",
                              (uid, name, norm_lang(lang_code), self.now()))
            row = await self.user(uid)
        elif row["name"] != name:
            await self.db.run("UPDATE users SET name = ? WHERE id = ?", (name, uid))
            row["name"] = name
        row["admin"] = uid in self.admins
        return row

    async def set_lang(self, uid: int, lang: str) -> None:
        if lang not in LANGS:
            raise Refused("generic")
        await self.db.run("UPDATE users SET lang = ? WHERE id = ?", (lang, uid))

    async def set_phone(self, uid: int, phone: object) -> str:
        try:
            clean = normalize_phone(phone)
        except ListingError as err:
            raise Refused("phone") from err
        await self.db.run("UPDATE users SET phone = ? WHERE id = ?", (clean, uid))
        return clean

    # ── the live pool and its verdicts ──
    async def pool(self) -> tuple[dict, list[dict]]:
        """Active, visible, unexpired listings and their fair-price verdicts (cached until a listing changes)."""
        if self._evals is None or self._evals[0] != self.version:
            rows = await self.db.all("SELECT * FROM listings WHERE status = 'active' AND hidden = 0 AND expires_at > ? "
                                     "ORDER BY id", (self.now(),))
            live = [listing_row(r) for r in rows]
            self._evals = (self.version, fair.evaluate_all(live, self.rate), live)
        return self._evals[1], self._evals[2]

    def changed(self) -> None:
        self.version += 1

    def public(self, x: dict, ev: dict | None, names: dict[int, str] | None = None) -> dict:
        out = {k: x[k] for k in PUBLIC}
        out["eval"] = {k: ev[k] for k in EVAL} if ev else None
        out["landlord_name"] = (names or {}).get(x["landlord_id"], "")
        return out

    async def names(self, ids: set[int]) -> dict[int, str]:
        if not ids:
            return {}
        marks = ",".join("?" * len(ids))
        rows = await self.db.all(f"SELECT id, name FROM users WHERE id IN ({marks})", tuple(ids))  # noqa: S608
        return {r["id"]: r["name"] for r in rows}

    # ── search ──
    def normalize(self, data: object) -> dict:
        try:
            return search.normalize(data, set(self.dmap))
        except search.SearchError as err:
            raise Refused("filter") from err

    async def last_filter(self, uid: int) -> dict:
        user = await self.user(uid)
        if user and user["last_filter"]:
            try:
                return self.normalize(json.loads(user["last_filter"]))
            except (Refused, ValueError):
                pass
        return search.default_filter()

    async def search(self, uid: int, data: object, limit: int = 50) -> tuple[dict, list[dict], int]:
        """Normalise and remember the filter, return (filter, first ``limit`` hits, total)."""
        f = self.normalize(data)
        await self.db.run("UPDATE users SET last_filter = ? WHERE id = ?", (json.dumps(f), uid))
        evals, live = await self.pool()
        ids = search.run(f, live, evals, self.rate, self.dmap)
        by_id = {x["id"]: x for x in live}
        hits = [by_id[i] for i in ids[:limit]]
        names = await self.names({x["landlord_id"] for x in hits})
        return f, [self.public(x, evals.get(x["id"]), names) for x in hits], len(ids)

    async def listing_row(self, lid: int) -> dict:
        row = await self.db.one("SELECT * FROM listings WHERE id = ?", (lid,))
        if row is None:
            raise Refused("not_found")
        return listing_row(row)

    async def card(self, uid: int, lid: int) -> dict:
        """A listing's full card for this viewer: public data, verdict, open slots, the viewer's own request.
        The exact address and the landlord's phone are added only when this viewer may see them."""
        x = await self.listing_row(lid)
        own = x["landlord_id"] == uid
        visible = x["status"] == "active" and not x["hidden"] and x["expires_at"] > self.now()
        if not visible and not own and uid not in self.admins:
            raise Refused("not_found")
        evals, live = await self.pool()
        ev = evals.get(lid) or fair.evaluate(x, live, self.rate)
        names = await self.names({x["landlord_id"]})
        out = self.public(x, ev, names)
        out["slots"] = await self.open_slots(lid)
        mine = await self.db.one("SELECT v.*, s.start_at FROM viewings v JOIN slots s ON s.id = v.slot_id WHERE "
                                 "v.listing_id = ? AND v.tenant_id = ? AND v.status IN ('pending', 'accepted') "
                                 "ORDER BY v.id DESC LIMIT 1", (lid, uid))
        out["my_viewing"] = mine
        out["own"] = own
        out["contact"] = None
        if own or (mine and rules.contacts_visible(mine["status"])):
            landlord = await self.user(x["landlord_id"])
            out["contact"] = {"address": x["address"], "lat": x["lat"], "lon": x["lon"],
                              "phone": (landlord or {}).get("phone")}
        return out

    async def open_slots(self, lid: int) -> list[dict]:
        return await self.db.all("SELECT id, start_at FROM slots WHERE listing_id = ? AND status = 'open' AND "
                                 "start_at > ? ORDER BY start_at LIMIT 12", (lid, self.now()))

    # ── viewing requests (tenant side) ──
    async def request_viewing(self, uid: int, slot_id: int) -> dict:
        user = await self.user(uid)
        if not user or not user["phone"]:
            raise Refused("no_phone")
        now = self.now()
        async with self.db.tx() as c:
            sql = ("SELECT s.*, l.landlord_id, l.status AS lstatus, l.hidden, l.expires_at FROM slots s "
                   "JOIN listings l ON l.id = s.listing_id WHERE s.id = ?")
            async with c.execute(sql, (slot_id,)) as cur:
                slot = await cur.fetchone()
            if slot is None or slot["lstatus"] != "active" or slot["hidden"] or slot["expires_at"] <= now:
                raise Refused("not_found")
            async with c.execute("SELECT COUNT(*) FROM viewings WHERE tenant_id = ? AND status = 'pending'",
                                 (uid,)) as cur:
                pending = (await cur.fetchone())[0]
            async with c.execute("SELECT 1 FROM viewings WHERE tenant_id = ? AND listing_id = ? AND status IN "
                                 "('pending', 'accepted')", (uid, slot["listing_id"])) as cur:
                already = await cur.fetchone() is not None
            try:
                rules.check_request(slot["status"], slot["start_at"], now, pending, slot["landlord_id"] == uid,
                                    already)
            except rules.ViewingError as err:
                raise Refused(err.code) from err
            # the real guard: one conditional UPDATE, so two tenants can never both take this slot
            cur = await c.execute("UPDATE slots SET status = 'held' WHERE id = ? AND status = 'open' AND start_at > ?",
                                  (slot_id, now))
            if cur.rowcount != 1:
                raise Refused("slot_taken")
            cur = await c.execute("INSERT INTO viewings (slot_id, listing_id, tenant_id, landlord_id, created_at) "
                                  "VALUES (?, ?, ?, ?, ?)",
                                  (slot_id, slot["listing_id"], uid, slot["landlord_id"], now))
            vid = cur.lastrowid
        return await self.viewing(vid)

    async def viewing(self, vid: int) -> dict:
        row = await self.db.one("SELECT v.*, s.start_at FROM viewings v JOIN slots s ON s.id = v.slot_id "
                                "WHERE v.id = ?", (vid,))
        if row is None:
            raise Refused("not_found")
        return row

    async def my_viewings(self, uid: int, limit: int = 20) -> list[dict]:
        rows = await self.db.all("SELECT v.*, s.start_at FROM viewings v JOIN slots s ON s.id = v.slot_id WHERE "
                                 "v.tenant_id = ? ORDER BY v.status NOT IN ('pending', 'accepted'), s.start_at DESC "
                                 "LIMIT ?", (uid, limit))
        return [await self._with_contacts(r, uid) for r in rows]

    async def _with_contacts(self, v: dict, uid: int) -> dict:
        x = await self.listing_row(v["listing_id"])
        evals, _ = await self.pool()
        out = {**v, "listing": self.public(x, evals.get(x["id"]), await self.names({x["landlord_id"]})),
               "contact": None}
        if rules.contacts_visible(v["status"]):
            other = await self.user(v["landlord_id"] if uid == v["tenant_id"] else v["tenant_id"])
            out["contact"] = {"phone": (other or {}).get("phone"), "name": (other or {}).get("name", ""),
                              "address": x["address"], "lat": x["lat"], "lon": x["lon"]}
        return out

    async def cancel_viewing(self, uid: int, vid: int) -> dict:
        """The tenant (or the landlord) calls off a pending or accepted viewing; the slot opens again."""
        async with self.db.tx() as c:
            async with c.execute("SELECT * FROM viewings WHERE id = ? AND (tenant_id = ? OR landlord_id = ?)",
                                 (vid, uid, uid)) as cur:
                v = await cur.fetchone()
            if v is None:
                raise Refused("not_found")
            try:
                rules.move(v["status"], "cancel")
            except rules.ViewingError as err:
                raise Refused("state") from err
            await c.execute("UPDATE viewings SET status = 'cancelled', decided_at = ? WHERE id = ?", (self.now(), vid))
            await c.execute("UPDATE slots SET status = 'open' WHERE id = ? AND status IN ('held', 'booked')",
                            (v["slot_id"],))
        return await self.viewing(vid)

    # ── saved searches ──
    async def add_sub(self, uid: int, data: object) -> dict:
        f = self.normalize(data)
        async with self.db.tx() as c:
            async with c.execute("SELECT COUNT(*) FROM subscriptions WHERE user_id = ?", (uid,)) as cur:
                if (await cur.fetchone())[0] >= search.MAX_SUBS:
                    raise Refused("too_many_subs")
            cur = await c.execute("INSERT INTO subscriptions (user_id, filter, created_at) VALUES (?, ?, ?)",
                                  (uid, json.dumps(f), self.now()))
            sid = cur.lastrowid
        return {"id": sid, "filter": f, "created_at": self.now()}

    async def my_subs(self, uid: int) -> list[dict]:
        rows = await self.db.all("SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id", (uid,))
        return [{**r, "filter": json.loads(r["filter"])} for r in rows]

    async def delete_sub(self, uid: int, sid: int) -> None:
        if await self.db.run("DELETE FROM subscriptions WHERE id = ? AND user_id = ?", (sid, uid)) != 1:
            raise Refused("not_found")

    async def run_alerts(self) -> list[dict]:
        """New listings that match a saved search. Each (search, listing) pair is claimed with INSERT OR IGNORE on
        a primary key first, so it is delivered at most once, even across restarts or two loops at once."""
        _, live = await self.pool()
        subs = await self.db.all("SELECT * FROM subscriptions ORDER BY id LIMIT 5000")
        fired = []
        for s in subs:
            sub = {**s, "filter": json.loads(s["filter"])}
            for x in live:
                if not search.alert_due(sub, x, self.rate, self.dmap[x["district"]]):
                    continue
                claimed = await self.db.run("INSERT OR IGNORE INTO alert_hits (sub_id, listing_id, created_at) "
                                            "VALUES (?, ?, ?)", (s["id"], x["id"], self.now()))
                if claimed == 1:
                    fired.append({"sub_id": s["id"], "user_id": s["user_id"], "listing_id": x["id"]})
        return fired

    # ── reports ──
    async def report(self, uid: int, lid: int, reason: str) -> None:
        if reason not in REASONS:
            raise Refused("generic")
        x = await self.listing_row(lid)
        if x["landlord_id"] == uid or x["status"] != "active":
            raise Refused("not_found")
        async with self.db.tx() as c:
            cur = await c.execute("INSERT OR IGNORE INTO reports (listing_id, reporter_id, reason, created_at) "
                                  "VALUES (?, ?, ?, ?)", (lid, uid, reason, self.now()))
            if cur.rowcount != 1:
                raise Refused("already_reported")
            sql = "SELECT COUNT(*) FROM reports WHERE listing_id = ? AND status = 'open'"
            async with c.execute(sql, (lid,)) as cur:
                if (await cur.fetchone())[0] >= HIDE_AFTER_REPORTS:
                    await c.execute("UPDATE listings SET hidden = 1 WHERE id = ?", (lid,))
        self.changed()
