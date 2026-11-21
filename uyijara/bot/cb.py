"""Callback data. Every button is ``<prefix>:<fields>``, parsed and type-checked by aiogram (ints stay ints); the
handlers then filter the allowed values (known districts, room counts, actions) and anything else falls through to
the "stale button" handler. Nothing in callback data is trusted for authorization: the service re-checks every
action against the caller's Telegram id. The JS demo (demo/bot.js) speaks exactly the same format."""

from __future__ import annotations

from aiogram.filters.callback_data import CallbackData
from aiogram.fsm.state import State, StatesGroup

NAV = {"menu", "lang", "search", "saved", "save", "viewings", "landlord", "my", "requests", "new", "reports"}
FILTER_KEYS = {"d", "r", "b", "m", "p", "a", "z", "s", "g", "x"}  # see handlers_tenant.apply_filter
WIZARD = {"d", "r", "b"}
LISTING_ACTIONS = {"pause", "resume", "renew", "price", "slots"}
NEW_STEPS = {"d", "r", "b", "o", "f", "p", "a", "go", "pub", "back"}
PAGE = 5


class Nav(CallbackData, prefix="n"):
    to: str


class Wiz(CallbackData, prefix="w"):
    k: str  # d / r / b: district -> rooms -> budget, then the results
    v: str


class Flt(CallbackData, prefix="f"):
    k: str
    v: str


class Lst(CallbackData, prefix="l"):
    id: int


class Req(CallbackData, prefix="q"):
    id: int  # listing: show its free slots


class Slot(CallbackData, prefix="t"):
    id: int  # slot: ask for it


class Rep(CallbackData, prefix="rp"):
    id: int
    r: int  # 0 = ask the reason, 1..4 = scam / price / rented / other


class Vw(CallbackData, prefix="v"):
    id: int
    a: str  # c = cancel, y = accept, n = decline


class Sub(CallbackData, prefix="sd"):
    id: int  # delete a saved search


class Mine(CallbackData, prefix="ml"):
    id: int  # manage one of my listings


class Act(CallbackData, prefix="ma"):
    id: int
    a: str


class Tm(CallbackData, prefix="ms"):
    id: int
    i: int  # index into viewing.presets(now): toggle that time


class New(CallbackData, prefix="nw"):
    k: str
    v: str


class Mod(CallbackData, prefix="ad"):
    id: int
    a: str  # r = remove the listing, d = dismiss the reports


class Flow(StatesGroup):
    phone = State()
    new_area = State()
    new_floor = State()
    new_address = State()
    new_price = State()
    edit_price = State()
