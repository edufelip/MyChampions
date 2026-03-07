import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Hook to manage a one-time persistent guidance card.
 * @param key Unique key for storage (e.g., 'guidance.nutrition_plan')
 * @returns [isVisible, hideFunction]
 */
export function usePersistentGuidance(key: string): [boolean, () => void] {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    async function checkStatus() {
      try {
        const value = await AsyncStorage.getItem(key);
        // If value is null, it hasn't been dismissed yet
        setIsVisible(value === null);
      } catch (e) {
        // Fallback to visible if storage fails
        setIsVisible(true);
      } finally {
        setIsLoaded(true);
      }
    }
    checkStatus();
  }, [key]);

  const hide = useCallback(async () => {
    setIsVisible(false);
    try {
      await AsyncStorage.setItem(key, 'dismissed');
    } catch (e) {
      // Ignore storage errors on hide
    }
  }, [key]);

  // Don't show anything until we know the storage status to avoid flickering
  return [isLoaded && isVisible, hide];
}
