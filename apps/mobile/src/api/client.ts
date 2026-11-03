/**
 * The app's only route to the API.
 *
 * The access token stays in this module's memory: it is short-lived and useless once the process
 * dies. The refresh token is the 30-day credential, so it lives in the platform keystore
 * (`expo-secure-store` maps to Keychain on iOS and EncryptedSharedPreferences on Android) and is
 * never written to AsyncStorage or a log.
 *
 * Native clients identify themselves with `x-py-client: native` on the auth endpoints. The API
 * answers those calls with the refresh token in the JSON body because a React Native app has no
 * cookie jar to receive an HttpOnly cookie. Without the header the server keeps the web contract
 * and the token never leaves the cookie.
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { createHttp, ApiError } from './http.ts';
// Extensionless on purpose: `secret-store.web.ts` replaces the keystore in the browser build, and a
// `.ts` specifier would pin Metro to the native file and drop the platform variant.
import { deleteSecret, readSecret, writeSecret } from '../lib/secret-store';
import {
  canRestoreFromCookie,
  clientMarkerHeaders,
  fetchCredentials,
  refreshTokenMustBeInBody,
} from '../lib/client-transport';
import type {
  AuthResponse,
  Booking,
  BookingList,
  ChatThread,
  CityList,
  Dispute,
  Inbox,
  MatchResult,
  NotificationList,
  OpportunityList,
  OtpChallenge,
  Parcel,
  ParcelList,
  PaymentIntent,
  ParcelOffer,
  ParcelSummary,
  ParcelWithBooking,
  Profile,
  PublicConfig,
  Quote,
  RoutePreview,
  Trip,
  TripList,
  Verification,
} from './types.ts';

/**
 * `EXPO_PUBLIC_API_BASE_URL` is the name the deployment surface uses; `EXPO_PUBLIC_API_BASE` is what
 * this app has always read, and both are honoured so a web host and an EAS profile cannot disagree.
 * A value beginning with `/` is treated as same-origin — the iOS PWA is served from the API's own
 * host so the HttpOnly session cookie is first-party — and every call below stays relative to it.
 */
export const API_BASE = (
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  process.env.EXPO_PUBLIC_API_BASE ??
  (Constants.expoConfig?.extra as { apiBase?: string } | undefined)?.apiBase ??
  'https://parcelyatrafinal.onrender.com/v1'
).replace(/\/$/, '');

const REFRESH_KEY = 'py.refresh_token';
const DEVICE_KEY = 'py.device_id';

/**
 * Re-anchors an absolute URL the server built onto the address this device actually reaches.
 *
 * File URLs (`upload_url`, `avatar_url`) are absolute because they are generated from
 * `PUBLIC_API_URL`. That value is the server's idea of its own address: on a developer machine it
 * is `http://127.0.0.1:3000/v1`, which an Android emulator cannot reach (its host is `10.0.2.2`).
 * The path is what matters, so keep it and swap the origin and API prefix for ours.
 */
export function resolveApiUrl(url: string): string {
  const marker = url.indexOf('/files/');
  if (marker < 0) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  return `${API_BASE}${url.slice(marker)}`;
}

let accessToken: string | null = null;
let refreshToken: string | null = null;
let lastRefreshFailure: 'network' | 'invalid' | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** A token for work outside a screen (background location sync), refreshed when missing or stale. */
export async function ensureAccessToken(): Promise<string | null> {
  return accessToken ?? (await refresh());
}

/** Exchange the refresh token even when an access token is still held; used after an auth rejection. */
export async function refreshAccessToken(): Promise<string | null> {
  return refresh();
}

export function hasAccessToken(): boolean {
  return accessToken !== null;
}

async function readRefreshToken(): Promise<string | null> {
  if (refreshToken) return refreshToken;
  refreshToken = await readSecret(REFRESH_KEY);
  return refreshToken;
}

async function writeRefreshToken(token: string | null): Promise<void> {
  refreshToken = token;
  if (token) await writeSecret(REFRESH_KEY, token);
  else await deleteSecret(REFRESH_KEY);
}

/** Stable per-install id so the server can bind and revoke sessions per device. */
export async function deviceId(): Promise<string> {
  const existing = await readSecret(DEVICE_KEY);
  if (existing) return existing;
  const next = Crypto.randomUUID();
  await writeSecret(DEVICE_KEY, next);
  return next;
}

/**
 * Exchange the stored refresh token. Called only by the transport, never from a screen. A failed
 * exchange clears local state so the app stops presenting itself as signed in.
 *
 * On the web transport there is no stored token to send: the HttpOnly cookie is the credential, so
 * the body is empty and the browser supplies the rest. A native build that has never held a token
 * has nothing to exchange, and asking would only burn a rate-limit slot.
 */
async function refresh(): Promise<string | null> {
  const stored = await readRefreshToken();
  if (!stored && !canRestoreFromCookie) return null;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...clientMarkerHeaders,
      },
      body: stored ? JSON.stringify({ refresh_token: stored }) : JSON.stringify({}),
      credentials: fetchCredentials,
    });
  } catch {
    lastRefreshFailure = 'network';
    return null;
  }

  if (!res.ok) {
    // Only a real authentication rejection ends the session. A 429 from the write limiter or a 5xx
    // from a restarting API used to delete the refresh token and drop the user onto the sign-in
    // screen; the phone then had no way back without a fresh OTP.
    if (res.status === 401 || res.status === 403) {
      lastRefreshFailure = 'invalid';
      await writeRefreshToken(null);
      accessToken = null;
    } else {
      lastRefreshFailure = 'network';
    }
    return null;
  }
  lastRefreshFailure = null;

  const body = (await res.json()) as {
    access_token?: unknown;
    refresh_token?: unknown;
    user?: Profile;
  };
  if (typeof body.access_token !== 'string') {
    await writeRefreshToken(null);
    accessToken = null;
    return null;
  }

  accessToken = body.access_token;
  if (typeof body.refresh_token === 'string') await writeRefreshToken(body.refresh_token);
  return body.access_token;
}

export const http = createHttp({
  baseUrl: API_BASE,
  credentials: fetchCredentials,
  getAccessToken: () => accessToken,
  refresh,
  onSessionLost: () => {
    accessToken = null;
    void writeRefreshToken(null);
  },
});

function adopt(session: AuthResponse): AuthResponse {
  accessToken = session.access_token;
  if (session.refresh_token) void writeRefreshToken(session.refresh_token);
  return session;
}

export async function requestOtp(phone: string): Promise<OtpChallenge & { phone_masked: string }> {
  return http.post<OtpChallenge & { phone_masked: string }>(
    '/auth/otp/request',
    { phone, purpose: 'login' },
    { auth: false },
  );
}

/**
 * Development convenience, mirroring the web login: a server running with dev endpoints keeps the
 * OTP in memory so the sign-in screen can show it. Any other server has no such route, the call
 * fails, and the screen shows no hint. The code is displayed only, never stored.
 */
export async function peekDevOtp(challengeId: string): Promise<string | null> {
  try {
    const res = await http.get<{ code?: unknown }>(`/dev/otp/${encodeURIComponent(challengeId)}`, { auth: false });
    return typeof res.code === 'string' ? res.code : null;
  } catch {
    return null;
  }
}

export async function verifyOtp(challengeId: string, code: string): Promise<AuthResponse> {
  const session = await http.post<AuthResponse>(
    '/auth/otp/verify',
    { challenge_id: challengeId, code, device_id: await deviceId() },
    { auth: false, headers: clientMarkerHeaders },
  );
  if (refreshTokenMustBeInBody && !session.refresh_token) {
    // A native-tagged response without a refresh token means the server did not adopt the native
    // transport. Rather than pretend the session is durable, fail loudly. On the web transport the
    // field is never sent — the HttpOnly cookie is the renewable session.
    accessToken = session.access_token;
    throw new ApiError('SESSION_NOT_TRANSPORTED', 'The server did not issue a renewable session.', 500);
  }
  return adopt(session);
}

/**
 * Google sign-in for a build configured with an OAuth client id. The ID token is verified by the
 * existing backend endpoint; the app never reads the profile itself.
 */
export async function signInWithGoogle(idToken: string): Promise<AuthResponse> {
  const session = await http.post<AuthResponse>(
    '/auth/google/token',
    { id_token: idToken, device_id: await deviceId() },
    { auth: false, headers: clientMarkerHeaders },
  );
  if (refreshTokenMustBeInBody && !session.refresh_token) {
    accessToken = session.access_token;
    throw new ApiError('SESSION_NOT_TRANSPORTED', 'The server did not issue a renewable session.', 500);
  }
  return adopt(session);
}

/**
 * The browser/PWA half of Google sign-in: exchange the one-time code Google put on
 * `/auth-callback` for a session.
 *
 * The API verifies the sealed `state` (PKCE verifier + nonce), checks the `binding` the browser
 * kept while Google was away, and answers with an access token and the HttpOnly refresh cookie.
 * This is the same session the native app gets from `POST /auth/google/token`; only the way the
 * identity is obtained differs.
 */
export async function completeGoogleCallback(
  code: string,
  state: string,
  binding?: string | null,
): Promise<AuthResponse> {
  const session = await http.post<AuthResponse>(
    '/auth/google/callback',
    {
      code,
      state,
      ...(binding ? { binding } : {}),
      device_id: await deviceId(),
    },
    { auth: false, headers: clientMarkerHeaders },
  );
  if (refreshTokenMustBeInBody && !session.refresh_token) {
    accessToken = session.access_token;
    throw new ApiError('SESSION_NOT_TRANSPORTED', 'The server did not issue a renewable session.', 500);
  }
  return adopt(session);
}

/**
 * Restore a stored session at launch. `offline` is deliberately distinct from `signed_out`: a
 * revoked token and an unreachable server must not both send the user back to the sign-in screen.
 */
export type BootstrapResult = 'signed_in' | 'signed_out' | 'offline';

export async function bootstrapSession(): Promise<BootstrapResult> {
  if (!(await readRefreshToken()) && !canRestoreFromCookie) return 'signed_out';
  if (await refresh()) return 'signed_in';
  return lastRefreshFailure === 'network' ? 'offline' : 'signed_out';
}

export async function signOut(everywhere = false): Promise<void> {
  try {
    await http.post(`/auth/${everywhere ? 'logout-all' : 'logout'}`, {});
  } catch {
    // The local session is cleared regardless; the server row expires on its own.
  } finally {
    accessToken = null;
    await writeRefreshToken(null);
  }
}

export async function me(): Promise<Profile> {
  return http.get<Profile>('/me');
}

export async function updateMe(body: {
  name?: string;
  email?: string;
  locale?: 'en-IN' | 'hi-IN';
  /** The key returned by `filesApi.upload('avatar', …)`. `null` removes the photo. */
  avatar_key?: string | null;
  /** Marks the first-run setup screen answered, whether a photo was added or skipped. */
  profile_setup_completed?: true;
}): Promise<Profile> {
  return http.patch<Profile>('/me', body);
}

/** Soft-deletes the account. The server refuses while a booking is still open. */
export async function requestAccountDeletion(): Promise<{ deleted_at: string; hard_delete_after: string }> {
  return http.post<{ deleted_at: string; hard_delete_after: string }>('/me/deletion-request', {
    confirm: true,
    reason: 'requested_in_app',
  });
}

/**
 * Asks for a copy of the account data. The pilot has no background worker, so the server answers
 * with an honest refusal; the screen shows that message rather than a fake "queued" toast.
 */
export async function requestDataExport(): Promise<{ message?: string }> {
  return http.post<{ message?: string }>('/me/export', {});
}

// ---------------------------------------------------------------------------- sender

export const senderApi = {
  config: () => http.get<PublicConfig>('/config', { auth: false }),
  cities: () => http.get<CityList>('/cities', { auth: false }),
  areas: (cityId: string) =>
    http.get<{ items: { id: string; name: string }[] }>(`/cities/${cityId}/areas`, { auth: false }),
  /** Road geometry between two serviceable cities, for the send screen's map. */
  routePreview: (query: {
    origin_city_id: string;
    dest_city_id: string;
    origin_area?: string;
    dest_area?: string;
  }) => {
    const params = new URLSearchParams({
      origin_city_id: query.origin_city_id,
      dest_city_id: query.dest_city_id,
    });
    if (query.origin_area) params.set('origin_area', query.origin_area);
    if (query.dest_area) params.set('dest_area', query.dest_area);
    return http.get<RoutePreview>(`/geo/route-preview?${params.toString()}`, { auth: false });
  },

  createParcel: (body: Record<string, unknown>) => http.post<Parcel>('/parcels', body),
  myParcels: () => http.get<ParcelList>('/parcels?limit=50'),
  parcel: (id: string) => http.get<ParcelWithBooking>(`/parcels/${id}`),
  matches: (id: string) => http.get<MatchResult>(`/parcels/${id}/matches`),
  interests: (id: string) => http.get<{ parcel_id: string; items: ParcelOffer[] }>(`/parcels/${id}/interests`),
  quote: (id: string) => http.post<Quote>(`/parcels/${id}/quote`),
  cancelParcel: (id: string) => http.delete<void>(`/parcels/${id}`),
  book: (parcelId: string, tripId: string, quoteId: string) =>
    http.post<{ id: string }>('/bookings', { parcel_id: parcelId, trip_id: tripId, quote_id: quoteId }),
};

// ---------------------------------------------------------------------------- traveller

export const travellerApi = {
  verification: () => http.get<Verification>('/verifications/me'),
  trips: () => http.get<TripList>('/trips?limit=100'),
  trip: (id: string) => http.get<Trip>(`/trips/${id}`),
  createTrip: (body: Record<string, unknown>) => http.post<Trip>('/trips', body),
  updateTrip: (id: string, body: Record<string, unknown>) => http.patch<Trip>(`/trips/${id}`, body),
  cancelTrip: (id: string) => http.delete<void>(`/trips/${id}`),
  opportunities: (tripId: string) => http.get<OpportunityList>(`/trips/${tripId}/opportunities`),
  offer: (tripId: string, parcelId: string) =>
    http.post<void>(`/trips/${tripId}/opportunities/${parcelId}/interest`, {}),
  submitVerification: (body: Record<string, unknown>) => http.post<Verification>('/verifications', body),
};

// ---------------------------------------------------------------------------- shared

export const bookingsApi = {
  list: (role?: 'sender' | 'traveller') =>
    http.get<BookingList>(`/bookings?limit=100${role ? `&role=${role}` : ''}`),
  get: (id: string) => http.get<Booking>(`/bookings/${id}`),
  transition: (id: string, command: string, extra: Record<string, unknown> = {}) =>
    http.post<void>(`/bookings/${id}/transitions`, { command, ...extra }),
  handoverCode: (id: string, phase: 'pickup' | 'delivery') =>
    http.get<{ phase: string; code: string; expires_at: string }>(`/bookings/${id}/handover-code/${phase}`),
  regenerateCode: (id: string, phase: 'pickup' | 'delivery') =>
    http.post<void>(`/bookings/${id}/otp/regenerate`, { phase }),
  confirmHandover: (
    id: string,
    phase: 'pickup' | 'delivery',
    body: Record<string, unknown>,
  ) => http.post<void>(`/bookings/${id}/handover/${phase}`, body),
  review: (id: string, stars: number, tags: string[]) =>
    http.post<void>(`/bookings/${id}/review`, { stars, tags }),
  thread: (id: string) => http.get<ChatThread>(`/bookings/${id}/conversation/messages?limit=100`),
  sendMessage: (id: string, body: string) =>
    http.post<{ id: string }>(`/bookings/${id}/conversation/messages`, { body }),
  markThreadRead: (id: string) => http.post<void>(`/bookings/${id}/conversation/read`, {}),
  paymentIntent: (id: string) => http.post<PaymentIntent>(`/bookings/${id}/payment-intent`, {}),
};

/**
 * Development-only helpers. The API refuses to register these routes in production, and callers
 * guard them with `__DEV__`; they exist so a local demo can drive the sandbox payment webhook.
 */
export const devApi = {
  simulateWebhook: (type: string, providerRef: string) =>
    http.post<unknown>('/dev/webhooks/simulate', { type, provider_ref: providerRef }),
  runLifecycle: () => http.post<unknown>('/dev/lifecycle/run', {}),
};

export const disputesApi = {
  get: (id: string) => http.get<Dispute>(`/disputes/${id}`),
  open: (bookingId: string, category: string, description: string) =>
    http.post<Dispute>('/disputes', { booking_id: bookingId, category, description }),
  addEvidence: (id: string, note: string, objectKey?: string) =>
    http.post<unknown>(`/disputes/${id}/evidence`, { note, ...(objectKey ? { object_key: objectKey } : {}) }),
};

export const notificationsApi = {
  list: () => http.get<NotificationList>('/notifications?limit=30'),
  readAll: () => http.post<void>('/notifications/read-all', {}),
  read: (id: string) => http.post<void>(`/notifications/${id}/read`, {}),
};

export const conversationsApi = {
  /** Every thread the caller belongs to, newest activity first, with unread counts. */
  list: () => http.get<Inbox>('/conversations?limit=50'),
};

/**
 * The change feed the app polls instead of guessing when to refetch.
 *
 * `scopes` maps a domain to an opaque revision that only moves when a row the caller may see
 * changed, so comparing two polls tells the client which query families to invalidate. The feed
 * carries no parcel, contact or message data of its own.
 */
export interface SyncState {
  generated_at: string;
  revision: string;
  scopes: Record<string, string>;
  counts: { notifications_unread: number; messages_unread: number };
  /** Present only for staff accounts; the mobile build has no staff screens. */
  admin?: { pending_verifications: number; open_disputes: number; pending_payouts: number };
}

export const syncApi = {
  state: () => http.get<SyncState>('/sync/state'),
};

export const filesApi = {
  /**
   * The API's own upload sink. `PUT` takes the raw bytes, so the caller keeps the file on device
   * until the server has accepted it. Used for identity documents and handover photos alike.
   */
  upload: async (
    purpose: 'kyc_id' | 'kyc_selfie' | 'avatar' | 'parcel_sealed' | 'parcel_delivery' | 'dispute_evidence',
    localUri: string,
    contentType: 'image/jpeg' | 'image/png',
  ): Promise<{ object_key: string }> => {
    // `expo-file-system` is a native module and its `File` throws on the web target, so a browser
    // reads the photo from the blob URL the picker produced. The native path is untouched.
    let bytes: ArrayBuffer;
    if (Platform.OS === 'web') {
      bytes = await (await fetch(localUri)).arrayBuffer();
    } else {
      bytes = await new File(localUri).arrayBuffer();
    }
    if (!bytes.byteLength) throw new ApiError('UPLOAD_FAILED', 'That photo could not be read.', 0);

    const ticket = await http.post<{ object_key: string; upload_url: string }>('/files/upload-url', {
      purpose,
      content_type: contentType,
      byte_size: bytes.byteLength,
    });

    const res = await fetch(resolveApiUrl(ticket.upload_url), {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${accessToken ?? ''}`,
        'content-type': contentType,
      },
      body: bytes,
    });
    if (!res.ok) throw new ApiError('UPLOAD_FAILED', 'The photo could not be uploaded.', res.status);
    return { object_key: ticket.object_key };
  },
};

export type { Parcel, ParcelSummary, Trip, Booking, Profile };
