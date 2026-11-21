// Listing pictures without stock photos: deterministic SVG illustrations of rooms, keyed by the listing's photo seed.
// The seed picks a palette and small variations (window side, wall art, plant, lamp, rug), so one flat always looks
// the same and a re-posted flat with the same "photos" looks the same too. Only numbers and our own colours go in.
const PALETTES = [
  { wall: '#e9ede4', floor: '#c9a57a', accent: '#6f8f72', accent2: '#e3b664', wood: '#8a5a3b', rug: '#d8c3a5' },
  { wall: '#f3e6da', floor: '#b98a62', accent: '#c8673f', accent2: '#2f4858', wood: '#6b4430', rug: '#e8d2b8' },
  { wall: '#e6e9f0', floor: '#a9805c', accent: '#2e4a7d', accent2: '#e8a33c', wood: '#5c3d2e', rug: '#d7dbe6' },
  { wall: '#f6e7e4', floor: '#c59b74', accent: '#c98585', accent2: '#4f6d5a', wood: '#7a5038', rug: '#efd9cf' },
  { wall: '#f2eddc', floor: '#a77d55', accent: '#d9a13b', accent2: '#3e5c6b', wood: '#5a3b28', rug: '#e9dcc0' },
  { wall: '#e2eeec', floor: '#b58e68', accent: '#2f7f7a', accent2: '#e07a5f', wood: '#6d4a33', rug: '#d3e2df' },
  { wall: '#ecebe8', floor: '#8f7a68', accent: '#474e5a', accent2: '#c9a227', wood: '#3d3029', rug: '#d9d5cc' },
  { wall: '#f4ecdf', floor: '#a8754f', accent: '#9e2b25', accent2: '#1f5f8b', wood: '#6a3f26', rug: '#b8462f' },
];

export function bits(seed) {
  let h = (Math.imul(Number(seed) + 0x9e3779b9, 2654435761) ^ 0x5bd1e995) >>> 0;
  const next = (n) => {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    return h % n;
  };
  for (let i = 0; i < 4; i++) next(2);
  return next;
}
export const palette = (seed) => PALETTES[Number(seed) % PALETTES.length];
const r1 = (n) => Math.round(n * 10) / 10;

function frame(p, body, id) {
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" role="img" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="sky${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9cc7ea"/><stop offset="1" stop-color="#e7f1f8"/></linearGradient>
<linearGradient id="light${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".6" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="fl${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></linearGradient></defs>
<rect width="320" height="146" fill="${p.wall}"/><rect y="146" width="320" height="54" fill="${p.floor}"/>
<rect y="146" width="320" height="16" fill="url(#fl${id})"/>
${[30, 82, 150, 228, 300].map((x, i) => `<line x1="${x}" y1="146" x2="${x + (i - 2) * 22}" y2="200" stroke="#000" stroke-opacity=".07"/>`).join('')}
<rect y="142" width="320" height="5" fill="#fff" fill-opacity=".55"/>${body}
<rect width="320" height="200" fill="url(#light${id})"/></svg>`;
}

function windowAt(x, y, w, h, id, night = false) {
  const tower = `<line x1="${x + w * 0.7}" y1="${y + h}" x2="${x + w * 0.7}" y2="${y + h * 0.28}" stroke="#7b8fa3" stroke-width="1.6"/>
<circle cx="${x + w * 0.7}" cy="${y + h * 0.5}" r="2.6" fill="#7b8fa3"/>`;
  const city = [0.05, 0.2, 0.36, 0.5, 0.82].map((f, i) => `<rect x="${r1(x + w * f)}" y="${r1(y + h * (0.72 - (i % 3) * 0.08))}" width="${r1(w * 0.12)}" height="${r1(h * (0.28 + (i % 3) * 0.08))}" fill="#a9bccd"/>`).join('');
  return `<rect x="${x - 4}" y="${y - 4}" width="${w + 8}" height="${h + 8}" rx="3" fill="#fff"/>
<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${night ? '#30415e' : `url(#sky${id})`}"/>${city}${tower}
<line x1="${x + w / 2}" y1="${y}" x2="${x + w / 2}" y2="${y + h}" stroke="#fff" stroke-width="3"/>
<line x1="${x}" y1="${y + h * 0.42}" x2="${x + w}" y2="${y + h * 0.42}" stroke="#fff" stroke-width="3"/>
<rect x="${x - 8}" y="${y + h + 2}" width="${w + 16}" height="5" rx="2" fill="#fff"/>`;
}

function plant(x, y, p, kind) {
  const leaves = kind ? [[-14, -30, -35], [0, -40, 0], [13, -30, 35], [-8, -20, -60], [9, -22, 60]]
    .map(([dx, dy, a]) => `<ellipse cx="${x + dx}" cy="${y + dy}" rx="6" ry="15" transform="rotate(${a} ${x + dx} ${y + dy})" fill="#4f7d53"/>`).join('')
    : `<path d="M${x} ${y - 4} C ${x - 22} ${y - 30}, ${x - 6} ${y - 50}, ${x} ${y - 58} C ${x + 6} ${y - 50}, ${x + 22} ${y - 30}, ${x} ${y - 4}Z" fill="#5c8a4f"/>
<path d="M${x} ${y - 6} L${x} ${y - 50}" stroke="#3f6b3a" stroke-width="1.5"/>`;
  return `<ellipse cx="${x}" cy="${y + 13}" rx="16" ry="3" fill="#000" fill-opacity=".12"/>${leaves}
<path d="M${x - 10} ${y - 4} h20 l-3 17 h-14z" fill="${p.wood}"/>`;
}

function art(x, y, p, kind) {
  const inner = kind === 0
    ? `<circle cx="${x + 15}" cy="${y + 14}" r="7" fill="${p.accent2}"/><path d="M${x + 3} ${y + 32} l12 -12 8 8 6 -5 8 9z" fill="${p.accent}"/>`
    : kind === 1
      ? `<circle cx="${x + 20}" cy="${y + 18}" r="12" fill="none" stroke="${p.accent}" stroke-width="3"/><circle cx="${x + 20}" cy="${y + 18}" r="5" fill="${p.accent2}"/>`
      : `<rect x="${x + 6}" y="${y + 6}" width="12" height="24" fill="${p.accent}"/><rect x="${x + 22}" y="${y + 12}" width="12" height="18" fill="${p.accent2}"/>`;
  return `<rect x="${x - 3}" y="${y - 3}" width="46" height="42" rx="2" fill="${p.wood}"/><rect x="${x}" y="${y}" width="40" height="36" fill="#fbf8f1"/>${inner}`;
}

function lamp(x, p) {
  return `<line x1="${x}" y1="70" x2="${x}" y2="146" stroke="#3b3b3b" stroke-width="2"/><ellipse cx="${x}" cy="147" rx="9" ry="2.5" fill="#3b3b3b"/>
<path d="M${x - 11} 72 h22 l-6 -16 h-10z" fill="${p.accent2}"/><ellipse cx="${x}" cy="76" rx="22" ry="7" fill="#fff6d8" fill-opacity=".35"/>`;
}

function living(p, b, id) {
  const left = b(2) === 0;
  const win = windowAt(left ? 34 : 214, 30, 72, 70, id);
  const sx = left ? 132 : 40;
  const sofa = `<ellipse cx="${sx + 70}" cy="158" rx="84" ry="7" fill="#000" fill-opacity=".14"/>
<rect x="${sx + 4}" y="100" width="132" height="36" rx="12" fill="${p.accent}"/>
<rect x="${sx}" y="122" width="140" height="30" rx="8" fill="${p.accent}"/><rect x="${sx}" y="122" width="140" height="30" rx="8" fill="#000" fill-opacity=".12"/>
<rect x="${sx - 6}" y="112" width="18" height="40" rx="8" fill="${p.accent}"/><rect x="${sx + 128}" y="112" width="18" height="40" rx="8" fill="${p.accent}"/>
<rect x="${sx + 14}" y="106" width="30" height="22" rx="7" fill="${p.accent2}" transform="rotate(-8 ${sx + 29} 117)"/>
<rect x="${sx + 98}" y="106" width="28" height="22" rx="7" fill="#f4efe6" transform="rotate(7 ${sx + 112} 117)"/>
<rect x="${sx + 8}" y="152" width="5" height="6" fill="${p.wood}"/><rect x="${sx + 127}" y="152" width="5" height="6" fill="${p.wood}"/>`;
  const rug = b(2) ? `<ellipse cx="${sx + 70}" cy="182" rx="96" ry="14" fill="${p.rug}"/><ellipse cx="${sx + 70}" cy="182" rx="80" ry="9" fill="none" stroke="#fff" stroke-opacity=".5" stroke-dasharray="4 4"/>`
    : `<path d="M${sx - 20} 192 L${sx + 6} 166 H${sx + 134} L${sx + 160} 192Z" fill="${p.rug}"/><path d="M${sx - 8} 186 L${sx + 12} 170 H${sx + 128} L${sx + 148} 186Z" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="2"/>`;
  const table = `<ellipse cx="${sx + 70}" cy="183" rx="34" ry="4" fill="#000" fill-opacity=".15"/>
<rect x="${sx + 38}" y="168" width="64" height="7" rx="3" fill="${p.wood}"/><rect x="${sx + 44}" y="175" width="4" height="9" fill="${p.wood}"/><rect x="${sx + 92}" y="175" width="4" height="9" fill="${p.wood}"/>
<circle cx="${sx + 58}" cy="164" r="4" fill="${p.accent2}"/><rect x="${sx + 74}" y="161" width="14" height="7" rx="2" fill="#f7f2ea"/>`;
  const side = left ? 292 : 22;
  return frame(p, `${win}${art(left ? 186 : 120, 38, p, b(3))}${rug}${sofa}${table}${b(2) ? plant(side, 150, p, b(2)) : lamp(side, p)}`, id);
}

function bedroom(p, b, id) {
  const left = b(2) === 0;
  const win = windowAt(left ? 30 : 226, 32, 64, 66, id);
  const curtains = [left ? 18 : 214, left ? 98 : 294].map((x) => `<path d="M${x} 24 q4 40 -2 80 h12 q-6 -40 -2 -80z" fill="${p.accent2}" fill-opacity=".85"/>`).join('');
  const bx = left ? 130 : 50;
  const bed = `<ellipse cx="${bx + 70}" cy="190" rx="92" ry="7" fill="#000" fill-opacity=".14"/>
<rect x="${bx}" y="86" width="140" height="58" rx="10" fill="${p.wood}"/><rect x="${bx + 8}" y="94" width="124" height="44" rx="6" fill="${p.wood}" fill-opacity=".6"/>
<rect x="${bx - 6}" y="134" width="152" height="40" rx="6" fill="#f7f3ec"/>
<rect x="${bx + 14}" y="120" width="50" height="20" rx="8" fill="#fff"/><rect x="${bx + 76}" y="120" width="50" height="20" rx="8" fill="#fff"/>
<path d="M${bx - 8} 146 h156 v38 q-78 10 -156 0z" fill="${p.accent}"/><path d="M${bx - 8} 146 h156 v8 h-156z" fill="#fff" fill-opacity=".25"/>`;
  const nx = left ? bx - 40 : bx + 154;
  const stand = `<rect x="${nx}" y="138" width="30" height="34" rx="3" fill="${p.wood}"/><line x1="${nx + 4}" y1="152" x2="${nx + 26}" y2="152" stroke="#000" stroke-opacity=".2"/>
<path d="M${nx + 6} 122 h18 l-4 -14 h-10z" fill="${p.accent2}"/><rect x="${nx + 13}" y="122" width="4" height="16" fill="#3b3b3b"/>`;
  return frame(p, `${win}${curtains}${art(left ? 250 : 40, 40, p, b(3))}${bed}${stand}`, id);
}

function kitchen(p, b, id) {
  const fridgeLeft = b(2) === 0;
  const fx = fridgeLeft ? 16 : 252;
  const ox = fridgeLeft ? 76 : 16;
  const doors = [0, 1, 2, 3].map((i) => `<rect x="${ox + 4 + i * 57}" y="112" width="51" height="38" rx="3" fill="${p.accent2}"/><rect x="${ox + 22 + i * 57}" y="118" width="16" height="3" rx="1.5" fill="#fff" fill-opacity=".7"/>`).join('');
  const uppers = [0, 3].map((i) => `<rect x="${ox + 4 + i * 57}" y="22" width="51" height="38" rx="3" fill="${p.accent2}" fill-opacity=".9"/>`).join('');
  const fruit = [0, 1, 2].map((i) => `<circle cx="${ox + 176 + i * 9}" cy="${96 - (i % 2) * 4}" r="5.5" fill="${i === 1 ? '#c2412d' : '#b8322a'}"/>`).join('');
  return frame(p, `<rect x="${ox}" y="104" width="232" height="10" rx="2" fill="#efe9df"/><rect x="${ox}" y="112" width="232" height="44" fill="${p.wood}" fill-opacity=".25"/>${doors}
${windowAt(ox + 66, 26, 92, 56, id)}${uppers}
<rect x="${ox + 70}" y="96" width="36" height="8" rx="2" fill="#9aa3ab"/><path d="M${ox + 122} 104 v-14 a8 8 0 0 1 16 0" fill="none" stroke="#9aa3ab" stroke-width="3"/>
<ellipse cx="${ox + 185}" cy="102" rx="20" ry="4" fill="#f2efe8"/>${fruit}
<rect x="${fx}" y="40" width="52" height="116" rx="6" fill="#dfe3e6"/><rect x="${fx}" y="40" width="52" height="116" rx="6" fill="url(#light${id})"/>
<line x1="${fx}" y1="88" x2="${fx + 52}" y2="88" stroke="#b9c0c5" stroke-width="2"/><rect x="${fx + 42}" y="56" width="3" height="20" rx="1.5" fill="#9aa3ab"/><rect x="${fx + 42}" y="96" width="3" height="26" rx="1.5" fill="#9aa3ab"/>
<line x1="${ox + 120}" y1="0" x2="${ox + 120}" y2="14" stroke="#3b3b3b"/><path d="M${ox + 110} 22 a10 9 0 0 1 20 0z" fill="${p.accent}"/>
<ellipse cx="160" cy="190" rx="70" ry="6" fill="#000" fill-opacity=".1"/>`, id);
}

function yard(p, b, id) {
  const vine = Array.from({ length: 26 }, (_, i) => `<circle cx="${20 + (i * 47) % 280}" cy="${18 + (i * 29) % 30}" r="${7 + (i % 3) * 2}" fill="${i % 4 ? '#5d8c45' : '#77a556'}"/>`).join('');
  const grapes = [60, 150, 236].map((x) => `<g fill="#6b3f6e">${[0, 1, 2, 3, 4, 5].map((k) => `<circle cx="${x + (k % 3) * 5 - 5}" cy="${52 + Math.floor(k / 3) * 6}" r="3"/>`).join('')}<circle cx="${x}" cy="64" r="3"/></g>`).join('');
  const carpet = `<rect x="${b(2) ? 150 : 40}" y="150" width="130" height="10" fill="${p.wood}"/><rect x="${b(2) ? 150 : 40}" y="138" width="130" height="14" fill="${p.accent}"/>
<rect x="${b(2) ? 160 : 50}" y="141" width="110" height="8" fill="none" stroke="${p.accent2}" stroke-width="2" stroke-dasharray="6 3"/>
<rect x="${(b(2) ? 150 : 40) + 50}" y="126" width="34" height="12" rx="3" fill="#f3e8d2"/>`;
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" role="img" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="ysky${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8fc0e6"/><stop offset="1" stop-color="#eaf3f8"/></linearGradient></defs>
<rect width="320" height="200" fill="url(#ysky${id})"/><rect x="0" y="70" width="320" height="90" fill="${p.wall}"/>
${[40, 120, 200].map((x) => `<rect x="${x}" y="88" width="44" height="40" rx="3" fill="#fff"/><rect x="${x + 4}" y="92" width="36" height="32" fill="#9fc3df"/><line x1="${x + 22}" y1="92" x2="${x + 22}" y2="124" stroke="#fff" stroke-width="2"/>`).join('')}
<rect x="270" y="92" width="34" height="68" rx="3" fill="${p.wood}"/><circle cx="297" cy="128" r="2" fill="#e8c07a"/>
<rect x="0" y="158" width="320" height="42" fill="#d9c4a3"/><path d="M0 172 H320" stroke="#c8b08b" stroke-dasharray="14 10"/>
${[16, 108, 210, 302].map((x) => `<rect x="${x}" y="40" width="5" height="122" fill="${p.wood}"/>`).join('')}
<rect x="0" y="34" width="320" height="8" fill="${p.wood}"/>${vine}${grapes}${carpet}</svg>`;
}

const SCENES = { living, bedroom, kitchen, yard };

/** One illustration as an SVG string. kind: living | bedroom | kitchen | yard. */
export function roomSvg(seed, kind, salt = 0) {
  const b = bits(Number(seed) * 31 + salt);
  return SCENES[kind](palette(seed), b, `${seed}-${kind}-${salt}`);
}

/** Which pictures a listing gets, in gallery order (the floor plan is added by the caller). */
export function galleryKinds(x) {
  const kinds = x.building === 'house' ? ['yard', 'living'] : ['living'];
  if (x.rooms >= 2) kinds.push('bedroom');
  kinds.push('kitchen');
  return kinds;
}
