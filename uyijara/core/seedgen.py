"""The fictional demo city: 60 listings in ten Tashkent districts, generated from a hash and always relative to "now".

A 32-bit FNV-1a hash of the listing id decides size, building, floor, renovation, furniture, who it is for and the
rent (the district's standard price per m² × quality × 88..115 % noise, rounded to 50 000 so'm; one in five is
listed in dollars). A few listings are pinned so the guided story always finds a "Qimmat" and an "Arzon" flat in
Chilonzor, a suspiciously cheap one and an outlier. The JS port gives the very same city.
"""

from __future__ import annotations

from .clock import MIN_MS
from .fair import quality
from .listing import AMENITIES, approx_point, expires_at, h32
from .money import DEFAULT_RATE, USD, UZS, div_round, round_to
from .viewing import presets

# rooms of each listing, district by district; ids are given in this order (1..60)
PLAN = (("chilonzor", "222222221113334"), ("yunusobod", "22222133314"), ("mirzo-ulugbek", "222213334"),
        ("yakkasaroy", "2221323"), ("mirobod", "122232"), ("olmazor", "221323"), ("shayxontohur", "23"),
        ("sergeli", "21"), ("uchtepa", "2"), ("yashnobod", "3"))
BASE_AREA = {1: 36, 2: 54, 3: 72, 4: 92, 5: 115, 6: 140}
DEMO_LANDLORD = 3001
STORY_EXPENSIVE, STORY_CHEAP, SUSPICIOUS, OUTLIER, PAUSED, LANDLORD_OTHER = 2, 5, 8, 22, 37, 18
PINS = {
    STORY_EXPENSIVE: {"noise": 128, "renovation": "cosmetic", "building": "panel", "floor": 1, "floors": 5,
                      "furnished": 0, "area": 52, "currency": USD, "landlord_id": 3005, "age_min": 6 * 1440 + 200},
    STORY_CHEAP: {"noise": 80, "renovation": "euro", "building": "brick", "floor": 4, "floors": 9, "furnished": 1,
                  "area": 58, "currency": UZS, "landlord_id": DEMO_LANDLORD, "audience": "any", "pets": 1,
                  "amenities": ["ac", "washer", "fridge", "internet", "balcony", "elevator"], "age_min": 2 * 1440 + 75},
    SUSPICIOUS: {"noise": 45, "currency": UZS, "furnished": 1, "age_min": 95},
    OUTLIER: {"noise": 250, "renovation": "designer", "building": "monolith", "floors": 16, "floor": 12},
    LANDLORD_OTHER: {"landlord_id": DEMO_LANDLORD, "currency": UZS},
    PAUSED: {"landlord_id": DEMO_LANDLORD, "currency": UZS, "status": "paused"},
}


def _attrs(lid: int, district: dict, rooms: int, now_ms: int) -> dict:
    h = h32(f"seed:{lid}")
    pin = PINS.get(lid, {})
    building = ("panel", "panel", "panel", "panel", "panel", "brick", "brick", "brick", "monolith", "monolith")[
        (h >> 4) % 10]
    if rooms >= 3 and (h >> 4) % 10 == 9:
        building = "house"
    building = pin.get("building", building)
    if building == "house":
        floors = 1 + (h >> 6) % 2
    elif building == "monolith":
        floors = 9 + (h >> 6) % 8
    else:
        floors = ((4, 5, 9) if building == "panel" else (3, 4, 5))[(h >> 6) % 3]
    floors = pin.get("floors", floors)
    floor = pin.get("floor", 1 if building == "house" else 1 + (h >> 18) % floors)
    amenities = [a for k, a in enumerate(AMENITIES) if (h32(f"am:{lid}") >> k) & 1]
    if floors < 5:
        amenities = [a for a in amenities if a != "elevator"]
    out = {
        "id": lid, "district": district["id"], "rooms": rooms,
        "area": pin.get("area", BASE_AREA[rooms] + h % 13 - 4), "floor": floor, "floors": floors, "building": building,
        "renovation": pin.get("renovation", ("none", "none", "cosmetic", "cosmetic", "cosmetic", "cosmetic", "euro",
                                             "euro", "euro", "designer")[(h >> 8) % 10]),
        "furnished": pin.get("furnished", 1 if (h >> 12) % 10 < 7 else 0),
        "audience": pin.get("audience", ("any", "any", "any", "any", "any", "family", "family", "students",
                                         "students", "women")[(h >> 14) % 10]),
        "pets": pin.get("pets", 1 if (h >> 17) % 10 < 3 else 0),
        "amenities": pin.get("amenities", amenities),
        "landlord_id": pin.get("landlord_id", 3002 + (h >> 5) % 9),
        "photo_seed": 1 + (h >> 7) % 9999,
        "status": pin.get("status", "active"),
        "note": "",
    }
    noise = pin.get("noise", 88 + (h >> 24) % 28)
    uzs = round_to(district["ppm"] * out["area"] * quality(out) // 100 * noise // 100, 50_000)
    currency = pin.get("currency", USD if (h >> 9) % 10 < 2 else UZS)
    out["currency"] = currency
    out["price"] = max(25, round_to(div_round(uzs, DEFAULT_RATE), 10)) if currency == USD else uzs
    street = district["streets"][(h >> 20) % len(district["streets"])]
    house = 1 + (h >> 11) % 60
    out["address"] = (f"{street} ko'chasi, {house}-uy" if building == "house"
                      else f"{street} ko'chasi, {house}-uy, {1 + (h >> 13) % 80}-xonadon")
    e = h32(f"exact:{lid}")
    out["lat"] = (int(district["lat"] * 100_000 + 0.5) + e % 2001 - 1000) / 100_000
    out["lon"] = (int(district["lon"] * 100_000 + 0.5) + (e >> 11) % 2001 - 1000) / 100_000
    out["pin_lat"], out["pin_lon"] = approx_point(lid, district)
    age = pin.get("age_min", 30 + (h >> 3) % (25 * 1440))
    minute = now_ms // MIN_MS
    out["published_at"] = (minute - age) * MIN_MS
    out["updated_at"] = max(out["published_at"], (minute - 5 - (h >> 13) % 900) * MIN_MS)
    out["expires_at"] = expires_at(out["published_at"])
    return out


def listings(districts: list[dict], now_ms: int) -> list[dict]:
    by_id = {d["id"]: d for d in districts}
    out = []
    lid = 0
    for did, plan in PLAN:
        for ch in plan:
            lid += 1
            out.append(_attrs(lid, by_id[did], int(ch), now_ms))
    return out


def slots(rows: list[dict], now_ms: int) -> list[dict]:
    """Open viewing times, relative to now: the story flat has three tomorrow; every third flat has two."""
    times = presets(now_ms)
    out = []
    for x in rows:
        if x["status"] != "active":
            continue
        if x["id"] == STORY_CHEAP:
            picks = times[:3]
        elif x["id"] == LANDLORD_OTHER:
            picks = [times[0], times[3]]
        elif x["id"] % 3 == 0:
            picks = [times[1], times[4]]
        else:
            continue
        out += [{"listing_id": x["id"], "start_at": t} for t in picks]
    return out


def world(districts: list[dict], people: dict, now_ms: int) -> dict:
    """Everything the demo city needs: people, listings, open slots, and one waiting request (Kamola asked to see
    Nodira's flat in Yunusobod tomorrow morning)."""
    rows = listings(districts, now_ms)
    free = slots(rows, now_ms)
    taken = next(s for s in free if s["listing_id"] == LANDLORD_OTHER)
    requests = [{"slot": [taken["listing_id"], taken["start_at"]], "tenant_id": 1002,
                 "created_at": (now_ms // MIN_MS - 42) * MIN_MS}]
    return {"users": people["landlords"] + people["tenants"], "listings": rows, "slots": free, "requests": requests,
            "landlord": DEMO_LANDLORD}
