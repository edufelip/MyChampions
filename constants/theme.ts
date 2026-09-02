import { Platform } from 'react-native';
import { DsFontFamily, getDsTheme } from './design-system';

const light = getDsTheme('light').color;
const dark = getDsTheme('dark').color;

export const Colors = {
  light: {
    text: light.textPrimary,
    background: light.canvas,
    tint: light.accentPrimary,
    icon: light.textSecondary,
    tabIconDefault: light.textTertiary,
    tabIconSelected: light.accentPrimary,
  },
  dark: {
    text: dark.textPrimary,
    background: dark.canvas,
    tint: dark.accentPrimary,
    icon: dark.textSecondary,
    tabIconDefault: dark.textTertiary,
    tabIconSelected: dark.accentPrimary,
  },
};

// Real Manrope weights, loaded via @expo-google-fonts/manrope and gated in
// app/_layout.tsx — see DsFontFamily in constants/design-system.ts for the
// single source of truth on which static weight backs each role.
export const Fonts = {
  sans: DsFontFamily.body,
  serif: DsFontFamily.display,
  rounded: DsFontFamily.display,
  mono: Platform.select({
    ios: 'ui-monospace',
    web: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
    default: 'monospace',
  }),
};
