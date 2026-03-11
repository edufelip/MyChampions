import { useCallback, useEffect, useRef, useState } from 'react';

import { searchExerciseLibrary, type ExerciseItem } from './exercise-service-source';
import { logNetworkDebug } from '../debug/logging';

export type ExerciseSearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string }
  | { kind: 'error'; message: string; query: string }
  | {
      kind: 'done';
      results: ExerciseItem[];
      query: string;
    };

export function useExerciseSearch() {
  const [state, setState] = useState<ExerciseSearchState>({ kind: 'idle' });
  const isMounted = useRef(true);
  // Monotonically increasing counter used to detect out-of-order responses.
  // `latestRequestId` handles race conditions between concurrent search calls
  // (slower earlier request resolves after a faster later one — discard it).
  // `isMounted` separately guards against setState after component unmount.
  const latestRequestId = useRef(0);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      if (isMounted.current) setState({ kind: 'idle' });
      return;
    }

    // Claim this request's ID before any await.
    const requestId = ++latestRequestId.current;
    logNetworkDebug('useExerciseSearch', 'Search started.', { query, requestId });

    if (isMounted.current) setState({ kind: 'loading', query });

    try {
      const { exercises } = await searchExerciseLibrary(query);
      // Discard if a newer search has already been dispatched.
      if (isMounted.current && requestId === latestRequestId.current) {
        logNetworkDebug('useExerciseSearch', 'Search completed.', {
          query,
          requestId,
          resultsCount: exercises.length,
        });
        setState({ kind: 'done', results: exercises, query });
      }
    } catch (err: unknown) {
      if (isMounted.current && requestId === latestRequestId.current) {
        const message = err instanceof Error ? err.message : 'Unknown search error';
        console.error('[useExerciseSearch] Search failed:', { query, requestId, message });
        setState({ kind: 'error', message, query });
      }
    }
  }, []);

  const clear = useCallback(() => {
    // Invalidate any in-flight request so its result is discarded.
    latestRequestId.current++;
    if (isMounted.current) setState({ kind: 'idle' });
  }, []);

  return {
    state,
    search,
    clear,
  };
}
