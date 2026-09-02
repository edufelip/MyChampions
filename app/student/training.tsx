/**
 * SC-210 Student Training Tracking
 * Route: /student/training
 *
 * Visual refresh (2026-03-05): empty state matches the acquisition-focused
 * training art direction while keeping BL-008 offline/write-lock and D-071
 * assigned-plan change-request behavior.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { PlanChangeRequestCard } from '@/components/ds/patterns/PlanChangeRequestCard';
import { WeekStrip, type WeekStripItem } from '@/components/ds/patterns/WeekStrip';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsShadow, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useConnections } from '@/features/connections/use-connections';
import { resolveOfflineDisplayState } from '@/features/offline/offline.logic';
import { resolveLatestSyncTimestamp } from '@/features/offline/sync-timestamps.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { isSelfGuidedPlan } from '@/features/plans/plan-ownership.logic';
import { useTrainingPlanBuilder } from '@/features/plans/use-plan-builder';
import { usePlans } from '@/features/plans/use-plans';
import {
  logWorkoutSession,
  getTodayWorkoutLogs,
  type WorkoutLog,
} from '@/features/training/workout-log-source';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

function getWeekStrip(locale: string): WeekStripItem[] {
  const today = new Date();
  const base = new Date(today);
  base.setDate(today.getDate() - 2);

  return Array.from({ length: 5 }, (_, index) => {
    const date = new Date(base);
    date.setDate(base.getDate() + index);

    const dayLabel = new Intl.DateTimeFormat(locale, { weekday: 'short' })
      .format(date)
      .slice(0, 1)
      .toUpperCase();

    return {
      id: `${dayLabel}-${date.getDate()}`,
      dayLabel,
      dayNumber: String(date.getDate()),
      isActive: date.toDateString() === today.toDateString(),
    };
  });
}

export default function StudentTrainingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t, locale } = useTranslation();
  const { currentUser } = useAuthSession();
  const router = useRouter();
  const { width: viewportWidth } = useWindowDimensions();
  const usesCompactWorkoutHeader = viewportWidth < 480;

  const networkStatus = useNetworkStatus();
  const {
    state: plansState,
    submitChangeRequest,
    validateChangeRequest,
  } = usePlans(Boolean(currentUser));
  const { state: connectionsState } = useConnections(Boolean(currentUser));
  const lastSyncedAtIso = resolveLatestSyncTimestamp([
    plansState.kind === 'ready' ? plansState.lastSyncedAtIso : null,
    connectionsState.kind === 'ready' ? connectionsState.lastSyncedAtIso : null,
  ]);
  const offlineDisplay = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  const trainingPlans =
    plansState.kind === 'ready'
      ? plansState.plans.filter((p) => p.planType === 'training' && !p.isArchived)
      : [];

  const assignedTrainingPlan =
    trainingPlans.find((plan) => plan.sourceKind === 'assigned' && !plan.isDraft) ?? null;
  const selfManagedTrainingPlan =
    trainingPlans.find((plan) => isSelfGuidedPlan(plan, currentUser?.uid ?? null)) ?? null;
  const hasActiveFitnessCoachConnection =
    connectionsState.kind === 'ready' &&
    connectionsState.connections.some(
      (connection) => connection.specialty === 'fitness_coach' && connection.status === 'active',
    );

  const hasActiveTrainingAssignment = assignedTrainingPlan !== null;
  const hasSelfManagedPlan = selfManagedTrainingPlan !== null;
  const isConnectionsPending =
    Boolean(currentUser) &&
    (connectionsState.kind === 'idle' || connectionsState.kind === 'loading');
  const hasConnectionsError = Boolean(currentUser) && connectionsState.kind === 'error';
  const loadErrorMessage =
    plansState.kind === 'error'
      ? plansState.message
      : connectionsState.kind === 'error'
        ? connectionsState.message
        : null;
  const isWaitingForCoachPlan = hasActiveFitnessCoachConnection && !hasActiveTrainingAssignment;
  const shouldShowPlanCalendar =
    hasActiveTrainingAssignment || (hasSelfManagedPlan && !isWaitingForCoachPlan);
  const weekStrip = useMemo(() => getWeekStrip(locale), [locale]);

  const { state: builderState, loadPlan } = useTrainingPlanBuilder(
    Boolean(currentUser),
    'student-assigned',
  );
  const [todayWorkoutLogs, setTodayWorkoutLogs] = useState<WorkoutLog[]>([]);
  const [expandedSessionIds, setExpandedSessionIds] = useState<string[]>([]);
  const [isLoggingSessionId, setIsLoggingSessionId] = useState<string | null>(null);

  const loggingSessionsRef = useRef(new Set<string>());
  const loggedSessionIds = todayWorkoutLogs.map((log) => log.sessionId);

  useEffect(() => {
    if (assignedTrainingPlan) {
      loadPlan(assignedTrainingPlan.id);
    }
  }, [assignedTrainingPlan, loadPlan]);

  useEffect(() => {
    if (currentUser) {
      getTodayWorkoutLogs()
        .then((logs) => {
          setTodayWorkoutLogs(logs);
        })
        .catch((err) => {
          console.error('Error loading today workout logs:', err);
        });
    }
  }, [currentUser]);

  const toggleSessionExpand = (sessionId: string) => {
    setExpandedSessionIds((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId],
    );
  };

  const handleLogWorkout = async (sessionId: string, sessionName: string) => {
    if (
      isWriteLocked ||
      loggedSessionIds.includes(sessionId) ||
      loggingSessionsRef.current.has(sessionId)
    )
      return;

    loggingSessionsRef.current.add(sessionId);
    setIsLoggingSessionId(sessionId);
    try {
      await logWorkoutSession(sessionId, sessionName);
      const newLog: WorkoutLog = {
        id: Math.random().toString(),
        ownerUid: currentUser?.uid || '',
        sessionId,
        sessionName,
        createdAt: new Date().toISOString(),
      };
      setTodayWorkoutLogs((prev) => [...prev, newLog]);
    } catch (err) {
      console.error('Failed to log workout session:', err);
      Alert.alert(
        t('common.error.generic'),
        t('student.training.plan_change.error.unknown') || 'Something went wrong. Try again.',
      );
    } finally {
      loggingSessionsRef.current.delete(sessionId);
      setIsLoggingSessionId(null);
    }
  };

  return (
    <DsScreen
      scheme={scheme}
      contentWidth="content"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      testID="student.training.screen"
    >
      <Stack.Screen options={{ title: t('student.training.title'), headerShown: false }} />

      <View style={[styles.shell, { backgroundColor: theme.color.shell }]}>
        <View style={styles.headerRow}>
          <Text style={[styles.pageTitle, { color: theme.color.textPrimary }]}>
            {t('student.training.title')}
          </Text>
        </View>

        {offlineDisplay.showOfflineBanner ? (
          <DsOfflineBanner
            scheme={scheme}
            text={t('offline.banner')}
            testID="student.training.offlineBanner"
          />
        ) : null}

        {shouldShowPlanCalendar ? (
          <WeekStrip scheme={scheme} items={weekStrip} testID="student.training.weekStrip" />
        ) : null}

        {plansState.kind === 'loading' || (isConnectionsPending && !hasSelfManagedPlan) ? (
          <DsCard scheme={scheme} style={styles.loadingCard} testID="student.training.plansLoading">
            <ActivityIndicator
              accessibilityLabel={t('a11y.loading.default')}
              color={theme.color.accentPrimary}
            />
          </DsCard>
        ) : plansState.kind === 'error' || (hasConnectionsError && !hasSelfManagedPlan) ? (
          <DsCard scheme={scheme} style={styles.loadingCard} testID="student.training.loadError">
            <Text style={[styles.loadErrorText, { color: theme.color.danger }]}>
              {loadErrorMessage ?? t('common.error.generic')}
            </Text>
          </DsCard>
        ) : hasActiveTrainingAssignment ? (
          <View style={styles.sectionStack}>
            {builderState.kind === 'loading' ? (
              <DsCard scheme={scheme} style={styles.loadingCard}>
                <ActivityIndicator color={theme.color.accentPrimary} />
              </DsCard>
            ) : builderState.kind === 'error' ? (
              <DsCard
                scheme={scheme}
                style={styles.loadingCard}
                testID="student.training.planDetailsError"
              >
                <Text style={[styles.loadErrorText, { color: theme.color.danger }]}>
                  {builderState.message || t('common.error.generic')}
                </Text>
              </DsCard>
            ) : builderState.kind === 'ready' && builderState.plan ? (
              <View style={{ gap: DsSpace.md }} testID="student.training.assignedSessionList">
                <Text style={[styles.guidedTitle, { color: theme.color.textPrimary }]}>
                  {t('student.training.session.title')}
                </Text>
                {builderState.plan.sessions && builderState.plan.sessions.length > 0 ? (
                  builderState.plan.sessions.map((session) => {
                    const isExpanded = expandedSessionIds.includes(session.id);
                    const isLogged = loggedSessionIds.includes(session.id);
                    const isLoggingThis = isLoggingSessionId === session.id;

                    return (
                      <DsCard
                        scheme={scheme}
                        key={session.id}
                        style={styles.workoutCard}
                        testID={`student.training.sessionCard-${session.id}`}
                      >
                        <View
                          style={[
                            styles.workoutHeaderRow,
                            usesCompactWorkoutHeader && styles.workoutHeaderRowCompact,
                          ]}
                        >
                          <View
                            style={[
                              styles.workoutHeaderLeft,
                              usesCompactWorkoutHeader && styles.workoutHeaderLeftCompact,
                            ]}
                          >
                            <View
                              style={[
                                styles.workoutIconWrap,
                                { backgroundColor: theme.color.accentPrimarySoft },
                              ]}
                            >
                              <MaterialIcons
                                color={theme.color.accentPrimary}
                                name="fitness-center"
                                size={24}
                              />
                            </View>
                            <View style={styles.workoutTitleBlock}>
                              <Text
                                style={[styles.workoutTitle, { color: theme.color.textPrimary }]}
                              >
                                {session.name}
                              </Text>
                              <Text
                                style={[
                                  styles.workoutSubtitle,
                                  { color: theme.color.textSecondary },
                                ]}
                              >
                                {t('student.training.exercise_count', {
                                  count: session.items?.length || 0,
                                })}
                              </Text>
                            </View>
                          </View>

                          <View
                            style={[
                              styles.workoutHeaderRight,
                              usesCompactWorkoutHeader && styles.workoutHeaderRightCompact,
                            ]}
                          >
                            <DsPillButton
                              scheme={scheme}
                              disabled={isWriteLocked || isLogged}
                              fullWidth={false}
                              loading={isLoggingThis}
                              label={
                                isLogged
                                  ? t('student.training.cta_logged')
                                  : t('student.training.cta_log')
                              }
                              leftIcon={
                                isLogged ? (
                                  <MaterialIcons
                                    color={theme.color.success}
                                    name="check-circle"
                                    size={18}
                                  />
                                ) : undefined
                              }
                              onPress={() => handleLogWorkout(session.id, session.name)}
                              variant={isLogged ? 'outline' : 'primary'}
                              style={styles.logButton}
                              testID={`student.training.logBtn-${session.id}`}
                            />
                            <Pressable
                              accessibilityLabel={t(
                                isExpanded
                                  ? 'student.training.session.collapse'
                                  : 'student.training.session.expand',
                              )}
                              accessibilityRole="button"
                              accessibilityState={{ expanded: isExpanded }}
                              aria-expanded={isExpanded}
                              hitSlop={10}
                              onPress={() => toggleSessionExpand(session.id)}
                              style={styles.expandButton}
                              testID={`student.training.expandBtn-${session.id}`}
                            >
                              <MaterialIcons
                                color={theme.color.textSecondary}
                                name={isExpanded ? 'expand-less' : 'expand-more'}
                                size={24}
                                style={{ marginLeft: 4 }}
                              />
                            </Pressable>
                          </View>
                        </View>

                        {isExpanded && (
                          <View
                            style={[styles.exerciseList, { borderTopColor: theme.color.border }]}
                          >
                            {session.items && session.items.length > 0 ? (
                              session.items.map((item, idx) => (
                                <View
                                  key={item.id}
                                  style={[
                                    styles.exerciseItem,
                                    idx > 0 && {
                                      borderTopWidth: 1,
                                      borderTopColor: theme.color.border,
                                    },
                                  ]}
                                >
                                  <View style={styles.exerciseHeader}>
                                    <View
                                      style={[
                                        styles.itemDot,
                                        { backgroundColor: theme.color.accentPrimary },
                                      ]}
                                    />
                                    <Text
                                      style={[
                                        styles.exerciseName,
                                        { color: theme.color.textPrimary },
                                      ]}
                                    >
                                      {item.name}
                                    </Text>
                                  </View>
                                  {item.quantity ? (
                                    <Text
                                      style={[
                                        styles.exerciseQty,
                                        { color: theme.color.textSecondary },
                                      ]}
                                    >
                                      {item.quantity}
                                    </Text>
                                  ) : null}
                                  {item.notes ? (
                                    <Text
                                      style={[
                                        styles.exerciseNotes,
                                        { color: theme.color.textSecondary },
                                      ]}
                                    >
                                      {item.notes}
                                    </Text>
                                  ) : null}
                                </View>
                              ))
                            ) : (
                              <Text
                                style={[
                                  styles.noExercisesText,
                                  { color: theme.color.textSecondary },
                                ]}
                              >
                                {t('student.training.no_exercises')}
                              </Text>
                            )}
                          </View>
                        )}
                      </DsCard>
                    );
                  })
                ) : (
                  <Text style={[styles.noExercisesText, { color: theme.color.textSecondary }]}>
                    {t('student.training.no_sessions')}
                  </Text>
                )}
              </View>
            ) : null}

            <PlanChangeRequestCard
              scheme={scheme}
              t={t}
              isWriteLocked={isWriteLocked}
              testID="student.training.planChangeForm"
              validate={validateChangeRequest}
              submit={(requestText) =>
                submitChangeRequest(assignedTrainingPlan.id, 'training', requestText)
              }
              keys={{
                title: 'student.training.plan_change.title',
                label: 'student.training.plan_change.label',
                placeholder: 'student.training.plan_change.placeholder',
                cta: 'student.training.plan_change.cta',
                success: 'student.training.plan_change.success',
                validationRequired: 'student.training.plan_change.validation.required',
                validationTooShort: 'student.training.plan_change.validation.too_short',
                errorPlanNotFound: 'student.training.plan_change.error.plan_not_found',
                errorNoActiveAssignment: 'student.training.plan_change.error.no_active_assignment',
                errorNetwork: 'student.training.plan_change.error.network',
                errorUnknown: 'student.training.plan_change.error.unknown',
              }}
            />
          </View>
        ) : isWaitingForCoachPlan ? (
          <View style={styles.emptyStateWrap} testID="student.training.waitingForCoachPlan">
            <View style={styles.emptyHero}>
              <View
                style={[styles.emptyGlow, { backgroundColor: theme.color.accentPrimarySoft }]}
              />

              <View
                style={[
                  styles.emptyMainTile,
                  DsShadow.floating,
                  {
                    backgroundColor: theme.color.surface,
                    shadowColor: scheme === 'dark' ? '#000000' : theme.color.accentPrimary,
                  },
                ]}
              >
                <MaterialIcons color={theme.color.accentPrimary} name="hourglass-top" size={58} />
              </View>

              <View
                style={[
                  styles.emptyAccentTile,
                  DsShadow.soft,
                  { backgroundColor: theme.color.accentPrimary },
                ]}
              >
                <MaterialIcons color={theme.color.onAccent} name="fitness-center" size={34} />
              </View>
            </View>

            <View style={styles.emptyCopyBlock}>
              <Text style={[styles.emptyTitle, { color: theme.color.textPrimary }]}>
                {t('student.training.waiting.title')}
              </Text>
              <Text style={[styles.emptyBody, { color: theme.color.textSecondary }]}>
                {t('student.training.waiting.body')}
              </Text>
            </View>

            <DsPillButton
              scheme={scheme}
              label={t('student.training.waiting.cta')}
              onPress={() => router.push('/student/professionals')}
              disabled={isWriteLocked}
              contentColor={theme.color.onAccent}
              testID="student.training.waitingCta"
              style={styles.emptyPrimaryCta}
              leftIcon={<MaterialIcons color={theme.color.onAccent} name="person" size={20} />}
            />
          </View>
        ) : hasSelfManagedPlan ? (
          <View style={styles.sectionStack}>
            <DsCard scheme={scheme} testID="student.training.selfManagedPlanCard">
              <View style={styles.selfManagedHeader}>
                <View
                  style={[
                    styles.selfManagedIconWrap,
                    { backgroundColor: theme.color.accentPrimarySoft },
                  ]}
                >
                  <MaterialIcons
                    color={theme.color.accentPrimary}
                    name="fitness-center"
                    size={24}
                  />
                </View>
                <View style={styles.selfManagedTextWrap}>
                  <Text style={[styles.selfManagedTitle, { color: theme.color.textPrimary }]}>
                    {selfManagedTrainingPlan.name || t('student.home.training.section')}
                  </Text>
                  <Text style={[styles.selfManagedSubtitle, { color: theme.color.textSecondary }]}>
                    {t('student.plan.training.title.edit')}
                  </Text>
                </View>
              </View>

              <DsPillButton
                scheme={scheme}
                label={t('student.home.cta_training')}
                onPress={() => router.push(`/student/training/plans/${selfManagedTrainingPlan.id}`)}
                style={styles.selfManagedCta}
                testID="student.training.editSelfManagedPlanCta"
              />
            </DsCard>
          </View>
        ) : (
          <View style={styles.emptyStateWrap} testID="student.training.emptyState">
            <View style={styles.emptyHero}>
              <View
                style={[styles.emptyGlow, { backgroundColor: theme.color.accentPrimarySoft }]}
              />

              <View
                style={[
                  styles.emptyMainTile,
                  DsShadow.floating,
                  {
                    backgroundColor: theme.color.surface,
                    shadowColor: scheme === 'dark' ? '#000000' : theme.color.accentPrimary,
                  },
                ]}
              >
                <MaterialIcons color={theme.color.accentPrimary} name="fitness-center" size={58} />
              </View>

              <View
                style={[
                  styles.emptyAccentTile,
                  DsShadow.soft,
                  { backgroundColor: theme.color.accentPrimary },
                ]}
              >
                <MaterialIcons color={theme.color.onAccent} name="assignment" size={34} />
              </View>
            </View>

            <View style={styles.emptyCopyBlock}>
              <Text style={[styles.emptyTitle, { color: theme.color.textPrimary }]}>
                {t('student.training.empty.title')}
              </Text>
              <Text style={[styles.emptyBody, { color: theme.color.textSecondary }]}>
                {t('student.training.empty.body')}
              </Text>
            </View>

            <DsPillButton
              scheme={scheme}
              label={t('student.training.empty.cta')}
              onPress={() => router.push('/student/professionals')}
              disabled={isWriteLocked}
              contentColor={theme.color.onAccent}
              testID="student.training.emptyCta"
              style={styles.emptyPrimaryCta}
              leftIcon={<MaterialIcons color={theme.color.onAccent} name="person-add" size={20} />}
            />

            <Pressable
              accessibilityRole="button"
              disabled={isWriteLocked}
              onPress={() => router.push('/student/training/plans/new' as never)}
              style={({ pressed }) => [
                styles.emptySecondaryCta,
                { opacity: isWriteLocked ? 0.5 : pressed ? 0.7 : 1 },
              ]}
              testID="student.training.emptySelfGuidedCta"
            >
              <Text style={[styles.emptySecondaryCtaText, { color: theme.color.textSecondary }]}>
                {t('student.training.empty.self_guided_cta')}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </DsScreen>
  );
}

const styles = StyleSheet.create({
  shell: {
    borderRadius: 16,
    flex: 1,
    marginHorizontal: 16,
    marginTop: 18,
    paddingBottom: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    gap: DsSpace.md,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  pageTitle: {
    ...DsTypography.title,
    fontFamily: Fonts.rounded,
  },
  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 140,
  },
  loadErrorText: {
    ...DsTypography.caption,
    textAlign: 'center',
  },
  sectionStack: {
    gap: DsSpace.md,
  },
  emptyStateWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingBottom: DsSpace.xxl,
    paddingHorizontal: DsSpace.sm,
    paddingTop: DsSpace.md,
  },
  emptyHero: {
    alignItems: 'center',
    height: 260,
    justifyContent: 'center',
    marginBottom: DsSpace.xl,
    position: 'relative',
    width: 260,
  },
  emptyGlow: {
    borderRadius: 999,
    height: 220,
    position: 'absolute',
    width: 220,
  },
  emptyMainTile: {
    alignItems: 'center',
    borderRadius: 30,
    height: 128,
    justifyContent: 'center',
    width: 128,
  },
  emptyAccentTile: {
    alignItems: 'center',
    borderRadius: 22,
    height: 80,
    justifyContent: 'center',
    position: 'absolute',
    right: 24,
    top: 70,
    width: 80,
  },
  emptyCopyBlock: {
    gap: DsSpace.sm,
    marginBottom: DsSpace.xl,
    maxWidth: 320,
  },
  emptyTitle: {
    ...DsTypography.title,
    fontFamily: Fonts.rounded,
    fontSize: 30,
    textAlign: 'center',
  },
  emptyBody: {
    ...DsTypography.body,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  emptyPrimaryCta: {
    borderRadius: 16,
    maxWidth: 280,
    minHeight: 56,
    width: '100%',
  },
  emptySecondaryCta: {
    marginTop: DsSpace.md,
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.xs,
  },
  emptySecondaryCtaText: {
    ...DsTypography.button,
    fontSize: 14,
  },
  guidedTitle: {
    ...DsTypography.cardTitle,
    fontSize: 20,
    fontFamily: Fonts.rounded,
  },
  selfManagedHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    marginBottom: DsSpace.md,
  },
  selfManagedIconWrap: {
    alignItems: 'center',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  selfManagedTextWrap: {
    flex: 1,
    gap: 2,
  },
  selfManagedTitle: {
    ...DsTypography.cardTitle,
  },
  selfManagedSubtitle: {
    ...DsTypography.micro,
  },
  selfManagedCta: {
    marginTop: DsSpace.xs,
  },
  workoutCard: {
    padding: DsSpace.md,
    gap: DsSpace.xs,
  },
  workoutHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  workoutHeaderRowCompact: {
    alignItems: 'stretch',
    flexDirection: 'column',
  },
  workoutHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DsSpace.sm,
    flex: 1,
    marginRight: 8,
  },
  workoutHeaderLeftCompact: {
    marginRight: 0,
    width: '100%',
  },
  workoutIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    borderRadius: 12,
  },
  workoutTitleBlock: {
    gap: 2,
    flex: 1,
  },
  workoutTitle: {
    ...DsTypography.cardTitle,
    fontSize: 16,
  },
  workoutSubtitle: {
    ...DsTypography.micro,
  },
  workoutHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  workoutHeaderRightCompact: {
    alignSelf: 'flex-end',
    marginTop: DsSpace.sm,
  },
  logButton: {
    minHeight: 36,
    paddingHorizontal: 12,
  },
  expandButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 44,
  },
  exerciseList: {
    marginTop: DsSpace.md,
    paddingTop: DsSpace.md,
    borderTopWidth: 1,
    gap: DsSpace.md,
  },
  exerciseItem: {
    gap: 4,
    paddingVertical: DsSpace.xs,
  },
  exerciseHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  exerciseName: {
    ...DsTypography.body,
    fontWeight: '700',
    fontSize: 15,
  },
  exerciseQty: {
    ...DsTypography.caption,
    marginLeft: 16,
    fontWeight: '600',
  },
  exerciseNotes: {
    ...DsTypography.caption,
    marginLeft: 16,
    fontStyle: 'italic',
  },
  noExercisesText: {
    ...DsTypography.caption,
    textAlign: 'center',
    paddingVertical: DsSpace.md,
  },
});
