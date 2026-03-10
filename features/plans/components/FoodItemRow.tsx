import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';

import { type TranslationKey } from '@/localization';

type FoodItemRowProps = {
  name: string;
  quantity: string;
  notes: string;
  calories?: number | null;
  carbs?: number | null;
  proteins?: number | null;
  fats?: number | null;
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
  t: (key: TranslationKey) => string;
};

export const FoodItemRow = React.memo(({
  name,
  quantity,
  notes,
  calories,
  carbs,
  proteins,
  fats,
  palette,
  theme,
  isLast,
  onRemove,
  isSortMode,
  onMoveUp,
  onMoveDown,
  isFirstInList,
  isLastInList,
  t,
}: FoodItemRowProps) => {
  return (
    <View style={[styles.itemRow, !isLast && { borderBottomWidth: 1, borderBottomColor: theme.color.border }]}>
      {isSortMode && (
        <View style={styles.sortControls}>
          <Pressable onPress={onMoveUp} disabled={isFirstInList}>
            <IconSymbol name="chevron.up" size={16} color={isFirstInList ? theme.color.textSecondary : palette.tint} />
          </Pressable>
          <Pressable onPress={onMoveDown} disabled={isLastInList}>
            <IconSymbol name="chevron.down" size={16} color={isLastInList ? theme.color.textSecondary : palette.tint} />
          </Pressable>
        </View>
      )}
      <View style={styles.itemInfo}>
        <Text style={[styles.itemName, { color: palette.text }]}>{name}</Text>
        
        {/* Only show metadata if at least one value exists or if there's no note (to show dash) */}
        {(quantity || calories != null || carbs || proteins || fats || !notes) && (
          <View style={styles.itemMetaWrap}>
            {(quantity || calories != null || (!carbs && !proteins && !fats && !notes)) && (
              <Text style={[styles.itemMeta, { color: palette.icon }]}>
                {quantity ? `${quantity}g` : (calories == null ? '-' : '')}
                {quantity && calories != null ? ' • ' : ''}
                {calories != null ? `${calories} kcal` : ''}
              </Text>
            )}
            {(carbs || proteins || fats) ? (
              <Text style={[styles.itemMeta, { color: palette.icon, marginTop: 2 }]}>
                {carbs ?? 0}g C • {proteins ?? 0}g P • {fats ?? 0}g {t('common.nutrition.fats_initial')}
              </Text>
            ) : null}
          </View>
        )}

        {notes ? (
          <Text style={[styles.itemMeta, { color: palette.icon, marginTop: (quantity || calories != null || carbs || proteins || fats) ? 4 : 2 }]}>
            {(quantity || calories != null || carbs || proteins || fats) ? '• ' : ''}{notes}
          </Text>
        ) : null}
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
  itemMetaWrap: { flexDirection: 'column' },
  itemMeta: { ...DsTypography.caption },
  removeBtnWrapper: { 
    padding: DsSpace.xs, 
    justifyContent: 'center', 
    alignItems: 'center',
  },
});
