/**
 * Language preference persistence.
 * Stores the user's explicit in-app language override in AsyncStorage.
 * When no override exists the app falls back to the device locale.
 *
 * Key: `app.language.override`
 * Value: one of SupportedLocale ('en-US' | 'pt-BR' | 'es-ES') or null (cleared)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { getDeviceLocale, resolveLocale, SUPPORTED_LOCALES, type SupportedLocale } from '@/localization';

const LANGUAGE_OVERRIDE_KEY = 'app.language.override';

export async function getLanguageOverride(): Promise<SupportedLocale | null> {
  const value = await AsyncStorage.getItem(LANGUAGE_OVERRIDE_KEY);
  if (value && (SUPPORTED_LOCALES as readonly string[]).includes(value)) {
    return value as SupportedLocale;
  }
  return null;
}

export async function setLanguageOverride(locale: SupportedLocale): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_OVERRIDE_KEY, locale);
}

export async function clearLanguageOverride(): Promise<void> {
  await AsyncStorage.removeItem(LANGUAGE_OVERRIDE_KEY);
}

/**
 * Returns the effective app locale used by runtime features:
 * 1) explicit in-app override, 2) device locale fallback.
 */
export async function getEffectiveLocale(): Promise<SupportedLocale> {
  const override = await getLanguageOverride();
  if (override) return override;
  return resolveLocale(getDeviceLocale());
}
