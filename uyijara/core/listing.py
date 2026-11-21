"""What a listing is made of, and the strict checks every field goes through before it is stored.

Also: phone numbers, the 30-day lifetime, duplicate fingerprints and the approximate (district-level) map pin.
The exact address and the landlord's phone are never part of a public listing.
"""

from __future__ import annotations

import re

from .clock import DAY_MS
from .money import PriceError, check_range, to_uzs

BUILDINGS = ("panel", "brick", "monolith", "house")
RENOVATIONS = ("none", "cosmetic", "euro", "designer")
AUDIENCES = ("any", "family", "students", "women")
AMENITIES = ("ac", "washer", "fridge", "internet", "parking", "balcony", "elevator", "tv")
STATUSES = ("active", "paused", "expired", "removed")
ROOMS = (1, 6)
AREA = (12, 400)
FLOORS = (1, 40)
ADDRESS_MAX, NOTE_MAX = 120, 300
PHOTO_SEEDS = (1, 9999)
LIFETIME_MS = 30 * DAY_MS
_PHONE_DIGITS = re.compile(r"[^0-9]")
_FLOOR = re.compile(r"^\s*([0-9]{1,2})\s*[/\\|-]\s*([0-9]{1,2})\s*$")
_BIDI = "".join(f"{chr(a)}-{chr(b)}" for a, b in ((0x200B, 0x200F), (0x202A, 0x202E), (0x2066, 0x2069)))
_CONTROL = re.compile(f"[\x00-\x1f\x7f{_BIDI}]")


class ListingError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def clean(text: object, limit: int) -> str:
    """Drop control and bidi characters, squeeze spaces, cut to ``limit`` characters."""
    return " ".join(_CONTROL.sub(" ", str(text or "")).split())[:limit]


def whole(value: object, lo: int, hi: int, code: str) -> int:
    """An int (not a bool, not a float) or a short string of digits, within [lo, hi]."""
    if isinstance(value, str) and 0 < len(value.strip()) <= 9 and value.strip().isdigit() and value.strip().isascii():
        n = int(value.strip())
    elif isinstance(value, int) and not isinstance(value, bool):
        n = value
    else:
        raise ListingError(code)
    if not lo <= n <= hi:
        raise ListingError(code)
    return n


def flag(value: object) -> int:
    if value in (True, 1, "1"):
        return 1
    if value in (False, 0, "0", None):
        return 0
    raise ListingError("flag")


def parse_floor(text: str) -> tuple[int, int]:
    """ "3/9" -> (3, 9): floor 3 of a 9-storey building."""
    m = _FLOOR.match(str(text or "")[:12])
    if not m:
        raise ListingError("floor")
    floor, floors = int(m.group(1)), int(m.group(2))
    if not (FLOORS[0] <= floor <= floors <= FLOORS[1]):
        raise ListingError("floor")
    return floor, floors


def normalize_phone(text: object) -> str:
    """Uzbek mobile/landline numbers -> "+998XXXXXXXXX". Accepts "+998 90 123 45 67", "90 123-45-67", "998901234567"."""
    raw = str(text or "")[:32]
    digits = _PHONE_DIGITS.sub("", raw)
    if len(digits) == 9:
        digits = "998" + digits
    if len(digits) != 12 or not digits.startswith("998") or digits[3] == "0":
        raise ListingError("phone")
    return "+" + digits


def fmt_phone(phone: str) -> str:
    d = phone[1:]
    return f"+{d[:3]} {d[3:5]} {d[5:8]} {d[8:10]} {d[10:12]}"


def validate(data: dict, districts: set[str]) -> dict:
    """Everything a landlord sends, checked and normalised. Unknown keys are ignored; any bad value refuses the
    whole listing with a code the bot and the Mini App can explain."""
    if not isinstance(data, dict):
        raise ListingError("generic")
    district = data.get("district")
    if not isinstance(district, str) or district not in districts:
        raise ListingError("district")
    out = {"district": district, "rooms": whole(data.get("rooms"), *ROOMS, "rooms"),
           "area": whole(data.get("area"), *AREA, "area")}
    floor = whole(data.get("floor"), *FLOORS, "floor")
    floors = whole(data.get("floors"), *FLOORS, "floor")
    if floor > floors:
        raise ListingError("floor")
    out.update(floor=floor, floors=floors)
    for key, allowed in (("building", BUILDINGS), ("renovation", RENOVATIONS), ("audience", AUDIENCES)):
        value = data.get(key)
        if value not in allowed:
            raise ListingError(key)
        out[key] = value
    out["furnished"] = flag(data.get("furnished"))
    out["pets"] = flag(data.get("pets"))
    amenities = data.get("amenities") or []
    if not isinstance(amenities, list) or len(amenities) > len(AMENITIES) or any(a not in AMENITIES for a in amenities):
        raise ListingError("amenities")
    out["amenities"] = [a for a in AMENITIES if a in amenities]  # canonical order, no duplicates
    currency = data.get("currency")
    try:
        out["price"] = check_range(data.get("price"), currency)  # type: ignore[arg-type]
    except PriceError as err:
        raise ListingError("price") from err
    out["currency"] = currency
    address = clean(data.get("address"), ADDRESS_MAX)
    if len(address) < 5:
        raise ListingError("address")
    out["address"] = address
    out["note"] = clean(data.get("note"), NOTE_MAX)
    out["photo_seed"] = whole(data.get("photo_seed"), *PHOTO_SEEDS, "photo")
    return out


def fingerprint(listing: dict, rate: int) -> str:
    """Same district, area, rent and photos = the same flat posted twice (by anyone)."""
    price = to_uzs(listing["price"], listing["currency"], rate)
    return f"{listing['district']}|{listing['area']}|{price}|{listing['photo_seed']}"


def owner_key(landlord_id: int, listing: dict) -> str:
    """One landlord cannot list the same district + rooms + area twice at the same time."""
    return f"{landlord_id}|{listing['district']}|{listing['rooms']}|{listing['area']}"


def h32(text: str) -> int:
    """32-bit FNV-1a (the JS port uses Math.imul and gives the same numbers)."""
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def approx_point(listing_id: int, district: dict) -> tuple[float, float]:
    """A stable pin within about 1.3 km of the district centre: the map shows the area, never the building."""
    r = h32(f"pin:{listing_id}")
    lat = (int(district["lat"] * 100_000 + 0.5) + r % 2401 - 1200) / 100_000
    lon = (int(district["lon"] * 100_000 + 0.5) + (r >> 12) % 2401 - 1200) / 100_000
    return lat, lon


def expires_at(start_ms: int) -> int:
    return start_ms + LIFETIME_MS
