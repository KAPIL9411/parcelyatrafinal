import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { config } from '../config.ts';

/**
 * Small authenticated-encryption helper for values that must be recoverable by the server.
 *
 * Two things use it today. The pickup/delivery handover code, which the sender has to be able to
 * read in-app because the receiver has no account and no stored phone number — verification still
 * uses the HMAC in `handover_otps.code_hash`, the sealed copy exists solely so the sender can be
 * shown the code again. And the Google OAuth handshake, sealed into the `state` parameter so the
 * server needs no memory of its own between the authorize and the callback.
 *
 * Format: base64url(iv[12] || tag[16] || ciphertext). The key is SHA-256 of OTP_SEAL_SECRET, so any
 * sufficiently long secret works and no key-derivation parameters have to be stored.
 */

export type SealDomain = 'otp' | 'oauth_state';

/**
 * `domain` keeps one secret from being used for two kinds of seal. It is optional and the default is
 * the original undecorated derivation so the handover codes already in the database stay readable.
 */
function key(domain?: SealDomain): Buffer {
  return createHash('sha256')
    .update(domain ? `${config.OTP_SEAL_SECRET}/${domain}` : config.OTP_SEAL_SECRET, 'utf8')
    .digest();
}

export function seal(plaintext: string, domain?: SealDomain): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(domain), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function open(sealed: string, domain?: SealDomain): string | null {
  try {
    const raw = Buffer.from(sealed, 'base64url');
    if (raw.length < 12 + 16 + 1) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key(domain), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key or tampered value. Callers treat null as "not available".
    return null;
  }
}
