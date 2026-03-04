import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { DsRadius, DsShadow, DsSpace, type DsColorScheme, getDsTheme } from '@/constants/design-system';

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
      ? { backgroundColor: theme.color.surfaceWarning, borderColor: '#fed7aa' }
      : variant === 'muted'
      ? { backgroundColor: theme.color.surfaceMuted, borderColor: theme.color.border }
      : { backgroundColor: theme.color.surface, borderColor: theme.color.border };

  return (
    <View style={[styles.card, DsShadow.soft, cardStyle, style]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: DsRadius.xl,
    borderWidth: 1,
    padding: DsSpace.lg,
  },
});
