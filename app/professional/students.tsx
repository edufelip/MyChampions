/**
 * SC-205 Student Roster
 * Route: /professional/students
 *
 * Lists all students linked to the professional with:
 *  - Search / filter (active | pending | all)
 *  - Assignment status badge per row
 *  - Tap to open student profile
 *
 * Data wiring is deferred — the hook returns a stub empty list until
 * Data Connect professional roster endpoint is wired.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-205-student-roster.md
 * Refs: D-100, FR-105, FR-122, FR-210, FR-224, FR-225
 *       BR-206, BR-214, BR-268, BR-283
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type AssignmentStatus = 'active' | 'pending';

type StudentRow = {
  id: string;
  displayName: string;
  specialty: 'nutritionist' | 'fitness_coach';
  assignmentStatus: AssignmentStatus;
};

type FilterKind = 'all' | 'active' | 'pending';

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

// Stub: real data comes from professional-source once Data Connect endpoint is wired
const STUB_STUDENTS: StudentRow[] = [];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfessionalStudentsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const router = useRouter();

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');

  // Apply search + filter to stub list
  const visible = STUB_STUDENTS.filter((s) => {
    const matchesFilter =
      filter === 'all' ||
      (filter === 'active' && s.assignmentStatus === 'active') ||
      (filter === 'pending' && s.assignmentStatus === 'pending');

    const matchesSearch =
      !search.trim() ||
      s.displayName.toLowerCase().includes(search.trim().toLowerCase());

    return matchesFilter && matchesSearch;
  });

  const isLoading = false; // replaced by real hook state when wired

  return (
    <View
      style={[styles.container, { backgroundColor: palette.background }]}
      testID="pro.students.screen">
      <Stack.Screen options={{ title: t('pro.students.title'), headerShown: true }} />

      {/* Offline banner (BL-008) */}
      {offlineDisplay.showOfflineBanner ? (
        <View
          style={[styles.offlineBanner, { backgroundColor: '#b3261e22', borderColor: '#b3261e' }]}
          testID="pro.students.offlineBanner">
          <Text style={[styles.offlineBannerText, { color: palette.text }]}>
            {t('offline.banner')}
          </Text>
        </View>
      ) : null}

      {/* Search bar */}
      <View style={[styles.searchBar, { borderColor: palette.icon + '66' }]}>
        <TextInput
          style={[styles.searchInput, { color: palette.text }]}
          placeholder={t('pro.students.search.placeholder') as string}
          placeholderTextColor={palette.icon}
          value={search}
          onChangeText={setSearch}
          testID="pro.students.search"
          accessibilityLabel={t('pro.students.search.placeholder') as string}
        />
      </View>

      {/* Filter chips */}
      <FilterChips filter={filter} onFilter={setFilter} palette={palette} t={t} />

      {/* List */}
      {isLoading ? (
        <ActivityIndicator
          style={styles.centered}
          testID="pro.students.loading"
          accessibilityLabel={t('a11y.loading.default') as string}
        />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <StudentRowItem
              student={item}
              palette={palette}
              t={t}
              onPress={() =>
                router.push({
                  pathname: '/professional/student-profile',
                  params: { studentId: item.id },
                })
              }
            />
          )}
          ListEmptyComponent={
            <Text
              style={[styles.emptyText, { color: palette.icon }]}
              testID="pro.students.empty">
              {t('pro.students.empty')}
            </Text>
          }
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

// ─── Filter Chips ─────────────────────────────────────────────────────────────

function FilterChips({
  filter,
  onFilter,
  palette,
  t,
}: {
  filter: FilterKind;
  onFilter: (f: FilterKind) => void;
  palette: Palette;
  t: TFn;
}) {
  const chips: { kind: FilterKind; label: string }[] = [
    { kind: 'all', label: t('pro.students.filter.all') as string },
    { kind: 'active', label: t('pro.students.filter.active') as string },
    { kind: 'pending', label: t('pro.students.filter.pending') as string },
  ];

  return (
    <View style={styles.chipRow}>
      {chips.map((chip) => {
        const isSelected = chip.kind === filter;
        return (
          <Pressable
            key={chip.kind}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onFilter(chip.kind)}
            style={[
              styles.chip,
              {
                backgroundColor: isSelected ? palette.tint : 'transparent',
                borderColor: palette.tint,
              },
            ]}
            testID={`pro.students.filter.${chip.kind}`}>
            <Text
              style={[
                styles.chipText,
                { color: isSelected ? '#fff' : palette.tint },
              ]}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Student Row ──────────────────────────────────────────────────────────────

function StudentRowItem({
  student,
  palette,
  t,
  onPress,
}: {
  student: StudentRow;
  palette: Palette;
  t: TFn;
  onPress: () => void;
}) {
  const specialtyLabel =
    student.specialty === 'nutritionist'
      ? t('pro.students.specialty.nutritionist')
      : t('pro.students.specialty.fitness_coach');

  const statusLabel =
    student.assignmentStatus === 'active'
      ? t('pro.student_profile.assignment.active')
      : t('pro.student_profile.assignment.pending');

  const statusColor = student.assignmentStatus === 'active' ? '#16a34a' : palette.icon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        (t('a11y.student_row') as string)
          .replace('{name}', student.displayName)
          .replace('{specialty}', specialtyLabel as string)
          .replace('{status}', statusLabel as string)
      }
      onPress={onPress}
      style={[styles.row, { borderColor: palette.icon + '33' }]}
      testID={`pro.students.row.${student.id}`}>
      <View style={styles.rowMain}>
        <Text style={[styles.studentName, { color: palette.text }]}>
          {student.displayName}
        </Text>
        <Text style={[styles.rowMeta, { color: palette.icon }]}>{specialtyLabel}</Text>
      </View>
      <Text style={[styles.badge, { color: statusColor }]}>{statusLabel}</Text>
    </Pressable>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: {
    borderRadius: 10,
    borderWidth: 1,
    margin: 16,
    marginBottom: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: { fontSize: 15, minHeight: 36 },
  chipRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chip: {
    borderRadius: 20,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  row: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  rowMain: { flex: 1, gap: 2 },
  studentName: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: { fontSize: 13 },
  badge: { fontSize: 12, fontWeight: '600' },
  emptyText: { fontSize: 14, padding: 32, textAlign: 'center' },
  centered: { marginTop: 32 },
  offlineBanner: {
    borderRadius: 8,
    borderWidth: 1,
    margin: 16,
    marginBottom: 0,
    padding: 10,
  },
  offlineBannerText: { fontSize: 13, lineHeight: 18 },
});
