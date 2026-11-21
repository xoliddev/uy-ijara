"""Landlord side: panel, own listings (pause / resume / renew / price), viewing times, incoming requests, the
new-listing wizard with the suggested-price band before publishing; and the admin's report queue."""

from __future__ import annotations

import secrets

from aiogram import F, Router
from aiogram.filters import StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from ..common import Refused
from ..core.listing import AUDIENCES, BUILDINGS, RENOVATIONS, ListingError, parse_floor, whole
from ..core.money import PriceError, parse_price
from ..core.viewing import presets
from ..i18n import date_label, plain, t
from . import views_landlord as lv
from .cb import Act, Flow, Mine, Mod, Nav, New, Tm, Vw
from .setup import show

router = Router(name="landlord")
TYPED = F.text & ~F.text.startswith("/")
BACKS = {"d", "r", "area", "floor", "b", "o", "x", "address", "price"}


async def home(event, svc, me: int, lang: str, cfg) -> None:
    mine = await svc.my_listings(me)
    active = sum(1 for x in mine if x["status"] == "active")
    await show(event, lv.home(lang, active, sum(x["pending"] for x in mine)), cfg)


@router.callback_query(Nav.filter(F.to == "landlord"))
async def nav_home(cq: CallbackQuery, state: FSMContext, svc, me, lang, cfg) -> None:
    await state.clear()
    await home(cq, svc, me, lang, cfg)


@router.callback_query(Nav.filter(F.to == "my"))
async def nav_my(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await show(cq, lv.my_list(lang, await svc.my_listings(me), svc.dmap), cfg)


async def manage_screen(event, svc, me: int, lang: str, cfg, lid: int) -> None:
    item = next((x for x in await svc.my_listings(me) if x["id"] == lid), None)
    if item is None:
        raise Refused("not_found")
    await show(event, lv.manage(lang, item, svc.now(), svc.dmap, svc.rate), cfg)


@router.callback_query(Mine.filter(F.id > 0))
async def manage(cq: CallbackQuery, callback_data: Mine, state: FSMContext, svc, me, lang, cfg) -> None:
    await state.clear()
    await manage_screen(cq, svc, me, lang, cfg, callback_data.id)


async def slots_screen(event, svc, me: int, lang: str, cfg, lid: int) -> None:
    await svc.owned(me, lid)
    taken = {s["start_at"] for s in await svc.open_slots(lid)}
    await show(event, lv.slot_times(lang, lid, presets(svc.now()), taken, svc.now()), cfg)


@router.callback_query(Act.filter((F.id > 0) & F.a.in_({"pause", "resume", "renew", "price", "slots"})))
async def listing_action(cq: CallbackQuery, callback_data: Act, state: FSMContext, svc, me, lang, cfg) -> None:
    lid, a = callback_data.id, callback_data.a
    if a == "price":
        await svc.owned(me, lid)
        await state.set_state(Flow.edit_price)
        await state.update_data(lid=lid)
        await show(cq, lv.ask(lang, "landlord.price_ask", f"ml:{lid}"), cfg)
        return
    if a == "slots":
        await slots_screen(cq, svc, me, lang, cfg, lid)
        return
    x = await svc.set_status(me, lid, a)
    note = {"pause": t(lang, "landlord.paused"), "resume": t(lang, "landlord.resumed"),
            "renew": t(lang, "landlord.renewed", date=date_label(lang, x["expires_at"]))}[a]
    await cq.answer(plain(note), show_alert=True)
    await manage_screen(cq, svc, me, lang, cfg, lid)


@router.callback_query(Tm.filter((F.id > 0) & (F.i >= 0) & (F.i < 6)))
async def toggle_time(cq: CallbackQuery, callback_data: Tm, svc, me, lang, cfg) -> None:
    lid = callback_data.id
    start = presets(svc.now())[callback_data.i]
    current = {s["start_at"]: s["id"] for s in await svc.open_slots(lid)}
    if start in current:
        await svc.remove_slot(me, lid, current[start])
    else:
        await svc.add_slot(me, lid, start)
    await slots_screen(cq, svc, me, lang, cfg, lid)


@router.message(StateFilter(Flow.edit_price), TYPED)
async def typed_new_price(message: Message, state: FSMContext, svc, me, lang, cfg) -> None:
    lid = (await state.get_data())["lid"]
    x = await svc.owned(me, lid)
    try:
        price, currency = parse_price(message.text, x["currency"])
    except PriceError as err:
        raise Refused("price") from err
    await svc.update_listing(me, lid, {"price": price, "currency": currency})
    await state.clear()
    await manage_screen(message, svc, me, lang, cfg, lid)


@router.callback_query(Nav.filter(F.to == "requests"))
async def nav_requests(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await show(cq, lv.requests(lang, await svc.incoming(me), svc.now(), svc.dmap), cfg)


@router.callback_query(Vw.filter((F.id > 0) & F.a.in_({"y", "n"})))
async def decide(cq: CallbackQuery, callback_data: Vw, svc, me, lang, cfg, notifier) -> None:
    v = await svc.decide(me, callback_data.id, callback_data.a == "y")
    await notifier.decided(v)
    await show(cq, lv.requests(lang, await svc.incoming(me), svc.now(), svc.dmap), cfg)


# ── the new-listing wizard; the draft lives in the FSM data until "E'lon qilish" ──
async def start_new(event, state: FSMContext, svc, me: int, lang: str, cfg) -> None:
    await state.set_state(None)
    await state.update_data(draft={"furnished": 0, "pets": 0, "audience": "any", "amenities": [], "note": ""})
    await show(event, lv.new_district(lang, svc.districts), cfg)


@router.callback_query(Nav.filter(F.to == "new"))
async def nav_new(cq: CallbackQuery, state: FSMContext, svc, me, user, lang, cfg) -> None:
    if not user["phone"]:
        from .handlers_main import ask_phone

        await ask_phone(cq, state, lang, "new", "phone.ask_landlord")
        return
    await start_new(cq, state, svc, me, lang, cfg)


async def step(event, state: FSMContext, svc, lang: str, cfg, name: str) -> None:
    """Show one wizard step (also used by the Back buttons)."""
    d = (await state.get_data()).get("draft") or {}
    asks = {"area": (Flow.new_area, "new.area", "nw:back:r"), "floor": (Flow.new_floor, "new.floor", "nw:back:area"),
            "address": (Flow.new_address, "new.address", "nw:back:x"),
            "price": (Flow.new_price, "new.price", "nw:back:address")}
    if name in asks:
        st, key, back_to = asks[name]
        await state.set_state(st)
        await show(event, lv.ask(lang, key, back_to), cfg)
        return
    await state.set_state(None)
    screens = {"d": lambda: lv.new_district(lang, svc.districts), "r": lambda: lv.new_rooms(lang),
               "b": lambda: lv.new_building(lang), "o": lambda: lv.new_renovation(lang),
               "x": lambda: lv.new_extras(lang, d)}
    await show(event, screens[name](), cfg)


@router.callback_query(New.filter(F.k.in_({"d", "r", "b", "o", "f", "p", "a", "go", "pub", "back"})))
async def wizard(cq: CallbackQuery, callback_data: New, state: FSMContext, svc, me, lang, cfg) -> None:
    data = await state.get_data()
    d = data.get("draft")
    k, v = callback_data.k, callback_data.v
    if d is None:
        raise Refused("stale")  # the draft is gone (restart): start again from the panel
    if k == "d" and v in svc.dmap:
        d["district"] = v
        nxt = "r"
    elif k == "r" and v in {"1", "2", "3", "4", "5", "6"}:
        d["rooms"] = int(v)
        nxt = "area"
    elif k == "b" and v in BUILDINGS:
        d["building"] = v
        nxt = "o"
    elif k == "o" and v in RENOVATIONS:
        d["renovation"] = v
        nxt = "x"
    elif k in ("f", "p") and v == "1":
        key = "furnished" if k == "f" else "pets"
        d[key] = 1 - d.get(key, 0)
        nxt = "x"
    elif k == "a" and v.isdigit() and int(v) < len(AUDIENCES):
        d["audience"] = AUDIENCES[int(v)]
        nxt = "x"
    elif k == "go":
        nxt = "address"
    elif k == "back" and v in BACKS:
        nxt = v
    elif k == "pub":
        await publish(cq, state, svc, me, lang, cfg, d)
        return
    else:
        raise Refused("stale")
    await state.update_data(draft=d)
    await step(cq, state, svc, lang, cfg, nxt)


@router.message(StateFilter(Flow.new_area, Flow.new_floor, Flow.new_address, Flow.new_price), TYPED)
async def typed_step(message: Message, state: FSMContext, svc, me, lang, cfg) -> None:
    current = await state.get_state()
    d = (await state.get_data()).get("draft") or {}
    text = message.text.strip()
    try:
        if current == Flow.new_area.state:
            d["area"] = whole(text, 12, 400, "area")
            nxt = "floor"
        elif current == Flow.new_floor.state:
            d["floor"], d["floors"] = parse_floor(text)
            nxt = "b"
        elif current == Flow.new_address.state:
            d["address"] = text[:120]
            if len(d["address"]) < 5:
                raise ListingError("address")
            nxt = "price"
        else:
            d["price"], d["currency"] = parse_price(text)
            nxt = "preview"
    except ListingError as err:
        raise Refused(f"l_{err.code}") from err
    except PriceError as err:
        raise Refused("price") from err
    await state.update_data(draft=d)
    if nxt != "preview":
        await step(message, state, svc, lang, cfg, nxt)
        return
    await state.set_state(None)
    ev = await svc.preview(me, d)
    await show(message, lv.new_preview(lang, d, ev, svc.dmap, svc.rate), cfg)


async def publish(cq: CallbackQuery, state: FSMContext, svc, me: int, lang: str, cfg, d: dict) -> None:
    created = await svc.create_listing(me, {**d, "photo_seed": 1 + secrets.randbelow(9999)})
    await state.clear()
    await cq.answer(plain(t(lang, "new.published")), show_alert=True)
    await slots_screen(cq, svc, me, lang, cfg, created["id"])


# ── admin: reports ──
@router.callback_query(Nav.filter(F.to == "reports"))
async def nav_reports(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    items = await svc.open_reports(me)
    rows = {r["listing_id"]: await svc.listing_row(r["listing_id"]) for r in items}
    await show(cq, lv.reports(lang, items, rows, svc.dmap), cfg)


@router.callback_query(Mod.filter((F.id > 0) & F.a.in_({"r", "d"})))
async def moderate(cq: CallbackQuery, callback_data: Mod, svc, me, lang, cfg) -> None:
    await svc.moderate(me, callback_data.id, callback_data.a == "r")
    await cq.answer(plain(t(lang, "admin.removed" if callback_data.a == "r" else "admin.dismissed")), show_alert=True)
    await nav_reports(cq, svc, me, lang, cfg)
