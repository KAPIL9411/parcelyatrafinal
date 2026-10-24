import type { FastifyInstance } from 'fastify';

import type { Db } from '../db/client.ts';

/**
 * A Fastify instance that reads and writes through `db` instead of the process-wide handle.
 *
 * `applyBookingTransition` takes the app because it needs `app.db` alongside the request's logger
 * and config. Passing a scoped app lets a caller run that transition inside `db.transaction(...)`,
 * so the booking state change and the rows it implies commit or roll back together.
 *
 * This is deliberately narrow: it only replaces `db`. Everything else is inherited from the real
 * instance, so logging, config and decorators keep working.
 */
export function withDb(app: FastifyInstance, db: Db): FastifyInstance {
  const scoped = Object.create(app) as FastifyInstance;
  Object.defineProperty(scoped, 'db', { value: db, configurable: true, enumerable: false });
  return scoped;
}
