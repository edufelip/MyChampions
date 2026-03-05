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
    accentBlue: string;
    accentBlueSoft: string;
    accentCyan: string;
    accentCyanSoft: string;
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
      canvas: '#f6f8f6',
      shell: '#ffffffb3',
      surface: '#ffffff',
      surfaceMuted: '#f1f5f9',
      surfaceElevated: '#ffffff',
      surfaceWarning: '#fff7ed',
      textPrimary: '#0f172a',
      textSecondary: '#475569',
      textTertiary: '#94a3b8',
      accentPrimary: '#1ea95a',
      accentPrimaryHover: '#198a49',
      accentPrimarySoft: '#1ea95a20',
      accentBlue: '#0A2463',
      accentBlueSoft: '#dbeafe',
      accentCyan: '#06b6d4',
      accentCyanSoft: '#cffafe',
      success: '#16a34a',
      successSoft: '#dcfce7',
      warning: '#b45309',
      warningSoft: '#ffedd5',
      danger: '#b3261e',
      dangerSoft: '#fee2e2',
      dangerBorder: '#fecaca',
      readOnlyText: '#9a3412',
      border: '#e2e8f0',
      borderStrong: '#cbd5e1',
      onAccent: '#0A2463',
      overlaySoft: 'rgba(10,36,99,0.6)',
      overlayStrong: 'rgba(10,36,99,0.95)',
    },
    blob: {
      topLeft: '#dcfce7',
      bottomRight: '#dbeafe',
    },
  },
  dark: {
    color: {
      canvas: '#102215',
      shell: '#00000066',
      surface: '#111827',
      surfaceMuted: '#1f2937',
      surfaceElevated: '#0f172a',
      surfaceWarning: '#422006',
      textPrimary: '#f8fafc',
      textSecondary: '#cbd5e1',
      textTertiary: '#94a3b8',
      accentPrimary: '#1ea95a',
      accentPrimaryHover: '#198a49',
      accentPrimarySoft: '#1ea95a29',
      accentBlue: '#93c5fd',
      accentBlueSoft: '#1e3a5f',
      accentCyan: '#22d3ee',
      accentCyanSoft: '#164e63',
      success: '#22c55e',
      successSoft: '#14532d',
      warning: '#f59e0b',
      warningSoft: '#78350f',
      danger: '#ef4444',
      dangerSoft: '#7f1d1d66',
      dangerBorder: '#7f1d1d',
      readOnlyText: '#fdba74',
      border: '#374151',
      borderStrong: '#4b5563',
      onAccent: '#0A2463',
      overlaySoft: 'rgba(10,36,99,0.55)',
      overlayStrong: 'rgba(10,36,99,0.88)',
    },
    blob: {
      topLeft: '#1f3b28',
      bottomRight: '#12315f',
    },
  },
};

export const DsRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
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

export const DsTypography: Record<
  'title' | 'screenTitle' | 'cardTitle' | 'body' | 'caption' | 'button' | 'micro',
  TextStyle
> = {
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  screenTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '600',
  },
  cardTitle: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  caption: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '400',
  },
  button: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
  },
  micro: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
} as const;

export const DsShadow: Record<'none' | 'soft' | 'floating', ViewStyle> = {
  none: {},
  soft: {
    elevation: 2,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
  },
  floating: {
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
  },
};

export function getDsTheme(scheme: DsColorScheme): DsTheme {
  return THEME_BY_SCHEME[scheme];
}
