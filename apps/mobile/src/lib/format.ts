import { ApiError } from '../api/http.ts';

export function inr(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
}

export function kg(value: number): string {
  return `${Number(value.toFixed(1))} kg`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function initials(name: string | null | undefined): string {
  const clean = (name ?? '').trim();
  if (!clean) return 'PY';
  return clean
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Accepts `98765 43210`, `09876543210`, `+91 98765-43210`; returns `+919876543210` or null. */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.replace(/^0/, '');
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return `+91${local}`;
}

export function maskPhone(input: string): string {
  const digits = input.replace(/[^\d]/g, '');
  return digits.length >= 4 ? `••••••${digits.slice(-4)}` : '••••••';
}

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  pending_traveller_acceptance: 'Waiting for traveller',
  payment_pending: 'Payment pending',
  confirmed: 'Confirmed',
  pickup_ready: 'Pickup open',
  picked_up: 'Picked up',
  in_transit: 'On the way',
  arrived: 'Arrived',
  delivery_attempt_failed: 'Delivery attempted',
  delivered: 'Delivered',
  payout_eligible: 'Window closed',
  paid_out: 'Paid out',
  disputed: 'Disputed',
  incident_open: 'Support involved',
  locked_for_review: 'Paused for review',
  cancelled_by_sender: 'Cancelled by sender',
  cancelled_by_traveller: 'Cancelled by traveller',
  cancelled_ineligible: 'Cancelled — ineligible',
  cancelled_safety: 'Cancelled for safety',
  expired: 'Expired',
  refunded: 'Refunded',
  posted: 'Posted',
  matched: 'Traveller chosen',
  review_pending: 'Under review',
  open: 'Open',
  approved: 'Approved',
  verified: 'Verified',
  pending: 'Pending review',
  rejected: 'Not approved',
  not_started: 'Not started',
  in_review: 'In review',
  published: 'Published',
  partially_booked: 'Partly booked',
  full: 'Full',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
  active: 'Active',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, ' ');
}

export function statusTone(status: string): 'neutral' | 'info' | 'success' | 'warn' | 'danger' {
  if (['delivered', 'paid_out', 'payout_eligible', 'approved', 'verified', 'completed', 'confirmed'].includes(status)) return 'success';
  if (['pending_traveller_acceptance', 'payment_pending', 'pickup_ready', 'in_transit', 'picked_up', 'arrived', 'partially_booked', 'published', 'matched'].includes(status)) return 'info';
  if (['disputed', 'incident_open', 'locked_for_review', 'delivery_attempt_failed', 'review_pending', 'in_review', 'pending', 'full'].includes(status)) return 'warn';
  if (status.startsWith('cancelled') || ['expired', 'refunded', 'rejected'].includes(status)) return 'danger';
  return 'neutral';
}

/**
 * What the status means for the person reading it. Two maps, not one: "The traveller has your
 * parcel" is wrong when the traveller reads it. Mirrors `packages/domain/src/enums.ts`.
 */
const SENDER_HINTS: Record<string, string> = {
  draft: 'Not sent yet.',
  pending_traveller_acceptance: 'The traveller has 30 minutes to accept.',
  payment_pending: 'Accepted. The booking confirms once payment completes.',
  confirmed: 'Both sides committed. Pickup instructions are being prepared.',
  pickup_ready: 'Share the pickup code with the traveller in person.',
  picked_up: 'The traveller has your parcel.',
  in_transit: 'Your parcel is on the way.',
  arrived: 'The traveller has reached the destination city.',
  delivered: 'Delivered. The problem window is now open.',
  payout_eligible: 'No problem was raised. The traveller will be paid.',
  paid_out: 'The traveller has been paid.',
  cancelled_by_sender: 'Cancelled by the sender.',
  cancelled_by_traveller: 'Cancelled by the traveller.',
  cancelled_ineligible: 'Cancelled because the parcel did not pass a check.',
  cancelled_safety: 'Cancelled for a safety reason.',
  expired: 'No one accepted in time.',
  disputed: 'A case is open. Payout is frozen until it is resolved.',
  refunded: 'Refunded.',
  locked_for_review: 'Locked while our team reviews the handover.',
  incident_open: 'An incident is open. Support is handling it.',
  delivery_attempt_failed: 'The receiver was not available. The traveller is holding the parcel.',
};

const TRAVELLER_HINTS: Record<string, string> = {
  ...SENDER_HINTS,
  pending_traveller_acceptance: 'You have 30 minutes to accept or decline.',
  payment_pending: 'Accepted. Waiting for the sender to complete the payment.',
  pickup_ready: 'Check the seal, then ask the sender for the six-digit code.',
  picked_up: 'You have the parcel. Keep it sealed until delivery.',
  in_transit: 'You are carrying the parcel to the destination city.',
  arrived: 'You have reached the destination city. Hand the parcel to the named receiver.',
  delivered: 'Delivered. Keep the handover record.',
  payout_eligible: 'No problem was raised. Your share is now due.',
  paid_out: 'Your share has been paid.',
  cancelled_by_sender: 'The sender cancelled this booking.',
  cancelled_by_traveller: 'You cancelled this booking.',
  expired: 'The sender did not get an acceptance in time.',
  disputed: 'A case is open. Your payout is frozen until it is resolved.',
  delivery_attempt_failed: 'The receiver was not available. You are still holding the parcel.',
};

export function statusHint(status: string, role: 'sender' | 'traveller'): string {
  const map = role === 'sender' ? SENDER_HINTS : TRAVELLER_HINTS;
  return map[status] ?? 'Status update in progress.';
}

export function payoutLabel(state: string): string {
  return (
    { eligible: 'Payout eligible', frozen: 'Payout frozen', released: 'Paid out', void: 'Payout void' }[state] ??
    'Payout not yet due'
  );
}

export function payoutTone(state: string): 'neutral' | 'success' | 'danger' {
  if (state === 'released' || state === 'eligible') return 'success';
  if (state === 'frozen') return 'danger';
  return 'neutral';
}

export const DISPUTE_CATEGORY_LABELS: Record<string, string> = {
  not_received: 'Parcel not received',
  damaged: 'Parcel damaged',
  wrong_item: 'Wrong item delivered',
  late_delivery: 'Delivered late',
  prohibited_item: 'Prohibited item',
  safety: 'Safety concern',
  other: 'Something else',
};

export function disputeCategoryLabel(category: string): string {
  return DISPUTE_CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');
}

export const REVIEW_TAGS = [
  { value: 'on_time', label: 'On time' },
  { value: 'careful_handling', label: 'Careful handling' },
  { value: 'clear_communication', label: 'Clear communication' },
  { value: 'late', label: 'Late' },
  { value: 'poor_packaging', label: 'Poor packaging' },
  { value: 'unresponsive', label: 'Hard to reach' },
] as const;

export const CANCEL_REASONS = [
  { value: 'plans_changed', label: 'My plans changed' },
  { value: 'found_another_option', label: 'I found another option' },
  { value: 'traveller_late', label: 'The traveller is late' },
  { value: 'price', label: 'The price' },
  { value: 'other', label: 'Something else' },
] as const;

export const CATEGORY_LABELS: Record<string, string> = {
  documents: 'Documents',
  educational_certificates: 'Educational certificates',
  business_samples: 'Business samples',
  spare_parts_dry: 'Dry spare parts',
  cosmetics_sealed: 'Sealed cosmetics',
  printed_material: 'Printed material',
  religious_items: 'Religious items',
  keys: 'Keys',
  electronics_accessories_low_value: 'Low-value electronics accessories',
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');
}

export const MODE_LABELS: Record<string, string> = { car: 'Car', bike: 'Bike', 'on-foot': 'On foot' };

export function modeLabel(mode: string): string {
  return MODE_LABELS[mode] ?? mode;
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

export function formatWindow(start: string, end: string): string {
  return `${formatDateTime(start)} → ${formatDateTime(end)}`;
}

// ---------------------------------------------------------------------------- verification

export const ID_TYPES = ['driving_licence', 'voter_id', 'passport'] as const;
export type IdType = (typeof ID_TYPES)[number];

export const ID_TYPE_LABELS: Record<IdType, string> = {
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID',
  passport: 'Passport',
};

/** Why a reviewer rejected a submission. The copy is the explanation the person is owed. */
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

// ---------------------------------------------------------------------------- matching

/**
 * The engine's reason codes, translated. A code is only ever a gate the server actually applied —
 * the app never guesses why a list is empty.
 */
export const MATCH_REASON_LABELS: Record<string, string> = {
  NO_TRIP_ON_DATE: 'No trip is going that way on those dates.',
  NO_CAPACITY: 'Every traveller on the route is already carrying more than your parcel weighs.',
  WINDOW_TOO_TIGHT: 'No trip fits inside your pickup and delivery window.',
  ORIGIN_NOT_SERVED: 'Parcels from this city are not open yet.',
  DESTINATION_NOT_SERVED: 'Parcels to this city are not open yet.',
  MODE_DISABLED: 'That travel mode is not open at launch.',
  TRAVELLER_NOT_VERIFIED: 'Only verified travellers can carry parcels.',
  CATEGORY_NOT_ACCEPTED: 'The trips on this route do not accept this kind of item.',
  PARCEL_TOO_LARGE: 'Your parcel is larger than the space on offer.',
  PARCEL_NOT_OPEN: 'This parcel is no longer open.',
  PARCEL_ALREADY_ASSIGNED: 'A traveller has already been booked for this parcel.',
  TRIP_NOT_ACTIVE: 'That trip is no longer open.',
  TRIP_DEPARTED: 'That trip has already departed.',
  SELF_TRIP: 'You cannot carry your own parcel.',
  TRAVELLER_RELIABILITY_REVIEW: 'A traveller is paused while an earlier delivery is reviewed.',
  ITEM_PROHIBITED: 'Prohibited items cannot travel.',
  DEPARTS_AFTER_WINDOW: 'The trip leaves after your pickup window closes.',
  ARRIVES_TOO_LATE: 'The trip would arrive after your delivery window closes.',
  MATCHING_DISABLED: 'Matching is switched off in this deployment.',
  TRIP_NOT_LIVE: 'This trip is not open for parcels any more.',
  NO_PARCEL_ON_ROUTE: 'Nobody has posted a parcel on this route yet.',
};

export function matchReasonLabel(code: string): string {
  return MATCH_REASON_LABELS[code] ?? code.replace(/_/g, ' ').toLowerCase();
}

// ---------------------------------------------------------------------------- notifications

/** Template ids only. The server never stores a rendered body, so the app supplies the sentence. */
export const TEMPLATE_LABELS: Record<string, string> = {
  booking_requested: 'A sender asked you to carry a parcel',
  traveller_interested: 'A traveller offered to carry one of your parcels',
  booking_accepted: 'Your traveller accepted',
  booking_declined: 'The traveller declined',
  booking_cancelled: 'A booking was cancelled',
  payment_captured: 'Payment confirmed',
  payment_failed: 'A payment did not complete',
  pickup_ready: 'Pickup is ready',
  pickup_code_ready: 'A pickup code is ready to read out',
  delivery_code_ready: 'A delivery code is ready to read out',
  message_received: 'A new message on one of your bookings',
  pickup_confirmed: 'The parcel was picked up',
  in_transit: 'The parcel is on the way',
  arrived: 'The traveller has arrived',
  trip_changed: 'A traveller changed the trip you booked',
  delivered: 'The parcel was delivered',
  delivery_failed: 'A delivery attempt failed',
  dispute_opened: 'A problem was raised',
  dispute_resolved: 'A problem was resolved',
  payout_eligible: 'The problem window closed',
  verification_approved: 'Your ID was verified',
  verification_rejected: 'Your verification was not accepted',
  otp: 'A handover code was sent',
};

export function notificationLabel(templateId: string): string {
  return TEMPLATE_LABELS[templateId] ?? templateId.replace(/_/g, ' ');
}

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  NETWORK: { title: 'No connection', body: 'Check your internet and try again. Nothing was submitted twice.' },
  TIMEOUT: { title: 'The server took too long', body: 'Try again when you have a stronger signal.' },
  AUTH_REQUIRED: { title: 'Session ended', body: 'Sign in again to continue.' },
  OTP_INVALID: { title: 'That code is not right', body: 'Check the six digits and try again.' },
  OTP_EXPIRED: { title: 'That code expired', body: 'Send a new one.' },
  OTP_RESEND_TOO_SOON: { title: 'Just a moment', body: 'A code was sent recently. Wait for the timer.' },
  VALIDATION_FAILED: { title: 'Check the details', body: 'One of the fields needs attention.' },
  QUOTE_EXPIRED: { title: 'This price expired', body: 'Refresh the price. It may have changed.' },
  QUOTE_MISMATCH: { title: 'That price does not match', body: 'Refresh the quote and try again.' },
  CAPACITY_UNAVAILABLE: { title: 'That space was just taken', body: 'Choose another traveller on your route.' },
  NO_MATCH: { title: 'No traveller matches yet', body: 'Widen your window and check again.' },
  TRIP_NOT_AVAILABLE: { title: 'That trip is no longer available', body: 'The traveller may have cancelled or filled the space.' },
  PARCEL_HAS_ACTIVE_BOOKING: { title: 'This parcel already has a booking', body: 'Open the existing booking instead.' },
  BOOKING_ALREADY_ACTIVE: { title: 'This parcel already has a booking', body: 'Open the existing booking instead.' },
  INVALID_TRANSITION: { title: 'That step is not available', body: 'The booking has moved on. Pull to refresh.' },
  TRANSITION_CONFLICT: { title: 'Someone else acted first', body: 'Reload the booking to see where it stands.' },
  TRANSITION_NOT_PERMITTED: { title: 'Not your step', body: 'Only the other side can do this one.' },
  VERIFICATION_REQUIRED: { title: 'Verify your ID first', body: 'Only verified travellers can accept or publish.' },
  ACCEPT_WINDOW_CLOSED: { title: 'The acceptance window closed', body: 'The booking expired before it was accepted.' },
  HANDOVER_NOT_ALLOWED_IN_STATE: { title: 'Handover is not open yet', body: 'This step opens when the booking reaches the handover stage.' },
  OTP_NOT_APPLICABLE: { title: 'No code is active', body: 'The code was used, or the booking is not at this step.' },
  PHOTO_REQUIRED: { title: 'A photo is needed', body: 'Photograph the parcel for both sides to have a record.' },
  TRIP_HAS_ACCEPTED_BOOKING: { title: 'This trip carries a booked parcel', body: 'Cancel that booking first, or contact support.' },
  TRIP_EDIT_BREAKS_BOOKING: { title: 'That change would strand a parcel', body: 'Nothing was changed.' },
  TRIP_CAPACITY_INVALID: { title: 'Check the capacity', body: 'Capacity must leave room for every booked parcel.' },
  TRIP_WINDOW_INVALID: { title: 'Check the trip times', body: 'Arrival must be after departure, and departure cannot be in the past.' },
  PAYMENTS_NOT_ENABLED: { title: "Payments aren't live", body: 'This build can create a payment request but cannot capture money.' },
  SELF_BOOKING_FORBIDDEN: { title: "You can't carry your own parcel", body: 'Choose a different traveller.' },
  MODE_DISABLED: { title: 'That travel mode is not open', body: 'Only car travellers can carry parcels at launch.' },
  CITY_NOT_SERVICED: { title: 'That city is not covered yet', body: 'Choose a serviceable city.' },
  UPLOAD_FAILED: { title: 'The photo did not upload', body: 'Check your connection and choose it again.' },
  SESSION_NOT_TRANSPORTED: { title: 'Sign-in could not be kept', body: 'This build cannot store the session. Update the app.' },
  OTP_ATTEMPTS_EXCEEDED: { title: 'Too many wrong codes', body: 'This booking is paused for review. Contact support.' },
  BOOKING_LOCKED: { title: 'This booking is paused', body: 'Too many wrong codes. Support will review it.' },
  REVIEW_ALREADY_SUBMITTED: { title: 'You already rated this booking', body: 'Only one rating is kept per person.' },
  REVIEW_WINDOW_CLOSED: { title: 'The rating window closed', body: 'Ratings are accepted for a short period after delivery.' },
  DISPUTE_WINDOW_CLOSED: { title: 'The problem window closed', body: 'Cases can be raised for 72 hours after delivery.' },
  DISPUTE_ALREADY_OPEN: { title: 'A case is already open', body: 'Add anything new to the open case instead.' },
  CONVERSATION_CLOSED: { title: 'This conversation is closed', body: 'Messages stop when the booking ends.' },
  PAYMENT_NOT_PAYABLE: { title: 'This booking cannot be paid now', body: 'Pull to refresh and check its status.' },
  PAYMENT_ALREADY_EXISTS: { title: 'A payment request already exists', body: 'This build cannot capture it, so the booking stays unpaid.' },
  CONFLICT: { title: 'That action is not available', body: 'Reload the page to see where this stands.' },
  NOT_FOUND: { title: 'Not found', body: 'It may have been removed, or it is not yours.' },
  FORBIDDEN: { title: 'Not allowed', body: 'This action is not available to your account.' },
  RATE_LIMITED: { title: 'Too many requests', body: 'Wait a moment and try again.' },
};

export function errorCopy(error: unknown): { title: string; body: string } {
  if (error instanceof ApiError) {
    if (error.code === 'OTP_INVALID' && typeof error.details.attempts_remaining === 'number') {
      const left = error.details.attempts_remaining;
      return { title: 'That code is not right', body: `${left} ${left === 1 ? 'try' : 'tries'} left.` };
    }
    return (
      ERROR_COPY[error.code] ?? {
        title: 'Something went wrong',
        body: error.message || 'Try again.',
      }
    );
  }
  if (error instanceof Error && error.message) {
    return { title: 'Something went wrong', body: error.message };
  }
  return { title: 'Something went wrong', body: 'Try again.' };
}
