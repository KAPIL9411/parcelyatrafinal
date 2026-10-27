import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';

import { assertSafetyRails, config, corsOrigins } from './config.ts';
import { getDb, type Db } from './db/client.ts';
import { AppError, errorEnvelope } from './lib/errors.ts';
import { makeAuthenticate } from './lib/auth.ts';

import { healthRoutes } from './routes/health.ts';
import { authRoutes } from './routes/auth.ts';
import { meRoutes } from './routes/me.ts';
import { catalogueRoutes } from './routes/catalogue.ts';
import { verificationRoutes } from './routes/verification.ts';
import { parcelRoutes } from './routes/parcels.ts';
import { tripRoutes } from './routes/trips.ts';
import { bookingRoutes } from './routes/bookings.ts';
import { paymentRoutes } from './routes/payments.ts';
import { disputeRoutes } from './routes/disputes.ts';
import { messageRoutes } from './routes/messages.ts';
import { notificationRoutes } from './routes/notifications.ts';
import { fileRoutes, filePublicRoutes } from './routes/files.ts';
import { adminRoutes } from './routes/admin.ts';
import { adminGeoRoutes } from './routes/admin-geo.ts';
import { geoRoutes } from './routes/geo.ts';
import { googleAuthRoutes } from './routes/google-auth.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { devRoutes } from './routes/dev.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export async function buildApp(): Promise<FastifyInstance> {
  // Checked here as well as at the process entry point: any other caller of buildApp() — a test, a
  // worker, a future second entry — must hit the same rails.
  assertSafetyRails(config);
  const db = await getDb();

  const app = Fastify({
    // Fastify's default is 100, and a signed file token is longer than that: the object key, the
    // expiry and a 43-character signature, base64url-encoded. Left at the default, every
    // `/files/signed/:token` read — the one the staff console hands to an `<img>` — answers
    // FST_ERR_MAX_PARAM_LENGTH before the route ever runs. 512 covers a key up to the 256 characters
    // the submission schema allows. It lives under `routerOptions` because Fastify 5 deprecates the
    // top-level key, which printed FSTDEP022 into the production log on every boot.
    routerOptions: { maxParamLength: 512 },
    logger: {
      level: config.LOG_LEVEL,
      // Structured logs only. Never log request bodies: they contain names, phones and addresses.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["idempotency-key"]',
          'res.headers["set-cookie"]',
          // The operator-log SMS sink writes the code as a top-level field, and `*.otp` only reaches
          // one nesting level, so the bare key below is what keeps it out of the log. A bare `code`
          // is deliberately not listed: the error handler logs the error code there.
          'otp',
          '*.otp',
          '*.code',
          '*.code_hash',
          '*.code_sealed',
          '*.phone',
          '*.receiver_phone',
          '*.refresh_token',
          '*.access_token',
          '*.email',
          '*.user_email',
          '*.recovery_email',
          'req.body.email',
          'req.body.receiver_email',
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
    // An exact allowlist, and credentials on: the session refresh cookie only travels to origins we
    // name. A suffix match such as /\.vercel\.app$/ would hand every Vercel tenant that trust.
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    exposedHeaders: ['Retry-After', 'X-Request-Id'],
  });
  await app.register(rateLimit, {
    global: config.RATE_LIMIT_ENABLED,
    max: config.RATE_LIMIT_READ_PER_MINUTE,
    timeWindow: '1 minute',
    // The plugin `throw`s whatever this returns, so it has to be an error the handler below reads a
    // status from. Returning the bare envelope used to fall through to the 500 branch: every throttled
    // request looked like a crash, and the `Retry-After` the plugin had already set was pointless.
    errorResponseBuilder: () => new AppError('RATE_LIMITED'),
  });

  // Writes get a stricter budget than reads. The global limit above is read-shaped; this hook
  // layers the write limit on top by calling the plugin's manual API. Health checks and webhooks
  // opt out — the former is polled by the container, the latter is signed and provider-driven.
  if (config.RATE_LIMIT_ENABLED) {
    const writeBudget = app.createRateLimit({
      keyGenerator: (req) => `w:${req.ip}`,
      max: config.RATE_LIMIT_WRITE_PER_MINUTE,
      timeWindow: '1 minute',
    });
    app.addHook('preHandler', async (req, reply) => {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
      const url = req.url.split('?')[0] ?? req.url;
      if (url.startsWith('/v1/health') || url.startsWith('/v1/readiness')) return;
      if (url.startsWith('/v1/webhooks/')) return;
      // A route that declares `rateLimit: false` opts out of both limiters, not just the global one.
      // `POST /dev/seed/reset` is the case that matters: it is throttled by nothing else, and when the
      // write budget refused it there was no way to restore the demo data until the window rolled.
      if ((req.routeOptions.config as { rateLimit?: unknown } | undefined)?.rateLimit === false) return;
      // The manual limiter does not behave like the route limiter. It answers `{ isAllowed: true }`
      // only for allow-listed keys; every ordinary request comes back `{ isAllowed: false, …}` with
      // the real verdict in `isExceeded` (`current > max`). Reading `isAllowed` here meant that with
      // rate limiting switched on, literally every write — OTP request, booking, PIN check, trip
      // edit — was refused, and before the `reply.send` fix below, every write also still executed.
      const result = await writeBudget(req);
      if (result.isAllowed || !result.isExceeded) return;
      reply.header('retry-after', String(result.ttlInSeconds));
      reply.header('x-ratelimit-limit', String(result.max));
      reply.header('x-ratelimit-remaining', '0');
      reply.header('x-ratelimit-reset', String(result.ttlInSeconds));
      // `reply.send` is the only thing that stops Fastify from running the handler. Returning the
      // envelope from a preHandler hook does not: the booking was created, the PIN attempt counted,
      // the trip edited — while the caller was told to slow down, so the honest-looking retry was a
      // second write.
      return reply.code(429).send(
        errorEnvelope('RATE_LIMITED', 'Too many requests. Please slow down.', String(req.id)),
      );
    });
  }

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
    if (statusCode === 429) {
      return reply.code(429).send(errorEnvelope('RATE_LIMITED', 'Too many requests. Please slow down.', requestId));
    }
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
  await app.register(geoRoutes, { prefix: '/v1' });
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
      await scope.register(messageRoutes);
      await scope.register(notificationRoutes);
      await scope.register(fileRoutes);
    },
    { prefix: '/v1' },
  );

  // Google OAuth endpoints are public: /auth/google/authorize is the sign-in entry point and
  // /auth/google/callback is called from the browser after Google redirects, before any session
  // exists — they must sit outside the authenticated scope.
  await app.register(googleAuthRoutes, { prefix: '/v1' });

  await app.register(adminRoutes, { prefix: '/v1' });
  await app.register(adminGeoRoutes, { prefix: '/v1' });

  if (config.ENABLE_DEV_ENDPOINTS) {
    await app.register(devRoutes, { prefix: '/v1' });
  }

  // ---- Background maintenance: prune expired OTP rate-limit counters ----------
  // Stale rows in otp_sms_counters are harmless (they reset on next access) but accumulate
  // over time. We delete them once a day, immediately after boot and then on a daily interval.
  // setInterval is unref'd so it does not prevent graceful shutdown.
  if (config.JOBS_ENABLED) {
    const pruneOtpCounters = async (): Promise<void> => {
      try {
        // Note: no RETURNING here — PostgreSQL rejects window functions in RETURNING
        // ("window functions are not allowed in RETURNING"). rowCount already carries the
        // number of deleted rows, so the extra column was never needed.
        const result = await db.query(
          `DELETE FROM otp_sms_counters WHERE window_end < now() - interval '1 hour'`,
        );
        const pruned = result.rowCount ?? 0;
        if (pruned > 0) {
          app.log.info({ pruned }, 'pruned expired otp_sms_counters rows');
        }
      } catch (err) {
        app.log.warn({ err }, 'otp_sms_counters pruning failed (non-fatal)');
      }
    };

    app.addHook('onReady', async () => {
      void pruneOtpCounters();
      const interval = setInterval(() => void pruneOtpCounters(), 24 * 60 * 60 * 1000);
      interval.unref();
    });
  }

  return app;
}
