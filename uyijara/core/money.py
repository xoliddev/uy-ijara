"""Rent is a whole number of so'm or of US dollars. Floats are never used for money.

A listing keeps the currency the landlord typed and is always shown in it. For comparing listings with each other
(the fair-price check, the price filter, "cheapest first") dollars are converted to so'm at one fixed, configurable
rate. The conversion is for comparison only.
"""

from __future__ import annotations

import re

UZS, USD = "UZS", "USD"
CURRENCIES = (UZS, USD)
DEFAULT_RATE = 12_800  # so'm per dollar, fixed (set USD_RATE in .env)
LIMITS = {UZS: (300_000, 300_000_000), USD: (25, 25_000)}  # monthly rent
_DIGITS = re.compile(r"^[0-9]{1,9}$")
_GROUPED = re.compile(r"^[0-9]{1,3}(?:[.,][0-9]{3}){1,2}$")  # 4.200.000 or 4,200,000
_MLN = re.compile(r"^([0-9]{1,3})(?:[.,]([0-9]{1,2}))?(?:mln|млн|million|миллион)$")
_USD_MARKS = ("$", "usd", "dollar", "долл", "доллар")
_UZS_MARKS = ("so'm", "so‘m", "soʻm", "сум", "сўм", "som", "sum", "uzs")


class PriceError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def div_round(a: int, b: int) -> int:
    """a / b rounded half up, whole numbers only (b > 0). The JS port gives the same for every safe integer."""
    return (2 * a + b) // (2 * b)


def round_to(n: int, step: int) -> int:
    return div_round(n, step) * step


def group(n: int) -> str:
    """4200000 -> "4 200 000"."""
    sign = "-" if n < 0 else ""
    s = str(abs(n))
    parts = []
    while s:
        parts.append(s[-3:])
        s = s[:-3]
    return sign + " ".join(reversed(parts))


def to_uzs(amount: int, currency: str, rate: int) -> int:
    return amount * rate if currency == USD else amount


def from_uzs(uzs: int, currency: str, rate: int) -> int:
    """So'm -> the given currency (dollars are rounded to whole dollars)."""
    return div_round(uzs, rate) if currency == USD else uzs


def check_range(amount: int, currency: str) -> int:
    if currency not in CURRENCIES:
        raise PriceError("currency")
    lo, hi = LIMITS[currency]
    if isinstance(amount, bool) or not isinstance(amount, int) or not lo <= amount <= hi:
        raise PriceError("range")
    return amount


def parse_price(text: object, currency: str = UZS) -> tuple[int, str]:
    """ "4 200 000", "4,2 mln", "4.2 млн so'm", "$450", "450 usd" -> (amount, currency).

    A dollar sign or "usd" in the text wins over ``currency``; "mln" is only for so'm. Decimals elsewhere,
    negative numbers and amounts outside a sane monthly rent are refused.
    """
    if isinstance(text, bool):
        raise PriceError("format")
    if isinstance(text, int):
        return check_range(text, currency), currency
    s = str(text or "").strip().lower()[:40]
    for mark in _USD_MARKS:
        if mark in s:
            currency = USD
            s = s.replace(mark, "")
    for mark in _UZS_MARKS:
        if mark in s:
            currency = UZS
            s = s.replace(mark, "")
    s = s.replace(" ", "").replace("\u00a0", "").replace("\u202f", "").strip(".")
    m = _MLN.match(s)
    if m and currency == UZS:
        cents = (m.group(2) or "0").ljust(2, "0")
        value = int(m.group(1)) * 1_000_000 + int(cents) * 10_000
    elif _DIGITS.match(s):
        value = int(s)
    elif _GROUPED.match(s):
        value = int(s.replace(".", "").replace(",", ""))
    else:
        raise PriceError("format")
    return check_range(value, currency), currency
