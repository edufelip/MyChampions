/**
 * useAnalytics — thin React hook wrapping Milestone A analytics event emission.
 *
 * Events are provider-neutral and sent to the local MyChampions server when it
 * is configured. Analytics delivery is best-effort and never blocks UI flows.
 *
 * Refs: D-068, FR-206–FR-208, BR-265, BR-266, AC-251, AC-252, BL-012
 */

import { useCallback } from 'react';

import { sendAnalyticsEventToServer } from './analytics-source';
import type { AnalyticsEvent } from './analytics.logic';

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAnalytics() {
  const emitEvent = useCallback((event: AnalyticsEvent) => {
    void sendAnalyticsEventToServer(event);
  }, []);

  return { emitEvent };
}
