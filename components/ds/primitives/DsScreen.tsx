import type { ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { type DsColorScheme, getDsTheme } from '@/constants/design-system';

import { DsBlobBackground } from './DsBlobBackground';

type DsScreenProps = {
  scheme: DsColorScheme;
  children: ReactNode;
  testID?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  withBlobs?: boolean;
  scrollable?: boolean;
} & Omit<ScrollViewProps, 'style' | 'contentContainerStyle' | 'children'>;

export function DsScreen({
  scheme,
  children,
  testID,
  contentContainerStyle,
  withBlobs = true,
  scrollable = true,
  ...scrollViewProps
}: DsScreenProps) {
  const theme = getDsTheme(scheme);

  if (!scrollable) {
    return (
      <View
        style={[styles.container, { backgroundColor: theme.color.canvas }]}
        testID={testID}>
        {withBlobs ? <DsBlobBackground scheme={scheme} /> : null}
        <View style={[styles.content, contentContainerStyle]}>{children}</View>
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
});
