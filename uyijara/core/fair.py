"""The "Narx adolatlimi?" check (is the price fair?) against similar homes in the same district.

The model is small on purpose, so that it can be explained in one sentence and checked by hand:

1. Every listing's rent is turned into so'm per m² and divided by its *quality* (a percentage built from a few
   integer coefficients: renovation, building type, furniture, first/last floor). That gives a "standard" price
   per m² that can be compared across homes of different size and condition.
2. Comparables are the active listings in the same district with the same number of rooms. When there are fewer
   than ``MIN_COMPARABLES``, ±1 room is used, then the whole district; the sentence says which one.
3. Outliers are dropped with the modified z-score (Iglewicz & Hoaglin): a value more than 3.5 / 0.6745 ≈ 5.2
   median absolute deviations (MAD) from the median is ignored, so one fake "luxury" or "too good to be true"
   listing cannot drag the median.
4. The fair price of *this* home = median standard price × its area × its quality. The verdict compares the real
   rent with it: ≤ −10 % is "Arzon", ≥ +10 % is "Qimmat", in between "Adolatli". The fair band is ±10 %.

Whole numbers only (``//`` and ``div_round``), so the Python server and the JS demo agree to the so'm.
"""

from __future__ import annotations

from .money import div_round, round_to, to_uzs

MIN_COMPARABLES = 5
CHEAP_PCT, EXPENSIVE_PCT, BAND_PCT = -10, 10, 10
BAND_STEP = 50_000  # the suggested range is shown rounded to 50 000 so'm
RENOVATION = {"none": -12, "cosmetic": 0, "euro": 10, "designer": 20}
BUILDING = {"panel": -4, "brick": 0, "monolith": 6, "house": 3}
FURNISHED = 8
FIRST_FLOOR, LAST_FLOOR = -5, -4
VERDICTS = ("cheap", "fair", "expensive", "few")
SUSPICIOUS_PCT = -35  # far below every comparable: show a scam warning
FEW_SCORE = 1_000_000  # "not enough data" sorts after every real verdict


def median(xs: list[int]) -> int:
    s = sorted(xs)
    n = len(s)
    if n == 0:
        raise ValueError("empty")
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) // 2


def mad_trim(xs: list[int]) -> list[int]:
    """Keep values whose modified z-score 0.6745·|x − median| / MAD is at most 3.5 (in whole numbers:
    6745·|x − median| ≤ 35000·MAD). The MAD never goes below 5 % of the median, so a run of identical prices does
    not turn every slightly different one into an "outlier"."""
    if not xs:
        return []
    med = median(xs)
    mad = max(median([abs(x - med) for x in xs]), med // 20, 1)
    return [x for x in xs if abs(x - med) * 6745 <= 35_000 * mad]


def factors(listing: dict) -> list[tuple[str, int]]:
    """The coefficients (in percent) that make this home dearer or cheaper than a standard one."""
    out = []
    r = RENOVATION[listing["renovation"]]
    if r:
        out.append((f"renovation_{listing['renovation']}", r))
    b = BUILDING[listing["building"]]
    if b:
        out.append((f"building_{listing['building']}", b))
    if listing["furnished"]:
        out.append(("furnished", FURNISHED))
    if listing["building"] != "house" and listing["floors"] > 1:
        if listing["floor"] == 1:
            out.append(("floor_first", FIRST_FLOOR))
        elif listing["floor"] == listing["floors"] and listing["floors"] >= 5:
            out.append(("floor_last", LAST_FLOOR))
    return out


def quality(listing: dict) -> int:
    return 100 + sum(p for _, p in factors(listing))


def standard_ppm(listing: dict, rate: int) -> int:
    """So'm per m² of a standard-quality home with this rent."""
    return to_uzs(listing["price"], listing["currency"], rate) * 100 // (listing["area"] * quality(listing))


def comparables(target: dict, pool: list[dict], rate: int) -> dict:
    """Pick the narrowest group with enough data. ``pool`` holds active listings; the target itself is skipped."""
    rooms = target["rooms"]
    same = [x for x in pool if x["district"] == target["district"] and x["id"] != target.get("id")]
    groups = (("rooms", lambda x: x["rooms"] == rooms), ("near", lambda x: abs(x["rooms"] - rooms) <= 1),
              ("district", lambda x: True))
    for scope, keep in groups:
        values = [standard_ppm(x, rate) for x in same if keep(x)]
        if len(values) >= MIN_COMPARABLES:
            kept = mad_trim(values)
            if len(kept) >= MIN_COMPARABLES:
                return {"scope": scope, "values": kept, "n": len(kept), "n_all": len(values)}
    return {"scope": "few", "values": [], "n": len(same), "n_all": len(same)}


def estimate(target: dict, pool: list[dict], rate: int) -> dict:
    """The fair price and the suggested range for a home, without looking at its own rent (used live while a
    landlord is still typing the price)."""
    comp = comparables(target, pool, rate)
    top = sorted(factors(target), key=lambda f: (-abs(f[1]), f[0]))[:3]
    out = {"scope": comp["scope"], "n": comp["n"], "n_all": comp["n_all"], "factors": [list(f) for f in top],
           "rooms_lo": max(1, target["rooms"] - 1), "rooms_hi": target["rooms"] + 1, "expected": None,
           "band": None}
    if comp["scope"] == "few":
        return out
    expected = median(comp["values"]) * target["area"] * quality(target) // 100
    lo = round_to(expected * (100 - BAND_PCT) // 100, BAND_STEP)
    hi = round_to(expected * (100 + BAND_PCT) // 100, BAND_STEP)
    out.update(expected=expected, band=[lo, hi])
    return out


def verdict_of(pct: int) -> str:
    if pct <= CHEAP_PCT:
        return "cheap"
    if pct >= EXPENSIVE_PCT:
        return "expensive"
    return "fair"


def evaluate(target: dict, pool: list[dict], rate: int) -> dict:
    """``estimate`` plus the verdict for the rent the listing asks."""
    est = estimate(target, pool, rate)
    if est["expected"] is None:
        return {**est, "verdict": "few", "pct": None, "price_uzs": None, "score": FEW_SCORE, "suspicious": False}
    price = to_uzs(target["price"], target["currency"], rate)
    pct = div_round((price - est["expected"]) * 100, est["expected"])
    return {**est, "verdict": verdict_of(pct), "pct": pct, "price_uzs": price, "score": pct,
            "suspicious": pct <= SUSPICIOUS_PCT}


def evaluate_all(listings: list[dict], rate: int) -> dict[int, dict]:
    """Verdicts for every active listing against all the others."""
    return {x["id"]: evaluate(x, listings, rate) for x in listings}


def where_in_band(price_uzs: int, band: list[int]) -> int:
    """Position of a rent on the band bar: 0..100 (clamped), 50 = the middle of the fair range."""
    lo, hi = band
    span = max(hi - lo, 1)
    pos = 10 + div_round((price_uzs - lo) * 80, span)  # the band itself takes 10..90 of the bar
    return max(0, min(100, pos))
