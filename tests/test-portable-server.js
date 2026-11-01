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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp, apiRoutePath, compileSource, fillDestination, listApiFiles } from '../src/portable-server.js';
import { ROUTES, resolveRoute } from '../handlers/_manifest.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Vercel Hobby (free) plan limit on serverless functions per deployment
const HOBBY_FUNCTION_LIMIT = 12;

describe('Portable server: route mapping', () => {

  it('should map api files to Vercel URLs', () => {
    assert.equal(apiRoutePath('api/health.js'), '/api/health');
    assert.equal(apiRoutePath('api/admin/preferences.js'), '/api/admin/preferences');
    assert.equal(apiRoutePath('api/zone/[id].js'), '/api/zone/:id');
    assert.equal(apiRoutePath('api/index.js'), '/api');
  });

  it('should stay within the Vercel Hobby function limit', () => {
    const files = listApiFiles();
    assert.ok(files.length <= HOBBY_FUNCTION_LIMIT,
      `api/ has ${files.length} functions; Hobby allows ${HOBBY_FUNCTION_LIMIT}. Add endpoints to handlers/ instead.`);
    assert.deepEqual(files, ['api/index.js']);
  });

  it('should list every handler file in handlers/_manifest.js', () => {
    const listed = new Set(ROUTES.map(([, load]) => /import\('\.\/(.+?)'\)/.exec(load.toString())[1]));
    const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
    const files = walk('handlers')
      .filter((f) => f.endsWith('.js') && !path.basename(f).startsWith('_'))
      .map((f) => f.slice('handlers/'.length));
    for (const f of files) assert.ok(listed.has(f), `handlers/${f} is not routed in handlers/_manifest.js`);
  });

  it('should resolve routes, with static routes beating dynamic ones', () => {
    assert.equal(resolveRoute('health').pattern, 'health');
    assert.equal(resolveRoute('screen').pattern, 'screen');
    assert.deepEqual(resolveRoute('zone/header').params, { id: 'header' });
    assert.equal(resolveRoute('').pattern, '');
    assert.equal(resolveRoute('nope'), null);
    assert.equal(resolveRoute('zone/a/b'), null);
  });

  it('should fill $n and :name destination params', () => {
    assert.equal(fillDestination('/api?__ccroute=$1', { 1: 'zone/header' }), '/api?__ccroute=zone/header');
    assert.equal(fillDestination('/x/:id', { id: '7' }), '/x/7');
  });

  it('should match vercel.json source patterns', () => {
    assert.deepEqual(compileSource('/(.*)')('/anything/here'), { 1: 'anything/here' });
    assert.deepEqual(compileSource('/api/zone/:id')('/api/zone/header'), { id: 'header', 1: 'header' });
    assert.deepEqual(compileSource('/api/(.*)')('/api/admin/preferences'), { 1: 'admin/preferences' });
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

  it('should run a rewritten function (/health -> handlers/health.js)', async () => {
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
    // handlers/device/[token].js rejects a bad token only if it received one
    const res = await fetch(`${base}/api/device/not-a-real-token`);
    assert.deepEqual(await res.json(), { error: 'Invalid config token' });
  });

  it('should parse JSON request bodies', async () => {
    // handlers/admin/preferences.js reads req.body; without CC_ADMIN_TOKEN it
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
