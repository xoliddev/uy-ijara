"""Regenerate shared/test_vectors.json from the Python core.

pytest checks that the file is up to date (so the Python core and the vectors never drift apart), and
``node --test`` checks the JS port against the very same vectors.

    python scripts/make_vectors.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from uyijara.core import clock, fair, listing, money, search, seedgen, text, viewing  # noqa: E402

OUT = ROOT / "shared" / "test_vectors.json"
NOW = 1_795_000_000_000  # 2026-11-18 11:06 UTC (16:06 in Tashkent), a Wednesday
NYE = 1_798_736_400_000  # 2026-12-31 22:00 in Tashkent
RATE = money.DEFAULT_RATE
ERRORS = (money.PriceError, listing.ListingError, search.SearchError, viewing.ViewingError)


def load(name: str):
    with open(ROOT / "shared" / "data" / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


def res(fn, *args):
    try:
        return {"ok": fn(*args)}
    except ERRORS as e:
        return {"error": e.code}


GOOD = {"district": "chilonzor", "rooms": 2, "area": 56, "floor": 3, "floors": 9, "building": "brick",
        "renovation": "euro", "furnished": 1, "audience": "family", "pets": 0, "amenities": ["tv", "ac", "ac"],
        "price": 5_200_000, "currency": "UZS", "address": "  Lolazor ko'chasi,\t14-uy ", "note": "Metro yaqin",
        "photo_seed": 42}
BAD = [("district", "nowhere"), ("rooms", 0), ("rooms", 7), ("rooms", True), ("rooms", "3"),
       ("area", 11), ("area", "401"), ("floor", 10), ("floors", 41), ("building", "tent"), ("renovation", None),
       ("audience", "men"), ("furnished", 2), ("pets", "yes"), ("amenities", ["sauna"]), ("amenities", "ac"),
       ("price", 299_999), ("price", "5200000"), ("currency", "EUR"), ("address", "abc"), ("photo_seed", 0),
       ("note", "x" * 500)]


def build() -> dict:
    districts, people = load("districts"), load("people")
    dset = {d["id"] for d in districts}
    dmap = {d["id"]: d for d in districts}
    v: dict = {"now": NOW, "rate": RATE}
    v["words"] = [{"in": t, "out": text.words(t)} for t in
                  ["Чиланзар", "Chilanzar", "Chilonzor", "Mirzo Ulug'bek", "Мирзо-Улугбек", "Yunusabad", "Юнусобод",
                   "2 xonali", "3-комнатная квартира", "g'isht", "Ҳовли", "евроремонт", "", "x" * 300]]
    v["civil"] = [{"day": d, "out": list(clock.civil(d))} for d in (0, 1, 59, 365, 10_957, 20_775, 20_818, 20_819,
                                                                   20_878, 21_184, -1, -719_468)]
    v["local"] = [{"ms": ms, "day": clock.local_day(ms), "minute": clock.local_minute(ms),
                   "wd": clock.weekday(clock.local_day(ms))} for ms in (0, NOW, NYE, NYE + 7_200_000, -1)]
    v["div_round"] = [{"a": a, "b": b, "out": money.div_round(a, b)} for a, b in
                      ((5, 2), (-5, 2), (7, 3), (-7, 3), (149, 100), (150, 100), (-150, 100), (0, 9), (12_345_678, 12_800))]
    v["group"] = [{"n": n, "out": money.group(n)} for n in (0, 7, 999, 1000, 4_200_000, -50_000, 300_000_000)]
    v["parse_price"] = [{"in": t, "cur": c, "out": res(money.parse_price, t, c)} for t, c in
                        [("4 200 000", "UZS"), ("4200000", "UZS"), ("4,2 mln", "UZS"), ("4.25 млн so'm", "UZS"),
                         ("4.200.000", "UZS"), ("$450", "UZS"), ("450 usd", "UZS"), ("450$", "UZS"), ("450", "USD"),
                         ("4 mln", "USD"), ("4.5", "UZS"), ("-5000000", "UZS"), ("", "UZS"), ("abc", "UZS"),
                         ("299 999", "UZS"), ("300 000 сум", "UZS"), ("26 000", "USD"), ("25", "USD"),
                         (5_000_000, "UZS"), (450, "USD"), (True, "UZS"), ("1 000 000 000", "UZS")]]
    v["convert"] = [{"a": a, "c": c, "to": money.to_uzs(a, c, RATE), "from": money.from_uzs(a, c, RATE)}
                    for a, c in ((450, "USD"), (4_200_000, "UZS"), (6_400, "USD"))]
    lists = [[5], [5, 1], [3, 1, 2], [4, 1, 3, 2], [100, 101, 99, 102, 400], [100, 100, 100, 100, 104, 140],
             [90, 95, 100, 105, 110, 20, 300], [1, 1, 1, 1], [10_000, 12_000, 11_000, 30_000, 11_500, 2_000]]
    v["median"] = [{"in": xs, "out": fair.median(xs)} for xs in lists]
    v["mad_trim"] = [{"in": xs, "out": fair.mad_trim(xs)} for xs in lists]
    v["validate"] = [{"name": "good", "in": GOOD, "out": res(listing.validate, GOOD, dset)}]
    for key, value in BAD:
        data = {**GOOD, key: value}
        v["validate"].append({"name": f"{key}={value!r}"[:40], "in": data, "out": res(listing.validate, data, dset)})
    v["floor"] = [{"in": t, "out": res(listing.parse_floor, t)} for t in ("3/9", " 1 / 1 ", "12-16", "9/5", "0/5", "3",
                                                                          "41/41", "a/b", "5|5")]
    v["phone"] = [{"in": t, "out": res(listing.normalize_phone, t)} for t in
                  ("+998 90 123 45 67", "90 123-45-67", "998901234567", "(97) 000 30 01", "+7 900 123 45 67",
                   "+998 00 123 45 67", "12345", "")]
    v["fmt_phone"] = [{"in": p, "out": listing.fmt_phone(p)} for p in ("+998901234567", "+998930001001")]
    v["clean"] = [{"in": t, "n": n, "out": listing.clean(t, n)} for t, n in
                  (("  a \t b\n", 10), ("abc" + chr(0x202E) + "def", 20), ("x" * 20, 5), (None, 5), ("Lola" + chr(0) + "zor", 20))]
    v["approx"] = [{"id": i, "d": did, "out": list(listing.approx_point(i, dmap[did]))} for i, did in
                   ((1, "chilonzor"), (99, "yunusobod"), (4321, "sergeli"))]
    w = seedgen.world(districts, people, NOW)
    v["seed"] = w
    later = seedgen.world(districts, people, NYE)
    v["seed_nye"] = {"now": NYE, "count": len(later["listings"]), "slots": later["slots"][:3],
                     "first": later["listings"][0]}
    active = [x for x in w["listings"] if x["status"] == "active"]
    evals = fair.evaluate_all(active, RATE)
    v["evals"] = {str(k): e for k, e in evals.items()}
    v["factors"] = [{"id": x["id"], "out": [list(f) for f in fair.factors(x)], "q": fair.quality(x)} for x in active[:20]]
    draft = {**GOOD, "amenities": [], "id": None}
    v["estimate"] = []
    for rooms, area, district in ((2, 56, "chilonzor"), (1, 40, "chilonzor"), (4, 95, "yunusobod"), (2, 50, "bektemir"),
                                  (3, 80, "olmazor")):
        d = {**draft, "rooms": rooms, "area": area, "district": district}
        v["estimate"].append({"in": d, "out": fair.estimate(d, active, RATE)})
    v["band_pos"] = [{"p": p, "band": [4_000_000, 5_000_000], "out": fair.where_in_band(p, [4_000_000, 5_000_000])}
                     for p in (3_000_000, 4_000_000, 4_500_000, 5_000_000, 6_000_000)]
    filters = [{}, {"district": "chilonzor"}, {"district": "chilonzor", "rooms": 2, "sort": "cheap"},
               {"rooms": 4}, {"price_max": 500, "currency": "USD"}, {"price_min": 5_000_000, "price_max": 8_000_000},
               {"furnished": 1, "pets": 1}, {"audience": "students"}, {"audience": "women", "sort": "new"},
               {"min_area": 80}, {"q": "Чиланзар"}, {"q": "chilanzar 2 xonali"}, {"q": "yunusabad evro"},
               {"q": "mirzo ulugbek oila"}, {"q": "hovli"}, {"q": "qwerty"}, {"q": "3 комнатная квартира"}]
    v["search"] = []
    for f in filters:
        nf = search.normalize(f, dset)
        v["search"].append({"in": f, "norm": nf, "out": search.run(nf, active, evals, RATE, dmap)})
    v["normalize_bad"] = [{"in": f, "out": res(search.normalize, f, dset)} for f in
                          ({"district": "x"}, {"rooms": 5}, {"rooms": "2"}, {"sort": "random"}, {"currency": "EUR"},
                           {"price_min": 9, "price_max": 5}, {"audience": "men"}, {"furnished": True},
                           {"min_area": 401}, {"district": ["chilonzor"]}, [], {"q": 5})]
    sub = {"user_id": 1001, "created_at": NOW - 3_600_000,
           "filter": search.normalize({"district": "chilonzor", "rooms": 2, "price_max": 6_000_000}, dset)}
    v["alerts"] = [{"l": x["id"], "sub": sub, "out": search.alert_due(sub, x, RATE, dmap[x["district"]])}
                   for x in active[:15]]
    fresh = {**active[0], "published_at": NOW, "landlord_id": 3001, "price": 5_900_000, "currency": "UZS"}
    v["alerts"].append({"l": "fresh", "listing": fresh, "sub": sub, "out": search.alert_due(sub, fresh, RATE,
                                                                                             dmap["chilonzor"])})
    v["presets"] = [{"now": n, "out": viewing.presets(n)} for n in (NOW, NYE, NYE + 7_200_000)]
    p = viewing.presets(NOW)
    v["check_time"] = [{"t": t, "out": res(viewing.check_time, t, NOW)} for t in
                       (p[0], p[0] + 60_000, NOW + 1_800_000, NOW + 15 * 86_400_000, True, p[5])]
    v["check_request"] = [{"in": a, "out": res(viewing.check_request, *a)} for a in
                          (("open", p[0], NOW, 0, False, False), ("taken", p[0], NOW, 0, False, False),
                           ("open", NOW - 1, NOW, 0, False, False), ("open", p[0], NOW, 3, False, False),
                           ("open", p[0], NOW, 0, True, False), ("open", p[0], NOW, 0, False, True))]
    v["moves"] = [{"s": s, "a": a, "out": res(viewing.move, s, a)} for s in ("pending", "accepted", "declined")
                  for a in ("accept", "decline", "cancel", "expire")]
    return v


def main() -> None:
    body = json.dumps(build(), ensure_ascii=False, separators=(",", ":")) + "\n"
    OUT.write_text(body, encoding="utf-8", newline="\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
