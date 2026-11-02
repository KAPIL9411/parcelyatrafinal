import type { FastifyBaseLogger } from 'fastify';

import { config } from '../config.ts';

/**
 * OTP delivery provider abstraction.
 *
 * Providers
 * ---------
 *  log          Zero-cost pilot path: OTP goes to the structured operator log and is relayed out
 *               of band. Access to the log is equivalent to access to the account.
 *  fast2sms     Fast2SMS REST API — recommended for India without business/DLT registration.
 *               Fast2SMS handles DLT compliance internally on their own registered sender IDs.
 *               Sign up at https://fast2sms.com · Cost: ~₹0.07–₹0.12/SMS · No business reg needed.
 *  two_factor   2Factor.in REST API. Requires completed DLT registration (PE ID + Template ID
 *               + Sender ID) on a TRAI DLT portal. Without DLT, falls back to voice (~₹0.40/call).
 *  twilio       Legacy; kept for backward compatibility and staged rollback. Not the active path.
 *  none         Delivery disabled; useful in automated tests only.
 *
 * Security notes
 * --------------
 *  - Delivery is best-effort. The challenge is already committed by the time this runs, so a
 *    provider outage must not turn a committed challenge into a 500.
 *  - OTP values are NEVER logged in plaintext except by the intentional operator-log path.
 *  - No automatic silent failover between providers — ambiguous sends duplicate messages.
 *  - Provider session IDs are stored as metadata only; primary verification is our HMAC.
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

export interface DeliveryResult {
  outcome: DeliveryOutcome;
  /** Provider-specific session ID, stored for audit and optional re-verification. */
  providerSessionId?: string;
}

/**
 * Fast2SMS send-OTP.
 *
 * API endpoint: POST https://www.fast2sms.com/dev/bulkV2
 * Docs: https://docs.fast2sms.com
 *
 * Fast2SMS uses the "otp" route which uses their own DLT-approved templates and sender IDs.
 * No DLT registration or business registration is required from the developer.
 * Only supports Indian mobile numbers (10 digits, no country code in the request).
 *
 * Success: { return: true,  request_id: "...", ... }
 * Failure: { return: false, message: "...", ... }
 */
async function sendWithFast2SMS(
  log: FastifyBaseLogger,
  message: OtpMessage,
): Promise<DeliveryResult> {
  const apiKey = config.FAST2SMS_API_KEY!;

  // Fast2SMS expects a 10-digit Indian number. Strip the +91 prefix from E.164.
  const phone = message.phone.replace(/^\+91/, '');

  const reqBody = JSON.stringify({
    route: 'otp',
    variables_values: message.code,
    numbers: phone,
  });

  try {
    const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: reqBody,
      signal: AbortSignal.timeout(10_000),
    });

    const data = await res.json() as { return?: boolean; request_id?: string; message?: unknown };

    if (!data.return) {
      log.error(
        {
          purpose: message.purpose,
          reference: message.reference,
          provider_status: 'error',
          // message field can contain useful info — cap length to avoid free-form data in logs
          provider_code: typeof data.message === 'string' && data.message.length < 120
            ? data.message
            : '[redacted]',
        },
        'SMS provider rejected the message',
      );
      return { outcome: 'failed' };
    }

    return {
      outcome: 'sent',
      providerSessionId: typeof data.request_id === 'string' ? data.request_id : undefined,
    };
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === 'AbortError';
    log.error(
      { err: isTimeout ? 'timeout' : err, purpose: message.purpose, reference: message.reference },
      isTimeout ? 'SMS provider timed out' : 'SMS provider unreachable',
    );
    return { outcome: 'failed' };
  }
}

/**
 * 2Factor.in send-OTP.
 *
 * API endpoint (documented at https://2factor.in):
 *   GET https://2factor.in/API/V1/{api_key}/SMS/{phone}/{otp_value}[/{template_name}]
 *
 * Success: { "Status": "Success", "Details": "<session_id>" }
 * Failure: { "Status": "Error",   "Details": "<error_message>" }
 *
 * IMPORTANT: Without completed DLT registration (PE ID + Template ID + Sender ID on a TRAI
 * DLT portal), 2Factor falls back to Voice OTP delivery (~₹0.40/call vs ₹0.03/SMS).
 * Use fast2sms if you do not have a registered business for DLT.
 *
 * Design choices:
 *  - We generate the OTP on our side (not AUTOGEN), so we can store our HMAC for verification.
 *  - The returned session_id is stored as providerSessionId for supplementary audit metadata.
 *  - The phone number is passed in E.164 form (+91XXXXXXXXXX). 2Factor accepts this format.
 *  - We use a 10-second timeout. On timeout we return 'failed' — the challenge was already
 *    committed, so the user can retry via resend.
 */
async function sendWith2Factor(
  log: FastifyBaseLogger,
  message: OtpMessage,
): Promise<DeliveryResult> {
  const apiKey = config.TWO_FACTOR_API_KEY!;
  // Encode the phone number for URL safety (+ → %2B). E.164 is the documented format.
  const phone = encodeURIComponent(message.phone);
  const url = `https://2factor.in/API/V1/${encodeURIComponent(apiKey)}/SMS/${phone}/${encodeURIComponent(message.code)}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });

    const body = await res.json() as { Status?: string; Details?: string };

    if (body.Status !== 'Success') {
      // Log the provider's error category but never the API key or phone number.
      log.error(
        {
          purpose: message.purpose,
          reference: message.reference,
          provider_status: body.Status ?? 'unknown',
          // Details may contain a useful error code (not a secret) but we redact free-form text.
          provider_code: typeof body.Details === 'string' && body.Details.length < 80
            ? body.Details
            : '[redacted]',
        },
        'SMS provider rejected the message',
      );
      return { outcome: 'failed' };
    }

    return {
      outcome: 'sent',
      providerSessionId: typeof body.Details === 'string' ? body.Details : undefined,
    };
  } catch (err) {
    const isTimeout =
      err instanceof DOMException && err.name === 'AbortError';
    log.error(
      { err: isTimeout ? 'timeout' : err, purpose: message.purpose, reference: message.reference },
      isTimeout ? 'SMS provider timed out' : 'SMS provider unreachable',
    );
    return { outcome: 'failed' };
  }
}

/**
 * Send an OTP via the configured provider.
 *
 * Returns a DeliveryResult. Never throws — a delivery failure is logged and surfaced as 'failed'.
 * The caller must not treat a 'failed' outcome as a reason to silently fall back to another
 * provider or to send the OTP via a second channel simultaneously.
 */
export async function deliverOtp(
  log: FastifyBaseLogger,
  message: OtpMessage,
): Promise<DeliveryResult> {
  // Kill switch: if an operator needs to stop all OTP sends immediately (e.g. wallet abuse),
  // they can set OTP_KILL_SWITCH=true and restart the process.
  if (config.OTP_KILL_SWITCH) {
    log.warn(
      { purpose: message.purpose, reference: message.reference },
      'OTP send blocked: OTP_KILL_SWITCH is active',
    );
    return { outcome: 'disabled' };
  }

  if (config.SMS_PROVIDER === 'none') {
    log.warn(
      { purpose: message.purpose, reference: message.reference },
      'OTP delivery disabled (SMS_PROVIDER=none)',
    );
    return { outcome: 'disabled' };
  }

  if (config.SMS_PROVIDER === 'log') {
    // A single structured line written on purpose so an operator can relay the code out of band.
    // Access to the log is equivalent to access to the account — document this in ops runbooks.
    log.warn(
      {
        otp: message.code,
        purpose: message.purpose,
        reference: message.reference,
        delivery: 'operator-log',
      },
      'OTP issued — relay this code out of band',
    );
    return { outcome: 'logged' };
  }

  if (config.SMS_PROVIDER === 'fast2sms') {
    return sendWithFast2SMS(log, message);
  }

  if (config.SMS_PROVIDER === 'two_factor') {
    return sendWith2Factor(log, message);
  }

  if (config.SMS_PROVIDER === 'twilio') {
    try {
      const sid = config.TWILIO_ACCOUNT_SID!;
      const token = config.TWILIO_AUTH_TOKEN!;
      const body = new URLSearchParams({
        To: message.phone,
        From: config.TWILIO_FROM!,
        Body:
          `Parcel Yatra code: ${message.code}. ` +
          `It expires in ${Math.round(config.OTP_TTL_SECONDS / 60)} minutes. ` +
          `Never share it with anyone who is not completing this step.`,
      });

      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: AbortSignal.timeout(10_000),
        },
      );

      if (!res.ok) {
        log.error(
          { status: res.status, purpose: message.purpose, reference: message.reference },
          'SMS provider rejected the message',
        );
        return { outcome: 'failed' };
      }
      return { outcome: 'sent' };
    } catch (err) {
      log.error(
        { err, purpose: message.purpose, reference: message.reference },
        'SMS provider unreachable',
      );
      return { outcome: 'failed' };
    }
  }

  // Unreachable: the config schema validates SMS_PROVIDER.
  log.error({ purpose: message.purpose }, 'unknown SMS_PROVIDER — OTP not sent');
  return { outcome: 'failed' };
}
