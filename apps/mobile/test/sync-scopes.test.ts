/**
 * The mobile half of the synchronisation feed. Same contract as the web client: a moved revision
 * invalidates a narrow, known set of query prefixes; the first poll is a baseline; an unknown
 * scope is ignored rather than guessed at.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { changedScopes, queryKeysForScopes, SYNC_SCOPE_QUERY_KEYS } from '../src/sync-scopes.ts';

test('the first poll establishes a baseline instead of invalidating everything', () => {
  assert.deepEqual(changedScopes(null, { bookings: 'a', messages: 'b' }), []);
});

test('only scopes whose revision moved are reported', () => {
  assert.deepEqual(
    changedScopes({ bookings: 'a', messages: 'b' }, { bookings: 'a2', messages: 'b' }),
    ['bookings'],
  );
});

test('messages invalidates the inbox, the thread and the badge', () => {
  const keys = queryKeysForScopes(['messages']).map((key) => key[0]);
  assert.deepEqual(keys, ['conversations', 'thread', 'inbox']);
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
