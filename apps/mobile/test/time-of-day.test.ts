/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';

import { skyScene, timeOfDay, type TimeOfDay } from '../src/homepage/time-of-day.ts';

function at(hour: number, minute = 0): Date {
  return new Date(2026, 9, 29, hour, minute);
}

const BANDS: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];

test('the scene follows the local clock through the day', () => {
  assert.equal(timeOfDay(at(5)), 'morning');
  assert.equal(timeOfDay(at(10, 59)), 'morning');
  assert.equal(timeOfDay(at(11)), 'afternoon');
  assert.equal(timeOfDay(at(16, 59)), 'afternoon');
  assert.equal(timeOfDay(at(17)), 'evening');
  assert.equal(timeOfDay(at(18, 59)), 'evening');
  assert.equal(timeOfDay(at(19)), 'night');
  assert.equal(timeOfDay(at(23, 59)), 'night');
  assert.equal(timeOfDay(at(4, 59)), 'night');
});

test('each band is its own scene and only night is moonlit and starry', () => {
  const scenes = BANDS.map(skyScene);

  assert.equal(new Set(scenes.map((scene) => scene.label)).size, 4);
  assert.equal(new Set(scenes.map((scene) => scene.tint.join(','))).size, 4);

  for (const scene of scenes) {
    for (const stop of scene.tint) assert.match(stop, /^#[0-9a-f]{6}$/i);
    assert.ok(scene.tintOpacity > 0 && scene.tintOpacity < 0.8);
    assert.ok(scene.core > 0);
    assert.ok(scene.rays >= 0 && scene.rays <= 9);

    if (scene.body === 'moon') {
      assert.equal(scene.stars, 11);
      assert.equal(scene.rays, 0);
    } else {
      assert.equal(scene.stars, 0);
      assert.ok(scene.rays > 0);
    }
  }
});

test('the disc is clipped by the top-left edge in every band', () => {
  for (const band of BANDS) {
    const scene = skyScene(band);
    // The centre sits inside the hero, but closer to the corner than the disc's own radius, so the
    // screen edge cuts it: the sun or moon rises from behind the corner instead of floating in it.
    assert.ok(scene.x > 0 && scene.x < scene.core / 2, `${band} is not cut by the left edge`);
    assert.ok(scene.y > 0 && scene.y + scene.core / 2 < 160, `${band} sits too low in the hero`);
  }
});

test('night is the darkest wash and sunset the warmest', () => {
  const wash = (band: TimeOfDay): number => skyScene(band).tintOpacity;
  assert.equal(wash('night'), Math.max(...BANDS.map(wash)));
  assert.ok(wash('evening') > wash('afternoon'));
  assert.ok(wash('evening') > wash('morning'));
});
