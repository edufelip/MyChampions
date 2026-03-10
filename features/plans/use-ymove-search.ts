import { useCallback, useEffect, useRef, useState } from 'react';

import { searchYMoveExercises, type YMoveExercise, type YMoveSearchResult } from './ymove-source';

export type YMoveSearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string }
  | { kind: 'error'; message: string; query: string }
  | {
      kind: 'done';
      results: YMoveExercise[];
      query: string;
      /**
       * Present when the API's monthly exercise cap was exceeded for this response.
       * Thumbnails/videos may be missing from exercises not previously accessed.
       */
      capWarning?: YMoveSearchResult['capWarning'];
    };

export function useYMoveSearch() {
  const [state, setState] = useState<YMoveSearchState>({ kind: 'idle' });
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

    if (isMounted.current) setState({ kind: 'loading', query });

    try {
      const { exercises, capWarning } = await searchYMoveExercises(query);
      // Discard if a newer search has already been dispatched.
      if (isMounted.current && requestId === latestRequestId.current) {
        setState({ kind: 'done', results: exercises, query, capWarning });
      }
    } catch (err: unknown) {
      if (isMounted.current && requestId === latestRequestId.current) {
        const message = err instanceof Error ? err.message : 'Unknown search error';
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
