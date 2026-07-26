import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, type ColorValue, type StyleProp, type ViewStyle } from 'react-native';

import { DsRadius, DsTypography, type DsColorScheme, getDsTheme } from '@/constants/design-system';

type DsPillButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';
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
  const isSecondary = variant === 'secondary';
  const isOutline = variant === 'outline';
  const isGhost = variant === 'ghost';
  const isSmall = size === 'sm';
  const isExtraSmall = size === 'xs';

  const secondaryBackgroundColor = theme.color.accentPrimarySoft;

  const resolvedContentColor = disabled
    ? theme.color.disabledText
    : contentColor ?? (isOutline || isSecondary || isGhost ? theme.color.accentPrimary : theme.color.onAccent);

  const getVariantStyles = () => {
    if (disabled) {
      if (isOutline || isGhost) {
        return {
          backgroundColor: 'transparent',
          borderColor: theme.color.disabledBorder,
          borderWidth: isOutline ? 1.5 : 0,
        };
      }

      return {
        backgroundColor: theme.color.disabledSurface,
        borderColor: theme.color.disabledBorder,
        borderWidth: 1,
      };
    }

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
    if (isGhost) {
      return {
        backgroundColor: 'transparent',
        borderColor: 'transparent',
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
      accessibilityState={{ busy: loading, disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        getSizeStyles(),
        getVariantStyles(),
        { width: fullWidth ? '100%' : undefined },
        { transform: [{ scale: pressed && !disabled && !loading ? 0.98 : 1 }] },
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
            ]}
            testID={testID ? `${testID}.label` : undefined}>
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
    minHeight: 46,
  },
  buttonSm: {
    minHeight: 38,
  },
  buttonXs: {
    minHeight: 32,
    paddingHorizontal: 12,
  },
  text: {
    ...DsTypography.button,
    textAlign: 'center',
  },
  textMd: {
    fontSize: 15,
  },
  textSm: {
    fontSize: 13.5,
  },
  textXs: {
    fontSize: 11,
    fontWeight: '700',
  },
});
