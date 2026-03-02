import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CACHE_STALE_TTL_MS,
  resolveCacheFreshness,
  checkWriteLock,
  resolveOfflineDisplayState,
  buildStaleElapsed,
  isDefinitelyOffline,
} from './offline.logic';

// ─── resolveCacheFreshness ────────────────────────────────────────────────────

test('resolveCacheFreshness returns empty when lastSyncedAt is null', () => {
  assert.equal(resolveCacheFreshness(null), 'empty');
  assert.equal(resolveCacheFreshness(undefined), 'empty');
});

test('resolveCacheFreshness returns empty when lastSyncedAt is invalid', () => {
  assert.equal(resolveCacheFreshness('not-a-date'), 'empty');
});

test('resolveCacheFreshness returns fresh within 24h TTL (D-047)', () => {
  const now = new Date('2024-06-01T12:00:00Z');
  const lastSync = new Date(now.getTime() - CACHE_STALE_TTL_MS + 1); // 1ms before stale
  assert.equal(
    resolveCacheFreshness(lastSync.toISOString(), now.toISOString()),
    'fresh'
  );
});

test('resolveCacheFreshness returns stale after 24h TTL', () => {
  const now = new Date('2024-06-01T12:00:00Z');
  const lastSync = new Date(now.getTime() - CACHE_STALE_TTL_MS - 1); // 1ms past stale
  assert.equal(
    resolveCacheFreshness(lastSync.toISOString(), now.toISOString()),
    'stale'
  );
});

test('resolveCacheFreshness returns stale at exactly TTL boundary (inclusive)', () => {
  const now = new Date('2024-06-01T12:00:00Z');
  const lastSync = new Date(now.getTime() - CACHE_STALE_TTL_MS); // exactly at TTL
  // <= means exactly TTL is still fresh
  assert.equal(
    resolveCacheFreshness(lastSync.toISOString(), now.toISOString()),
    'fresh'
  );
});

// ─── checkWriteLock ───────────────────────────────────────────────────────────

test('checkWriteLock allows writes when online', () => {
  assert.deepEqual(checkWriteLock('online', 'fresh'), { allowed: true });
  assert.deepEqual(checkWriteLock('online', 'stale'), { allowed: true });
  assert.deepEqual(checkWriteLock('online', 'empty'), { allowed: true });
});

test('checkWriteLock allows writes when network status is unknown (optimistic, D-041)', () => {
  assert.deepEqual(checkWriteLock('unknown', 'fresh'), { allowed: true });
  assert.deepEqual(checkWriteLock('unknown', 'stale'), { allowed: true });
});

test('checkWriteLock blocks writes when offline with fresh cache', () => {
  assert.deepEqual(checkWriteLock('offline', 'fresh'), {
    allowed: false,
    reason: 'offline_no_network',
  });
});

test('checkWriteLock blocks with stale_cache reason when offline and stale (D-041, D-074)', () => {
  assert.deepEqual(checkWriteLock('offline', 'stale'), {
    allowed: false,
    reason: 'offline_stale_cache',
  });
});

test('checkWriteLock blocks with stale_cache reason when offline and empty', () => {
  assert.deepEqual(checkWriteLock('offline', 'empty'), {
    allowed: false,
    reason: 'offline_stale_cache',
  });
});

// ─── resolveOfflineDisplayState ───────────────────────────────────────────────

test('resolveOfflineDisplayState shows banner when offline', () => {
  const state = resolveOfflineDisplayState({
    networkStatus: 'offline',
    lastSyncedAtIso: new Date().toISOString(),
  });
  assert.equal(state.showOfflineBanner, true);
});

test('resolveOfflineDisplayState does not show banner when online', () => {
  const state = resolveOfflineDisplayState({
    networkStatus: 'online',
    lastSyncedAtIso: new Date().toISOString(),
  });
  assert.equal(state.showOfflineBanner, false);
});

test('resolveOfflineDisplayState does not show banner when network status is unknown (optimistic, D-041)', () => {
  // Unknown network status is treated as online-optimistic — no banner shown
  const state = resolveOfflineDisplayState({
    networkStatus: 'unknown',
    lastSyncedAtIso: new Date().toISOString(),
  });
  assert.equal(state.showOfflineBanner, false);
});

test('resolveOfflineDisplayState includes staleElapsed when stale', () => {
  const now = new Date('2024-06-03T12:00:00Z');
  const lastSync = new Date(now.getTime() - 30 * 60 * 60 * 1000); // 30 hours ago (> 24h TTL = stale, 1 day unit)
  const state = resolveOfflineDisplayState({
    networkStatus: 'offline',
    lastSyncedAtIso: lastSync.toISOString(),
    nowIso: now.toISOString(),
  });
  assert.equal(state.cacheFreshness, 'stale');
  assert.notEqual(state.staleElapsed, null);
  assert.equal(state.staleElapsed?.unit, 'days');
  assert.equal(state.staleElapsed?.value, 1);
});

test('resolveOfflineDisplayState has null staleElapsed when fresh', () => {
  const now = new Date('2024-06-01T12:00:00Z');
  const lastSync = new Date(now.getTime() - 60 * 1000); // 1 minute ago
  const state = resolveOfflineDisplayState({
    networkStatus: 'online',
    lastSyncedAtIso: lastSync.toISOString(),
    nowIso: now.toISOString(),
  });
  assert.equal(state.staleElapsed, null);
});

test('resolveOfflineDisplayState has null staleElapsed when cache is empty', () => {
  const state = resolveOfflineDisplayState({
    networkStatus: 'offline',
    lastSyncedAtIso: null,
  });
  assert.equal(state.staleElapsed, null);
  assert.equal(state.cacheFreshness, 'empty');
});

// ─── buildStaleElapsed ────────────────────────────────────────────────────────

test('buildStaleElapsed returns minutes unit for < 60 min elapsed', () => {
  const now = '2024-06-01T12:00:00Z';
  const lastSync = '2024-06-01T11:45:00Z'; // 15 min ago
  const result = buildStaleElapsed(lastSync, now);
  assert.deepEqual(result, { unit: 'minutes', value: 15 });
});

test('buildStaleElapsed returns hours unit for >= 60 min and < 24h', () => {
  const now = '2024-06-01T12:00:00Z';
  const lastSync = '2024-06-01T09:00:00Z'; // 3h ago
  const result = buildStaleElapsed(lastSync, now);
  assert.deepEqual(result, { unit: 'hours', value: 3 });
});

test('buildStaleElapsed returns days unit for >= 24h', () => {
  const now = '2024-06-03T12:00:00Z';
  const lastSync = '2024-06-01T12:00:00Z'; // 2 days ago
  const result = buildStaleElapsed(lastSync, now);
  assert.deepEqual(result, { unit: 'days', value: 2 });
});

test('buildStaleElapsed returns null for invalid timestamps', () => {
  assert.equal(buildStaleElapsed('not-a-date', '2024-06-01T12:00:00Z'), null);
});

test('buildStaleElapsed returns null when now is before lastSync', () => {
  const result = buildStaleElapsed('2024-06-02T12:00:00Z', '2024-06-01T12:00:00Z');
  assert.equal(result, null);
});

// ─── isDefinitelyOffline ─────────────────────────────────────────────────────

test('isDefinitelyOffline returns true only for offline', () => {
  assert.equal(isDefinitelyOffline('offline'), true);
  assert.equal(isDefinitelyOffline('online'), false);
  assert.equal(isDefinitelyOffline('unknown'), false);
});
