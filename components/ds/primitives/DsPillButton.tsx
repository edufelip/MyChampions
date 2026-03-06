import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { DsRadius, DsTypography, type DsColorScheme, getDsTheme } from '@/constants/design-system';

type DsPillButtonVariant = 'primary' | 'secondary' | 'outline';
type DsPillButtonSize = 'xs' | 'sm' | 'md';

type DsPillButtonProps = {
  scheme: DsColorScheme;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: DsPillButtonVariant;
  size?: DsPillButtonSize;
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
  size = 'md',
  leftIcon,
  rightIcon,
  testID,
  style,
  fullWidth = true,
  contentColor,
}: DsPillButtonProps) {
  const theme = getDsTheme(scheme);
  const isPrimary = variant === 'primary';
  const isOutline = variant === 'outline';
  const isSmall = size === 'sm';
  const isExtraSmall = size === 'xs';
  const secondaryBackgroundColor =
    scheme === 'dark' ? theme.color.overlayStrong : theme.color.accentBlue;

  const resolvedContentColor =
    contentColor ?? (isOutline ? theme.color.accentPrimary : theme.color.onAccent);

  const getVariantStyles = () => {
    if (isPrimary) {
      return {
        backgroundColor: theme.color.accentPrimary,
        borderColor: theme.color.accentPrimary,
      };
    }
    if (isOutline) {
      return {
        backgroundColor: 'transparent',
        borderColor: theme.color.accentPrimary,
        borderWidth: 1.5,
      };
    }
    return {
      backgroundColor: secondaryBackgroundColor,
      borderColor: secondaryBackgroundColor,
      borderWidth: 1,
    };
  };

  const getSizeStyles = () => {
    if (isExtraSmall) return styles.buttonXs;
    if (isSmall) return styles.buttonSm;
    return styles.buttonMd;
  };

  const getTextSizeStyles = () => {
    if (isExtraSmall) return styles.textXs;
    if (isSmall) return styles.textSm;
    return styles.textMd;
  };

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        getSizeStyles(),
        getVariantStyles(),
        { width: fullWidth ? '100%' : undefined },
        { opacity: disabled || loading ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        style,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={resolvedContentColor} size="small" />
      ) : (
        <>
          {leftIcon}
          <Text
            style={[
              styles.text,
              getTextSizeStyles(),
              { color: resolvedContentColor },
            ]}>
            {label}
          </Text>
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
    paddingHorizontal: 18,
  },
  buttonMd: {
    minHeight: 52,
  },
  buttonSm: {
    minHeight: 44,
  },
  buttonXs: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
  text: {
    ...DsTypography.button,
    textAlign: 'center',
  },
  textMd: {
    fontSize: 16,
  },
  textSm: {
    fontSize: 14,
  },
  textXs: {
    fontSize: 12,
    fontWeight: '700',
  },
});
