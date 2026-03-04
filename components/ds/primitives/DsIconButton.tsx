import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { DsRadius, DsShadow, type DsColorScheme, getDsTheme } from '@/constants/design-system';

type IconName = keyof typeof MaterialIcons.glyphMap;

type DsIconButtonProps = {
  scheme: DsColorScheme;
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  size?: number;
};

export function DsIconButton({
  scheme,
  icon,
  onPress,
  accessibilityLabel,
  testID,
  size = 48,
}: DsIconButtonProps) {
  const theme = getDsTheme(scheme);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        DsShadow.soft,
        {
          width: size,
          height: size,
          borderRadius: DsRadius.pill,
          backgroundColor: theme.color.surface,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        },
      ]}
      testID={testID}>
      <MaterialIcons color={theme.color.textPrimary} name={icon} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
