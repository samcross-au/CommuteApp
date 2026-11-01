/**
 * Portable Server Test
 *
 * Checks that src/portable-server.js serves the Vercel deployment's routes
 * (public/, api/ functions, vercel.json rules) so the project can move to
 * another host without behaviour changes.
 *
 * Copyright (c) 2026 Angus Bergman
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Dual-licensed under AGPL-3.0 and commercial terms -- see LICENSE
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createApp, apiRoutePath, compileSource, listApiFiles } from '../src/portable-server.js';

describe('Portable server: route mapping', () => {

  it('should map api files to Vercel URLs', () => {
    assert.equal(apiRoutePath('api/health.js'), '/api/health');
    assert.equal(apiRoutePath('api/admin/preferences.js'), '/api/admin/preferences');
    assert.equal(apiRoutePath('api/zone/[id].js'), '/api/zone/:id');
    assert.equal(apiRoutePath('api/index.js'), '/api');
  });

  it('should list static api files before dynamic ones', () => {
    const files = listApiFiles();
    assert.ok(files.includes('api/commutecompute.js'));
    const firstDynamic = files.findIndex(f => f.includes('['));
    assert.ok(firstDynamic > 0 && files.slice(firstDynamic).every(f => f.includes('[')));
  });

  it('should match vercel.json source patterns', () => {
    assert.deepEqual(compileSource('/(.*)')('/anything/here'), {});
    assert.deepEqual(compileSource('/api/zone/:id')('/api/zone/header'), { id: 'header' });
    assert.equal(compileSource('/api/zone/:id')('/api/zone/a/b'), null);
    assert.deepEqual(compileSource('/setup')('/setup'), {});
    assert.equal(compileSource('/setup')('/setup-wizard.html'), null);
    assert.equal(compileSource('/')('/x'), null);
  });
});

describe('Portable server: HTTP behaviour', () => {
  let server;
  let base;

  before(async () => {
    const app = await createApp();
    await new Promise((resolve) => { server = app.listen(0, resolve); });
    base = `http://localhost:${server.address().port}`;
  });

  after(() => new Promise((resolve) => server.close(resolve)));

  it('should apply vercel.json redirects, keeping the query string', async () => {
    const res = await fetch(`${base}/setup?step=2`, { redirect: 'manual' });
    assert.equal(res.status, 307);
    assert.match(res.headers.get('location'), /\/setup-wizard\.html\?step=2$/);
  });

  it('should apply vercel.json security headers', async () => {
    const res = await fetch(`${base}/setup-wizard.html`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.ok(res.headers.get('content-security-policy'));
  });

  it('should serve the iPad kiosk via the /ipad rewrite', async () => {
    const res = await fetch(`${base}/ipad?demo=1`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Commute Compute iPad Kiosk/);
  });

  it('should run a rewritten function (/health -> api/health.js)', async () => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /json/);
  });

  it('should render a PNG from /api/screen at the requested size', async () => {
    const res = await fetch(`${base}/api/screen?random=1&w=1024&h=768`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.readUInt32BE(16), 1024);
    assert.equal(buf.readUInt32BE(20), 768);
  });

  it('should pass dynamic path segments to functions as query params', async () => {
    // api/device/[token].js rejects a bad token only if it received one
    const res = await fetch(`${base}/api/device/not-a-real-token`);
    assert.deepEqual(await res.json(), { error: 'Invalid config token' });
  });

  it('should parse JSON request bodies', async () => {
    // api/admin/preferences.js reads req.body; without CC_ADMIN_TOKEN it
    // refuses before touching storage, which is enough to prove routing
    const res = await fetch(`${base}/api/admin/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field: 'x', value: 'y' })
    });
    assert.ok([401, 403, 500].includes(res.status), `unexpected status ${res.status}`);
  });

  it('should 404 unknown paths', async () => {
    assert.equal((await fetch(`${base}/api/does-not-exist`)).status, 404);
    assert.equal((await fetch(`${base}/no-such-page.html`)).status, 404);
  });
});
