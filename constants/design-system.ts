import type { ViewStyle } from 'react-native';

export type DsColorScheme = 'light' | 'dark';

export type DsTheme = {
  color: {
    canvas: string;
    shell: string;
    surface: string;
    surfaceMuted: string;
    surfaceWarning: string;
    textPrimary: string;
    textSecondary: string;
    accentPrimary: string;
    accentPrimarySoft: string;
    accentBlueSoft: string;
    accentMint: string;
    accentYellow: string;
    danger: string;
    dangerSoft: string;
    dangerBorder: string;
    readOnlyText: string;
    border: string;
  };
  blob: {
    topLeft: string;
    bottomRight: string;
  };
};

const THEME_BY_SCHEME: Record<DsColorScheme, DsTheme> = {
  light: {
    color: {
      canvas: '#fff5f0',
      shell: '#ffffff66',
      surface: '#ffffffee',
      surfaceMuted: '#f8fafc',
      surfaceWarning: '#fff7ed',
      textPrimary: '#0f172a',
      textSecondary: '#64748b',
      accentPrimary: '#ff7b72',
      accentPrimarySoft: '#ff7b721a',
      accentBlueSoft: '#e0f2fe',
      accentMint: '#a1e8cc',
      accentYellow: '#ffeca1',
      danger: '#b3261e',
      dangerSoft: '#fee2e2',
      dangerBorder: '#fecaca',
      readOnlyText: '#9a3412',
      border: '#f1f5f9',
    },
    blob: {
      topLeft: '#ffeca1',
      bottomRight: '#a1e8cc',
    },
  },
  dark: {
    color: {
      canvas: '#221410',
      shell: '#00000033',
      surface: '#1f2937ee',
      surfaceMuted: '#334155',
      surfaceWarning: '#4a2e1f',
      textPrimary: '#ECEDEE',
      textSecondary: '#9BA1A6',
      accentPrimary: '#ff7b72',
      accentPrimarySoft: '#ff7b721a',
      accentBlueSoft: '#1e3a5f',
      accentMint: '#2e5b4a',
      accentYellow: '#5f4f29',
      danger: '#ef4444',
      dangerSoft: '#7f1d1d66',
      dangerBorder: '#7f1d1d',
      readOnlyText: '#fdba74',
      border: '#374151',
    },
    blob: {
      topLeft: '#5f4f29',
      bottomRight: '#2e5b4a',
    },
  },
};

export const DsRadius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 30,
  pill: 999,
} as const;

export const DsSpace = {
  xxs: 4,
  xs: 6,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const DsTypography = {
  title: {
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  cardTitle: {
    fontSize: 19,
    fontWeight: '700',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    fontSize: 16,
    fontWeight: '700',
  },
} as const;

export const DsShadow: Record<'none' | 'soft', ViewStyle> = {
  none: {},
  soft: {
    elevation: 1,
  },
};

export function getDsTheme(scheme: DsColorScheme): DsTheme {
  return THEME_BY_SCHEME[scheme];
}
