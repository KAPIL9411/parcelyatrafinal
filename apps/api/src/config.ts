import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load the repository-root .env first, then a package-local one if present. A variable already set
// in the process environment always wins. `dotenv.config` takes a single path, so try candidates
// in order and stop at the first one that exists (the API boots from `apps/api`, tests from the
// repo root — both must find the same root .env).
function loadEnvironment(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate, quiet: true });
      return;
    }
  }
}
loadEnvironment();

/**
 * Configuration with fail-fast validation and the pilot safety rails from
 * examples/sample.env.example. A misconfiguration stops the process; it never degrades quietly.
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v.toLowerCase() === 'true'))
    .pipe(z.boolean());

const int = (def: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const secret = z.string().min(16, 'must be at least 16 characters');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(3000, 1, 65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PUBLIC_API_URL: z.string().default('http://127.0.0.1:3000/v1'),
  PUBLIC_WEB_URL: z.string().default(process.env.NODE_ENV === 'production' ? 'https://parcelyatrafinal.vercel.app' : 'http://127.0.0.1:5173'),
  ADMIN_WEB_URL: z.string().default(process.env.NODE_ENV === 'production' ? 'https://admin-parcelyatrafinal.vercel.app' : 'http://127.0.0.1:5174'),

  // Database. PGlite is the zero-install development driver; `pg` is used when DATABASE_URL is set.
  DATABASE_URL: z.string().optional(),
  PGLITE_PATH: z.string().default('./data/pgdata'),
  DATABASE_SSL: z.enum(['disable', 'require', 'verify-full']).default('disable'),
  DATABASE_POOL_MAX: int(10, 1, 100),
  DATABASE_STATEMENT_TIMEOUT_MS: int(10_000, 1_000),
  DATABASE_CONNECT_TIMEOUT_MS: int(5_000, 500),
  MIGRATIONS_DIR: z.string().optional(),
  /** Apply pending migrations during boot. The Compose entrypoint runs them as a separate step. */
  MIGRATE_ON_BOOT: bool(false),

  HOST: z.string().default('127.0.0.1'),

  /**
   * Comma-separated addresses that receive the staff role set when they sign in with Google.
   * Compared lowercased against the *Google-verified* email, server-side, at sign-in only.
   */
  ADMIN_EMAILS: z.string().default(''),

  JWT_ACCESS_SECRET: secret.default('dev_only_access_secret_change_me_48bytes'),
  JWT_REFRESH_SECRET: secret.default('dev_only_refresh_secret_change_me_48bytes'),
  JWT_ACCESS_TTL_SECONDS: int(1800, 60, 3600),
  JWT_REFRESH_TTL_SECONDS: int(2_592_000, 60),
  OTP_HMAC_SECRET: secret.default('dev_only_otp_hmac_secret_change_me'),
  OTP_TTL_SECONDS: int(300, 30),
  OTP_MAX_ATTEMPTS: int(5, 1, 10),
  OTP_LENGTH: int(6, 4, 8),
  PHONE_HASH_SECRET: secret.default('dev_only_phone_hash_secret_change_me'),
  /** Seals handover codes so the sender can read them in-app without storing plaintext at rest. */
  OTP_SEAL_SECRET: secret.default('dev_only_otp_seal_secret_change_me'),

  /**
   * Whether a verified phone number is required to *use* the product. It is false while the
   * business has no DLT-registered SMS route: a Google-verified email is then the verified contact
   * channel, and the handover codes stay in-app. Flipping this to true re-arms rule E2 and the OTP
   * login path without any code change.
   */
  PHONE_VERIFICATION_REQUIRED: bool(false),

  // OTP delivery. `log` is the zero-cost pilot path: the code is written to the operator log and
  // relayed out of band. It is never returned to the client.
  // `two_factor` is the production path: 2Factor.in REST API (Indian DLT-compliant).
  // `twilio` is retained for staged rollback only.
  SMS_PROVIDER: z.enum(['log', 'fast2sms', 'two_factor', 'twilio', 'none']).default('log'),
  // Fast2SMS API key — get it from https://fast2sms.com/dashboard (no DLT/business reg needed).
  FAST2SMS_API_KEY: z.string().optional(),
  // 2Factor.in API key. MUST be kept server-side. Never exposed to the frontend or logs.
  TWO_FACTOR_API_KEY: z.string().optional(),
  // Twilio credentials — kept for backward compatibility and staged rollback only.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  // Google OAuth configuration
  GOOGLE_OAUTH_ENABLED: bool(false),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),

  // Kill switch: set to true to immediately disable all new OTP sends (e.g. under wallet abuse).
  // Requires process restart to take effect.
  OTP_KILL_SWITCH: bool(false),

  // Minimum seconds a user must wait before requesting a new OTP for the same phone number.
  OTP_RESEND_COOLDOWN_SECONDS: int(60, 10, 600),

  // Additional per-phone rate limits (the original RATE_LIMIT_OTP_PER_HOUR_PER_NUMBER still applies).
  RATE_LIMIT_OTP_PER_15MIN_PER_NUMBER: int(3, 1, 20),
  RATE_LIMIT_OTP_PER_24H_PER_NUMBER: int(10, 1, 100),

  // Per-IP OTP send limit. Requires TRUST_PROXY=true and correct proxy configuration in production.
  RATE_LIMIT_OTP_PER_15MIN_PER_IP: int(10, 1, 100),

  // Uploads. Local disk is the zero-cost pilot path; Cloudinary is the production path.
  STORAGE_PROVIDER: z.enum(['local', 'cloudinary']).default('local'),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  FILE_SIGNING_SECRET: secret.default('dev_only_file_signing_secret_change_me'),
  FILE_URL_TTL_SECONDS: int(300, 30, 3600),
  // Cloudinary (free tier: 25 GB storage, 25 GB bandwidth/month)
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // Payments — sandbox only.
  PAYMENTS_LIVE: bool(false),
  PAYOUTS_ENABLED: bool(false),
  PAYMENT_PROVIDER: z.enum(['mock', 'sandbox_provider']).default('mock'),
  PAYMENT_WEBHOOK_SECRET: z.string().default('dev_only_webhook_secret_change_me'),
  PAYMENT_CURRENCY: z.literal('INR').default('INR'),
  DUAL_APPROVAL_THRESHOLD_PAISE: int(100_000, 1),

  // Pilot limits
  PILOT_MAX_WEIGHT_KG: int(5, 1, 20),
  PILOT_MAX_DIMENSION_CM: int(45, 1, 100),
  PILOT_MAX_DECLARED_VALUE_PAISE: int(500_000, 1),
  PILOT_WINDOW_MAX_DAYS: int(7, 1, 30),
  QUOTE_TTL_SECONDS: int(900, 60),
  ACCEPT_WINDOW_SECONDS: int(1800, 60),
  DISPUTE_WINDOW_HOURS: int(72, 1),
  REVIEW_WINDOW_DAYS: int(7, 1),

  // Matching tunables (docs/MATCHING_ENGINE.md §4). A trip that fails a hard constraint is never
  // ranked, so these only retune the order of eligible trips.
  MATCH_MAX_ORIGIN_DETOUR_KM: int(10, 0, 50),
  MATCH_ARRIVAL_GRACE_HOURS: int(2, 0, 24),
  MATCH_MIN_SCORE: int(50, 0, 100),
  MATCH_MAX_RESULTS: int(10, 1, 50),
  /** Optional override: `time=30,departure=20,detour=20,reliability=15,capacity=10,preference=5`. */
  MATCH_WEIGHTS: z.string().default(''),
  /** Hard cap on trips read per match request, so a busy corridor cannot exhaust the pool. */
  MATCH_CANDIDATE_SCAN_LIMIT: int(200, 10, 1000),

  // Feature flags
  FEATURE_MATCHING_ENABLED: bool(true),  FEATURE_NEW_BOOKINGS_ENABLED: bool(true),
  FEATURE_VERIFICATION_SUBMISSIONS_ENABLED: bool(true),
  FEATURE_PAYMENTS_ENABLED: bool(true),
  FEATURE_PAYOUTS_ENABLED: bool(false),
  FEATURE_APP_READONLY: bool(false),
  FEATURE_MODE_BIKE: bool(false),
  FEATURE_MODE_BUS: bool(false),
  FEATURE_MODE_TRAIN: bool(false),
  FEATURE_MODE_AIR: bool(false),

  // Jobs
  JOBS_ENABLED: bool(true),
  JOB_POLL_INTERVAL_MS: int(1000, 100, 60_000),

  // Rate limits
  RATE_LIMIT_ENABLED: bool(true),
  RATE_LIMIT_READ_PER_MINUTE: int(300, 1),
  RATE_LIMIT_WRITE_PER_MINUTE: int(60, 1),
  RATE_LIMIT_OTP_PER_HOUR_PER_NUMBER: int(3, 1),
  TRUST_PROXY: bool(false),

  /**
   * Extra browser origins allowed to call the API with credentials, comma separated. Kept as an
   * explicit list: a suffix match such as `*.vercel.app` would let any tenant of the platform read
   * a signed-in user's data.
   */
  WEB_ORIGINS: z.string().default(''),

  LOG_REQUEST_BODIES: bool(false),
  FAIL_FAST_ON_PAYMENT_CONFIG: bool(true),
  REQUIRE_SEPARATE_ADMIN_ORIGIN: bool(true),
  FORBID_MOCK_IN_PRODUCTION: bool(true),

  /**
   * Development-only endpoints: reveal sandbox OTPs, simulate provider webhooks, reset demo data.
   * Never enabled in production — see assertSafetyRails below.
   */
  ENABLE_DEV_ENDPOINTS: bool(process.env.NODE_ENV !== 'production'),

  /** Seed demo data on boot when the database is empty. */
  AUTO_SEED: bool(process.env.NODE_ENV !== 'production'),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`\nInvalid environment configuration:\n${issues}\n\nSee .env.example.\n`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = load();

/** Lowercased, de-duplicated set of addresses that receive staff access at sign-in. */
export const adminEmails = new Set(
  config.ADMIN_EMAILS.split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

/** Exact browser origins permitted to send credentials. Never a pattern. */
export const corsOrigins = Array.from(
  new Set(
    [config.PUBLIC_WEB_URL, config.ADMIN_WEB_URL, ...config.WEB_ORIGINS.split(',').map((o) => o.trim())]
      .filter((o) => o && !o.includes('CHANGE_ME'))
      .map((o) => o.replace(/\/$/, '')),
  ),
);

/** Hard safety rails. These throw at boot rather than at the moment money would move. */
export function assertSafetyRails(c: Config): void {
  const problems: string[] = [];

  if (c.PAYMENTS_LIVE) {
    problems.push(
      'PAYMENTS_LIVE=true is not permitted. The pilot is sandbox-only until GATE-3 is cleared in writing ' +
        '(legal/LEGAL_REGULATORY_MATRIX.md §8).',
    );
  }
  if (c.PAYOUTS_ENABLED || c.FEATURE_PAYOUTS_ENABLED) {
    problems.push('Payouts are disabled at pilot (PAYOUTS_ENABLED=false).');
  }
  if (c.NODE_ENV === 'production' && c.PAYMENT_PROVIDER === 'mock' && c.FORBID_MOCK_IN_PRODUCTION) {
    problems.push('Refusing to start in production with PAYMENT_PROVIDER=mock.');
  }
  if (c.REQUIRE_SEPARATE_ADMIN_ORIGIN && c.ADMIN_WEB_URL === c.PUBLIC_WEB_URL) {
    problems.push('ADMIN_WEB_URL must not equal PUBLIC_WEB_URL.');
  }
  if (c.FEATURE_MODE_BIKE || c.FEATURE_MODE_BUS || c.FEATURE_MODE_TRAIN || c.FEATURE_MODE_AIR) {
    problems.push('Only car mode is enabled at pilot. bike/bus/train/air must stay false.');
  }
  if (c.NODE_ENV === 'production' && c.ENABLE_DEV_ENDPOINTS) {
    problems.push('ENABLE_DEV_ENDPOINTS must be false in production.');
  }
  if (c.NODE_ENV === 'production') {
    for (const key of [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'OTP_HMAC_SECRET',
      'PHONE_HASH_SECRET',
      'OTP_SEAL_SECRET',
      'FILE_SIGNING_SECRET',
    ] as const) {
      if (c[key].startsWith('dev_only_')) problems.push(`${key} still holds its development value.`);
    }
    if (c.PAYMENT_WEBHOOK_SECRET.startsWith('dev_only_')) {
      problems.push('PAYMENT_WEBHOOK_SECRET still holds its development value.');
    }
    if (!c.DATABASE_URL) {
      problems.push(
        'DATABASE_URL is required in production. The embedded PGlite driver is a development engine: ' +
          'it has no backup story, no second process and no connection pooling.',
      );
    }
    if (!c.PUBLIC_WEB_URL.startsWith('https://') || !c.ADMIN_WEB_URL.startsWith('https://')) {
      problems.push('PUBLIC_WEB_URL and ADMIN_WEB_URL must be https:// in production.');
    }
    if (c.STORAGE_PROVIDER === 'cloudinary') {
      for (const key of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const) {
        if (!c[key]) problems.push(`STORAGE_PROVIDER=cloudinary requires ${key}.`);
      }
    }
    if (c.STORAGE_PROVIDER === 'local' && c.NODE_ENV === 'production') {
      console.warn(
        '[warn] STORAGE_PROVIDER=local in production. Uploads are stored on the host disk.\n' +
        '       Set STORAGE_PROVIDER=cloudinary with Cloudinary credentials for durable object storage.',
      );
    }
    if (c.SMS_PROVIDER === 'log') {
      problems.push(
        'SMS_PROVIDER=log in production would print OTP codes to stdout. Use a real gateway (fast2sms / twilio / two_factor) or SMS_PROVIDER=none to disable OTP delivery.',
      );
    }
  }
  if (c.SMS_PROVIDER === 'fast2sms') {
    if (!c.FAST2SMS_API_KEY) problems.push('SMS_PROVIDER=fast2sms requires FAST2SMS_API_KEY (get it from https://fast2sms.com/dashboard).');
    if (c.FAST2SMS_API_KEY?.startsWith('dev_only_') || c.FAST2SMS_API_KEY === 'CHANGE_ME') {
      problems.push('FAST2SMS_API_KEY appears to be a placeholder. Set a real API key from fast2sms.com.');
    }
  }
  if (c.SMS_PROVIDER === 'two_factor') {
    if (!c.TWO_FACTOR_API_KEY) problems.push('SMS_PROVIDER=two_factor requires TWO_FACTOR_API_KEY.');
    if (c.TWO_FACTOR_API_KEY?.startsWith('dev_only_') || c.TWO_FACTOR_API_KEY === 'CHANGE_ME') {
      problems.push('TWO_FACTOR_API_KEY appears to be a placeholder. Set a real API key.');
    }
  }
  if (c.SMS_PROVIDER === 'twilio') {
    for (const key of ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM'] as const) {
      if (!c[key]) problems.push(`SMS_PROVIDER=twilio requires ${key}.`);
    }
  }
  if (c.GOOGLE_OAUTH_ENABLED) {
    for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'] as const) {
      // The shipped template value counts as missing: Google answers a `CHANGE_ME` client id with an
      // opaque redirect_uri_mismatch, and boot is the last place an operator can be told plainly.
      if (!c[key] || c[key] === 'CHANGE_ME') problems.push(`GOOGLE_OAUTH_ENABLED=true requires ${key}.`);
    }
  }
  if (c.OTP_KILL_SWITCH) {
    // Not a hard failure — operators may legitimately enable this during an incident.
    console.warn('[warn] OTP_KILL_SWITCH=true — all new OTP sends are blocked.');
  }
  if (c.LOG_REQUEST_BODIES) {
    problems.push('LOG_REQUEST_BODIES must stay false: request bodies contain personal data.');
  }

  if (problems.length) {
    throw new Error(`Refusing to start:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
}

export const enabledModes = (c: Config) => {
  const modes: Array<'car' | 'bike' | 'bus' | 'train' | 'air'> = [];
  modes.push('car');
  if (c.FEATURE_MODE_BIKE) modes.push('bike');
  if (c.FEATURE_MODE_BUS) modes.push('bus');
  if (c.FEATURE_MODE_TRAIN) modes.push('train');
  if (c.FEATURE_MODE_AIR) modes.push('air');
  return modes;
};
