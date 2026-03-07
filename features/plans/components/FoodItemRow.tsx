import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';

type FoodItemRowProps = {
  name: string;
  quantity: string;
  notes: string;
  palette: {
    text: string;
    icon: string;
    tint: string;
  };
  theme: DsTheme;
  isLast?: boolean;
  onRemove: () => void;
  isSortMode?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isFirstInList?: boolean;
  isLastInList?: boolean;
};

export const FoodItemRow = React.memo(({
  name,
  quantity,
  notes,
  palette,
  theme,
  isLast,
  onRemove,
  isSortMode,
  onMoveUp,
  onMoveDown,
  isFirstInList,
  isLastInList,
}: FoodItemRowProps) => {
  return (
    <View style={[styles.itemRow, !isLast && { borderBottomWidth: 1, borderBottomColor: theme.color.border }]}>
      {isSortMode && (
        <View style={styles.sortControls}>
          <Pressable onPress={onMoveUp} disabled={isFirstInList}>
            <IconSymbol name="chevron.up" size={16} color={isFirstInList ? theme.color.textSecondaryMuted : palette.tint} />
          </Pressable>
          <Pressable onPress={onMoveDown} disabled={isLastInList}>
            <IconSymbol name="chevron.down" size={16} color={isLastInList ? theme.color.textSecondaryMuted : palette.tint} />
          </Pressable>
        </View>
      )}
      <View style={styles.itemInfo}>
        <Text style={[styles.itemName, { color: palette.text }]}>{name}</Text>
        <View style={styles.itemMetaRow}>
          {quantity ? (
            <Text style={[styles.itemMeta, { color: palette.icon }]}>{quantity}</Text>
          ) : null}
          {notes ? (
            <Text style={[styles.itemMeta, { color: palette.icon, marginLeft: 8 }]}>• {notes}</Text>
          ) : null}
        </View>
      </View>
      {!isSortMode && (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name}`}
          hitSlop={8}
          style={styles.removeBtnWrapper}
        >
          <IconSymbol name="minus.circle" size={20} color={palette.icon} />
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: DsSpace.md,
    gap: DsSpace.sm,
  },
  sortControls: {
    flexDirection: 'column',
    gap: 4,
    marginRight: 4,
  },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { ...DsTypography.body, fontWeight: '600' },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center' },
  itemMeta: { ...DsTypography.caption },
  removeBtnWrapper: { 
    padding: DsSpace.xs, 
    justifyContent: 'center', 
    alignItems: 'center',
  },
});
