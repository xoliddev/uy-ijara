"""Tenant side: the search wizard (district -> rooms -> budget), results with sort and filters, a listing's card
with its fair-price verdict, viewing requests, reports, my viewings and saved searches."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery

from ..common import Refused
from ..core.search import AREA_FILTERS, AUD_FILTERS, BUDGETS, SORTS
from ..i18n import plain, t
from . import views
from .cb import Flt, Lst, Nav, Rep, Req, Slot, Sub, Vw, Wiz
from .setup import show

router = Router(name="tenant")
REASONS = ("scam", "price", "rented", "other")


async def results_screen(event, svc, me: int, lang: str, cfg, f: dict | None = None, page: int = 0) -> None:
    f, items, total = await svc.search(me, f if f is not None else await svc.last_filter(me))
    page = max(0, min(page, (len(items) - 1) // 5)) if items else 0
    await show(event, views.results(lang, f, items, total, page, svc.dmap), cfg)


@router.callback_query(Nav.filter(F.to == "search"))
async def nav_search(cq: CallbackQuery, state: FSMContext, svc, lang, cfg) -> None:
    await state.clear()
    await show(cq, views.pick_district(lang, svc.districts, "w:d", "search.district", "n:menu"), cfg)


@router.callback_query(Wiz.filter(F.k.in_({"d", "r", "b"})))
async def wizard(cq: CallbackQuery, callback_data: Wiz, svc, me, lang, cfg) -> None:
    f = await svc.last_filter(me)
    k, v = callback_data.k, callback_data.v
    if k == "d":
        if v != "-" and v not in svc.dmap:
            raise Refused("stale")
        f["district"] = "" if v == "-" else v
        await svc.search(me, f, limit=0)  # remember the choice
        await show(cq, views.pick_rooms(lang, "w:r", "search.rooms", "n:search"), cfg)
    elif k == "r":
        if v not in {"0", "1", "2", "3", "4"}:
            raise Refused("stale")
        f["rooms"] = int(v)
        await svc.search(me, f, limit=0)
        await show(cq, views.pick_budget(lang, f), cfg)
    else:
        if not v.isdigit() or int(v) >= len(BUDGETS):
            raise Refused("stale")
        f["price_min"], f["price_max"] = BUDGETS[int(v)]
        f["currency"] = "UZS"
        await results_screen(cq, svc, me, lang, cfg, f)


@router.callback_query(Flt.filter(F.k.in_({"s", "g", "m", "p", "a", "z", "x"})))
async def apply_filter(cq: CallbackQuery, callback_data: Flt, svc, me, lang, cfg) -> None:
    f = await svc.last_filter(me)
    k, v = callback_data.k, callback_data.v
    if not v.isdigit() or len(v) > 2:
        raise Refused("stale")
    n = int(v)
    limits = {"s": len(SORTS), "g": 10, "m": 2, "p": 2, "a": len(AUD_FILTERS), "z": len(AREA_FILTERS), "x": 1}
    if n >= limits[k]:
        raise Refused("stale")
    if k == "g":
        await results_screen(cq, svc, me, lang, cfg, f, n)
        return
    if k == "s":
        f["sort"] = SORTS[n]
        await results_screen(cq, svc, me, lang, cfg, f)
        return
    if k == "m":
        f["furnished"] = n
    elif k == "p":
        f["pets"] = n
    elif k == "a":
        f["audience"] = AUD_FILTERS[n]
    elif k == "z":
        f["min_area"] = AREA_FILTERS[n]
    f, _, _ = await svc.search(me, f, limit=0)
    await show(cq, views.filters(lang, f), cfg)


@router.callback_query(Lst.filter(F.id > 0))
async def open_card(cq: CallbackQuery, callback_data: Lst, svc, me, lang, cfg) -> None:
    x = await svc.card(me, callback_data.id)
    await show(cq, views.card(lang, x, svc.now(), svc.dmap, svc.rate, bool(cfg.webapp_url)), cfg)


async def slots_screen(event, svc, me: int, lang: str, cfg, lid: int) -> None:
    x = await svc.card(me, lid)
    if x["own"]:
        raise Refused("own_listing")
    if not x["slots"]:
        raise Refused("slot_taken")
    await show(event, views.slots(lang, x, svc.now()), cfg)


@router.callback_query(Req.filter(F.id > 0))
async def ask_slot(cq: CallbackQuery, callback_data: Req, state: FSMContext, svc, me, user, lang, cfg) -> None:
    if not user["phone"]:
        from .handlers_main import ask_phone

        await ask_phone(cq, state, lang, f"q:{callback_data.id}")
        return
    await slots_screen(cq, svc, me, lang, cfg, callback_data.id)


@router.callback_query(Slot.filter(F.id > 0))
async def take_slot(cq: CallbackQuery, callback_data: Slot, svc, me, lang, cfg, notifier) -> None:
    v = await svc.request_viewing(me, callback_data.id)
    await notifier.new_request(v)
    await show(cq, views.sent(lang, v, svc.now()), cfg)


@router.callback_query(Rep.filter((F.id > 0) & (F.r >= 0) & (F.r <= 4)))
async def report(cq: CallbackQuery, callback_data: Rep, svc, me, lang, cfg) -> None:
    lid = callback_data.id
    if callback_data.r == 0:
        await svc.card(me, lid)  # only for listings this person may see
        await show(cq, views.report_ask(lang, lid), cfg)
        return
    await svc.report(me, lid, REASONS[callback_data.r - 1])
    await cq.answer(plain(t(lang, "report.done")), show_alert=True)
    await show(cq, views.main_menu(lang, {"admin": me in svc.admins}, bool(cfg.webapp_url)), cfg)


@router.callback_query(Vw.filter((F.id > 0) & (F.a == "c")))
async def cancel_viewing(cq: CallbackQuery, callback_data: Vw, svc, me, lang, cfg, notifier) -> None:
    v = await svc.cancel_viewing(me, callback_data.id)
    await notifier.cancelled(v, me)
    if v["landlord_id"] == me:
        from .views_landlord import requests

        await show(cq, requests(lang, await svc.incoming(me), svc.now(), svc.dmap), cfg)
    else:
        await show(cq, views.viewings(lang, await svc.my_viewings(me), svc.now(), svc.dmap), cfg)


@router.callback_query(Nav.filter(F.to == "viewings"))
async def my_viewings(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await show(cq, views.viewings(lang, await svc.my_viewings(me), svc.now(), svc.dmap), cfg)


@router.callback_query(Nav.filter(F.to == "saved"))
async def saved(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await show(cq, views.subs(lang, await svc.my_subs(me), svc.dmap), cfg)


@router.callback_query(Nav.filter(F.to == "save"))
async def save_search(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await svc.add_sub(me, await svc.last_filter(me))
    await cq.answer(plain(t(lang, "search.saved")), show_alert=True)
    await show(cq, views.subs(lang, await svc.my_subs(me), svc.dmap), cfg)


@router.callback_query(Sub.filter(F.id > 0))
async def delete_sub(cq: CallbackQuery, callback_data: Sub, svc, me, lang, cfg) -> None:
    await svc.delete_sub(me, callback_data.id)
    await show(cq, views.subs(lang, await svc.my_subs(me), svc.dmap), cfg)
