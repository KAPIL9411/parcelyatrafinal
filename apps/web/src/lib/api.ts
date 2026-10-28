/**
 * Typed client for the Parcel Yatra API.
 *
 * Two rules from the contract are enforced here rather than in screens:
 *  - every mutating call carries an Idempotency-Key (the server rejects the ones that matter
 *    without it, and an unnecessary key is harmless);
 *  - a 401 triggers exactly one refresh attempt, then the session is cleared.
 */

import type { HomepageConfig, HomepageDocument } from '@py/domain';

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/v1';

/**
 * The access token is held in a module variable and the refresh token in an HttpOnly cookie that
 * JavaScript cannot read. `localStorage` would survive an XSS payload and a browser extension, and
 * a refresh token is a 30-day session — losing it is not recoverable by the user.
 *
 * The cost is a re-`refresh` on every page load, which is exactly what `bootstrap()` does.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

export interface SessionTokens {
  access_token: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, status: number, requestId: string | null, details: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}

interface ErrorEnvelope {
  error?: {
    code?: unknown;
    message?: unknown;
    request_id?: unknown;
    details?: unknown;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  auth?: boolean;
  signal?: AbortSignal;
  raw?: BodyInit;
  contentType?: string;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchange the HttpOnly refresh cookie for a fresh access token. The browser attaches the cookie;
 * nothing here ever sees it.
 */
async function refreshSession(): Promise<boolean> {
  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    credentials: 'include',
  });

  if (!res.ok) {
    accessToken = null;
    return false;
  }

  const next = (await res.json()) as Partial<SessionTokens>;
  if (typeof next.access_token !== 'string') {
    accessToken = null;
    return false;
  }
  accessToken = next.access_token;
  return true;
}

async function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= refreshSession().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

/** Called once at startup: restores a session from the cookie alone. */
export async function bootstrap(): Promise<boolean> {
  return refreshOnce();
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, auth = true, signal, raw, contentType } = options;

  const attempt = async (): Promise<Response> => {
    const headers: Record<string, string> = { accept: 'application/json' };

    if (auth && accessToken) headers.authorization = `Bearer ${accessToken}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (raw !== undefined) headers['content-type'] = contentType ?? 'application/octet-stream';
    if (method !== 'GET' && method !== 'HEAD') {
      headers['idempotency-key'] = idempotencyKey ?? crypto.randomUUID();
    }

    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(raw !== undefined ? { body: raw } : {}),
      ...(signal ? { signal } : {}),
    });
  };

  let res = await attempt();

  if (res.status === 401 && auth && !accessToken) {
    // Page load raced the bootstrap: try the cookie once before giving up.
    const restored = await refreshOnce();
    if (restored) res = await attempt();
  } else if (res.status === 401 && auth && accessToken) {
    const refreshed = await refreshOnce();
    if (refreshed) res = await attempt();
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    const envelope = isRecord(payload) ? (payload as ErrorEnvelope) : {};
    const error = isRecord(envelope.error) ? envelope.error : {};
    const code = typeof error.code === 'string' ? error.code : `HTTP_${res.status}`;
    const message = typeof error.message === 'string' ? error.message : 'Something went wrong.';
    const requestId = typeof error.request_id === 'string' ? error.request_id : null;
    const details = isRecord(error.details) ? error.details : {};
    throw new ApiError(code, message, res.status, requestId, details);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PATCH', path, { ...options, body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => request<T>('DELETE', path, options),
  put: <T>(path: string, raw: BodyInit, contentType: string, options?: Omit<RequestOptions, 'raw'>) =>
    request<T>('PUT', path, { ...options, raw, contentType }),
  /** A PUT that carries JSON rather than bytes. Kept separate from `put` so a File is never stringified. */
  putJson: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PUT', path, { ...options, body }),
};

// ---------------------------------------------------------------------------- wire types

export interface City {
  id: string;
  name: string;
  state: string;
  is_serviceable: boolean;
}

export interface Area {
  id: string;
  name: string;
}

export interface AppConfig {
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

export interface Profile {
  id: string;
  name: string | null;
  email: string | null;
  phone_last4: string | null;
  status: 'active' | 'suspended' | 'deleted';
  risk_tier: number;
  locale: string;
  verification_state: string;
  /** True only when the channel was actually confirmed, never when it was merely typed in. */
  phone_verified?: boolean;
  email_verified?: boolean;
  created_at: string;
  /** The caller's own staff roles. Additive to the contract (docs/BUILD_NOTES.md DEFECT-011). */
  roles?: string[];
}

export interface AuthResponse {
  access_token: string;
  expires_in: number;
  user: Profile;
}

export interface OtpChallenge {
  challenge_id: string;
  phone_masked: string;
  expires_in_seconds: number;
  resend_after_seconds?: number;
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

export interface QuoteLine {
  label: string;
  amount_paise: number;
  note?: string;
}

export interface Quote {
  id: string;
  formula_version: string;
  policy_version: string;
  subtotal_paise: number;
  platform_fee_paise: number;
  tax_paise: number;
  total_paise: number;
  traveller_paise: number;
  commission_paise: number;
  traveller_subsidy_paise: number;
  discount_paise: number;
  platform_net_paise: number;
  loss_making: boolean;
  within_limits: boolean;
  warnings: string[];
  /** Road distance the fare was computed on, rounded only for display. */
  road_distance_km: number;
  /** `routed` means a provider measurement; `estimated` means no measured distance exists yet. */
  distance_source: 'routed' | 'estimated';
  /** `candidate` → `calculated` → `approved` → `operational`, plus `failed` / `retired`. */
  route_status: string;
  route_provider: string | null;
  route_measured_at: string | null;
  billable_weight_kg: number;
  volumetric_weight_kg: number;
  service_mode: string;
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
  /** completed / (completed + traveller cancellations) over the traveller's last 20 finished trips. */
  reliability_ratio?: number;
  completed_trips: number;
  mode: string;
  departure_at: string;
  arrival_estimate_at: string;
  capacity_kg_remaining: number;
  /** Straight-line band between city centroids — not a road distance. */
  pickup_distance_band_km?: '<1' | '1-3' | '3-5' | '5-10';
  indicative_price_paise: number;
  accepts_documents_only: boolean;
  score_breakdown: {
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

export interface Booking {
  id: string;
  parcel_id: string;
  trip_id: string;
  status: string;
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
  /** The open case, if any. Additive to the contract (docs/BUILD_NOTES.md DEFECT-012). */
  dispute?: {
    id: string;
    state: string;
    category: string;
    created_at: string;
  } | null;
  dispute_deadline: string | null;
  payout_state: string;
  allowed_commands: string[];
  timeline: Array<{
    from_state: string | null;
    to_state: string;
    actor_kind: string;
    actor_role?: 'sender' | 'traveller' | null;
    reason_code: string | null;
    occurred_at: string;
  }>;
  created_at: string;
  updated_at: string;
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

/** Where a parcel stands: the booking that holds it, if a sender has chosen anyone yet. */
export interface ParcelWithBooking extends Parcel {
  booking_id: string | null;
  booking_status: string | null;
}

/** One of the sender's own parcels in the list, with what has happened to it since it was posted. */
export interface ParcelSummary extends ParcelWithBooking {
  /** Travellers who have offered to carry it. The number that tells the sender to come and look. */
  interests_count: number;
}

export interface ParcelList {
  items: ParcelSummary[];
}

/** A traveller's offer on one of your parcels. A flag, not a commitment — see GET /trips/:id/opportunities. */
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

/**
 * One parcel the engine says fits this trip. `indicative_price_paise` is what the sender would be
 * quoted, not what the traveller earns; the traveller's share is only fixed when a booking is created.
 */
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

export interface Verification {  id: string;
  user_id: string;
  state: string;
  id_type: string | null;
  reason_code: string | null;
  attempts: number;
  decided_at: string | null;
  created_at: string;
}

export interface PaymentIntent {
  id: string;
  state: string;
  amount_paise: number;
  currency: string;
  provider: string;
  sandbox: boolean;
  client_secret: string;
  provider_ref: string;
  created_at: string;
}

export interface Dispute {
  id: string;
  booking_id: string;
  category: string;
  state: string;
  outcome_code: string | null;
  evidence: Array<{ id: string; note: string; object_key: string | null; created_at: string }>;
  created_at: string;
  resolved_at: string | null;
}

export interface UploadTicket {
  object_key: string;
  upload_url: string;
  expires_at: string;
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

export interface ConversationMember {
  user_id: string;
  role: 'sender' | 'traveller' | 'recipient';
  name: string;
  you: boolean;
}

export interface Conversation {
  id: string;
  booking_id: string;
  role: ConversationMember['role'];
  closed: boolean;
  members: ConversationMember[];
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

export interface ConversationSummary {
  conversation_id: string;
  booking_id: string;
  booking_status: string;
  role: ConversationMember['role'];
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

export interface AdminVerification {
  id: string;
  user_id: string;
  state: string;
  id_type: string | null;
  reason_code: string | null;
  attempts: number;
  decided_at: string | null;
  created_at: string;
}

/**
 * One submission opened by a reviewer. `view_url` is short-lived and scoped to that single file, so
 * it is fetched when the decision sheet opens rather than carried in the queue.
 */
export interface VerificationDocumentBundle {
  verification: {
    id: string;
    state: string;
    id_type: string | null;
    reason_code: string | null;
    attempts: number;
    created_at: string;
  };
  applicant: {
    user_id: string;
    name: string | null;
    email: string | null;
    phone_masked: string;
    risk_tier: number;
    fraud_flag: boolean;
    member_since: string;
  };
  documents: Array<{
    id: string;
    kind: string;
    label: string;
    mime_type: string;
    byte_size: number;
    content_sha256: string;
    captured_at: string;
    purge_after: string;
    view_url: string | null;
    view_expires_at: string | null;
  }>;
}

export interface AdminBookingRow {
  id: string;
  status: string;
  mode: string;
  agreed_total_paise: number;
  created_at: string;
  updated_at: string;
}

export interface AuditEntry {
  id: number;
  actor_id: string | null;
  actor_kind: string;
  action: string;
  resource: string;
  resource_id: string | null;
  reason_code: string | null;
  created_at: string;
}

export interface AdminDispute {
  id: string;
  booking_id: string;
  category: string;
  description: string;
  state: string;
  outcome_code: string | null;
  created_at: string;
  resolved_at: string | null;
  /** Additive to the contract (docs/BUILD_NOTES.md DEFECT-013): a reviewer must see what was sent. */
  evidence?: Array<{
    id: string;
    note: string;
    object_key: string | null;
    side: 'opener' | 'counterparty';
    created_at: string;
  }>;
}

/** A booking held as an incident or locked for review — what `GET /admin/incidents` answers. */
export interface AdminIncident {
  booking_id: string;
  parcel_id: string;
  status: string;
  sender_name: string | null;
  traveller_name: string | null;
  agreed_total_paise: number;
  captured_paise: number;
  payout_state: string;
  opened_at: string | null;
  opened_by: string | null;
  reason_code: string | null;
  updated_at: string;
}

/** One message in a booking thread, as staff read it. Reading the thread is itself audited. */
export interface AdminThreadMessage {
  id: string;
  kind: string;
  body: string;
  sender_name: string;
  sender_role: string | null;
  created_at: string;
  removed_at: string | null;
  removed_reason: string | null;
}

export interface DevOtp {
  challenge_id?: string;
  booking_id?: string;
  phase?: string;
  code: string;
  kind?: string;
  sandbox: true;
}

// ---------------------------------------------------------------------------- homepage console

export type HomepageReleaseStatus = 'draft' | 'published' | 'archived';
export type HomepageReleaseKind = 'homepage' | 'campaign';
export type HomepagePlatform = 'android' | 'ios' | 'web';

/** A release without its configuration: what the history list and campaign list need. */
export interface HomepageReleaseSummary {
  id: string;
  version: number;
  kind: HomepageReleaseKind;
  status: HomepageReleaseStatus;
  name: string;
  priority: number;
  platforms: HomepagePlatform[];
  starts_at: string | null;
  ends_at: string | null;
  note: string | null;
  published_at: string | null;
  rolled_back_from: number | null;
  created_at: string;
  updated_at: string;
}

export interface HomepageRelease extends HomepageReleaseSummary {
  config: HomepageConfig;
}

/** Everything the console needs to draw its status bar and both lists. */
export interface HomepageConsoleState {
  published: HomepageRelease | null;
  draft: HomepageRelease | null;
  history: HomepageReleaseSummary[];
  campaigns: HomepageRelease[];
  live_campaign_id: string | null;
  schema_version: number;
}

/** The exact document a phone would receive, for the preview panel. */
export interface HomepagePreview {
  document: HomepageDocument;
  base_version: number | null;
  draft: boolean;
}

export interface HomepageMediaItem {
  id: string;
  url: string;
  object_key: string;
  content_type: string;
  byte_size: number;
}

export interface CampaignInput {
  name: string;
  config: HomepageConfig;
  starts_at: string;
  ends_at: string;
  priority: number;
  platforms: HomepagePlatform[];
  note?: string;
}

function previewQuery(params: {
  draft?: boolean;
  platform?: HomepagePlatform;
  campaignId?: string | null;
  at?: string | null;
}): string {
  const query = new URLSearchParams();
  query.set('platform', params.platform ?? 'android');
  query.set('draft', params.draft ? '1' : '0');
  if (params.campaignId) query.set('campaign_id', params.campaignId);
  if (params.at) query.set('at', params.at);
  return query.toString();
}

/**
 * The staff endpoints for the remote homepage.
 *
 * Nothing here is optimistic: a publish changes what every phone in the country sees, so the console
 * re-reads the console state after each mutation instead of assuming the server agreed.
 */
export const homepageAdmin = {
  state: () => api.get<HomepageConsoleState>('/admin/homepage'),

  saveDraft: (config: HomepageConfig, note?: string) =>
    api.putJson<{ draft: HomepageRelease | null }>('/admin/homepage/draft', {
      config,
      ...(note ? { note } : {}),
    }),

  discardDraft: () => api.delete<{ discarded: boolean }>('/admin/homepage/draft'),

  publish: (note?: string) =>
    api.post<{ published: HomepageReleaseSummary }>('/admin/homepage/publish', note ? { note } : {}),

  rollback: (version: number, note?: string) =>
    api.post<{ published: HomepageReleaseSummary }>('/admin/homepage/rollback', {
      version,
      ...(note ? { note } : {}),
    }),

  preview: (params: {
    draft?: boolean;
    platform?: HomepagePlatform;
    campaignId?: string | null;
    at?: string | null;
  }) => api.get<HomepagePreview>(`/admin/homepage/preview?${previewQuery(params)}`),

  createCampaign: (body: CampaignInput) =>
    api.post<{ campaign: HomepageRelease }>('/admin/homepage/campaigns', body),

  updateCampaign: (id: string, body: CampaignInput) =>
    api.putJson<{ campaign: HomepageRelease }>(`/admin/homepage/campaigns/${id}`, body),

  duplicateCampaign: (id: string) =>
    api.post<{ campaign: HomepageRelease }>(`/admin/homepage/campaigns/${id}/duplicate`, {}),

  deleteCampaign: (id: string) =>
    api.delete<{ deleted: boolean }>(`/admin/homepage/campaigns/${id}`),

  publishCampaign: (id: string) =>
    api.post<{ campaign: HomepageRelease }>(`/admin/homepage/campaigns/${id}/publish`, {}),

  unpublishCampaign: (id: string) =>
    api.post<{ campaign: HomepageRelease }>(`/admin/homepage/campaigns/${id}/unpublish`, {}),

  media: () => api.get<{ items: HomepageMediaItem[] }>('/admin/homepage/media'),

  registerMedia: (objectKey: string) =>
    api.post<HomepageMediaItem>('/admin/homepage/media', { object_key: objectKey }),
};
