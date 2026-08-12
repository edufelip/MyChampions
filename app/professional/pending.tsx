/**
 * SC-204 / SC-205 Professional Pending Connection Queue
 * Route: /professional/pending
 *
 * Surfaces: pending connection list, confirm (accept), deny (endConnection),
 * search/filter (BL-004 / D-070), bulk deny.
 */
import { Stack, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
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
import type { ConnectionRecord } from '@/features/connections/connection.logic';
import { useConnections } from '@/features/connections/use-connections';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { resolveLatestSyncTimestamp } from '@/features/offline/sync-timestamps.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useWebDialogAccessibility } from '@/hooks/use-web-dialog-accessibility';
import { useTranslation, type TranslationKey } from '@/localization';

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
  const [isBulkDenyConfirmVisible, setIsBulkDenyConfirmVisible] = useState(false);
  const [bulkDenyFeedback, setBulkDenyFeedback] = useState<'success' | 'error' | null>(null);

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
    setBulkDenyFeedback(null);
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

  const closeBulkDenyConfirmation = useCallback(() => {
    if (isBulkDenying) return;
    setIsBulkDenyConfirmVisible(false);
  }, [isBulkDenying]);

  useWebDialogAccessibility({
    dialogTitleTestID: 'pro.pending.bulkDenyConfirm.title',
    isVisible: Platform.OS === 'web' && isBulkDenyConfirmVisible,
    onClose: closeBulkDenyConfirmation,
    testID: 'pro.pending.bulkDenyConfirm',
  });

  const executeBulkDeny = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) {
      closeBulkDenyConfirmation();
      return;
    }

    setIsBulkDenying(true);
    setBulkDenyFeedback(null);

    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          return await unbindConnection(id);
        } catch {
          return 'unknown';
        }
      }),
    );
    const hasError = results.some((err) => Boolean(err));

    if (hasError) {
      setIsBulkDenying(false);
      if (Platform.OS === 'web') {
        setBulkDenyFeedback('error');
      } else {
        Alert.alert(t('common.error.generic'), t('common.error.retry'));
      }
      return;
    }

    emitEvent(buildInvitePendingBulkDenied(ids.length));
    setSelectedIds(new Set());
    setIsBulkDenying(false);
    reload();

    if (Platform.OS === 'web') {
      setIsBulkDenyConfirmVisible(false);
      setBulkDenyFeedback('success');
    } else {
      Alert.alert(t('pro.pending.bulk_deny.success'));
    }
  }, [closeBulkDenyConfirmation, emitEvent, reload, selectedIds, t, unbindConnection]);

  const onBulkDeny = () => {
    if (selectedIds.size === 0) return;

    setBulkDenyFeedback(null);
    if (Platform.OS === 'web') {
      setIsBulkDenyConfirmVisible(true);
      return;
    }

    Alert.alert(t('pro.pending.bulk_deny.confirm_title'), t('pro.pending.bulk_deny.confirm_body'), [
      { text: t('relationship.unbind.confirm_no'), style: 'cancel' },
      {
        text: t('pro.pending.bulk_deny.cta'),
        style: 'destructive',
        onPress: () => void executeBulkDeny(),
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
        accessibilityLabel={t('auth.role.cta_back') as string}
        style={styles.backButton}
        testID="pro.pending.backButton"
      />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner') as string}
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
              {(t('pro.pending.count') as string).replace(
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
              {(t('a11y.selected_count') as string).replace('{count}', String(selectedIds.size))}
            </Text>
            <DsPillButton
              scheme={scheme}
              variant="secondary"
              disabled={isBulkDenying || isWriteLocked}
              loading={isBulkDenying}
              onPress={onBulkDeny}
              label={t('pro.pending.bulk_deny.cta') as string}
              fullWidth={false}
              style={styles.bulkButton}
              testID="pro.pending.bulkDenyButton"
            />
          </View>
        ) : null}
      </DsCard>

      {Platform.OS === 'web' && bulkDenyFeedback ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole={bulkDenyFeedback === 'error' ? 'alert' : undefined}
          style={[
            styles.bulkDenyFeedback,
            {
              backgroundColor:
                bulkDenyFeedback === 'success' ? theme.color.successSoft : theme.color.dangerSoft,
              borderColor:
                bulkDenyFeedback === 'success' ? theme.color.success : theme.color.danger,
            },
          ]}
          testID="pro.pending.bulkDenyResult"
        >
          <MaterialIcons
            color={bulkDenyFeedback === 'success' ? theme.color.success : theme.color.danger}
            name={bulkDenyFeedback === 'success' ? 'check-circle' : 'error-outline'}
            size={20}
          />
          <Text
            style={[
              styles.bulkDenyFeedbackText,
              { color: bulkDenyFeedback === 'success' ? theme.color.success : theme.color.danger },
            ]}
          >
            {bulkDenyFeedback === 'success'
              ? t('pro.pending.bulk_deny.success')
              : t('pro.pending.bulk_deny.error')}
          </Text>
        </View>
      ) : null}

      <DsCard scheme={scheme} style={styles.listCard}>
        {state.kind === 'loading' ? (
          <ActivityIndicator
            style={styles.centered}
            testID="pro.pending.loading"
            accessibilityLabel={t('a11y.loading.default') as string}
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

      {Platform.OS === 'web' && isBulkDenyConfirmVisible ? (
        <View style={[styles.bulkDenyOverlay, { backgroundColor: theme.color.overlaySoft }]}>
          <View
            accessibilityLabel={t('pro.pending.bulk_deny.confirm_title') as string}
            accessibilityViewIsModal
            style={[styles.bulkDenyModal, { backgroundColor: theme.color.surface }]}
            testID="pro.pending.bulkDenyConfirm"
          >
            <Text
              accessibilityRole="header"
              style={[styles.bulkDenyModalTitle, { color: theme.color.textPrimary }]}
              testID="pro.pending.bulkDenyConfirm.title"
            >
              {t('pro.pending.bulk_deny.confirm_title')}
            </Text>
            <Text style={[styles.bulkDenyModalBody, { color: theme.color.textSecondary }]}>
              {t('pro.pending.bulk_deny.confirm_body')}
            </Text>
            <Text style={[styles.bulkDenyModalCount, { color: theme.color.textPrimary }]}>
              {(t('a11y.selected_count') as string).replace('{count}', String(selectedIds.size))}
            </Text>
            {bulkDenyFeedback === 'error' ? (
              <Text
                accessibilityRole="alert"
                style={[styles.bulkDenyModalError, { color: theme.color.danger }]}
                testID="pro.pending.bulkDenyConfirm.error"
              >
                {t('pro.pending.bulk_deny.error')}
              </Text>
            ) : null}
            <View style={styles.bulkDenyModalActions}>
              <DsPillButton
                disabled={isBulkDenying}
                fullWidth={false}
                label={t('relationship.unbind.confirm_no') as string}
                onPress={closeBulkDenyConfirmation}
                scheme={scheme}
                testID="pro.pending.bulkDenyConfirm.cancel"
                variant="outline"
              />
              <DsPillButton
                contentColor={theme.color.surface}
                disabled={isBulkDenying}
                fullWidth={false}
                label={t('pro.pending.bulk_deny.cta') as string}
                loading={isBulkDenying}
                onPress={() => void executeBulkDeny()}
                scheme={scheme}
                style={{
                  backgroundColor: theme.color.danger,
                  borderColor: theme.color.danger,
                }}
                testID="pro.pending.bulkDenyConfirm.confirm"
              />
            </View>
          </View>
        </View>
      ) : null}
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

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onToggleSelect(connection.id)}
      style={[
        styles.row,
        {
          borderColor: isSelected ? theme.color.accentPrimary : theme.color.border,
          backgroundColor: isSelected ? theme.color.accentPrimarySoft : 'transparent',
        },
      ]}
      testID={`pro.pending.row.${testIndex}`}
    >
      <View
        style={[
          styles.checkbox,
          { borderColor: isSelected ? theme.color.accentPrimary : theme.color.textSecondary },
        ]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isSelected }}
      >
        {isSelected ? (
          <View style={[styles.checkboxFill, { backgroundColor: theme.color.accentPrimary }]} />
        ) : null}
      </View>

      <View style={styles.rowInfo}>
        <Text style={[styles.rowSpecialty, { color: theme.color.textPrimary }]}>
          {connection.specialty === 'nutritionist'
            ? t('pro.students.specialty.nutritionist')
            : t('pro.students.specialty.fitness_coach')}
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
          label={t('pro.pending.confirm.cta') as string}
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
    </Pressable>
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
  bulkDenyFeedback: {
    alignItems: 'center',
    borderRadius: DsRadius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: DsSpace.sm,
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.sm,
  },
  bulkDenyFeedbackText: {
    ...DsTypography.body,
    flex: 1,
    fontWeight: '700',
  },
  bulkDenyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: DsSpace.lg,
    zIndex: 100,
  },
  bulkDenyModal: {
    borderRadius: DsRadius.xl,
    gap: DsSpace.md,
    maxWidth: 520,
    padding: DsSpace.lg,
    width: '100%',
  },
  bulkDenyModalTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  bulkDenyModalBody: {
    ...DsTypography.body,
  },
  bulkDenyModalCount: {
    ...DsTypography.body,
    fontWeight: '700',
  },
  bulkDenyModalError: {
    ...DsTypography.body,
    fontWeight: '700',
  },
  bulkDenyModalActions: {
    alignItems: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DsSpace.sm,
    justifyContent: 'flex-end',
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
