import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { type DsColorScheme, getDsTheme } from '@/constants/design-system';

import { DsBlobBackground } from './DsBlobBackground';

type DsScreenProps = {
  scheme: DsColorScheme;
  children: ReactNode;
  testID?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  withBlobs?: boolean;
};

export function DsScreen({
  scheme,
  children,
  testID,
  contentContainerStyle,
  withBlobs = true,
}: DsScreenProps) {
  const theme = getDsTheme(scheme);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      testID={testID}>
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
