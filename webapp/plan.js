// An auto-drawn floor-plan sketch from the room count and the area: living room and bedrooms along the windows,
// kitchen, bathroom and hall along the corridor; room sizes are shares of the total area, so the numbers add up.
// It is a sketch ("taxminiy"), not the real plan — the Mini App says so.
const FILL = { living: '#f3e9d6', bedroom: '#e5ecf4', kitchen: '#eaf1e2', bath: '#e3eef1', hall: '#f1eeea', yard: '#e4efd9' };
const r1 = (n) => Math.round(n * 10) / 10;

export function planRooms(rooms, area) {
  const kitchen = Math.max(6, Math.round(area * 0.12));
  const bath = Math.max(3, Math.round(area * 0.06));
  const hall = Math.max(4, Math.round(area * 0.09));
  const rest = area - kitchen - bath - hall;
  if (rooms === 1) return [{ kind: 'living', m2: rest }, { kind: 'kitchen', m2: kitchen }, { kind: 'bath', m2: bath }, { kind: 'hall', m2: hall }];
  const living = Math.max(14, Math.round(rest * (rooms === 2 ? 0.5 : rooms === 3 ? 0.4 : 0.3)));
  const beds = rooms - 1;
  const each = Math.floor((rest - living) / beds);
  const out = [{ kind: 'living', m2: living + (rest - living - each * beds) }];
  for (let i = 0; i < beds; i++) out.push({ kind: 'bedroom', m2: each });
  return [...out, { kind: 'kitchen', m2: kitchen }, { kind: 'bath', m2: bath }, { kind: 'hall', m2: hall }];
}

function band(items, x, y, w, h, out) {
  const total = items.reduce((s, r) => s + r.m2, 0);
  let cx = x;
  for (const r of items) {
    const rw = (w * r.m2) / total;
    out.push({ ...r, x: cx, y, w: rw, h });
    cx += rw;
  }
}

/** SVG string. names: {living, bedroom, kitchen, bath, hall, balcony} already localized (plain text). */
export function planSvg({ rooms, area, balcony = false, house = false }, names) {
  const list = planRooms(rooms, area);
  const top = list.filter((r) => r.kind === 'living' || r.kind === 'bedroom');
  const bottom = list.filter((r) => !top.includes(r));
  if (top.length > 3) bottom.push(...top.splice(3));
  const W = 284;
  const H = 168;
  const X = 18;
  const Y = balcony ? 22 : 16;
  const sum = (a) => a.reduce((s, r) => s + r.m2, 0);
  const topH = Math.max(64, Math.min(H - 52, (H * sum(top)) / (sum(top) + sum(bottom))));
  const cells = [];
  band(top, X, Y, W, topH, cells);
  band(bottom, X, Y + topH, W, H - topH, cells);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const parts = cells.map((c) => {
    const small = c.w < 46 || c.h < 40;
    const label = c.w > 26 ? `<text x="${r1(c.x + c.w / 2)}" y="${r1(c.y + c.h / 2 - (small ? 0 : 4))}" text-anchor="middle" font-size="${small ? 7.5 : 9.5}" font-weight="600" fill="#39404b">${esc(small ? '' : names[c.kind])}</text>
<text x="${r1(c.x + c.w / 2)}" y="${r1(c.y + c.h / 2 + (small ? 3 : 9))}" text-anchor="middle" font-size="${small ? 7.5 : 8.5}" fill="#6b7280">${c.m2} m²</text>` : '';
    const win = c.y === Y && c.w > 30 ? `<line x1="${r1(c.x + c.w * 0.3)}" y1="${Y}" x2="${r1(c.x + c.w * 0.7)}" y2="${Y}" stroke="#7fb1d9" stroke-width="5"/>
<line x1="${r1(c.x + c.w * 0.3)}" y1="${Y}" x2="${r1(c.x + c.w * 0.7)}" y2="${Y}" stroke="#fff" stroke-width="1.4"/>` : '';
    const door = c.y > Y && c.w > 30 ? `<line x1="${r1(c.x + 8)}" y1="${r1(c.y)}" x2="${r1(c.x + 22)}" y2="${r1(c.y)}" stroke="${FILL[c.kind]}" stroke-width="4"/>
<path d="M${r1(c.x + 8)} ${r1(c.y)} a14 14 0 0 1 14 -14" fill="none" stroke="#9aa1ab" stroke-width=".8"/>` : '';
    return `<rect x="${r1(c.x)}" y="${r1(c.y)}" width="${r1(c.w)}" height="${r1(c.h)}" fill="${FILL[c.kind]}" stroke="#2f343c" stroke-width="2"/>${win}${door}${label}`;
  }).join('');
  const bal = balcony ? `<rect x="${X + 6}" y="4" width="${r1(Math.min(120, W * 0.42))}" height="${Y - 6}" fill="#fff" stroke="#2f343c" stroke-width="1.2" stroke-dasharray="3 2"/>
<text x="${r1(X + 6 + Math.min(120, W * 0.42) / 2)}" y="${Y - 5}" text-anchor="middle" font-size="7" fill="#6b7280">${esc(names.balcony)}</text>` : '';
  const yard = house ? `<rect x="0" y="0" width="320" height="200" fill="${FILL.yard}"/>` : '<rect x="0" y="0" width="320" height="200" fill="#fbfaf7"/>';
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" role="img" font-family="system-ui, -apple-system, Segoe UI, sans-serif">
${yard}${bal}${parts}<rect x="${X}" y="${Y}" width="${W}" height="${H}" fill="none" stroke="#2f343c" stroke-width="4"/>
<text x="${320 - 8}" y="196" text-anchor="end" font-size="8" fill="#9aa1ab">${area} m²</text></svg>`;
}
