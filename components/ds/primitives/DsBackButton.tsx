import { MaterialIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { DsRadius, type DsColorScheme, getDsTheme } from '@/constants/design-system';

type DsBackButtonProps = {
  scheme: DsColorScheme;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function DsBackButton({
  scheme,
  onPress,
  testID,
  accessibilityLabel,
  style,
}: DsBackButtonProps) {
  const theme = getDsTheme(scheme);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: theme.color.surface,
          borderColor: theme.color.border,
          opacity: pressed ? 0.75 : 1,
        },
        style,
      ]}
      testID={testID}>
      <MaterialIcons color={theme.color.textPrimary} name="arrow-back" size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
});
