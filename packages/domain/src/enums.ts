/**
 * Wire enums. Lowercase snake_case, matching api/openapi.yaml and database/SCHEMA.md.
 * docs/BOOKING_STATE_MACHINE.md writes these in uppercase for readability; the mapping is
 * case-only. Do not introduce a second vocabulary.
 */

export const CATEGORIES = [
  'documents',
  'educational_certificates',
  'business_samples',
  'spare_parts_dry',
  'cosmetics_sealed',
  'printed_material',
  'religious_items',
  'keys',
  'electronics_accessories_low_value',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PROHIBITED_CATEGORY_KEYS = [
  'cash',
  'currency',
  'jewellery',
  'gold',
  'silver',
  'passport',
  'passports',
  'medicine',
  'medicines',
  'pharmaceutical',
  'electronics',
  'laptop',
  'mobile_phone',
  'battery',
  'lithium',
  'flammable',
  'perfume',
  'alcohol',
  'liquor',
  'tobacco',
  'weapon',
  'firearm',
  'live_animal',
  'perishable',
  'food',
  'hazardous',
  'chemical',
  'human_remains',
  'antique',
  'artwork',
] as const;

/** Soft-block categories: accepted but queued for a human check (rule E8). */
export const RESTRICTED_CATEGORIES: readonly Category[] = [
  'spare_parts_dry',
  'electronics_accessories_low_value',
];

/** Categories the sender UI is allowed to offer. Prohibited items are never listed. */
export const OFFERABLE_CATEGORIES: readonly Category[] = CATEGORIES;

export const CATEGORY_LABELS: Record<Category, string> = {
  documents: 'Documents',
  educational_certificates: 'Educational certificates',
  business_samples: 'Business samples',
  spare_parts_dry: 'Dry spare parts',
  cosmetics_sealed: 'Sealed cosmetics',
  printed_material: 'Printed material',
  religious_items: 'Religious items',
  keys: 'Keys',
  electronics_accessories_low_value: 'Low-value electronic accessories',
};

export const CATEGORY_HINTS: Record<Category, string> = {
  documents: 'Property papers, contracts, invoices, forms',
  educational_certificates: 'Degrees, marksheets, transcripts',
  business_samples: 'Fabric swatches, catalogues, product samples',
  spare_parts_dry: 'Non-hazardous, dry, no fuel or oil residue',
  cosmetics_sealed: 'Factory-sealed, non-flammable, no aerosols',
  printed_material: 'Brochures, books, visiting cards',
  religious_items: 'Idols, prayer items, prasad (non-perishable)',
  keys: 'Spare keys, not original vehicle keys with papers',
  electronics_accessories_low_value: 'Cables, chargers under the declared value cap',
};

export const TRANSPORT_MODES = ['car', 'bike', 'bus', 'train', 'air'] as const;
export type TransportMode = (typeof TRANSPORT_MODES)[number];

export const MODE_LABELS: Record<TransportMode, string> = {
  car: 'Car',
  bike: 'Two-wheeler',
  bus: 'Bus',
  train: 'Train',
  air: 'Flight',
};

export const PARCEL_STATUSES = ['draft', 'posted', 'matched', 'ineligible', 'cancelled', 'closed'] as const;
export type ParcelStatus = (typeof PARCEL_STATUSES)[number];

export const TRIP_STATUSES = [
  'published',
  'partially_booked',
  'full',
  'in_progress',
  'completed',
  'cancelled',
  'expired',
] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export const BOOKING_STATUSES = [
  'draft',
  'pending_traveller_acceptance',
  'payment_pending',
  'confirmed',
  'pickup_ready',
  'picked_up',
  'in_transit',
  'arrived',
  'delivered',
  'payout_eligible',
  'paid_out',
  'cancelled_by_sender',
  'cancelled_by_traveller',
  'cancelled_ineligible',
  'cancelled_safety',
  'expired',
  'disputed',
  'refunded',
  'locked_for_review',
  'incident_open',
  'delivery_attempt_failed',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  draft: 'Draft',
  pending_traveller_acceptance: 'Waiting for traveller',
  payment_pending: 'Payment pending',
  confirmed: 'Confirmed',
  pickup_ready: 'Ready for pickup',
  picked_up: 'Picked up',
  in_transit: 'On the way',
  arrived: 'Arrived at destination',
  delivered: 'Delivered',
  payout_eligible: 'Payout eligible',
  paid_out: 'Paid out',
  cancelled_by_sender: 'Cancelled by sender',
  cancelled_by_traveller: 'Cancelled by traveller',
  cancelled_ineligible: 'Cancelled — not eligible',
  cancelled_safety: 'Cancelled — safety',
  expired: 'Expired',
  disputed: 'Dispute open',
  refunded: 'Refunded',
  locked_for_review: 'Locked for review',
  incident_open: 'Incident open',
  delivery_attempt_failed: 'Delivery attempt failed',
};

/** Short, non-alarming sender-facing description of where things stand. */
export const BOOKING_STATUS_HINTS: Record<BookingStatus, string> = {
  draft: 'Not sent yet.',
  pending_traveller_acceptance: 'The traveller has 30 minutes to accept.',
  payment_pending: 'Accepted. Complete the test payment to confirm.',
  confirmed: 'Both sides committed. Pickup instructions are being prepared.',
  pickup_ready: 'Share the pickup code with the traveller in person.',
  picked_up: 'The traveller has your parcel.',
  in_transit: 'Your parcel is on the way.',
  arrived: 'The traveller has reached the destination city.',
  delivered: 'Delivered. The dispute window is now open.',
  payout_eligible: 'No dispute was raised. The traveller will be paid.',
  paid_out: 'The traveller has been paid.',
  cancelled_by_sender: 'Cancelled by the sender.',
  cancelled_by_traveller: 'Cancelled by the traveller.',
  cancelled_ineligible: 'Cancelled because the parcel did not pass a check.',
  cancelled_safety: 'Cancelled for a safety reason.',
  expired: 'No one accepted in time.',
  disputed: 'A dispute is open. Payout is frozen until it is resolved.',
  refunded: 'Refunded.',
  locked_for_review: 'Locked while our team reviews the handover.',
  incident_open: 'An incident is open. Support is handling it.',
  delivery_attempt_failed: 'The receiver was not available. The traveller is holding the parcel.',
};

/**
 * The same states, from the traveller's side of the booking. Keeping a second map is deliberate:
 * "The traveller has your parcel" is wrong when read by the traveller, and a shared neutral string
 * ("Parcel picked up") loses the instruction each side actually needs.
 */
export const TRAVELLER_STATUS_HINTS: Record<BookingStatus, string> = {
  draft: 'Not sent yet.',
  pending_traveller_acceptance: 'You have 30 minutes to accept or decline.',
  payment_pending: 'Accepted. Waiting for the sender to complete the payment.',
  confirmed: 'Both sides committed. Pickup instructions are being prepared.',
  pickup_ready: 'Check the seal, then ask the sender for the six-digit code.',
  picked_up: 'You have the parcel. Keep it sealed until delivery.',
  in_transit: 'You are carrying the parcel to the destination city.',
  arrived: 'You have reached the destination city. Hand the parcel to the named receiver.',
  delivered: 'Delivered. Keep the handover record.',
  payout_eligible: 'No dispute was raised. Your share is now due.',
  paid_out: 'Your share has been paid.',
  cancelled_by_sender: 'The sender cancelled this booking.',
  cancelled_by_traveller: 'You cancelled this booking.',
  cancelled_ineligible: 'Cancelled because the parcel did not pass a check.',
  cancelled_safety: 'Cancelled for a safety reason.',
  expired: 'The sender did not get an acceptance in time.',
  disputed: 'A dispute is open. Your payout is frozen until it is resolved.',
  refunded: 'Refunded.',
  locked_for_review: 'Locked while our team reviews the handover.',
  incident_open: 'An incident is open. Support is handling it.',
  delivery_attempt_failed: 'The receiver was not available. You are still holding the parcel.',
};

export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = [
  'paid_out',
  'refunded',
  'expired',
  'cancelled_by_sender',
  'cancelled_by_traveller',
  'cancelled_ineligible',
  'cancelled_safety',
];

export const PAYOUT_STATES = ['not_eligible', 'eligible', 'frozen', 'released', 'void'] as const;
export type PayoutState = (typeof PAYOUT_STATES)[number];

export const PAYMENT_STATES = [
  'created',
  'authorised',
  'captured',
  'failed',
  'refunded',
  'partially_refunded',
  'unknown',
] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export const VERIFICATION_STATES = ['not_started', 'pending', 'verified', 'rejected', 'expired'] as const;
export type VerificationState = (typeof VERIFICATION_STATES)[number];

export const DISPUTE_STATES = ['open', 'evidence_requested', 'under_review', 'resolved', 'closed', 'appealed'] as const;
export type DisputeState = (typeof DISPUTE_STATES)[number];

export const DISPUTE_CATEGORIES = [
  'not_received',
  'damaged',
  'wrong_item',
  'late_delivery',
  'prohibited_item',
  'safety',
  'other',
] as const;
export type DisputeCategory = (typeof DISPUTE_CATEGORIES)[number];

export const DISPUTE_CATEGORY_LABELS: Record<DisputeCategory, string> = {
  not_received: 'Parcel not received',
  damaged: 'Parcel damaged',
  wrong_item: 'Wrong item delivered',
  late_delivery: 'Delivered late',
  prohibited_item: 'Prohibited item',
  safety: 'Safety concern',
  other: 'Something else',
};

export const MATCH_REASON_CODES = [
  'ON_ROUTE',
  'ARRIVES_IN_WINDOW',
  'SMALL_DETOUR',
  'HIGH_RELIABILITY',
  'CAPACITY_OK',
  'VERIFIED_ID',
  'DELAYED_ARRIVAL',
] as const;
export type MatchReasonCode = (typeof MATCH_REASON_CODES)[number];

export const MATCH_REASON_LABELS: Record<MatchReasonCode, string> = {
  ON_ROUTE: 'On your route',
  ARRIVES_IN_WINDOW: 'Arrives inside your window',
  SMALL_DETOUR: 'Small detour for pickup',
  HIGH_RELIABILITY: 'Reliable traveller',
  CAPACITY_OK: 'Has room for your parcel',
  VERIFIED_ID: 'ID verified',
  DELAYED_ARRIVAL: 'May arrive later than your window',
};

export const MATCH_BANDS = ['excellent', 'good', 'fair'] as const;
export type MatchBand = (typeof MATCH_BANDS)[number];

export const MATCH_BAND_LABELS: Record<MatchBand, string> = {
  excellent: 'Excellent match',
  good: 'Good match',
  fair: 'Fair match',
};

export const RELIABILITY_BANDS = ['new', 'building', 'reliable', 'highly_reliable'] as const;
export type ReliabilityBand = (typeof RELIABILITY_BANDS)[number];

export const RELIABILITY_LABELS: Record<ReliabilityBand, string> = {
  new: 'New traveller',
  building: 'Building a record',
  reliable: 'Reliable',
  highly_reliable: 'Highly reliable',
};

export const ID_TYPES = ['driving_licence', 'voter_id', 'passport'] as const;
export type IdType = (typeof ID_TYPES)[number];

export const ID_TYPE_LABELS: Record<IdType, string> = {
  driving_licence: 'Driving licence',
  voter_id: 'Voter ID',
  passport: 'Passport',
};

export const NOTIFICATION_CHANNELS = ['sms', 'whatsapp', 'email', 'push', 'in_app'] as const;
