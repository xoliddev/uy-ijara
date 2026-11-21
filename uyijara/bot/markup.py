"""(label, data) rows -> Telegram inline keyboards. Screens are built as plain rows so the JS demo can share them."""

from __future__ import annotations

from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo


def markup(rows: list[list[tuple[str, str]]], webapp_url: str = "") -> InlineKeyboardMarkup:
    """A "@app" or "@app#l=5" button opens the Mini App (the button is skipped when no Mini App is set up)."""
    out = []
    for row in rows:
        buttons = []
        for label, data in row:
            if data.startswith("@app"):
                if webapp_url:
                    buttons.append(InlineKeyboardButton(text=label, web_app=WebAppInfo(url=webapp_url + data[4:])))
            else:
                buttons.append(InlineKeyboardButton(text=label, callback_data=data))
        if buttons:
            out.append(buttons)
    return InlineKeyboardMarkup(inline_keyboard=out)
