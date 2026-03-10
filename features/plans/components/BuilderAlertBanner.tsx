import { StyleSheet, Text, View } from 'react-native';

import { DsRadius, DsSpace, DsTypography } from '@/constants/design-system';

type BuilderAlertBannerProps = {
  message: string;
  backgroundColor: string;
  textColor: string;
  borderColor?: string;
};

export function BuilderAlertBanner({
  message,
  backgroundColor,
  textColor,
  borderColor,
}: BuilderAlertBannerProps) {
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          backgroundColor,
          borderColor: borderColor ?? backgroundColor,
          borderWidth: borderColor ? 1 : 0,
        },
      ]}
    >
      <Text style={[styles.text, { color: textColor }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: DsRadius.md,
    padding: DsSpace.sm,
    marginBottom: DsSpace.xs,
  },
  text: {
    ...DsTypography.caption,
    fontWeight: '600',
    textAlign: 'center',
  },
});
