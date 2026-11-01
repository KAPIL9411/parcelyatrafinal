/// <reference types="node" />
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { SPLASH_BLUE, SPLASH_IMAGE_WIDTH_DP, SPLASH_WORDMARK_ASPECT } from '../src/splash.ts';

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
