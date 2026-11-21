"""Shared helpers: the seeded city in a database, a clock the tests can move, and the people in the stories."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path

from uyijara.core import seedgen
from uyijara.db import Database
from uyijara.service import Service

ROOT = Path(__file__).resolve().parent.parent
NOW = 1_795_000_000_000  # Wednesday 2026-11-18, 16:06 in Tashkent (the same moment as the shared vectors)
ADMIN, AZIZ, KAMOLA, TIMUR, NODIRA, JAVOHIR = 9001, 1001, 1002, 1003, 3001, 3005
CHEAP, EXPENSIVE, OTHER, PAUSED = seedgen.STORY_CHEAP, seedgen.STORY_EXPENSIVE, seedgen.LANDLORD_OTHER, seedgen.PAUSED
SUSPICIOUS = seedgen.SUSPICIOUS


def load(name: str):
    with open(ROOT / "shared" / "data" / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


class Clock:
    def __init__(self, start: int = NOW) -> None:
        self.now = start

    def __call__(self) -> int:
        return self.now

    def skip(self, minutes: float = 0, hours: float = 0, days: float = 0) -> None:
        self.now += int((minutes + hours * 60 + days * 1440) * 60_000)


@asynccontextmanager
async def service_env(clock: Clock | None = None, path: str = ":memory:"):
    clock = clock or Clock()
    districts = load("districts")
    db = await Database.open(path)
    await db.seed(seedgen.world(districts, load("people"), clock()), clock())
    svc = Service(db, districts, clock=clock, admins=frozenset({ADMIN}))
    await svc.touch_user(ADMIN, "Admin", "uz")
    try:
        yield svc, clock
    finally:
        await db.close()


def draft(**kw) -> dict:
    """A valid new listing (Nodira's new flat in Chilonzor from the demo story)."""
    base = {"district": "chilonzor", "rooms": 2, "area": 54, "floor": 3, "floors": 9, "building": "brick",
            "renovation": "cosmetic", "furnished": 1, "audience": "any", "pets": 0, "amenities": ["fridge", "washer"],
            "price": 5_200_000, "currency": "UZS", "address": "Bog'bon ko'chasi, 7-uy, 12-xonadon",
            "note": "Metro yaqin", "photo_seed": 777}
    return {**base, **kw}


async def slot_of(svc: Service, lid: int, n: int = 0) -> int:
    return (await svc.open_slots(lid))[n]["id"]
