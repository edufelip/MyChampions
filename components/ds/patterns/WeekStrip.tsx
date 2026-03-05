import { StyleSheet, Text, View } from 'react-native';

import {
  DsRadius,
  DsShadow,
  DsSpace,
  DsTypography,
  type DsColorScheme,
  getDsTheme,
} from '@/constants/design-system';

export type WeekStripItem = {
  id: string;
  dayLabel: string;
  dayNumber: string;
  isActive: boolean;
};

type WeekStripProps = {
  scheme: DsColorScheme;
  items: WeekStripItem[];
};

export function WeekStrip({ scheme, items }: WeekStripProps) {
  const theme = getDsTheme(scheme);

  return (
    <View style={[styles.wrap, DsShadow.soft, { backgroundColor: theme.color.surface }]}> 
      {items.map((item) => (
        <View
          key={item.id}
          style={[
            styles.item,
            item.isActive
              ? { backgroundColor: theme.color.accentPrimary, width: 52, height: 64 }
              : { width: 44, height: 56 },
          ]}>
          <Text style={[styles.dayLabel, { color: item.isActive ? theme.color.onAccent : theme.color.textSecondary }]}>
            {item.dayLabel}
          </Text>
          <Text style={[styles.dayNumber, { color: item.isActive ? theme.color.onAccent : theme.color.textPrimary }]}>
            {item.dayNumber}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: DsRadius.pill,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: DsSpace.xs,
    paddingVertical: DsSpace.xs,
  },
  item: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    justifyContent: 'center',
  },
  dayLabel: {
    ...DsTypography.caption,
    fontWeight: '600',
  },
  dayNumber: {
    ...DsTypography.body,
    fontWeight: '700',
  },
});
