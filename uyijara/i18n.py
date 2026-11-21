"""Texts for the bot, read from shared/locales/*.json (the Mini App and the browser demo read the same files),
plus the formatters every screen needs: rent in its own currency, the fair-price sentence, slot times, "5 min ago".
shared/i18n.js is the same code for the browser."""

from __future__ import annotations

import html
import json
import re
from functools import cache
from pathlib import Path

from .common import norm_lang
from .core.clock import civil, hhmm, local_day, local_minute, weekday
from .core.money import USD, from_uzs, group, round_to

LOCALE_DIR = Path(__file__).resolve().parent.parent / "shared" / "locales"
_PLACEHOLDER = re.compile(r"\{(\w+)\}")
DOTS = {"cheap": "🟢", "fair": "🔵", "expensive": "🔴", "few": "⚪", "suspicious": "⚠️"}


def shown_verdict(ev: dict) -> str:
    """The verdict to show: a far-too-cheap rent is a warning, not a green deal."""
    return "suspicious" if ev.get("suspicious") else ev["verdict"]
MINUS = "−"


class Raw(str):
    """A parameter that is already safe HTML (for example a nested, already-rendered text)."""


@cache
def catalog(lang: str) -> dict[str, str]:
    with open(LOCALE_DIR / f"{lang}.json", encoding="utf-8") as fh:
        return json.load(fh)


def render(template: str, params: dict) -> str:
    def sub(m: re.Match) -> str:
        if m.group(1) not in params:
            return m.group(0)
        value = params[m.group(1)]
        return value if isinstance(value, Raw) else html.escape(str(value), quote=False)

    return _PLACEHOLDER.sub(sub, template)


def t(lang: str, key: str, **params: object) -> str:
    """Localized text; parameters are HTML-escaped unless wrapped in ``Raw``."""
    lang = norm_lang(lang)
    template = catalog(lang).get(key) or catalog("uz").get(key) or key
    return render(template, params)


def plain(text: str) -> str:
    """For callback alerts, which show plain text."""
    return html.unescape(re.sub(r"<[^>]+>", "", text))


def money(lang: str, amount: int, currency: str) -> str:
    return t(lang, "fmt.usd" if currency == USD else "fmt.uzs", n=group(amount))


def in_currency(uzs: int, currency: str, rate: int) -> int:
    """A so'm amount shown in the listing's own currency (dollars rounded to 10)."""
    return round_to(from_uzs(uzs, currency, rate), 10) if currency == USD else uzs


def signed(pct: int) -> str:
    return f"+{pct}%" if pct > 0 else f"{MINUS}{-pct}%" if pct < 0 else "0%"


def title(lang: str, x: dict) -> str:
    return t(lang, "title.house" if x["building"] == "house" else "title.flat", rooms=x["rooms"])


def district_name(lang: str, did: str, dmap: dict) -> str:
    return dmap[did]["name"][norm_lang(lang)]


def verdict_line(lang: str, ev: dict | None) -> str:
    """ "🟢 Arzon −26%" — the verdict as a short tag."""
    if not ev:
        return ""
    v = shown_verdict(ev)
    return f"{DOTS[v]} {t(lang, f'verdict.{v}')}" + (f" {signed(ev['pct'])}" if ev["pct"] is not None else "")


def fair_text(lang: str, x: dict, ev: dict, dmap: dict, rate: int) -> str:
    """The explanation: which comparables, their average for a home like this, and how far this rent is from it."""
    district = district_name(lang, x["district"], dmap)
    if ev["verdict"] == "few":
        return t(lang, "fair.few", district=district, n=ev["n"])
    expected = money(lang, in_currency(round_to(ev["expected"], 10_000), x["currency"], rate), x["currency"])
    scope = t(lang, f"fair.scope_{ev['scope']}", district=district, n=ev["n"], rooms=x["rooms"], lo=ev["rooms_lo"],
              hi=ev["rooms_hi"], expected=expected)
    pct = ev["pct"]
    if ev["verdict"] == "fair":
        tail = t(lang, "fair.pct_fair", pct=signed(pct))
    else:
        tail = t(lang, f"fair.pct_{ev['verdict']}", pct=abs(pct))
    out = f"{scope} {tail}"
    if ev.get("suspicious"):
        out += "\n" + t(lang, "fair.suspicious")
    return out


def factors_text(lang: str, factors: list) -> str:
    return ", ".join(f"{t(lang, f'factor.{k}')} {signed(p)}" for k, p in factors)


def band_money(lang: str, band: list[int], currency: str, rate: int) -> tuple[str, str]:
    lo, hi = (money(lang, in_currency(b, currency, rate), currency) for b in band)
    return lo, hi


def band_text(lang: str, band: list[int], currency: str, rate: int) -> str:
    return " – ".join(band_money(lang, band, currency, rate))


def date_label(lang: str, ms: int) -> str:
    _, month, day = civil(local_day(ms))
    return f"{day}-{t(lang, f'month.{month}')}" if norm_lang(lang) == "uz" else f"{day} {t(lang, f'month.{month}')}"


def slot_label(lang: str, start: int, now: int) -> str:
    """ "Ertaga, 10:00", "Bugun, 18:00" or "Juma, 18-dekabr, 14:00" in Tashkent time."""
    day, today = local_day(start), local_day(now)
    time = hhmm(local_minute(start))
    if day == today:
        return t(lang, "slot.today", time=time)
    if day == today + 1:
        return t(lang, "slot.tomorrow", time=time)
    _, month, d = civil(day)
    return t(lang, "slot.date", wd=t(lang, f"wd.{weekday(day)}"), d=d, month=t(lang, f"month.{month}"), time=time)


def ago(lang: str, then_ms: int, now_ms: int) -> str:
    minutes = max(0, (now_ms - then_ms) // 60_000)
    if minutes < 1:
        return t(lang, "ago.now")
    if minutes < 60:
        return t(lang, "ago.min", n=minutes)
    if minutes < 1440:
        return t(lang, "ago.hour", n=minutes // 60)
    return t(lang, "ago.day", n=minutes // 1440)
