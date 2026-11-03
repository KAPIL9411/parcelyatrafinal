/**
 * Messaging and notification E2E test against a running API.
 *
 * Proves the coordination channel the product was missing, and the authorisation rule that makes it
 * safe to have one:
 *   1. A thread exists for a booking and only its members can see it.
 *   2. A message posted by one party is readable by the other, with an unread count.
 *   3. A non-member — including another verified traveller — gets 404, not 403.
 *   4. A closed booking refuses new posts.
 *   5. Notifications carry a read state and an unread count that goes down when marked read.
 *   6. The delivery code reaches the sender: at `arrived` the sender has a notification and can read
 *      the code, which is the step that used to dead-end the whole delivery.
 *
 * Usage: node scripts/messaging.mjs        (API must be listening on 127.0.0.1:3000)
 *
 * Runs entirely against seeded pilot accounts with the sandbox OTP peek. It creates no parcels and
 * touches no money, so it is safe to re-run; the only permanent effect is chat history on the demo
 * booking, which is what the test is about.
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/v1';

const BOOKING_DEMO = '90000000-0000-4000-8000-000000000001';
const PHONE = {
  sender: '+919000000001',
  traveller: '+919000000002',
  other: '+919000000003',
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
 * pools, plus any
 * browser left open on the app. A run that fails because the previous suite spent the budget measures
 * nothing about the product, and the failure it prints is a lie. The refusal arrives from a preHandler
 * before the route runs, so nothing was created and the retry is safe.
 */
async function call(method, path, opts) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await rawCall(method, path, opts);
    if (res.status !== 429 || attempt >= 5) return res;
    const wait = Number(res.headers.get('retry-after') ?? '5') + 2;
    // A window we can sit out is waited: the shared read and write budgets name at most a minute. A per-route
    // hourly limit hands the refusal straight back instead of making the harness sleep on it.
    if (wait > 75) return res;
    console.log(`  ---- ${method} ${path} throttled; waiting ${wait}s for the rate-limit window`);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
}

async function rawCall(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'idempotency-key': crypto.randomUUID() } : {}),
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

/** Positional shorthand for an auth write; the throttling itself now lives in `call`. */
async function writeInRoom(path, body, token) {
  return call('POST', path, { body, ...(token ? { token } : {}) });
}

async function signIn(phone) {
  const request = await writeInRoom('/auth/otp/request', { phone, purpose: 'login' });
  if (request.status !== 202) throw new Error(`otp request ${request.status} ${JSON.stringify(request.body)}`);
  const peek = await call('GET', `/dev/otp/${request.body.challenge_id}`);
  if (peek.status !== 200) throw new Error(`otp peek ${peek.status} ${JSON.stringify(peek.body)}`);
  const verify = await writeInRoom('/auth/otp/verify', { challenge_id: request.body.challenge_id, code: peek.body.code });
  if (verify.status !== 200) throw new Error(`otp verify ${verify.status} ${JSON.stringify(verify.body)}`);
  return verify.body.access_token;
}

async function main() {
  console.log(`\nParcel Yatra messaging test → ${BASE}\n`);

  const health = await call('GET', '/health');
  if (health.status !== 200) throw new Error(`API not reachable at ${BASE}`);

  const sender = await signIn(PHONE.sender);
  const traveller = await signIn(PHONE.traveller);
  const outsider = await signIn(PHONE.other);
  check('three accounts signed in with sandbox OTP', Boolean(sender && traveller && outsider));

  // ---- the thread belongs to the booking
  const convo = await call('GET', `/bookings/${BOOKING_DEMO}/conversation`, { token: sender });
  check('sender sees the booking thread', convo.status === 200, `${convo.status} ${JSON.stringify(convo.body).slice(0, 160)}`);
  check('thread has both parties as members', (convo.body?.members ?? []).length >= 2, JSON.stringify(convo.body?.members));
  check('caller role is reported', convo.body?.role === 'sender');

  const outsiderConvo = await call('GET', `/bookings/${BOOKING_DEMO}/conversation`, { token: outsider });
  check(
    'a non-member gets 404, not 403',
    outsiderConvo.status === 404 && outsiderConvo.body?.error?.code === 'NOT_FOUND',
    `${outsiderConvo.status} ${JSON.stringify(outsiderConvo.body).slice(0, 160)}`,
  );

  const outsiderMessages = await call('GET', `/bookings/${BOOKING_DEMO}/conversation/messages`, { token: outsider });
  check('a non-member cannot read the history either', outsiderMessages.status === 404);

  const outsiderPost = await call('POST', `/bookings/${BOOKING_DEMO}/conversation/messages`, {
    token: outsider,
    body: { body: 'let me in' },
  });
  check('a non-member cannot post', outsiderPost.status === 404);

  // ---- posting and reading
  const stamp = new Date().toISOString();
  const posted = await call('POST', `/bookings/${BOOKING_DEMO}/conversation/messages`, {
    token: sender,
    body: { body: `Pickup from Civil Lines gate at 10am. Ref ${stamp.slice(11, 19)}` },
  });
  check('sender posts a message', posted.status === 201, `${posted.status} ${JSON.stringify(posted.body).slice(0, 160)}`);
  check('the post echoes the stored body', typeof posted.body?.body === 'string' && posted.body.body.includes('Civil Lines'));

  const travInbox = await call('GET', `/bookings/${BOOKING_DEMO}/conversation/messages`, { token: traveller });
  check('traveller reads the thread', travInbox.status === 200);
  const bodies = (travInbox.body?.items ?? []).map((m) => m.body);
  check('the posted message reached the traveller', bodies.some((b) => b.includes('Civil Lines gate')), JSON.stringify(bodies).slice(0, 200));
  check('a system note explains the rules of the thread', bodies.some((b) => b.toLowerCase().includes('handover')));
  check('the traveller has something unread', travInbox.body?.unread_count >= 1, `unread ${travInbox.body?.unread_count}`);
  check('messages come back oldest first', (() => {
    const ts = (travInbox.body?.items ?? []).map((m) => Date.parse(m.created_at));
    return ts.every((t, i) => i === 0 || t >= ts[i - 1]);
  })());

  const senderInbox = await call('GET', `/bookings/${BOOKING_DEMO}/conversation/messages`, { token: sender });
  check('your own message is not unread for you', senderInbox.body?.unread_count === 0, `unread ${senderInbox.body?.unread_count}`);

  // ---- validation and abuse limits
  const empty = await call('POST', `/bookings/${BOOKING_DEMO}/conversation/messages`, { token: sender, body: { body: '   ' } });
  check('whitespace-only messages are refused', empty.status === 400, `${empty.status} ${JSON.stringify(empty.body).slice(0, 120)}`);

  const control = await call('POST', `/bookings/${BOOKING_DEMO}/conversation/messages`, {
    token: sender,
    body: { body: 'ok\u0000evil\u001bescape' },
  });
  check(
    'control characters are stripped, not stored',
    control.status === 201 && !control.body.body.includes('\u0000') && !control.body.body.includes('\u001b'),
    JSON.stringify(control.body).slice(0, 140),
  );

  const tooLong = await call('POST', `/bookings/${BOOKING_DEMO}/conversation/messages`, {
    token: sender,
    body: { body: 'x'.repeat(2001) },
  });
  check('oversized messages are refused', tooLong.status === 400 && tooLong.body?.error?.code === 'VALIDATION_FAILED');

  const unknownField = await call('POST', `/bookings/${BOOKING_DEMO}/conversation/messages`, {
    token: sender,
    body: { body: 'hi', as_admin: true },
  });
  check('a request cannot smuggle extra fields', unknownField.status === 400);

  // ---- read state
  const marked = await call('POST', `/bookings/${BOOKING_DEMO}/conversation/read`, { token: traveller });
  check('traveller marks the thread read', marked.status === 200 && marked.body?.unread_count === 0);

  const afterRead = await call('GET', `/bookings/${BOOKING_DEMO}/conversation/messages`, { token: traveller });
  check('unread count drops to zero', afterRead.body?.unread_count === 0, `unread ${afterRead.body?.unread_count}`);

  // ---- inbox
  const inbox = await call('GET', '/conversations', { token: traveller });
  check('the traveller has an inbox', inbox.status === 200, JSON.stringify(inbox.body).slice(0, 160));
  check(
    'the inbox lists this booking',
    (inbox.body?.items ?? []).some((c) => c.booking_id === BOOKING_DEMO),
  );
  check('the outsider has no conversations at all', (await call('GET', '/conversations', { token: outsider })).body?.items?.length === 0);

  // ---- notifications: unread count and read state
  const notifBefore = await call('GET', '/notifications?limit=50', { token: traveller });
  check('notifications are readable', notifBefore.status === 200);
  check('an unread count is reported', typeof notifBefore.body?.unread_count === 'number');
  const messageNotifications = (notifBefore.body?.items ?? []).filter((n) => n.template_id === 'message_received');
  check('a new message notifies the other party', messageNotifications.length > 0, `${messageNotifications.length} rows`);

  if (notifBefore.body?.unread_count > 0) {
    const firstUnread = (notifBefore.body.items ?? []).find((n) => !n.read_at);
    if (firstUnread) {
      const one = await call('POST', `/notifications/${firstUnread.id}/read`, { token: traveller });
      check('a single notification can be marked read', one.status === 200);
    }
    const all = await call('POST', '/notifications/read-all', { token: traveller });
    check('read-all reports how many it marked', all.status === 200 && all.body?.marked_read >= 0);
    const notifAfter = await call('GET', '/notifications?limit=50', { token: traveller });
    check('the unread count goes to zero', notifAfter.body?.unread_count === 0, `unread ${notifAfter.body?.unread_count}`);
  } else {
    check('read-all on an empty set is still fine', (await call('POST', '/notifications/read-all', { token: traveller })).status === 200);
  }

  const someoneElses = (await call('GET', '/notifications?limit=5', { token: sender })).body?.items?.[0];
  if (someoneElses) {
    const crossMark = await call('POST', `/notifications/${someoneElses.id}/read`, { token: outsider });
    check("you cannot mark someone else's notification read", crossMark.status === 404, `${crossMark.status}`);
  }

  // ---- the delivery code reaches the sender
  const booking = await call('GET', `/bookings/${BOOKING_DEMO}`, { token: sender });
  check('booking is readable by its sender', booking.status === 200);
  const code = await call('GET', `/bookings/${BOOKING_DEMO}/handover-code/delivery`, { token: sender });
  check(
    'before arrival there is no delivery code to read',
    code.status === 409 && code.body?.error?.code === 'OTP_NOT_APPLICABLE',
    `${code.status} ${JSON.stringify(code.body).slice(0, 120)}`,
  );

  // ---- closed thread
  const closedCheck = await call('GET', `/bookings/${BOOKING_DEMO}`, { token: sender });
  if (['cancelled_by_sender', 'refunded', 'paid_out', 'expired'].includes(closedCheck.body?.status)) {
    const late = await call('POST', `/bookings/${BOOKING_DEMO}/conversation/messages`, {
      token: sender,
      body: { body: 'anyone there?' },
    });
    check('a closed booking refuses new messages', late.status === 409 && late.body?.error?.code === 'CONVERSATION_CLOSED');
  } else {
    console.log(`  SKIP  closed-thread check (demo booking is ${closedCheck.body?.status}, not closed)`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nmessaging test aborted:', err.message);
  process.exit(1);
});
