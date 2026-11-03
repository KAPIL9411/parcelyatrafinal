/**
 * The staff console's identity-document review, end to end.
 *
 * A reviewer cannot approve a traveller without reading the submitted selfie and ID photos, and an ID
 * document is the most sensitive object this system holds — so this suite proves both halves at once:
 * the images really do reach the reviewer, and nothing about that path is public.
 *
 * What this proves, in order:
 *   1. a traveller uploads two document photos and a selfie and submits them;
 *   2. the queue itself carries no images — the documents are a separate, role-gated read;
 *   3. a reviewer opening them gets one short-lived URL per file, plus the account details that make a
 *      comparison possible (the name on the ID against the name on the account);
 *   4. those URLs serve the exact bytes that were uploaded, to a caller with no credentials at all;
 *   5. a token with one character changed is refused, and a non-staff account is refused the read;
 *   6. the read is in the audit log against the reviewer's own account id;
 *   7. approving grants the traveller role, and the record leaves the pending queue.
 *
 * Usage: node scripts/kyc-review.mjs     (API must be listening on 127.0.0.1:3000)
 *        KYC_KEEP_PENDING=1 node scripts/kyc-review.mjs
 *          Stops after the submission, leaving it in the queue with its documents attached, so the
 *          staff console can be opened by hand and the photos looked at.
 *
 * The applicant is a fresh phone number every run: a submission that has already been decided cannot
 * be decided again, and reusing a number would make the second run measure nothing. It leaves one
 * verified traveller and three stored images behind in the development database.
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/v1';

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/** Shared with the other harnesses so one run does not burn the 3-per-hour sign-in budget twice. */
const TOKEN_CACHE = '.smoke-tokens.json';

const PHONE = {
  admin: '+919000000009',
  /** Regenerated per run — see the header. */
  applicant: `+919000${String(410000 + (Date.now() % 100_000)).padStart(6, '0')}`,
};

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/**
 * A throttled call is waited out, read or write, by `call` itself, in every harness.
 *
 * The write budget is 60/min per address, the read budget 300/min, and every harness here shares those
 * pools, plus any browser left open on the app. A journey that fails because the previous suite spent
 * the budget measures nothing about the product, and the failure it prints is a lie.
 */
async function call(method, path, opts) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await rawCall(method, path, opts);
    if (res.status !== 429 || attempt >= 5) return res;
    const wait = Number(res.headers.get('retry-after') ?? '5') + 2;
    // Only a window we can sit out is waited. A per-route hourly limit hands the refusal back, because
    // tripping it is a finding the harness reports itself instead of sleeping on.
    if (wait > 75) return res;
    console.log(`  ---- ${method} ${path} throttled; waiting ${wait}s for the rate-limit window`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

async function rawCall(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json, headers: res.headers };
}

/**
 * Signed URLs are built from `PUBLIC_API_URL`, which an operator may point at a tunnel or a domain.
 * The token is what is under test here, so the path is replayed against the port this harness is
 * actually talking to.
 */
function reachable(url) {
  const parsed = new URL(url);
  return `${BASE}${parsed.pathname.replace(/^\/v1/, '')}${parsed.search}`;
}

function loadCache() {
  try {
    return JSON.parse(readFileSync(TOKEN_CACHE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  writeFileSync(TOKEN_CACHE, JSON.stringify(cache, null, 2));
}

/** The refresh token only ever arrives in an HttpOnly cookie; reading the body for it caches undefined. */
function refreshCookieFrom(res) {
  return /py_refresh=([^;,]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1] ?? null;
}

async function signIn(phone) {
  const cache = loadCache();
  const entry = cache[phone];

  if (entry?.access_token) {
    const me = await call('GET', '/me', { token: entry.access_token });
    if (me.status === 200) return { token: entry.access_token, user: me.body };

    if (entry.refresh_token) {
      const refreshed = await call('POST', '/auth/refresh', { headers: { cookie: `py_refresh=${entry.refresh_token}` } });
      if (refreshed.status === 200) {
        cache[phone] = {
          access_token: refreshed.body.access_token,
          refresh_token: refreshCookieFrom(refreshed) ?? entry.refresh_token,
        };
        saveCache(cache);
        return { token: refreshed.body.access_token, user: refreshed.body.user };
      }
    }
  }

  const request = await call('POST', '/auth/otp/request', { body: { phone, purpose: 'login' } });
  if (request.status !== 202) throw new Error(`otp request failed: ${request.status} ${JSON.stringify(request.body)}`);
  const peek = await call('GET', `/dev/otp/${request.body.challenge_id}`);
  if (peek.status !== 200) throw new Error(`dev otp peek failed: ${peek.status} ${JSON.stringify(peek.body)}`);
  const verify = await call('POST', '/auth/otp/verify', {
    body: { challenge_id: request.body.challenge_id, code: peek.body.code },
  });
  if (verify.status !== 200) throw new Error(`otp verify failed: ${verify.status} ${JSON.stringify(verify.body)}`);

  const fresh = loadCache();
  fresh[phone] = { access_token: verify.body.access_token, refresh_token: refreshCookieFrom(verify) };
  saveCache(fresh);
  return { token: verify.body.access_token, user: verify.body.user };
}

// ---------------------------------------------------------------- a real image, drawn here

/**
 * A 240×160 PNG rather than the 1×1 dot the other suites upload, so a storage layer that truncated or
 * collapsed two objects would show up as a hash mismatch instead of passing quietly. The three
 * documents differ only in their pattern, which is exactly that failure mode.
 */
function png(seed) {
  const width = 240;
  const height = 160;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      raw[offset] = (x * 3 + seed * 7) & 0xff;
      raw[offset + 1] = (y * 2 + seed * 13) & 0xff;
      raw[offset + 2] = ((x ^ y) * 5 + seed) & 0xff;
      offset += 3;
    }
  }

  const chunks = [];
  const emit = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    chunks.push(length, body, crc);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  emit('IHDR', ihdr);
  emit('IDAT', deflateSync(raw));
  emit('IEND', Buffer.alloc(0));

  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ...chunks]);
}

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ -1) >>> 0;
}

async function upload(token, purpose, bytes) {
  const ticket = await call('POST', '/files/upload-url', {
    token,
    body: { purpose, content_type: 'image/png', byte_size: bytes.byteLength },
  });
  if (ticket.status !== 201) throw new Error(`upload-url failed: ${ticket.status} ${JSON.stringify(ticket.body)}`);
  const put = await fetch(ticket.body.upload_url, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' },
    body: bytes,
  });
  if (put.status !== 201) throw new Error(`upload sink failed: ${put.status} ${(await put.text()).slice(0, 200)}`);
  return { key: ticket.body.object_key, sha256: createHash('sha256').update(bytes).digest('hex'), bytes };
}

// ---------------------------------------------------------------- the run

async function main() {
  console.log(`\nKYC review — ${BASE}\n  applicant ${PHONE.applicant}\n`);

  const applicant = await signIn(PHONE.applicant);
  const reviewer = await signIn(PHONE.admin);
  check('both accounts sign in', Boolean(applicant.token && reviewer.token));
  check(
    'the reviewer holds a role that may read identity documents',
    (reviewer.user?.roles ?? []).some((role) => role === 'verification_reviewer' || role === 'trust_safety'),
    JSON.stringify(reviewer.user?.roles),
  );

  const front = await upload(applicant.token, 'kyc_id', png(3));
  const back = await upload(applicant.token, 'kyc_id', png(11));
  const selfie = await upload(applicant.token, 'kyc_selfie', png(29));
  check('three documents upload', true, `${front.key} · ${back.key} · ${selfie.key}`);

  const submitted = await call('POST', '/verifications', {
    token: applicant.token,
    body: { id_type: 'driving_licence', id_front_key: front.key, id_back_key: back.key, selfie_key: selfie.key },
  });
  check('the traveller submits the set', submitted.status === 201, `${submitted.status} ${JSON.stringify(submitted.body)}`);
  const verificationId = submitted.body?.id;

  const queue = await call('GET', '/admin/verifications?state=pending&limit=100', { token: reviewer.token });
  const queued = (queue.body?.items ?? []).find((item) => item.id === verificationId);
  check('the submission is waiting in the queue', Boolean(queued), JSON.stringify(queue.body)?.slice(0, 160));
  check('the queue row itself carries no images', Boolean(queued) && !JSON.stringify(queued).includes('view_url'));

  const documents = await call('GET', `/admin/verifications/${verificationId}/documents`, { token: reviewer.token });
  const bundle = documents.body;
  check(
    'a reviewer opens the documents',
    documents.status === 200,
    `${documents.status} ${JSON.stringify(bundle)?.slice(0, 200)}`,
  );

  const kinds = (bundle?.documents ?? []).map((d) => d.kind).sort();
  check(
    'all three captures are there, labelled',
    JSON.stringify(kinds) === JSON.stringify(['id_back', 'id_front', 'selfie']) &&
      (bundle?.documents ?? []).every((d) => d.label && d.label !== 'Document'),
    JSON.stringify(bundle?.documents?.map((d) => [d.kind, d.label])),
  );
  check(
    'every one comes with a view URL and an expiry',
    (bundle?.documents ?? []).every((d) => d.view_url && d.view_expires_at && new Date(d.view_expires_at) > new Date()),
    JSON.stringify(bundle?.documents?.map((d) => [d.kind, d.view_expires_at])),
  );
  check(
    'the reviewer is told whose account this is, with the phone still masked',
    Boolean(bundle?.applicant?.phone_masked?.includes('*')) && !JSON.stringify(bundle).includes(PHONE.applicant),
    JSON.stringify(bundle?.applicant),
  );
  check(
    'and never the raw storage keys',
    !(bundle?.documents ?? []).some((d) => 'object_key' in d) && !JSON.stringify(bundle).includes('kyc_id/'),
    JSON.stringify(bundle?.documents?.[0]),
  );

  const byKind = Object.fromEntries((bundle?.documents ?? []).map((d) => [d.kind, d]));
  for (const [kind, uploaded] of [
    ['id_front', front],
    ['id_back', back],
    ['selfie', selfie],
  ]) {
    const doc = byKind[kind];
    if (!doc?.view_url) {
      check(`${kind} is readable`, false, 'no view URL was issued');
      continue;
    }
    // No credentials at all: the URL is the whole grant, which is what makes it safe for an <img>.
    const fetched = await fetch(reachable(doc.view_url));
    const served = Buffer.from(await fetched.arrayBuffer());
    check(
      `${kind} serves the exact bytes that were uploaded`,
      fetched.status === 200 && createHash('sha256').update(served).digest('hex') === uploaded.sha256,
      `${fetched.status} ${served.byteLength}B`,
    );
    check(
      `${kind} matches the hash and size shown to the reviewer`,
      doc.content_sha256 === uploaded.sha256 && doc.byte_size === uploaded.bytes.byteLength,
      `${doc.content_sha256?.slice(0, 12)}… ${doc.byte_size}B vs ${uploaded.sha256.slice(0, 12)}… ${uploaded.bytes.byteLength}B`,
    );
  }

  const first = (bundle?.documents ?? [])[0]?.view_url ?? '';
  const cut = first.lastIndexOf('/');
  const tampered = `${first.slice(0, cut + 1)}${first.slice(cut + 1).startsWith('A') ? 'B' : 'A'}${first.slice(cut + 2)}`;
  const refused = await fetch(reachable(tampered));
  check('one changed character in a token kills the read', refused.status === 404, `got ${refused.status}`);

  const stranger = await call('GET', `/admin/verifications/${verificationId}/documents`, { token: applicant.token });
  check('the applicant cannot read it back as staff', stranger.status === 403, `got ${stranger.status}`);

  const missing = await call('GET', '/admin/verifications/00000000-0000-4000-8000-000000000000/documents', {
    token: reviewer.token,
  });
  check('a record that does not exist is not readable', missing.status === 404, `got ${missing.status}`);

  const audit = await call('GET', `/admin/audit-log?resource=verification&resource_id=${verificationId}&limit=50`, {
    token: reviewer.token,
  });
  const entry = (audit.body?.items ?? []).find((row) => row.action === 'admin.verification_documents_read');
  check(
    'the read is audited against the reviewer',
    Boolean(entry) && entry.actor_id === reviewer.user?.id,
    JSON.stringify(entry ?? audit.body?.items?.slice(0, 3)),
  );

  if (process.env.KYC_KEEP_PENDING === '1') {
    console.log(`\n  left pending: verification ${verificationId}, applicant ${PHONE.applicant}\n`);
    console.log(`  ${passed} passed, ${failed} failed${failures.length ? `: ${failures.join(', ')}` : ''}\n`);
    process.exitCode = failed ? 1 : 0;
    return;
  }

  const decided = await call('POST', `/admin/verifications/${verificationId}/decision`, {
    token: reviewer.token,
    body: { decision: 'approve', reason_code: 'id_clear' },
  });
  check('approving records the decision', decided.status === 200 && decided.body?.state === 'verified', JSON.stringify(decided.body));

  const after = await call('GET', '/me', { token: applicant.token });
  check('the traveller sees the outcome', after.body?.verification_state === 'verified', JSON.stringify(after.body?.verification_state));
  check('and now holds the traveller role', (after.body?.roles ?? []).includes('traveller'), JSON.stringify(after.body?.roles));

  const reopened = await call('GET', '/admin/verifications?state=pending&limit=100', { token: reviewer.token });
  check(
    'it leaves the pending queue',
    !(reopened.body?.items ?? []).some((item) => item.id === verificationId),
    JSON.stringify(reopened.body?.items?.map((i) => i.id)),
  );

  console.log(`\n  ${passed} passed, ${failed} failed${failures.length ? `: ${failures.join(', ')}` : ''}\n`);
  process.exitCode = failed ? 1 : 0;
}

await main();
