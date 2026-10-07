/** Language override persistence and redacted storage observation. */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getDeviceLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
  type SupportedLocale,
} from '@/localization/core';

const LANGUAGE_OVERRIDE_KEY = 'app.language.override';

export type LanguageOverrideObservation =
  | {
      status: 'present';
      source: 'language-storage';
      value: SupportedLocale;
    }
  | {
      status: 'absent' | 'invalid' | 'read-error';
      source: 'language-storage';
      value: null;
    };

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

async function readStoredOverride(): Promise<string | null> {
  return AsyncStorage.getItem(LANGUAGE_OVERRIDE_KEY);
}

/** Product API preserved from the canonical module. */
export async function getLanguageOverride(): Promise<SupportedLocale | null> {
  const value = await readStoredOverride();
  if (value && isSupportedLocale(value)) return value;
  return null;
}

/**
 * Redacted storage provenance for the testability seam. Raw AsyncStorage
 * values and read exceptions never leave this function.
 */
export async function readLanguageOverrideObservation(): Promise<LanguageOverrideObservation> {
  try {
    const value = await readStoredOverride();
    if (value === null) return { status: 'absent', source: 'language-storage', value: null };
    if (isSupportedLocale(value)) return { status: 'present', source: 'language-storage', value };
    return { status: 'invalid', source: 'language-storage', value: null };
  } catch {
    return { status: 'read-error', source: 'language-storage', value: null };
  }
}

export async function setLanguageOverride(locale: SupportedLocale): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_OVERRIDE_KEY, locale);
}

export async function clearLanguageOverride(): Promise<void> {
  await AsyncStorage.removeItem(LANGUAGE_OVERRIDE_KEY);
}

/** Product API preserved from the canonical module. */
export async function getEffectiveLocale(): Promise<SupportedLocale> {
  const override = await getLanguageOverride();
  if (override) return override;
  return resolveLocale(getDeviceLocale());
}
