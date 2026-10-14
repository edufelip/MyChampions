/** In-session locale state with generation-bound hydration diagnostics. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  readLanguageOverrideObservation,
  setLanguageOverride,
  type LanguageOverrideObservation,
} from '@/features/auth/language-storage';
import { resolveLocale, type SupportedLocale } from '@/localization/core';
import { getDeviceLocale } from '@/localization/get-device-locale';

export type LocaleHydrationStatus = 'pending' | 'hydrated' | 'read-error' | 'unobserved';
export type LocaleDiagnosticOverrideStatus = LanguageOverrideObservation['status'] | 'unobserved';

export type LocaleDiagnosticSnapshot = {
  hydration: LocaleHydrationStatus;
  effectiveSource: 'LocaleContext' | 'unobserved';
  effectiveLocale: SupportedLocale | null;
  override:
    | LanguageOverrideObservation
    | {
        status: 'unobserved';
        source: 'unobserved';
        value: null;
      };
};

type LocaleContextValue = {
  /** The currently active locale used by all `useTranslation()` callers. */
  activeLocale: SupportedLocale;
  /** Persists the locale and updates current-session translation consumers. */
  setActiveLocale: (locale: SupportedLocale) => Promise<void>;
  /** Redacted hydration/override provenance for the guarded test seam. */
  diagnostic: LocaleDiagnosticSnapshot;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

const UNOBSERVED_OVERRIDE: LocaleDiagnosticSnapshot['override'] = {
  status: 'unobserved',
  source: 'unobserved',
  value: null,
};

const FALLBACK_LOCALE_VALUE: LocaleContextValue = {
  activeLocale: resolveLocale(getDeviceLocale()),
  setActiveLocale: async () => {},
  diagnostic: {
    hydration: 'unobserved',
    effectiveSource: 'unobserved',
    effectiveLocale: null,
    override: UNOBSERVED_OVERRIDE,
  },
};

const PENDING_DIAGNOSTIC: LocaleDiagnosticSnapshot = {
  hydration: 'pending',
  effectiveSource: 'unobserved',
  effectiveLocale: null,
  override: UNOBSERVED_OVERRIDE,
};

function readErrorDiagnostic(): LocaleDiagnosticSnapshot {
  return {
    hydration: 'read-error',
    effectiveSource: 'unobserved',
    effectiveLocale: null,
    override: {
      status: 'read-error',
      source: 'language-storage',
      value: null,
    },
  };
}

function hydratedDiagnostic(
  effectiveLocale: SupportedLocale,
  override: LanguageOverrideObservation,
): LocaleDiagnosticSnapshot {
  return {
    hydration: 'hydrated',
    effectiveSource: 'LocaleContext',
    effectiveLocale,
    override,
  };
}

type LocaleProviderProps = {
  children: ReactNode;
};

export function LocaleProvider({ children }: LocaleProviderProps) {
  // Preserve the synchronous device fallback used by the product on first render.
  const [activeLocale, setActiveLocaleState] = useState<SupportedLocale>(
    resolveLocale(getDeviceLocale()),
  );
  const [diagnostic, setDiagnostic] = useState<LocaleDiagnosticSnapshot>(PENDING_DIAGNOSTIC);
  const hydrationGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const generation = hydrationGenerationRef.current;

    void readLanguageOverrideObservation()
      .then((override) => {
        if (cancelled || generation !== hydrationGenerationRef.current) return;
        if (override.status === 'read-error') {
          // Keep the existing synchronous activeLocale fallback; do not claim
          // that fallback as hydrated app evidence after a storage failure.
          setDiagnostic(readErrorDiagnostic());
          return;
        }
        const effectiveLocale =
          override.status === 'present' ? override.value : resolveLocale(getDeviceLocale());
        setActiveLocaleState(effectiveLocale);
        setDiagnostic(hydratedDiagnostic(effectiveLocale, override));
      })
      .catch(() => {
        if (!cancelled && generation === hydrationGenerationRef.current)
          setDiagnostic(readErrorDiagnostic());
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const setActiveLocale = useCallback(async (locale: SupportedLocale): Promise<void> => {
    await setLanguageOverride(locale);
    hydrationGenerationRef.current += 1;
    setActiveLocaleState(locale);
    setDiagnostic(
      hydratedDiagnostic(locale, {
        status: 'present',
        source: 'language-storage',
        value: locale,
      }),
    );
  }, []);

  const value = useMemo(
    () => ({ activeLocale, setActiveLocale, diagnostic }),
    [activeLocale, diagnostic, setActiveLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Returns the active locale context. Outside a provider, the existing device
 * fallback and a deliberately unobserved diagnostic are returned.
 */
export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  return ctx ?? FALLBACK_LOCALE_VALUE;
}
