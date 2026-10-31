/**
 * Small server-side bridge for the UI end-to-end run.
 *
 * The mobile UI is driven by `scripts/ui.mjs`. A few steps of a real journey are not reachable from a
 * tap: the pickup window opening (a time-based lifecycle transition), the GPS trail a traveller's
 * phone would upload, and reading a booking as the *other* user to confirm what they see. This script
 * performs exactly those calls with the same public API the app uses, so the UI test never has to
 * fake a response.
 *
 * Usage:
 *   node scripts/e2e-tools.mjs <phone> me
 *   node scripts/e2e-tools.mjs <phone> booking <bookingId>
 *   node scripts/e2e-tools.mjs <phone> advance <bookingId>          (dev only)
 *   node scripts/e2e-tools.mjs <phone> otp <bookingId> pickup|delivery
 *   node scripts/e2e-tools.mjs <phone> lifecycle                    (dev only)
 *   node scripts/e2e-tools.mjs <phone> track <bookingId> <lat> <lng>
 */
const BASE = process.env.API_BASE ?? 'http://127.0.0.1:3000/v1';

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-py-client': 'native',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

async function signIn(phone) {
  const request = await call('POST', '/auth/otp/request', { body: { phone, purpose: 'login' } });
  if (request.status !== 202) throw new Error(`otp request: ${request.status} ${JSON.stringify(request.body)}`);
  const peek = await call('GET', `/dev/otp/${request.body.challenge_id}`);
  if (peek.status !== 200) throw new Error(`otp peek: ${peek.status}`);
  const verify = await call('POST', '/auth/otp/verify', {
    body: { challenge_id: request.body.challenge_id, code: peek.body.code },
  });
  if (verify.status !== 200) throw new Error(`otp verify: ${verify.status} ${JSON.stringify(verify.body)}`);
  return verify.body.access_token;
}

const [, , phone, command, ...args] = process.argv;

if (!phone || !command) {
  console.error('usage: node scripts/e2e-tools.mjs <phone> <command> [args]');
  process.exit(2);
}

const token = await signIn(phone);

let result;
switch (command) {
  case 'me':
    result = await call('GET', '/me', { token });
    break;
  case 'booking':
    result = await call('GET', `/bookings/${args[0]}`, { token });
    break;
  case 'advance':
    result = await call('POST', `/dev/bookings/${args[0]}/advance`, { token });
    break;
  case 'otp':
    result = await call('GET', `/dev/handover-otp/${args[0]}/${args[1]}`, { token });
    break;
  case 'lifecycle':
    result = await call('POST', '/dev/lifecycle/run', { token });
    break;
  case 'track':
    result = await call('POST', `/bookings/${args[0]}/tracking/points`, {
      token,
      body: { points: [{ lat: Number(args[1]), lng: Number(args[2]), recorded_at: new Date().toISOString() }] },
    });
    break;
  default:
    console.error(`unknown command: ${command}`);
    process.exit(2);
}

console.log(JSON.stringify(result.body, null, 2));
if (result.status >= 400) process.exitCode = 1;
