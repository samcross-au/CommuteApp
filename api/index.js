/**
 * API Router — the deployment's only serverless function
 *
 * Vercel's Hobby (free) plan allows at most 12 serverless functions per
 * deployment, and this project has ~36 endpoints. vercel.json rewrites every
 * /api/<route> request here as /api?__ccroute=<route>, and this function
 * dispatches to the matching handler in handlers/ (see handlers/_manifest.js).
 *
 * Copyright (c) 2026 Angus Bergman
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Dual-licensed under AGPL-3.0 and commercial terms — see LICENSE
 */

import { dispatch } from '../handlers/_manifest.js';

// Longest-running endpoint (/api/screen journey planning) needs up to 60s
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const route = String(req.query.__ccroute ?? '').replace(/^\/+|\/+$/g, '');
  delete req.query.__ccroute;

  try {
    const handled = await dispatch(route, req, res);
    if (!handled) {
      res.status(404).setHeader('Content-Type', 'text/plain');
      return res.end('404: NOT_FOUND');
    }
  } catch (error) {
    console.error(`[api-router] /api/${route}:`, error);
    if (!res.headersSent) res.status(500).json({ error: 'Function invocation failed' });
  }
}
