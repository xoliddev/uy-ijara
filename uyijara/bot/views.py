"""Tenant screens as (html, rows). A row is a list of (label, callback data); "@app" / "@app#l=5" is the Mini App
button. Pure functions of data, so tests are simple and demo/bot-views.js can port them line by line."""

from __future__ import annotations

from html import escape

from ..core.listing import fmt_phone
from ..core.search import AREA_FILTERS, AUD_FILTERS, BUDGETS, SORTS
from ..i18n import ago, band_money, district_name, factors_text, fair_text, money, slot_label, t, title, verdict_line
from .cb import PAGE

Screen = tuple[str, list[list[tuple[str, str]]]]


def back(lang: str, data: str) -> list[tuple[str, str]]:
    return [(t(lang, "btn.back"), data)]


def main_menu(lang: str, user: dict, has_app: bool, hello: bool = False) -> Screen:
    rows = [[(t(lang, "btn.search"), "n:search")],
            [(t(lang, "btn.saved"), "n:saved"), (t(lang, "btn.viewings"), "n:viewings")],
            [(t(lang, "btn.landlord"), "n:landlord")]]
    if has_app:
        rows.append([(t(lang, "btn.app"), "@app")])
    if user.get("admin"):
        rows.append([(t(lang, "btn.reports"), "n:reports")])
    rows.append([(t(lang, "btn.lang"), "n:lang")])
    return t(lang, "start.hello" if hello else "start.menu"), rows


def grid(buttons: list[tuple[str, str]], per_row: int) -> list[list[tuple[str, str]]]:
    return [buttons[i:i + per_row] for i in range(0, len(buttons), per_row)]


def pick_district(lang: str, districts: list[dict], prefix: str, ask: str, back_to: str, any_: bool = True) -> Screen:
    buttons = [(d["name"][lang], f"{prefix}:{d['id']}") for d in districts]
    rows = grid(buttons, 3)
    if any_:
        rows.append([(t(lang, "district.any"), f"{prefix}:-")])
    return t(lang, ask), [*rows, back(lang, back_to)]


def rooms_label(lang: str, n: int) -> str:
    return t(lang, "rooms.4") if n >= 4 else t(lang, "rooms.n", n=n)


def pick_rooms(lang: str, prefix: str, ask: str, back_to: str, any_: bool = True, top: int = 4) -> Screen:
    rows = [[(rooms_label(lang, n) if top == 4 else str(n), f"{prefix}:{n}") for n in range(1, top + 1)]]
    if any_:
        rows.append([(t(lang, "btn.any"), f"{prefix}:0")])
    return t(lang, ask), [*rows, back(lang, back_to)]


def pick_budget(lang: str, f: dict) -> Screen:
    rows = grid([(t(lang, f"budget.{i}"), f"w:b:{i}") for i in range(1, len(BUDGETS))], 3)
    rows.append([(t(lang, "budget.0"), "w:b:0")])
    return t(lang, "search.budget"), [*rows, back(lang, f"w:d:{f['district'] or '-'}")]


def budget_index(f: dict) -> int | None:
    if f["currency"] != "UZS":
        return None
    pair = (f["price_min"], f["price_max"])
    return next((i for i, b in enumerate(BUDGETS) if b == pair), None)


def summary(lang: str, f: dict, dmap: dict) -> str:
    parts = [district_name(lang, f["district"], dmap) if f["district"] else t(lang, "district.any")]
    if f["rooms"]:
        parts.append(rooms_label(lang, f["rooms"]))
    b = budget_index(f)
    if b:
        parts.append(t(lang, f"budget.{b}"))
    elif b is None and f["price_max"]:
        parts.append(f"≤ {money(lang, f['price_max'], f['currency'])}")
    if f["furnished"]:
        parts.append(t(lang, "btn.furnished").lower())
    if f["pets"]:
        parts.append(t(lang, "btn.pets").lower())
    if f["audience"]:
        parts.append(t(lang, f"audience.{f['audience']}").lower())
    if f["min_area"]:
        parts.append(t(lang, "area.n", n=f["min_area"]))
    if f["q"]:
        parts.append(f"«{escape(f['q'])}»")
    return " · ".join(parts)


def line(lang: str, n: int, x: dict, dmap: dict) -> str:
    ev = x["eval"]
    head = f"<b>{n}.</b> {verdict_line(lang, ev)}" if ev else f"<b>{n}.</b>"
    return (f"{head} · {title(lang, x)}, {district_name(lang, x['district'], dmap)}\n"
            f"{x['area']} m² · {x['floor']}/{x['floors']} · <b>{money(lang, x['price'], x['currency'])}</b>")


def results(lang: str, f: dict, items: list[dict], total: int, page: int, dmap: dict) -> Screen:
    if not total:
        return (f"{summary(lang, f, dmap)}\n\n{t(lang, 'search.none')}",
                [[(t(lang, "btn.filters"), "f:x:0"), (t(lang, "btn.save_search"), "n:save")], back(lang, "n:search")])
    start = page * PAGE
    shown = items[start:start + PAGE]
    head = t(lang, "search.results", n=total, shown=t(lang, "search.shown", n=len(shown)) if total > PAGE else "",
             sort=t(lang, f"btn.sort_{f['sort']}"))
    text = "\n\n".join([f"{summary(lang, f, dmap)}\n{head}", *(line(lang, start + i + 1, x, dmap)
                                                                for i, x in enumerate(shown))])
    rows = [[(f"{start + i + 1}. {money(lang, x['price'], x['currency'])} · {x['area']} m²", f"l:{x['id']}")]
            for i, x in enumerate(shown)]
    mark = {s: "• " if f["sort"] == s else "" for s in SORTS}
    rows.append([(mark[s] + t(lang, f"btn.sort_{s}"), f"f:s:{i}") for i, s in enumerate(SORTS)])
    if start + PAGE < len(items):
        rows.append([(t(lang, "btn.more"), f"f:g:{page + 1}")])
    rows.append([(t(lang, "btn.filters"), "f:x:0"), (t(lang, "btn.save_search"), "n:save")])
    return text, [*rows, back(lang, "n:search")]


def filters(lang: str, f: dict) -> Screen:
    tick = "✓ "
    aud = AUD_FILTERS.index(f["audience"])
    area = AREA_FILTERS.index(f["min_area"]) if f["min_area"] in AREA_FILTERS else 0
    rows = [[((tick if f["furnished"] else "") + t(lang, "btn.furnished"), f"f:m:{1 - f['furnished']}"),
             ((tick if f["pets"] else "") + t(lang, "btn.pets"), f"f:p:{1 - f['pets']}")],
            [(f"{t(lang, 'audience.title')}: {t(lang, f'audience.{f['audience'] or 'any'}')}",
              f"f:a:{(aud + 1) % len(AUD_FILTERS)}")],
            [(t(lang, f"area.{'n' if AREA_FILTERS[area] else '0'}", n=AREA_FILTERS[area]),
              f"f:z:{(area + 1) % len(AREA_FILTERS)}")],
            [(t(lang, "btn.show_results"), "f:g:0")]]
    return t(lang, "search.filters"), [*rows, back(lang, "f:g:0")]


def facts(lang: str, x: dict) -> str:
    amen = ", ".join(t(lang, f"amenity.{a}") for a in x["amenities"]) or "—"
    yes, no = t(lang, "card.yes"), t(lang, "card.no")
    return "\n".join([
        f"{t(lang, 'card.area')}: {x['area']} m² · {t(lang, 'card.floor')}: {x['floor']}/{x['floors']} · "
        f"{t(lang, 'card.building')}: {t(lang, f'building.{x['building']}')}",
        f"{t(lang, 'card.renovation')}: {t(lang, f'renovation.{x['renovation']}')} · "
        f"{t(lang, 'card.furnished')}: {yes if x['furnished'] else no} · "
        f"{t(lang, 'card.pets')}: {t(lang, 'card.pets_yes' if x['pets'] else 'card.pets_no')}",
        f"{t(lang, 'audience.title')}: {t(lang, f'audience.{x['audience']}')} · {t(lang, 'card.amenities')}: {amen}"])


def verdict_block(lang: str, x: dict, dmap: dict, rate: int) -> str:
    ev = x["eval"]
    out = [f"<b>{verdict_line(lang, ev)}</b> — {t(lang, 'verdict.title')}", fair_text(lang, x, ev, dmap, rate)]
    if ev["factors"]:
        out.append(f"{t(lang, 'fair.factors')} {factors_text(lang, ev['factors'])}")
    if ev["band"]:
        lo, hi = band_money(lang, ev["band"], x["currency"], rate)
        out.append(t(lang, "fair.band", lo=lo, hi=hi))
    return "\n".join(out)


def card(lang: str, x: dict, now: int, dmap: dict, rate: int, has_app: bool) -> Screen:
    head = f"<b>{title(lang, x)}, {district_name(lang, x['district'], dmap)}</b>\n" \
           f"<b>{money(lang, x['price'], x['currency'])}</b> {t(lang, 'fmt.per_month')}"
    parts = [head, verdict_block(lang, x, dmap, rate), facts(lang, x)]
    if x["note"]:
        parts.append(f"{t(lang, 'card.note')}: {escape(x['note'])}")
    who = t(lang, "card.landlord", name=x["landlord_name"]) if x["landlord_name"] else ""
    parts.append(" · ".join(p for p in (who, t(lang, "card.updated", ago=ago(lang, x["updated_at"], now))) if p))
    mine = x.get("my_viewing")
    if mine:
        parts.append(t(lang, "card.my_request", when=slot_label(lang, mine["start_at"], now),
                       status=t(lang, f"view.status.{mine['status']}")))
    if x.get("contact"):
        c = x["contact"]
        parts.append(t(lang, "card.contact", address=c["address"], phone=fmt_phone(c["phone"]) if c["phone"] else "—"))
    else:
        parts.append(f"<i>{t(lang, 'card.location')}</i>")
    rows = []
    if x.get("own"):
        rows.append([(t(lang, "btn.landlord"), f"ml:{x['id']}")])
    elif mine:
        rows.append([(t(lang, "btn.cancel"), f"v:{mine['id']}:c")])
    elif x["slots"]:
        rows.append([(t(lang, "btn.request"), f"q:{x['id']}")])
    else:
        parts.append(t(lang, "card.no_slots"))
    if has_app:
        rows.append([(t(lang, "app.open_map"), f"@app#l={x['id']}")])
    if not x.get("own"):
        rows.append([(t(lang, "btn.report"), f"rp:{x['id']}:0")])
    return "\n\n".join(parts), [*rows, back(lang, "f:g:0")]


def slots(lang: str, x: dict, now: int) -> Screen:
    rows = grid([(slot_label(lang, s["start_at"], now), f"t:{s['id']}") for s in x["slots"]], 2)
    return t(lang, "view.ask"), [*rows, back(lang, f"l:{x['id']}")]


def sent(lang: str, v: dict, now: int) -> Screen:
    return (t(lang, "view.sent", when=slot_label(lang, v["start_at"], now)),
            [[(t(lang, "btn.viewings"), "n:viewings")], back(lang, f"l:{v['listing_id']}")])


def report_ask(lang: str, lid: int) -> Screen:
    rows = [[(t(lang, f"report.{r}"), f"rp:{lid}:{i}")] for i, r in enumerate(("scam", "price", "rented", "other"), 1)]
    return t(lang, "report.ask"), [*rows, back(lang, f"l:{lid}")]


def viewings(lang: str, items: list[dict], now: int, dmap: dict) -> Screen:
    if not items:
        return t(lang, "view.none"), [back(lang, "n:menu")]
    lines, rows = [t(lang, "view.mine")], []
    for v in items:
        x = v["listing"]
        lines.append(t(lang, "view.line", title=title(lang, x), district=district_name(lang, x["district"], dmap),
                       when=slot_label(lang, v["start_at"], now), status=t(lang, f"view.status.{v['status']}")))
        if v["contact"]:
            lines.append(t(lang, "card.contact", address=v["contact"]["address"],
                           phone=fmt_phone(v["contact"]["phone"]) if v["contact"]["phone"] else "—"))
        if v["status"] in ("pending", "accepted"):
            rows.append([(f"{title(lang, x)} · {slot_label(lang, v['start_at'], now)}", f"l:{x['id']}"),
                         (t(lang, "btn.cancel"), f"v:{v['id']}:c")])
    return "\n\n".join(lines), [*rows, back(lang, "n:menu")]


def subs(lang: str, items: list[dict], dmap: dict) -> Screen:
    if not items:
        return t(lang, "search.subs_none"), [back(lang, "n:menu")]
    lines = [t(lang, "search.subs")] + [f"{i}. {summary(lang, s['filter'], dmap)}" for i, s in enumerate(items, 1)]
    rows = [[(f"{i}. {t(lang, 'btn.delete')}", f"sd:{s['id']}")] for i, s in enumerate(items, 1)]
    return "\n".join(lines), [*rows, back(lang, "n:menu")]
