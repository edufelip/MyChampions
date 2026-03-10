import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { DsRadius, DsShadow, DsSpace, type DsColorScheme, type DsTheme } from '@/constants/design-system';

type BuilderLoadingScrimProps = {
  scheme: DsColorScheme;
  theme: DsTheme;
  spinnerColor: string;
  label: string;
};

export function BuilderLoadingScrim({
  scheme,
  theme,
  spinnerColor,
  label,
}: BuilderLoadingScrimProps) {
  return (
    <View
      style={[
        styles.scrim,
        { backgroundColor: scheme === 'dark' ? 'rgba(0, 0, 0, 0.45)' : 'rgba(255, 255, 255, 0.62)' },
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <View style={[styles.card, { backgroundColor: theme.color.surface }]}>
        <ActivityIndicator size="large" color={spinnerColor} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  card: {
    paddingHorizontal: DsSpace.lg,
    paddingVertical: DsSpace.lg,
    borderRadius: DsRadius.xl,
    ...DsShadow.soft,
  },
});
