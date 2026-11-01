/**
 * Destinations — multiple commute destinations from one home
 *
 * The primary destination is the existing work address in preferences
 * (addresses.work / locations.work / journey.*), exposed with id 'work'.
 * Extra destinations (a partner's work, a second office) are stored in
 * preferences.destinations[]:
 *
 *   { id, name, address, location: { lat, lon, suburb }, arrivalTime: 'HH:MM',
 *     commuteDays: [0-6, Sunday = 0], coffeeEnabled }
 *
 * The dashboard renders one destination at a time: the one requested with
 * ?dest=<id>, or in 'auto' mode the next destination today whose arrival
 * time is still ahead.
 *
 * Copyright (c) 2026 Angus Bergman
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Dual-licensed under AGPL-3.0 and commercial terms — see LICENSE
 */

import { STATE_TIMEZONES } from '../utils/time-format.js';

export const PRIMARY_DESTINATION_ID = 'work';
export const DEFAULT_COMMUTE_DAYS = [1, 2, 3, 4, 5];
export const MAX_EXTRA_DESTINATIONS = 10;
const RESERVED_IDS = new Set([PRIMARY_DESTINATION_ID, 'auto', 'rotate']);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '09:00').split(':').map(Number);
  return h * 60 + m;
}

/**
 * All destinations, primary first.
 *
 * @param {Object} prefs - Stored preferences (cc:preferences)
 * @returns {Array<Object>}
 */
export function listDestinations(prefs = {}) {
  const list = [];
  const primaryAddress = prefs?.addresses?.work || prefs?.locations?.work?.address || '';
  if (primaryAddress) {
    list.push({
      id: PRIMARY_DESTINATION_ID,
      name: prefs.journey?.workLabel || 'Work',
      primary: true,
      address: primaryAddress,
      location: prefs.locations?.work || null,
      arrivalTime: prefs.journey?.arrivalTime || '09:00',
      commuteDays: prefs.journey?.commuteDays || DEFAULT_COMMUTE_DAYS,
      coffeeEnabled: prefs.journey?.coffeeEnabled !== false
    });
  }
  for (const d of prefs?.destinations || []) {
    list.push({
      arrivalTime: '09:00',
      commuteDays: DEFAULT_COMMUTE_DAYS,
      coffeeEnabled: false,
      ...d,
      primary: false
    });
  }
  return list;
}

/**
 * Local weekday (0 = Sunday) and minutes past midnight in the user's state.
 */
export function localDayAndMinutes(date = new Date(), state = 'VIC') {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: STATE_TIMEZONES[state] || 'Australia/Melbourne',
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = (type) => parts.find(p => p.type === type)?.value;
  const hour = parseInt(get('hour'), 10) % 24;
  return { day: WEEKDAYS.indexOf(get('weekday')), minutes: hour * 60 + parseInt(get('minute'), 10) };
}

/**
 * Pick the destination to render.
 *
 * 'auto' (or an unknown id): of the destinations commuting today, the one
 * with the earliest arrival time still ahead; otherwise the primary.
 *
 * @param {Object} prefs
 * @param {string} [requested='auto'] - Destination id or 'auto'
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @param {string} [options.state='VIC']
 * @returns {Object|null}
 */
export function selectDestination(prefs, requested = 'auto', { now = new Date(), state = 'VIC' } = {}) {
  const list = listDestinations(prefs);
  if (list.length === 0) return null;

  const exact = list.find(d => d.id === requested);
  if (exact) return exact;

  const { day, minutes } = localDayAndMinutes(now, state);
  const next = list
    .filter(d => d.commuteDays.includes(day) && toMinutes(d.arrivalTime) > minutes)
    .sort((a, b) => toMinutes(a.arrivalTime) - toMinutes(b.arrivalTime))[0];
  return next || list[0];
}

/**
 * Preferences as if `destination` were the work address, so the existing
 * journey pipeline plans to it unchanged. The primary returns prefs as-is
 * (only a renamed primary gets its name applied, for leg labels).
 * Route choices tied to the primary commute (stored transit route, selected
 * route) are dropped so routes are discovered for the new destination.
 */
export function applyDestination(prefs, destination) {
  if (!destination) return prefs;
  if (destination.primary) {
    // Only a renamed primary changes anything: it labels the final walk leg
    if (!prefs.journey?.workLabel || !prefs.locations?.work) return prefs;
    return { ...prefs, locations: { ...prefs.locations, work: { ...prefs.locations.work, name: prefs.journey.workLabel } } };
  }
  return {
    ...prefs,
    addresses: { ...(prefs.addresses || {}), work: destination.address },
    locations: {
      ...(prefs.locations || {}),
      // name labels the final walk leg ('Walk to Alex's Work')
      work: { ...(destination.location || {}), address: destination.address, name: destination.name }
    },
    journey: {
      ...(prefs.journey || {}),
      transitRoute: {},
      arrivalTime: destination.arrivalTime,
      commuteDays: destination.commuteDays,
      coffeeEnabled: destination.coffeeEnabled
    },
    selectedRouteId: undefined,
    selectedRouteIndex: undefined
  };
}

/**
 * Validate and normalise a destination from a request body.
 *
 * @param {Object} input
 * @param {Object} [existing] - Current destination when updating
 * @returns {{ value?: Object, error?: string }}
 */
export function normaliseDestination(input = {}, existing = null) {
  const merged = { ...(existing || {}), ...input };
  const name = String(merged.name || '').trim();
  if (!name || name.length > 40) return { error: 'Name is required (up to 40 characters)' };

  const address = String(merged.address || '').trim();
  if (!address) return { error: 'Address is required' };

  const arrivalTime = String(merged.arrivalTime || '09:00');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(arrivalTime)) return { error: 'Arrival time must be HH:MM (24-hour)' };

  const days = [...new Set((merged.commuteDays ?? DEFAULT_COMMUTE_DAYS).map(Number))].sort();
  if (days.length === 0 || days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { error: 'Commute days must be a list of weekdays 0-6 (Sunday = 0)' };
  }

  return {
    value: {
      id: existing?.id,
      name,
      address,
      location: merged.location || null,
      arrivalTime,
      commuteDays: days,
      coffeeEnabled: merged.coffeeEnabled === true
    }
  };
}

/**
 * Make a short, unique, URL-safe id from a name ('Alex's Work' -> 'alexs-work').
 */
export function makeDestinationId(name, takenIds = []) {
  const base = String(name).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'destination';
  const taken = new Set([...takenIds, ...RESERVED_IDS]);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}
