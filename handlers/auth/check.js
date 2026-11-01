/**
 * /api/auth/check - Verify an admin token
 *
 * GET with Authorization: Bearer <token>. Returns 200 when the token matches
 * CC_ADMIN_TOKEN, 401 otherwise. Lets the Setup Wizard check a token before
 * saving it, instead of failing later on the first save.
 *
 * Copyright (c) 2026 Angus Bergman
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Dual-licensed under AGPL-3.0 and commercial terms — see LICENSE
 */

import { requireAuth, setAdminCorsHeaders } from '../../src/utils/auth-middleware.js';

export default async function handler(req, res) {
  setAdminCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const authError = requireAuth(req);
  if (authError) {
    return res.status(401).json({ success: false, ...authError });
  }
  return res.json({ success: true });
}
