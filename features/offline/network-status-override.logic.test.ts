import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveE2ENetworkStatusOverride } from './network-status-override.logic';

test('resolveE2ENetworkStatusOverride returns a valid dev E2E network status', () => {
  assert.equal(
    resolveE2ENetworkStatusOverride({
      appVariant: 'dev',
      isDev: true,
      status: 'offline',
    }),
    'offline',
  );
  assert.equal(
    resolveE2ENetworkStatusOverride({
      appVariant: 'dev',
      isDev: true,
      status: 'online',
    }),
    'online',
  );
});

test('resolveE2ENetworkStatusOverride ignores invalid or non-dev values', () => {
  assert.equal(
    resolveE2ENetworkStatusOverride({
      appVariant: 'prod',
      isDev: true,
      status: 'offline',
    }),
    null,
  );
  assert.equal(
    resolveE2ENetworkStatusOverride({
      appVariant: 'dev',
      isDev: false,
      status: 'offline',
    }),
    null,
  );
  assert.equal(
    resolveE2ENetworkStatusOverride({
      appVariant: 'dev',
      isDev: true,
      status: 'airplane',
    }),
    null,
  );
});
