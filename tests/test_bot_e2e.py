"""End-to-end through the real aiogram handlers with a mocked Bot API: search -> verdicts -> card -> phone -> slot ->
landlord accepts -> contacts appear; the new-listing wizard with the suggested band; saved-search alert; expiry;
forged buttons; Russian; admin moderation."""

from __future__ import annotations

from uyijara import scheduler
from uyijara.core.seedgen import SUSPICIOUS

from .helpers import ADMIN, AZIZ, CHEAP, JAVOHIR, NODIRA, OTHER, TIMUR, service_env
from .tg_sim import TgSim


async def search_chilonzor(sim: TgSim, uid: int, budget: str = "Farqi yo'q") -> None:
    await sim.say(uid, "/start")
    await sim.tap(uid, "Uy qidirish")
    assert "Qaysi tumanda" in sim.last(uid) and "⬅️ Orqaga" in sim.buttons(uid)
    await sim.tap(uid, "Chilonzor")
    await sim.tap(uid, "2 xonali")
    await sim.tap(uid, budget)


async def test_tenant_reads_the_verdict_requests_a_slot_and_gets_contacts_after_acceptance():
    async with service_env() as (svc, _):
        sim = TgSim(svc)
        await search_chilonzor(sim, TIMUR)
        res = sim.last(TIMUR)
        assert "Topildi: <b>8</b>" in res and "🟢 Arzon" in res and "Tartib: Adolatli narx" in res
        await sim.tap(TIMUR, "Yana ko'rsatish")
        assert "🔴 Qimmat +22%" in sim.last(TIMUR)
        await sim.tap(TIMUR, next(b for b in sim.buttons(TIMUR) if "$470" in b))
        card = sim.last(TIMUR)
        assert "<b>🔴 Qimmat +22%</b>" in card and "6 ta o'xshash 2 xonali uy" in card and "22% qimmat" in card
        assert "1-qavat −5%" in card and "$470" in card and "Aniq manzil va telefon" in card
        assert "+998" not in card
        await sim.tap(TIMUR, "⬅️ Orqaga")
        await sim.tap(TIMUR, next(b for b in sim.buttons(TIMUR) if "5 350 000" in b))
        cheap = sim.last(TIMUR)
        assert "🟢 Arzon −26%" in cheap and "26% arzon" in cheap and "Yevro ta'mir +10%" in cheap
        await sim.tap(TIMUR, "Ko'rishga yozilish")
        assert "telefon raqamingiz kerak" in sim.last(TIMUR)
        await sim.send_contact(TIMUR, "+998 93 000 10 03", owner=AZIZ)  # someone else's card is refused
        assert "o'zingizning raqamingizni" in sim.texts(TIMUR)[-1]
        await sim.send_contact(TIMUR, "+998930001003")
        assert "Ertaga, 10:00" in sim.buttons(TIMUR)
        await sim.tap(TIMUR, "Ertaga, 10:00")
        assert "So'rov yuborildi" in sim.last(TIMUR)
        assert "Yangi so'rov" in sim.last(NODIRA) and "Timur" in sim.last(NODIRA)
        await sim.tap(NODIRA, "Qabul qilish")
        told = sim.texts(TIMUR)[-1]
        assert "qabul qildi" in told and "+998 90 000 30 01" in told and "ko'chasi" in told
        assert "+998 93 000 10 03" in sim.last(NODIRA)  # the landlord sees the tenant's phone now
        await sim.tap(TIMUR, "Ko'rish")
        assert "Aniq manzil:" in sim.last(TIMUR)
        await sim.say(TIMUR, "/start")
        await sim.tap(TIMUR, "Ko'rishlarim")
        assert "qabul qilindi" in sim.last(TIMUR)


async def test_new_listing_wizard_shows_the_band_and_the_saved_search_fires_once():
    async with service_env() as (svc, clock):
        sim = TgSim(svc)
        await search_chilonzor(sim, AZIZ, "5–8 mln")
        await sim.tap(AZIZ, "Yangi e'lonlarni xabar qilish")
        assert "Saqlangan qidiruvlar" in sim.last(AZIZ) and "5–8 mln" in sim.last(AZIZ)
        clock.skip(minutes=3)
        await sim.say(NODIRA, "/start")
        await sim.tap(NODIRA, "Uy egasi paneli")
        assert "Faol e'lonlar: <b>2</b>" in sim.last(NODIRA) and "so'rovlar: <b>1</b>" in sim.last(NODIRA)
        await sim.tap(NODIRA, "+ Yangi e'lon")
        await sim.tap(NODIRA, "Chilonzor")
        await sim.tap(NODIRA, "2")
        await sim.say(NODIRA, "abc")
        assert "Maydon 12 dan 400" in sim.texts(NODIRA)[-1]
        await sim.say(NODIRA, "54")
        await sim.say(NODIRA, "3/9")
        await sim.tap(NODIRA, "⬅️ Orqaga")  # back to the floor question, then forward again
        await sim.say(NODIRA, "3/9")
        await sim.tap(NODIRA, "G'isht")
        await sim.tap(NODIRA, "Oddiy ta'mir")
        await sim.tap(NODIRA, "Mebelli")
        assert "✓ Mebelli" in sim.buttons(NODIRA)
        await sim.tap(NODIRA, "Davom etish")
        await sim.say(NODIRA, "Bog'bon ko'chasi, 7-uy, 12-xonadon")
        await sim.say(NODIRA, "5,2 mln")
        pv = sim.last(NODIRA)
        assert "Tavsiya etilgan narx" in pv and "Sizning narxingiz: 5 200 000 so'm" in pv and "E'lon qilish" in str(
            sim.buttons(NODIRA))
        await sim.tap(NODIRA, "E'lon qilish")
        assert "Ko'rish vaqtlari" in sim.last(NODIRA)
        await sim.tap(NODIRA, "Ertaga, 18:00")
        assert "✓ Ertaga, 18:00" in sim.buttons(NODIRA)
        out = await scheduler.tick(svc, sim.notifier)
        assert out["alerts"] == 1 and "Saqlangan qidiruvingizga mos" in sim.texts(AZIZ)[-1]
        assert (await scheduler.tick(svc, sim.notifier))["alerts"] == 0


async def test_listing_expires_after_30_days_and_the_landlord_renews_it():
    async with service_env() as (svc, clock):
        sim = TgSim(svc)
        clock.skip(days=31)
        out = await scheduler.tick(svc, sim.notifier)
        assert out["expired"] == 60  # every seed listing is younger than 30 days today; the paused one expires too
        assert any("muddati tugadi" in m for m in sim.texts(NODIRA))
        await sim.tap(NODIRA, "Yana 30 kunga")
        assert "uzaytirildi" in sim.alerts()[-1]


async def test_forged_and_stale_buttons_are_refused():
    async with service_env() as (svc, _):
        sim = TgSim(svc)
        await sim.say(JAVOHIR, "/start")
        for data in ("l:99999", f"ma:{OTHER}:pause", f"ml:{OTHER}", "v:1:y", f"ms:{OTHER}:0"):
            await sim.tap_data(JAVOHIR, data)
        for data in ("w:d:nowhere", "f:s:9", "f:g:99", f"rp:{CHEAP}:9", "nw:d:chilonzor", "zz:1", "n:nowhere"):
            await sim.tap_data(JAVOHIR, data)
        alerts = sim.alerts()
        assert alerts.count("Topilmadi yoki endi mavjud emas.") == 5
        assert alerts[5:].count("Bu tugma eskirgan. Bosh menyuni oching.") == 7
        assert (await svc.listing_row(OTHER))["status"] == "active"
        await sim.tap_data(JAVOHIR, "n:reports")
        assert sim.alerts()[-1] == "Bu bo'lim siz uchun emas."


async def test_russian_menu_and_admin_moderation():
    async with service_env() as (svc, _):
        sim = TgSim(svc)
        await sim.say(AZIZ, "/start")
        await sim.tap(AZIZ, "Русский")
        assert "Главное меню" in sim.last(AZIZ) and "Найти жильё" in sim.buttons(AZIZ)
        await sim.tap(AZIZ, "Найти жильё")
        await sim.tap(AZIZ, "Чиланзар")
        await sim.tap(AZIZ, "2-комнатная")
        await sim.tap(AZIZ, "Не важно")
        await sim.tap(AZIZ, "1.")  # first by fair-price score: the suspiciously cheap one
        assert "Осторожно" in sim.last(AZIZ)
        await sim.tap(AZIZ, "Пожаловаться")
        await sim.tap(AZIZ, "Похоже на мошенничество")
        assert "Жалоба отправлена" in sim.alerts()[-1]
        await sim.say(ADMIN, "/start")
        await sim.tap(ADMIN, "Shikoyatlar")
        assert "1 ta shikoyat" in sim.last(ADMIN)
        await sim.tap(ADMIN, f"#{SUSPICIOUS}")
        assert "olib tashlandi" in sim.alerts()[-1] and "Ochiq shikoyat yo'q" in sim.last(ADMIN)
        assert (await svc.listing_row(SUSPICIOUS))["status"] == "removed"
