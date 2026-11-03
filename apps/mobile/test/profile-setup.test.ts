/// <reference types="node" />
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Profile } from '../src/api/types.ts';
import { needsProfileSetup } from '../src/lib/profile-setup.ts';

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    name: 'Aarti',
    email: 'aarti@example.com',
    phone_last4: null,
    status: 'active',
    risk_tier: 1,
    locale: 'en-IN',
    verification_state: 'not_started',
    created_at: '2026-10-31T09:00:00.000Z',
    ...overrides,
  };
}

test('a profile with no selfie asks for setup', () => {
  assert.equal(needsProfileSetup(profile({ avatar_key: null, avatar_url: null })), true);
  // The field is absent entirely on a build of the API that predates the column.
  assert.equal(needsProfileSetup(profile()), true);
});

test('a profile with a selfie never asks again', () => {
  assert.equal(
    needsProfileSetup(profile({ avatar_key: 'avatar/uid/11111111-1111-4111-8111-111111111111.jpg' })),
    false,
  );
});

test('skipping the photo still answers the question once', () => {
  // The user pressed "Add the photo later": no avatar, but the setup screen has been answered.
  assert.equal(needsProfileSetup(profile({ avatar_key: null, profile_setup_done: true })), false);
  // An explicit false is the server saying "never asked", so the old avatar rule decides.
  assert.equal(needsProfileSetup(profile({ avatar_key: null, profile_setup_done: false })), true);
});

test('nobody signed in is not a profile that needs setting up', () => {
  assert.equal(needsProfileSetup(null), false);
  assert.equal(needsProfileSetup(undefined), false);
});
