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
 * Data wiring deferred — stub state shown until professional-source endpoint wired.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
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
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

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
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useWaterTracking } from '@/features/nutrition/use-water-tracking';
import { validateWaterGoalInput } from '@/features/nutrition/water-tracking.logic';
import type { PlanChangeRequest } from '@/features/plans/plan-change-request.logic';
import { usePlans } from '@/features/plans/use-plans';
import {
  isPlanUpdateLocked,
  resolveSubscriptionState,
} from '@/features/subscription/subscription.logic';
import { useSubscription } from '@/features/subscription/use-subscription';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

type AssignmentStatus = 'active' | 'pending' | 'none';
type TFn = ReturnType<typeof useTranslation>['t'];

export default function ProfessionalStudentProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { studentId } = useLocalSearchParams<{ studentId: string }>();

  const { entitlementStatus, activeStudentCount } = useSubscription(Boolean(currentUser));
  const subState = resolveSubscriptionState({ activeStudentCount, entitlementStatus });

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = isPlanUpdateLocked(subState) || offlineDisplay.showOfflineBanner;

  const { getChangeRequestsForStudent, reviewChangeRequest } = usePlans(Boolean(currentUser));
  const [changeRequests, setChangeRequests] = useState<PlanChangeRequest[]>([]);
  const [changeRequestsLoadError, setChangeRequestsLoadError] = useState<string | null>(null);
  const [changeRequestsActionError, setChangeRequestsActionError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const { state: waterState, setGoal } = useWaterTracking(Boolean(currentUser), today);

  const loadChangeRequests = useCallback(async () => {
    if (!studentId) return;
    setChangeRequestsLoadError(null);
    const result = await getChangeRequestsForStudent(studentId);
    if ('data' in result) {
      setChangeRequests(result.data);
      return;
    }
    setChangeRequestsLoadError(t('pro.student_profile.plan_change_requests.load_error') as string);
  }, [getChangeRequestsForStudent, studentId, t]);

  useEffect(() => {
    void loadChangeRequests();
  }, [loadChangeRequests]);

  const [goalInput, setGoalInput] = useState('');
  const [goalError, setGoalError] = useState<string | null>(null);
  const [isSavingGoal, setIsSavingGoal] = useState(false);

  const [nutritionStatus] = useState<AssignmentStatus>('none');
  const [trainingStatus] = useState<AssignmentStatus>('none');

  async function handleReviewChangeRequest(requestId: string, action: 'reviewed' | 'dismissed') {
    setChangeRequestsActionError(null);
    const err = await reviewChangeRequest(requestId, action);
    if (err) {
      setChangeRequestsActionError(t('pro.student_profile.plan_change_requests.action_error') as string);
      return;
    }
    setChangeRequests((prev) => prev.filter((r) => r.id !== requestId));
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
            // Real unbind call deferred (pending-wiring-checklist-v1.md)
          },
        },
      ]
    );
  }

  async function handleSetGoal() {
    setGoalError(null);
    const errors = validateWaterGoalInput({ dailyMlString: goalInput });
    if (errors.dailyMl) {
      setGoalError(
        errors.dailyMl === 'required'
          ? (t('pro.student_profile.water_goal.validation.required') as string)
          : (t('pro.student_profile.water_goal.validation.must_be_positive') as string)
      );
      return;
    }

    const dailyMl = parseInt(goalInput, 10);
    setIsSavingGoal(true);
    const err = await setGoal(dailyMl);
    setIsSavingGoal(false);

    if (err) {
      setGoalError(t('pro.student_profile.water_goal.error') as string);
    } else {
      setGoalInput('');
    }
  }

  return (
    <DsScreen scheme={scheme} testID="pro.student_profile.screen" contentContainerStyle={styles.content}>
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

      <AssignmentCard
        specialtyLabel={t('pro.student_profile.specialty.nutritionist') as string}
        status={nutritionStatus}
        scheme={scheme}
        theme={theme}
        t={t}
        testID="pro.student_profile.nutrition"
      />

      <AssignmentCard
        specialtyLabel={t('pro.student_profile.specialty.fitness_coach') as string}
        status={trainingStatus}
        scheme={scheme}
        theme={theme}
        t={t}
        testID="pro.student_profile.training"
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

      {nutritionStatus === 'active' ? (
        <WaterGoalCard
          goalInput={goalInput}
          goalError={goalError}
          isSaving={isSavingGoal}
          isWriteLocked={isWriteLocked}
          waterState={waterState}
          theme={theme}
          t={t}
          onChangeGoal={setGoalInput}
          onSaveGoal={handleSetGoal}
          scheme={scheme}
        />
      ) : null}
    </DsScreen>
  );
}

function AssignmentCard({
  specialtyLabel,
  status,
  scheme,
  theme,
  t,
  testID,
}: {
  specialtyLabel: string;
  status: AssignmentStatus;
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
  testID: string;
}) {
  const statusLabel =
    status === 'active'
      ? t('pro.student_profile.assignment.active')
      : status === 'pending'
      ? t('pro.student_profile.assignment.pending')
      : t('pro.student_profile.assignment.none');

  const statusColor =
    status === 'active'
      ? theme.color.success
      : status === 'pending'
      ? theme.color.textSecondary
      : `${theme.color.textSecondary}99`;

  return (
    <DsCard scheme={scheme} testID={`${testID}.assignmentCard`}>
      <View accessibilityLabel={`${specialtyLabel}: ${statusLabel as string}`}>
        <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>{specialtyLabel}</Text>
        <Text style={[styles.statusBadge, { color: statusColor }]}>{statusLabel}</Text>
      </View>
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
                  variant="secondary"
                  label={t('pro.student_profile.plan_change_requests.review') as string}
                  onPress={() => onReview(req.id)}
                  fullWidth={false}
                  style={styles.actionPill}
                  testID={`pro.student_profile.planChangeRequest.${req.id}.review`}
                />
                <DsPillButton
                  scheme={scheme}
                  variant="secondary"
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

function WaterGoalCard({
  goalInput,
  goalError,
  isSaving,
  isWriteLocked,
  waterState,
  theme,
  t,
  onChangeGoal,
  onSaveGoal,
  scheme,
}: {
  goalInput: string;
  goalError: string | null;
  isSaving: boolean;
  isWriteLocked: boolean;
  waterState: ReturnType<typeof useWaterTracking>['state'];
  theme: DsTheme;
  t: TFn;
  onChangeGoal: (v: string) => void;
  onSaveGoal: () => void;
  scheme: 'light' | 'dark';
}) {
  return (
    <DsCard scheme={scheme} testID="pro.student_profile.waterGoalCard" style={styles.cardWithGap}>
      <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>
        {t('pro.student_profile.water_goal.title')}
      </Text>

      <Text style={[styles.fieldLabel, { color: theme.color.textPrimary }]}>
        {t('pro.student_profile.water_goal.label')}
      </Text>
      <TextInput
        style={[
          styles.input,
          {
            borderColor: theme.color.border,
            color: theme.color.textPrimary,
            backgroundColor: theme.color.surfaceMuted,
          },
        ]}
        placeholder={t('pro.student_profile.water_goal.placeholder') as string}
        placeholderTextColor={theme.color.textSecondary}
        value={goalInput}
        onChangeText={onChangeGoal}
        keyboardType="numeric"
        editable={!isWriteLocked}
        testID="pro.student_profile.waterGoal.input"
        accessibilityLabel={t('pro.student_profile.water_goal.label') as string}
      />

      {waterState.kind === 'ready' ? (
        <Text style={[styles.meta, { color: theme.color.textSecondary }]}> 
          {String(waterState.todayConsumedMl)} / {String(waterState.effectiveGoal?.dailyMl ?? 0)} ml
        </Text>
      ) : null}

      {goalError ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.errorText, { color: theme.color.danger }]}>{goalError}</Text>
        </View>
      ) : null}

      {isWriteLocked ? (
        <Text style={[styles.meta, { color: theme.color.danger }]}>{t('offline.write_lock')}</Text>
      ) : isSaving ? (
        <ActivityIndicator accessibilityLabel={t('a11y.loading.saving') as string} color={theme.color.accentPrimary} />
      ) : (
        <DsPillButton
          scheme={scheme}
          label={t('pro.student_profile.water_goal.save') as string}
          onPress={onSaveGoal}
          testID="pro.student_profile.waterGoal.save"
        />
      )}
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
  fieldLabel: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  input: {
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.sm,
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
  requestActions: {
    flexDirection: 'row',
    gap: DsSpace.xs,
    marginTop: DsSpace.xs,
  },
  actionPill: {
    flex: 1,
    minHeight: 42,
  },
});
