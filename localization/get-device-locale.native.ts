import * as Localization from 'expo-localization';

export function getDeviceLocale(): string {
  const locales = Localization.getLocales();
  if (locales && locales.length > 0) {
    return locales[0].languageTag ?? locales[0].languageCode ?? 'en-US';
  }
  return 'en-US';
}
