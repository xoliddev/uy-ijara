// JS port of uyijara/core/text.py: Latin/Cyrillic folding, phonetic keys and typo-tolerant word matching.
export const CYRILLIC = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '',
  ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h', і: 'i',
};
const APOSTROPHES = "'`ʻʼ‘’´";
export const MAX_QUERY = 64;
const RULES = [['sch', 'š'], ['sh', 'š'], ['ch', 'č'], ['ph', 'f'], ['th', 't'], ['kh', 'x'], ['ck', 'k'],
  ['ts', 'c'], ['tz', 'c'], ['ks', 'x'], ['cs', 'x']];

export function translit(text) {
  return Array.from(String(text).toLowerCase(), (ch) => CYRILLIC[ch] ?? ch).join('');
}

export function foldWord(word) {
  if (/^\d+$/.test(word)) return word;
  let w = word;
  for (const [a, b] of RULES) w = w.split(a).join(b);
  w = w.replace(/c(?=[eiy])/g, 's');
  w = w.replace(/c/g, 'k').replace(/q/g, 'k').replace(/w/g, 'v').replace(/y/g, 'i').replace(/h/g, 'x');
  w = w.replace(/([a-zčš])\1+/g, '$1');
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

export function words(text) {
  let latin = translit(Array.from(String(text ?? '')).slice(0, MAX_QUERY * 4).join(''));
  for (const ch of APOSTROPHES) latin = latin.split(ch).join('');
  return latin.split(/[^a-z0-9čš]+/).filter(Boolean).map(foldWord);
}

export function distance(a, b, limit = 3) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev2 = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i, ...new Array(b.length).fill(0)];
    let best = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      best = Math.min(best, v);
    }
    if (best > limit) return limit + 1;
    prev2 = prev;
    prev = cur;
  }
  return Math.min(prev[b.length], limit + 1);
}

export function allowedTypos(key) {
  const n = key.length;
  if (n <= 4) return 0;
  return n <= 7 ? 1 : 2;
}

export function wordScore(q, w) {
  if (q === w) return 0;
  if (q.length >= 3 && w.startsWith(q)) return 1;
  const limit = allowedTypos(q);
  if (limit === 0) return null;
  let d = distance(q, w, limit);
  if (d <= limit) return 1 + d;
  if (q.length >= 5 && w.length > q.length) {
    d = distance(q, w.slice(0, q.length), limit);
    if (d <= limit) return 2 + d;
  }
  return null;
}
