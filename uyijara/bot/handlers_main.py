"""/start, the main menu, language, sharing a phone number and the stale-button fallback."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import CommandStart, StateFilter
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, KeyboardButton, Message, ReplyKeyboardMarkup, ReplyKeyboardRemove

from ..core.listing import fmt_phone
from ..i18n import t
from . import views
from .cb import Flow, Nav
from .setup import show

router = Router(name="main")
fallback = Router(name="fallback")


async def menu(event, svc, me: int, cfg, hello: bool = False) -> None:
    user = {**(await svc.user(me)), "admin": me in svc.admins}
    await show(event, views.main_menu(user["lang"], user, bool(cfg.webapp_url), hello), cfg)


@router.message(CommandStart())
async def start(message: Message, state: FSMContext, svc, me, cfg) -> None:
    await state.clear()
    await menu(message, svc, me, cfg, hello=True)


@router.callback_query(Nav.filter(F.to == "menu"))
async def nav_menu(cq: CallbackQuery, state: FSMContext, svc, me, cfg) -> None:
    await state.clear()
    await menu(cq, svc, me, cfg)


@router.callback_query(Nav.filter(F.to == "lang"))
async def nav_lang(cq: CallbackQuery, svc, me, lang, cfg) -> None:
    await svc.set_lang(me, "ru" if lang == "uz" else "uz")
    await menu(cq, svc, me, cfg)


async def ask_phone(event, state: FSMContext, lang: str, after: str, key: str = "phone.ask") -> None:
    """Ask for the phone with Telegram's "share contact" button; ``after`` is where to continue."""
    await state.set_state(Flow.phone)
    await state.update_data(after=after)
    kb = ReplyKeyboardMarkup(keyboard=[[KeyboardButton(text=t(lang, "btn.share_phone"), request_contact=True)]],
                             resize_keyboard=True, one_time_keyboard=True)
    target = event.message if isinstance(event, CallbackQuery) else event
    if isinstance(event, CallbackQuery):
        await event.answer()
    await target.answer(t(lang, key), reply_markup=kb)


async def phone_saved(message: Message, state: FSMContext, svc, me, lang, cfg, phone: str) -> None:
    after = (await state.get_data()).get("after", "")
    await state.clear()
    await message.answer(t(lang, "phone.saved", phone=fmt_phone(phone)), reply_markup=ReplyKeyboardRemove())
    from . import handlers_landlord, handlers_tenant

    if after.startswith("q:") and after[2:].isdigit():
        await handlers_tenant.slots_screen(message, svc, me, lang, cfg, int(after[2:]))
    elif after == "new":
        await handlers_landlord.start_new(message, state, svc, me, lang, cfg)
    else:
        await menu(message, svc, me, cfg)


@router.message(StateFilter(Flow.phone), F.contact)
async def got_contact(message: Message, state: FSMContext, svc, me, lang, cfg) -> None:
    if message.contact.user_id != me:  # only your own number, not a forwarded contact card
        await message.answer(t(lang, "phone.not_yours"))
        return
    phone = await svc.set_phone(me, message.contact.phone_number)
    await phone_saved(message, state, svc, me, lang, cfg, phone)


@router.message(StateFilter(Flow.phone), F.text)
async def typed_phone(message: Message, state: FSMContext, svc, me, lang, cfg) -> None:
    phone = await svc.set_phone(me, message.text)
    await phone_saved(message, state, svc, me, lang, cfg, phone)


@router.message(F.text.startswith("/"))
async def unknown_command(message: Message, state: FSMContext, svc, me, cfg) -> None:
    """/start is the only command; anything else just brings the menu back."""
    await state.clear()
    await menu(message, svc, me, cfg)


@fallback.callback_query()
async def stale(cq: CallbackQuery, lang) -> None:
    await cq.answer(t(lang, "err.stale"), show_alert=True)


@fallback.message()
async def other(message: Message, svc, me, cfg) -> None:
    await menu(message, svc, me, cfg)

