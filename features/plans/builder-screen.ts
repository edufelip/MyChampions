import { Platform, UIManager } from 'react-native';

import type { DsTheme } from '@/constants/design-system';
import type { TranslationKey } from '@/localization';

let layoutAnimationsEnabled = false;

export function enableBuilderLayoutAnimations() {
  if (layoutAnimationsEnabled) {
    return;
  }

  if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }

  layoutAnimationsEnabled = true;
}

export function createBuilderPalette(theme: DsTheme) {
  return {
    background: theme.color.canvas,
    text: theme.color.textPrimary,
    tint: theme.color.accentPrimary,
    icon: theme.color.textSecondary,
    danger: theme.color.danger,
  };
}

export function createBuilderRoleTranslator(
  isStudentBuilder: boolean,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string
) {
  return (proKey: string, studentKey: string) =>
    t((isStudentBuilder ? studentKey : proKey) as TranslationKey);
}
