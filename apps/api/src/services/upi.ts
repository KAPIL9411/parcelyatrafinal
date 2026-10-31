import { randomBytes } from 'node:crypto';

import { config } from '../config.ts';

/**
 * Direct UPI collection.
 *
 * There is no gateway in this path and therefore no callback: the payer's app opens with the amount
 * and our reference already filled in, money lands in the merchant's UPI handle, and a finance
 * operator matches the bank line to the reference before the payment is recorded. Nothing in this
 * module ever claims money arrived — that is the operator's UTR, entered against the payment row.
 */

const REFERENCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Ten characters: short enough to read over the phone, wide enough to stay unique at pilot volume. */
export function newUpiReference(): string {
  let out = 'PY';
  for (const byte of randomBytes(8)) out += REFERENCE_ALPHABET[byte % REFERENCE_ALPHABET.length];
  return out;
}

/** Paise to the exact rupee string a UPI app expects, without floating-point arithmetic. */
export function rupeesString(amountPaise: number): string {
  const rupees = Math.floor(amountPaise / 100);
  const paise = amountPaise % 100;
  return `${rupees}.${String(paise).padStart(2, '0')}`;
}

/**
 * UPI intent link. `tr` is the transaction reference the payer's app records and `tn` is the note on
 * the statement; both carry our reference so the bank line can be matched without guesswork.
 *
 * `@` is left unencoded — it is the delimiter every UPI app expects in `pa`, and percent-encoding it
 * is the one thing that reliably breaks the link on older builds.
 */
export function upiPaymentLink(amountPaise: number, reference: string): string {
  const fields: Array<[string, string]> = [
    ['pa', config.UPI_VPA ?? ''],
    ['pn', config.UPI_PAYEE_NAME ?? ''],
    ['am', rupeesString(amountPaise)],
    ['cu', config.PAYMENT_CURRENCY],
    ['tr', reference],
    ['tn', reference],
  ];
  const query = fields.map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%40/g, '@')}`).join('&');
  return `upi://pay?${query}`;
}
