# Changelog

## 1.0.0 — 2026-11-21

First release (day 3 of the 30-day portfolio challenge).

- "Narx adolatlimi?": every listing gets Arzon / Adolatli / Qimmat against comparable listings in the same district
  (same rooms, then ±1 room, then the whole district; "Ma'lumot kam" below 5), median standard price per m² with
  integer quality coefficients, outliers dropped by the modified z-score, the 2–3 biggest factors, the fair band,
  and a scam warning for rents far below every comparable. So'm and dollars, compared at a fixed rate.
- Live "tavsiya etilgan narx" band while a landlord types a price, in the bot wizard and the Mini App form.
- Search forgiving Latin/Cyrillic and typos; filters for district, rooms, price (so'm or $), furniture, pets,
  "kimga", area; sort by fair-price score, newest, cheapest.
- Viewing slots: one tenant per slot (conditional UPDATE in `BEGIN IMMEDIATE` + unique partial indexes), landlord
  accepts or declines in the bot, phones and the exact address only after acceptance.
- Saved searches that fire once per listing per search, across restarts; reports with auto-hide and admin
  moderation; duplicate listings refused; 30-day expiry with renewal.
- aiogram 3 bot (buttons only, Uzbek and Russian), aiohttp Mini App API with initData HMAC + freshness, own-listings
  scoping, strict validation, rate limits, CSP; plain HTML/CSS/JS Mini App with a vendored Leaflet 1.9.4 map, drawn
  room pictures and an auto-drawn floor plan.
- JS port of the core with shared test vectors (pytest + `node --test`), Playwright demo test, Docker (non-root), CI.
- GitHub Pages demo: tenant and landlord phones, simulated bot, nine-step guided story (in order or out of order).
