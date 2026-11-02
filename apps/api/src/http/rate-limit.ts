/**
 * A fixed-window rate limiter.
 *
 * Scope, stated plainly: this counts per process. On Render that is one long-lived process, which
 * is what the current deployment does. On Cloudflare Workers each isolate has its own map and the
 * platform may run many, so the effective limit there is higher than the configured one. It stops
 * an accidental double-submit and a single abusive client; it is not a defence against a
 * distributed attacker. Global enforcement on Workers needs a Durable Object (or a shared Redis),
 * which is a separate change and is called out in docs/CLOUDFLARE_MIGRATION.md.
 */

export interface LimitRule {
  max: number;
  windowMs: number;
}

export interface LimitVerdict {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets, as Fastify's `x-ratelimit-reset` reports it. */
  resetSeconds: number;
}

const UNIT_MS: Record<string, number> = {
  ms: 1,
  millisecond: 1,
  milliseconds: 1,
  s: 1_000,
  sec: 1_000,
  second: 1_000,
  seconds: 1_000,
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
};

/** Parses Fastify's `timeWindow` values: `'1 minute'`, `'1 hour'`, `'30 seconds'`, or milliseconds. */
export function windowMs(spec: string | number | undefined, fallback: number): number {
  if (spec === undefined) return fallback;
  if (typeof spec === 'number') return spec > 0 ? spec : fallback;

  const match = /^\s*(\d+)\s*([a-z]+)?\s*$/i.exec(spec);
  if (!match) return fallback;
  const amount = Number(match[1]);
  const unit = UNIT_MS[(match[2] ?? 'ms').toLowerCase()];
  if (!unit || !Number.isFinite(amount) || amount <= 0) return fallback;
  return amount * unit;
}

const SWEEP_INTERVAL_MS = 60_000;

export class WindowLimiter {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private nextSweepAt = 0;

  /** Drops expired buckets at most once a minute, so an idle process does not grow forever. */
  private sweep(now: number): void {
    if (now < this.nextSweepAt) return;
    this.nextSweepAt = now + SWEEP_INTERVAL_MS;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  hit(key: string, rule: LimitRule): LimitVerdict {
    const now = Date.now();
    this.sweep(now);

    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + rule.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;

    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return {
      allowed: bucket.count <= rule.max,
      limit: rule.max,
      remaining: Math.max(0, rule.max - bucket.count),
      resetSeconds,
    };
  }
}
