import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';

type BuilderGuidanceCardProps = {
  theme: DsTheme;
  title: string;
  description: string;
  onDismiss: () => void;
  visible: boolean;
};

export const BuilderGuidanceCard = React.memo(({
  theme,
  title,
  description,
  onDismiss,
  visible,
}: BuilderGuidanceCardProps) => {
  if (!visible) return null;

  return (
    <Animated.View 
      entering={FadeInUp.duration(400)}
      exiting={FadeOutUp.duration(300)}
      style={[styles.card, { backgroundColor: theme.color.accentPrimarySoft }]}
    >
      <View style={styles.header}>
        <IconSymbol name="info.circle.fill" size={20} color={theme.color.accentPrimary} />
        <Text style={[styles.title, { color: theme.color.textPrimary }]}>
          {title}
        </Text>
        <Pressable onPress={onDismiss} hitSlop={12}>
          <IconSymbol name="xmark" size={18} color={theme.color.textSecondary} />
        </Pressable>
      </View>
      <Text style={[styles.text, { color: theme.color.textSecondary }]}>
        {description}
      </Text>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: {
    padding: DsSpace.md,
    borderRadius: DsRadius.lg,
    gap: DsSpace.xs,
    marginBottom: DsSpace.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: DsSpace.sm,
  },
  title: {
    ...DsTypography.body,
    fontWeight: '700',
    flex: 1,
  },
  text: {
    ...DsTypography.caption,
    lineHeight: 18,
  },
});
