/**
 * Typed client for the Parcel Yatra API.
 *
 * Two rules from the contract are enforced here rather than in screens:
 *  - every mutating call carries an Idempotency-Key (the server rejects the ones that matter
 *    without it, and an unnecessary key is harmless);
 *  - a 401 triggers exactly one refresh attempt, then the session is cleared.
 */

export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/v1';

const TOKEN_KEY = 'py.session.v1';

export interface Tokens {
  access_token: string;
  refresh_token: string;
}

export function readTokens(): Tokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Tokens>;
    if (typeof parsed.access_token !== 'string' || typeof parsed.refresh_token !== 'string') return null;
    return { access_token: parsed.access_token, refresh_token: parsed.refresh_token };
  } catch {
    return null;
  }
}

export function writeTokens(tokens: Tokens): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
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

async function refreshSession(): Promise<boolean> {
  const tokens = readTokens();
  if (!tokens) return false;

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });

  if (!res.ok) {
    clearTokens();
    return false;
  }

  const next = (await res.json()) as Tokens;
  if (typeof next.access_token !== 'string' || typeof next.refresh_token !== 'string') {
    clearTokens();
    return false;
  }
  writeTokens(next);
  return true;
}

async function refreshOnce(): Promise<boolean> {
  refreshInFlight ??= refreshSession().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, idempotencyKey, auth = true, signal, raw, contentType } = options;

  const attempt = async (): Promise<Response> => {
    const tokens = auth ? readTokens() : null;
    const headers: Record<string, string> = { accept: 'application/json' };

    if (tokens) headers.authorization = `Bearer ${tokens.access_token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (raw !== undefined) headers['content-type'] = contentType ?? 'application/octet-stream';
    if (method !== 'GET' && method !== 'HEAD') {
      headers['idempotency-key'] = idempotencyKey ?? crypto.randomUUID();
    }

    return fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(raw !== undefined ? { body: raw } : {}),
      ...(signal ? { signal } : {}),
    });
  };

  let res = await attempt();

  if (res.status === 401 && auth && readTokens()) {
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
  phone_last4: string;
  status: 'active' | 'suspended' | 'deleted';
  risk_tier: number;
  locale: string;
  verification_state: string;
  created_at: string;
  /** The caller's own staff roles. Additive to the contract (docs/BUILD_NOTES.md DEFECT-011). */
  roles?: string[];
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
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
  mode: string;
  departure_at: string;
  arrival_estimate_at: string;
  capacity_kg_remaining: number;
  indicative_price_paise: number;
  accepts_documents_only: boolean;
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

export interface DevOtp {
  challenge_id?: string;
  booking_id?: string;
  phase?: string;
  code: string;
  kind?: string;
  sandbox: true;
}
