/**
 * useTranslation — context-aware translation hook.
 *
 * Reads the active locale from `LocaleContext` so that calling
 * `setActiveLocale()` immediately re-renders all components that use this hook.
 *
 * This file is intentionally separate from `localization/index.ts` to avoid a
 * circular import: `locale-context.tsx` imports pure helpers from `index.ts`,
 * and this file imports the hook from `locale-context.tsx` — no cycle.
 *
 * All existing imports of `useTranslation` from `@/localization` continue to
 * resolve here via the barrel re-export in `localization/index.ts`.
 */
import { useRef } from 'react';

import { useLocale } from './locale-context';
import { buildTranslationBinding, type TranslationBinding } from './index';

export function useTranslation() {
  const { activeLocale } = useLocale();
  const bindingRef = useRef<TranslationBinding | null>(null);
  bindingRef.current = buildTranslationBinding(activeLocale, bindingRef.current);
  return bindingRef.current;
}
