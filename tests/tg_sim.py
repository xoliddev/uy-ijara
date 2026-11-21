"""A tiny Telegram simulator: real aiogram Dispatcher and handlers, mocked Bot API session.

Every outgoing call (sendMessage, editMessageText, sendDocument, answerCallbackQuery) is recorded, and each user's
chat is kept as a list of messages, so tests can "press" buttons by their visible text like a real person.
"""

from __future__ import annotations

import importlib
import itertools
from datetime import UTC, datetime

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.base import BaseSession
from aiogram.methods import AnswerCallbackQuery, EditMessageText, GetFile, SendDocument, SendMessage, TelegramMethod
from aiogram.types import Chat, File, Message, Update, User

from uyijara.bot import handlers_landlord, handlers_main, handlers_tenant
from uyijara.bot.notify import Notifier
from uyijara.bot.setup import BotConfig, build_dispatcher
from uyijara.service import Service

BOT_USER = User(id=4242, is_bot=True, first_name="Uy Ijara", username="uyijara_test_bot")


class MockSession(BaseSession):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[TelegramMethod] = []
        self.ids = itertools.count(1)
        self.chats: dict[int, list[dict]] = {}
        self.files: dict[str, bytes] = {}
        self.documents: dict[int, list[bytes]] = {}
        self.latest: dict[int, dict] = {}  # the message a person looks at: last sent or last edited

    async def make_request(self, bot: Bot, method: TelegramMethod, timeout: int | None = None):
        self.calls.append(method)
        if isinstance(method, SendMessage):
            mid = next(self.ids)
            msg = {"id": mid, "text": method.text, "markup": method.reply_markup}
            self.chats.setdefault(int(method.chat_id), []).append(msg)
            self.latest[int(method.chat_id)] = msg
            return self._message(int(method.chat_id), mid, method.text)
        if isinstance(method, EditMessageText):
            for msg in self.chats.get(int(method.chat_id), []):
                if msg["id"] == method.message_id:
                    msg.update(text=method.text, markup=method.reply_markup)
                    self.latest[int(method.chat_id)] = msg
            return self._message(int(method.chat_id), method.message_id, method.text)
        if isinstance(method, SendDocument):
            self.documents.setdefault(int(method.chat_id), []).append(method.document.data)
            return self._message(int(method.chat_id), next(self.ids), "")
        if isinstance(method, GetFile):
            data = self.files[method.file_id]
            return File(file_id=method.file_id, file_unique_id=method.file_id, file_size=len(data),
                        file_path=f"documents/{method.file_id}")
        return True

    @staticmethod
    def _message(chat_id: int, mid: int, text: str) -> Message:
        return Message(message_id=mid, date=datetime.now(UTC), chat=Chat(id=chat_id, type="private"),
                       from_user=BOT_USER, text=text)

    async def close(self) -> None:
        return None

    async def stream_content(self, url, headers=None, timeout=30, chunk_size=65536, raise_for_status=True):
        yield self.files[url.rsplit("/", 1)[-1]]


def fresh_dispatcher(svc: Service, bot: Bot, cfg: BotConfig, rate_per_minute: int = 1000):
    """aiogram routers attach to one dispatcher only; tests build many, so reload the handler modules."""
    for mod in (handlers_main, handlers_tenant, handlers_landlord):
        importlib.reload(mod)
    return build_dispatcher(svc, bot, cfg, rate_per_minute=rate_per_minute)


class TgSim:
    def __init__(self, svc: Service, webapp_url: str = "https://uyijara.example/webapp/", rate: int = 1000) -> None:
        self.session = MockSession()
        self.bot = Bot("4242:TEST-ONLY-TOKEN", session=self.session, default=DefaultBotProperties(parse_mode="HTML"))
        self.dp = fresh_dispatcher(svc, self.bot, BotConfig("uyijara_test_bot", webapp_url), rate)
        self.notifier = Notifier(self.bot, svc, webapp_url)
        self.svc = svc
        self.updates = itertools.count(1)
        self.names = {1001: "Aziz", 1002: "Kamola", 1003: "Timur", 3001: "Nodira", 3005: "Javohir", 9001: "Admin"}

    def user(self, uid: int) -> dict:
        return {"id": uid, "is_bot": False, "first_name": self.names.get(uid, "User"), "language_code": "uz"}

    async def feed(self, payload: dict) -> None:
        upd = Update.model_validate({"update_id": next(self.updates), **payload}, context={"bot": self.bot})
        await self.dp.feed_update(self.bot, upd)

    def _msg(self, uid: int, **extra) -> dict:
        return {"message_id": 10_000 + next(self.updates), "date": int(datetime.now(UTC).timestamp()),
                "chat": {"id": uid, "type": "private"}, "from": self.user(uid), **extra}

    async def say(self, uid: int, text: str) -> None:
        extra = {"text": text}
        if text.startswith("/"):
            extra["entities"] = [{"type": "bot_command", "offset": 0, "length": len(text.split()[0])}]
        await self.feed({"message": self._msg(uid, **extra)})

    async def send_contact(self, uid: int, phone: str, owner: int | None = None) -> None:
        contact = {"phone_number": phone, "first_name": self.names.get(uid, "User"), "user_id": owner or uid}
        await self.feed({"message": self._msg(uid, contact=contact)})

    async def send_file(self, uid: int, name: str, data: bytes) -> None:
        fid = f"f{next(self.updates)}"
        self.session.files[fid] = data
        doc = {"file_id": fid, "file_unique_id": fid, "file_name": name, "file_size": len(data)}
        await self.feed({"message": self._msg(uid, document=doc)})

    async def tap_data(self, uid: int, data: str, message_id: int = 1) -> None:
        cq = {"id": str(next(self.updates)), "from": self.user(uid), "chat_instance": "ci", "data": data,
              "message": {"message_id": message_id, "date": int(datetime.now(UTC).timestamp()),
                          "chat": {"id": uid, "type": "private"}, "from": BOT_USER.model_dump(), "text": "…"}}
        await self.feed({"callback_query": cq})

    def find(self, uid: int, label: str):
        for msg in reversed(self.session.chats.get(uid, [])):
            for row in getattr(msg["markup"], "inline_keyboard", []) or []:
                for b in row:
                    if b.text.startswith(label) and b.callback_data:
                        return msg, b
        raise AssertionError(f"no button {label!r} for {uid}; last: {self.last(uid)!r}")

    async def tap(self, uid: int, label: str) -> None:
        """Press the newest visible button whose text starts with ``label``."""
        msg, b = self.find(uid, label)
        await self.tap_data(uid, b.callback_data, msg["id"])

    def last(self, uid: int) -> str:
        msg = self.session.latest.get(uid)
        return msg["text"] if msg else ""

    def texts(self, uid: int) -> list[str]:
        return [m["text"] for m in self.session.chats.get(uid, [])]

    def alerts(self) -> list[str]:
        return [c.text for c in self.session.calls if isinstance(c, AnswerCallbackQuery) and c.text]

    def buttons(self, uid: int) -> list[str]:
        msgs = [m for m in self.session.chats.get(uid, []) if getattr(m["markup"], "inline_keyboard", None)]
        rows = msgs[-1]["markup"].inline_keyboard if msgs else []
        return [b.text for row in rows for b in row]
