/**
 * SC-204 / SC-205 Professional Pending Connection Queue
 * Route: /professional/pending
 *
 * Surfaces: pending connection list, confirm (accept), deny (endConnection),
 * search/filter (BL-004 / D-070), bulk deny.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useMemo, useState, type ComponentProps, type ComponentType } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsRadius, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import {
  buildInvitePendingBulkDenied,
  buildInvitePendingConfirmed,
  buildInvitePendingDenied,
} from '@/features/analytics/analytics.logic';
import { useAnalytics } from '@/features/analytics/use-analytics';
import { useAuthSession } from '@/features/auth/auth-session';
import { useConnections } from '@/features/connections/use-connections';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { resolveLatestSyncTimestamp } from '@/features/offline/sync-timestamps.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation, type TranslationKey } from '@/localization';
import type { ConnectionRecord } from '@/features/connections/connection.logic';

// react-native-web's Pressable does not natively map Space/Enter to onPress
// for accessibilityRole="checkbox" (only accessibilityRole="button" gets that
// treatment), so the row-selection checkbox below needs its own keydown
// handling — this mirrors the pattern already used in app/auth/accept-terms.tsx.
type WebKeyboardEvent = { key?: string; repeat?: boolean; preventDefault?: () => void };
type KeyboardPressableProps = ComponentProps<typeof Pressable> & {
  onKeyDown?: (event: WebKeyboardEvent) => void;
};
const KeyboardPressable = Pressable as ComponentType<KeyboardPressableProps>;

export default function ProfessionalPendingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { emitEvent } = useAnalytics();

  const { state, reload, confirmConnection, unbindConnection } = useConnections(
    Boolean(currentUser),
  );
  const networkStatus = useNetworkStatus();
  const lastSyncedAtIso = resolveLatestSyncTimestamp([
    state.kind === 'ready' ? state.lastSyncedAtIso : null,
  ]);
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDenying, setIsBulkDenying] = useState(false);

  const pendingConnections = useMemo<ConnectionRecord[]>(() => {
    if (state.kind !== 'ready') return [];
    return state.connections.filter((c) => c.status === 'pending_confirmation');
  }, [state]);

  const filteredPending = useMemo<ConnectionRecord[]>(() => {
    if (!searchQuery.trim()) return pendingConnections;
    const q = searchQuery.trim().toLowerCase();
    return pendingConnections.filter((c) => c.id.toLowerCase().includes(q));
  }, [pendingConnections, searchQuery]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const onAccept = useCallback(
    (connectionId: string) => {
      void confirmConnection(connectionId).then((err) => {
        if (!err) {
          emitEvent(buildInvitePendingConfirmed());
          return;
        }
        Alert.alert(t('common.error.generic'), t('common.error.retry'));
      });
    },
    [confirmConnection, emitEvent, t],
  );

  const onDeny = useCallback(
    (connectionId: string) => {
      void unbindConnection(connectionId).then((err) => {
        if (!err) {
          emitEvent(buildInvitePendingDenied());
          return;
        }
        Alert.alert(t('common.error.generic'), t('common.error.retry'));
      });
    },
    [emitEvent, t, unbindConnection],
  );

  const onBulkDeny = () => {
    if (selectedIds.size === 0) return;

    Alert.alert(t('pro.pending.bulk_deny.confirm_title'), t('pro.pending.bulk_deny.confirm_body'), [
      { text: t('relationship.unbind.confirm_no'), style: 'cancel' },
      {
        text: t('pro.pending.bulk_deny.cta'),
        style: 'destructive',
        onPress: async () => {
          setIsBulkDenying(true);
          const ids = Array.from(selectedIds);

          const results = await Promise.all(ids.map((id) => unbindConnection(id)));
          if (results.every((err) => !err)) {
            emitEvent(buildInvitePendingBulkDenied(ids.length));
          }

          setSelectedIds(new Set());
          setIsBulkDenying(false);
          reload();

          Alert.alert(t('pro.pending.bulk_deny.success'));
        },
      },
    ]);
  };

  return (
    <DsScreen
      scheme={scheme}
      contentWidth="content"
      testID="pro.pending.screen"
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: t('pro.pending.filter.label'), headerShown: false }} />

      <DsBackButton
        scheme={scheme}
        onPress={() => {
          if (router.canGoBack()) {
            router.back();
            return;
          }

          router.replace('/');
        }}
        accessibilityLabel={t('auth.role.cta_back')}
        style={styles.backButton}
        testID="pro.pending.backButton"
      />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner')}
          testID="pro.pending.offlineBanner"
        />
      ) : null}

      <DsCard scheme={scheme} style={styles.heroCard} testID="pro.pending.hero">
        <View style={[styles.heroIcon, { backgroundColor: theme.color.accentPrimarySoft }]}>
          <MaterialIcons color={theme.color.accentPrimary} name="person-add-alt-1" size={24} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={[styles.pageTitle, { color: theme.color.textPrimary }]}>
            {t('pro.pending.title')}
          </Text>
          <Text style={[styles.pageSubtitle, { color: theme.color.textSecondary }]}>
            {t('pro.pending.description')}
          </Text>
        </View>
        {state.kind === 'ready' ? (
          <View
            style={[styles.pendingCountPill, { backgroundColor: theme.color.accentPrimarySoft }]}
          >
            <Text style={[styles.pendingCountText, { color: theme.color.accentPrimary }]}>
              {(t('pro.pending.count')).replace(
                '{count}',
                String(pendingConnections.length),
              )}
            </Text>
          </View>
        ) : null}
      </DsCard>

      <DsCard scheme={scheme} style={styles.searchCard}>
        <TextInput
          accessibilityLabel={t('pro.pending.search.placeholder')}
          autoCorrect={false}
          onChangeText={setSearchQuery}
          placeholder={t('pro.pending.search.placeholder')}
          placeholderTextColor={theme.color.textSecondary}
          style={[
            styles.searchInput,
            {
              backgroundColor: theme.color.surfaceMuted,
              borderColor: theme.color.border,
              color: theme.color.textPrimary,
            },
          ]}
          testID="pro.pending.searchInput"
          value={searchQuery}
        />

        {selectedIds.size > 0 ? (
          <View style={styles.bulkBar}>
            <Text style={[styles.bulkCount, { color: theme.color.textPrimary }]}>
              {(t('a11y.selected_count')).replace('{count}', String(selectedIds.size))}
            </Text>
            <DsPillButton
              scheme={scheme}
              variant="secondary"
              disabled={isBulkDenying || isWriteLocked}
              loading={isBulkDenying}
              onPress={onBulkDeny}
              label={t('pro.pending.bulk_deny.cta')}
              fullWidth={false}
              style={styles.bulkButton}
              testID="pro.pending.bulkDenyButton"
            />
          </View>
        ) : null}
      </DsCard>

      <DsCard scheme={scheme} style={styles.listCard}>
        {state.kind === 'loading' ? (
          <ActivityIndicator
            style={styles.centered}
            testID="pro.pending.loading"
            accessibilityLabel={t('a11y.loading.default')}
            color={theme.color.accentPrimary}
          />
        ) : state.kind === 'error' ? (
          <View style={styles.centered}>
            <Text style={[styles.bodyText, { color: theme.color.textPrimary }]}>
              {t('pro.pending.error')}
            </Text>
            <Pressable accessibilityRole="button" onPress={reload} testID="pro.pending.retryButton">
              <Text style={[styles.link, { color: theme.color.accentPrimary }]}>
                {t('common.error.retry')}
              </Text>
            </Pressable>
          </View>
        ) : filteredPending.length === 0 ? (
          <View style={styles.centered}>
            <Text style={[styles.bodyText, { color: theme.color.textSecondary }]}>
              {t('pro.pending.empty')}
            </Text>
          </View>
        ) : (
          filteredPending.map((conn, i) => (
            <PendingRow
              key={conn.id}
              connection={conn}
              isSelected={selectedIds.has(conn.id)}
              onToggleSelect={toggleSelect}
              onAccept={onAccept}
              onDeny={onDeny}
              scheme={scheme}
              t={t}
              testIndex={i}
              isWriteLocked={isWriteLocked}
            />
          ))
        )}
      </DsCard>
    </DsScreen>
  );
}

function PendingRow({
  connection,
  isSelected,
  onToggleSelect,
  onAccept,
  onDeny,
  scheme,
  t,
  testIndex,
  isWriteLocked,
}: {
  connection: ConnectionRecord;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onAccept: (id: string) => void;
  onDeny: (id: string) => void;
  scheme: 'light' | 'dark';
  t: (key: TranslationKey) => string;
  testIndex: number;
  isWriteLocked: boolean;
}) {
  const theme = getDsTheme(scheme);

  const specialtyLabel =
    connection.specialty === 'nutritionist'
      ? t('pro.students.specialty.nutritionist')
      : t('pro.students.specialty.fitness_coach');
  const selectLabel = (t('pro.pending.row.select')).replace(
    '{specialty}',
    specialtyLabel,
  );

  const onCheckboxKeyDown = (event: WebKeyboardEvent) => {
    if (event.key !== ' ' && event.key !== 'Spacebar') {
      return;
    }
    event.preventDefault?.();
    if (event.repeat) {
      return;
    }
    onToggleSelect(connection.id);
  };

  return (
    // Non-interactive row container — selection, Accept, and Deny are sibling
    // interactive controls below rather than nested inside a row-level button,
    // so the row itself must not carry a button/pressable role (ET-106).
    <View
      style={[
        styles.row,
        {
          borderColor: isSelected ? theme.color.accentPrimary : theme.color.border,
          backgroundColor: isSelected ? theme.color.accentPrimarySoft : 'transparent',
        },
      ]}
      testID={`pro.pending.row.${testIndex}`}
    >
      <KeyboardPressable
        accessibilityLabel={selectLabel}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isSelected }}
        aria-checked={isSelected}
        hitSlop={12}
        onKeyDown={onCheckboxKeyDown}
        onPress={() => onToggleSelect(connection.id)}
        style={styles.checkboxHitArea}
        testID={`pro.pending.checkbox.${testIndex}`}
      >
        <View
          style={[
            styles.checkbox,
            { borderColor: isSelected ? theme.color.accentPrimary : theme.color.textSecondary },
          ]}
        >
          {isSelected ? (
            <View style={[styles.checkboxFill, { backgroundColor: theme.color.accentPrimary }]} />
          ) : null}
        </View>
      </KeyboardPressable>

      <View style={styles.rowInfo}>
        <Text style={[styles.rowSpecialty, { color: theme.color.textPrimary }]}>
          {specialtyLabel}
        </Text>
        <Text style={[styles.rowId, { color: theme.color.textSecondary }]} numberOfLines={1}>
          {connection.id}
        </Text>
      </View>

      <View style={styles.rowActions}>
        <DsPillButton
          scheme={scheme}
          disabled={isWriteLocked}
          onPress={() => onAccept(connection.id)}
          label={t('pro.pending.confirm.cta')}
          fullWidth={false}
          style={styles.actionButton}
          testID={`pro.pending.acceptButton.${testIndex}`}
        />
        <Pressable
          accessibilityRole="button"
          disabled={isWriteLocked}
          onPress={() => onDeny(connection.id)}
          style={[
            styles.denyButton,
            {
              borderColor: theme.color.danger,
              backgroundColor: isWriteLocked ? theme.color.surfaceMuted : theme.color.dangerSoft,
            },
          ]}
          testID={`pro.pending.denyButton.${testIndex}`}
        >
          <Text style={[styles.denyText, { color: theme.color.danger }]}>
            {t('pro.pending.deny.cta')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: DsSpace.lg,
    padding: DsSpace.lg,
    paddingBottom: DsSpace.xxl,
  },
  backButton: { marginBottom: -4 },
  heroCard: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  heroIcon: {
    alignItems: 'center',
    borderRadius: DsRadius.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  heroCopy: {
    flex: 1,
    gap: DsSpace.xxs,
  },
  pageTitle: {
    ...DsTypography.screenTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  pageSubtitle: {
    ...DsTypography.body,
  },
  pendingCountPill: {
    borderRadius: DsRadius.pill,
    paddingHorizontal: DsSpace.sm,
    paddingVertical: 6,
  },
  pendingCountText: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  searchCard: {
    gap: DsSpace.sm,
  },
  searchInput: {
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: DsSpace.md,
  },
  bulkBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: DsSpace.md,
    justifyContent: 'space-between',
  },
  bulkCount: {
    ...DsTypography.body,
    fontWeight: '700',
  },
  bulkButton: {
    minHeight: 42,
  },
  listCard: {
    gap: DsSpace.sm,
  },
  row: {
    alignItems: 'center',
    borderRadius: DsRadius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: DsSpace.sm,
    padding: DsSpace.sm,
  },
  checkboxHitArea: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  checkbox: {
    alignItems: 'center',
    borderRadius: 4,
    borderWidth: 1.5,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkboxFill: {
    borderRadius: 2,
    height: 12,
    width: 12,
  },
  rowInfo: {
    flex: 1,
    gap: 2,
  },
  rowSpecialty: {
    ...DsTypography.body,
    fontFamily: Fonts?.rounded ?? 'normal',
    fontWeight: '700',
  },
  rowId: {
    ...DsTypography.caption,
  },
  rowActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: DsSpace.xs,
  },
  actionButton: {
    minHeight: 36,
    paddingHorizontal: DsSpace.sm,
  },
  denyButton: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: DsSpace.md,
  },
  denyText: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  centered: {
    alignItems: 'center',
    gap: DsSpace.sm,
    paddingVertical: 32,
  },
  bodyText: {
    ...DsTypography.body,
  },
  link: {
    ...DsTypography.body,
    fontWeight: '700',
  },
});
