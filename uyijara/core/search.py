"""Search filters, text search over places and features (Latin or Cyrillic, with typos), sorting and saved-search
matching. A filter is a plain dict; ``normalize`` is the only way one gets in, from the bot, the API or the demo.
"""

from __future__ import annotations

from .listing import AUDIENCES, clean
from .money import CURRENCIES, LIMITS, UZS, to_uzs
from .text import word_score, words

SORTS = ("fair", "new", "cheap")
AUD_FILTERS = ("", "family", "students", "women")
ROOM_FILTERS = (0, 1, 2, 3, 4)  # 0 = any, 4 = four rooms or more
AREA_FILTERS = (0, 30, 45, 60, 80, 100)
BUDGETS = ((0, 0), (0, 3_000_000), (3_000_000, 5_000_000), (5_000_000, 8_000_000), (8_000_000, 12_000_000),
           (12_000_000, 0))  # bot presets in so'm; 0 = no bound
MAX_SUBS = 5
TERMS = {
    "building_panel": ["panel", "панель", "панельный"],
    "building_brick": ["g'isht", "гишт", "кирпич", "kirpich"],
    "building_monolith": ["monolit", "монолит", "novostroyka", "новостройка"],
    "building_house": ["hovli", "ҳовли", "дом", "hovlili"],
    "renovation_euro": ["yevro", "евро", "evro", "euro"],
    "renovation_designer": ["dizayner", "дизайнерский", "дизайн"],
    "furnished": ["mebel", "mebelli", "мебель", "меблированная"],
    "pets": ["hayvon", "hayvonlar", "животные", "питомцы"],
    "audience_family": ["oila", "oilaviy", "семья", "семейная"],
    "audience_students": ["talaba", "talabalar", "студент", "студенты"],
    "audience_women": ["ayol", "ayollar", "qizlar", "девушки", "женщины"],
}
STOP = ["xona", "xonali", "komnata", "комнатная", "комнат", "kvartira", "квартира", "uy", "ijara", "ijaraga",
        "аренда", "arenda", "снять", "сдается", "va", "и", "в"]
TERM_KEYS = {k: [w for t in v for w in words(t)] for k, v in TERMS.items()}
STOP_KEYS = [w for t in STOP for w in words(t)]


class SearchError(ValueError):
    def __init__(self, code: str = "filter") -> None:
        super().__init__(code)
        self.code = code


def default_filter() -> dict:
    return {"district": "", "rooms": 0, "price_min": 0, "price_max": 0, "currency": UZS, "furnished": 0, "pets": 0,
            "audience": "", "min_area": 0, "q": "", "sort": "fair"}


def _int(value: object, lo: int, hi: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise SearchError()
    return value


def normalize(data: object, districts: set[str]) -> dict:
    """A complete, valid filter or SearchError. Missing keys take their defaults; unknown keys are dropped."""
    if not isinstance(data, dict):
        raise SearchError()
    f = default_filter()
    f.update({k: data[k] for k in f if k in data and data[k] is not None})
    if not isinstance(f["district"], str) or (f["district"] and f["district"] not in districts):
        raise SearchError()
    if f["currency"] not in CURRENCIES or f["sort"] not in SORTS or f["audience"] not in AUD_FILTERS:
        raise SearchError()
    hi = LIMITS[f["currency"]][1]
    out = {"district": f["district"], "rooms": _int(f["rooms"], 0, 4), "price_min": _int(f["price_min"], 0, hi),
           "price_max": _int(f["price_max"], 0, hi), "currency": f["currency"], "furnished": _int(f["furnished"], 0, 1),
           "pets": _int(f["pets"], 0, 1), "audience": f["audience"], "min_area": _int(f["min_area"], 0, 400),
           "q": clean(f["q"], 64) if isinstance(f["q"], str) else "", "sort": f["sort"]}
    if out["price_max"] and out["price_min"] > out["price_max"]:
        raise SearchError()
    return out


def keys_for(listing: dict, district: dict) -> list[str]:
    """The words a listing can be found by: its district (Uzbek, Russian, aliases) and its features."""
    keys = words(district["name"]["uz"]) + words(district["name"]["ru"])
    for alias in district.get("aliases", []):
        keys += words(alias)
    tags = [f"building_{listing['building']}", f"renovation_{listing['renovation']}"]
    if listing["furnished"]:
        tags.append("furnished")
    if listing["pets"]:
        tags.append("pets")
    tags += [f"audience_{a}" for a in AUDIENCES[1:] if listing["audience"] in ("any", a)]
    for tag in tags:
        keys += TERM_KEYS.get(tag, [])
    return keys


def text_match(q: str, listing: dict, keys: list[str]) -> bool:
    """Every query word must match: a room count ("2"), a stop word ("xonali", "квартира") or one of the keys."""
    for w in words(q):
        if w.isdigit():
            if 1 <= int(w) <= 6 and listing["rooms"] != int(w):
                return False
            continue
        if any(word_score(w, s) in (0, 1) for s in STOP_KEYS):
            continue
        if not any(word_score(w, k) is not None for k in keys):
            return False
    return True


def matches(f: dict, listing: dict, rate: int, keys: list[str] | None = None) -> bool:
    if f["district"] and listing["district"] != f["district"]:
        return False
    if f["rooms"] and (listing["rooms"] < 4 if f["rooms"] == 4 else listing["rooms"] != f["rooms"]):
        return False
    price = to_uzs(listing["price"], listing["currency"], rate)
    if f["price_min"] and price < to_uzs(f["price_min"], f["currency"], rate):
        return False
    if f["price_max"] and price > to_uzs(f["price_max"], f["currency"], rate):
        return False
    if f["furnished"] and not listing["furnished"]:
        return False
    if f["pets"] and not listing["pets"]:
        return False
    if f["audience"] and listing["audience"] not in ("any", f["audience"]):
        return False
    if f["min_area"] and listing["area"] < f["min_area"]:
        return False
    return not f["q"] or (keys is not None and text_match(f["q"], listing, keys))


def sort_key(sort: str, listing: dict, ev: dict | None, rate: int) -> tuple:
    if sort == "new":
        return (-listing["published_at"], -listing["id"])
    if sort == "cheap":
        return (to_uzs(listing["price"], listing["currency"], rate), -listing["id"])
    return ((ev or {}).get("score", 1_000_000), -listing["published_at"], -listing["id"])


def run(f: dict, listings: list[dict], evals: dict[int, dict], rate: int, districts: dict[str, dict]) -> list[int]:
    """Ids of the matching listings in the chosen order."""
    hits = [x for x in listings
            if matches(f, x, rate, keys_for(x, districts[x["district"]]) if f["q"] else None)]
    hits.sort(key=lambda x: sort_key(f["sort"], x, evals.get(x["id"]), rate))
    return [x["id"] for x in hits]


def alert_due(sub: dict, listing: dict, rate: int, district: dict) -> bool:
    """A saved search fires for listings published after it was saved, by someone else, that match it."""
    if listing["published_at"] < sub["created_at"] or listing["landlord_id"] == sub["user_id"]:
        return False
    keys = keys_for(listing, district) if sub["filter"]["q"] else None
    return matches(sub["filter"], listing, rate, keys)
