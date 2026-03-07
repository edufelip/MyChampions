import React from 'react';
import { StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { DsRadius, DsShadow, DsSpace, type DsTheme } from '@/constants/design-system';

type BuilderInsetGroupProps = {
  theme: DsTheme;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export const BuilderInsetGroup = React.memo(({
  theme,
  children,
  style,
}: BuilderInsetGroupProps) => {
  return (
    <View style={[
      styles.group, 
      { backgroundColor: theme.color.surface },
      style
    ]}>
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  group: {
    borderRadius: DsRadius.lg,
    padding: DsSpace.md,
    ...DsShadow.soft,
  },
});
