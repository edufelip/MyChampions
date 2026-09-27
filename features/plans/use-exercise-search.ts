import { useCallback, useEffect, useRef, useState } from 'react';
import {
  searchExerciseLibrary,
  suggestExerciseLibrary,
  type ExerciseItem,
  type ExerciseSuggestionStatus,
} from './exercise-service-source';
import { logNetworkDebug } from '../debug/logging';

export type ExerciseSearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string }
  | { kind: 'error'; message: string; query: string }
  | { kind: 'done'; results: ExerciseItem[]; query: string };

export type ExerciseSuggestionState =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string }
  | {
      kind: 'done';
      query: string;
      results: ExerciseItem[];
      suggestionId: string | null;
      status: ExerciseSuggestionStatus;
    }
  | { kind: 'error'; query: string; message: string };

const suggestionsEnabled = process.env.EXPO_PUBLIC_EXERCISE_SUGGESTIONS_ENABLED === 'true';

export function useExerciseSearch() {
  const [state, setState] = useState<ExerciseSearchState>({ kind: 'idle' });
  const [suggestionState, setSuggestionState] = useState<ExerciseSuggestionState>({ kind: 'idle' });
  const isMounted = useRef(true);
  const latestSearchGeneration = useRef(0);
  const latestSuggestionGeneration = useRef(0);
  const activeQuery = useRef('');
  const suggestionQuery = useRef('');

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const invalidateQuery = useCallback((query: string) => {
    const trimmedQuery = query.trim();
    activeQuery.current = trimmedQuery;
    latestSearchGeneration.current += 1;
    latestSuggestionGeneration.current += 1;
    suggestionQuery.current = trimmedQuery;

    if (isMounted.current) {
      setSuggestionState({ kind: 'idle' });
    }
  }, []);

  const search = useCallback(async (query: string) => {
    const trimmedQuery = query.trim();
    const generation = ++latestSearchGeneration.current;
    activeQuery.current = trimmedQuery;

    if (!trimmedQuery) {
      if (isMounted.current) {
        setState({ kind: 'idle' });
        setSuggestionState({ kind: 'idle' });
      }
      return;
    }

    logNetworkDebug('useExerciseSearch', 'Search started.', { query: trimmedQuery, generation });
    if (isMounted.current) {
      setState({ kind: 'loading', query: trimmedQuery });
      if (suggestionQuery.current !== trimmedQuery) {
        suggestionQuery.current = trimmedQuery;
        setSuggestionState({ kind: 'idle' });
      }
    }

    try {
      const { exercises } = await searchExerciseLibrary(trimmedQuery);
      if (
        isMounted.current &&
        generation === latestSearchGeneration.current &&
        activeQuery.current === trimmedQuery
      ) {
        logNetworkDebug('useExerciseSearch', 'Search completed.', {
          query: trimmedQuery,
          generation,
          resultsCount: exercises.length,
        });
        setState({ kind: 'done', results: exercises, query: trimmedQuery });
      }
    } catch (err: unknown) {
      if (
        isMounted.current &&
        generation === latestSearchGeneration.current &&
        activeQuery.current === trimmedQuery
      ) {
        const message = err instanceof Error ? err.message : 'Unknown search error';
        console.error('[useExerciseSearch] Search failed:', {
          query: trimmedQuery,
          generation,
          message,
        });
        setState({ kind: 'error', message, query: trimmedQuery });
      }
    }
  }, []);

  const suggest = useCallback(async (query: string) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return;

    // Keep ordinary search and semantic suggestion generations independent:
    // a normal response that resolves while the opt-in request is pending
    // must still settle the ordinary search state.
    if (activeQuery.current !== trimmedQuery) {
      latestSearchGeneration.current += 1;
      activeQuery.current = trimmedQuery;
    }
    const generation = ++latestSuggestionGeneration.current;
    activeQuery.current = trimmedQuery;
    suggestionQuery.current = trimmedQuery;
    if (isMounted.current) setSuggestionState({ kind: 'loading', query: trimmedQuery });

    try {
      const result = await suggestExerciseLibrary(trimmedQuery);
      if (
        isMounted.current &&
        generation === latestSuggestionGeneration.current &&
        suggestionQuery.current === trimmedQuery &&
        result.query.trim() === trimmedQuery
      ) {
        setSuggestionState({
          kind: 'done',
          query: trimmedQuery,
          results: result.exercises,
          suggestionId: result.suggestionId,
          status: result.status,
        });
      }
    } catch (err: unknown) {
      if (
        isMounted.current &&
        generation === latestSuggestionGeneration.current &&
        suggestionQuery.current === trimmedQuery
      ) {
        const message = err instanceof Error ? err.message : 'Unknown suggestion error';
        console.error('[useExerciseSearch] Suggestion failed:', {
          query: trimmedQuery,
          generation,
          message,
        });
        setSuggestionState({ kind: 'error', query: trimmedQuery, message });
      }
    }
  }, []);

  const clear = useCallback(() => {
    latestSearchGeneration.current += 1;
    latestSuggestionGeneration.current += 1;
    activeQuery.current = '';
    suggestionQuery.current = '';
    if (isMounted.current) {
      setState({ kind: 'idle' });
      setSuggestionState({ kind: 'idle' });
    }
  }, []);

  return { state, suggestionState, suggestionsEnabled, search, suggest, invalidateQuery, clear };
}
