import { useRef } from 'react';

import { enUS, type TranslationKey } from './en-US';

export type { TranslationKey };
import { esES } from './es-ES';
import { getDeviceLocale } from './get-device-locale';
import { ptBR } from './pt-BR';

export const SUPPORTED_LOCALES = ['en-US', 'pt-BR', 'es-ES'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

type TranslationDictionary = Record<TranslationKey, string>;

const DICTIONARIES: Record<SupportedLocale, TranslationDictionary> = {
  'en-US': enUS,
  'pt-BR': ptBR,
  'es-ES': esES,
};

export function resolveLocale(rawLocale?: string): SupportedLocale {
  const normalized = (rawLocale ?? '').trim();

  if (normalized in DICTIONARIES) {
    return normalized as SupportedLocale;
  }

  const lower = normalized.toLowerCase();
  if (lower.startsWith('pt')) {
    return 'pt-BR';
  }

  if (lower.startsWith('es')) {
    return 'es-ES';
  }

  return 'en-US';
}

export { getDeviceLocale };

export function t(
  locale: SupportedLocale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const template = DICTIONARIES[locale][key] ?? DICTIONARIES['en-US'][key] ?? key;
  if (!params) {
    return template;
  }

  return Object.entries(params).reduce((acc, [paramKey, value]) => {
    return acc.replaceAll(`{${paramKey}}`, String(value));
  }, template);
}

export type TranslationBinding = {
  locale: SupportedLocale;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
};

export function buildTranslationBinding(
  locale: SupportedLocale,
  previous?: TranslationBinding | null
): TranslationBinding {
  if (previous && previous.locale === locale) {
    return previous;
  }

  return {
    locale,
    t: (key: TranslationKey, params?: Record<string, string | number>) => t(locale, key, params),
  };
}

export function useTranslation() {
  const locale = resolveLocale(getDeviceLocale());
  const bindingRef = useRef<TranslationBinding | null>(null);
  bindingRef.current = buildTranslationBinding(locale, bindingRef.current);
  return bindingRef.current;
}
