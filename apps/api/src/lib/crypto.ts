import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { config } from '../config.ts';

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmac(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

/** Phone numbers are never stored or logged raw. The HMAC is stable across restarts. */
export function phoneHash(phone: string): string {
  return hmac(config.PHONE_HASH_SECRET, phone.trim());
}

export function phoneLast4(phone: string): string {
  return phone.replace(/\D/g, '').slice(-4);
}

/**
 * Masks a phone for display: +91******21.
 *
 * Only the last four digits survive. Showing the operator prefix as well (an earlier version did)
 * adds identifying information without helping anyone recognise their own number, so it is not
 * stored.
 */
export function maskPhone(phone: string): string {
  return `+91******${phoneLast4(phone)}`;
}

export function hashCode(code: string): string {
  return hmac(config.OTP_HMAC_SECRET, code);
}

export function generateOtp(length = config.OTP_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10));
  return out;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** HMAC over `timestamp.body` — the scheme documented in api/WEBHOOK_CONTRACTS.md. */
export function webhookSignature(timestamp: string, body: string, secret = config.PAYMENT_WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Deterministic request hash for idempotency replay detection. */
export function requestHash(body: unknown): string {
  return sha256(stableStringify(body));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
