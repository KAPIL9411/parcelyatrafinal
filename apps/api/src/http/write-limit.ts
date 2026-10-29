/**
 * Which writes the stricter write budget applies to.
 *
 * Shared by `app.ts` (Fastify, Node/Render) and the Workers HTTP layer so the exclusions cannot
 * drift apart. Health checks are polled by the platform and webhooks are signed by the provider and
 * arrive in bursts; a route that declares `rateLimit: false` opts out of both budgets.
 */
export interface WriteLimitSubject {
  method: string;
  url: string;
  routeOptions?: { config?: { rateLimit?: unknown } } | undefined;
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function writeLimitApplies(req: WriteLimitSubject): boolean {
  if (!WRITE_METHODS.has(req.method)) return false;

  const url = req.url.split('?')[0] ?? req.url;
  if (url.startsWith('/v1/health') || url.startsWith('/v1/readiness')) return false;
  if (url.startsWith('/v1/webhooks/')) return false;

  const routeConfig = req.routeOptions?.config as { rateLimit?: unknown } | undefined;
  if (routeConfig?.rateLimit === false) return false;

  return true;
}
