import React, { useCallback } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import type { TrainingSession, TrainingSessionItem } from '@/features/plans/plan-builder.logic';
import { useExerciseThumbnail } from '@/features/plans/use-exercise-thumbnail';

type SessionCardProps = {
  session: TrainingSession;
  /** 0-based index of this session in the list — used for move-up/down bounds. */
  sessionIndex: number;
  /** Total number of sessions — used for move-down bound check. */
  totalSessions: number;
  palette: {
    text: string;
    icon: string;
    tint: string;
    danger: string;
  };
  theme: DsTheme;
  t: (key: string) => string;
  tr: (pro: string, student: string) => string;
  /**
   * Stable parent callbacks — SessionCard binds session.id internally so that
   * per-item callbacks passed to SessionItemRow never change reference between
   * renders, preserving React.memo's shallow-equality bail-out.
   */
  onRemoveSession: (sessionId: string) => void;
  onAddItem: (sessionId: string) => void;
  onRemoveItem: (sessionId: string, itemId: string) => void;
  isSortMode?: boolean;
  isInteractionLocked?: boolean;
  onMoveSession?: (index: number, direction: 'up' | 'down') => void;
  onMoveItem?: (sessionId: string, itemId: string, direction: 'up' | 'down') => void;
};

// ─── SessionItemRow ───────────────────────────────────────────────────────────
// Extracted so hooks (useExerciseThumbnail) can be called per item, not inside map.

type SessionItemRowProps = {
  item: TrainingSessionItem;
  index: number;
  totalItems: number;
  palette: { text: string; icon: string; tint: string; danger: string };
  theme: DsTheme;
  tr: (pro: string, student: string) => string;
  isSortMode?: boolean;
  isInteractionLocked?: boolean;
  onRemoveItem: (itemId: string) => void;
  onMoveItemUp?: (itemId: string) => void;
  onMoveItemDown?: (itemId: string) => void;
};

const SessionItemRow = React.memo(function SessionItemRow({
  item,
  index,
  totalItems,
  palette,
  theme,
  tr,
  isSortMode,
  isInteractionLocked,
  onRemoveItem,
  onMoveItemUp,
  onMoveItemDown,
}: SessionItemRowProps) {
  // Re-fetch a fresh thumbnail URL from exercise service whenever exerciseId changes.
  // Pre-signed URLs expire after 48 h — only the stable exercise id is stored.
  const thumbnailUrl = useExerciseThumbnail(item.exerciseId ?? item.ymoveId);

  return (
    <View
      style={[
        styles.itemRow,
        index < totalItems - 1 && { borderBottomWidth: 1, borderBottomColor: theme.color.border },
      ]}
    >
      {isSortMode && (
        <View style={styles.itemSortControls}>
          <Pressable onPress={() => onMoveItemUp?.(item.id)} disabled={isInteractionLocked || index === 0}>
            <IconSymbol name="chevron.up" size={16} color={index === 0 ? theme.color.textSecondary : palette.tint} />
          </Pressable>
          <Pressable onPress={() => onMoveItemDown?.(item.id)} disabled={isInteractionLocked || index === totalItems - 1}>
            <IconSymbol name="chevron.down" size={16} color={index === totalItems - 1 ? theme.color.textSecondary : palette.tint} />
          </Pressable>
        </View>
      )}
      {thumbnailUrl ? (
        <Image source={{ uri: thumbnailUrl }} style={styles.thumbnail} />
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
          disabled={isInteractionLocked}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.name}`}
          hitSlop={8}
          style={styles.removeBtnWrapper}
        >
          <IconSymbol name="minus.circle" size={20} color={palette.icon} />
        </Pressable>
      )}
    </View>
  );
});

// ─── SessionCard ──────────────────────────────────────────────────────────────

export const SessionCard = React.memo(({
  session,
  sessionIndex,
  totalSessions,
  palette,
  theme,
  t,
  tr,
  onRemoveSession,
  onAddItem,
  onRemoveItem,
  isSortMode,
  isInteractionLocked,
  onMoveSession,
  onMoveItem,
}: SessionCardProps) => {
  const { id: sessionId } = session;
  const isFirst = sessionIndex === 0;
  const isLast = sessionIndex === totalSessions - 1;

  // Bind session.id here — stable references so SessionItemRow memo is preserved.
  const handleRemoveSession = useCallback(() => onRemoveSession(sessionId), [onRemoveSession, sessionId]);
  const handleAddItem = useCallback(() => onAddItem(sessionId), [onAddItem, sessionId]);
  const handleRemoveItem = useCallback((itemId: string) => onRemoveItem(sessionId, itemId), [onRemoveItem, sessionId]);
  const handleMoveUp = useCallback(() => onMoveSession?.(sessionIndex, 'up'), [onMoveSession, sessionIndex]);
  const handleMoveDown = useCallback(() => onMoveSession?.(sessionIndex, 'down'), [onMoveSession, sessionIndex]);
  const handleMoveItemUp = useCallback((itemId: string) => onMoveItem?.(sessionId, itemId, 'up'), [onMoveItem, sessionId]);
  const handleMoveItemDown = useCallback((itemId: string) => onMoveItem?.(sessionId, itemId, 'down'), [onMoveItem, sessionId]);

  return (
    <View style={[styles.sessionCard, { backgroundColor: theme.color.surface }]}>
      {/* Session header */}
      <View style={styles.sessionHeader}>
        {isSortMode && (
          <View style={styles.sortControls}>
            <Pressable onPress={handleMoveUp} disabled={isInteractionLocked || isFirst} style={(isInteractionLocked || isFirst) && styles.disabled}>
              <IconSymbol name="chevron.up" size={20} color={isFirst ? theme.color.textSecondary : palette.tint} />
            </Pressable>
            <Pressable onPress={handleMoveDown} disabled={isInteractionLocked || isLast} style={(isInteractionLocked || isLast) && styles.disabled}>
              <IconSymbol name="chevron.down" size={20} color={isLast ? theme.color.textSecondary : palette.tint} />
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
            onPress={handleRemoveSession}
            disabled={isInteractionLocked}
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
          <SessionItemRow
            key={item.id}
            item={item}
            index={index}
            totalItems={session.items.length}
            palette={palette}
            theme={theme}
            tr={tr}
            isSortMode={isSortMode}
            isInteractionLocked={isInteractionLocked}
            onRemoveItem={handleRemoveItem}
            onMoveItemUp={handleMoveItemUp}
            onMoveItemDown={handleMoveItemDown}
          />
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
          onPress={handleAddItem}
          disabled={isInteractionLocked}
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
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.xs,
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
    paddingVertical: DsSpace.xs,
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
