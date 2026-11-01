/**
 * Address Geocoding
 * Google Places API (New) when a key is available, Nominatim otherwise.
 * Shared by the admin preferences and destinations endpoints.
 *
 * Copyright (c) 2026 Angus Bergman
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Dual-licensed under AGPL-3.0 and commercial terms — see LICENSE
 */

/**
 * Geocode an address using Google Places API (New) or Nominatim fallback.
 * Extracts suburb from Google addressComponents when available.
 */
export async function geocodeAddress(address, googleKey = null) {
  if (!address) return null;
  const fallback = { address, name: address.split(',')[0], lat: null, lon: null, suburb: null, source: 'input' };

  if (googleKey) {
    try {
      const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': googleKey,
          'X-Goog-FieldMask': 'places.location,places.displayName,places.formattedAddress,places.addressComponents'
        },
        body: JSON.stringify({
          textQuery: address,
          maxResultCount: 1,
          locationBias: { circle: { center: { latitude: -37.8136, longitude: 144.9631 }, radius: 100000.0 } }
        })
      });
      const data = await resp.json();
      if (data.places?.length > 0) {
        const place = data.places[0];
        let suburb = null;
        if (place.addressComponents) {
          const comp = place.addressComponents.find(c =>
            c.types?.includes('locality') || c.types?.includes('sublocality_level_1')
          );
          if (comp) suburb = comp.longText || comp.shortText;
        }
        return {
          address: place.formattedAddress || address,
          name: place.displayName?.text || address.split(',')[0],
          lat: place.location.latitude,
          lon: place.location.longitude,
          suburb,
          source: 'google'
        };
      }
    } catch { /* fall through to Nominatim */ }
  }

  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`, {
      headers: { 'User-Agent': 'Commute Compute/1.0' }
    });
    const results = await resp.json();
    if (results?.length > 0) {
      return {
        address: results[0].display_name || address,
        name: address.split(',')[0],
        lat: parseFloat(results[0].lat),
        lon: parseFloat(results[0].lon),
        suburb: null,
        source: 'nominatim'
      };
    }
  } catch { /* use fallback */ }

  return fallback;
}
