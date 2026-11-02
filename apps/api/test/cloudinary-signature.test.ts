/**
 * Cloudinary authentication signatures, pinned to Cloudinary's own documented example.
 *
 * The production failure this pins: the adapter forced `signature_algorithm=sha256` while the
 * account validated SHA-1, so every signed upload answered 400 "Invalid Signature" and every sink
 * PUT answered 500/503. The live API reported its expected "String to sign" without
 * `signature_algorithm`, and the documented SHA-1 vector below is the independent reference.
 * (https://cloudinary.com/documentation/authentication_signatures)
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

const { cloudinarySignature } = await import('../src/lib/storage.ts');

test('the sha1 signature reproduces the documented Cloudinary example', () => {
  const sig = cloudinarySignature({ timestamp: 1315060510 }, 'abcd');
  assert.equal(sig, 'a21ad0f63beb4de2e5575204b79ab90bffb02c10');
});

test('the signed string is sorted parameters then the secret, exactly as Cloudinary builds it', () => {
  const sig = cloudinarySignature({ type: 'authenticated', public_id: 'a/b', timestamp: 100 }, 's');
  const want = createHash('sha1').update('public_id=a/b&timestamp=100&type=authenticateds').digest('hex');
  assert.equal(sig, want);
});
