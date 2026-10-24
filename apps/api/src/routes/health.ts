import type { FastifyInstance } from 'fastify';
import { access, mkdir } from 'node:fs/promises';

import { config } from '../config.ts';
import { migrationStatus } from '../db/migrations.ts';
import { storageRoot } from '../lib/storage.ts';

/**
 * Liveness and readiness.
 *
 * `/health` answers "is this process alive and can it reach its dependencies" and is cheap enough
 * for a container healthcheck. `/readiness` additionally refuses traffic when the database is behind
 * the checked-in migrations, which is the failure mode that otherwise produces 500s after a
 * half-finished deploy.
 */

interface Check {
  name: 'database' | 'storage' | 'queue' | 'migrations';
  status: 'ok' | 'degraded' | 'down';
  latency_ms: number;
  detail?: string;
}

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', { config: { rateLimit: false } }, async (_req, reply) => {
    const checks: Check[] = [];

    let t = Date.now();
    let dbStatus: 'ok' | 'down' = 'ok';
    try {
      await app.db.query('SELECT 1');
    } catch {
      dbStatus = 'down';
    }
    checks.push({ name: 'database', status: dbStatus, latency_ms: Date.now() - t });

    t = Date.now();
    let storageStatus: 'ok' | 'degraded' = 'ok';
    try {
      await mkdir(storageRoot(), { recursive: true });
      await access(storageRoot());
    } catch {
      storageStatus = 'degraded';
    }
    checks.push({ name: 'storage', status: storageStatus, latency_ms: Date.now() - t });

    t = Date.now();
    let queueStatus: 'ok' | 'degraded' = 'ok';
    try {
      await app.db.query('SELECT 1 FROM jobs LIMIT 1');
    } catch {
      queueStatus = 'degraded';
    }
    checks.push({ name: 'queue', status: queueStatus, latency_ms: Date.now() - t });

    const overall = dbStatus === 'down' ? 'down' : checks.some((c) => c.status !== 'ok') ? 'degraded' : 'ok';
    const body = {
      status: overall,
      version: '0.1.0',
      checks,
    };

    app.log.debug(
      {
        payments_live: config.PAYMENTS_LIVE,
        payment_provider: config.PAYMENT_PROVIDER,
        payouts_enabled: config.PAYOUTS_ENABLED,
      },
      'health',
    );

    return reply.code(overall === 'down' ? 503 : 200).send(body);
  });

  app.get('/readiness', { config: { rateLimit: false } }, async (_req, reply) => {
    const checks: Check[] = [];

    let t = Date.now();
    try {
      await app.db.query('SELECT 1');
      checks.push({ name: 'database', status: 'ok', latency_ms: Date.now() - t });
    } catch (err) {
      checks.push({
        name: 'database',
        status: 'down',
        latency_ms: Date.now() - t,
        detail: err instanceof Error ? err.message : 'unreachable',
      });
    }

    t = Date.now();
    try {
      const status = await migrationStatus(app.db);
      const drifted = status.drifted.length > 0;
      const pending = status.pending.length > 0 || status.needsBaseline;
      checks.push({
        name: 'migrations',
        status: drifted || pending ? 'down' : 'ok',
        latency_ms: Date.now() - t,
        ...(drifted
          ? { detail: `drifted: ${status.drifted.map((d) => d.version).join(', ')}` }
          : pending
            ? { detail: `pending: ${status.pending.map((m) => m.version).join(', ') || '0001'}` }
            : {}),
      });
    } catch (err) {
      checks.push({
        name: 'migrations',
        status: 'down',
        latency_ms: Date.now() - t,
        detail: err instanceof Error ? err.message : 'unreadable',
      });
    }

    const ready = checks.every((c) => c.status === 'ok');
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready', checks });
  });
}
