/**
 * LocaleContext — in-session locale management.
 *
 * Provides a React context that holds the active locale and allows changing it
 * at runtime without an app restart. All `useTranslation()` callers re-render
 * immediately when the locale changes.
 *
 * Hydration: On mount, reads the stored override via `getEffectiveLocale()`.
 * If no override is set, falls back to the device locale.
 *
 * Persistence: `setActiveLocale()` writes to AsyncStorage via `setLanguageOverride()`
 * and updates the in-memory context state — both happen atomically from the
 * caller's perspective.
 *
 * Usage:
 *   - Wrap the app root with `<LocaleProvider>`
 *   - Call `useLocale()` to read `activeLocale` or call `setActiveLocale()`
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  getEffectiveLocale,
  setLanguageOverride,
} from '@/features/auth/language-storage';

import { getDeviceLocale, resolveLocale, type SupportedLocale } from './index';

// ─── Types ────────────────────────────────────────────────────────────────────

type LocaleContextValue = {
  /** The currently active locale used by all `useTranslation()` callers. */
  activeLocale: SupportedLocale;
  /**
   * Persists the new locale to AsyncStorage and immediately updates all
   * `useTranslation()` callers in the current session.
   */
  setActiveLocale: (locale: SupportedLocale) => Promise<void>;
};

// ─── Context ─────────────────────────────────────────────────────────────────

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Stable fallback used when `useLocale()` is called outside a `LocaleProvider`.
// Defined at module level so it is the same object reference across every call,
// preventing spurious re-renders in components that use it in a dependency array.
const FALLBACK_LOCALE_VALUE: LocaleContextValue = {
  activeLocale: resolveLocale(getDeviceLocale()),
  setActiveLocale: async () => {},
};

// ─── Provider ─────────────────────────────────────────────────────────────────

type LocaleProviderProps = {
  children: ReactNode;
};

export function LocaleProvider({ children }: LocaleProviderProps) {
  // Default synchronously to device locale so that the very first render
  // (before hydration completes) still has a valid locale value.
  const [activeLocale, setActiveLocaleState] = useState<SupportedLocale>(
    resolveLocale(getDeviceLocale())
  );

  // Hydrate from AsyncStorage on mount — applies the stored user override if any.
  useEffect(() => {
    void getEffectiveLocale().then((locale) => {
      setActiveLocaleState(locale);
    });
  }, []);

  const setActiveLocale = useCallback(async (locale: SupportedLocale): Promise<void> => {
    await setLanguageOverride(locale);
    setActiveLocaleState(locale);
  }, []);

  const value = useMemo(
    () => ({ activeLocale, setActiveLocale }),
    [activeLocale, setActiveLocale]
  );

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Returns the active locale context.
 *
 * Safe to call outside a `LocaleProvider` — falls back to the device locale
 * with a no-op setter, so callers in the root layout (before the provider is
 * mounted) do not crash.
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx) return ctx;

  // Fallback: no provider in tree (e.g. called from root layout before mount).
  return FALLBACK_LOCALE_VALUE;
}
