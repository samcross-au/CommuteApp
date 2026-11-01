/**
 * /api/destinations - Commute destinations (partner's work, second office...)
 *
 * GET              List destinations. Without auth: id and name only (for
 *                  display pickers such as the iPad kiosk). With auth: full.
 * POST             Add a destination { name, address, arrivalTime,
 *                  commuteDays, coffeeEnabled }. The address is geocoded.
 * PUT ?id=<id>     Update a destination (same fields). For the primary
 *                  destination ('work') only the name can change here; its
 *                  address is set in the Setup Wizard.
 * DELETE ?id=<id>  Remove a destination (not the primary).
 *
 * Destinations live in preferences (cc:preferences); see
 * src/data/destinations.js for the data model and selection rules.
 *
 * Copyright (c) 2026 Angus Bergman
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Dual-licensed under AGPL-3.0 and commercial terms — see LICENSE
 */

import { getPreferences, setPreferences, getGoogleApiKey } from '../src/data/kv-preferences.js';
import { requireAuth, setAdminCorsHeaders } from '../src/utils/auth-middleware.js';
import { geocodeAddress } from '../src/utils/geocode-address.js';
import {
  listDestinations,
  normaliseDestination,
  makeDestinationId,
  PRIMARY_DESTINATION_ID,
  MAX_EXTRA_DESTINATIONS
} from '../src/data/destinations.js';

async function locate(address) {
  const googleKey = await getGoogleApiKey().catch(() => null);
  const geo = await geocodeAddress(address, googleKey);
  if (!geo || geo.lat == null || geo.lon == null) return null;
  return { lat: geo.lat, lon: geo.lon, suburb: geo.suburb || null };
}

export default async function handler(req, res) {
  setAdminCorsHeaders(res);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET summary is public (names only, no addresses); everything else needs auth
  const authError = requireAuth(req);
  if (req.method !== 'GET' && authError) {
    return res.status(401).json(authError);
  }

  try {
    const prefs = await getPreferences() || {};
    const extras = prefs.destinations || [];

    if (req.method === 'GET') {
      const list = listDestinations(prefs);
      const destinations = authError
        ? list.map(({ id, name, primary }) => ({ id, name, primary }))
        : list;
      return res.json({ success: true, destinations, count: destinations.length });
    }

    if (req.method === 'POST') {
      if (!prefs.addresses?.work && !prefs.locations?.work?.address) {
        return res.status(400).json({ success: false, error: 'Complete the Setup Wizard (home and work) before adding destinations' });
      }
      if (extras.length >= MAX_EXTRA_DESTINATIONS) {
        return res.status(400).json({ success: false, error: `Up to ${MAX_EXTRA_DESTINATIONS} extra destinations are supported` });
      }
      const { value, error } = normaliseDestination(req.body || {});
      if (error) return res.status(400).json({ success: false, error });

      const location = await locate(value.address);
      if (!location) return res.status(400).json({ success: false, error: 'Could not find that address — try adding the suburb and state' });

      const destination = {
        ...value,
        id: makeDestinationId(value.name, extras.map(d => d.id)),
        location
      };
      await setPreferences({ ...prefs, destinations: [...extras, destination] });
      return res.json({ success: true, destination });
    }

    const { id } = req.query;
    if (!id) return res.status(400).json({ success: false, error: 'Destination id required (?id=)' });

    if (req.method === 'PUT') {
      if (id === PRIMARY_DESTINATION_ID) {
        const name = String(req.body?.name || '').trim();
        if (!name || name.length > 40) return res.status(400).json({ success: false, error: 'Name is required (up to 40 characters)' });
        await setPreferences({ ...prefs, journey: { ...(prefs.journey || {}), workLabel: name } });
        return res.json({ success: true, destination: listDestinations({ ...prefs, journey: { ...(prefs.journey || {}), workLabel: name } })[0] });
      }

      const index = extras.findIndex(d => d.id === id);
      if (index === -1) return res.status(404).json({ success: false, error: 'Destination not found' });

      const existing = extras[index];
      const { value, error } = normaliseDestination(req.body || {}, existing);
      if (error) return res.status(400).json({ success: false, error });

      let { address, location } = existing;
      if (value.address !== existing.address) {
        const found = await locate(value.address);
        if (!found) return res.status(400).json({ success: false, error: 'Could not find that address — try adding the suburb and state' });
        // Keep the address as typed (geocoder names can be long or odd,
        // e.g. 'Stop 128: Chapel Street...'); store coordinates only
        address = value.address;
        location = found;
      }
      const updated = { ...value, id, address, location };
      const destinations = extras.map((d, i) => (i === index ? updated : d));
      await setPreferences({ ...prefs, destinations });
      return res.json({ success: true, destination: updated });
    }

    if (req.method === 'DELETE') {
      if (id === PRIMARY_DESTINATION_ID) {
        return res.status(400).json({ success: false, error: 'The main work destination can be changed in the Setup Wizard but not removed' });
      }
      const destinations = extras.filter(d => d.id !== id);
      if (destinations.length === extras.length) return res.status(404).json({ success: false, error: 'Destination not found' });
      await setPreferences({ ...prefs, destinations });
      return res.json({ success: true });
    }

    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (error) {
    console.error('[destinations]', error.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
