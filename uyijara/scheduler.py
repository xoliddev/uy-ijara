"""Background loop: listings past their 30 days expire, requests for past slots lapse, saved searches fire.

Every step is idempotent (conditional UPDATEs, a primary key on alert hits), so a crash, a restart or two loops
running at once never expire twice or send an alert twice.
"""

from __future__ import annotations

import asyncio
import logging

from .service import Service

log = logging.getLogger(__name__)


async def tick(service: Service, notifier) -> dict:
    due = await service.expire_due()
    for x in due["listings"]:
        await notifier.expired(x)
    fired = await service.run_alerts()
    for hit in fired:
        await notifier.alert(hit)
    return {"expired": len(due["listings"]), "lapsed": len(due["viewings"]), "alerts": len(fired)}


async def loop(service: Service, notifier, interval: float = 30.0) -> None:
    while True:
        try:
            await tick(service, notifier)
        except Exception:  # keep the loop alive; the next tick retries
            log.exception("scheduler tick failed")
        await asyncio.sleep(interval)
