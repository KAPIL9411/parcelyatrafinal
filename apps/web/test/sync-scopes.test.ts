/**
 * The client half of the synchronisation feed.
 *
 * The server tests prove the feed is scoped and that revisions move. These prove the client turns
 * a moved revision into exactly the right invalidations — and nothing more, because invalidating a
 * broad key would refetch screens the user is not looking at and, on a metered connection, waste
 * their data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { changedScopes, queryKeysForScopes, SYNC_SCOPE_QUERY_KEYS } from '../src/lib/sync-scopes.ts';

test('the first poll establishes a baseline instead of invalidating everything', () => {
  assert.deepEqual(changedScopes(null, { bookings: 'a', parcels: 'b' }), []);
});

test('only scopes whose revision moved are reported', () => {
  const previous = { bookings: 'a', parcels: 'b', notifications: 'c' };
  const next = { bookings: 'a', parcels: 'changed', notifications: 'c' };
  assert.deepEqual(changedScopes(previous, next), ['parcels']);
});

test('a scope that appears later (staff access) counts as a change', () => {
  assert.deepEqual(changedScopes({ bookings: 'a' }, { bookings: 'a', admin: 'z' }), ['admin']);
});

test('a moved scope maps to its query-key prefixes', () => {
  assert.deepEqual(queryKeysForScopes(['bookings']), [['bookings'], ['booking']]);
  assert.deepEqual(queryKeysForScopes(['notifications']), [['notifications']]);
});

test('overlapping scopes do not invalidate the same key twice', () => {
  const keys = queryKeysForScopes(['trips', 'interests']);
  assert.equal(keys.filter((key) => key[0] === 'trip-opportunities').length, 1);
});

test('an unknown scope invalidates nothing rather than guessing', () => {
  assert.deepEqual(queryKeysForScopes(['something-new']), []);
});

test('every invalidation target is a one-element prefix', () => {
  for (const [scope, keys] of Object.entries(SYNC_SCOPE_QUERY_KEYS)) {
    assert.ok(keys.length > 0, `${scope} maps to at least one key`);
    for (const key of keys) {
      assert.equal(key.length, 1, `${scope} key ${JSON.stringify(key)} is a prefix`);
      assert.equal(typeof key[0], 'string');
    }
  }
});
