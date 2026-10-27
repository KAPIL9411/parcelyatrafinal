/**
 * Transport for the Parcel Yatra API, deliberately free of React Native imports so it can be
 * exercised in Node.
 *
 * Rules enforced here rather than in screens:
 *  - every mutating call carries an `Idempotency-Key` (the server rejects the ones that matter
 *    without it, and a superfluous key is harmless);
 *  - one 401 triggers exactly one refresh and one retry; a second 401 ends the session;
 *  - a request that never gets an answer is an error with a name (`NETWORK`, `TIMEOUT`), not an
 *    empty success;
 *  - the access token is supplied by the caller and never written anywhere by this module.
 */

export interface ApiErrorDetails {
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: ApiErrorDetails;

  constructor(
    code: string,
    message: string,
    status: number,
    requestId: string | null = null,
    details: ApiErrorDetails = {},
  ) {
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

export interface HttpOptions {
  baseUrl: string;
  getAccessToken: () => string | null;
  /**
   * Exchange long-lived credentials for a fresh access token. Resolve `null` when the session is
   * gone. Concurrent 401s share one call.
   */
  refresh: () => Promise<string | null>;
  onSessionLost: () => void;
  /** Injected so tests and Hermes share the same code path. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  newIdempotencyKey?: () => string;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra headers, e.g. the native-client marker on the auth endpoints. */
  headers?: Record<string, string>;
}

export interface HttpClient {
  request<T>(path: string, options?: RequestOptions): Promise<T>;
  get<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
  delete<T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>): Promise<T>;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function fallbackIdempotencyKey(): string {
  // Not cryptographic: the key only has to be unique per submission.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createHttp(options: HttpOptions): HttpClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const newKey = options.newIdempotencyKey ?? fallbackIdempotencyKey;

  let refreshInFlight: Promise<string | null> | null = null;

  function refreshOnce(): Promise<string | null> {
    if (!refreshInFlight) {
      refreshInFlight = options
        .refresh()
        .catch(() => null)
        .finally(() => {
          refreshInFlight = null;
        });
    }
    return refreshInFlight;
  }

  async function send<T>(path: string, opts: RequestOptions, retried: boolean): Promise<T> {
    const method = opts.method ?? 'GET';
    const auth = opts.auth ?? true;
    const token = auth ? options.getAccessToken() : null;

    const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    if (method !== 'GET') headers['idempotency-key'] = opts.idempotencyKey ?? newKey();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort);

    let res: Response;
    try {
      res = await fetchImpl(`${options.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: controller.signal,
      });
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      if (controller.signal.aborted) {
        throw new ApiError('TIMEOUT', 'The request took too long.', 0);
      }
      throw new ApiError('NETWORK', 'The server could not be reached.', 0);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    if (res.status === 401 && auth && !retried) {
      const next = await refreshOnce();
      if (next) return send<T>(path, opts, true);
      options.onSessionLost();
      throw new ApiError('AUTH_REQUIRED', 'The session has ended.', 401);
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text().catch(() => '');
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      const envelope = (isRecord(parsed) ? parsed : {}) as ErrorEnvelope;
      const error = envelope.error ?? {};
      throw new ApiError(
        typeof error.code === 'string' ? error.code : `HTTP_${res.status}`,
        typeof error.message === 'string' ? error.message : `Request failed (${res.status})`,
        res.status,
        typeof error.request_id === 'string' ? error.request_id : null,
        isRecord(error.details) ? error.details : {},
      );
    }

    return parsed as T;
  }

  return {
    request: <T>(path: string, opts: RequestOptions = {}) => send<T>(path, opts, false),
    get: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
      send<T>(path, { ...opts, method: 'GET' }, false),
    post: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
      send<T>(path, { ...opts, method: 'POST', body }, false),
    patch: <T>(path: string, body?: unknown, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
      send<T>(path, { ...opts, method: 'PATCH', body }, false),
    delete: <T>(path: string, opts: Omit<RequestOptions, 'method' | 'body'> = {}) =>
      send<T>(path, { ...opts, method: 'DELETE' }, false),
  };
}
