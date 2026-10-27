import type { ApiError } from './api';

/**
 * Error copy.
 *
 * Every code the API can return is mapped to three things, in this order: what happened, what it
 * means for the parcel, and what to do now. Raw codes, HTTP statuses and submitted values never
 * reach the screen (ux/CONTENT_AND_MICROCOPY.md §4).
 */

export interface ErrorCopy {
  title: string;
  body: string;
  hint?: string;
}

const BY_CODE: Record<string, ErrorCopy> = {
  AUTH_REQUIRED: {
    title: 'Please sign in',
    body: 'This page needs a signed-in account.',
    hint: 'Sign in with Google, or with a phone number, to continue.',
  },
  AUTH_TOKEN_INVALID: { title: 'Your session ended', body: 'Sign in again to continue.' },
  AUTH_TOKEN_EXPIRED: { title: 'Your session ended', body: 'Sign in again to continue.' },
  AUTH_REFRESH_INVALID: { title: 'Your session ended', body: 'Sign in again to continue.' },
  AUTH_SESSION_REVOKED: { title: 'Your session ended', body: 'Sign in again to continue.' },

  OTP_INVALID: {
    title: "That code didn't match",
    body: 'Check the six digits and try again.',
  },
  OTP_EXPIRED: {
    title: 'That code has expired',
    body: 'Codes last five minutes. Ask for a new one.',
  },
  OTP_ALREADY_USED: { title: 'That code was already used', body: 'Ask for a new code.' },
  OTP_ATTEMPTS_EXCEEDED: {
    title: 'Too many tries',
    body: 'This code is locked. Try again in 15 minutes.',
  },
  OTP_RATE_LIMITED: {
    title: 'Too many codes requested',
    body: 'Wait a few minutes before asking for another one.',
  },
  OTP_CHALLENGE_NOT_FOUND: { title: 'That code is no longer valid', body: 'Ask for a new code.' },

  GOOGLE_OAUTH_DISABLED: {
    title: 'Google sign-in is switched off',
    body: 'This build has no Google credentials configured. Sign in with a phone number and a code instead.',
  },
  GOOGLE_AUTH_FAILED: {
    title: 'Google did not accept the sign-in',
    body: 'Nothing was created. Try again, or use a phone number and a code.',
  },
  INVALID_STATE: {
    title: 'That sign-in attempt has expired',
    body: 'A sign-in attempt is only good for ten minutes, and only in the browser that started it.',
    hint: 'Go back and press "Sign in with Google" again.',
  },

  FORBIDDEN: { title: 'Not available', body: 'This action is not available for this account.' },
  ROLE_REQUIRED: {
    title: 'Staff access only',
    body: 'This area is limited to Parcel Yatra operations staff.',
  },
  ACCOUNT_SUSPENDED: {
    title: 'This account is on hold',
    body: 'Contact support to resolve it before booking again.',
  },
  ACCOUNT_DELETED: { title: 'This account was deleted', body: 'Contact support if this was a mistake.' },

  VALIDATION_FAILED: {
    title: 'Check the details',
    body: 'One of the fields needs a different value.',
  },
  UNKNOWN_FIELD: { title: 'Check the details', body: 'One of the fields is not recognised.' },
  INVALID_PHONE: {
    title: 'That number looks wrong',
    body: 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.',
  },
  INVALID_WINDOW: { title: 'That window is not valid', body: 'Pick a start and end within the next 7 days.' },
  WINDOW_INVALID: { title: 'That window is not valid', body: 'Pick a start and end within the next 7 days.' },

  IDEMPOTENCY_KEY_REQUIRED: { title: 'Please try again', body: 'The request was missing its retry key.' },
  IDEMPOTENCY_KEY_REUSED: {
    title: 'That request was already used',
    body: 'Start the action again from the beginning.',
  },
  REQUEST_IN_PROGRESS: { title: 'Still working on it', body: 'Wait a moment and check again.' },

  PHONE_NOT_VERIFIED: {
    title: 'Verify your phone first',
    body: 'This step needs a verified phone number. Verify it from your profile and try again.',
  },
  CONTACT_NOT_VERIFIED: {
    title: 'Confirm how to reach you',
    body: 'We need a verified contact channel before a parcel can be posted — signing in with Google does this.',
  },
  ITEM_PROHIBITED: {
    title: "We can't carry this",
    body: "It's on our list of items we don't accept.",
    hint: 'Read the prohibited items list before you pack.',
  },
  PARCEL_TOO_LARGE: {
    title: 'This parcel is over the launch limit',
    body: 'At launch we carry up to 5 kg and 45 cm on each side.',
  },
  VALUE_ABOVE_PILOT_LIMIT: {
    title: 'Declared value is too high',
    body: "We only carry items worth up to ₹5,000 right now, because parcels aren't insured yet.",
  },
  CITY_NOT_SERVICED: {
    title: 'That route is not open yet',
    body: 'We currently run Bareilly ⇄ Delhi NCR and Bareilly ⇄ Lucknow.',
  },
  MANUAL_REVIEW_REQUIRED: {
    title: 'This needs a quick human check',
    body: "Usually within 2 hours. We'll text you.",
  },
  RISK_REVIEW_REQUIRED: {
    title: 'This needs a quick human check',
    body: "Usually within 2 hours. We'll text you.",
  },
  DESCRIPTION_TOO_VAGUE: {
    title: 'Please be specific',
    body: 'Tell us what is inside the parcel in a few words.',
  },
  CANCELLATION_LIMIT: {
    title: 'Too many cancellations',
    body: 'You can post again after a short pause. Contact support if this is unexpected.',
  },
  MODE_DISABLED: {
    title: 'That travel mode is not open',
    body: 'At launch, only car travellers can carry parcels.',
  },

  VERIFICATION_REQUIRED: {
    title: 'Verify your ID first',
    body: 'Only verified travellers can publish a trip.',
    hint: 'Verification usually takes under 24 hours.',
  },

  TRIP_WINDOW_INVALID: {
    title: 'Check the trip times',
    body: 'The arrival must be after the departure, and the departure cannot be in the past.',
    hint: 'Nothing was changed on your trip.',
  },
  TRIP_CAPACITY_INVALID: { title: 'Check the capacity', body: 'Capacity must be between 1 and 20 kg.' },
  TRIP_EDIT_BREAKS_BOOKING: {
    title: 'That change would strand a booked parcel',
    body: 'A parcel you have already accepted would fall outside this trip.',
    hint: 'Nothing was changed. Move the trip so it still covers that parcel, or cancel the booking first.',
  },

  NO_MATCH: {
    title: 'No traveller matches this route and time yet',
    body: 'Widen your window, or we can tell you when someone posts a matching trip.',
  },
  TRIP_NOT_AVAILABLE: {
    title: 'That trip is no longer available',
    body: 'The traveller may have cancelled or filled the space.',
  },
  SELF_BOOKING_FORBIDDEN: {
    title: "You can't carry your own parcel",
    body: 'Choose a different traveller for this booking.',
  },
  USER_BLOCKED: { title: 'This booking is not possible', body: 'Contact support for help with this account.' },
  CAPACITY_UNAVAILABLE: {
    title: 'That space was just taken',
    body: 'Here are other travellers on your route.',
  },
  BOOKING_ALREADY_ACTIVE: {
    title: 'This parcel already has a booking',
    body: 'Open the existing booking instead of creating a second one.',
  },
  QUOTE_EXPIRED: {
    title: 'This price has expired',
    body: 'Refresh the price — it may have changed.',
  },
  QUOTE_MISMATCH: { title: 'That price does not match', body: 'Refresh the quote and try again.' },

  INVALID_TRANSITION: {
    title: 'That step is not available',
    body: 'The booking has moved on. Reload to see where it stands.',
  },
  TRANSITION_CONFLICT: {
    title: 'Someone else acted first',
    body: 'Reload the booking to see the current state.',
  },
  TRANSITION_NOT_PERMITTED: {
    title: 'Not your step',
    body: 'Only the other side can do this one.',
  },
  HANDOVER_NOT_ALLOWED_IN_STATE: {
    title: 'Handover is not open yet',
    body: 'This step becomes available when the booking reaches the handover stage.',
  },
  ACCEPT_WINDOW_CLOSED: {
    title: 'The 30-minute window closed',
    body: 'The booking expired before the traveller accepted. Post the parcel again to retry.',
  },
  PARCEL_HAS_ACTIVE_BOOKING: {
    title: 'This parcel has an active booking',
    body: 'Cancel the booking before cancelling the parcel.',
  },
  TRIP_HAS_ACCEPTED_BOOKING: {
    title: 'This trip has an accepted booking',
    body: 'Cancel the booking first, or contact support.',
  },
  BOOKING_LOCKED: {
    title: 'This booking is paused',
    body: "This booking is paused so our team can check it. We'll call you shortly.",
  },
  OTP_NOT_APPLICABLE: {
    title: 'No code is active',
    body: 'The code has been used or the booking is not at this step.',
  },
  PHOTO_REQUIRED: {
    title: 'A photo is needed',
    body: 'Photograph the sealed parcel so both sides have a record of how it left.',
  },
  HANDOVER_REFUSED_OVERWEIGHT: {
    title: 'Weight does not match',
    body: 'The parcel is heavier than declared. There is no penalty for refusing it.',
  },
  HANDOVER_REFUSED_SEAL: {
    title: 'Seal is not intact',
    body: 'The parcel was not sealed. There is no penalty for refusing it.',
  },

  PAYMENTS_NOT_ENABLED: {
    title: "Payments aren't enabled yet",
    body: 'This build runs with sandbox payments only.',
  },
  PAYOUTS_NOT_ENABLED: {
    title: 'Payouts are disabled at launch',
    body: 'No money can be released from this build. This is deliberate.',
  },
  SPLIT_SETTLEMENT_NOT_ENABLED: {
    title: 'Split settlement is not available yet',
    body: 'We cannot split a booking between both sides. Record the outcome that matches what you decided, or escalate.',
  },
  PAYMENT_ALREADY_EXISTS: {
    title: 'A payment is already set up',
    body: 'Open the existing payment instead of starting another.',
  },
  PAYMENT_NOT_PAYABLE: {
    title: 'This booking is not payable right now',
    body: 'Reload the booking to see its current state.',
  },
  PAYMENT_PROVIDER_UNAVAILABLE: {
    title: "Your bank hasn't confirmed yet",
    body: "Don't pay again — we'll text you within 15 minutes.",
  },
  PAYMENT_STATE_UNKNOWN: {
    title: "We're checking the payment",
    body: "Don't pay again — we'll text you within 15 minutes.",
  },
  REFUND_EXCEEDS_CAPTURED_AMOUNT: {
    title: 'That refund is too large',
    body: 'It is more than the amount captured for this booking.',
  },
  APPROVAL_REQUIRED: {
    title: 'A second approval is needed',
    body: 'This amount is above the dual-approval threshold.',
  },
  SELF_APPROVAL_FORBIDDEN: {
    title: 'A different approver is needed',
    body: 'The person who requested a refund cannot approve it.',
  },
  PAYOUT_NOT_ELIGIBLE: {
    title: 'This payout is not eligible',
    body: 'The booking is not settled, a dispute is open, or the traveller is not active.',
  },

  DISPUTE_WINDOW_CLOSED: {
    title: 'The dispute window has closed',
    body: 'Contact support if you still need help with this booking.',
  },
  DISPUTE_ALREADY_OPEN: {
    title: 'A case is already open',
    body: 'Add evidence to the existing case instead of opening a second one.',
  },
  DISPUTE_CLOSED: { title: 'This case is closed', body: 'Contact support if you want it reviewed again.' },
  REVIEW_ALREADY_SUBMITTED: { title: 'You already rated this booking', body: 'Ratings cannot be changed.' },
  REVIEW_WINDOW_CLOSED: { title: 'The rating window closed', body: 'Ratings are open for 7 days after delivery.' },

  UPLOAD_INVALID_TYPE: {
    title: 'That file type is not supported',
    body: 'Use a JPEG or PNG photo.',
  },
  UPLOAD_TOO_LARGE: { title: 'That photo is too large', body: 'The limit is 10 MB.' },
  UPLOAD_URL_EXPIRED: { title: 'The upload link expired', body: 'Try the upload again.' },
  UPLOAD_NOT_CONFIRMED: { title: 'The upload did not finish', body: 'Try the upload again.' },

  RATE_LIMITED: { title: 'Too many requests', body: 'Wait a minute and try again.' },
  NOT_FOUND: {
    title: 'We could not find that',
    body: 'The link may be old, or the item belongs to another account.',
  },
  METHOD_NOT_ALLOWED: { title: 'That action is not available', body: 'Reload the page and try again.' },
  CONFLICT: {
    title: 'That could not be completed',
    body: 'The item changed while you were looking at it. Reload and try again.',
  },
  INTERNAL_ERROR: {
    title: 'Something went wrong on our side',
    body: 'Our team can look it up with the reference below.',
  },
  SERVICE_UNAVAILABLE: { title: 'We are temporarily unavailable', body: 'Try again in a moment.' },
  DEPENDENCY_TIMEOUT: { title: 'A service took too long', body: 'Try again in a moment.' },
};

const BY_STATUS: Record<number, ErrorCopy> = {
  0: { title: 'No connection', body: 'Check your network and try again.' },
  401: BY_CODE.AUTH_REQUIRED!,
  403: BY_CODE.FORBIDDEN!,
  404: BY_CODE.NOT_FOUND!,
  409: BY_CODE.CONFLICT!,
  422: BY_CODE.VALIDATION_FAILED!,
  429: BY_CODE.RATE_LIMITED!,
  500: BY_CODE.INTERNAL_ERROR!,
  501: { title: 'Not available in this build', body: 'This feature is switched off at launch.' },
  503: BY_CODE.SERVICE_UNAVAILABLE!,
};

/**
 * The engine's own gate names, in the traveller's terms.
 *
 * A refused trip edit arrives with the gate the booked parcel actually failed, so this is a
 * translation table and not a guess about why the change was refused.
 */
const TRIP_GATE_COPY: Record<string, string> = {
  DEPARTS_AFTER_WINDOW: 'You would leave after the sender needs the parcel collected.',
  ARRIVES_TOO_LATE: 'You would arrive after that parcel is due.',
  NO_CAPACITY: 'That parcel is heavier than the space you are leaving yourself.',
  WINDOW_TOO_TIGHT: "The sender's delivery window would no longer cover this trip.",
  CATEGORY_NOT_ACCEPTED: 'That parcel is a kind your trip would stop accepting.',
  PARCEL_TOO_LARGE: 'That parcel would no longer fit the limits of this trip.',
  ITEM_PROHIBITED: 'That parcel is not something a trip can carry.',
  TRAVELLER_NOT_VERIFIED: 'This trip would lose the verification that lets it carry parcels.',
  PARCEL_NOT_OPEN: 'That parcel is no longer open, so the booking needs staff attention.',
};

export function errorCopy(error: unknown): ErrorCopy {
  if (error && typeof error === 'object' && 'code' in error && 'status' in error) {
    const apiError = error as ApiError;
    const mapped = BY_CODE[apiError.code] ?? BY_STATUS[apiError.status];
    if (mapped) {
      const details = apiError.details ?? {};
      // OTP_INVALID carries the remaining attempt count; say it rather than making the user guess.
      const remaining = apiError.details?.attempts_remaining;
      if (apiError.code === 'OTP_INVALID' && typeof remaining === 'number') {
        return { ...mapped, body: `${remaining} ${remaining === 1 ? 'try' : 'tries'} left.` };
      }
      // The server names the smallest capacity that still holds what is booked; quoting it is more use
      // than the generic 1–20 kg range, which is a different mistake.
      if (apiError.code === 'TRIP_CAPACITY_INVALID' && typeof details.min_capacity_kg === 'number') {
        const held = typeof details.bookings_held === 'number' ? details.bookings_held : 1;
        return {
          title: mapped.title,
          body: `You are already carrying ${held} booked ${held === 1 ? 'parcel' : 'parcels'} on this trip. The smallest capacity that keeps ${held === 1 ? 'it' : 'them'} is ${details.min_capacity_kg} kg.`,
          hint: 'Nothing was changed on your trip.',
        };
      }
      if (apiError.code === 'TRIP_EDIT_BREAKS_BOOKING') {
        const gate = typeof details.reason === 'string' ? TRIP_GATE_COPY[details.reason] : undefined;
        return { ...mapped, body: gate ?? mapped.body };
      }
      return mapped;
    }
  }

  if (error instanceof TypeError) {
    return {
      title: 'No connection',
      body: 'We could not reach the server. Check your network and try again.',
    };
  }

  return {
    title: 'That did not work',
    body: 'Try again. If it keeps happening, contact support with the reference below.',
  };
}

export function verificationReason(reasonCode: string | null): string {
  switch (reasonCode) {
    case 'id_unreadable':
      return 'The photo was too blurry to read the number.';
    case 'id_expired':
      return 'The ID has expired.';
    case 'id_mismatch':
      return 'The name on the ID did not match your account.';
    case 'selfie_mismatch':
      return 'The selfie did not match the photo on the ID.';
    case 'suspected_forgery':
      return 'The document could not be accepted.';
    case 'incomplete_document':
      return 'Part of the document was missing.';
    case 'id_clear':
      return 'The document was accepted.';
    default:
      return 'No reason was recorded. Contact support and we will explain.';
  }
}
