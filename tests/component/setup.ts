import type * as LocalizationCore from '@/localization/core';
import type * as ReactModule from 'react';
import type * as ReactNativeModule from 'react-native';

let mockLocale: LocalizationCore.SupportedLocale = 'en-US';
export function setComponentLocale(locale: LocalizationCore.SupportedLocale) {
  mockLocale = locale;
}

jest.mock('@/localization', () => {
  const core = jest.requireActual<typeof LocalizationCore>('@/localization/core');
  return {
    ...core,
    useTranslation: () => ({
      locale: mockLocale,
      t: (key: LocalizationCore.TranslationKey, params?: Record<string, string | number>) =>
        core.t(mockLocale, key, params),
    }),
  };
});
jest.mock('@expo/vector-icons', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const { Text } = jest.requireActual<typeof ReactNativeModule>('react-native');
  return {
    MaterialIcons: (props: {
      name: string;
      color: string;
      style?: ReactNativeModule.StyleProp<ReactNativeModule.TextStyle>;
      'aria-hidden'?: boolean;
    }) =>
      React.createElement(
        Text,
        {
          testID: `material-icon.${props.name}`,
          style: [props.style, { color: props.color }],
          'aria-hidden': props['aria-hidden'],
        },
        props.name,
      ),
  };
});
jest.mock('@/features/platform/haptics-adapter', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('expo-video', () => ({
  VideoView: 'View',
  useVideoPlayer: () => ({ play: jest.fn(), pause: jest.fn() }),
}));
beforeEach(() => {
  mockLocale = 'en-US';
});
afterEach(() => {
  jest.useRealTimers();
});
