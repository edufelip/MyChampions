import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveE2ENetworkStatusEventTarget,
  resolveE2ENetworkStatusOverride,
} from './network-status-override.logic';

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

test('resolveE2ENetworkStatusEventTarget accepts a real browser-style window', () => {
  const listeners = new Set<string>();
  const browserWindow = {
    addEventListener: (type: string) => listeners.add(type),
    removeEventListener: (type: string) => listeners.delete(type),
  };

  const target = resolveE2ENetworkStatusEventTarget(browserWindow);
  assert.notEqual(target, null);

  // Prove the returned value is genuinely usable as an event target, not just narrowed.
  target?.addEventListener('mychampions.e2e.network-status-change', () => {});
  assert.equal(listeners.has('mychampions.e2e.network-status-change'), true);
  target?.removeEventListener('mychampions.e2e.network-status-change', () => {});
});

test('resolveE2ENetworkStatusEventTarget rejects runtimes without a usable DOM-style window', () => {
  assert.equal(resolveE2ENetworkStatusEventTarget(undefined), null);
  assert.equal(resolveE2ENetworkStatusEventTarget(null), null);
  assert.equal(resolveE2ENetworkStatusEventTarget({}), null);
  // A non-DOM `window` global some native/hybrid runtimes expose (no listener methods).
  assert.equal(resolveE2ENetworkStatusEventTarget({ location: {} }), null);
  // Present but not callable — must still be rejected, not just "truthy-checked".
  assert.equal(
    resolveE2ENetworkStatusEventTarget({
      addEventListener: 'not-a-function',
      removeEventListener: () => {},
    }),
    null,
  );
});
