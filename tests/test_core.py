"""The pure core: shared vectors are up to date, plus the fair-price properties that matter most."""

from __future__ import annotations

import json

import pytest

from scripts import make_vectors
from uyijara.core import fair, listing, money, search, seedgen, viewing
from uyijara.core.clock import DAY_MS, civil, local_day, local_minute

RATE = money.DEFAULT_RATE


def test_vectors_file_is_up_to_date(vectors):
    fresh = json.loads(json.dumps(make_vectors.build(), ensure_ascii=False))
    assert fresh == vectors, "run: python scripts/make_vectors.py"


def _flat(**kw) -> dict:
    base = {"id": 0, "district": "chilonzor", "rooms": 2, "area": 50, "floor": 3, "floors": 9, "building": "brick",
            "renovation": "cosmetic", "furnished": 0, "price": 5_000_000, "currency": "UZS"}
    return {**base, **kw}


def _pool(prices: list[int], **kw) -> list[dict]:
    return [_flat(id=i + 1, price=p, **kw) for i, p in enumerate(prices)]


def test_median_and_outliers_do_not_poison_the_verdict():
    pool = _pool([5_000_000, 5_100_000, 4_900_000, 5_050_000, 4_950_000])
    target = _flat(id=99, price=5_000_000)
    calm = fair.evaluate(target, pool, RATE)
    assert calm["verdict"] == "fair" and calm["scope"] == "rooms" and calm["n"] == 5
    # a "luxury" fake at 40 mln and a "too good to be true" one at 900 000 are ignored
    noisy = pool + _pool([40_000_000, 900_000])
    for x, i in zip(noisy[-2:], (50, 51), strict=True):
        x["id"] = i
    rough = fair.evaluate(target, noisy, RATE)
    assert rough["n_all"] == 7 and rough["n"] == 5 and rough["expected"] == calm["expected"]


def test_fallback_rooms_then_near_then_district_then_few():
    two = _pool([5_000_000] * 3)
    three = [_flat(id=10 + i, rooms=3, area=70, price=7_000_000) for i in range(3)]
    five = [_flat(id=20 + i, rooms=5, area=120, price=12_000_000) for i in range(3)]
    target = _flat(id=99)
    assert fair.estimate(target, two + three, RATE)["scope"] == "near"
    assert fair.estimate(target, two + five, RATE)["scope"] == "district"
    assert fair.estimate(target, two, RATE)["scope"] == "few"
    few = fair.evaluate(target, two, RATE)
    assert few["verdict"] == "few" and few["pct"] is None and few["score"] == fair.FEW_SCORE
    other = [_flat(id=30 + i, district="sergeli") for i in range(9)]
    assert fair.estimate(target, other, RATE)["scope"] == "few"  # other districts never count


def test_quality_explains_the_price():
    pool = _pool([5_000_000] * 6)
    plain = fair.estimate(_flat(id=99), pool, RATE)
    better = fair.estimate(_flat(id=99, renovation="euro", furnished=1), pool, RATE)
    first = fair.estimate(_flat(id=99, floor=1), pool, RATE)
    assert better["expected"] > plain["expected"] > first["expected"]
    assert better["factors"] == [["renovation_euro", 10], ["furnished", 8]]
    assert plain["band"] == [4_500_000, 5_500_000]


def test_dollars_are_compared_in_som_but_kept_as_dollars():
    pool = _pool([5_000_000] * 5)
    usd = fair.evaluate(_flat(id=99, price=500, currency="USD"), pool, RATE)
    assert usd["price_uzs"] == 500 * RATE and usd["verdict"] == "expensive"  # 6.4 mln vs 5 mln
    assert money.parse_price("$450") == (450, "USD")
    assert money.parse_price("4,2 mln") == (4_200_000, "UZS")
    with pytest.raises(money.PriceError):
        money.parse_price(4.5)


def test_floats_are_refused_where_json_could_sneak_them_in():
    with pytest.raises(listing.ListingError):
        listing.whole(2.0, 1, 6, "rooms")
    with pytest.raises(search.SearchError):
        search.normalize({"rooms": 2.0}, {"chilonzor"})
    with pytest.raises(viewing.ViewingError):
        viewing.check_time(1.5, 0)


def test_seed_story_listings_always_have_their_verdicts(districts):
    with open("shared/data/people.json", encoding="utf-8") as fh:
        people = json.load(fh)
    start = 1_797_490_800_000  # 2026-12-17 12:00 Tashkent
    for d in range(30):  # across New Year
        w = seedgen.world(districts, people, start + d * DAY_MS)
        active = [x for x in w["listings"] if x["status"] == "active"]
        evals = fair.evaluate_all(active, RATE)
        assert evals[seedgen.STORY_EXPENSIVE]["verdict"] == "expensive"
        assert evals[seedgen.STORY_CHEAP]["verdict"] == "cheap"
        assert evals[seedgen.SUSPICIOUS]["suspicious"]
        assert len(w["listings"]) == 60 and len(active) == 59
        now = start + d * DAY_MS
        assert all(now < x["expires_at"] and x["published_at"] <= x["updated_at"] < now for x in w["listings"])
        assert all(now < s["start_at"] <= now + 3 * DAY_MS for s in w["slots"])
        for x in w["listings"]:
            listing.validate(x, {dd["id"] for dd in districts})  # every seed passes the same checks as a landlord


def test_calendar_matches_python_datetime():
    from datetime import UTC, datetime, timedelta

    for day in range(19_000, 23_000, 37):
        dt = datetime(1970, 1, 1, tzinfo=UTC) + timedelta(days=day)
        assert civil(day) == (dt.year, dt.month, dt.day)
    nye = 1_798_736_400_000
    assert civil(local_day(nye)) == (2026, 12, 31) and local_minute(nye) == 22 * 60
    tomorrow = viewing.presets(nye)[0]
    assert civil(local_day(tomorrow)) == (2027, 1, 1) and local_minute(tomorrow) == 10 * 60
