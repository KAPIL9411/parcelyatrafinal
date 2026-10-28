/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';

import { greetingFor } from '../src/lib/greeting.ts';

function at(hour: number, minute = 0): Date {
  return new Date(2026, 9, 28, hour, minute, 0, 0);
}

test('greeting follows the local clock boundaries', () => {
  assert.equal(greetingFor(at(4, 59), 'Kapil'), 'Good evening, Kapil 👋');
  assert.equal(greetingFor(at(5, 0), 'Kapil'), 'Good morning, Kapil 👋');
  assert.equal(greetingFor(at(11, 59), 'Kapil'), 'Good morning, Kapil 👋');
  assert.equal(greetingFor(at(12, 0), 'Kapil'), 'Good afternoon, Kapil 👋');
  assert.equal(greetingFor(at(16, 59), 'Kapil'), 'Good afternoon, Kapil 👋');
  assert.equal(greetingFor(at(17, 0), 'Kapil'), 'Good evening, Kapil 👋');
  assert.equal(greetingFor(at(23, 59), 'Kapil'), 'Good evening, Kapil 👋');
});

test('greeting uses the first name and never invents one', () => {
  assert.equal(greetingFor(at(9), '  Kapil Sharma '), 'Good morning, Kapil 👋');
  assert.equal(greetingFor(at(13), null), 'Good afternoon!');
  assert.equal(greetingFor(at(20), '   '), 'Good evening!');
});
