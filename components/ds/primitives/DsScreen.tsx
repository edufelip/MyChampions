import {
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { type DsColorScheme, getDsTheme } from '@/constants/design-system';
import { DsBlobBackground } from './DsBlobBackground';
import type { ReactNode } from 'react';

type DsScreenProps = {
  scheme: DsColorScheme;
  children: ReactNode;
  testID?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  withBlobs?: boolean;
  scrollable?: boolean;
  withTopInset?: boolean;
  contentWidth?: 'form' | 'content' | 'wide' | 'full';
} & Omit<ScrollViewProps, 'style' | 'contentContainerStyle' | 'children'>;

export function DsScreen({
  scheme,
  children,
  testID,
  contentContainerStyle,
  withBlobs = false,
  scrollable = true,
  withTopInset = true,
  contentWidth = 'content',
  ...scrollViewProps
}: DsScreenProps) {
  const theme = getDsTheme(scheme);
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const maxWidth =
    viewportWidth < 768 || contentWidth === 'full'
      ? undefined
      : contentWidth === 'form'
        ? 600
        : contentWidth === 'wide'
          ? viewportWidth < 1024
            ? 680
            : 1040
          : viewportWidth < 1024
            ? 680
            : 880;
  const responsiveContentStyle: ViewStyle = {
    alignSelf: 'center',
    maxWidth,
    width: '100%',
  };

  if (!scrollable) {
    return (
      <View style={[styles.container, { backgroundColor: theme.color.canvas }]} testID={testID}>
        {withBlobs ? <DsBlobBackground scheme={scheme} /> : null}
        <View style={[styles.content, responsiveContentStyle, contentContainerStyle]}>
          {withTopInset ? (
            <View style={[styles.safeAreaSpacer, { height: insets.top / 2 }]} />
          ) : null}
          {children}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      contentContainerStyle={[styles.content, responsiveContentStyle, contentContainerStyle]}
      testID={testID}
      {...scrollViewProps}
    >
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
