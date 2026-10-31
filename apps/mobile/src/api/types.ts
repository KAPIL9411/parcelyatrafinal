/** The subset of the API contract the app renders. Field names mirror `apps/web/src/lib/api.ts`. */

export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
  phone_last4: string | null;
  status: 'active' | 'suspended' | 'deleted';
  risk_tier: number;
  locale: string;
  verification_state: string;
  phone_verified?: boolean;
  email_verified?: boolean;
  created_at: string;
  roles?: string[];
}

export interface AuthResponse {
  access_token: string;
  expires_in: number;
  user: Profile;
  refresh_token?: string;
  phone_verification_required?: boolean;
}

export interface OtpChallenge {
  challenge_id: string;
  expires_in_seconds: number;
  resend_after_seconds: number;
}

export interface Parcel {
  id: string;
  status: string;
  origin_city_id: string;
  dest_city_id: string;
  origin_area: string;
  dest_area: string;
  category: string;
  description: string;
  weight_kg: number;
  dims_cm: number[];
  declared_value_paise: number;
  window_start: string;
  window_end: string;
  review_required: boolean;
  review_reason: string | null;
  created_at: string;
}

export interface ParcelWithBooking extends Parcel {
  booking_id: string | null;
  booking_status: string | null;
}

export interface ParcelSummary extends ParcelWithBooking {
  interests_count: number;
}

export interface ParcelList {
  items: ParcelSummary[];
}

export interface ParcelOffer {
  trip_id: string;
  traveller_first_name: string | null;
  verification_state: string;
  mode: string;
  origin_area: string | null;
  departure_at: string;
  arrival_estimate_at: string;
  capacity_kg_remaining: number;
  trip_status: string;
  offered_at: string;
}

export interface ParcelOfferList {
  parcel_id: string;
  items: ParcelOffer[];
}

export interface QuoteLine {
  label: string;
  amount_paise: number;
  note?: string;
}

export interface Quote {
  id: string;
  formula_version: string;
  subtotal_paise: number;
  platform_fee_paise: number;
  tax_paise: number;
  total_paise: number;
  traveller_paise: number;
  expires_at: string;
  breakdown: QuoteLine[];
}

export interface Match {
  trip_id: string;
  score: number;
  band: 'excellent' | 'good' | 'fair';
  reasons: string[];
  traveller_first_name?: string;
  traveller_initial?: string;
  verification_state: string;
  reliability_band: string;
  reliability_ratio?: number;
  completed_trips: number;
  mode: string;
  departure_at: string;
  arrival_estimate_at: string;
  capacity_kg_remaining: number;
  /** Where the route came from: `routed`, `estimated`, or an exact city-pair match. */
  route_source?: 'routed' | 'estimated' | 'exact';
  /** Extra road distance this parcel costs the traveller, km. */
  detour_km?: number;
  /** Distance along the traveller's route from pickup to delivery, km. */
  leg_km?: number;
  pickup_eta_at?: string;
  drop_eta_at?: string;
  /** Band of the worse endpoint's offset from the traveller's route — not a crow-flies distance. */
  pickup_distance_band_km?: '<1' | '1-3' | '3-5' | '5-10';
  indicative_price_paise: number;
  accepts_documents_only: boolean;
  score_breakdown?: {
    formula_version: string;
    fit: Record<string, number>;
    points: Record<string, number>;
  };
}

export interface MatchResult {
  matches: Match[];
  low_confidence: boolean;
  no_match_reasons: string[];
}

export interface Trip {
  id: string;
  mode: string;
  origin_city_id: string;
  dest_city_id: string;
  origin_area: string | null;
  departure_at: string;
  arrival_estimate_at: string;
  capacity_kg: number;
  capacity_kg_remaining: number;
  accepts_documents_only: boolean;
  status: string;
  created_at: string;
}

export interface TripList {
  items: Trip[];
}

export interface Opportunity {
  parcel_id: string;
  category: string;
  weight_kg: number;
  dims_cm: number[];
  origin_area: string;
  dest_area: string;
  window_start: string;
  window_end: string;
  declared_value_paise: number;
  sender_verified: boolean;
  score: number;
  band: 'excellent' | 'good' | 'fair';
  reasons: string[];
  pickup_distance_band_km?: '<1' | '1-3' | '3-5' | '5-10';
  indicative_price_paise: number;
  /** True when this traveller has already offered for the parcel. */
  offered?: boolean;
}

export interface OpportunityList {
  trip_id: string;
  trip_status: string;
  capacity_kg_remaining?: number;
  items: Opportunity[];
  no_match_reasons: string[];
  blocked_counts?: Record<string, number>;
}

export interface BookingSummary {
  id: string;
  status: string;
  role: 'sender' | 'traveller';
  mode: string;
  parcel_id: string;
  category: string;
  weight_kg: number;
  origin_city: string;
  dest_city: string;
  agreed_total_paise: number;
  created_at: string;
  updated_at: string;
}

export interface BookingList {
  items: BookingSummary[];
}

export interface Booking {
  id: string;
  parcel_id: string;
  trip_id: string;
  status: string;
  /** Which side of the booking the caller is on. Additive to the contract. */
  viewer_role?: 'sender' | 'traveller';
  agreed_total_paise: number;
  traveller_share_paise: number;
  accept_by: string | null;
  counterparty?: {
    first_name?: string;
    phone_masked?: string;
    verification_state: string;
  };
  pickup_area: string | null;
  drop_area: string | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  dispute?: {
    id: string;
    state: string;
    category: string;
    created_at: string;
  } | null;
  dispute_deadline: string | null;
  payout_state: string;
  /** Latest non-failed payment attempt. Additive: payment is collected after delivery. */
  payment?: {
    state: string;
    amount_paise: number;
    sandbox: boolean;
    /** Present only while a direct-UPI collection is waiting for a receipt. */
    reference?: string;
    payment_link?: string;
    payee?: { vpa: string; name: string } | null;
  } | null;
  allowed_commands: string[];
  timeline: {
    from_state: string | null;
    to_state: string;
    actor_kind: string;
    actor_role?: 'sender' | 'traveller' | null;
    reason_code: string | null;
    occurred_at: string;
  }[];
  created_at: string;
  updated_at: string;
}

export interface Dispute {
  id: string;
  booking_id: string;
  category: string;
  state: string;
  outcome_code: string | null;
  evidence: { id: string; note: string; object_key: string | null; created_at: string }[];
  created_at: string;
  resolved_at: string | null;
}

export interface ChatMessage {
  id: string;
  kind: 'text' | 'system';
  body: string;
  sender_id: string;
  sender_name: string;
  mine: boolean;
  created_at: string;
}

export interface ChatThread {
  items: ChatMessage[];
  unread_count: number;
  closed: boolean;
}

export interface NotificationItem {
  id: string;
  channel: string;
  template_id: string;
  status: string;
  booking_id: string | null;
  created_at: string;
  read_at: string | null;
}

export interface NotificationList {
  items: NotificationItem[];
  unread_count: number;
}

export interface ConversationSummary {
  conversation_id: string;
  booking_id: string;
  booking_status: string;
  role: 'sender' | 'traveller' | string;
  closed: boolean;
  counterparty: string | null;
  last_message: string | null;
  last_at: string | null;
  unread_count: number;
}

export interface Inbox {
  items: ConversationSummary[];
  total_unread: number;
}

export interface PaymentIntent {
  id: string;
  state: string;
  amount_paise: number;
  currency: string;
  provider: string;
  sandbox: boolean;
  client_secret: string | null;
  provider_ref: string;
  /** Set when the server collects money on its own UPI handle instead of a checkout provider. */
  payment_link: string | null;
  payee: { vpa: string; name: string } | null;
  created_at: string;
}

export interface Verification {
  id: string;
  user_id: string;
  state: string;
  id_type: string | null;
  reason_code: string | null;
  attempts: number;
  decided_at: string | null;
  created_at: string;
}

export interface City {
  id: string;
  name: string;
  state?: string;
  is_serviceable?: boolean;
}

export interface CityList {
  items: City[];
}

export interface Area {
  id: string;
  name: string;
}

export interface AreaList {
  items: Area[];
}

export interface PublicConfig {
  modes: string[];
  categories: string[];
  limits: {
    max_weight_kg: number;
    max_dimension_cm: number;
    max_declared_value_paise: number;
    max_window_days: number;
  };
  payments: { sandbox: boolean; live: boolean };
}
