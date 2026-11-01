/**
 * iPad Display Test
 *
 * Covers the browser-display path used by the iPad kiosk (public/ipad.html):
 * ?w=&h= / ?device= dimension resolution and full-size PNG rendering.
 *
 * Copyright (c) 2026 Angus Bergman
 * SPDX-License-Identifier: AGPL-3.0-or-later
 * Dual-licensed under AGPL-3.0 and commercial terms -- see LICENSE
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderFullScreen,
  resolveDisplayDimensions,
  DISPLAY_DIMENSIONS,
} from '../src/services/ccdash-renderer.js';

// Read width/height from a PNG's IHDR chunk
function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const TRANSIT_DATA = {
  location: 'HOME', current_time: '7:26', ampm: 'am', day: 'Friday', date: '13 January',
  temp: 22, condition: 'Sunny', status: 'LEAVE NOW', arrive_by: '8:08', total_minutes: 42,
  legs: [
    { type: 'walk', title: 'Walk to Station', minutes: 6 },
    { type: 'train', title: 'Train to Flinders St', subtitle: 'Carlton', minutes: 14, departTime: '7:38am' },
    { type: 'walk', title: 'Walk to Office', minutes: 5 }
  ]
};

describe('iPad display support', () => {

  it('should define iPad models in DISPLAY_DIMENSIONS', () => {
    for (const model of ['ipad', 'ipad-mini', 'ipad-pro-13', 'ipad-legacy']) {
      assert.ok(DISPLAY_DIMENSIONS[model], `${model} must be defined`);
      assert.ok(DISPLAY_DIMENSIONS[model].width > DISPLAY_DIMENSIONS[model].height,
        `${model} must be landscape`);
    }
  });

  it('should fall back to the given model when no override is present', () => {
    assert.deepEqual(resolveDisplayDimensions({}, 'trmnl-mini'), { width: 600, height: 448 });
    assert.deepEqual(resolveDisplayDimensions(undefined), { width: 800, height: 480 });
  });

  it('should honour a known ?device= and ignore an unknown one', () => {
    assert.deepEqual(resolveDisplayDimensions({ device: 'ipad-legacy' }), { width: 1024, height: 768 });
    assert.deepEqual(resolveDisplayDimensions({ device: 'toaster' }, 'trmnl-og'), { width: 800, height: 480 });
  });

  it('should prefer ?w=&h= over ?device=', () => {
    assert.deepEqual(resolveDisplayDimensions({ w: '2360', h: '1640', device: 'ipad-legacy' }),
      { width: 2360, height: 1640 });
  });

  it('should clamp ?w=&h= to safe bounds', () => {
    assert.deepEqual(resolveDisplayDimensions({ w: '99999', h: '1' }), { width: 2800, height: 240 });
    assert.deepEqual(resolveDisplayDimensions({ w: '-5', h: '100000' }), { width: 400, height: 2800 });
  });

  it('should ignore a non-numeric or partial ?w=&h=', () => {
    assert.deepEqual(resolveDisplayDimensions({ w: 'abc', h: '500' }), { width: 800, height: 480 });
    assert.deepEqual(resolveDisplayDimensions({ w: '1200' }), { width: 800, height: 480 });
  });

  it('should render a PNG at native iPad resolution', async () => {
    const png = await renderFullScreen(TRANSIT_DATA, {}, DISPLAY_DIMENSIONS['ipad']);
    assert.deepEqual(pngSize(png), { width: 2360, height: 1640 });
  });

  it('should render a PNG at legacy iPad resolution', async () => {
    const png = await renderFullScreen(TRANSIT_DATA, {}, DISPLAY_DIMENSIONS['ipad-legacy']);
    assert.deepEqual(pngSize(png), { width: 1024, height: 768 });
  });
});
