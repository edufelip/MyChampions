import React, { useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import type { TrainingSession } from '@/features/plans/plan-builder.logic';

type SessionCardProps = {
  session: TrainingSession;
  palette: {
    text: string;
    icon: string;
    tint: string;
    danger: string;
  };
  theme: DsTheme;
  t: (key: string) => string;
  tr: (pro: string, student: string) => string;
  onRemoveSession: () => void;
  onAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
  isSortMode?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onMoveItemUp?: (itemId: string) => void;
  onMoveItemDown?: (itemId: string) => void;
  isFirst?: boolean;
  isLast?: boolean;
};

export const SessionCard = React.memo(({
  session,
  palette,
  theme,
  t,
  tr,
  onRemoveSession,
  onAddItem,
  onRemoveItem,
  isSortMode,
  onMoveUp,
  onMoveDown,
  onMoveItemUp,
  onMoveItemDown,
  isFirst,
  isLast,
}: SessionCardProps) => {
  return (
    <View style={[styles.sessionCard, { backgroundColor: theme.color.surface }]}>
      {/* Session header */}
      <View style={styles.sessionHeader}>
        {isSortMode && (
          <View style={styles.sortControls}>
            <Pressable onPress={onMoveUp} disabled={isFirst} style={isFirst && styles.disabled}>
              <IconSymbol name="chevron.up" size={20} color={isFirst ? theme.color.textSecondaryMuted : palette.tint} />
            </Pressable>
            <Pressable onPress={onMoveDown} disabled={isLast} style={isLast && styles.disabled}>
              <IconSymbol name="chevron.down" size={20} color={isLast ? theme.color.textSecondaryMuted : palette.tint} />
            </Pressable>
          </View>
        )}
        <View style={styles.sessionHeaderTitle}>
          <Text style={[styles.sessionName, { color: palette.text }]}>{session.name}</Text>
          {session.notes ? (
            <Text style={[styles.sessionNotes, { color: palette.icon }]}>{session.notes}</Text>
          ) : null}
        </View>
        {!isSortMode && (
          <Pressable
            onPress={onRemoveSession}
            accessibilityRole="button"
            accessibilityLabel={`Remove session ${session.name}`}
            hitSlop={8}
            style={styles.removeBtnWrapper}
          >
            <IconSymbol name="minus.circle.fill" size={24} color={palette.danger} />
          </Pressable>
        )}
      </View>

      {/* Items */}
      <View style={styles.itemsList}>
        {session.items.map((item, index) => (
          <View 
            key={item.id} 
            style={[
              styles.itemRow, 
              index < session.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: theme.color.border }
            ]}
          >
            {isSortMode && (
              <View style={styles.itemSortControls}>
                <Pressable onPress={() => onMoveItemUp?.(item.id)} disabled={index === 0}>
                  <IconSymbol name="chevron.up" size={16} color={index === 0 ? theme.color.textSecondaryMuted : palette.tint} />
                </Pressable>
                <Pressable onPress={() => onMoveItemDown?.(item.id)} disabled={index === session.items.length - 1}>
                  <IconSymbol name="chevron.down" size={16} color={index === session.items.length - 1 ? theme.color.textSecondaryMuted : palette.tint} />
                </Pressable>
              </View>
            )}
            {item.thumbnailUrl ? (
              <Image source={{ uri: item.thumbnailUrl }} style={styles.thumbnail} />
            ) : (
              <View style={[styles.thumbnailPlaceholder, { backgroundColor: theme.color.surfaceMuted }]}>
                <Text style={{ fontSize: 18 }}>🏃</Text>
              </View>
            )}
            <View style={styles.itemInfo}>
              <Text style={[styles.itemName, { color: palette.text }]}>{item.name}</Text>
              <View style={styles.itemMetaRow}>
                {item.quantity ? (
                  <Text style={[styles.itemMeta, { color: palette.icon }]}>{item.quantity}</Text>
                ) : (
                  <Text style={[styles.itemMeta, { color: palette.icon, fontStyle: 'italic' }]}>
                    {tr('pro.plan.training.item.no_sets', 'student.plan.training.item.no_sets')}
                  </Text>
                )}
                {item.notes ? (
                  <Text style={[styles.itemMeta, { color: palette.icon, marginLeft: 8 }]}>• {item.notes}</Text>
                ) : null}
              </View>
            </View>
            {!isSortMode && (
              <Pressable
                onPress={() => onRemoveItem(item.id)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name}`}
                hitSlop={8}
                style={styles.removeBtnWrapper}
              >
                <IconSymbol name="minus.circle" size={20} color={palette.icon} />
              </Pressable>
            )}
          </View>
        ))}
        
        {session.items.length === 0 && (
          <View style={styles.emptyItemsContainer}>
            <Text style={[styles.emptyItemsText, { color: palette.icon }]}>
              {tr('pro.plan.session.no_exercises', 'student.plan.session.no_exercises')}
            </Text>
          </View>
        )}
      </View>

      {!isSortMode && (
        <Pressable
          style={styles.addItemBtn}
          onPress={onAddItem}
          accessibilityRole="button"
          accessibilityLabel={t('pro.plan.cta.add_item')}
        >
          <IconSymbol name="plus.circle.fill" size={18} color={palette.tint} />
          <Text style={[styles.addItemBtnText, { color: palette.tint }]}>
            {t('pro.plan.cta.add_item')}
          </Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  sessionCard: {
    borderRadius: DsRadius.lg,
    padding: DsSpace.md,
    gap: DsSpace.md,
    marginBottom: DsSpace.xs,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sessionHeader: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between',
    gap: DsSpace.sm,
  },
  sortControls: {
    flexDirection: 'column',
    gap: 4,
    marginRight: 4,
  },
  sessionHeaderTitle: { flex: 1, gap: 2 },
  sessionName: { 
    ...DsTypography.cardTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  sessionNotes: { 
    ...DsTypography.caption,
    opacity: 0.8,
  },
  itemsList: {
    borderRadius: DsRadius.md,
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: DsSpace.sm,
    gap: DsSpace.sm,
  },
  itemSortControls: {
    flexDirection: 'column',
    gap: 2,
    marginRight: 4,
  },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { ...DsTypography.body, fontWeight: '600' },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center' },
  itemMeta: { ...DsTypography.caption },
  emptyItemsContainer: {
    paddingVertical: DsSpace.sm,
    opacity: 0.5,
  },
  emptyItemsText: {
    ...DsTypography.caption,
    fontStyle: 'italic',
  },
  removeBtnWrapper: { 
    padding: DsSpace.xs, 
    justifyContent: 'center', 
    alignItems: 'center',
  },
  thumbnail: {
    width: 48,
    height: 48,
    borderRadius: DsRadius.md,
  },
  thumbnailPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: DsRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addItemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DsSpace.xs,
    paddingVertical: DsSpace.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.05)',
    marginTop: DsSpace.xxs,
  },
  addItemBtnText: {
    ...DsTypography.button,
    fontSize: 14,
  },
  disabled: {
    opacity: 0.3,
  },
});
