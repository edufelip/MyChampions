/**
 * Offline mode logic — stale cache detection, write-lock resolution.
 * Pure functions, no Firebase dependencies.
 * Refs: D-041, D-047, D-074, FR-209, BR-267, BR-268
 *
 * Policy:
 * - MVP offline mode is read-only cached content; writes are always blocked (D-041).
 * - Stale threshold is 24-hour TTL (D-047).
 * - Offline core screens show persistent read-only banner + explicit write-lock reason (D-074).
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Network connectivity state provided by the platform or a hook. */
export type NetworkStatus = 'online' | 'offline' | 'unknown';

/**
 * Cache freshness state for a given data resource.
 * `fresh`  — synced within the last 24 hours.
 * `stale`  — older than 24 hours; shows stale indicator + last-sync timestamp.
 * `empty`  — no cached data exists at all.
 */
export type CacheFreshnessState = 'fresh' | 'stale' | 'empty';

/** Why a write action is blocked in the current offline context. */
export type WriteLockReason =
  | 'offline_no_network'   // Device is offline; writes require connectivity.
  | 'offline_stale_cache'; // Device is offline and cache is stale; reads may be unreliable.

/**
 * Result of checking whether a write action is allowed.
 * When `allowed` is false, `reason` explains why.
 */
export type WriteCheckResult =
  | { allowed: true }
  | { allowed: false; reason: WriteLockReason };

/**
 * Offline display state consumed by UI components.
 */
/**
 * Coarse elapsed-time unit used for stale indicator copy.
 * UI maps this to a localization key (e.g., `offline.stale_minutes`, `offline.stale_hours`).
 */
export type StaleElapsed =
  | { unit: 'minutes'; value: number }
  | { unit: 'hours'; value: number }
  | { unit: 'days'; value: number };

export type OfflineDisplayState = {
  /** Whether the read-only offline banner should be shown. */
  showOfflineBanner: boolean;
  /** Freshness of the cached content. */
  cacheFreshness: CacheFreshnessState;
  /** Last sync ISO timestamp (null when cache is empty). */
  lastSyncedAt: string | null;
  /**
   * Structured stale elapsed time for locale-aware rendering.
   * Null when cache is fresh or empty.
   */
  staleElapsed: StaleElapsed | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

/** Stale threshold in milliseconds (24 hours, D-047). */
export const CACHE_STALE_TTL_MS = 24 * 60 * 60 * 1000;

// ─── Cache freshness ──────────────────────────────────────────────────────────

/**
 * Determines cache freshness given the last-synced timestamp and current time.
 *
 * @param lastSyncedAtIso ISO string of the last successful sync, or null/undefined if never synced.
 * @param nowIso          Current time as ISO string (default: new Date().toISOString()).
 */
export function resolveCacheFreshness(
  lastSyncedAtIso: string | null | undefined,
  nowIso: string = new Date().toISOString()
): CacheFreshnessState {
  if (!lastSyncedAtIso) return 'empty';

  const lastSyncMs = Date.parse(lastSyncedAtIso);
  if (isNaN(lastSyncMs)) return 'empty';

  const nowMs = Date.parse(nowIso);
  if (isNaN(nowMs)) return 'stale'; // conservative fallback

  return nowMs - lastSyncMs <= CACHE_STALE_TTL_MS ? 'fresh' : 'stale';
}

// ─── Write-lock enforcement ───────────────────────────────────────────────────

/**
 * Checks whether a write action is permitted.
 * Writes are always blocked when the device is offline (D-041).
 * The reason clarifies whether the cache is also stale.
 */
export function checkWriteLock(
  networkStatus: NetworkStatus,
  cacheFreshness: CacheFreshnessState
): WriteCheckResult {
  if (networkStatus === 'online') {
    return { allowed: true };
  }

  // Unknown is treated as online to avoid false-blocking
  if (networkStatus === 'unknown') {
    return { allowed: true };
  }

  // Offline path — writes always blocked
  if (cacheFreshness === 'stale' || cacheFreshness === 'empty') {
    return { allowed: false, reason: 'offline_stale_cache' };
  }

  return { allowed: false, reason: 'offline_no_network' };
}

// ─── Display state resolution ─────────────────────────────────────────────────

/**
 * Computes the full offline display state for rendering banners and indicators.
 * Stale indicator is shown when cache is stale or empty (D-047, D-074).
 */
export function resolveOfflineDisplayState(input: {
  networkStatus: NetworkStatus;
  lastSyncedAtIso: string | null | undefined;
  nowIso?: string;
}): OfflineDisplayState {
  const nowIso = input.nowIso ?? new Date().toISOString();
  const cacheFreshness = resolveCacheFreshness(input.lastSyncedAtIso, nowIso);

  const showOfflineBanner = input.networkStatus === 'offline';

  const staleElapsed =
    cacheFreshness === 'stale' && input.lastSyncedAtIso
      ? buildStaleElapsed(input.lastSyncedAtIso, nowIso)
      : null;

  return {
    showOfflineBanner,
    cacheFreshness,
    lastSyncedAt: input.lastSyncedAtIso ?? null,
    staleElapsed,
  };
}

/**
 * Computes a structured stale elapsed unit for locale-aware rendering.
 * UI maps `unit` to a localization key (e.g. `offline.stale_minutes`).
 */
export function buildStaleElapsed(
  lastSyncedAtIso: string,
  nowIso: string
): StaleElapsed | null {
  const elapsedMs = Date.parse(nowIso) - Date.parse(lastSyncedAtIso);
  if (isNaN(elapsedMs) || elapsedMs < 0) return null;

  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60) return { unit: 'minutes', value: minutes };

  const hours = Math.floor(elapsedMs / 3_600_000);
  if (hours < 24) return { unit: 'hours', value: hours };

  const days = Math.floor(elapsedMs / 86_400_000);
  return { unit: 'days', value: days };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true when the device is definitively offline.
 * `unknown` is treated as online (optimistic) to avoid false degraded states.
 */
export function isDefinitelyOffline(networkStatus: NetworkStatus): boolean {
  return networkStatus === 'offline';
}
