import type { TextStyle, ViewStyle } from 'react-native';

export type DsColorScheme = 'light' | 'dark';

export type DsTheme = {
  color: {
    canvas: string;
    shell: string;
    surface: string;
    surfaceMuted: string;
    surfaceElevated: string;
    surfaceWarning: string;
    textPrimary: string;
    textSecondary: string;
    textTertiary: string;
    accentPrimary: string;
    accentPrimaryHover: string;
    accentPrimarySoft: string;
    accentWarm: string;
    accentWarmSoft: string;
    disabledSurface: string;
    disabledText: string;
    disabledBorder: string;
    success: string;
    successSoft: string;
    warning: string;
    warningSoft: string;
    danger: string;
    dangerSoft: string;
    dangerBorder: string;
    readOnlyText: string;
    border: string;
    borderStrong: string;
    accentCyan: string;
    accentCyanSoft: string;
    onAccent: string;
    overlaySoft: string;
    overlayStrong: string;
  };
  blob: {
    topLeft: string;
    bottomRight: string;
  };
};

const THEME_BY_SCHEME: Record<DsColorScheme, DsTheme> = {
  light: {
    color: {
      canvas: '#faf9f7',
      shell: '#ffffffb3',
      surface: '#ffffff',
      surfaceMuted: '#f3f1ec',
      surfaceElevated: '#ffffff',
      surfaceWarning: '#fff3e0',
      textPrimary: '#262420',
      textSecondary: '#5b5548',
      textTertiary: '#6f6656',
      accentPrimary: '#1f7a4c',
      accentPrimaryHover: '#175f3b',
      accentPrimarySoft: '#1f7a4c1a',
      accentWarm: '#a06813',
      accentWarmSoft: '#a068131a',
      disabledSurface: '#e8e4da',
      disabledText: '#5b5548',
      disabledBorder: '#d8d2c4',
      success: '#1f7a4c',
      successSoft: '#e3efe6',
      warning: '#b45309',
      warningSoft: '#ffedd5',
      danger: '#b3261e',
      dangerSoft: '#fee2e2',
      dangerBorder: '#fecaca',
      readOnlyText: '#9a3412',
      border: '#ece7dd',
      borderStrong: '#ddd6c8',
      accentCyan: '#06b6d4',
      accentCyanSoft: '#06b6d420',
      onAccent: '#fbf9f5',
      overlaySoft: 'rgba(31,122,76,0.4)',
      overlayStrong: 'rgba(31,122,76,0.85)',
    },
    blob: {
      topLeft: '#dcfce7',
      bottomRight: '#dbeafe',
    },
  },
  dark: {
    color: {
      canvas: '#181510',
      shell: '#00000066',
      surface: '#211d17',
      surfaceMuted: '#2a251d',
      surfaceElevated: '#211d17',
      surfaceWarning: '#3a2610',
      textPrimary: '#f5f1e9',
      textSecondary: '#c9c0b0',
      textTertiary: '#9c9284',
      accentPrimary: '#4ade80',
      accentPrimaryHover: '#6bce97',
      accentPrimarySoft: '#4ade8029',
      accentWarm: '#e0a838',
      accentWarmSoft: '#e0a83829',
      disabledSurface: '#3a352b',
      disabledText: '#c9c0b0',
      disabledBorder: '#4d473a',
      success: '#4ade80',
      successSoft: '#1e3a26',
      warning: '#f59e0b',
      warningSoft: '#3a2610',
      danger: '#ef4444',
      dangerSoft: '#7f1d1d66',
      dangerBorder: '#7f1d1d',
      readOnlyText: '#fdba74',
      border: '#3a352b',
      borderStrong: '#4d473a',
      accentCyan: '#22d3ee',
      accentCyanSoft: '#22d3ee29',
      onAccent: '#0e1a12',
      overlaySoft: 'rgba(74,222,128,0.3)',
      overlayStrong: 'rgba(74,222,128,0.7)',
    },
    blob: {
      topLeft: '#1f3b28',
      bottomRight: '#12315f',
    },
  },
};

export const DsRadius = {
  sm: 10,
  md: 14,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

export const DsSpace = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Direction C ("Warm & Human") type system: Manrope throughout, loaded via
 * @expo-google-fonts/manrope and gated in app/_layout.tsx. Each role maps to
 * a specific static weight file (React Native doesn't reliably interpolate
 * variable-font weight), so fontWeight below always matches the loaded cut.
 */
export const DsFontFamily = {
  display: 'Manrope_800ExtraBold',
  bold: 'Manrope_700Bold',
  semibold: 'Manrope_600SemiBold',
  body: 'Manrope_500Medium',
} as const;

export const DsTypography: Record<
  'title' | 'screenTitle' | 'cardTitle' | 'body' | 'caption' | 'button' | 'micro',
  TextStyle
> = {
  title: {
    fontFamily: DsFontFamily.display,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  screenTitle: {
    fontFamily: DsFontFamily.bold,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  cardTitle: {
    fontFamily: DsFontFamily.bold,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '700',
  },
  body: {
    fontFamily: DsFontFamily.body,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
  },
  caption: {
    fontFamily: DsFontFamily.body,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  button: {
    fontFamily: DsFontFamily.bold,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  micro: {
    fontFamily: DsFontFamily.semibold,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
} as const;

/**
 * Direction C favors one soft, diffused shadow per surface instead of a
 * border — never both (see DsCard). `floating` stays reserved for true
 * overlays (modals, the bulk-action tray).
 */
export const DsShadow: Record<'none' | 'soft' | 'floating', ViewStyle> = {
  none: {},
  soft: {
    elevation: 3,
    shadowColor: '#26241d',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
  },
  floating: {
    elevation: 8,
    shadowColor: '#26241d',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.16,
    shadowRadius: 32,
  },
};

export function getDsTheme(scheme: DsColorScheme): DsTheme {
  return THEME_BY_SCHEME[scheme];
}
