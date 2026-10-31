import type { BookingStatus, PayoutState, TransportMode, VerificationState } from '@py/domain';

export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toISOString();
  }
  return new Date(0).toISOString();
}

export function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

/** PostgreSQL numeric arrives as a string. Never let it reach the wire as a string. */
export function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

export function firstName(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const first = name.trim().split(/\s+/)[0];
  return first ? first.slice(0, 40) : undefined;
}

export function initial(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const parts = name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return last ? last.slice(0, 1).toUpperCase() : undefined;
}

export interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  phone_last4: string | null;
  status: 'active' | 'suspended' | 'deleted';
  risk_tier: number;
  locale: string;
  created_at: Date | string;
  verification_state?: VerificationState | null;
  /**
   * Whether each contact channel has actually been confirmed. A number typed into a profile is not
   * a verified number, and the UI must be able to say so honestly.
   */
  phone_verified?: boolean;
  email_verified?: boolean;
}

export function userProfile(row: UserRow, roles: string[] = []) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone_last4: row.phone_last4,
    status: row.status,
    risk_tier: Number(row.risk_tier),
    locale: row.locale,
    verification_state: row.verification_state ?? 'not_started',
    phone_verified: row.phone_verified ?? false,
    email_verified: row.email_verified ?? false,
    created_at: toIso(row.created_at),
    // The caller's own roles only. Additive to the contract: see docs/BUILD_NOTES.md DEFECT-011.
    // Without it every client has to probe a staff endpoint and eat a 403 to find out.
    roles,
  };
}

export interface ParcelRow {
  id: string;
  status: string;
  origin_city_id: string;
  dest_city_id: string;
  origin_area: string;
  dest_area: string;
  category: string;
  description: string;
  weight_kg: unknown;
  dims_cm: number[];
  declared_value_paise: number;
  window_start: Date | string;
  window_end: Date | string;
  review_required: boolean;
  review_reason: string | null;
  created_at: Date | string;
}

export function parcelView(row: ParcelRow) {
  return {
    id: row.id,
    status: row.status,
    origin_city_id: row.origin_city_id,
    dest_city_id: row.dest_city_id,
    origin_area: row.origin_area,
    dest_area: row.dest_area,
    category: row.category,
    description: row.description,
    weight_kg: num(row.weight_kg),
    dims_cm: row.dims_cm,
    declared_value_paise: Number(row.declared_value_paise),
    window_start: toIso(row.window_start),
    window_end: toIso(row.window_end),
    review_required: row.review_required,
    review_reason: row.review_reason,
    created_at: toIso(row.created_at),
  };
}

export interface TripRow {
  id: string;
  mode: TransportMode;
  origin_city_id: string;
  dest_city_id: string;
  origin_area: string | null;
  departure_at: Date | string;
  arrival_estimate_at: Date | string;
  capacity_kg: unknown;
  capacity_kg_remaining: unknown;
  accepts_documents_only: boolean;
  status: string;
  created_at: Date | string;
  /**
   * Additive: how the trip's road geometry was obtained. `pending`/`unavailable` means matching is
   * limited to an exact city pair until the background measurement succeeds. Older clients ignore
   * these keys, which is why they are additive rather than a contract change.
   */
  route_status?: string | null;
  route_source?: string | null;
  route_distance_m?: number | null;
}

export function tripView(row: TripRow) {
  return {
    id: row.id,
    mode: row.mode,
    origin_city_id: row.origin_city_id,
    dest_city_id: row.dest_city_id,
    origin_area: row.origin_area,
    departure_at: toIso(row.departure_at),
    arrival_estimate_at: toIso(row.arrival_estimate_at),
    capacity_kg: num(row.capacity_kg),
    capacity_kg_remaining: num(row.capacity_kg_remaining),
    accepts_documents_only: row.accepts_documents_only,
    status: row.status,
    created_at: toIso(row.created_at),
    route_status: row.route_status ?? 'pending',
    route_source: row.route_source ?? null,
    route_distance_km: row.route_distance_m == null ? null : Math.round(Number(row.route_distance_m) / 100) / 10,
  };
}

export interface BookingRow {
  id: string;
  parcel_id: string;
  trip_id: string;
  sender_id: string;
  traveller_id: string;
  status: BookingStatus;
  agreed_total_paise: number;
  traveller_share_paise: number;
  accept_by: Date | string | null;
  dispute_deadline: Date | string | null;
  payout_state: PayoutState;
  /** Latest payment attempt, so the UI can say "paid" without guessing from the booking status. */
  payment?: {
    state: string;
    amount_paise: number;
    sandbox: boolean;
    /** Direct UPI only: the payer's reference and the intent link, so a reload does not lose them. */
    reference?: string;
    payment_link?: string;
    payee?: { vpa: string; name: string };
  } | null;
  created_at: Date | string;
  updated_at: Date | string;
  origin_area?: string | null;
  dest_area?: string | null;
  /** From the parcel. Additive to the contract: see docs/BUILD_NOTES.md DEFECT-009. */
  window_start?: Date | string | null;
  window_end?: Date | string | null;
  mode?: TransportMode;
  counterparty_name?: string | null;
  counterparty_phone_last4?: string | null;
  counterparty_phone_masked?: string | null;
  counterparty_verification?: VerificationState | null;
  timeline?: Array<{
    from_state: string | null;
    to_state: string;
    actor_kind: string;
    actor_id?: string | null;
    reason_code: string | null;
    occurred_at: Date | string;
  }>;
  /** The open case, if any. Additive to the contract: docs/BUILD_NOTES.md DEFECT-012. */
  open_dispute?: { id: string; state: string; category: string; created_at: Date | string } | null;
}

export function bookingView(row: BookingRow, allowedCommands: string[], viewerRole: 'sender' | 'traveller') {
  const counterparty =
    row.counterparty_name || row.counterparty_phone_masked
      ? {
          ...(firstName(row.counterparty_name) ? { first_name: firstName(row.counterparty_name) } : {}),
          ...(row.counterparty_phone_masked ? { phone_masked: row.counterparty_phone_masked } : {}),
          verification_state: row.counterparty_verification ?? 'not_started',
        }
      : undefined;

  return {
    id: row.id,
    parcel_id: row.parcel_id,
    trip_id: row.trip_id,
    status: row.status,
    // Additive: the mobile app needs to know which side of the booking the caller is on without a
    // second list request. The view is only ever served to a party (loadForViewer enforces it).
    viewer_role: viewerRole,
    agreed_total_paise: Number(row.agreed_total_paise),
    traveller_share_paise: Number(row.traveller_share_paise),
    accept_by: toIsoOrNull(row.accept_by),
    counterparty,
    pickup_area: row.origin_area ?? null,
    drop_area: row.dest_area ?? null,
    pickup_window_start: toIsoOrNull(row.window_start ?? null),
    pickup_window_end: toIsoOrNull(row.window_end ?? null),
    dispute_deadline: toIsoOrNull(row.dispute_deadline),
    payout_state: row.payout_state,
    payment: row.payment
      ? {
          state: row.payment.state,
          amount_paise: Number(row.payment.amount_paise),
          sandbox: row.payment.sandbox,
          ...(row.payment.reference ? { reference: row.payment.reference } : {}),
          ...(row.payment.payment_link ? { payment_link: row.payment.payment_link } : {}),
          ...(row.payment.payee ? { payee: row.payment.payee } : {}),
        }
      : null,
    allowed_commands: allowedCommands,
    timeline: (row.timeline ?? []).map((e) => ({
      from_state: e.from_state,
      to_state: e.to_state,
      actor_kind: e.actor_kind,
      // Additive to the contract (docs/BUILD_NOTES.md DEFECT-010): the UI cannot say "You" without
      // knowing which side of this booking the actor was on.
      actor_role:
        e.actor_id && e.actor_id === row.sender_id
          ? 'sender'
          : e.actor_id && e.actor_id === row.traveller_id
            ? 'traveller'
            : null,
      reason_code: e.reason_code,
      occurred_at: toIso(e.occurred_at),
    })),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    dispute: row.open_dispute
      ? {
          id: row.open_dispute.id,
          state: row.open_dispute.state,
          category: row.open_dispute.category,
          created_at: toIso(row.open_dispute.created_at),
        }
      : null,
  };
}
