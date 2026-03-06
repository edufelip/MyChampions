import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type DsColorScheme, getDsTheme } from '@/constants/design-system';

import { DsBlobBackground } from './DsBlobBackground';

type DsScreenProps = {
  scheme: DsColorScheme;
  children: ReactNode;
  testID?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  withBlobs?: boolean;
  scrollable?: boolean;
  withTopInset?: boolean;
} & Omit<ScrollViewProps, 'style' | 'contentContainerStyle' | 'children'>;

export function DsScreen({
  scheme,
  children,
  testID,
  contentContainerStyle,
  withBlobs = true,
  scrollable = true,
  withTopInset = true,
  ...scrollViewProps
}: DsScreenProps) {
  const theme = getDsTheme(scheme);
  const insets = useSafeAreaInsets();

  if (!scrollable) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.color.canvas }]}
        testID={testID}>
        {withBlobs ? <DsBlobBackground scheme={scheme} /> : null}
        <View style={[styles.content, contentContainerStyle]}>
          {withTopInset ? <View style={[styles.safeAreaSpacer, { height: insets.top / 2 }]} /> : null}
          {children}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      testID={testID}
      {...scrollViewProps}>
      {withBlobs ? <DsBlobBackground scheme={scheme} /> : null}
      {withTopInset ? <View style={[styles.safeAreaSpacer, { height: insets.top / 2 }]} /> : null}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  safeAreaSpacer: {
    width: '100%',
  },
});
