/**
 * Error envelope. Every code returned by this server exists in api/ERROR_CATALOG.md.
 * A code not in that catalogue is a contract failure, so the table below is closed.
 */

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_TOKEN_INVALID'
  | 'AUTH_TOKEN_EXPIRED'
  | 'AUTH_REFRESH_INVALID'
  | 'AUTH_REFRESH_REUSE'
  | 'AUTH_SESSION_REVOKED'
  | 'OTP_INVALID'
  | 'OTP_EXPIRED'
  | 'OTP_ALREADY_USED'
  | 'OTP_ATTEMPTS_EXCEEDED'
  | 'OTP_RATE_LIMITED'
  | 'OTP_CHALLENGE_NOT_FOUND'
  | 'GOOGLE_OAUTH_DISABLED'
  | 'GOOGLE_AUTH_FAILED'
  | 'INVALID_STATE'
  | 'EMAIL_ALREADY_REGISTERED'
  | 'FORBIDDEN'
  | 'ROLE_REQUIRED'
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_DELETED'
  | 'TRANSITION_NOT_PERMITTED'
  | 'VALIDATION_FAILED'
  | 'UNKNOWN_FIELD'
  | 'INVALID_UUID'
  | 'INVALID_PHONE'
  | 'INVALID_WINDOW'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'REQUEST_IN_PROGRESS'
  | 'PAYLOAD_TOO_LARGE'
  | 'PHONE_NOT_VERIFIED'
  | 'CONTACT_NOT_VERIFIED'
  | 'ITEM_PROHIBITED'
  | 'PARCEL_TOO_LARGE'
  | 'VALUE_ABOVE_PILOT_LIMIT'
  | 'CITY_NOT_SERVICED'
  | 'WINDOW_INVALID'
  | 'MANUAL_REVIEW_REQUIRED'
  | 'RISK_REVIEW_REQUIRED'
  | 'CANCELLATION_LIMIT'
  | 'DESCRIPTION_TOO_VAGUE'
  | 'MODE_DISABLED'
  | 'VERIFICATION_REQUIRED'
  | 'TRIP_WINDOW_INVALID'
  | 'TRIP_CAPACITY_INVALID'
  | 'NO_MATCH'
  | 'TRIP_NOT_AVAILABLE'
  | 'OPPORTUNITY_NOT_AVAILABLE'
  | 'SELF_BOOKING_FORBIDDEN'
  | 'USER_BLOCKED'
  | 'CAPACITY_UNAVAILABLE'
  | 'BOOKING_ALREADY_ACTIVE'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_MISMATCH'
  | 'INVALID_TRANSITION'
  | 'TRANSITION_CONFLICT'
  | 'HANDOVER_NOT_ALLOWED_IN_STATE'
  | 'ACCEPT_WINDOW_CLOSED'
  | 'PARCEL_HAS_ACTIVE_BOOKING'
  | 'TRIP_HAS_ACCEPTED_BOOKING'
  | 'TRIP_EDIT_BREAKS_BOOKING'
  | 'BOOKING_LOCKED'
  | 'OTP_NOT_APPLICABLE'
  | 'PHOTO_REQUIRED'
  | 'PAYMENTS_NOT_ENABLED'
  | 'PAYOUTS_NOT_ENABLED'
  | 'SPLIT_SETTLEMENT_NOT_ENABLED'
  | 'BACKGROUND_WORKER_UNAVAILABLE'
  | 'PAYMENT_ALREADY_EXISTS'
  | 'PAYMENT_NOT_PAYABLE'
  | 'PAYMENT_PROVIDER_UNAVAILABLE'
  | 'REFUND_EXCEEDS_CAPTURED_AMOUNT'
  | 'APPROVAL_REQUIRED'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'PAYOUT_NOT_ELIGIBLE'
  | 'DISPUTE_WINDOW_CLOSED'
  | 'DISPUTE_ALREADY_OPEN'
  | 'DISPUTE_CLOSED'
  | 'REVIEW_ALREADY_SUBMITTED'
  | 'REVIEW_WINDOW_CLOSED'
  | 'CONVERSATION_CLOSED'
  | 'UPLOAD_INVALID_TYPE'
  | 'UPLOAD_TOO_LARGE'
  | 'UPLOAD_EXPIRED'
  | 'WEBHOOK_SIGNATURE_INVALID'
  | 'WEBHOOK_TIMESTAMP_INVALID'
  | 'WEBHOOK_UNKNOWN_TYPE'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'INTERNAL_ERROR';

interface Spec {
  status: number;
  /** Safe, user-presentable. Never contains internals. */
  message: string;
}

export const ERROR_TABLE: Record<ErrorCode, Spec> = {
  AUTH_REQUIRED: { status: 401, message: 'Please sign in to continue.' },
  AUTH_TOKEN_INVALID: { status: 401, message: 'Your session is invalid. Please sign in again.' },
  AUTH_TOKEN_EXPIRED: { status: 401, message: 'Your session expired. Please sign in again.' },
  AUTH_REFRESH_INVALID: { status: 401, message: 'Please sign in again.' },
  AUTH_REFRESH_REUSE: { status: 401, message: 'For your security we signed you out of all devices.' },
  AUTH_SESSION_REVOKED: { status: 401, message: 'Please sign in again.' },
  OTP_INVALID: { status: 400, message: "That code isn't right." },
  OTP_EXPIRED: { status: 400, message: 'That code has expired. Send a new one.' },
  OTP_ALREADY_USED: { status: 400, message: 'That code has already been used.' },
  OTP_ATTEMPTS_EXCEEDED: { status: 429, message: 'Too many attempts. Try again later.' },
  GOOGLE_OAUTH_DISABLED: { status: 400, message: 'Google Sign-In is not enabled.' },
  GOOGLE_AUTH_FAILED: { status: 400, message: 'Google authentication failed.' },
  INVALID_STATE: { status: 400, message: 'Invalid sign-in request. Please try again.' },
  EMAIL_ALREADY_REGISTERED: { status: 409, message: 'This email is already registered with a different account.' },
  OTP_RATE_LIMITED: { status: 429, message: 'Please wait before requesting another code.' },
  OTP_CHALLENGE_NOT_FOUND: { status: 400, message: 'Start again.' },
  FORBIDDEN: { status: 403, message: 'You cannot do that.' },
  ROLE_REQUIRED: { status: 403, message: 'This area needs a staff role you do not have.' },
  ACCOUNT_SUSPENDED: { status: 403, message: 'This account is suspended.' },
  ACCOUNT_DELETED: { status: 403, message: 'This account is being deleted.' },
  TRANSITION_NOT_PERMITTED: { status: 403, message: 'That action is not available to you.' },
  VALIDATION_FAILED: { status: 400, message: 'Please check the highlighted fields.' },
  UNKNOWN_FIELD: { status: 400, message: 'That request contains a field we do not accept.' },
  INVALID_UUID: { status: 400, message: 'That identifier is not valid.' },
  INVALID_PHONE: { status: 400, message: 'Enter a valid Indian mobile number.' },
  INVALID_WINDOW: { status: 400, message: 'Choose a valid delivery window.' },
  IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'This action needs a request key. Reload and try again.' },
  IDEMPOTENCY_KEY_REUSED: { status: 409, message: 'This request was already used for a different action.' },
  REQUEST_IN_PROGRESS: { status: 409, message: 'That request is still being processed.' },
  PAYLOAD_TOO_LARGE: { status: 413, message: 'That file or request is too large.' },
  PHONE_NOT_VERIFIED: { status: 403, message: 'Verify your phone number first.' },
  CONTACT_NOT_VERIFIED: { status: 403, message: 'Sign in with a verified email or phone number first.' },
  ITEM_PROHIBITED: { status: 422, message: 'We do not carry that item.' },
  PARCEL_TOO_LARGE: { status: 422, message: 'Parcels are capped at 5 kg and 45 cm.' },
  VALUE_ABOVE_PILOT_LIMIT: { status: 422, message: 'Declared value is capped at ₹5,000.' },
  CITY_NOT_SERVICED: { status: 422, message: 'We do not serve this route yet.' },
  WINDOW_INVALID: { status: 422, message: 'The delivery window must be in the next 7 days.' },
  MANUAL_REVIEW_REQUIRED: { status: 202, message: 'This needs a quick human check.' },
  RISK_REVIEW_REQUIRED: { status: 403, message: 'This account is under review. Contact support.' },
  CANCELLATION_LIMIT: { status: 403, message: 'Too many recent cancellations.' },
  DESCRIPTION_TOO_VAGUE: { status: 422, message: 'Please be specific about what is inside.' },
  MODE_DISABLED: { status: 422, message: 'That travel mode is not available yet.' },
  VERIFICATION_REQUIRED: { status: 403, message: 'Complete ID verification first.' },
  TRIP_WINDOW_INVALID: { status: 422, message: 'Check the departure and arrival times.' },
  TRIP_CAPACITY_INVALID: { status: 422, message: 'Capacity must be between 0 and 20 kg.' },
  NO_MATCH: { status: 409, message: 'No traveller matches this route and window yet.' },
  TRIP_NOT_AVAILABLE: { status: 409, message: 'That trip is no longer available.' },
  OPPORTUNITY_NOT_AVAILABLE: {
    status: 409,
    message: 'This parcel no longer fits your trip. Refresh the list before offering again.',
  },
  SELF_BOOKING_FORBIDDEN: { status: 403, message: 'You cannot book your own trip.' },
  USER_BLOCKED: { status: 403, message: 'This pairing is not available.' },
  CAPACITY_UNAVAILABLE: { status: 409, message: 'That traveller just filled up. Try another match.' },
  BOOKING_ALREADY_ACTIVE: { status: 409, message: 'This parcel already has an active booking.' },
  QUOTE_EXPIRED: { status: 409, message: 'This price has expired. Refresh it to continue.' },
  QUOTE_MISMATCH: { status: 409, message: 'That price does not belong to this parcel.' },
  INVALID_TRANSITION: { status: 409, message: 'That step is not possible from the current state.' },
  TRANSITION_CONFLICT: { status: 409, message: 'Someone else updated this booking. Reload.' },
  HANDOVER_NOT_ALLOWED_IN_STATE: { status: 409, message: 'Handover is not open yet.' },
  ACCEPT_WINDOW_CLOSED: { status: 409, message: 'The 30-minute acceptance window has closed.' },
  PARCEL_HAS_ACTIVE_BOOKING: { status: 409, message: 'This parcel is already booked.' },
  TRIP_HAS_ACCEPTED_BOOKING: { status: 409, message: 'Cancel the booking first.' },
  TRIP_EDIT_BREAKS_BOOKING: {
    status: 409,
    message: 'That change would leave a parcel you already accepted outside your trip.',
  },
  BOOKING_LOCKED: { status: 423, message: 'This booking is locked while our team reviews it.' },
  OTP_NOT_APPLICABLE: { status: 409, message: 'That code is not used at this step.' },
  PHOTO_REQUIRED: { status: 400, message: 'A photo is required.' },
  PAYMENTS_NOT_ENABLED: { status: 501, message: 'Payments are not enabled in this environment.' },
  PAYOUTS_NOT_ENABLED: { status: 501, message: 'Payouts are not enabled.' },
  SPLIT_SETTLEMENT_NOT_ENABLED: { status: 501, message: 'Split settlement is not enabled.' },
  BACKGROUND_WORKER_UNAVAILABLE: {
    status: 501,
    message: 'This deployment has no background worker. The action cannot be completed here.',
  },
  PAYMENT_ALREADY_EXISTS: { status: 409, message: 'A payment already exists for this booking.' },
  PAYMENT_NOT_PAYABLE: { status: 409, message: 'This booking is not payable right now.' },
  PAYMENT_PROVIDER_UNAVAILABLE: { status: 503, message: 'The payment provider did not respond. Nothing was charged.' },
  REFUND_EXCEEDS_CAPTURED_AMOUNT: { status: 409, message: 'That refund is larger than the amount captured.' },
  APPROVAL_REQUIRED: { status: 409, message: 'This amount needs a second approver.' },
  SELF_APPROVAL_FORBIDDEN: { status: 403, message: 'You cannot approve your own request.' },
  PAYOUT_NOT_ELIGIBLE: { status: 409, message: 'This payout is not eligible yet.' },
  DISPUTE_WINDOW_CLOSED: { status: 409, message: 'The dispute window has closed.' },
  DISPUTE_ALREADY_OPEN: { status: 409, message: 'A dispute is already open for this booking.' },
  DISPUTE_CLOSED: { status: 409, message: 'This dispute is closed.' },
  REVIEW_ALREADY_SUBMITTED: { status: 409, message: 'You already rated this booking.' },
  REVIEW_WINDOW_CLOSED: { status: 409, message: 'The rating window has closed.' },
  CONVERSATION_CLOSED: { status: 409, message: 'This delivery is closed, so the chat is read-only.' },
  UPLOAD_INVALID_TYPE: { status: 400, message: 'Upload a JPEG or PNG.' },
  UPLOAD_TOO_LARGE: { status: 400, message: 'Files must be 10 MB or smaller.' },
  UPLOAD_EXPIRED: {
    status: 400,
    message: 'The uploaded photos are no longer available. Attach them again.',
  },
  WEBHOOK_SIGNATURE_INVALID: { status: 401, message: 'Signature check failed.' },
  WEBHOOK_TIMESTAMP_INVALID: { status: 401, message: 'Timestamp outside tolerance.' },
  WEBHOOK_UNKNOWN_TYPE: { status: 400, message: 'Unknown event type.' },
  RATE_LIMITED: { status: 429, message: 'Too many requests. Please slow down.' },
  NOT_FOUND: { status: 404, message: 'We could not find that.' },
  METHOD_NOT_ALLOWED: { status: 405, message: 'That method is not supported here.' },
  CONFLICT: { status: 409, message: 'That changed while you were working. Reload.' },
  INTERNAL_ERROR: { status: 500, message: 'Something went wrong on our side.' },
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, details?: Record<string, unknown>, messageOverride?: string) {
    const spec = ERROR_TABLE[code];
    super(messageOverride ?? spec.message);
    this.name = 'AppError';
    this.code = code;
    this.status = spec.status;
    this.details = details;
  }
}

export const notFound = () => new AppError('NOT_FOUND');

export interface ErrorEnvelopeBody {
  error: {
    code: string;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

export function errorEnvelope(
  code: string,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ErrorEnvelopeBody {
  return {
    error: {
      code,
      message: message.slice(0, 300),
      request_id: requestId,
      ...(details ? { details } : {}),
    },
  };
}
