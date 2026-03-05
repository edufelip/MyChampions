import { Platform } from 'react-native';

import { getDsTheme } from './design-system';

const light = getDsTheme('light').color;
const dark = getDsTheme('dark').color;

export const Colors = {
  light: {
    text: light.textPrimary,
    background: light.canvas,
    tint: light.accentPrimary,
    icon: light.textSecondary,
    tabIconDefault: light.textTertiary,
    tabIconSelected: light.accentBlue,
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

export const Fonts = Platform.select({
  ios: {
    sans: 'Manrope',
    serif: 'Manrope',
    rounded: 'Manrope',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'sans-serif',
    serif: 'sans-serif',
    rounded: 'sans-serif',
    mono: 'monospace',
  },
  web: {
    sans: "Manrope, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Manrope, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    rounded: "Manrope, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
