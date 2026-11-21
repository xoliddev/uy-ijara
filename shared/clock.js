// JS port of uyijara/core/clock.py: Tashkent time (UTC+5, no DST) with whole numbers only.
export const TZ_OFFSET_MS = 5 * 3_600_000;
export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MIN_MS = 60_000;
export const fdiv = (a, b) => Math.floor(a / b);
const mod = (a, b) => ((a % b) + b) % b;

export const localDay = (ms) => fdiv(ms + TZ_OFFSET_MS, DAY_MS);
export const localMinute = (ms) => fdiv(mod(ms + TZ_OFFSET_MS, DAY_MS), MIN_MS);
export const weekday = (day) => mod(day + 3, 7);

export function civil(day) {
  const z = day + 719_468;
  const era = fdiv(z, 146_097);
  const doe = z - era * 146_097;
  const yoe = fdiv(doe - fdiv(doe, 1460) + fdiv(doe, 36_524) - fdiv(doe, 146_096), 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + fdiv(yoe, 4) - fdiv(yoe, 100));
  const mp = fdiv(5 * doy + 2, 153);
  const d = doy - fdiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return [m <= 2 ? y + 1 : y, m, d];
}

export const atLocal = (day, minute) => day * DAY_MS + minute * MIN_MS - TZ_OFFSET_MS;
export const hhmm = (minute) => `${String(fdiv(minute, 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
