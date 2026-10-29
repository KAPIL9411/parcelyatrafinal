import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { assertSafetyRails, config, corsOrigins } from './config.ts';
import { getDb, type Db } from './db/client.ts';
import { renderError } from './http/error-response.ts';
import { writeLimitApplies } from './http/write-limit.ts';
import { AppError, errorEnvelope } from './lib/errors.ts';
import { registerRoutes } from './routes/register.ts';
import { runLifecycleSweep } from './services/lifecycle.ts';
import { startRouteBackfill } from './services/trip-route.ts';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
  }
}

export interface BuildAppOptions {
  /** Use an already-connected database instead of the process-wide singleton. */
  db?: Db;
  /** Pino options, when the caller wants Fastify to build its own logger. */
  logger?: FastifyServerOptions['logger'];
}

/**
 * The production logger configuration.
 *
 * Structured logs only. Never log request bodies: they contain names, phones and addresses. The
 * redaction list is the reason the Worker's console logger repeats the same key names — a Worker log
 * stream is as sensitive as a container log stream.
 */
function pinoOptions(): FastifyServerOptions['logger'] {
  return {
    level: config.LOG_LEVEL,
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
  };
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  // Checked here as well as at the process entry point: any other caller of buildApp() — a test, a
  // worker, a future second entry — must hit the same rails.
  assertSafetyRails(config);
  const db = options.db ?? (await getDb());

  const app = Fastify({
    // Fastify's default is 100, and a signed file token is longer than that: the object key, the
    // expiry and a 43-character signature, base64url-encoded. Left at the default, every
    // `/files/signed/:token` read — the one the staff console hands to an `<img>` — answers
    // FST_ERR_MAX_PARAM_LENGTH before the route ever runs. 512 covers a key up to the 256 characters
    // the submission schema allows. It lives under `routerOptions` because Fastify 5 deprecates the
    // top-level key, which printed FSTDEP022 into the production log on every boot.
    routerOptions: { maxParamLength: 512 },
    logger: options.logger ?? pinoOptions(),
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
      // Shared with the Workers HTTP layer so the exclusions cannot drift apart.
      if (!writeLimitApplies(req)) return;
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
  // One mapping for both hosts: `renderError` is also what the Workers layer calls.
  app.setErrorHandler((err, req, reply) => {
    const requestId = String(req.id);
    const rendered = renderError(err, requestId);

    if (rendered.log === 'application') {
      req.log.error({ err, code: (err as AppError).code }, 'application error');
    } else if (rendered.log === 'unhandled') {
      req.log.error({ err }, 'unhandled error');
    }

    return reply.code(rendered.status).send(rendered.body);
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send(errorEnvelope('NOT_FOUND', 'We could not find that.', String(req.id)));
  });

  // The route table lives in `routes/register.ts`, shared with the Workers HTTP layer so the two
  // hosts cannot mount different sets of endpoints.
  await registerRoutes(app, { db });

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

    // Time-based booking transitions: expire unanswered requests, open pickup when the window
    // starts, and settle delivered bookings once the problem window has closed and the sender has
    // paid. Before this, no process ran these edges outside the dev route.
    const sweepLifecycle = async (): Promise<void> => {
      try {
        const summary = await runLifecycleSweep(app);
        if (summary.expired || summary.pickupOpened || summary.settled || summary.failed) {
          app.log.info(summary, 'lifecycle sweep');
        }
      } catch (err) {
        app.log.warn({ err }, 'lifecycle sweep failed (non-fatal)');
      }
    };
    app.addHook('onReady', async () => {
      void sweepLifecycle();
      const interval = setInterval(() => void sweepLifecycle(), 5 * 60 * 1000);
      interval.unref();
    });

    // Trip route measurement: live trips that have no usable road geometry yet are measured a few at
    // a time, in the background. This is the only place corridor matching touches the routing
    // provider, and it never runs inside a request. Disabled with JOBS_ENABLED, which tests set to
    // false so a suite never calls a public OSRM instance.
    let stopRouteBackfill: (() => void) | null = null;
    app.addHook('onReady', async () => {
      stopRouteBackfill = startRouteBackfill(app);
    });
    app.addHook('onClose', async () => {
      stopRouteBackfill?.();
      stopRouteBackfill = null;
    });
  }

  return app;
}
