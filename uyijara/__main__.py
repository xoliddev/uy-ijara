"""Run everything in one process: ``python -m uyijara``.

* the Telegram bot (long polling),
* the aiohttp server with the Mini App and its API,
* the scheduler loop (30-day expiry, lapsed requests, saved-search alerts; state lives in SQLite, so a restart
  loses nothing and sends nothing twice).
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.types import MenuButtonWebApp, WebAppInfo
from aiohttp import web

from . import scheduler
from .bot.notify import Notifier
from .bot.setup import BotConfig, build_dispatcher
from .config import Settings
from .core import seedgen
from .db import Database
from .service import Service
from .web import ROOT, make_app

log = logging.getLogger("uyijara")


def load(name: str):
    with open(ROOT / "shared" / "data" / f"{name}.json", encoding="utf-8") as fh:
        return json.load(fh)


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    cfg = Settings.from_env()
    districts = load("districts")
    db = await Database.open(cfg.db_path)
    now = int(time.time() * 1000)
    if cfg.seed_demo and await db.seed(seedgen.world(districts, load("people"), now), now, cfg.usd_rate):
        log.info("seeded the fictional demo city (60 listings)")
    service = Service(db, districts, admins=cfg.admin_ids, rate=cfg.usd_rate)
    bot = Bot(cfg.bot_token, default=DefaultBotProperties(parse_mode="HTML"))
    me = await bot.get_me()
    dp = build_dispatcher(service, bot, BotConfig(me.username or "", cfg.webapp_url), cfg.rate_per_minute)
    notifier = Notifier(bot, service, cfg.webapp_url)
    if cfg.webapp_url:
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text="Xarita", web_app=WebAppInfo(
            url=cfg.webapp_url)))

    app = make_app(service, cfg.bot_token, notifier, cfg.initdata_max_age, cfg.rate_per_minute)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, cfg.host, cfg.port).start()
    log.info("Mini App and API on http://%s:%s/webapp/  bot: @%s", cfg.host, cfg.port, me.username)
    loop = asyncio.create_task(scheduler.loop(service, notifier, cfg.scheduler_interval))
    try:
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        loop.cancel()
        await runner.cleanup()
        await bot.session.close()
        await db.close()


if __name__ == "__main__":
    asyncio.run(main())
