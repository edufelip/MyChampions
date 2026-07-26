/**
 * SC-206 Student Profile (Professional View)
 * Route: /professional/student-profile?studentId=<id>
 *
 * Per-student oversight panel:
 *  - Assignment status by specialty (active / pending / none)
 *  - Unbind action with confirmation
 *  - Set/update water goal for assigned student (nutrition domain)
 *  - Plan change request triage (review / dismiss)
 *  - Entitlement lock notice when write actions are blocked
 *
 * Data wiring is server-backed via professional-source.
 *
 * Docs: docs/screens/v2/SC-206-student-profile-professional-view.md
 * Refs: D-043, D-100, D-134, FR-106–108, FR-121, FR-123–125, FR-130–131, FR-185, FR-211
 *       BR-203–205, BR-213, BR-215–217, BR-222–223, BR-247, BR-269, BR-278–279
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';

import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import {
  DsRadius,
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
import type { PlanChangeRequest } from '@/features/plans/plan-change-request.logic';
import { usePlans } from '@/features/plans/use-plans';
import { usePlansStore } from '@/features/plans/plans-store';
import {
  getProfessionalStudentAssignmentSnapshot,
  unbindStudentConnections,
} from '@/features/professional/professional-source';
import {
  getStudentTrackingReview,
  type StudentTrackingReview,
} from '@/features/professional/student-tracking-review-source';
import {
  isPlanUpdateLocked,
  resolveSubscriptionState,
} from '@/features/subscription/subscription.logic';
import { useSubscription } from '@/features/subscription/use-subscription';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

import { PlanPickerModal } from '@/components/ds/patterns/PlanPickerModal';

type AssignmentStatus = 'active' | 'pending' | 'none';
type TFn = ReturnType<typeof useTranslation>['t'];

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ProfessionalStudentProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { studentId } = useLocalSearchParams<{ studentId: string }>();

  const {
    entitlementStatus,
    activeStudentCount,
    lastSyncedAtIso: subscriptionSyncedAtIso,
  } = useSubscription(currentUser?.uid ?? null, { loadProfessionalActiveStudentCount: true });
  const subState = resolveSubscriptionState({ activeStudentCount, entitlementStatus });

  const {
    state: plansState,
    getChangeRequestsForStudent,
    reviewChangeRequest,
    createDraftAssignedPlan,
    reload: reloadPlans,
  } = usePlans(Boolean(currentUser));
  const [changeRequests, setChangeRequests] = useState<PlanChangeRequest[]>([]);
  const [changeRequestsSyncedAtIso, setChangeRequestsSyncedAtIso] = useState<string | null>(null);
  const [changeRequestsLoadError, setChangeRequestsLoadError] = useState<string | null>(null);
  const [changeRequestsActionError, setChangeRequestsActionError] = useState<string | null>(null);
  const [trackingReview, setTrackingReview] = useState<StudentTrackingReview | null>(null);
  const [trackingReviewSyncedAtIso, setTrackingReviewSyncedAtIso] = useState<string | null>(null);
  const [trackingReviewError, setTrackingReviewError] = useState<string | null>(null);

  const [isPlanPickerVisible, setIsPlanPickerVisible] = useState(false);
  const [pickerPlanType, setPickerPlanType] = useState<'nutrition' | 'training'>('training');
  const [isAssigning, setIsAssigning] = useState(false);

  const loadChangeRequests = useCallback(async () => {
    if (!studentId) {
      setChangeRequestsSyncedAtIso(null);
      return;
    }
    setChangeRequestsLoadError(null);
    const result = await getChangeRequestsForStudent(studentId);
    if ('data' in result) {
      setChangeRequests(result.data);
      setChangeRequestsSyncedAtIso(new Date().toISOString());
      return;
    }
    setChangeRequestsSyncedAtIso(null);
    setChangeRequestsLoadError(t('pro.student_profile.plan_change_requests.load_error') as string);
  }, [getChangeRequestsForStudent, studentId, t]);

  useEffect(() => {
    void loadChangeRequests();
  }, [loadChangeRequests]);

  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [assignmentsSyncedAtIso, setAssignmentsSyncedAtIso] = useState<string | null>(null);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [unbindError, setUnbindError] = useState<string | null>(null);

  const [nutritionStatus, setNutritionStatus] = useState<AssignmentStatus>('none');
  const [trainingStatus, setTrainingStatus] = useState<AssignmentStatus>('none');

  const loadAssignments = useCallback(async () => {
    if (!currentUser || !studentId) {
      setNutritionStatus('none');
      setTrainingStatus('none');
      setProfileLoadError(null);
      setAssignmentsSyncedAtIso(null);
      setIsLoadingAssignments(false);
      return;
    }

    setIsLoadingAssignments(true);
    setProfileLoadError(null);
    const snapshot = await getProfessionalStudentAssignmentSnapshot(studentId);
    setNutritionStatus(snapshot.nutritionStatus);
    setTrainingStatus(snapshot.trainingStatus);
    setAssignmentsSyncedAtIso(new Date().toISOString());
    setIsLoadingAssignments(false);
  }, [currentUser, studentId]);

  useEffect(() => {
    let cancelled = false;
    void loadAssignments().catch(() => {
      if (!cancelled) {
        setNutritionStatus('none');
        setTrainingStatus('none');
        setAssignmentsSyncedAtIso(null);
        setProfileLoadError(t('pro.student_profile.error') as string);
        setIsLoadingAssignments(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadAssignments, t]);

  useFocusEffect(
    useCallback(() => {
      if (!currentUser || !studentId) return;

      reloadPlans();
      void loadAssignments();
    }, [currentUser, loadAssignments, reloadPlans, studentId])
  );

  async function handleReviewChangeRequest(requestId: string, action: 'reviewed' | 'dismissed') {
    setChangeRequestsActionError(null);
    const err = await reviewChangeRequest(requestId, action);
    if (err) {
      setChangeRequestsActionError(t('pro.student_profile.plan_change_requests.action_error') as string);
      return;
    }
    setChangeRequests((prev) => prev.filter((r) => r.id !== requestId));
  }

  async function handleUnbind() {
    if (!studentId) return;
    setUnbindError(null);
    try {
      await unbindStudentConnections(studentId);
      await loadAssignments();
    } catch {
      setUnbindError(t('pro.student_profile.unbind.error') as string);
    }
  }

  function confirmUnbind() {
    Alert.alert(
      t('pro.student_profile.unbind.confirm_title') as string,
      t('pro.student_profile.unbind.confirm_body') as string,
      [
        { text: t('pro.student_profile.unbind.confirm_no') as string, style: 'cancel' },
        {
          text: t('pro.student_profile.unbind.confirm_yes') as string,
          style: 'destructive',
          onPress: () => {
            void handleUnbind();
          },
        },
      ]
    );
  }

  const handleOpenPicker = (type: 'nutrition' | 'training') => {
    setPickerPlanType(type);
    setIsPlanPickerVisible(true);
  };

  const deleteNutritionPlanAction = usePlansStore((s) => s.deleteNutritionPlanAction);
  const deleteTrainingPlanAction = usePlansStore((s) => s.deleteTrainingPlanAction);

  const studentNutritionPlans = plansState.kind === 'ready'
    ? plansState.plans.filter(p => p.studentUid === studentId && p.planType === 'nutrition' && !p.isArchived)
    : [];
  const draftNutritionPlan = studentNutritionPlans.find(p => p.isDraft) ?? null;
  const activeNutritionPlan = studentNutritionPlans.find(p => !p.isDraft) ?? null;
  const studentTrainingPlans = plansState.kind === 'ready'
    ? plansState.plans.filter(p => p.studentUid === studentId && p.planType === 'training' && !p.isArchived)
    : [];
  const draftTrainingPlan = studentTrainingPlans.find(p => p.isDraft) ?? null;
  const activeTrainingPlan = studentTrainingPlans.find(p => !p.isDraft) ?? null;

  const handleDiscardDraft = useCallback(
    async (planId: string, planType: 'nutrition' | 'training') => {
      if (!currentUser) return;
      setIsAssigning(true);
      const action = planType === 'nutrition' ? deleteNutritionPlanAction : deleteTrainingPlanAction;
      const error = await action(Boolean(currentUser), planId);
      setIsAssigning(false);

      if (error) {
        Alert.alert(t('pro.plan.discard.error') as string);
      } else {
        Alert.alert(t('pro.plan.discard.success') as string);
        reloadPlans();
        void loadAssignments();
      }
    },
    [currentUser, deleteNutritionPlanAction, deleteTrainingPlanAction, t, reloadPlans, loadAssignments]
  );

  const confirmDiscardDraft = useCallback(
    (planId: string, planType: 'nutrition' | 'training') => {
      Alert.alert(
        t('pro.plan.discard.title') as string,
        t('pro.plan.discard.body') as string,
        [
          { text: t('pro.plan.discard.no') as string, style: 'cancel' },
          {
            text: t('pro.plan.discard.yes') as string,
            style: 'destructive',
            onPress: () => {
              void handleDiscardDraft(planId, planType);
            },
          },
        ]
      );
    },
    [handleDiscardDraft, t]
  );

  const onViewPlan = useCallback((planId: string) => {
    const plan = plansState.kind === 'ready' ? plansState.plans.find(p => p.id === planId) : null;
    if (!plan) return;
    router.push(`/professional/${plan.planType}/plans/${planId}`);
  }, [plansState, router]);

  const handleAssignPlan = async (planId: string) => {
    if (!studentId) return;
    setIsPlanPickerVisible(false);
    setIsAssigning(true);
    const result = await createDraftAssignedPlan(planId, studentId);
    setIsAssigning(false);

    if ('error' in result) {
      Alert.alert(t('pro.plan.assign.error') as string);
    } else {
      Alert.alert(t('pro.plan.assign.success') as string);
      reloadPlans();
      void loadAssignments();
      router.push(`/professional/${pickerPlanType}/plans/${result.id}`);
    }
  };

  const loadTrackingReview = useCallback(async () => {
    if (!studentId || nutritionStatus !== 'active') {
      setTrackingReview(null);
      setTrackingReviewError(null);
      setTrackingReviewSyncedAtIso(null);
      return;
    }

    setTrackingReviewError(null);
    try {
      const review = await getStudentTrackingReview(studentId, {
        todayKey: todayKey(),
      });
      setTrackingReview(review);
      setTrackingReviewSyncedAtIso(new Date().toISOString());
    } catch {
      setTrackingReview(null);
      setTrackingReviewSyncedAtIso(null);
      setTrackingReviewError(t('pro.student_profile.tracking_review.error') as string);
    }
  }, [nutritionStatus, studentId, t]);

  useEffect(() => {
    void loadTrackingReview();
  }, [loadTrackingReview]);

  const networkStatus = useNetworkStatus();
  const lastSyncedAtIso = resolveLatestSyncTimestamp([
    subscriptionSyncedAtIso,
    plansState.kind === 'ready' ? plansState.lastSyncedAtIso : null,
    changeRequestsSyncedAtIso,
    assignmentsSyncedAtIso,
    trackingReviewSyncedAtIso,
  ]);
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso,
  });
  const isWriteLocked = isPlanUpdateLocked(subState) || offlineDisplay.showOfflineBanner;

  return (
    <DsScreen scheme={scheme} contentWidth="content" testID="pro.student_profile.screen" contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('pro.student_profile.title'), headerShown: false }} />

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
        testID="pro.student_profile.backButton"
      />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner') as string}
          testID="pro.student_profile.offlineBanner"
        />
      ) : null}

      {isWriteLocked ? (
        <DsCard scheme={scheme} variant="warning" testID="pro.student_profile.entitlementLock">
          <Text style={[styles.errorText, { color: theme.color.danger }]}>
            {t('pro.student_profile.entitlement_lock')}
          </Text>
        </DsCard>
      ) : null}

      {isLoadingAssignments || isAssigning ? (
        <DsCard scheme={scheme} testID="pro.student_profile.loading">
          <ActivityIndicator
            accessibilityLabel={t('a11y.loading.default') as string}
            color={theme.color.accentPrimary}
          />
        </DsCard>
      ) : null}

      {profileLoadError ? (
        <DsCard scheme={scheme} variant="warning" testID="pro.student_profile.error">
          <View accessibilityLiveRegion="polite">
            <Text style={[styles.errorText, { color: theme.color.danger }]}>
              {profileLoadError}
            </Text>
          </View>
        </DsCard>
      ) : null}

      <AssignmentCard
        specialtyLabel={t('pro.student_profile.specialty.nutritionist') as string}
        status={nutritionStatus}
        scheme={scheme}
        theme={theme}
        t={t}
        testID="pro.student_profile.nutrition"
        onAssign={() => handleOpenPicker('nutrition')}
        isWriteLocked={isWriteLocked}
        activePlan={activeNutritionPlan ? { id: activeNutritionPlan.id, name: activeNutritionPlan.name ?? 'Nutrition Plan' } : null}
        draftPlan={draftNutritionPlan ? { id: draftNutritionPlan.id, name: draftNutritionPlan.name ?? 'Nutrition Plan' } : null}
        onViewPlan={onViewPlan}
        onDiscardDraft={(planId) => confirmDiscardDraft(planId, 'nutrition')}
      />

      {nutritionStatus === 'active' ? (
        <TrackingReviewCard
          review={trackingReview}
          error={trackingReviewError}
          scheme={scheme}
          theme={theme}
          t={t}
        />
      ) : null}

      <AssignmentCard
        specialtyLabel={t('pro.student_profile.specialty.fitness_coach') as string}
        status={trainingStatus}
        scheme={scheme}
        theme={theme}
        t={t}
        testID="pro.student_profile.training"
        onAssign={() => handleOpenPicker('training')}
        isWriteLocked={isWriteLocked}
        activePlan={activeTrainingPlan ? { id: activeTrainingPlan.id, name: activeTrainingPlan.name ?? 'Training Plan' } : null}
        draftPlan={draftTrainingPlan ? { id: draftTrainingPlan.id, name: draftTrainingPlan.name ?? 'Training Plan' } : null}
        onViewPlan={onViewPlan}
        onDiscardDraft={(planId) => confirmDiscardDraft(planId, 'training')}
      />

      {(nutritionStatus === 'active' || trainingStatus === 'active') && !isWriteLocked ? (
        <Pressable
          accessibilityRole="button"
          onPress={confirmUnbind}
          style={[styles.destructiveButton, { borderColor: theme.color.danger }]}
          testID="pro.student_profile.unbindCta">
          <Text style={[styles.destructiveButtonText, { color: theme.color.danger }]}>
            {t('pro.student_profile.unbind.cta')}
          </Text>
        </Pressable>
      ) : null}

      {unbindError ? (
        <View accessibilityLiveRegion="polite">
          <Text
            style={[styles.errorText, { color: theme.color.danger }]}
            testID="pro.student_profile.unbind.error">
            {unbindError}
          </Text>
        </View>
      ) : null}

      <PlanChangeRequestsCard
        requests={changeRequests}
        loadError={changeRequestsLoadError}
        actionError={changeRequestsActionError}
        isWriteLocked={isWriteLocked}
        scheme={scheme}
        theme={theme}
        t={t}
        onReview={(id: string) => {
          void handleReviewChangeRequest(id, 'reviewed');
        }}
        onDismiss={(id: string) => {
          void handleReviewChangeRequest(id, 'dismissed');
        }}
      />

      <PlanPickerModal
        isVisible={isPlanPickerVisible}
        onClose={() => setIsPlanPickerVisible(false)}
        onSelect={handleAssignPlan}
        plansState={plansState}
        planType={pickerPlanType}
        theme={theme}
        t={t}
      />
    </DsScreen>
  );
}

function TrackingReviewCard({
  review,
  error,
  scheme,
  theme,
  t,
}: {
  review: StudentTrackingReview | null;
  error: string | null;
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
}) {
  return (
    <DsCard scheme={scheme} testID="pro.student_profile.trackingReview" style={styles.cardWithGap}>
      <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>
        {t('pro.student_profile.tracking_review.title')}
      </Text>
      <Text style={[styles.meta, { color: theme.color.textSecondary }]}>
        {t('pro.student_profile.tracking_review.read_only')}
      </Text>

      {error ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.errorText, { color: theme.color.danger }]}>{error}</Text>
        </View>
      ) : !review ? (
        <Text style={[styles.meta, { color: theme.color.textSecondary }]}>
          {t('pro.student_profile.tracking_review.loading')}
        </Text>
      ) : (
        <>
          <View style={[styles.trackingPanel, { borderColor: theme.color.border }]}>
            <Text style={[styles.trackingLabel, { color: theme.color.textSecondary }]}>
              {t('pro.student_profile.tracking_review.water_today')}
            </Text>
            <Text
              style={[styles.trackingValue, { color: theme.color.textPrimary }]}
              testID="pro.student_profile.trackingReview.waterValue">
              {review.todayWater.goalMl
                ? t('pro.student_profile.tracking_review.water_progress_value', {
                    total: review.todayWater.totalMl,
                    goal: review.todayWater.goalMl,
                    percent: review.todayWater.progressPercent!,
                  })
                : t('pro.student_profile.tracking_review.water_total_value', {
                    total: review.todayWater.totalMl,
                  })}
            </Text>
          </View>

          <View style={styles.hydrationSummaryRow}>
            {review.sevenDayHydration.map((day) => (
              <View
                key={day.dateKey}
                style={[
                  styles.hydrationDayPill,
                  {
                    backgroundColor: day.goalMet ? theme.color.successSoft : theme.color.surfaceMuted,
                    borderColor: day.goalMet ? theme.color.success : theme.color.border,
                  },
                ]}>
                <Text style={[styles.hydrationDayText, { color: theme.color.textPrimary }]}>
                  {day.dateKey.slice(5)}
                </Text>
                <Text style={[styles.hydrationMlText, { color: theme.color.textSecondary }]}>
                  {t('pro.student_profile.tracking_review.water_total_value', { total: day.totalMl })}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.trackingListBlock}>
            <Text style={[styles.trackingLabel, { color: theme.color.textSecondary }]}>
              {t('pro.student_profile.tracking_review.meals_today')}
            </Text>
            {review.todayMealCheckOffs.length === 0 ? (
              <Text style={[styles.meta, { color: theme.color.textSecondary }]}>
                {t('pro.student_profile.tracking_review.empty_meals')}
              </Text>
            ) : (
              review.todayMealCheckOffs.map((meal) => (
                <Text key={`${meal.mealId}-${meal.loggedAt}`} style={[styles.meta, { color: theme.color.textPrimary }]}>
                  {t('pro.student_profile.tracking_review.meal_calories_value', {
                    mealId: meal.mealId,
                    calories: meal.calories,
                  })}
                </Text>
              ))
            )}
          </View>

          <View style={styles.trackingListBlock}>
            <Text style={[styles.trackingLabel, { color: theme.color.textSecondary }]}>
              {t('pro.student_profile.tracking_review.recent_portions')}
            </Text>
            {review.recentPortionLogs.length === 0 ? (
              <Text style={[styles.meta, { color: theme.color.textSecondary }]}>
                {t('pro.student_profile.tracking_review.empty_portions')}
              </Text>
            ) : (
              review.recentPortionLogs.slice(0, 7).map((log) => (
                <View key={log.id} style={[styles.portionRow, { borderColor: theme.color.border }]}>
                  <Text style={[styles.meta, { color: theme.color.textPrimary }]}>
                    {`${log.loggedAt.slice(0, 10)} · ${log.mealId}`}
                  </Text>
                  <Text style={[styles.meta, { color: theme.color.textSecondary }]}>
                    {t('pro.student_profile.tracking_review.portion_macros_value', {
                      calories: log.snapshot.calories,
                      carbs: log.snapshot.carbs,
                      proteins: log.snapshot.proteins,
                      fats: log.snapshot.fats,
                    })}
                  </Text>
                </View>
              ))
            )}
          </View>
        </>
      )}
    </DsCard>
  );
}

function AssignmentCard({
  specialtyLabel,
  status,
  scheme,
  theme,
  t,
  testID,
  onAssign,
  isWriteLocked,
  activePlan,
  draftPlan,
  onViewPlan,
  onDiscardDraft,
}: {
  specialtyLabel: string;
  status: AssignmentStatus;
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
  testID: string;
  onAssign: () => void;
  isWriteLocked: boolean;
  activePlan: { id: string; name: string } | null;
  draftPlan: { id: string; name: string } | null;
  onViewPlan: (planId: string) => void;
  onDiscardDraft: (planId: string) => void;
}) {
  let statusLabel = '';
  let statusColor = theme.color.textSecondary;

  if (status === 'active') {
    if (draftPlan) {
      statusLabel = t('pro.student_profile.assignment.draft_pending') as string;
      statusColor = theme.color.warning;
    } else if (activePlan) {
      const activeText = t('pro.student_profile.assignment.active') as string;
      statusLabel = `${activeText}: ${activePlan.name}`;
      statusColor = theme.color.success;
    } else {
      statusLabel = t('pro.student_profile.assignment.awaiting') as string;
      statusColor = theme.color.textSecondary;
    }
  } else if (status === 'pending') {
    statusLabel = t('pro.student_profile.assignment.pending') as string;
    statusColor = theme.color.textSecondary;
  } else {
    statusLabel = t('pro.student_profile.assignment.none') as string;
    statusColor = theme.color.textSecondary;
  }

  // Determine what buttons to render
  const renderActions = () => {
    if (isWriteLocked) return null;

    if (status === 'active') {
      if (draftPlan) {
        return (
          <View style={styles.draftActionsRow}>
            <DsPillButton
              scheme={scheme}
              variant="primary"
              size="sm"
              label={t('pro.student_profile.assignment.cta_resume_draft') as string}
              onPress={() => onViewPlan(draftPlan.id)}
              fullWidth={false}
              testID={`${testID}.cta_resume_draft`}
            />
            <DsPillButton
              scheme={scheme}
              variant="outline"
              size="sm"
              label={t('pro.student_profile.assignment.cta_discard') as string}
              onPress={() => onDiscardDraft(draftPlan.id)}
              contentColor={theme.color.danger}
              style={{ borderColor: theme.color.danger }}
              fullWidth={false}
              testID={`${testID}.cta_discard`}
            />
          </View>
        );
      } else if (activePlan) {
        return (
          <DsPillButton
            scheme={scheme}
            variant="outline"
            size="sm"
            label={t('pro.student_profile.assignment.cta_view_edit') as string}
            onPress={() => onViewPlan(activePlan.id)}
            fullWidth={false}
            testID={`${testID}.cta_view_edit`}
          />
        );
      } else {
        return (
          <DsPillButton
            scheme={scheme}
            variant="outline"
            size="sm"
            label={t('pro.student_profile.assignment.cta_assign')}
            onPress={onAssign}
            fullWidth={false}
            testID={`${testID}.cta_assign`}
          />
        );
      }
    }
    return null;
  };

  return (
    <DsCard scheme={scheme} testID={`${testID}.assignmentCard`}>
      <View style={styles.assignmentHeader}>
        <View accessibilityLabel={`${specialtyLabel}: ${statusLabel}`} style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]} testID={`${testID}.title`}>
            {specialtyLabel}
          </Text>
          <Text style={[styles.statusBadge, { color: statusColor }]} testID={`${testID}.status`}>
            {statusLabel}
          </Text>
        </View>
        {status !== 'active' || !draftPlan ? (
          <View style={styles.assignmentCtaContainer}>
            {renderActions()}
          </View>
        ) : null}
      </View>
      {status === 'active' && draftPlan ? (
        <View style={styles.draftActionsContainer}>
          {renderActions()}
        </View>
      ) : null}
    </DsCard>
  );
}

function PlanChangeRequestsCard({
  requests,
  loadError,
  actionError,
  isWriteLocked,
  scheme,
  theme,
  t,
  onReview,
  onDismiss,
}: {
  requests: PlanChangeRequest[];
  loadError: string | null;
  actionError: string | null;
  isWriteLocked: boolean;
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <DsCard scheme={scheme} testID="pro.student_profile.planChangeRequests" style={styles.cardWithGap}>
      <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>
        {t('pro.student_profile.plan_change_requests.title')}
      </Text>

      {loadError ? (
        <View accessibilityLiveRegion="polite">
          <Text
            style={[styles.errorText, { color: theme.color.danger }]}
            testID="pro.student_profile.planChangeRequests.loadError">
            {loadError}
          </Text>
        </View>
      ) : requests.length === 0 ? (
        <Text style={[styles.meta, { color: theme.color.textSecondary }]}>
          {t('pro.student_profile.plan_change_requests.empty')}
        </Text>
      ) : (
        requests.map((req) => (
          <View
            key={req.id}
            style={[styles.requestRow, { borderColor: theme.color.border }]}
            testID={`pro.student_profile.planChangeRequest.${req.id}`}>
            <Text style={[styles.requestText, { color: theme.color.textPrimary }]}>{req.requestText}</Text>
            <Text style={[styles.meta, { color: theme.color.textSecondary }]}>
              {req.planType} · {req.status}
            </Text>
            {!isWriteLocked ? (
              <View style={styles.requestActions}>
                <DsPillButton
                  scheme={scheme}
                  variant="outline"
                  size="sm"
                  label={t('pro.student_profile.plan_change_requests.review') as string}
                  onPress={() => onReview(req.id)}
                  fullWidth={false}
                  style={styles.actionPill}
                  testID={`pro.student_profile.planChangeRequest.${req.id}.review`}
                />
                <DsPillButton
                  scheme={scheme}
                  variant="outline"
                  size="sm"
                  label={t('pro.student_profile.plan_change_requests.dismiss') as string}
                  onPress={() => onDismiss(req.id)}
                  fullWidth={false}
                  style={styles.actionPill}
                  testID={`pro.student_profile.planChangeRequest.${req.id}.dismiss`}
                />
              </View>
            ) : null}
          </View>
        ))
      )}

      {actionError ? (
        <View accessibilityLiveRegion="polite">
          <Text
            style={[styles.errorText, { color: theme.color.danger }]}
            testID="pro.student_profile.planChangeRequests.actionError">
            {actionError}
          </Text>
        </View>
      ) : null}
    </DsCard>
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
  cardWithGap: {
    gap: DsSpace.sm,
  },
  cardTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  statusBadge: {
    ...DsTypography.body,
    fontWeight: '700',
  },
  meta: {
    ...DsTypography.caption,
  },
  errorText: {
    ...DsTypography.caption,
  },
  destructiveButton: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    borderWidth: 2,
    justifyContent: 'center',
    minHeight: 54,
  },
  destructiveButtonText: {
    ...DsTypography.button,
    fontWeight: '700',
  },
  requestRow: {
    borderRadius: DsRadius.md,
    borderWidth: 1,
    gap: DsSpace.xs,
    padding: DsSpace.sm,
  },
  requestText: {
    ...DsTypography.body,
  },
  trackingPanel: {
    borderRadius: DsRadius.md,
    borderWidth: 1,
    gap: DsSpace.xs,
    padding: DsSpace.sm,
  },
  trackingLabel: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  trackingValue: {
    ...DsTypography.body,
    fontWeight: '800',
  },
  hydrationSummaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DsSpace.xs,
  },
  hydrationDayPill: {
    borderRadius: DsRadius.md,
    borderWidth: 1,
    paddingHorizontal: DsSpace.sm,
    paddingVertical: DsSpace.xs,
  },
  hydrationDayText: {
    ...DsTypography.caption,
    fontWeight: '800',
  },
  hydrationMlText: {
    ...DsTypography.caption,
  },
  trackingListBlock: {
    gap: DsSpace.xs,
  },
  portionRow: {
    borderRadius: DsRadius.md,
    borderWidth: 1,
    gap: 2,
    padding: DsSpace.sm,
  },
  requestActions: {
    flexDirection: 'row',
    gap: DsSpace.xs,
    marginTop: DsSpace.xs,
  },
  actionPill: {
    flex: 1,
    minHeight: 42,
  },
  assignmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DsSpace.sm,
  },
  assignmentCtaContainer: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  draftActionsContainer: {
    marginTop: DsSpace.md,
  },
  draftActionsRow: {
    flexDirection: 'row',
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
  planRow: {
    borderWidth: 1,
    borderRadius: DsRadius.lg,
    padding: DsSpace.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DsSpace.sm,
  },
  planName: { fontWeight: '700', fontSize: 15 },
});
