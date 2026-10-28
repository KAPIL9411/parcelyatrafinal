/**
 * The remote homepage: publishing, scheduling, privacy and the allowlists.
 *
 * These requests run through the real Fastify app and the real database, because the properties that
 * matter here are not unit-testable in isolation:
 *
 *  - a draft is invisible to the public *because of the query*, not because a filter was remembered;
 *  - a campaign activates and expires on server time, with no deploy;
 *  - overlapping campaigns resolve to exactly one page;
 *  - an editor cannot save a section, a route or an image this app cannot render;
 *  - publishing is a staff action, and rollback is a new release rather than a rewrite.
 *
 * Run with: npm test
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { test } from 'node:test';

import type { HomepageDocument } from '@py/domain';

process.env.PGLITE_PATH = './data/pgdata.homepage';
process.env.AUTO_SEED = 'false';
process.env.JOBS_ENABLED = 'false';
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.LOG_LEVEL = 'fatal';
process.env.STORAGE_PROVIDER = 'local';

rmSync(process.env.PGLITE_PATH, { recursive: true, force: true });

const { getDb, closeDb } = await import('../src/db/client.ts');
const { runMigrations } = await import('../src/db/migrations.ts');
const { buildApp } = await import('../src/app.ts');
const { createSession } = await import('../src/lib/auth.ts');
const { ensureHomepageSeed, resolveHomepage } = await import('../src/lib/homepage.ts');
const { putObject } = await import('../src/lib/storage.ts');
const domain = await import('@py/domain');

const db = await getDb();
await runMigrations(db);
await ensureHomepageSeed(db);
const app = await buildApp();
await app.ready();

interface Staff {
  token: string;
  userId: string;
}

async function staffSession(roles: string[], tag: string): Promise<Staff> {
  const user = await db.query<{ id: string }>(
    `INSERT INTO users (phone_hash, phone_last4, name) VALUES ($1,'0002',$2) RETURNING id`,
    [`homepage:${tag}:${randomUUID()}`, `Home ${tag}`],
  );
  const userId = user.rows[0]!.id;
  for (const role of roles) {
    await db.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,$2)`, [userId, role]);
  }
  const session = await createSession(db, userId, {});
  return { token: session.accessToken, userId };
}

const trust = await staffSession(['trust_safety'], 'trust');
const support = await staffSession(['support_agent'], 'support');
const readonly = await staffSession(['admin_readonly'], 'readonly');
const plain = await staffSession([], 'plain');

interface Injected<T> {
  statusCode: number;
  body: T;
  headers: Record<string, string | string[] | number | undefined>;
  rawPayload: Buffer;
}

async function call<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  token: string | null = null,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<Injected<T>> {
  const res = await app.inject({
    method,
    url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
  return {
    statusCode: res.statusCode,
    body:
      res.body && String(res.headers['content-type'] ?? '').includes('application/json')
        ? (res.json() as T)
        : (undefined as T),
    headers: res.headers,
    rawPayload: res.rawPayload,
  };
}

/** A complete, valid configuration built from the shipped default, with one field changed. */
function config(overrides: {
  headline?: string;
  themeKey?: string;
  sections?: unknown[];
  hero?: unknown[];
} = {}) {
  const base = domain.defaultHomepageConfig();
  return {
    ...base,
    theme: { ...base.theme, ...(overrides.themeKey ? { key: overrides.themeKey, name: overrides.themeKey } : {}) },
    hero: overrides.hero ?? [{ ...base.hero[0]!, ...(overrides.headline ? { headline: overrides.headline } : {}) }],
    sections: overrides.sections ?? base.sections,
  };
}


async function createCampaign(body: Record<string, unknown>) {
  const res = await call<{ campaign: { id: string; version: number } }>(
    'POST',
    '/v1/admin/homepage/campaigns',
    trust.token,
    body,
  );
  return res;
}

function campaignBody(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    name: 'Diwali 2026',
    config: config({ headline: 'Bring home the light.', themeKey: 'diwali' }),
    starts_at: new Date(now - 60 * 60_000).toISOString(),
    ends_at: new Date(now + 6 * 60 * 60_000).toISOString(),
    priority: 10,
    platforms: ['android', 'ios', 'web'],
    ...overrides,
  };
}

async function publicPage(): Promise<HomepageDocument> {
  const res = await call<HomepageDocument>('GET', '/v1/homepage?platform=android');
  assert.equal(res.statusCode, 200);
  return res.body;
}

// ---------------------------------------------------------------------------- default page

test('the seeded default page is public, cacheable and unchanged for a repeat reader', async () => {
  const res = await call<HomepageDocument>('GET', '/v1/homepage?platform=android');
  assert.equal(res.statusCode, 200);

  const doc = res.body;
  assert.equal(doc.schema_version, 1);
  assert.equal(doc.campaign, null);
  assert.equal(doc.theme.key, 'default');
  assert.equal(doc.hero[0]?.headline, 'Your parcel. Their journey.');
  assert.ok(doc.sections.some((section) => section.type === 'category_grid'));
  assert.ok(doc.refresh_after_seconds >= 30);

  const etag = res.headers.etag;
  assert.equal(typeof etag, 'string');
  assert.match(String(res.headers['cache-control']), /public, max-age=\d+/);
  assert.equal(res.headers['x-homepage-version'], String(doc.version));

  const again = await call('GET', '/v1/homepage?platform=android', null, undefined, {
    'if-none-match': String(etag),
  });
  assert.equal(again.statusCode, 304);
  assert.equal(again.rawPayload.length, 0, 'a 304 must not carry a body');
});

test('/v1/home is the same document as /v1/homepage, including its cache headers', async () => {
  const canonical = await call<HomepageDocument>('GET', '/v1/homepage?platform=android');
  const alias = await call<HomepageDocument>('GET', '/v1/home?platform=android');

  assert.equal(alias.statusCode, 200);
  assert.equal(alias.body.version, canonical.body.version);
  assert.deepEqual(alias.body.theme, canonical.body.theme);
  assert.deepEqual(alias.body.sections, canonical.body.sections);
  assert.equal(alias.headers.etag, canonical.headers.etag);
  assert.equal(alias.headers['cache-control'], canonical.headers['cache-control']);

  const cached = await call('GET', '/v1/home?platform=android', null, undefined, {
    'if-none-match': String(alias.headers.etag),
  });
  assert.equal(cached.statusCode, 304);
});

test('the document the app receives passes the app-side validator', async () => {
  const doc = await publicPage();
  const parsed = domain.parseHomepageDocument(doc);
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.issues.join('; '));
});

// ---------------------------------------------------------------------------- authorisation

test('the console is closed to anonymous callers and to ordinary users', async () => {
  assert.equal((await call('GET', '/v1/admin/homepage')).statusCode, 401);
  assert.equal((await call('PUT', '/v1/admin/homepage/draft', null, { config: config() })).statusCode, 401);
  assert.equal((await call('POST', '/v1/admin/homepage/publish')).statusCode, 401);

  const asUser = await call<{ error: { code: string } }>('GET', '/v1/admin/homepage', plain.token);
  assert.equal(asUser.statusCode, 403);
  assert.equal(asUser.body.error.code, 'ROLE_REQUIRED');
});

test('a support agent may read the page but may not change what users see', async () => {
  const read = await call('GET', '/v1/admin/homepage', support.token);
  assert.equal(read.statusCode, 200);

  const write = await call<{ error: { code: string } }>(
    'PUT',
    '/v1/admin/homepage/draft',
    support.token,
    { config: config() },
  );
  assert.equal(write.statusCode, 403);
  assert.equal(write.body.error.code, 'ROLE_REQUIRED');

  const publish = await call('POST', '/v1/admin/homepage/publish', support.token, {});
  assert.equal(publish.statusCode, 403);
});

test('the role named admin_readonly can read the console but cannot publish', async () => {
  const read = await call('GET', '/v1/admin/homepage', readonly.token);
  assert.equal(read.statusCode, 200);

  for (const [method, url, payload] of [
    ['PUT', '/v1/admin/homepage/draft', { config: config() }],
    ['POST', '/v1/admin/homepage/publish', {}],
    ['POST', '/v1/admin/homepage/rollback', { version: 1 }],
    ['POST', '/v1/admin/homepage/campaigns', campaignBody()],
  ] as const) {
    const res = await call(method, url, readonly.token, payload);
    assert.equal(res.statusCode, 403, `${method} ${url}`);
  }
});

// ---------------------------------------------------------------------------- draft → publish

test('a draft is private until it is published, and publishing bumps the visible version', async () => {
  const before = await publicPage();

  const saved = await call<{ draft: { config: { hero: Array<{ headline: string }> } } }>(
    'PUT',
    '/v1/admin/homepage/draft',
    trust.token,
    { config: config({ headline: 'Draft headline nobody should see yet.' }), note: 'wip' },
  );
  assert.equal(saved.statusCode, 200);

  const stillOld = await publicPage();
  assert.equal(stillOld.hero[0]?.headline, before.hero[0]?.headline, 'a draft must never reach the public route');
  assert.equal(stillOld.version, before.version);

  const published = await call<{ published: { version: number } }>(
    'POST',
    '/v1/admin/homepage/publish',
    trust.token,
    { note: 'go live' },
  );
  assert.equal(published.statusCode, 200);

  const after = await publicPage();
  assert.equal(after.hero[0]?.headline, 'Draft headline nobody should see yet.');
  assert.ok(after.version > before.version, 'a publish must move the version forward');

  const admin = await call<{
    published: { version: number };
    draft: null;
    history: Array<{ version: number; status: string }>;
  }>('GET', '/v1/admin/homepage', trust.token);
  assert.equal(admin.body.draft, null, 'publishing consumes the draft');
  assert.ok(admin.body.history.some((row) => row.status === 'archived'));
});

test('publishing re-validates the draft and refuses content that no longer parses', async () => {
  await call('PUT', '/v1/admin/homepage/draft', trust.token, { config: config() });

  // Simulate a row that was written before a contract change: valid JSON, invalid configuration.
  await db.query(
    `UPDATE homepage_releases SET config = $1::jsonb WHERE kind = 'homepage' AND status = 'draft'`,
    [JSON.stringify({ theme: { key: 'broken', name: 'Broken' }, hero: [{ id: 'x' }], sections: [] })],
  );

  const res = await call<{ error: { code: string; details: { issues: string[] } } }>(
    'POST',
    '/v1/admin/homepage/publish',
    trust.token,
    {},
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error.code, 'VALIDATION_FAILED');
  assert.ok(res.body.error.details.issues.length > 0);

  await call('DELETE', '/v1/admin/homepage/draft', trust.token);
});

test('rollback republishes an older release as a new one, leaving history linear', async () => {
  const admin = await call<{ published: { version: number }; history: Array<{ version: number; status: string }> }>(
    'GET',
    '/v1/admin/homepage',
    trust.token,
  );
  const current = admin.body.published.version;
  const oldest = admin.body.history
    .filter((row) => row.status === 'archived')
    .reduce((min, row) => Math.min(min, row.version), Number.MAX_SAFE_INTEGER);
  assert.ok(oldest < current, 'the history must contain something to roll back to');

  const rolled = await call<{ published: { version: number; rolled_back_from: number } }>(
    'POST',
    '/v1/admin/homepage/rollback',
    trust.token,
    { version: oldest },
  );
  assert.equal(rolled.statusCode, 200);
  assert.equal(rolled.body.published.rolled_back_from, oldest);
  assert.ok(rolled.body.published.version > current, 'a rollback is a new release, not a rewrite');

  const page = await publicPage();
  assert.equal(page.version, rolled.body.published.version);
  assert.equal(page.hero[0]?.headline, 'Your parcel. Their journey.');
});

// ---------------------------------------------------------------------------- validation

test('editor input is validated: unknown sections, unsafe routes and foreign images are refused', async () => {
  const unknownSection = await call<{ error: { code: string; details: { issues: string[] } } }>(
    'PUT',
    '/v1/admin/homepage/draft',
    trust.token,
    {
      config: config({
        sections: [{ id: 'future', type: 'carousel_2027', enabled: true, order: 5 }],
      }),
    },
  );
  assert.equal(unknownSection.statusCode, 400);
  assert.match(unknownSection.body.error.details.issues.join(' '), /carousel_2027|must be one of/);

  const unsafeRoute = await call<{ error: { code: string; details: { issues: string[] } } }>(
    'PUT',
    '/v1/admin/homepage/draft',
    trust.token,
    {
      config: config({
        hero: [
          {
            id: 'h1',
            headline: 'Click me',
            cta: { label: 'Open', action: { kind: 'route', route: 'https://evil.example/steal' } },
          },
        ],
      }),
    },
  );
  assert.equal(unsafeRoute.statusCode, 400);
  assert.match(unsafeRoute.body.error.details.issues.join(' '), /must be one of/);

  const foreignImage = await call<{ error: { details: { issues: string[] } } }>(
    'PUT',
    '/v1/admin/homepage/draft',
    trust.token,
    {
      config: config({
        hero: [{ id: 'h1', headline: 'Nice', image_url: 'https://evil.example/banner.png' }],
      }),
    },
  );
  assert.equal(foreignImage.statusCode, 400);
  assert.match(foreignImage.body.error.details.issues.join(' '), /media library/);

  const badColour = await call<{ error: { details: { issues: string[] } } }>(
    'PUT',
    '/v1/admin/homepage/draft',
    trust.token,
    { config: { ...config(), theme: { key: 'x', name: 'X', brand: 'blue' } } },
  );
  assert.equal(badColour.statusCode, 400);
  assert.match(badColour.body.error.details.issues.join(' '), /hex/);

  const discard = await call<{ error: { code: string } }>('DELETE', '/v1/admin/homepage/draft', trust.token);
  assert.equal(discard.statusCode, 404, 'a refused save must not leave a half-written draft behind');
});

test('a client that does not know a section type drops it instead of failing the page', () => {
  const parsed = domain.parseHomepageConfig({
    schema_version: 1,
    theme: { key: 'default', name: 'Parcel Yatra' },
    hero: [{ id: 'h', headline: 'Hello' }],
    sections: [
      { id: 'known', type: 'trust', enabled: true, order: 1 },
      { id: 'unknown', type: 'hologram_banner', enabled: true, order: 2 },
    ],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(
    parsed.value.sections.map((section) => section.id),
    ['known'],
  );

  const strict = domain.parseHomepageConfig(
    {
      schema_version: 1,
      theme: { key: 'default', name: 'Parcel Yatra' },
      hero: [{ id: 'h', headline: 'Hello' }],
      sections: [{ id: 'unknown', type: 'hologram_banner', enabled: true, order: 2 }],
    },
    { strictUnknownSections: true },
  );
  assert.equal(strict.ok, false);
});

// ---------------------------------------------------------------------------- campaigns

test('a published campaign applies inside its window and disappears when it expires', async () => {
  const created = await createCampaign(campaignBody());
  assert.equal(created.statusCode, 200, JSON.stringify(created.body));
  const id = created.body.campaign.id;

  // A draft campaign is not live even though its window is open.
  const beforePublish = await publicPage();
  assert.equal(beforePublish.campaign, null);

  const published = await call('POST', `/v1/admin/homepage/campaigns/${id}/publish`, trust.token, {});
  assert.equal(published.statusCode, 200, JSON.stringify(published.body));

  const during = await publicPage();
  assert.ok(during.campaign, 'the campaign should be live inside its window');
  assert.equal(during.campaign?.id, id);
  assert.equal(during.theme.key, 'diwali');
  assert.equal(during.hero[0]?.headline, 'Bring home the light.');
  assert.ok(during.expires_at, 'the client needs the expiry to drop stale artwork offline');

  // The window is evaluated against server time, so a clock just past the end must fall back.
  const afterEnd = new Date(Date.parse(during.campaign!.ends_at) + 1000);
  const resolved = await resolveHomepage(db, { platform: 'android', at: afterEnd });
  assert.equal(resolved.document.campaign, null, 'an expired campaign must not linger');
  assert.equal(resolved.document.theme.key, 'default');

  await call('POST', `/v1/admin/homepage/campaigns/${id}/unpublish`, trust.token, {});
  const back = await publicPage();
  assert.equal(back.campaign, null);
  assert.equal(back.theme.key, 'default');
});

test('a campaign only reaches the platforms it names', async () => {
  const created = await createCampaign(
    campaignBody({
      name: 'iOS only',
      platforms: ['ios'],
      config: config({ headline: 'Apple first.', themeKey: 'ios-only' }),
    }),
  );
  const id = created.body.campaign.id;
  await call('POST', `/v1/admin/homepage/campaigns/${id}/publish`, trust.token, {});

  const android = await call<HomepageDocument>('GET', '/v1/homepage?platform=android');
  assert.equal(android.body.campaign, null, 'an iOS campaign must not restyle Android');

  const ios = await call<HomepageDocument>('GET', '/v1/homepage?platform=ios');
  assert.equal(ios.body.campaign?.id, id);

  await call('POST', `/v1/admin/homepage/campaigns/${id}/unpublish`, trust.token, {});
});

test('overlapping campaigns resolve by priority, then by publish order', async () => {
  const low = await createCampaign(
    campaignBody({ name: 'Low', priority: 5, config: config({ headline: 'Low priority.', themeKey: 'low' }) }),
  );
  const high = await createCampaign(
    campaignBody({ name: 'High', priority: 50, config: config({ headline: 'High priority.', themeKey: 'high' }) }),
  );
  await call('POST', `/v1/admin/homepage/campaigns/${low.body.campaign.id}/publish`, trust.token, {});
  await call('POST', `/v1/admin/homepage/campaigns/${high.body.campaign.id}/publish`, trust.token, {});

  const page = await publicPage();
  assert.equal(page.theme.key, 'high');
  assert.equal(page.hero[0]?.headline, 'High priority.');

  await call('POST', `/v1/admin/homepage/campaigns/${high.body.campaign.id}/unpublish`, trust.token, {});
  const fallback = await publicPage();
  assert.equal(fallback.theme.key, 'low', 'unpublishing the winner must reveal the next one');

  await call('POST', `/v1/admin/homepage/campaigns/${low.body.campaign.id}/unpublish`, trust.token, {});
});

test('a campaign whose window is already over cannot be published', async () => {
  const now = Date.now();
  const created = await createCampaign(
    campaignBody({
      name: 'Yesterday',
      starts_at: new Date(now - 4 * 60 * 60_000).toISOString(),
      ends_at: new Date(now - 3 * 60 * 60_000).toISOString(),
    }),
  );
  assert.equal(created.statusCode, 200);

  const published = await call<{ error: { code: string } }>(
    'POST',
    `/v1/admin/homepage/campaigns/${created.body.campaign.id}/publish`,
    trust.token,
    {},
  );
  assert.equal(published.statusCode, 400);
  assert.equal(published.body.error.code, 'VALIDATION_FAILED');

  await call('DELETE', `/v1/admin/homepage/campaigns/${created.body.campaign.id}`, trust.token);
});

test('a published campaign is a historical fact and cannot be edited in place', async () => {
  const created = await createCampaign(campaignBody({ name: 'Frozen' }));
  const id = created.body.campaign.id;
  await call('POST', `/v1/admin/homepage/campaigns/${id}/publish`, trust.token, {});

  const edit = await call<{ error: { code: string } }>(
    'PUT',
    `/v1/admin/homepage/campaigns/${id}`,
    trust.token,
    campaignBody({ name: 'Changed' }),
  );
  assert.equal(edit.statusCode, 409);
  assert.equal(edit.body.error.code, 'CONFLICT');

  const copy = await call<{ campaign: { status: string; id: string } }>(
    'POST',
    `/v1/admin/homepage/campaigns/${id}/duplicate`,
    trust.token,
    {},
  );
  assert.equal(copy.statusCode, 200);
  assert.equal(copy.body.campaign.status, 'draft');
  assert.notEqual(copy.body.campaign.id, id);

  await call('DELETE', `/v1/admin/homepage/campaigns/${copy.body.campaign.id}`, trust.token);
  await call('POST', `/v1/admin/homepage/campaigns/${id}/unpublish`, trust.token, {});
});

// ---------------------------------------------------------------------------- media

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('artwork must belong to the uploader, be campaign artwork, and exist', async () => {
  const notMine = await call('POST', '/v1/admin/homepage/media', trust.token, {
    object_key: `campaign_art/${randomUUID()}/banner.png`,
  });
  assert.equal(notMine.statusCode, 404);

  const wrongPurpose = await call('POST', '/v1/admin/homepage/media', trust.token, {
    object_key: `kyc_id/${trust.userId}/${randomUUID()}.png`,
  });
  assert.equal(wrongPurpose.statusCode, 400);

  const missing = await call('POST', '/v1/admin/homepage/media', trust.token, {
    object_key: `campaign_art/${trust.userId}/${randomUUID()}.png`,
  });
  assert.equal(missing.statusCode, 404, 'a registered row must point at bytes that exist');
});

test('registered artwork is served publicly, immutably, and is the only image a banner may use', async () => {
  const key = `campaign_art/${trust.userId}/${randomUUID()}.png`;
  await putObject(key, PNG);

  const registered = await call<{ id: string; url: string; content_type: string; byte_size: number }>(
    'POST',
    '/v1/admin/homepage/media',
    trust.token,
    { object_key: key },
  );
  assert.equal(registered.statusCode, 200, JSON.stringify(registered.body));
  assert.equal(registered.body.content_type, 'image/png');
  assert.equal(registered.body.byte_size, PNG.length);
  assert.match(registered.body.url, /\/v1\/homepage\/media\/[0-9a-f-]{36}$/);

  const image = await call('GET', registered.body.url.replace(/^https?:\/\/[^/]+\/v1/, '/v1'));
  assert.equal(image.statusCode, 200);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.equal(image.headers['cache-control'], 'public, max-age=31536000, immutable');
  assert.deepEqual(image.rawPayload, PNG);

  const accepted = await call('PUT', '/v1/admin/homepage/draft', trust.token, {
    config: config({
      hero: [{ id: 'h1', headline: 'With artwork', image_url: registered.body.url, gradient: ['#0a1730', '#0a57ff'] }],
    }),
  });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));

  await call('DELETE', '/v1/admin/homepage/draft', trust.token);

  const unknown = await call('GET', `/v1/homepage/media/${randomUUID()}`);
  assert.equal(unknown.statusCode, 404);
});

test('a broken campaign window is refused before it reaches the database', async () => {
  const now = Date.now();
  const inverted = await createCampaign(
    campaignBody({
      starts_at: new Date(now + 60 * 60_000).toISOString(),
      ends_at: new Date(now + 30 * 60_000).toISOString(),
    }),
  );
  assert.equal(inverted.statusCode, 400);
});

// ---------------------------------------------------------------------------- teardown

test('close the database', async () => {
  await app.close();
  await closeDb();
});
