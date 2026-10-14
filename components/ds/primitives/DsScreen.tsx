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
import { useDsKeyboardAwareScroll } from './useDsKeyboard';
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
  /**
   * Opt-in (scrollable screens): keep the focused input above the software
   * keyboard. While the keyboard is open the content gets the keyboard's
   * height as bottom space and scrolls the focused input — or the
   * `useDsKeyboardTarget` view that contains it, such as an inline form with
   * its buttons — into view; taps reach buttons without first closing the
   * keyboard. Needed on iOS and on Android edge-to-edge, where the window no
   * longer resizes for the keyboard. Inputs inside an open sheet or panel that
   * lifts itself (`useDsKeyboardOverlap`) are left to it: the screen behind
   * does not scroll.
   */
  keyboardAware?: boolean;
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
  keyboardAware = false,
  ...scrollViewProps
}: DsScreenProps) {
  const theme = getDsTheme(scheme);
  const insets = useSafeAreaInsets();
  const { width: viewportWidth } = useWindowDimensions();
  const keyboard = useDsKeyboardAwareScroll({
    enabled: keyboardAware && scrollable,
    mode: 'spacer',
    topInset: insets.top,
    onScroll: scrollViewProps.onScroll,
    onLayout: scrollViewProps.onLayout,
  });
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

  if (!keyboardAware) {
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

  return (
    <ScrollView
      ref={keyboard.scrollRef}
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      contentContainerStyle={[styles.content, responsiveContentStyle, contentContainerStyle]}
      testID={testID}
      {...scrollViewProps}
      {...keyboard.scrollViewProps}
      keyboardShouldPersistTaps={
        scrollViewProps.keyboardShouldPersistTaps ??
        keyboard.scrollViewProps.keyboardShouldPersistTaps
      }
      scrollEventThrottle={
        scrollViewProps.scrollEventThrottle ?? keyboard.scrollViewProps.scrollEventThrottle
      }
    >
      {withBlobs ? <DsBlobBackground scheme={scheme} /> : null}
      {withTopInset ? <View style={[styles.safeAreaSpacer, { height: insets.top / 2 }]} /> : null}
      {children}
      {keyboard.spacerHeight > 0 ? (
        <View
          style={{ height: keyboard.spacerHeight }}
          onLayout={keyboard.onSpacerLayout}
          testID={testID ? `${testID}.keyboardSpacer` : undefined}
        />
      ) : null}
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
