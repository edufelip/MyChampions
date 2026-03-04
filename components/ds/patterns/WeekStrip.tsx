import { StyleSheet, Text, View } from 'react-native';

import {
  DsRadius,
  DsShadow,
  DsSpace,
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
        <View key={item.id} style={item.isActive ? styles.itemActive : styles.item}>
          <Text style={item.isActive ? styles.dayLabelActive : styles.dayLabel}>{item.dayLabel}</Text>
          <Text style={item.isActive ? styles.dayNumberActive : styles.dayNumber}>{item.dayNumber}</Text>
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
    height: 56,
    justifyContent: 'center',
    width: 44,
  },
  itemActive: {
    alignItems: 'center',
    backgroundColor: '#ff7b72',
    borderRadius: DsRadius.pill,
    height: 64,
    justifyContent: 'center',
    width: 52,
  },
  dayLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  dayLabelActive: {
    color: '#ffffffcc',
    fontSize: 11,
    fontWeight: '600',
  },
  dayNumber: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },
  dayNumberActive: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
