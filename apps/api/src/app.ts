import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';

import { config } from './config.ts';
import { getDb, type Db } from './db/client.ts';
import { AppError, errorEnvelope } from './lib/errors.ts';
import { makeAuthenticate } from './lib/auth.ts';

import { healthRoutes } from './routes/health.ts';import { authRoutes } from './routes/auth.ts';
import { meRoutes } from './routes/me.ts';
import { catalogueRoutes } from './routes/catalogue.ts';
import { verificationRoutes } from './routes/verification.ts';
import { parcelRoutes } from './routes/parcels.ts';
import { tripRoutes } from './routes/trips.ts';
import { bookingRoutes } from './routes/bookings.ts';
import { paymentRoutes } from './routes/payments.ts';
import { disputeRoutes } from './routes/disputes.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { fileRoutes, filePublicRoutes } from './routes/files.ts';
import { adminRoutes } from './routes/admin.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { devRoutes } from './routes/dev.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  const db = await getDb();

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      // Structured logs only. Never log request bodies: they contain names, phones and addresses.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["idempotency-key"]',
          'res.headers["set-cookie"]',
          '*.phone',
          '*.receiver_phone',
          '*.otp',
          '*.code',
          '*.refresh_token',
          '*.access_token',
        ],
        censor: '[redacted]',
      },
      transport:
        config.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } }
          : undefined,
    },
    trustProxy: config.TRUST_PROXY,
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 1_048_576,
  });

  app.decorate('db', db);

  await app.register(helmet, {
    contentSecurityPolicy: {
      // The API serves JSON and single images, never a document shell. A strict default keeps an
      // uploaded file from ever being interpreted as anything active.
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    // Images are fetched by the web origin with an <img> tag, which CORS does not gate. Access is
    // controlled by the signed token, not by the browser's origin.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts:
      config.NODE_ENV === 'production'
        ? { maxAge: 15_552_000, includeSubDomains: true, preload: false }
        : false,
  });
  await app.register(cors, {
    origin: [config.PUBLIC_WEB_URL, config.ADMIN_WEB_URL, /\.vercel\.app$/],
    credentials: false,
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
  });
  await app.register(rateLimit, {
    global: config.RATE_LIMIT_ENABLED,
    max: config.RATE_LIMIT_READ_PER_MINUTE,
    timeWindow: '1 minute',
    errorResponseBuilder: (req) =>
      errorEnvelope('RATE_LIMITED', 'Too many requests. Please slow down.', String(req.id)),
  });

  // ---- error envelope (api/ERROR_CATALOG.md) ----
  app.setErrorHandler((err, req, reply) => {
    const requestId = String(req.id);

    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error({ err, code: err.code }, 'application error');
      return reply.code(err.status).send(errorEnvelope(err.code, err.message, requestId, err.details));
    }

    if (err instanceof ZodError) {
      const fields = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      return reply
        .code(400)
        .send(errorEnvelope('VALIDATION_FAILED', 'Please check the highlighted fields.', requestId, { fields }));
    }

    if ((err as { validation?: unknown }).validation) {
      return reply.code(400).send(errorEnvelope('VALIDATION_FAILED', 'Please check the highlighted fields.', requestId));
    }

    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 413) {
      return reply.code(413).send(errorEnvelope('PAYLOAD_TOO_LARGE', 'That request is too large.', requestId));
    }
    if (statusCode === 415) {
      return reply.code(415).send(errorEnvelope('VALIDATION_FAILED', 'Send JSON.', requestId));
    }
    if (statusCode && statusCode < 500) {
      return reply
        .code(statusCode)
        .send(errorEnvelope('VALIDATION_FAILED', 'That request could not be processed.', requestId));
    }

    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send(errorEnvelope('INTERNAL_ERROR', 'Something went wrong on our side.', requestId));
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(errorEnvelope('NOT_FOUND', 'We could not find that.', String(req.id)));
  });

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
  await app.register(webhookRoutes, { prefix: '/v1' });
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
      await scope.register(notificationRoutes);
      await scope.register(fileRoutes);
    },
    { prefix: '/v1' },
  );

  await app.register(adminRoutes, { prefix: '/v1' });

  if (config.ENABLE_DEV_ENDPOINTS) {
    await app.register(devRoutes, { prefix: '/v1' });
  }

  return app;
}
