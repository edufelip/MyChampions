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
 * Data wiring is Firestore-backed via professional-source.
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
import type { PlanChangeRequest } from '@/features/plans/plan-change-request.logic';
import { usePlans } from '@/features/plans/use-plans';
import {
  getProfessionalStudentAssignmentSnapshot,
  unbindStudentConnections,
} from '@/features/professional/professional-source';
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

  const { state: plansState, getChangeRequestsForStudent, reviewChangeRequest, bulkAssign } = usePlans(Boolean(currentUser));
  const [changeRequests, setChangeRequests] = useState<PlanChangeRequest[]>([]);
  const [changeRequestsLoadError, setChangeRequestsLoadError] = useState<string | null>(null);
  const [changeRequestsActionError, setChangeRequestsActionError] = useState<string | null>(null);

  const [isPlanPickerVisible, setIsPlanPickerVisible] = useState(false);
  const [pickerPlanType, setPickerPlanType] = useState<'nutrition' | 'training'>('training');
  const [isAssigning, setIsAssigning] = useState(false);

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

  const [isLoadingAssignments, setIsLoadingAssignments] = useState(false);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [unbindError, setUnbindError] = useState<string | null>(null);

  const [nutritionStatus, setNutritionStatus] = useState<AssignmentStatus>('none');
  const [trainingStatus, setTrainingStatus] = useState<AssignmentStatus>('none');

  const loadAssignments = useCallback(async () => {
    if (!currentUser || !studentId) {
      setNutritionStatus('none');
      setTrainingStatus('none');
      setProfileLoadError(null);
      setIsLoadingAssignments(false);
      return;
    }

    setIsLoadingAssignments(true);
    setProfileLoadError(null);
    const snapshot = await getProfessionalStudentAssignmentSnapshot(studentId);
    setNutritionStatus(snapshot.nutritionStatus);
    setTrainingStatus(snapshot.trainingStatus);
    setIsLoadingAssignments(false);
  }, [currentUser, studentId]);

  useEffect(() => {
    let cancelled = false;
    void loadAssignments().catch(() => {
      if (!cancelled) {
        setNutritionStatus('none');
        setTrainingStatus('none');
        setProfileLoadError(t('pro.student_profile.error') as string);
        setIsLoadingAssignments(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [loadAssignments, t]);

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

  const handleAssignPlan = async (planId: string) => {
    if (!studentId) return;
    setIsPlanPickerVisible(false);
    setIsAssigning(true);
    const result = await bulkAssign(planId, [studentId]);
    setIsAssigning(false);

    if ('error' in result) {
      Alert.alert(t('pro.plan.assign.error') as string);
    } else {
      Alert.alert(t('pro.plan.assign.success') as string);
      void loadAssignments();
    }
  };

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
      />

      <AssignmentCard
        specialtyLabel={t('pro.student_profile.specialty.fitness_coach') as string}
        status={trainingStatus}
        scheme={scheme}
        theme={theme}
        t={t}
        testID="pro.student_profile.training"
        onAssign={() => handleOpenPicker('training')}
        isWriteLocked={isWriteLocked}
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
        scheme={scheme}
        theme={theme}
        t={t}
      />
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
  onAssign,
  isWriteLocked,
}: {
  specialtyLabel: string;
  status: AssignmentStatus;
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
  testID: string;
  onAssign: () => void;
  isWriteLocked: boolean;
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
      <View style={styles.assignmentHeader}>
        <View accessibilityLabel={`${specialtyLabel}: ${statusLabel as string}`} style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>{specialtyLabel}</Text>
          <Text style={[styles.statusBadge, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        {status === 'none' && !isWriteLocked && (
          <DsPillButton
            scheme={scheme}
            variant="outline"
            size="sm"
            label={t('pro.student_profile.assignment.cta_assign')}
            onPress={onAssign}
            fullWidth={false}
          />
        )}
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
