"""SQLite storage (aiosqlite, WAL, indexes). Parameterised SQL only. Times are UTC milliseconds.

The rules that must never break are also written into the schema, so even a bug in the service cannot break them:
* a viewing slot has at most one live request (unique partial index), on top of the conditional UPDATE;
* a tenant has at most one live request per listing;
* the same flat cannot be live twice (duplicate fingerprint and owner key are unique among live listings);
* a saved search fires at most once per listing (primary key on ``alert_hits``).
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

import aiosqlite

from .core.listing import fingerprint, owner_key
from .core.money import DEFAULT_RATE

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, lang TEXT NOT NULL DEFAULT 'uz', phone TEXT,
  last_filter TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, landlord_id INTEGER NOT NULL, district TEXT NOT NULL,
  rooms INTEGER NOT NULL CHECK (rooms BETWEEN 1 AND 6), area INTEGER NOT NULL CHECK (area BETWEEN 12 AND 400),
  floor INTEGER NOT NULL CHECK (floor >= 1), floors INTEGER NOT NULL CHECK (floors BETWEEN floor AND 40),
  building TEXT NOT NULL CHECK (building IN ('panel', 'brick', 'monolith', 'house')),
  renovation TEXT NOT NULL CHECK (renovation IN ('none', 'cosmetic', 'euro', 'designer')),
  furnished INTEGER NOT NULL CHECK (furnished IN (0, 1)), pets INTEGER NOT NULL CHECK (pets IN (0, 1)),
  audience TEXT NOT NULL CHECK (audience IN ('any', 'family', 'students', 'women')), amenities TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price > 0), currency TEXT NOT NULL CHECK (currency IN ('UZS', 'USD')),
  address TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', photo_seed INTEGER NOT NULL,
  lat REAL, lon REAL, pin_lat REAL NOT NULL, pin_lon REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired', 'removed')),
  hidden INTEGER NOT NULL DEFAULT 0, fingerprint TEXT NOT NULL, owner_key TEXT NOT NULL,
  published_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS listings_live ON listings(status, district);
CREATE INDEX IF NOT EXISTS listings_owner ON listings(landlord_id, status);
CREATE INDEX IF NOT EXISTS listings_due ON listings(status, expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS listings_fp ON listings(fingerprint) WHERE status IN ('active', 'paused');
CREATE UNIQUE INDEX IF NOT EXISTS listings_owner_key ON listings(owner_key) WHERE status IN ('active', 'paused');
CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL REFERENCES listings(id),
  start_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'held', 'booked', 'cancelled')),
  UNIQUE (listing_id, start_at)
);
CREATE TABLE IF NOT EXISTS viewings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slot_id INTEGER NOT NULL REFERENCES slots(id),
  listing_id INTEGER NOT NULL REFERENCES listings(id), tenant_id INTEGER NOT NULL, landlord_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at INTEGER NOT NULL, decided_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS viewings_slot ON viewings(slot_id) WHERE status IN ('pending', 'accepted');
CREATE UNIQUE INDEX IF NOT EXISTS viewings_once ON viewings(listing_id, tenant_id)
  WHERE status IN ('pending', 'accepted');
CREATE INDEX IF NOT EXISTS viewings_tenant ON viewings(tenant_id, status);
CREATE INDEX IF NOT EXISTS viewings_landlord ON viewings(landlord_id, status);
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, filter TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subs_user ON subscriptions(user_id);
CREATE TABLE IF NOT EXISTS alert_hits (
  sub_id INTEGER NOT NULL, listing_id INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (sub_id, listing_id)
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, listing_id INTEGER NOT NULL REFERENCES listings(id),
  reporter_id INTEGER NOT NULL, reason TEXT NOT NULL CHECK (reason IN ('scam', 'price', 'rented', 'other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'removed', 'dismissed')),
  created_at INTEGER NOT NULL, decided_by INTEGER, decided_at INTEGER, UNIQUE (listing_id, reporter_id)
);
CREATE INDEX IF NOT EXISTS reports_open ON reports(status, listing_id);
"""
LISTING_COLS = ("landlord_id", "district", "rooms", "area", "floor", "floors", "building", "renovation", "furnished",
                "pets", "audience", "amenities", "price", "currency", "address", "note", "photo_seed", "lat", "lon",
                "pin_lat", "pin_lon", "status", "fingerprint", "owner_key", "published_at", "updated_at", "expires_at")


def listing_row(x: dict) -> dict:
    """A stored row back to a listing dict (amenities are JSON in the table)."""
    return {**x, "amenities": json.loads(x["amenities"])}


class Database:
    def __init__(self, conn: aiosqlite.Connection) -> None:
        self.conn = conn
        self.lock = asyncio.Lock()  # one transaction at a time on this connection

    @classmethod
    async def open(cls, path: str) -> Database:
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        conn = await aiosqlite.connect(path, isolation_level=None)  # we issue BEGIN/COMMIT ourselves
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA synchronous=NORMAL")
        await conn.execute("PRAGMA busy_timeout=5000")
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.executescript(SCHEMA)
        return cls(conn)

    async def close(self) -> None:
        await self.conn.close()

    @asynccontextmanager
    async def tx(self):
        """``BEGIN IMMEDIATE`` takes the write lock up front, so check-then-write sequences cannot interleave,
        neither between coroutines (asyncio lock) nor between processes (SQLite lock + busy_timeout)."""
        async with self.lock:
            for attempt in range(6):  # busy_timeout already waits; this only covers a very loaded machine
                try:
                    await self.conn.execute("BEGIN IMMEDIATE")
                    break
                except sqlite3.OperationalError as err:
                    if "locked" not in str(err) or attempt == 5:
                        raise
                    await asyncio.sleep(0.05 * (attempt + 1))
            try:
                yield self.conn
            except BaseException:
                await self.conn.execute("ROLLBACK")
                raise
            await self.conn.execute("COMMIT")

    async def one(self, sql: str, args: tuple = ()) -> dict | None:
        async with self.conn.execute(sql, args) as cur:
            row = await cur.fetchone()
        return dict(row) if row else None

    async def all(self, sql: str, args: tuple = ()) -> list[dict]:
        async with self.conn.execute(sql, args) as cur:
            return [dict(r) for r in await cur.fetchall()]

    async def run(self, sql: str, args: tuple = ()) -> int:
        """A single write outside an explicit transaction (autocommit). Returns rowcount."""
        async with self.lock:
            cur = await self.conn.execute(sql, args)
            return cur.rowcount

    @staticmethod
    async def insert_listing(c, x: dict, rate: int) -> int:
        row = {**x, "amenities": json.dumps(x["amenities"]), "fingerprint": fingerprint(x, rate),
               "owner_key": owner_key(x["landlord_id"], x)}
        cols = ", ".join(LISTING_COLS)
        cur = await c.execute(f"INSERT INTO listings ({cols}) VALUES ({', '.join('?' * len(LISTING_COLS))})",  # noqa: S608
                              tuple(row[k] for k in LISTING_COLS))
        return cur.lastrowid

    async def seed(self, world: dict, now_ms: int, rate: int = DEFAULT_RATE) -> bool:
        """Fill an empty database with the fictional demo city. Returns False when data already exists."""
        if await self.one("SELECT 1 FROM listings LIMIT 1"):
            return False
        async with self.tx() as c:
            for u in world["users"]:
                await c.execute("INSERT OR IGNORE INTO users (id, name, lang, phone, created_at) "
                                "VALUES (?, ?, 'uz', ?, ?)", (u["id"], u["name"], u["phone"], now_ms))
            for x in world["listings"]:
                lid = await self.insert_listing(c, x, rate)
                assert lid == x["id"], "seed ids must follow insertion order"  # noqa: S101
            slot_ids = {}
            for s in world["slots"]:
                cur = await c.execute("INSERT INTO slots (listing_id, start_at) VALUES (?, ?)",
                                      (s["listing_id"], s["start_at"]))
                slot_ids[(s["listing_id"], s["start_at"])] = cur.lastrowid
            for r in world["requests"]:
                sid = slot_ids[tuple(r["slot"])]
                landlord = next(x["landlord_id"] for x in world["listings"] if x["id"] == r["slot"][0])
                await c.execute("UPDATE slots SET status = 'held' WHERE id = ?", (sid,))
                await c.execute("INSERT INTO viewings (slot_id, listing_id, tenant_id, landlord_id, created_at) "
                                "VALUES (?, ?, ?, ?, ?)",
                                (sid, r["slot"][0], r["tenant_id"], landlord, r["created_at"]))
        return True
