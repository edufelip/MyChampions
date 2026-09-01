import React from 'react';
import { StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { DsRadius, DsSpace, type DsTheme } from '@/constants/design-system';

type BuilderInsetGroupProps = {
  theme: DsTheme;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export const BuilderInsetGroup = React.memo(
  ({ theme, children, style }: BuilderInsetGroupProps) => {
    return (
      <View
        style={[
          styles.group,
          { backgroundColor: theme.color.surface, borderColor: theme.color.border },
          style,
        ]}
      >
        {children}
      </View>
    );
  },
);

BuilderInsetGroup.displayName = 'BuilderInsetGroup';

const styles = StyleSheet.create({
  group: {
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    padding: DsSpace.md,
  },
});
