import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  DsRadius,
  DsShadow,
  DsSpace,
  type DsColorScheme,
  getDsTheme,
} from '@/constants/design-system';
import type { ReactNode } from 'react';

type DsCardVariant = 'default' | 'warning' | 'muted';

type DsCardProps = {
  scheme: DsColorScheme;
  children: ReactNode;
  variant?: DsCardVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function DsCard({ scheme, children, variant = 'default', style, testID }: DsCardProps) {
  const theme = getDsTheme(scheme);

  const cardStyle =
    variant === 'warning'
      ? { backgroundColor: theme.color.surfaceWarning }
      : variant === 'muted'
        ? { backgroundColor: theme.color.surfaceMuted }
        : { backgroundColor: theme.color.surface };

  return (
    <View style={[styles.card, DsShadow.soft, cardStyle, style]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: DsRadius.lg,
    padding: DsSpace.lg,
  },
});
