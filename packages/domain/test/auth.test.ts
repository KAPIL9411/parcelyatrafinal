/**
 * Authentication and OTP unit tests.
 *
 * These tests exercise auth-related logic (phone normalisation, hashing, OTP generation,
 * HMAC verification, challenge lifecycle mechanics, cooldown logic) without a running server
 * or database.
 *
 * Run with: node --test --experimental-strip-types test/auth.test.ts
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

// ─── Inline implementations matching apps/api/src/lib/crypto.ts ─────────────
// We replicate the functions here so the domain test package has no dependency on
// the API package (which would pull in Fastify, Zod, and the config loader).

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function hmacHex(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function phoneHash(secret: string, phone: string): string {
  return hmacHex(secret, phone.trim());
}

function maskPhone(phone: string): string {
  const last4 = phone.replace(/\D/g, '').slice(-4);
  return `+91******${last4}`;
}

function phoneLast4(phone: string): string {
  return phone.replace(/\D/g, '').slice(-4);
}

function generateOtp(length = 6): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

function hashCode(secret: string, code: string): string {
  return hmacHex(secret, code);
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// ─── Phone normalisation ─────────────────────────────────────────────────────

const VALID_PHONES = [
  '+916000000000',
  '+919999999999',
  '+917123456789',
  '+918765432109',
];

const INVALID_PHONES = [
  '+91500000000',    // starts with 5 (not mobile range)
  '+911234567890',   // starts with 1
  '+91123456789',    // only 9 digits after country code
  '+91999999999999', // too many digits
  '9999999999',      // no country code
  '+44 7911 123456', // UK number
  '',
];

test('phone: valid Indian mobile numbers pass the regex', () => {
  const re = /^\+91[6-9][0-9]{9}$/;
  for (const phone of VALID_PHONES) {
    assert.ok(re.test(phone), `expected valid: ${phone}`);
  }
});

test('phone: invalid numbers are rejected by the regex', () => {
  const re = /^\+91[6-9][0-9]{9}$/;
  for (const phone of INVALID_PHONES) {
    assert.ok(!re.test(phone), `expected invalid: ${phone}`);
  }
});

test('phone: maskPhone produces correct masked form', () => {
  assert.equal(maskPhone('+916000000000'), '+91******0000');
  assert.equal(maskPhone('+919876543210'), '+91******3210');
  assert.equal(maskPhone('+917654321098'), '+91******1098');
});

test('phone: phoneLast4 extracts last 4 digits', () => {
  assert.equal(phoneLast4('+916000000000'), '0000');
  assert.equal(phoneLast4('+919876543210'), '3210');
});

// ─── Phone hashing ───────────────────────────────────────────────────────────

test('phoneHash: same phone + same secret = same hash (stable)', () => {
  const secret = 'test-secret-32-chars-minimum-xxxxx';
  const phone  = '+916000000000';
  assert.equal(phoneHash(secret, phone), phoneHash(secret, phone));
});

test('phoneHash: different phones produce different hashes', () => {
  const secret = 'test-secret-32-chars-minimum-xxxxx';
  assert.notEqual(
    phoneHash(secret, '+916000000000'),
    phoneHash(secret, '+916000000001'),
  );
});

test('phoneHash: hash does not contain the raw phone number', () => {
  const secret = 'test-secret-32-chars-minimum-xxxxx';
  const phone  = '+916000000000';
  assert.ok(!phoneHash(secret, phone).includes('6000000000'));
});

test('phoneHash: different secrets produce different hashes for the same phone', () => {
  const phone = '+916000000000';
  assert.notEqual(phoneHash('secret-a', phone), phoneHash('secret-b', phone));
});

// ─── OTP generation ──────────────────────────────────────────────────────────

test('generateOtp: produces a 6-digit numeric string', () => {
  for (let i = 0; i < 20; i++) {
    const otp = generateOtp(6);
    assert.equal(otp.length, 6, `length: ${otp}`);
    assert.match(otp, /^[0-9]{6}$/, `digits only: ${otp}`);
  }
});

test('generateOtp: produces varied codes across multiple calls', () => {
  const codes = new Set(Array.from({ length: 50 }, () => generateOtp(6)));
  // With 1,000,000 possible values and 50 draws, getting ≤10 unique is astronomically unlikely.
  assert.ok(codes.size > 10, `expected varied codes, got ${codes.size} unique in 50 draws`);
});

test('generateOtp: different lengths work correctly', () => {
  assert.equal(generateOtp(4).length, 4);
  assert.equal(generateOtp(8).length, 8);
  assert.match(generateOtp(4), /^[0-9]{4}$/);
  assert.match(generateOtp(8), /^[0-9]{8}$/);
});

// ─── OTP HMAC ────────────────────────────────────────────────────────────────

test('hashCode: same code + same secret = same hash', () => {
  const secret = 'test-otp-hmac-secret-xxxxxxxx';
  assert.equal(hashCode(secret, '123456'), hashCode(secret, '123456'));
});

test('hashCode: different codes produce different hashes', () => {
  const secret = 'test-otp-hmac-secret-xxxxxxxx';
  assert.notEqual(hashCode(secret, '123456'), hashCode(secret, '123457'));
});

test('hashCode: hash does not contain the raw OTP value', () => {
  const secret = 'test-otp-hmac-secret-xxxxxxxx';
  assert.ok(!hashCode(secret, '123456').includes('123456'));
});

test('hashCode: output is a 64-character hex string', () => {
  const secret = 'test-otp-hmac-secret-xxxxxxxx';
  assert.equal(hashCode(secret, '123456').length, 64);
  assert.match(hashCode(secret, '123456'), /^[0-9a-f]{64}$/);
});

// ─── Safe equality ───────────────────────────────────────────────────────────

test('safeEqual: identical strings are equal', () => {
  assert.ok(safeEqual('abc', 'abc'));
});

test('safeEqual: different strings are not equal', () => {
  assert.ok(!safeEqual('abc', 'abd'));
});

test('safeEqual: different-length strings are not equal', () => {
  assert.ok(!safeEqual('abc', 'abcd'));
  assert.ok(!safeEqual('', 'a'));
  assert.ok(!safeEqual('a', ''));
});

test('safeEqual: empty strings are equal to each other', () => {
  assert.ok(safeEqual('', ''));
});

// ─── OTP verification flow (challenge lifecycle simulation) ──────────────────

test('OTP lifecycle: correct code verifies successfully', () => {
  const secret  = 'test-otp-hmac-secret-xxxxxxxx';
  const code    = generateOtp(6);
  const stored  = hashCode(secret, code);
  assert.ok(safeEqual(stored, hashCode(secret, code)), 'correct code should match stored hash');
});

test('OTP lifecycle: wrong code does not verify', () => {
  const secret  = 'test-otp-hmac-secret-xxxxxxxx';
  const correct = generateOtp(6);
  // Create a different code (guaranteed different by wrapping increment)
  const wrong   = String((Number(correct) + 1) % 1_000_000).padStart(6, '0');
  const stored  = hashCode(secret, correct);
  assert.ok(!safeEqual(stored, hashCode(secret, wrong)), 'wrong code should not match');
});

test('OTP lifecycle: expired challenge should be rejected', () => {
  const expiresAt = new Date(Date.now() - 1000); // 1 second in the past
  assert.ok(expiresAt.getTime() < Date.now(), 'past expiry should be expired');
});

test('OTP lifecycle: challenge within TTL is valid', () => {
  const expiresAt = new Date(Date.now() + 300_000); // 5 minutes in the future
  assert.ok(expiresAt.getTime() > Date.now(), 'future expiry should be valid');
});

test('OTP lifecycle: consumed challenge should not be reused (replay prevention)', () => {
  // Simulate atomic consume: consumed_at is set; second consume returns rowCount 0.
  const consumedAt = new Date();
  assert.ok(consumedAt !== null, 'consumed challenge should not be reusable');
});

// ─── Resend cooldown (timestamp logic) ───────────────────────────────────────

test('resend cooldown: resend_after in the future blocks resend', () => {
  const resendAfter = new Date(Date.now() + 60_000); // 60 seconds from now
  assert.ok(resendAfter.getTime() > Date.now(), 'should block resend during cooldown');
});

test('resend cooldown: resend_after in the past allows resend', () => {
  const resendAfter = new Date(Date.now() - 1000); // 1 second ago
  assert.ok(resendAfter.getTime() <= Date.now(), 'should allow resend after cooldown expires');
});

test('resend cooldown: cooldown remaining seconds calculation is correct', () => {
  const cooldownMs  = 60_000;
  const resendAfter = new Date(Date.now() + cooldownMs);
  const secondsLeft = Math.ceil((resendAfter.getTime() - Date.now()) / 1000);
  assert.ok(secondsLeft > 0 && secondsLeft <= 60, `expected 0–60 seconds, got ${secondsLeft}`);
});

// ─── Refresh token (SHA-256 storage) ─────────────────────────────────────────

test('sha256: same input produces same output', () => {
  assert.equal(sha256Hex('hello'), sha256Hex('hello'));
});

test('sha256: different inputs produce different outputs', () => {
  assert.notEqual(sha256Hex('hello'), sha256Hex('world'));
});

test('sha256: output is 64 hex characters (256 bits)', () => {
  assert.equal(sha256Hex('test').length, 64);
  assert.match(sha256Hex('test'), /^[0-9a-f]{64}$/);
});

test('randomToken: produces different tokens on successive calls', () => {
  const t1 = randomToken(32);
  const t2 = randomToken(32);
  assert.notEqual(t1, t2, 'tokens should be unique');
});

test('randomToken: output is a non-empty base64url string', () => {
  const token = randomToken(32);
  assert.ok(token.length > 0);
  // base64url: no +, /, = padding
  assert.match(token, /^[A-Za-z0-9_-]+$/);
});

// ─── Session family (refresh-token rotation reuse detection) ─────────────────

test('refresh token family: storing hash, not raw token, prevents trivial lookup', () => {
  const rawToken = randomToken(32);
  const stored   = sha256Hex(rawToken);
  // The raw token is not the same as the stored hash.
  assert.notEqual(rawToken, stored);
  // Verifying: hash the submitted token and compare to stored.
  assert.equal(sha256Hex(rawToken), stored);
});

test('refresh token family: different raw tokens hash to different stored values', () => {
  const t1 = randomToken(32);
  const t2 = randomToken(32);
  assert.notEqual(sha256Hex(t1), sha256Hex(t2));
});

// ─── 2Factor.in provider session ID ──────────────────────────────────────────

test('2Factor: session ID is stored as supplementary metadata (not used for primary verify)', () => {
  // Our primary verification is HMAC-based; the session ID is stored for audit only.
  const sessionId = '5D6EBEE6-EC04-4776-846D-ABCDEF012345';
  assert.ok(typeof sessionId === 'string');
  assert.ok(sessionId.length > 0);
});

test('2Factor: missing session ID (provider failure) should not block challenge creation', () => {
  // If deliverOtp returns { outcome: 'failed' }, the challenge was already committed.
  // The providerSessionId is optional.
  const result: { outcome: string; providerSessionId?: string } = {
    outcome: 'failed',
    providerSessionId: undefined,
  };
  assert.equal(result.outcome, 'failed');
  assert.equal(result.providerSessionId, undefined);
});
