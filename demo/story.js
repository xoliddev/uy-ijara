// The guided scenario. Each step does what a person would do, through the simulated bot and the Mini App.
// Steps can be run in order (with pauses, so you can watch), all at once, or clicked out of order: a step first
// quietly does whatever it needs from earlier steps. js-tests/demo.test.mjs runs the same steps without a browser.
import { AZIZ, FINAL_PRICE, NEW_FLAT, NODIRA, STORY_CHEAP, STORY_EXPENSIVE, TYPED_PRICES } from './seed.js';

export const STEPS = ['step1', 'step2', 'step3', 'step4', 'step5', 'step6', 'step7', 'step8', 'step9'];
const NEEDS = { 6: [5], 7: [6], 9: [1, 8] };
export const FILTER = { district: 'chilonzor', rooms: 2 };

/** Press the newest button whose callback data matches `re`. */
export function tap(bot, re) {
  for (let i = bot.messages.length - 1; i >= 0; i--) {
    const msg = bot.messages[i];
    for (const row of msg.kb) {
      for (const b of row) {
        if (b.data && re.test(b.data)) {
          bot.press(msg.id, b.data);
          return b.data;
        }
      }
    }
  }
  throw new Error(`no button ${re} in ${bot.uid}'s chat`);
}

const pendingOf = (b) => b.viewings.find((v) => v.tenant_id === AZIZ && v.listing_id === STORY_CHEAP && v.status === 'pending');
const acceptedOf = (b) => b.viewings.find((v) => v.tenant_id === AZIZ && v.listing_id === STORY_CHEAP && v.status === 'accepted');

const ACTIONS = {
  // 1. Aziz searches in the bot: Chilonzor, 2 rooms, any budget; then asks to hear about new listings like these.
  async 1({ backend, bots, pause, focus }) {
    const aziz = bots[AZIZ];
    focus(AZIZ, 'chat');
    aziz.start();
    await pause(400);
    tap(aziz, /^n:search$/);
    await pause();
    tap(aziz, /^w:d:chilonzor$/);
    await pause();
    tap(aziz, /^w:r:2$/);
    await pause();
    tap(aziz, /^w:b:0$/);
    await pause(900);
    if (!backend.subs.some((s) => s.user_id === AZIZ)) tap(aziz, /^n:save$/);
  },
  // 2. The same filter in the Mini App: the map with pins coloured by the verdict.
  async 2({ ui, focus }) {
    focus(AZIZ, 'app');
    await ui?.search(AZIZ, FILTER);
  },
  // 3. The red "Qimmat" flat: why is it expensive?
  async 3({ ui, focus }) {
    focus(AZIZ, 'app');
    await ui?.open(AZIZ, STORY_EXPENSIVE);
  },
  // 4. The green "Arzon" one.
  async 4({ ui, focus }) {
    focus(AZIZ, 'app');
    await ui?.open(AZIZ, STORY_CHEAP);
  },
  // 5. Aziz picks tomorrow 10:00; Nodira's phone lights up with Accept / Decline.
  async 5({ backend, ui, pause, focus }) {
    if (pendingOf(backend) || acceptedOf(backend)) return;
    const slot = backend.openSlots(STORY_CHEAP)[0];
    focus(AZIZ, 'app');
    if (ui) await ui.clickSlot(AZIZ, STORY_CHEAP, slot.id);
    else backend.requestViewing(AZIZ, slot.id);
    await pause(900);
    focus(NODIRA, 'chat');
  },
  // 6. Nodira accepts in the bot.
  async 6({ backend, bots, pause, focus }) {
    const v = pendingOf(backend);
    if (!v) return;
    focus(NODIRA, 'chat');
    await pause(400);
    tap(bots[NODIRA], new RegExp(`^v:${v.id}:y$`));
    await pause(700);
  },
  // 7. Only now: the exact address and both phones. Aziz sees them in the chat and on the listing page.
  async 7({ ui, pause, focus }) {
    focus(AZIZ, 'chat');
    await pause(1200);
    focus(AZIZ, 'app');
    await ui?.open(AZIZ, STORY_CHEAP, 'contact');
  },
  // 8. Nodira posts a new flat and watches the suggested band react while she types the price.
  async 8({ backend, ui, focus }) {
    if (backend.listings.some((x) => x.landlord_id === NODIRA && x.address === NEW_FLAT.address && x.status === 'active')) return;
    focus(NODIRA, 'app');
    if (ui) await ui.postFlat(NODIRA, NEW_FLAT, TYPED_PRICES);
    else backend.createListing(NODIRA, { ...NEW_FLAT, price: FINAL_PRICE });
  },
  // 9. The saved search fires: Aziz gets the new flat in the chat, once.
  async 9({ backend, pause, focus }) {
    focus(AZIZ, 'chat');
    await pause(300);
    backend.tick();
  },
};

export async function runStep(n, env, quick = false, done = env.done ?? (env.done = new Set())) {
  for (const k of NEEDS[n] ?? []) if (!done.has(k)) await runStep(k, env, true, done);
  const wait = quick ? async () => {} : env.wait ?? (async () => {});
  const ctx = { ...env, ui: quick ? null : env.ui, focus: quick ? () => {} : env.focus ?? (() => {}), pause: (ms = 650) => wait(ms) };
  await ACTIONS[n](ctx);
  done.add(n);
}
