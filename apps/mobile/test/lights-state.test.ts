/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';

import { lightsAvailable, resolveLights } from '../src/homepage/lights-state.ts';

test('only a lamp theme offers the light string', () => {
  assert.equal(lightsAvailable('lamp'), true);
  assert.equal(lightsAvailable('sparkle'), false);
  assert.equal(lightsAvailable('none'), false);
  assert.equal(lightsAvailable(undefined), false);
});

test('a lamp theme starts on unless the device chose otherwise', () => {
  assert.equal(resolveLights('lamp', null), true);
  assert.equal(resolveLights('lamp', true), true);
  assert.equal(resolveLights('lamp', false), false);
});

test('a stored choice never lights up a theme without a lamp', () => {
  assert.equal(resolveLights('sparkle', true), false);
  assert.equal(resolveLights('none', true), false);
  assert.equal(resolveLights(undefined, true), false);
});
