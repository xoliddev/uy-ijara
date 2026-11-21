// Small DOM helpers for the Mini App. No framework, no build step.
export { makeT } from '../shared/i18n.js';

/** Load both locale files and the districts (the bot reads the very same JSON). The demo also needs the people. */
export async function loadShared(base = new URL('../shared/', import.meta.url), withPeople = false) {
  const get = (p) => fetch(new URL(p, base)).then((r) => {
    if (!r.ok) throw new Error(`load ${p}`);
    return r.json();
  });
  const [uz, ru, districts, people] = await Promise.all([get('locales/uz.json'), get('locales/ru.json'),
    get('data/districts.json'), withPeople ? get('data/people.json') : null]);
  return { catalogs: { uz, ru }, districts, ...(people ? { people } : {}) };
}

/** h('div', {class: 'x', onclick: fn}, child, 'text') — children may be nodes, strings or arrays. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v; // only ever locale templates rendered with escaped params
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Strip the few tags our templates use, for places that need plain text (alerts, aria-labels). */
export const plain = (html) => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent;
};

/** Apply Telegram theme params on top of our palette (light/dark follow the user's Telegram theme). */
export function applyTheme(root, tg) {
  const p = tg?.themeParams ?? {};
  const map = {
    '--bg': p.secondary_bg_color || p.bg_color, '--surface': p.section_bg_color || p.bg_color,
    '--ink': p.text_color, '--muted': p.hint_color || p.subtitle_text_color, '--btn': p.button_color,
    '--btn-ink': p.button_text_color, '--link': p.link_color,
  };
  for (const [k, v] of Object.entries(map)) if (v) root.style.setProperty(k, v);
  if (tg?.colorScheme) root.dataset.scheme = tg.colorScheme;
}

export function haptic(tg, kind = 'light') {
  try {
    if (kind === 'success' || kind === 'error') tg?.HapticFeedback?.notificationOccurred(kind);
    else tg?.HapticFeedback?.impactOccurred(kind);
  } catch {
    /* not inside Telegram */
  }
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
