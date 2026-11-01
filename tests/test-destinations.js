/**
 * Destinations Test
 *
 * Multiple commute destinations (partner's work, second office): data
 * helpers in src/data/destinations.js and the /api/destinations handler.
 *
 * Copyright (c) 2026 Angus Bergman
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Dual-licensed under AGPL-3.0 and commercial terms -- see LICENSE
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Use the in-memory preferences store and a known admin token
for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'CCKV_REST_API_URL', 'CCKV_REST_API_TOKEN',
  'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_URL']) delete process.env[key];
process.env.CC_ADMIN_TOKEN = 'test-admin-token';

const {
  listDestinations, selectDestination, applyDestination, normaliseDestination, makeDestinationId
} = await import('../src/data/destinations.js');
const { setPreferences, getPreferences } = await import('../src/data/kv-preferences.js');
const { default: handler } = await import('../handlers/destinations.js');

const PREFS = {
  addresses: { home: '1 Lygon St, Carlton VIC 3053', work: '200 Bourke St, Melbourne VIC 3000' },
  locations: {
    home: { lat: -37.8024, lon: 144.9669 },
    work: { lat: -37.8131, lon: 144.9665, address: '200 Bourke St, Melbourne VIC 3000' }
  },
  journey: { arrivalTime: '09:00', coffeeEnabled: true, transitRoute: { mode1: { type: 'train' } } },
  selectedRouteId: 'route-2',
  destinations: [
    { id: 'alexs-work', name: "Alex's Work", address: '1 Swan St, Richmond VIC 3121',
      location: { lat: -37.824, lon: 144.99 }, arrivalTime: '08:15', commuteDays: [1, 2, 3, 4, 5], coffeeEnabled: false },
    { id: 'second-office', name: 'Second Office', address: '101 Collins St, Melbourne VIC 3000',
      location: { lat: -37.8149, lon: 144.9706 }, arrivalTime: '08:45', commuteDays: [5], coffeeEnabled: false }
  ]
};

// Melbourne is UTC+11 in November (AEDT). Monday 2 Nov 2026 07:40 local = Sunday 20:40 UTC.
const melbourne = (iso) => new Date(iso);
const MON_0740 = melbourne('2026-11-01T20:40:00Z');
const MON_0820 = melbourne('2026-11-01T21:20:00Z');
const MON_1000 = melbourne('2026-11-01T23:00:00Z');
const FRI_0830 = melbourne('2026-11-05T21:30:00Z');
const SAT_0700 = melbourne('2026-11-06T20:00:00Z');

describe('Destinations: data helpers', () => {

  it('should list the primary work destination first, then extras', () => {
    const list = listDestinations(PREFS);
    assert.deepEqual(list.map(d => d.id), ['work', 'alexs-work', 'second-office']);
    assert.equal(list[0].primary, true);
    assert.equal(list[0].name, 'Work');
    assert.equal(listDestinations({ ...PREFS, journey: { ...PREFS.journey, workLabel: "Sam's Work" } })[0].name, "Sam's Work");
  });

  it('should list nothing before setup', () => {
    assert.deepEqual(listDestinations({}), []);
    assert.equal(selectDestination({}), null);
  });

  it('should honour an explicit destination id', () => {
    assert.equal(selectDestination(PREFS, 'second-office', { now: MON_0740 }).id, 'second-office');
  });

  it('should pick the next arrival still ahead today in auto mode', () => {
    assert.equal(selectDestination(PREFS, 'auto', { now: MON_0740 }).id, 'alexs-work');  // 8:15 next
    assert.equal(selectDestination(PREFS, 'auto', { now: MON_0820 }).id, 'work');        // 9:00 next
    assert.equal(selectDestination(PREFS, 'auto', { now: FRI_0830 }).id, 'second-office'); // Fri-only 8:45
  });

  it('should fall back to the primary when nothing is due or the id is unknown', () => {
    assert.equal(selectDestination(PREFS, 'auto', { now: MON_1000 }).id, 'work');
    assert.equal(selectDestination(PREFS, 'auto', { now: SAT_0700 }).id, 'work');
    assert.equal(selectDestination(PREFS, 'no-such-id', { now: MON_1000 }).id, 'work');
  });

  it('should plan to an extra destination without touching primary route choices', () => {
    const alex = listDestinations(PREFS)[1];
    const applied = applyDestination(PREFS, alex);
    assert.equal(applied.addresses.work, '1 Swan St, Richmond VIC 3121');
    assert.equal(applied.locations.work.lat, -37.824);
    assert.equal(applied.locations.work.name, "Alex's Work");
    assert.equal(applied.journey.arrivalTime, '08:15');
    assert.equal(applied.journey.coffeeEnabled, false);
    assert.deepEqual(applied.journey.transitRoute, {});
    assert.equal(applied.selectedRouteId, undefined);
    // Original preferences are not mutated
    assert.equal(PREFS.addresses.work, '200 Bourke St, Melbourne VIC 3000');
    assert.equal(PREFS.selectedRouteId, 'route-2');
  });

  it('should leave the primary unchanged unless it has been renamed', () => {
    const primary = listDestinations(PREFS)[0];
    assert.equal(applyDestination(PREFS, primary), PREFS);
    const renamed = { ...PREFS, journey: { ...PREFS.journey, workLabel: "Sam's Work" } };
    const applied = applyDestination(renamed, listDestinations(renamed)[0]);
    assert.equal(applied.locations.work.name, "Sam's Work");
    assert.equal(applied.addresses.work, PREFS.addresses.work);
  });

  it('should validate destination input', () => {
    assert.ok(normaliseDestination({ address: 'x' }).error);
    assert.ok(normaliseDestination({ name: 'A' }).error);
    assert.ok(normaliseDestination({ name: 'A', address: 'x', arrivalTime: '25:00' }).error);
    assert.ok(normaliseDestination({ name: 'A', address: 'x', commuteDays: [7] }).error);
    assert.ok(normaliseDestination({ name: 'A', address: 'x', commuteDays: [] }).error);
    const { value } = normaliseDestination({ name: ' Gym ', address: ' 5 X St ', commuteDays: [3, 1, 1] });
    assert.deepEqual(value.commuteDays, [1, 3]);
    assert.equal(value.name, 'Gym');
    assert.equal(value.arrivalTime, '09:00');
    assert.equal(value.coffeeEnabled, false);
  });

  it('should make unique ids that avoid reserved words', () => {
    assert.equal(makeDestinationId("Alex's Work"), 'alexs-work');
    assert.equal(makeDestinationId("Alex's Work", ['alexs-work']), 'alexs-work-2');
    assert.equal(makeDestinationId('Work'), 'work-2');
    assert.equal(makeDestinationId('Auto'), 'auto-2');
    assert.equal(makeDestinationId('!!!'), 'destination');
  });
});

describe('Destinations: /api/destinations', () => {
  const realFetch = globalThis.fetch;

  // Minimal Vercel-style req/res
  const call = (method, { query = {}, body, auth = true } = {}) => new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader() { return this; },
      status(code) { this.statusCode = code; return this; },
      json(data) { resolve({ status: this.statusCode, data }); },
      end() { resolve({ status: this.statusCode }); }
    };
    const headers = auth ? { authorization: 'Bearer test-admin-token' } : {};
    handler({ method, query, body, headers }, res);
  });

  before(async () => {
    // Geocoding goes to Nominatim without a Google key: answer locally
    globalThis.fetch = async () => ({ json: async () => [{ lat: '-37.84', lon: '144.99', display_name: 'Somewhere, VIC' }] });
    await setPreferences({ ...PREFS, destinations: [] });
  });

  after(() => { globalThis.fetch = realFetch; });

  it('should require auth to add a destination', async () => {
    const { status } = await call('POST', { auth: false, body: { name: 'X', address: 'Y' } });
    assert.equal(status, 401);
  });

  it('should add a destination, keeping the address as typed', async () => {
    const { status, data } = await call('POST', {
      body: { name: "Alex's Work", address: '1 Swan St, Richmond VIC 3121', arrivalTime: '08:15', commuteDays: [1, 2, 3] }
    });
    assert.equal(status, 200);
    assert.equal(data.destination.id, 'alexs-work');
    assert.equal(data.destination.address, '1 Swan St, Richmond VIC 3121');
    assert.deepEqual(data.destination.location, { lat: -37.84, lon: 144.99, suburb: null });
    assert.equal((await getPreferences()).destinations.length, 1);
  });

  it('should reject invalid input', async () => {
    const { status, data } = await call('POST', { body: { name: '', address: 'x' } });
    assert.equal(status, 400);
    assert.match(data.error, /Name/);
  });

  it('should list names only without auth', async () => {
    const { data } = await call('GET', { auth: false });
    assert.deepEqual(data.destinations, [
      { id: 'work', name: 'Work', primary: true },
      { id: 'alexs-work', name: "Alex's Work", primary: false }
    ]);
  });

  it('should list full details with auth', async () => {
    const { data } = await call('GET');
    assert.equal(data.destinations[1].address, '1 Swan St, Richmond VIC 3121');
  });

  it('should rename the primary without changing its address', async () => {
    const { status } = await call('PUT', { query: { id: 'work' }, body: { name: "Sam's Work" } });
    assert.equal(status, 200);
    const prefs = await getPreferences();
    assert.equal(prefs.journey.workLabel, "Sam's Work");
    assert.equal(prefs.addresses.work, '200 Bourke St, Melbourne VIC 3000');
  });

  it('should update an extra destination', async () => {
    const { status, data } = await call('PUT', { query: { id: 'alexs-work' }, body: { arrivalTime: '07:45', coffeeEnabled: true } });
    assert.equal(status, 200);
    assert.equal(data.destination.arrivalTime, '07:45');
    assert.equal(data.destination.coffeeEnabled, true);
    assert.equal(data.destination.address, '1 Swan St, Richmond VIC 3121');
  });

  it('should not delete the primary, but delete extras', async () => {
    assert.equal((await call('DELETE', { query: { id: 'work' } })).status, 400);
    assert.equal((await call('DELETE', { query: { id: 'alexs-work' } })).status, 200);
    assert.equal((await call('DELETE', { query: { id: 'alexs-work' } })).status, 404);
    assert.deepEqual((await getPreferences()).destinations, []);
  });
});
