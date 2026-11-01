/**
 * Portable Server — runs the Vercel deployment on any Node host
 *
 * Reproduces what Vercel serves for this project, from the same files:
 *   - public/ as static files
 *   - every api/**.js serverless function, at the same URL (today that is
 *     just api/index.js, the router that dispatches to handlers/)
 *   - vercel.json headers, redirects and rewrites
 *
 * Use this to move off Vercel (Render, Docker, Cloud Run, a home server)
 * without behaviour changes. src/server.js is the older standalone Express
 * server; on Vercel it is only reachable at /api (via handlers/index.js).
 *
 * Run: npm run serve   (PORT defaults to 3000)
 *
 * Copyright (c) 2026 Angus Bergman
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Dual-licensed under AGPL-3.0 and commercial terms — see LICENSE
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Vercel's request body limit for serverless functions
const BODY_LIMIT = '4.5mb';

/**
 * Map an api/ file path to its Vercel URL pattern (Express syntax).
 * 'api/device/[token].js' -> '/api/device/:token'
 * 'api/index.js'          -> '/api'
 *
 * @param {string} relFile - Path relative to project root, using '/' separators
 * @returns {string}
 */
export function apiRoutePath(relFile) {
  let route = '/' + relFile.replace(/\.js$/, '').replace(/\[([^\]]+)\]/g, ':$1');
  if (route.endsWith('/index')) route = route.slice(0, -'/index'.length) || '/';
  return route;
}

/**
 * List api/ function files (relative paths), skipping helpers that Vercel
 * also ignores: files or folders starting with '_' or '.'.
 */
export function listApiFiles(root = PROJECT_ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.js')) out.push(rel);
    }
  };
  walk('api');
  // Static segments before dynamic ones so /api/zone/list beats /api/zone/:id
  return out.sort((a, b) => (a.includes('[') - b.includes('[')) || a.localeCompare(b));
}

/**
 * Compile a vercel.json `source` pattern into a matcher. Supports what
 * Vercel's path-to-regexp syntax is used for here: named segments (':id')
 * and raw regex groups ('/(.*)'). Express 4's own matcher no longer treats
 * '(.*)' as a wildcard, so routes can't simply be handed to app.all().
 *
 * @param {string} source
 * @returns {(pathname: string) => Object|null} params on match, else null.
 *   Named segments by name; every capture group also by number ('1', '2'...)
 *   for $1-style destinations.
 */
export function compileSource(source) {
  let pattern = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === ':') {
      const name = /^[A-Za-z0-9_]+/.exec(source.slice(i + 1))[0];
      pattern += `(?<${name}>[^/]+)`;
      i += name.length;
    } else if (ch === '(') {
      let depth = 0, j = i;
      for (; j < source.length; j++) {
        if (source[j] === '(') depth++;
        else if (source[j] === ')' && --depth === 0) break;
      }
      pattern += source.slice(i, j + 1);
      i = j;
    } else {
      pattern += ch.replace(/[.*+?^${}|[\]\\/]/g, '\\$&');
    }
  }
  const re = new RegExp(`^${pattern}$`);
  return (pathname) => {
    const m = re.exec(pathname);
    if (!m) return null;
    const params = { ...m.groups };
    for (let n = 1; n < m.length; n++) params[n] = m[n] ?? '';
    return params;
  };
}

/**
 * Substitute :name and $n params from a matched source into a destination.
 */
export function fillDestination(destination, params) {
  return destination
    .replace(/\$(\d+)/g, (m, n) => params[n] ?? '')
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) =>
      params[name] !== undefined ? params[name] : m);
}

/**
 * Register middleware for a vercel.json rule; `fn` receives matched params.
 */
function onSource(app, source, fn) {
  const match = compileSource(source);
  app.use((req, res, next) => {
    const params = match(req.path);
    if (!params) return next();
    return fn(req, res, next, params);
  });
}

function queryString(req) {
  const i = req.originalUrl.indexOf('?');
  return i === -1 ? '' : req.originalUrl.slice(i);
}

/**
 * Build the Express app.
 *
 * @param {Object} [options]
 * @param {string} [options.root] - Project root (defaults to this repo)
 * @returns {Promise<import('express').Express>}
 */
export async function createApp({ root = PROJECT_ROOT } = {}) {
  // handlers/index.js imports src/server.js, which would otherwise start its
  // own listener on PORT and collide with this server
  process.env.CC_EMBEDDED = '1';

  const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  // 1. Headers (applied to every matching response, like Vercel)
  for (const rule of vercelConfig.headers || []) {
    onSource(app, rule.source, (req, res, next) => {
      for (const { key, value } of rule.headers) res.setHeader(key, value);
      next();
    });
  }

  // 2. Redirects — Vercel uses 307/308 and keeps the query string
  for (const rule of vercelConfig.redirects || []) {
    onSource(app, rule.source, (req, res, next, params) => {
      const status = rule.statusCode || (rule.permanent ? 308 : 307);
      res.redirect(status, fillDestination(rule.destination, params) + queryString(req));
    });
  }

  // 3. Filesystem: static files, then serverless functions
  app.use(express.static(path.join(root, 'public')));

  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
  app.use(express.text({ limit: BODY_LIMIT }));

  const handlers = new Map();  // relFile -> handler, imported on first request
  const invoke = async (relFile, req, res) => {
    try {
      if (!handlers.has(relFile)) {
        const mod = await import(pathToFileURL(path.join(root, relFile)).href);
        handlers.set(relFile, mod.default);
      }
      await handlers.get(relFile)(req, res);
    } catch (error) {
      console.error(`[portable-server] ${relFile}:`, error);
      if (!res.headersSent) res.status(500).json({ error: 'Function invocation failed' });
    }
  };

  const functionRoutes = listApiFiles(root).flatMap((relFile) => {
    const route = apiRoutePath(relFile);
    const routes = [{ relFile, match: compileSource(route) }];
    // Vercel serves api/x/index.js at both /api/x and /api/x/index
    if (relFile.endsWith('/index.js')) {
      routes.push({ relFile, match: compileSource('/' + relFile.replace(/\.js$/, '')) });
    }
    return routes;
  });
  const findFunction = (pathname) => {
    for (const fn of functionRoutes) {
      const params = fn.match(pathname);
      if (params) return { fn, params };
    }
    return null;
  };

  app.use((req, res, next) => {
    const found = findFunction(req.path);
    if (!found) return next();
    // Vercel exposes dynamic path segments as query params
    for (const [k, v] of Object.entries(found.params)) if (!/^\d+$/.test(k)) req.query[k] = v;
    return invoke(found.fn.relFile, req, res);
  });

  // 4. Rewrites — only reached when no file or function matched
  for (const rule of vercelConfig.rewrites || []) {
    onSource(app, rule.source, (req, res, next, params) => {
      const destination = fillDestination(rule.destination, params);
      const [destPath, destQuery = ''] = destination.split('?');
      // Destination query params merge with the request's, as on Vercel
      for (const [k, v] of new URLSearchParams(destQuery)) req.query[k] = v;
      const found = findFunction(destPath);
      if (found) return invoke(found.fn.relFile, req, res);
      req.url = destPath + queryString(req);
      return next();
    });
  }
  // Re-run static serving for URLs rewritten to files
  app.use(express.static(path.join(root, 'public')));

  app.use((req, res) => res.status(404).type('text').send('404: NOT_FOUND'));

  return app;
}

// Start when run directly (node src/portable-server.js)
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 3000;
  const app = await createApp();
  app.listen(port, () => {
    console.log(`[portable-server] Cross Commute listening on http://localhost:${port}`);
  });
}

export default createApp;
