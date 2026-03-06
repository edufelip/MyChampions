import { useCallback, useEffect, useRef, useState } from 'react';

import { searchYMoveExercises, type YMoveExercise } from './ymove-source';

export type YMoveSearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string }
  | { kind: 'error'; message: string; query: string }
  | { kind: 'done'; results: YMoveExercise[]; query: string };

export function useYMoveSearch() {
  const [state, setState] = useState<YMoveSearchState>({ kind: 'idle' });
  const isMounted = useRef(true);

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

    if (isMounted.current) setState({ kind: 'loading', query });

    try {
      const results = await searchYMoveExercises(query);
      if (isMounted.current) setState({ kind: 'done', results, query });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown search error';
      if (isMounted.current) setState({ kind: 'error', message, query });
    }
  }, []);

  const clear = useCallback(() => {
    if (isMounted.current) setState({ kind: 'idle' });
  }, []);

  return {
    state,
    search,
    clear,
  };
}
