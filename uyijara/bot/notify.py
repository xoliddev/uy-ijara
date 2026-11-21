"""Messages the bot sends on its own: a new viewing request for the landlord (with Accept / Decline), the answer
for the tenant (with the address and phone once accepted), cancellations, expired listings and saved-search hits.
Used by the bot, the Mini App API and the scheduler loop."""

from __future__ import annotations

import logging

from aiogram import Bot
from aiogram.exceptions import TelegramAPIError

from ..core.listing import fmt_phone
from ..i18n import district_name, money, slot_label, t, title, verdict_line
from .markup import markup

log = logging.getLogger(__name__)


class Notifier:
    def __init__(self, bot: Bot, service, webapp_url: str = "") -> None:
        self.bot, self.svc, self.webapp_url = bot, service, webapp_url

    async def _send(self, uid: int, text: str, rows=None) -> None:
        try:
            await self.bot.send_message(uid, text, reply_markup=markup(rows or [], self.webapp_url),
                                        disable_web_page_preview=True)
        except TelegramAPIError as err:  # blocked the bot, deleted account...
            log.info("could not notify %s: %s", uid, err)

    async def _lang(self, uid: int) -> str:
        return ((await self.svc.user(uid)) or {}).get("lang", "uz")

    async def _about(self, v: dict, lang: str) -> dict:
        x = await self.svc.listing_row(v["listing_id"])
        return {"title": title(lang, x), "district": district_name(lang, x["district"], self.svc.dmap),
                "when": slot_label(lang, v["start_at"], self.svc.now()), "x": x}

    async def new_request(self, v: dict) -> None:
        lang = await self._lang(v["landlord_id"])
        a = await self._about(v, lang)
        tenant = await self.svc.user(v["tenant_id"])
        rows = [[(t(lang, "btn.accept"), f"v:{v['id']}:y"), (t(lang, "btn.decline"), f"v:{v['id']}:n")]]
        await self._send(v["landlord_id"], t(lang, "notify.new_request", tenant=(tenant or {}).get("name", ""),
                                             title=a["title"], district=a["district"], when=a["when"]), rows)

    async def decided(self, v: dict) -> None:
        lang = await self._lang(v["tenant_id"])
        a = await self._about(v, lang)
        if v["status"] == "accepted":
            landlord = await self.svc.user(v["landlord_id"]) or {}
            phone = fmt_phone(landlord["phone"]) if landlord.get("phone") else "—"
            text = t(lang, "notify.accepted", when=a["when"], title=a["title"], district=a["district"],
                     address=a["x"]["address"], name=landlord.get("name", ""), phone=phone)
        else:
            text = t(lang, "notify.declined", title=a["title"], district=a["district"], when=a["when"])
        await self._send(v["tenant_id"], text, [[(t(lang, "btn.view"), f"l:{v['listing_id']}")]])

    async def cancelled(self, v: dict, by: int) -> None:
        other = v["landlord_id"] if by == v["tenant_id"] else v["tenant_id"]
        lang = await self._lang(other)
        a = await self._about(v, lang)
        await self._send(other, t(lang, "notify.cancelled", title=a["title"], district=a["district"], when=a["when"]))

    async def expired(self, x: dict) -> None:
        lang = await self._lang(x["landlord_id"])
        row = await self.svc.listing_row(x["id"])
        await self._send(x["landlord_id"], t(lang, "notify.expired", title=title(lang, row),
                                             district=district_name(lang, row["district"], self.svc.dmap)),
                         [[(t(lang, "btn.renew"), f"ma:{x['id']}:renew")]])

    async def alert(self, hit: dict) -> None:
        lang = await self._lang(hit["user_id"])
        evals, _ = await self.svc.pool()
        x = await self.svc.listing_row(hit["listing_id"])
        await self._send(hit["user_id"], t(lang, "notify.alert", title=title(lang, x),
                                           district=district_name(lang, x["district"], self.svc.dmap),
                                           price=money(lang, x["price"], x["currency"]),
                                           verdict=verdict_line(lang, evals.get(x["id"]))),
                         [[(t(lang, "btn.view"), f"l:{x['id']}")], [(t(lang, "btn.app"), f"@app#l={x['id']}")]])
