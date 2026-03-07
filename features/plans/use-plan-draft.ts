import { useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DRAFT_PREFIX = '@plan_draft_';

export function usePlanDraft<T>(
  planId: string,
  currentValues: T,
  isDirty: boolean,
  onRestore: (values: T) => void,
  t: (key: string) => string
) {
  const lastSavedRef = useRef<string>(JSON.stringify(currentValues));
  const draftKey = `${DRAFT_PREFIX}${planId}`;

  // Save draft every 30 seconds if dirty
  useEffect(() => {
    if (!isDirty) return;

    const interval = setInterval(async () => {
      const stringified = JSON.stringify(currentValues);
      if (stringified !== lastSavedRef.current) {
        await AsyncStorage.setItem(draftKey, stringified);
        lastSavedRef.current = stringified;
        console.log(`[Draft] Saved for ${planId}`);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [isDirty, currentValues, draftKey, planId]);

  // Check for existing draft on mount
  const checkDraft = useCallback(async () => {
    try {
      const saved = await AsyncStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Only prompt if different from current initial state
        if (JSON.stringify(parsed) !== JSON.stringify(currentValues)) {
          return parsed as T;
        }
      }
    } catch (e) {
      console.warn('Failed to check draft', e);
    }
    return null;
  }, [draftKey, currentValues]);

  const clearDraft = useCallback(async () => {
    await AsyncStorage.removeItem(draftKey);
    lastSavedRef.current = JSON.stringify(currentValues);
  }, [draftKey, currentValues]);

  return {
    checkDraft,
    clearDraft,
  };
}
