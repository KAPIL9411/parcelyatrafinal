import type { FastifyBaseLogger } from 'fastify';

/**
 * CORS and security headers, reimplemented for the Workers HTTP layer.
 *
 * `@fastify/cors` and `@fastify/helmet` are Fastify plugins: they hook into Fastify's request
 * lifecycle and cannot run behind a different router. These functions reproduce the exact headers
 * the two plugins emit today (captured from the running Fastify app), so a response does not change
 * shape when the API moves hosts.
 */

export interface HeaderWriter {
  header(name: string, value: string | string[]): unknown;
  getHeader(name: string): string | string[] | undefined;
}

/**
 * Helmet's merged Content-Security-Policy for this service: the five directives configured in
 * `app.ts` plus helmet's own defaults. The API serves JSON and single images, never a document
 * shell, so `default-src 'none'` is the base and nothing here needs to be relaxed.
 */
const CONTENT_SECURITY_POLICY =
  "default-src 'none';base-uri 'none';font-src 'self' https: data:;form-action 'none';" +
  "frame-ancestors 'none';img-src 'self' data:;object-src 'none';script-src 'self';" +
  "script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests";

const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['content-security-policy', CONTENT_SECURITY_POLICY],
  ['cross-origin-opener-policy', 'same-origin'],
  // Images are fetched by the web origin with an <img> tag, which CORS does not gate. Access is
  // controlled by the signed token, not by the browser's origin.
  ['cross-origin-resource-policy', 'cross-origin'],
  ['origin-agent-cluster', '?1'],
  ['referrer-policy', 'no-referrer'],
  ['x-content-type-options', 'nosniff'],
  ['x-dns-prefetch-control', 'off'],
  ['x-download-options', 'noopen'],
  ['x-frame-options', 'SAMEORIGIN'],
  ['x-permitted-cross-domain-policies', 'none'],
  ['x-xss-protection', '0'],
];

export function applySecurityHeaders(reply: HeaderWriter, production: boolean): void {
  for (const [name, value] of SECURITY_HEADERS) reply.header(name, value);
  if (production) {
    reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
  }
}

const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, PATCH, OPTIONS';
const EXPOSED_HEADERS = 'Retry-After, X-Request-Id';

/**
 * Applied before the route runs, on purpose: `GET /v1/homepage` sets its own `vary`, and the
 * Fastify plugin's earlier `vary: Origin` is replaced by it. Applying CORS afterwards would append
 * instead, and the two hosts would disagree.
 */
export function applyCors(request: Request, reply: HeaderWriter, origins: readonly string[]): void {
  reply.header('vary', 'Origin');
  reply.header('access-control-allow-credentials', 'true');
  reply.header('access-control-expose-headers', EXPOSED_HEADERS);

  const origin = request.headers.get('origin');
  if (origin && origins.includes(origin)) {
    reply.header('access-control-allow-origin', origin);
  }
}

export function isPreflight(request: Request): boolean {
  return (
    request.method === 'OPTIONS' &&
    request.headers.has('origin') &&
    request.headers.has('access-control-request-method')
  );
}

export function applyPreflight(
  request: Request,
  reply: HeaderWriter,
  origins: readonly string[],
): void {
  const requestedHeaders = request.headers.get('access-control-request-headers');
  reply.header(
    'vary',
    requestedHeaders ? 'Origin, Access-Control-Request-Headers' : 'Origin',
  );

  const origin = request.headers.get('origin');
  if (origin && origins.includes(origin)) {
    reply.header('access-control-allow-origin', origin);
  }
  reply.header('access-control-allow-methods', ALLOWED_METHODS);
  if (requestedHeaders) reply.header('access-control-allow-headers', requestedHeaders);
}
