/**
 * useAnalytics — thin React hook wrapping Milestone A analytics event emission.
 *
 * Real transport (Firebase Analytics / Amplitude / etc.) is deferred wiring.
 * Current implementation logs structured events to console in dev and is a
 * no-op in test environments.
 *
 * Refs: D-068, FR-206–FR-208, BR-265, BR-266, AC-251, AC-252, BL-012
 */

import { useCallback } from 'react';

import {
  redactEventProperties,
  type AnalyticsEvent,
} from './analytics.logic';

// ─── Transport stub ───────────────────────────────────────────────────────────

/**
 * Stub transport — replace with real SDK call (e.g. Firebase Analytics
 * `logEvent`) when real service wiring is performed.
 * Refs: docs/discovery/pending-wiring-checklist-v1.md (Analytics transport wiring)
 */
function transportEvent(event: AnalyticsEvent): void {
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log('[analytics]', event.name, redactEventProperties(event.properties));
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalytics() {
  const emitEvent = useCallback((event: AnalyticsEvent) => {
    transportEvent(event);
  }, []);

  return { emitEvent };
}
