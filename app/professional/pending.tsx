/**
 * SC-204 / SC-205 Professional Pending Connection Queue
 * Route: /professional/pending
 *
 * Surfaces: pending connection list, confirm (accept), deny (endConnection),
 * search/filter (BL-004 / D-070), bulk deny.
 */
import { Stack } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useConnections } from '@/features/connections/use-connections';
import type { ConnectionRecord } from '@/features/connections/connection.logic';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation, type TranslationKey } from '@/localization';

export default function ProfessionalPendingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const { currentUser } = useAuthSession();

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  const { state, reload, confirmConnection, unbindConnection } = useConnections(Boolean(currentUser));

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDenying, setIsBulkDenying] = useState(false);

  // Only expose pending_confirmation records to professional queue
  const pendingConnections = useMemo<ConnectionRecord[]>(() => {
    if (state.kind !== 'ready') return [];
    return state.connections.filter((c) => c.status === 'pending_confirmation');
  }, [state]);

  // Apply search filter — professionals search by student UID substring in MVP
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
        if (err) {
          Alert.alert(t('common.error.generic'), t('common.error.retry'));
        }
      });
    },
    [confirmConnection, t]
  );

  const onDeny = useCallback(
    (connectionId: string) => {
      void unbindConnection(connectionId).then((err) => {
        if (err) {
          Alert.alert(t('common.error.generic'), t('common.error.retry'));
        }
      });
    },
    [unbindConnection, t]
  );

  const onBulkDeny = () => {
    if (selectedIds.size === 0) return;

    Alert.alert(
      t('pro.pending.bulk_deny.confirm_title'),
      t('pro.pending.bulk_deny.confirm_body'),
      [
        { text: t('relationship.unbind.confirm_no'), style: 'cancel' },
        {
          text: t('pro.pending.bulk_deny.cta'),
          style: 'destructive',
          onPress: async () => {
            setIsBulkDenying(true);
            const ids = Array.from(selectedIds);

            await Promise.allSettled(ids.map((id) => unbindConnection(id)));

            setSelectedIds(new Set());
            setIsBulkDenying(false);
            reload();

            Alert.alert(t('pro.pending.bulk_deny.success'));
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      testID="pro.pending.screen">
      <Stack.Screen options={{ title: t('pro.pending.filter.label'), headerShown: true }} />

      {/* Offline banner (BL-008) */}
      {offlineDisplay.showOfflineBanner ? (
        <View
          style={[styles.offlineBanner, { backgroundColor: '#b3261e22', borderColor: '#b3261e' }]}
          testID="pro.pending.offlineBanner">
          <Text style={[styles.offlineBannerText, { color: palette.text }]}>
            {t('offline.banner')}
          </Text>
        </View>
      ) : null}

      {/* ── Search bar ────────────────────────────────────────── */}
      <TextInput
        accessibilityLabel={t('pro.pending.search.placeholder')}
        autoCorrect={false}
        onChangeText={setSearchQuery}
        placeholder={t('pro.pending.search.placeholder')}
        placeholderTextColor={palette.icon}
        style={[
          styles.searchInput,
          { backgroundColor: palette.background, borderColor: palette.icon, color: palette.text },
        ]}
        testID="pro.pending.searchInput"
        value={searchQuery}
      />

      {/* ── Bulk deny bar ─────────────────────────────────────── */}
      {selectedIds.size > 0 ? (
        <View style={styles.bulkBar}>
          <Text style={[styles.bulkCount, { color: palette.text }]}>
            {(t('a11y.selected_count') as string).replace('{count}', String(selectedIds.size))}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isBulkDenying || isWriteLocked}
            onPress={onBulkDeny}
            style={[styles.bulkDenyButton, { borderColor: '#b3261e' }]}
            testID="pro.pending.bulkDenyButton">
            {isBulkDenying ? (
              <ActivityIndicator
                color="#b3261e"
                accessibilityLabel={t('a11y.loading.submitting') as string}
              />
            ) : (
              <Text style={[styles.bulkDenyText]}>{t('pro.pending.bulk_deny.cta')}</Text>
            )}
          </Pressable>
        </View>
      ) : null}

      {/* ── List ─────────────────────────────────────────────── */}
      {state.kind === 'loading' ? (
        <ActivityIndicator
          style={styles.centered}
          testID="pro.pending.loading"
          accessibilityLabel={t('a11y.loading.default') as string}
        />
      ) : state.kind === 'error' ? (
        <View style={styles.centered}>
          <Text style={[styles.bodyText, { color: palette.text }]}>
            {t('pro.pending.error')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={reload}
            testID="pro.pending.retryButton">
            <Text style={[styles.link, { color: palette.tint }]}>{t('common.error.retry')}</Text>
          </Pressable>
        </View>
      ) : filteredPending.length === 0 ? (
        <View style={styles.centered}>
          <Text style={[styles.bodyText, { color: palette.icon }]}>
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
            palette={palette}
            t={t}
            testIndex={i}
            isWriteLocked={isWriteLocked}
          />
        ))
      )}
    </ScrollView>
  );
}

// ─── Pending Row ──────────────────────────────────────────────────────────────

type Palette = (typeof Colors)['light'];

function PendingRow({
  connection,
  isSelected,
  onToggleSelect,
  onAccept,
  onDeny,
  palette,
  t,
  testIndex,
  isWriteLocked,
}: {
  connection: ConnectionRecord;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onAccept: (id: string) => void;
  onDeny: (id: string) => void;
  palette: Palette;
  t: (key: TranslationKey) => string;
  testIndex: number;
  isWriteLocked: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onToggleSelect(connection.id)}
      style={[
        styles.row,
        {
          borderColor: isSelected ? palette.tint : palette.icon,
          backgroundColor: isSelected ? `${palette.tint}18` : 'transparent',
        },
      ]}
      testID={`pro.pending.row.${testIndex}`}>
      {/* Selection indicator */}
      <View
        style={[
          styles.checkbox,
          { borderColor: isSelected ? palette.tint : palette.icon },
        ]}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isSelected }}>
        {isSelected ? <View style={[styles.checkboxFill, { backgroundColor: palette.tint }]} /> : null}
      </View>

      <View style={styles.rowInfo}>
        <Text style={[styles.rowSpecialty, { color: palette.text }]}>
          {connection.specialty === 'nutritionist' ? 'Nutritionist' : 'Fitness Coach'}
        </Text>
        <Text style={[styles.rowId, { color: palette.icon }]} numberOfLines={1}>
          {connection.id}
        </Text>
      </View>

      <View style={styles.rowActions}>
        <Pressable
          accessibilityRole="button"
          disabled={isWriteLocked}
          onPress={() => onAccept(connection.id)}
          style={[styles.actionButton, { backgroundColor: palette.tint, opacity: isWriteLocked ? 0.4 : 1 }]}
          testID={`pro.pending.acceptButton.${testIndex}`}>
          <Text style={styles.actionButtonText}>{t('pro.pending.confirm.cta')}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isWriteLocked}
          onPress={() => onDeny(connection.id)}
          style={[styles.actionButton, { backgroundColor: '#b3261e', opacity: isWriteLocked ? 0.4 : 1 }]}
          testID={`pro.pending.denyButton.${testIndex}`}>
          <Text style={styles.actionButtonText}>{t('pro.pending.deny.cta')}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
    gap: 12,
  },
  searchInput: {
    borderRadius: 10,
    borderWidth: 1.5,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  bulkBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  bulkCount: {
    fontSize: 14,
    fontWeight: '600',
  },
  bulkDenyButton: {
    borderRadius: 8,
    borderWidth: 1.5,
    minHeight: 36,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulkDenyText: {
    color: '#b3261e',
    fontWeight: '700',
    fontSize: 14,
  },
  row: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  checkbox: {
    borderRadius: 4,
    borderWidth: 1.5,
    height: 20,
    width: 20,
    alignItems: 'center',
    justifyContent: 'center',
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
    fontSize: 14,
    fontWeight: '700',
  },
  rowId: {
    fontSize: 12,
  },
  rowActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 12,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  centered: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 32,
  },
  bodyText: {
    fontSize: 15,
  },
  link: {
    fontSize: 15,
    fontWeight: '600',
  },
  offlineBanner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  offlineBannerText: {
    fontSize: 13,
    lineHeight: 18,
  },
});

// suppress unused import warning for Fonts
void Fonts;
