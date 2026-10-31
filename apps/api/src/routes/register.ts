import type { FastifyInstance } from 'fastify';

import { config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { makeAuthenticate } from '../lib/auth.ts';

import { healthRoutes } from './health.ts';
import { authRoutes } from './auth.ts';
import { meRoutes } from './me.ts';
import { catalogueRoutes } from './catalogue.ts';
import { verificationRoutes } from './verification.ts';
import { parcelRoutes } from './parcels.ts';
import { tripRoutes } from './trips.ts';
import { bookingRoutes } from './bookings.ts';
import { paymentRoutes } from './payments.ts';
import { disputeRoutes } from './disputes.ts';
import { messageRoutes } from './messages.ts';
import { notificationRoutes } from './notifications.ts';
import { syncRoutes } from './sync.ts';
import { fileRoutes, filePublicRoutes } from './files.ts';
import { adminRoutes } from './admin.ts';
import { adminGeoRoutes } from './admin-geo.ts';
import { adminHomepageRoutes } from './admin-homepage.ts';
import { homepageRoutes } from './homepage.ts';
import { geoRoutes } from './geo.ts';
import { googleAuthRoutes } from './google-auth.ts';
import { webhookRoutes } from './webhooks.ts';
import { devRoutes } from './dev.ts';
import { trackingRoutes } from './tracking.ts';

export interface RegisterRoutesOptions {
  db: Db;
}

/**
 * The route table, prefixes and auth scopes.
 *
 * Extracted from `buildApp()` so both HTTP hosts mount the identical set in the identical order:
 * Fastify on Render (`app.ts`) and the Hono-backed compatibility layer on Workers (`worker.ts`).
 * A route added here appears on both; there is no second list to forget.
 *
 * Plugins and hooks are Fastify-shaped calls (`app.register`, `app.addHook`,
 * `app.addContentTypeParser`). The Workers layer implements that slice — see `http/fastify-compat.ts`.
 */
export async function registerRoutes(
  app: FastifyInstance,
  { db }: RegisterRoutesOptions,
): Promise<void> {
  app.get('/', async () => ({
    name: 'Parcel Yatra API',
    status: 'ok',
    version: '0.1.0',
    health: '/v1/health',
  }));

  const authenticate = makeAuthenticate(db);

  await app.register(healthRoutes, { prefix: '/v1' });
  await app.register(authRoutes, { prefix: '/v1' });
  await app.register(catalogueRoutes, { prefix: '/v1' });
  await app.register(geoRoutes, { prefix: '/v1' });
  await app.register(webhookRoutes, { prefix: '/v1' });
  // The homepage and its artwork are public and cacheable: an app opening on a cold start must not
  // need a session to draw its first screen.
  await app.register(homepageRoutes, { prefix: '/v1' });
  // Signed file reads carry their own credential in the path, so they sit outside the auth hook.
  await app.register(filePublicRoutes, { prefix: '/v1' });

  await app.register(
    async (scope) => {
      scope.addHook('preHandler', authenticate);
      await scope.register(meRoutes);
      await scope.register(verificationRoutes);
      await scope.register(parcelRoutes);
      await scope.register(tripRoutes);
      await scope.register(bookingRoutes);
      await scope.register(paymentRoutes);
      await scope.register(disputeRoutes);
      await scope.register(messageRoutes);
      await scope.register(notificationRoutes);
      // Reconciliation feed for the web and mobile clients. Authenticated: it only ever reports
      // what the caller is already allowed to read.
      await scope.register(syncRoutes);
      await scope.register(fileRoutes);
      // Live tracking reads and the driver batch sync all call requireAuth(). Registered outside
      // this scope they never received a session and answered 401 to every caller.
      await scope.register(trackingRoutes);
    },
    { prefix: '/v1' },
  );

  // Google OAuth endpoints are public: /auth/google/authorize is the sign-in entry point and
  // /auth/google/callback is called from the browser after Google redirects, before any session
  // exists — they must sit outside the authenticated scope.
  await app.register(googleAuthRoutes, { prefix: '/v1' });

  await app.register(adminRoutes, { prefix: '/v1' });
  await app.register(adminGeoRoutes, { prefix: '/v1' });
  await app.register(adminHomepageRoutes, { prefix: '/v1' });

  if (config.ENABLE_DEV_ENDPOINTS) {
    await app.register(devRoutes, { prefix: '/v1' });
  }
}
