import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { DsRadius, DsSpace, DsTypography, type DsColorScheme, getDsTheme } from '@/constants/design-system';

type DsOfflineBannerProps = {
  scheme: DsColorScheme;
  text: string;
  testID?: string;
};

export function DsOfflineBanner({ scheme, text, testID }: DsOfflineBannerProps) {
  const theme = getDsTheme(scheme);

  return (
    <View
      style={[styles.banner, { backgroundColor: theme.color.dangerSoft, borderColor: theme.color.dangerBorder }]}
      testID={testID}
      accessibilityRole="alert">
      <MaterialIcons color={theme.color.danger} name="cloud-off" size={18} />
      <Text style={[styles.text, { color: theme.color.danger }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: 'center',
    borderRadius: DsRadius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: DsSpace.sm,
    paddingHorizontal: DsSpace.md,
    paddingVertical: 10,
  },
  text: {
    ...DsTypography.caption,
    flex: 1,
    fontWeight: '600',
  },
});
