// JS port of uyijara/core/viewing.py: viewing slots and the life of a tenant's request.
import { atLocal, DAY_MS, HOUR_MS, localDay, MIN_MS } from './clock.js';

export const SLOT_HOURS = [10, 14, 18];
export const PRESET_DAYS = [1, 2];
export const MAX_OPEN_SLOTS = 6;
export const MAX_PENDING_PER_TENANT = 3;
export const MIN_LEAD_MS = HOUR_MS;
export const MAX_AHEAD_MS = 14 * DAY_MS;
export const MOVES = {
  pending: { accept: 'accepted', decline: 'declined', cancel: 'cancelled', expire: 'expired' },
  accepted: { cancel: 'cancelled' },
};
export const LIVE = ['pending', 'accepted'];

export class ViewingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function presets(nowMs) {
  const today = localDay(nowMs);
  return PRESET_DAYS.flatMap((d) => SLOT_HOURS.map((h) => atLocal(today + d, h * 60)));
}

export function checkTime(startMs, nowMs) {
  if (typeof startMs !== 'number' || !Number.isInteger(startMs) || startMs % (30 * MIN_MS)) throw new ViewingError('slot_time');
  if (startMs < nowMs + MIN_LEAD_MS || startMs > nowMs + MAX_AHEAD_MS) throw new ViewingError('slot_time');
  return startMs;
}

export function checkRequest(slotStatus, slotStart, nowMs, pending, ownListing, already) {
  if (ownListing) throw new ViewingError('own_listing');
  if (slotStatus !== 'open' || slotStart <= nowMs) throw new ViewingError('slot_taken');
  if (already) throw new ViewingError('already_requested');
  if (pending >= MAX_PENDING_PER_TENANT) throw new ViewingError('too_many_requests');
}

export function move(status, action) {
  const next = MOVES[status]?.[action];
  if (!next) throw new ViewingError('state');
  return next;
}

export const contactsVisible = (status) => status === 'accepted';
