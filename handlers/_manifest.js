/**
 * API Route Manifest
 *
 * Maps /api/<route> to its handler module. Vercel's Hobby plan allows only
 * 12 serverless functions per deployment, so the handlers live here in
 * handlers/ (not api/) and a single function, api/index.js, dispatches to
 * them. src/portable-server.js uses the same table on other hosts.
 *
 * Imports must stay literal (import('./x.js')) so Vercel's bundler traces
 * and includes every handler. Add new endpoints here; tests/
 * test-portable-server.js fails if a handler file is missing from this list.
 *
 * ':name' segments match one path segment and are merged into req.query.
 *
 * Copyright (c) 2026 Angus Bergman
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Dual-licensed under AGPL-3.0 and commercial terms — see LICENSE
 */

export const ROUTES = [
  ['address-search', () => import('./address-search.js')],
  ['admin/check-updates', () => import('./admin/check-updates.js')],
  ['admin/export', () => import('./admin/export.js')],
  ['admin/generate-webhook', () => import('./admin/generate-webhook.js')],
  ['admin/preferences', () => import('./admin/preferences.js')],
  ['admin/reset', () => import('./admin/reset.js')],
  ['admin/resolve-stops', () => import('./admin/resolve-stops.js')],
  ['admin/setup-complete', () => import('./admin/setup-complete.js')],
  ['auth/check', () => import('./auth/check.js')],
  ['attributions', () => import('./attributions.js')],
  ['cafe-details', () => import('./cafe-details.js')],
  ['commutecompute', () => import('./commutecompute.js')],
  ['debug-api-key', () => import('./debug-api-key.js')],
  ['destinations', () => import('./destinations.js')],
  ['device-status', () => import('./device-status.js')],
  ['fullscreen', () => import('./fullscreen.js')],
  ['health', () => import('./health.js')],
  ['kv-status', () => import('./kv-status.js')],
  ['landing', () => import('./landing.js')],
  ['livedash', () => import('./livedash.js')],
  ['profiles', () => import('./profiles.js')],
  ['routes', () => import('./routes.js')],
  ['save-google-key', () => import('./save-google-key.js')],
  ['save-transit-key', () => import('./save-transit-key.js')],
  ['status', () => import('./status.js')],
  ['sync-config', () => import('./sync-config.js')],
  ['system-status', () => import('./system-status.js')],
  ['test-live-data', () => import('./test-live-data.js')],
  ['validate-google-key', () => import('./validate-google-key.js')],
  ['validate-transit-key', () => import('./validate-transit-key.js')],
  ['version', () => import('./version.js')],
  ['zonedata', () => import('./zonedata.js')],
  ['zones-tiered', () => import('./zones-tiered.js')],
  ['zones', () => import('./zones.js')],
  // Aliases (formerly vercel.json rewrites)
  ['screen', () => import('./commutecompute.js')],
  // Dynamic segments last, so static routes win
  ['device/:token', () => import('./device/[token].js')],
  ['pair/:code', () => import('./pair/[code].js')],
  ['zone/:id', () => import('./zone/[id].js')],
  // /api and /api/index: legacy standalone Express app (src/server.js)
  ['index', () => import('./index.js')],
  ['', () => import('./index.js')],
];

const compiled = ROUTES.map(([pattern, load]) => ({
  pattern,
  segments: pattern === '' ? [] : pattern.split('/'),
  load
}));

/**
 * Find the handler for a route (path after /api/, no leading slash).
 *
 * @param {string} route - e.g. 'admin/preferences', 'zone/header'
 * @returns {{ pattern: string, params: Object, load: Function }|null}
 */
export function resolveRoute(route) {
  const parts = route === '' ? [] : route.split('/');
  for (const entry of compiled) {
    if (entry.segments.length !== parts.length) continue;
    const params = {};
    const ok = entry.segments.every((seg, i) => {
      if (seg.startsWith(':')) {
        params[seg.slice(1)] = parts[i];
        return parts[i] !== '';
      }
      return seg === parts[i];
    });
    if (ok) return { pattern: entry.pattern, params, load: entry.load };
  }
  return null;
}

/**
 * Invoke the handler for `route` with a Vercel-style (req, res).
 * Sets req.url to the public /api/... path (some handlers, and the legacy
 * Express app, route on it) and merges path params into req.query.
 *
 * @returns {Promise<boolean>} false when no route matched
 */
export async function dispatch(route, req, res) {
  const match = resolveRoute(route);
  if (!match) return false;
  Object.assign(req.query, match.params);
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    for (const item of [].concat(v)) qs.append(k, item);
  }
  const search = qs.toString();
  req.url = `/api${route ? '/' + route : ''}${search ? '?' + search : ''}`;
  const mod = await match.load();
  await mod.default(req, res);
  return true;
}
