import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { DsRadius, DsTypography, type DsColorScheme, getDsTheme } from '@/constants/design-system';

type DsPillButtonVariant = 'primary' | 'secondary';

type DsPillButtonProps = {
  scheme: DsColorScheme;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: DsPillButtonVariant;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  fullWidth?: boolean;
  contentColor?: ColorValue;
};

export function DsPillButton({
  scheme,
  label,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  leftIcon,
  rightIcon,
  testID,
  style,
  fullWidth = true,
  contentColor,
}: DsPillButtonProps) {
  const theme = getDsTheme(scheme);
  const isPrimary = variant === 'primary';
  const resolvedContentColor = contentColor ?? (isPrimary ? theme.color.onAccent : theme.color.accentBlue);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        isPrimary
          ? { backgroundColor: theme.color.accentPrimary, borderColor: theme.color.accentPrimary }
          : {
              backgroundColor: theme.color.surface,
              borderColor: theme.color.borderStrong,
              borderWidth: 1,
            },
        { width: fullWidth ? '100%' : undefined },
        { opacity: disabled || loading ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        style,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={resolvedContentColor} />
      ) : (
        <>
          {leftIcon}
          <Text style={[styles.text, { color: resolvedContentColor }]}>{label}</Text>
          {rightIcon}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 18,
  },
  text: {
    ...DsTypography.button,
  },
});
