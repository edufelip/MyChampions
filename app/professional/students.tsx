/**
 * SC-205 Student Roster
 * Route: /professional/students
 *
 * Lists all students linked to the professional with:
 *  - Search / filter (active | pending | all)
 *  - Assignment status badge per row
 *  - Tap to open student profile
 *  - Multi-select mode for bulk assignment
 *
 * Data wiring is server-backed via professional-source.
 *
 * Docs: docs/screens/v2/SC-205-student-roster.md
 * Refs: D-100, D-134, FR-105, FR-122, FR-210, FR-224, FR-225
 *       BR-206, BR-214, BR-268, BR-283
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { PlanPickerModal } from '@/components/ds/patterns/PlanPickerModal';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import {
  DsRadius,
  DsShadow,
  DsSpace,
  DsTypography,
  getDsTheme,
  type DsTheme,
} from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { resolveLatestSyncTimestamp } from '@/features/offline/sync-timestamps.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { usePlans } from '@/features/plans/use-plans';
import { shareAdapter } from '@/features/platform/share-adapter';
import { resolvePrimaryInviteCodeSpecialty } from '@/features/professional/connection-invite.logic';
import {
  getProfessionalStudentRoster,
  type ProfessionalStudentRosterItem,
} from '@/features/professional/professional-source';
import {
  filterStudentRosterRows,
  filterBulkAssignmentStudentsByPlanType,
  resolveStudentRosterViewState,
} from '@/features/professional/students-screen.logic';
import { useInviteCode, useSpecialties } from '@/features/professional/use-professional';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation, type TranslationKey } from '@/localization';

type StudentRow = ProfessionalStudentRosterItem;

type FilterKind = 'all' | 'active' | 'pending';
type BulkPlanType = 'nutrition' | 'training';
type TFn = ReturnType<typeof useTranslation>['t'];

export default function ProfessionalStudentsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { width: viewportWidth } = useWindowDimensions();
  const usesCompactRows = viewportWidth < 480;
  const { currentUser } = useAuthSession();
  const { state: specialtiesState } = useSpecialties(Boolean(currentUser));
  const inviteSpecialty =
    specialtiesState.kind === 'ready'
      ? resolvePrimaryInviteCodeSpecialty(specialtiesState.specialties)
      : null;
  const { state: inviteCodeState } = useInviteCode(Boolean(currentUser), inviteSpecialty);
  const { state: plansState, bulkAssign } = usePlans(Boolean(currentUser));

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<FilterKind>('all');
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [rosterSyncedAtIso, setRosterSyncedAtIso] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(currentUser));
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [loadErrorKey, setLoadErrorKey] = useState<TranslationKey | null>(null);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedStudentUids, setSelectedStudentUids] = useState<string[]>([]);
  const [bulkPlanType, setBulkPlanType] = useState<BulkPlanType>('nutrition');
  const [isPlanPickerVisible, setIsPlanPickerVisible] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  const fetchStartedAtRef = useRef<number | null>(null);
  const networkStatus = useNetworkStatus();
  const lastSyncedAtIso = resolveLatestSyncTimestamp([
    rosterSyncedAtIso,
    specialtiesState.kind === 'ready' ? specialtiesState.lastSyncedAtIso : null,
    inviteCodeState.kind === 'ready' ? inviteCodeState.lastSyncedAtIso : null,
    plansState.kind === 'ready' ? plansState.lastSyncedAtIso : null,
  ]);
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso,
  });

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
    }, 180);

    return () => {
      clearTimeout(timeout);
    };
  }, [search]);

  const loadRoster = useCallback(async () => {
    if (!currentUser) {
      setStudents([]);
      setRosterSyncedAtIso(null);
      setIsLoading(false);
      setLoadErrorKey(null);
      setHasLoadedOnce(false);
      return;
    }

    setIsLoading(true);
    fetchStartedAtRef.current = Date.now();
    setLoadErrorKey(null);
    try {
      const rows = await getProfessionalStudentRoster();
      setStudents(rows);
      setRosterSyncedAtIso(new Date().toISOString());
    } catch {
      setLoadErrorKey('pro.students.error');
    } finally {
      setIsLoading(false);
      setHasLoadedOnce(true);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const visible = useMemo(
    () => filterStudentRosterRows(students, { filter, search: debouncedSearch }),
    [debouncedSearch, filter, students],
  );
  const assignmentVisible = useMemo(
    () =>
      isSelectionMode ? filterBulkAssignmentStudentsByPlanType(visible, bulkPlanType) : visible,
    [bulkPlanType, isSelectionMode, visible],
  );

  useEffect(() => {
    if (!isSelectionMode) return;
    const eligibleUids = new Set(assignmentVisible.map((student) => student.studentAuthUid));
    setSelectedStudentUids((prev) => prev.filter((uid) => eligibleUids.has(uid)));
  }, [assignmentVisible, isSelectionMode]);

  const viewState = resolveStudentRosterViewState({
    hasLoadedOnce,
    isLoading,
    hasError: Boolean(loadErrorKey),
    visibleCount: visible.length,
  });
  const shouldRenderHeroEmptyState = viewState === 'hero_empty';
  const shouldRenderErrorState = viewState === 'error';

  const toggleSelection = (uid: string) => {
    setSelectedStudentUids((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid],
    );
  };

  const handleBulkAssign = async (planId: string) => {
    setIsPlanPickerVisible(false);
    setIsAssigning(true);
    const result = await bulkAssign(planId, selectedStudentUids);
    setIsAssigning(false);

    if ('error' in result) {
      Alert.alert(t('pro.plan.assign.error'));
    } else {
      Alert.alert(t('pro.plan.assign.success'));
      setIsSelectionMode(false);
      setSelectedStudentUids([]);
      void loadRoster();
    }
  };

  async function handleShareLink() {
    if (inviteCodeState.kind === 'ready' && inviteCodeState.displayCode.kind === 'active') {
      await shareAdapter.shareText(inviteCodeState.displayCode.code.codeValue);
      return;
    }
    router.push('/professional/home');
  }

  return (
    <DsScreen
      scheme={scheme}
      contentWidth="wide"
      scrollable={false}
      testID="pro.students.screen"
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: t('pro.students.title'), headerShown: false }} />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner')}
          testID="pro.students.offlineBanner"
        />
      ) : null}

      <DsCard scheme={scheme} style={styles.heroCard} testID="pro.students.hero">
        <View style={styles.heroHeader}>
          <View
            style={[
              styles.heroIconWrap,
              {
                backgroundColor: theme.color.accentPrimarySoft,
                borderColor: theme.color.accentPrimary,
              },
            ]}
          >
            <MaterialIcons name="groups" size={20} color={theme.color.accentPrimary} />
          </View>
          <View style={styles.heroCopy}>
            <Text style={[styles.screenTitle, { color: theme.color.textPrimary }]}>
              {isSelectionMode
                ? t('pro.students.bulk_assign.selection_mode')
                : t('pro.students.title')}
            </Text>
            <Text style={[styles.screenSubtitle, { color: theme.color.textSecondary }]}>
              {isSelectionMode
                ? t('pro.plan.assign.student_count').replace(
                    '{count}',
                    String(selectedStudentUids.length),
                  )
                : t('pro.students.bulk_assign.select_hint')}
            </Text>
          </View>
          {!shouldRenderHeroEmptyState && !shouldRenderErrorState && (
            <DsPillButton
              scheme={scheme}
              variant="outline"
              size="xs"
              label={
                isSelectionMode
                  ? t('pro.students.bulk_assign.cancel')
                  : t('pro.students.bulk_assign.cta')
              }
              onPress={() => {
                setIsSelectionMode(!isSelectionMode);
                setBulkPlanType('nutrition');
                setSelectedStudentUids([]);
              }}
              fullWidth={false}
              testID="pro.students.bulkAssignToggle"
            />
          )}
        </View>
      </DsCard>

      {shouldRenderHeroEmptyState ? (
        <View style={styles.emptyStateWrap} testID="pro.students.empty.hero">
          <View style={styles.emptyHeroWrap}>
            <View
              style={[
                styles.emptyHeroGlow,
                {
                  backgroundColor: theme.color.accentPrimarySoft,
                  borderColor: theme.color.accentPrimarySoft,
                },
              ]}
            />
            <View
              style={[
                styles.emptyHeroCircle,
                {
                  backgroundColor: theme.color.surface,
                  borderColor: theme.color.border,
                },
              ]}
            >
              <MaterialIcons name="group-add" size={74} color={theme.color.accentPrimary} />
              <View style={styles.emptyHeroDots}>
                <View
                  style={[styles.emptyHeroDot, { backgroundColor: theme.color.accentPrimarySoft }]}
                />
                <View
                  style={[styles.emptyHeroDot, { backgroundColor: theme.color.accentPrimary }]}
                />
                <View
                  style={[styles.emptyHeroDot, { backgroundColor: theme.color.accentPrimarySoft }]}
                />
              </View>
            </View>
          </View>

          <View style={styles.emptyCopyWrap}>
            <Text style={[styles.emptyTitle, { color: theme.color.textPrimary }]}>
              {t('pro.students.empty.title')}
            </Text>
            <Text style={[styles.emptyBody, { color: theme.color.textSecondary }]}>
              {t('pro.students.empty.body')}
            </Text>
          </View>

          <View style={styles.emptyActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void handleShareLink();
              }}
              style={[
                styles.emptySecondaryCta,
                {
                  borderColor: theme.color.accentPrimarySoft,
                  backgroundColor: theme.color.surface,
                },
              ]}
              testID="pro.students.empty.shareCta"
            >
              <MaterialIcons
                name="share"
                size={20}
                color={theme.color.textPrimary}
                style={styles.emptySecondaryIcon}
                aria-hidden
              />
              <Text style={[styles.emptySecondaryCtaText, { color: theme.color.textPrimary }]}>
                {t('pro.students.empty.cta_share_link')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : shouldRenderErrorState ? (
        <View style={styles.errorStateWrap} testID="pro.students.error.wrap">
          <DsCard scheme={scheme} style={styles.errorCard} testID="pro.students.errorCard">
            <View accessibilityRole="alert" accessibilityLiveRegion="polite">
              <Text
                style={[styles.errorText, { color: theme.color.danger }]}
                testID="pro.students.error"
              >
                {loadErrorKey ? t(loadErrorKey) : ''}
              </Text>
            </View>
            <View style={styles.errorActions}>
              <DsPillButton
                scheme={scheme}
                label={t('common.error.retry')}
                onPress={() => {
                  void loadRoster();
                }}
                testID="pro.students.retry"
              />
              <DsPillButton
                scheme={scheme}
                variant="outline"
                label={t('pro.students.error.cta_back')}
                onPress={() => router.push('/professional/home')}
                testID="pro.students.error.backToDashboard"
              />
            </View>
          </DsCard>
        </View>
      ) : (
        <>
          {!isSelectionMode && (
            <DsCard scheme={scheme} style={styles.searchCard} testID="pro.students.searchCard">
              <View
                style={[
                  styles.searchInputWrap,
                  {
                    borderColor: theme.color.border,
                    backgroundColor: theme.color.surfaceMuted,
                  },
                ]}
              >
                <MaterialIcons
                  name="search"
                  size={18}
                  color={theme.color.textSecondary}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={[
                    styles.searchInput,
                    {
                      color: theme.color.textPrimary,
                    },
                  ]}
                  placeholder={t('pro.students.search.placeholder')}
                  placeholderTextColor={theme.color.textSecondary}
                  value={search}
                  onChangeText={setSearch}
                  testID="pro.students.search"
                  accessibilityLabel={t('pro.students.search.placeholder')}
                />
              </View>

              <FilterChips filter={filter} onFilter={setFilter} theme={theme} t={t} />
            </DsCard>
          )}

          <DsCard scheme={scheme} style={styles.listCard} testID="pro.students.listCard">
            {isLoading || isAssigning ? (
              <ActivityIndicator
                style={styles.centered}
                testID="pro.students.loading"
                accessibilityLabel={t('a11y.loading.default')}
                color={theme.color.accentPrimary}
              />
            ) : (
              <FlatList
                data={assignmentVisible}
                extraData={{ isSelectionMode, selectedStudentUids }}
                keyExtractor={(item) => item.studentAuthUid}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <StudentRowItem
                    student={item}
                    theme={theme}
                    t={t}
                    isSelectionMode={isSelectionMode}
                    isSelected={selectedStudentUids.includes(item.studentAuthUid)}
                    isCompact={usesCompactRows}
                    onPress={() => {
                      if (isSelectionMode) {
                        toggleSelection(item.studentAuthUid);
                      } else {
                        router.push({
                          pathname: '/professional/student-profile',
                          params: { studentId: item.studentAuthUid },
                        });
                      }
                    }}
                  />
                )}
                ListEmptyComponent={
                  <Text
                    style={[styles.emptyText, { color: theme.color.textSecondary }]}
                    testID="pro.students.empty"
                  >
                    {t('pro.students.empty')}
                  </Text>
                }
                contentContainerStyle={styles.listContent}
              />
            )}
          </DsCard>

          {isSelectionMode && (
            <View
              style={[
                styles.bulkActionContainer,
                DsShadow.soft,
                { backgroundColor: theme.color.surface, borderColor: theme.color.border },
              ]}
              testID="pro.students.bulkActionTray"
            >
              <View style={styles.bulkPlanTypeRow}>
                <DsPillButton
                  scheme={scheme}
                  variant={bulkPlanType === 'nutrition' ? 'primary' : 'outline'}
                  size="xs"
                  label={t('pro.students.specialty.nutritionist')}
                  onPress={() => setBulkPlanType('nutrition')}
                  fullWidth={false}
                  testID="pro.students.bulk.planType.nutrition"
                />
                <DsPillButton
                  scheme={scheme}
                  variant={bulkPlanType === 'training' ? 'primary' : 'outline'}
                  size="xs"
                  label={t('pro.students.specialty.fitness_coach')}
                  onPress={() => setBulkPlanType('training')}
                  fullWidth={false}
                  testID="pro.students.bulk.planType.training"
                />
              </View>
              {selectedStudentUids.length > 0 ? (
                <DsPillButton
                  scheme={scheme}
                  label={t('pro.students.bulk_assign.cta_confirm').replace(
                    '{count}',
                    String(selectedStudentUids.length),
                  )}
                  onPress={() => setIsPlanPickerVisible(true)}
                  testID="pro.students.bulk.assignSelected"
                />
              ) : null}
            </View>
          )}
        </>
      )}

      <PlanPickerModal
        isVisible={isPlanPickerVisible}
        onClose={() => setIsPlanPickerVisible(false)}
        onSelect={handleBulkAssign}
        plansState={plansState}
        planType={bulkPlanType}
        theme={theme}
        t={t}
      />
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
    { kind: 'all', label: t('pro.students.filter.all') },
    { kind: 'active', label: t('pro.students.filter.active') },
    { kind: 'pending', label: t('pro.students.filter.pending') },
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
            testID={`pro.students.filter.${chip.kind}`}
          >
            <Text
              style={[
                styles.chipText,
                { color: isSelected ? theme.color.onAccent : theme.color.textPrimary },
              ]}
            >
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
  isSelectionMode,
  isSelected,
  isCompact,
  onPress,
}: {
  student: StudentRow;
  theme: DsTheme;
  t: TFn;
  isSelectionMode: boolean;
  isSelected: boolean;
  isCompact: boolean;
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
  const statusBg =
    student.assignmentStatus === 'active' ? theme.color.successSoft : theme.color.surfaceMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('a11y.student_row')
        .replace('{name}', student.displayName)
        .replace('{specialty}', specialtyLabel)
        .replace('{status}', statusLabel)}
      onPress={onPress}
      style={[
        styles.row,
        {
          borderColor: isSelected ? theme.color.accentPrimary : theme.color.border,
          backgroundColor: theme.color.surface,
        },
        isSelected && { borderWidth: 2 },
      ]}
      testID={`pro.students.row.${student.studentAuthUid}`}
    >
      {isSelectionMode && (
        <View
          style={[
            styles.selectionIcon,
            {
              backgroundColor: isSelected ? theme.color.accentPrimary : theme.color.surface,
              borderColor: theme.color.border,
            },
          ]}
        >
          {isSelected && <MaterialIcons name="check" size={16} color={theme.color.onAccent} />}
        </View>
      )}

      <View style={[styles.avatar, { backgroundColor: theme.color.accentPrimarySoft }]}>
        <Text style={[styles.avatarText, { color: theme.color.accentPrimary }]}>
          {student.displayName.slice(0, 1).toUpperCase()}
        </Text>
      </View>
      <View style={styles.rowMain}>
        <Text style={[styles.studentName, { color: theme.color.textPrimary }]}>
          {student.displayName}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.color.textSecondary }]}>{specialtyLabel}</Text>
        {isCompact && !isSelectionMode ? (
          <Text style={[styles.compactStatus, { color: statusColor }]}>{statusLabel}</Text>
        ) : null}
      </View>
      {!isSelectionMode && !isCompact && (
        <View style={[styles.badge, { backgroundColor: statusBg }]}>
          <Text style={[styles.badgeText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
      )}
      <MaterialIcons
        name={isSelectionMode ? 'chevron-right' : 'chevron-right'}
        size={20}
        color={theme.color.textSecondary}
        style={{ opacity: isSelectionMode ? 0 : 1 }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: DsSpace.md,
    padding: DsSpace.lg,
    paddingBottom: DsSpace.xxl,
  },
  heroCard: {
    borderRadius: DsRadius.xl,
    padding: DsSpace.md,
  },
  heroHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  heroIconWrap: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  heroCopy: {
    flex: 1,
    gap: 2,
  },
  screenTitle: {
    ...DsTypography.title,
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 24,
    lineHeight: 30,
  },
  screenSubtitle: {
    ...DsTypography.caption,
  },
  searchCard: {
    gap: DsSpace.md,
    borderRadius: DsRadius.xl,
    padding: DsSpace.md,
  },
  emptyStateWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: DsSpace.xl,
    paddingHorizontal: DsSpace.sm,
  },
  errorStateWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  errorCard: {
    alignItems: 'center',
    borderRadius: DsRadius.xl,
    gap: DsSpace.md,
    padding: DsSpace.lg,
  },
  errorActions: {
    alignSelf: 'stretch',
    gap: DsSpace.sm,
  },
  emptyHeroWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: DsSpace.xl,
    position: 'relative',
  },
  emptyHeroGlow: {
    borderRadius: DsRadius.pill,
    borderWidth: 1,
    height: 228,
    opacity: 0.9,
    position: 'absolute',
    width: 228,
  },
  emptyHeroCircle: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    borderWidth: 1,
    height: 184,
    justifyContent: 'center',
    width: 184,
  },
  emptyHeroDots: {
    flexDirection: 'row',
    gap: DsSpace.xs,
    marginTop: DsSpace.xs,
  },
  emptyHeroDot: {
    borderRadius: DsRadius.pill,
    height: 8,
    width: 8,
  },
  emptyCopyWrap: {
    gap: DsSpace.sm,
    marginBottom: DsSpace.xl,
    maxWidth: 320,
  },
  emptyTitle: {
    ...DsTypography.title,
    textAlign: 'center',
  },
  emptyBody: {
    ...DsTypography.body,
    textAlign: 'center',
  },
  emptyActions: {
    gap: DsSpace.sm,
    width: '100%',
  },
  emptySecondaryCta: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: DsSpace.md,
  },
  emptySecondaryIcon: {
    marginRight: DsSpace.xs,
  },
  emptySecondaryCtaText: {
    ...DsTypography.button,
    fontWeight: '700',
  },
  searchInputWrap: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: DsSpace.sm,
  },
  searchIcon: {
    marginRight: DsSpace.xs,
  },
  searchInput: {
    flex: 1,
    borderRadius: DsRadius.lg,
    fontSize: 15,
    minHeight: 40,
    paddingHorizontal: 0,
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
    borderRadius: DsRadius.xl,
    padding: DsSpace.md,
  },
  listContent: {
    paddingBottom: 80,
  },
  row: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: DsSpace.sm,
    justifyContent: 'space-between',
    marginBottom: DsSpace.sm,
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.sm,
  },
  selectionIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  avatarText: {
    ...DsTypography.caption,
    fontWeight: '800',
  },
  rowMain: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  studentName: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
  rowMeta: {
    ...DsTypography.caption,
  },
  compactStatus: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  badge: {
    borderRadius: DsRadius.pill,
    paddingHorizontal: DsSpace.sm,
    paddingVertical: 4,
  },
  badgeText: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  errorText: {
    ...DsTypography.body,
    textAlign: 'center',
  },
  emptyText: {
    ...DsTypography.body,
    padding: DsSpace.xxl,
    textAlign: 'center',
  },
  centered: {
    marginVertical: DsSpace.xxl,
  },
  bulkActionContainer: {
    position: 'absolute',
    bottom: DsSpace.xl,
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    gap: DsSpace.sm,
    left: DsSpace.xl,
    padding: DsSpace.sm,
    right: DsSpace.xl,
  },
  bulkPlanTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DsSpace.sm,
  },
  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: DsRadius.xl,
    borderTopRightRadius: DsRadius.xl,
    minHeight: '50%',
    maxHeight: '85%',
    padding: DsSpace.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: DsSpace.md,
  },
  modalTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  modalScroll: { gap: DsSpace.md, paddingBottom: 40 },
  planRowModal: {
    borderWidth: 1,
    borderRadius: DsRadius.lg,
    padding: DsSpace.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DsSpace.sm,
  },
  planNameModal: { fontWeight: '700', fontSize: 15 },
});
