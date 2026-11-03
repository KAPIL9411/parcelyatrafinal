/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';

import { ApiError, createHttp, type HttpOptions } from '../src/api/http.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function harness(
  fetchImpl: NonNullable<HttpOptions['fetchImpl']>,
  overrides: Partial<HttpOptions> = {},
) {
  const state = {
    token: 'access-1' as string | null,
    refreshed: 0,
    lost: 0,
  };
  const http = createHttp({
    baseUrl: 'https://api.test/v1',
    getAccessToken: () => state.token,
    refresh: async () => {
      state.refreshed += 1;
      state.token = 'access-2';
      return state.token;
    },
    onSessionLost: () => {
      state.lost += 1;
    },
    fetchImpl,
    newIdempotencyKey: () => 'fixed-key',
    ...overrides,
  });
  return { http, state };
}

test('a dropped connection is NETWORK, not an empty success', async () => {
  const { http } = harness(() => Promise.reject(new TypeError('fetch failed')));
  await assert.rejects(
    () => http.get('/bookings'),
    (err: unknown) => err instanceof ApiError && err.code === 'NETWORK' && err.status === 0,
  );
});

test('a request that never answers becomes TIMEOUT', async () => {
  const { http } = harness(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    { timeoutMs: 10 },
  );
  await assert.rejects(
    () => http.get('/bookings'),
    (err: unknown) => err instanceof ApiError && err.code === 'TIMEOUT',
  );
});

test('the server error envelope is preserved in the thrown error', async () => {
  const { http } = harness(() =>
    Promise.resolve(
      json(
        {
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Check the details.',
            request_id: 'req-42',
            details: { field: 'capacity_kg' },
          },
        },
        422,
      ),
    ),
  );
  await assert.rejects(
    () => http.post('/trips', { capacity_kg: -1 }),
    (err: unknown) =>
      err instanceof ApiError &&
      err.code === 'VALIDATION_FAILED' &&
      err.status === 422 &&
      err.requestId === 'req-42' &&
      err.details.field === 'capacity_kg',
  );
});

test('one 401 refreshes once and retries with the new access token', async () => {
  const seen: Array<string | null> = [];
  let calls = 0;
  const { http, state } = harness((_input, init) => {
    calls += 1;
    seen.push((init?.headers as Record<string, string>).authorization ?? null);
    if (calls === 1) return Promise.resolve(json({ error: { code: 'AUTH_REQUIRED', message: 'expired' } }, 401));
    return Promise.resolve(json({ items: [] }));
  });

  const result = await http.get<{ items: unknown[] }>('/bookings');
  assert.deepEqual(result, { items: [] });
  assert.equal(state.refreshed, 1);
  assert.equal(state.lost, 0);
  assert.deepEqual(seen, ['Bearer access-1', 'Bearer access-2']);
});

test('a failed refresh ends the session and does not loop', async () => {
  let calls = 0;
  const { http, state } = harness(
    () => {
      calls += 1;
      return Promise.resolve(json({ error: { code: 'AUTH_REQUIRED', message: 'expired' } }, 401));
    },
    { refresh: async () => null },
  );

  await assert.rejects(
    () => http.get('/me'),
    (err: unknown) => err instanceof ApiError && err.code === 'AUTH_REQUIRED' && err.status === 401,
  );
  assert.equal(calls, 1);
  assert.equal(state.lost, 1);
});

test('concurrent 401s share one refresh', async () => {
  let refreshCalls = 0;
  let requests = 0;
  const { http } = harness(
    () => {
      requests += 1;
      if (requests <= 2) {
        return Promise.resolve(json({ error: { code: 'AUTH_REQUIRED', message: 'expired' } }, 401));
      }
      return Promise.resolve(json({ ok: true }));
    },
    {
      refresh: async () => {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'access-3';
      },
    },
  );

  const [a, b] = await Promise.all([http.get('/me'), http.get('/bookings')]);
  assert.deepEqual(a, { ok: true });
  assert.deepEqual(b, { ok: true });
  assert.equal(refreshCalls, 1);
});

test('mutations carry an idempotency key and reads do not', async () => {
  const headers: Array<Record<string, string>> = [];
  const { http } = harness((_input, init) => {
    headers.push({ ...(init?.headers as Record<string, string>) });
    return Promise.resolve(json({ id: 'x' }));
  });

  await http.post('/parcels', { category: 'documents' });
  await http.get('/parcels/1');

  assert.equal(headers[0]?.['idempotency-key'], 'fixed-key');
  assert.equal(headers[1]?.['idempotency-key'], undefined);
  assert.equal(headers[0]?.['content-type'], 'application/json');
});

test('a 204 resolves undefined instead of parsing a body', async () => {
  const { http } = harness(() => Promise.resolve(new Response(null, { status: 204 })));
  assert.equal(await http.delete<void>('/trips/1'), undefined);
});
