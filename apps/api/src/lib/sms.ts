import type { FastifyBaseLogger } from 'fastify';

import { config } from '../config.ts';

/**
 * OTP delivery.
 *
 * The pilot's zero-cost path is `log`: the code is written once to the operator log and relayed to
 * the person out of band (a phone call or a WhatsApp message from the operator). It is never
 * returned to the client and never stored in plaintext.
 *
 * `twilio` is implemented but off by default. Indian transactional SMS also needs DLT registration
 * for the sender and template, which is a commercial/regulatory step this repository cannot do.
 * `none` disables delivery entirely and is only useful for automated tests.
 *
 * Treat delivery as best-effort: the API has already committed the challenge by the time this runs,
 * so a provider outage must not turn a successful request into a 500.
 */

export type OtpPurpose = 'login' | 'pickup' | 'delivery';

export interface OtpMessage {
  /** E.164. Never logged. */
  phone: string;
  code: string;
  purpose: OtpPurpose;
  reference: string;
}

export type DeliveryOutcome = 'sent' | 'logged' | 'disabled' | 'failed';

export async function deliverOtp(log: FastifyBaseLogger, message: OtpMessage): Promise<DeliveryOutcome> {
  if (config.SMS_PROVIDER === 'none') {
    log.warn({ purpose: message.purpose, reference: message.reference }, 'OTP delivery disabled (SMS_PROVIDER=none)');
    return 'disabled';
  }

  if (config.SMS_PROVIDER === 'log') {
    // A single structured line. The `otp` field is redacted from request logs elsewhere; this line
    // is written on purpose so an operator can relay the code. Access to the log is equivalent to
    // access to the account, which is why it is called out in docs/DEPLOY_ZERO_COST.md.
    log.warn(
      {
        otp: message.code,
        purpose: message.purpose,
        reference: message.reference,
        delivery: 'operator-log',
      },
      'OTP issued — relay this code out of band',
    );
    return 'logged';
  }

  try {
    const sid = config.TWILIO_ACCOUNT_SID!;
    const token = config.TWILIO_AUTH_TOKEN!;
    const body = new URLSearchParams({
      To: message.phone,
      From: config.TWILIO_FROM!,
      Body: `Parcel Yatra code: ${message.code}. It expires in ${Math.round(config.OTP_TTL_SECONDS / 60)} minutes. Never share it with anyone who is not completing this step.`,
    });

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log.error(
        { status: res.status, purpose: message.purpose, reference: message.reference },
        'SMS provider rejected the message',
      );
      return 'failed';
    }
    return 'sent';
  } catch (err) {
    log.error({ err, purpose: message.purpose, reference: message.reference }, 'SMS provider unreachable');
    return 'failed';
  }
}
