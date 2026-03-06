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
 * Refs: D-100, D-134, FR-105, FR-122, FR-210, FR-224, FR-225
 *       BR-206, BR-214, BR-268, BR-283
 */
import { useMemo, useState } from 'react';
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

import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import {
  DsRadius,
  DsSpace,
  DsTypography,
  getDsTheme,
  type DsTheme,
} from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

type AssignmentStatus = 'active' | 'pending';

type StudentRow = {
  id: string;
  displayName: string;
  specialty: 'nutritionist' | 'fitness_coach';
  assignmentStatus: AssignmentStatus;
};

type FilterKind = 'all' | 'active' | 'pending';
type TFn = ReturnType<typeof useTranslation>['t'];

const STUB_STUDENTS: StudentRow[] = [];

export default function ProfessionalStudentsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');

  const visible = useMemo(
    () =>
      STUB_STUDENTS.filter((s) => {
        const matchesFilter =
          filter === 'all' ||
          (filter === 'active' && s.assignmentStatus === 'active') ||
          (filter === 'pending' && s.assignmentStatus === 'pending');

        const query = search.trim().toLowerCase();
        const matchesSearch = !query || s.displayName.toLowerCase().includes(query);

        return matchesFilter && matchesSearch;
      }),
    [filter, search]
  );

  const isLoading = false;

  return (
    <DsScreen
      scheme={scheme}
      scrollable={false}
      testID="pro.students.screen"
      contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('pro.students.title'), headerShown: false }} />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner') as string}
          testID="pro.students.offlineBanner"
        />
      ) : null}

      <DsCard scheme={scheme} style={styles.searchCard} testID="pro.students.searchCard">
        <TextInput
          style={[
            styles.searchInput,
            {
              borderColor: theme.color.border,
              color: theme.color.textPrimary,
              backgroundColor: theme.color.surfaceMuted,
            },
          ]}
          placeholder={t('pro.students.search.placeholder') as string}
          placeholderTextColor={theme.color.textSecondary}
          value={search}
          onChangeText={setSearch}
          testID="pro.students.search"
          accessibilityLabel={t('pro.students.search.placeholder') as string}
        />

        <FilterChips filter={filter} onFilter={setFilter} theme={theme} t={t} />
      </DsCard>

      <DsCard scheme={scheme} style={styles.listCard} testID="pro.students.listCard">
        {isLoading ? (
          <ActivityIndicator
            style={styles.centered}
            testID="pro.students.loading"
            accessibilityLabel={t('a11y.loading.default') as string}
            color={theme.color.accentPrimary}
          />
        ) : (
          <FlatList
            data={visible}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <StudentRowItem
                student={item}
                theme={theme}
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
                style={[styles.emptyText, { color: theme.color.textSecondary }]}
                testID="pro.students.empty">
                {t('pro.students.empty')}
              </Text>
            }
            contentContainerStyle={styles.listContent}
          />
        )}
      </DsCard>
    </DsScreen>
  );
}

function FilterChips({
  filter,
  onFilter,
  theme,
  t,
}: {
  filter: FilterKind;
  onFilter: (f: FilterKind) => void;
  theme: DsTheme;
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
                backgroundColor: isSelected ? theme.color.accentPrimary : theme.color.surface,
                borderColor: isSelected ? theme.color.accentPrimary : theme.color.border,
              },
            ]}
            testID={`pro.students.filter.${chip.kind}`}>
            <Text
              style={[
                styles.chipText,
                { color: isSelected ? theme.color.onAccent : theme.color.textPrimary },
              ]}>
              {chip.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function StudentRowItem({
  student,
  theme,
  t,
  onPress,
}: {
  student: StudentRow;
  theme: DsTheme;
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

  const statusColor =
    student.assignmentStatus === 'active' ? theme.color.success : theme.color.textSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={(t('a11y.student_row') as string)
        .replace('{name}', student.displayName)
        .replace('{specialty}', specialtyLabel as string)
        .replace('{status}', statusLabel as string)}
      onPress={onPress}
      style={[styles.row, { borderColor: theme.color.border }]}
      testID={`pro.students.row.${student.id}`}>
      <View style={styles.rowMain}>
        <Text style={[styles.studentName, { color: theme.color.textPrimary }]}>
          {student.displayName}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.color.textSecondary }]}>{specialtyLabel}</Text>
      </View>
      <Text style={[styles.badge, { color: statusColor }]}>{statusLabel}</Text>
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
  searchCard: {
    gap: DsSpace.md,
  },
  searchInput: {
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.sm,
  },
  chipRow: {
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  chip: {
    borderRadius: DsRadius.pill,
    borderWidth: 1,
    minHeight: 38,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  chipText: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  listCard: {
    flex: 1,
    padding: DsSpace.md,
  },
  listContent: {
    paddingBottom: DsSpace.sm,
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: DsSpace.md,
    justifyContent: 'space-between',
    paddingHorizontal: DsSpace.xs,
    paddingVertical: DsSpace.md,
  },
  rowMain: {
    flex: 1,
    gap: 2,
  },
  studentName: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
  rowMeta: {
    ...DsTypography.caption,
  },
  badge: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  emptyText: {
    ...DsTypography.body,
    padding: DsSpace.xxl,
    textAlign: 'center',
  },
  centered: {
    marginVertical: DsSpace.xxl,
  },
});
