/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  REVEAL_DISC_END_SCALE,
  REVEAL_DISC_STARTS_AT,
  REVEAL_DURATION_MS,
  REVEAL_LOGO_EASED_TO,
  REVEAL_LOGO_SCALE,
  REVEAL_SPLASH_GONE_AT,
  SPLASH_BLUE,
  SPLASH_IMAGE_WIDTH_DP,
  SPLASH_WORDMARK_ASPECT,
  revealCoverageProgress,
} from '../src/splash.ts';

const appDir = dirname(dirname(fileURLToPath(import.meta.url)));

function splashPluginConfig(): Record<string, unknown> | undefined {
  const app = JSON.parse(readFileSync(join(appDir, 'app.json'), 'utf8')) as {
    expo: { plugins: (string | [string, Record<string, unknown>])[] };
  };
  for (const entry of app.expo.plugins) {
    if (Array.isArray(entry) && entry[0] === 'expo-splash-screen') return entry[1];
  }
  return undefined;
}

test('the JS splash uses the same width and colour as the native splash', () => {
  const config = splashPluginConfig();
  assert.ok(config, 'app.json must configure expo-splash-screen');
  assert.equal(config.imageWidth, SPLASH_IMAGE_WIDTH_DP);
  assert.equal(config.backgroundColor, SPLASH_BLUE);
});

test('the wordmark asset keeps the aspect ratio the splash height is derived from', () => {
  const png = readFileSync(join(appDir, 'assets', 'brand-wordmark-white.png'));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(height / width, SPLASH_WORDMARK_ASPECT);
});

test('the handoff settles the wordmark, then covers it before dropping it', () => {
  // A circle as wide as the diagonal covers the screen when its scale reaches 1. The splash may
  // only fade out once that has happened, or home shows through the gap between the two.
  const covered = revealCoverageProgress();
  assert.ok(covered < REVEAL_SPLASH_GONE_AT, `coverage ${covered} must precede the splash dropout`);
  assert.ok(REVEAL_DISC_STARTS_AT < covered, 'the circle has to finish expanding inside the handoff');
  assert.ok(REVEAL_SPLASH_GONE_AT < 1, 'home is fully revealed by the last frame');
  assert.ok(REVEAL_DISC_END_SCALE > 1, 'the circle must pass the edge of the screen as it dissolves');
});

test('the handoff is a settle, not a zoom, and lasts under a third of a second', () => {
  assert.ok(REVEAL_LOGO_SCALE > 0.85 && REVEAL_LOGO_SCALE < 1, 'the wordmark moves slightly inward');
  assert.ok(REVEAL_LOGO_EASED_TO < 1, 'the settle finishes before the handoff does');
  assert.ok(REVEAL_DURATION_MS >= 250 && REVEAL_DURATION_MS <= 300);
});
