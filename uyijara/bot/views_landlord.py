"""Landlord and admin screens as (html, rows), in the same format as views.py."""

from __future__ import annotations

from html import escape

from ..core.listing import AUDIENCES, BUILDINGS, RENOVATIONS, fmt_phone
from ..i18n import Raw, band_money, date_label, district_name, money, signed, slot_label, t, title, verdict_line
from .views import Screen, back, grid, pick_district, pick_rooms


def home(lang: str, active: int, pending: int) -> Screen:
    rows = [[(t(lang, "btn.my_listings"), "n:my"), (t(lang, "btn.new_listing"), "n:new")],
            [(t(lang, "btn.requests") + (f" ({pending})" if pending else ""), "n:requests")]]
    return t(lang, "landlord.home", active=active, pending=pending), [*rows, back(lang, "n:menu")]


def status_word(lang: str, x: dict) -> str:
    if x.get("hidden"):
        return t(lang, "card.status_hidden")
    if x["status"] == "paused":
        return t(lang, "card.status_paused")
    if x["status"] == "expired":
        return t(lang, "card.status_expired")
    return verdict_line(lang, x["eval"]) or t(lang, "verdict.few")


def my_list(lang: str, items: list[dict], dmap: dict) -> Screen:
    if not items:
        return t(lang, "landlord.none"), [[(t(lang, "btn.new_listing"), "n:new")], back(lang, "n:landlord")]
    lines = [t(lang, "landlord.list")]
    rows = []
    for i, x in enumerate(items, 1):
        district = district_name(lang, x["district"], dmap)
        lines.append(f"{i}. " + t(lang, "landlord.line", title=title(lang, x), district=district,
                                  price=money(lang, x["price"], x["currency"]), status=status_word(lang, x)))
        rows.append([(f"{i}. {title(lang, x)} · {money(lang, x['price'], x['currency'])}", f"ml:{x['id']}")])
    return "\n".join(lines), [*rows, [(t(lang, "btn.new_listing"), "n:new")], back(lang, "n:landlord")]


def band_lines(lang: str, ev: dict | None, price: int | None, currency: str, rate: int) -> str:
    if not ev or not ev.get("band"):
        return t(lang, "fair.no_band")
    lo, hi = band_money(lang, ev["band"], currency, rate)
    out = t(lang, "fair.suggest", lo=lo, hi=hi)
    if price is not None and ev.get("pct") is not None:
        out += "\n" + t(lang, "fair.your_price", price=money(lang, price, currency),
                        verdict=t(lang, f"verdict.{ev['verdict']}"), pct=signed(ev["pct"]))
    return out


def manage(lang: str, x: dict, now: int, dmap: dict, rate: int) -> Screen:
    head = (f"<b>{title(lang, x)}, {district_name(lang, x['district'], dmap)}</b> — "
            f"{money(lang, x['price'], x['currency'])}\n{status_word(lang, x)}")
    lines = [head, band_lines(lang, x["eval"], x["price"], x["currency"], rate),
             t(lang, "card.expires", date=date_label(lang, x["expires_at"]))]
    if x.get("slots"):
        lines.append(t(lang, "card.slots") + " " + ", ".join(slot_label(lang, s["start_at"], now) for s in x["slots"]))
    lid = x["id"]
    rows = [[(t(lang, "btn.edit_price"), f"ma:{lid}:price"), (t(lang, "btn.slots"), f"ma:{lid}:slots")]]
    if x["status"] == "active":
        rows.append([(t(lang, "btn.pause"), f"ma:{lid}:pause")])
    elif x["status"] == "paused":
        rows.append([(t(lang, "btn.resume"), f"ma:{lid}:resume")])
    rows.append([(t(lang, "btn.renew"), f"ma:{lid}:renew")])
    if x.get("pending"):
        rows.append([(f"{t(lang, 'btn.requests')} ({x['pending']})", "n:requests")])
    return "\n\n".join(lines), [*rows, back(lang, "n:my")]


def slot_times(lang: str, lid: int, times: list[int], taken: set[int], now: int) -> Screen:
    buttons = [(("✓ " if s in taken else "") + slot_label(lang, s, now), f"ms:{lid}:{i}") for i, s in enumerate(times)]
    return t(lang, "landlord.slots"), [*grid(buttons, 2), back(lang, f"ml:{lid}")]


def requests(lang: str, items: list[dict], now: int, dmap: dict) -> Screen:
    if not items:
        return t(lang, "landlord.no_requests"), [back(lang, "n:landlord")]
    lines, rows = [t(lang, "landlord.requests")], []
    for v in items:
        x = v["listing"]
        when = slot_label(lang, v["start_at"], now)
        lines.append(t(lang, "landlord.request_line", tenant=v["tenant_name"], title=title(lang, x),
                       district=district_name(lang, x["district"], dmap), when=when,
                       status=t(lang, f"view.status.{v['status']}")))
        if v["contact"]:
            lines.append(t(lang, "notify.accepted_landlord", when=when, name=v["contact"]["name"],
                           phone=fmt_phone(v["contact"]["phone"]) if v["contact"]["phone"] else "—"))
        if v["status"] == "pending":
            rows.append([(f"{t(lang, 'btn.accept')}: {v['tenant_name']}, {when}", f"v:{v['id']}:y"),
                         (t(lang, "btn.decline"), f"v:{v['id']}:n")])
    return "\n\n".join(lines), [*rows, back(lang, "n:landlord")]


# ── the new-listing wizard ──
def new_district(lang: str, districts: list[dict]) -> Screen:
    return pick_district(lang, districts, "nw:d", "new.district", "n:landlord", any_=False)


def new_rooms(lang: str) -> Screen:
    return pick_rooms(lang, "nw:r", "new.rooms", "nw:back:d", any_=False, top=6)


def ask(lang: str, key: str, back_to: str) -> Screen:
    return t(lang, key), [back(lang, back_to)]


def new_building(lang: str) -> Screen:
    rows = grid([(t(lang, f"building.{b}"), f"nw:b:{b}") for b in BUILDINGS], 2)
    return t(lang, "new.building"), [*rows, back(lang, "nw:back:floor")]


def new_renovation(lang: str) -> Screen:
    rows = grid([(t(lang, f"renovation.{r}"), f"nw:o:{r}") for r in RENOVATIONS], 2)
    return t(lang, "new.renovation"), [*rows, back(lang, "nw:back:b")]


def new_extras(lang: str, d: dict) -> Screen:
    tick = "✓ "
    aud = AUDIENCES.index(d["audience"])
    rows = [[((tick if d["furnished"] else "") + t(lang, "btn.furnished"), "nw:f:1"),
             ((tick if d["pets"] else "") + t(lang, "btn.pets"), "nw:p:1")],
            [(f"{t(lang, 'audience.title')}: {t(lang, f'audience.{d['audience']}')}",
              f"nw:a:{(aud + 1) % len(AUDIENCES)}")],
            [(t(lang, "btn.next"), "nw:go:0")]]
    return t(lang, "new.extras"), [*rows, back(lang, "nw:back:o")]


def new_preview(lang: str, d: dict, ev: dict, dmap: dict, rate: int) -> Screen:
    summary = (f"<b>{title(lang, d)}, {district_name(lang, d['district'], dmap)}</b>\n{d['area']} m² · "
               f"{d['floor']}/{d['floors']} · {t(lang, f'building.{d['building']}')} · "
               f"{t(lang, f'renovation.{d['renovation']}')}\n{escape(d['address'])}\n"
               f"<b>{money(lang, d['price'], d['currency'])}</b>")
    band = band_lines(lang, ev, None, d["currency"], rate)
    yours = ""
    if ev.get("pct") is not None:
        yours = t(lang, "fair.your_price", price=money(lang, d["price"], d["currency"]),
                  verdict=t(lang, f"verdict.{ev['verdict']}"), pct=signed(ev["pct"]))
    rows = [[(t(lang, "btn.publish"), "nw:pub:0")], [(t(lang, "btn.edit_price"), "nw:back:price")]]
    return t(lang, "new.preview", summary=Raw(summary), band=Raw(band), yours=Raw(yours)), \
        [*rows, back(lang, "nw:back:address")]


# ── admin ──
def reports(lang: str, items: list[dict], listings: dict[int, dict], dmap: dict) -> Screen:
    if not items:
        return t(lang, "admin.none"), [back(lang, "n:menu")]
    lines, rows = [t(lang, "admin.reports")], []
    for r in items:
        x = listings[r["listing_id"]]
        reasons = ", ".join(t(lang, f"report.{k}") for k in sorted(set(r["reasons"].split(","))))
        lines.append(t(lang, "admin.line", id=x["id"], title=title(lang, x),
                       district=district_name(lang, x["district"], dmap), n=r["n"], reasons=reasons))
        rows.append([(f"#{x['id']} {t(lang, 'btn.remove_listing')}", f"ad:{x['id']}:r"),
                     (t(lang, "btn.dismiss"), f"ad:{x['id']}:d")])
    return "\n\n".join(lines), [*rows, back(lang, "n:menu")]
