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
 * Refs: D-043, D-100, FR-106–108, FR-121, FR-123–125, FR-130–131, FR-185, FR-211
 *       BR-203–205, BR-213, BR-215–217, BR-222–223, BR-247, BR-269, BR-278–279
 */
import { useCallback, useEffect, useState } from 'react';
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
import { Stack, useLocalSearchParams } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useWaterTracking } from '@/features/nutrition/use-water-tracking';
import { validateWaterGoalInput } from '@/features/nutrition/water-tracking.logic';
import { usePlans } from '@/features/plans/use-plans';
import type { PlanChangeRequest } from '@/features/plans/plan-change-request.logic';
import {
  resolveSubscriptionState,
  isPlanUpdateLocked,
  type EntitlementStatus,
} from '@/features/subscription/subscription.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type AssignmentStatus = 'active' | 'pending' | 'none';

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfessionalStudentProfileScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const { currentUser } = useAuthSession();
  const { studentId } = useLocalSearchParams<{ studentId: string }>();

  // Subscription — stubbed until RevenueCat wired.
  // useState<T> prevents TypeScript from narrowing to a literal type.
  const [stubbedEntitlement] = useState<EntitlementStatus>('unknown');
  const subState = resolveSubscriptionState({
    activeStudentCount: 0,
    entitlementStatus: stubbedEntitlement,
  });
  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = isPlanUpdateLocked(subState) || offlineDisplay.showOfflineBanner;

  // Plan change requests — loaded from professional context for this student.
  const { getChangeRequestsForStudent, reviewChangeRequest } = usePlans(currentUser);
  const [changeRequests, setChangeRequests] = useState<PlanChangeRequest[]>([]);
  const [changeRequestsLoadError, setChangeRequestsLoadError] = useState<string | null>(null);
  const [changeRequestsActionError, setChangeRequestsActionError] = useState<string | null>(null);

  // Water tracking for student — stubbed: student user not available in this context;
  // real wiring will pass student's user context from source layer.
  const today = new Date().toISOString().slice(0, 10);
  const { state: waterState, setGoal } = useWaterTracking(currentUser, today);

  // Load change requests for this student on mount
  const loadChangeRequests = useCallback(async () => {
    if (!studentId) return;
    setChangeRequestsLoadError(null);
    const result = await getChangeRequestsForStudent(studentId);
    if ('data' in result) {
      setChangeRequests(result.data);
    } else {
      setChangeRequestsLoadError(t('pro.student_profile.plan_change_requests.load_error') as string);
    }
  }, [getChangeRequestsForStudent, studentId, t]);

  useEffect(() => {
    void loadChangeRequests();
  }, [loadChangeRequests]);

  // Water goal form
  const [goalInput, setGoalInput] = useState('');
  const [goalError, setGoalError] = useState<string | null>(null);
  const [isSavingGoal, setIsSavingGoal] = useState(false);

  // Stub assignment status — useState gives a typed AssignmentStatus, not a narrowed literal.
  // Replaced by real fetch from professional-source when Data Connect endpoint is wired.
  const [nutritionStatus] = useState<AssignmentStatus>('none');
  const [trainingStatus] = useState<AssignmentStatus>('none');

  // ── Handlers ───────────────────────────────────────────────────────────────

  async function handleReviewChangeRequest(
    requestId: string,
    action: 'reviewed' | 'dismissed'
  ) {
    setChangeRequestsActionError(null);
    const err = await reviewChangeRequest(requestId, action);
    if (err) {
      setChangeRequestsActionError(
        t('pro.student_profile.plan_change_requests.action_error') as string
      );
    } else {
      // Optimistically remove reviewed/dismissed request from list
      setChangeRequests((prev) => prev.filter((r) => r.id !== requestId));
    }
  }

  function confirmUnbind() {
    Alert.alert(
      t('pro.student_profile.unbind.confirm_title') as string,
      t('pro.student_profile.unbind.confirm_body') as string,
      [
        {
          text: t('pro.student_profile.unbind.confirm_no') as string,
          style: 'cancel',
        },
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      testID="pro.student_profile.screen">
      <Stack.Screen
        options={{
          title: t('pro.student_profile.title'),
          headerShown: true,
        }}
      />

      {/* Offline banner (BL-008) */}
      {offlineDisplay.showOfflineBanner ? (
        <View
          style={[styles.offlineBanner, { backgroundColor: '#b3261e22', borderColor: '#b3261e' }]}
          testID="pro.student_profile.offlineBanner">
          <Text style={[styles.offlineBannerText, { color: palette.text }]}>
            {t('offline.banner')}
          </Text>
        </View>
      ) : null}

      {/* Entitlement lock notice */}
      {isWriteLocked ? (
        <View
          style={[styles.lockBanner, { borderColor: '#b3261e' }]}
          testID="pro.student_profile.entitlementLock"
          accessibilityRole="alert">
          <Text style={[styles.errorText, { color: '#b3261e' }]}>
            {t('pro.student_profile.entitlement_lock')}
          </Text>
        </View>
      ) : null}

      {/* Assignment status cards */}
      <AssignmentCard
        specialtyLabel={t('pro.student_profile.specialty.nutritionist') as string}
        status={nutritionStatus}
        palette={palette}
        t={t}
        testID="pro.student_profile.nutrition"
      />

      <AssignmentCard
        specialtyLabel={t('pro.student_profile.specialty.fitness_coach') as string}
        status={trainingStatus}
        palette={palette}
        t={t}
        testID="pro.student_profile.training"
      />

      {/* Unbind CTA */}
      {(nutritionStatus === 'active' || trainingStatus === 'active') && !isWriteLocked ? (
        <Pressable
          accessibilityRole="button"
          onPress={confirmUnbind}
          style={[styles.destructiveButton, { borderColor: '#b3261e' }]}
          testID="pro.student_profile.unbindCta">
          <Text style={[styles.destructiveButtonText, { color: '#b3261e' }]}>
            {t('pro.student_profile.unbind.cta')}
          </Text>
        </Pressable>
      ) : null}

      {/* Plan change requests */}
      <PlanChangeRequestsCard
        requests={changeRequests}
        loadError={changeRequestsLoadError}
        actionError={changeRequestsActionError}
        isWriteLocked={isWriteLocked}
        palette={palette}
        t={t}
        onReview={(id: string) => { void handleReviewChangeRequest(id, 'reviewed'); }}
        onDismiss={(id: string) => { void handleReviewChangeRequest(id, 'dismissed'); }}
      />

      {/* Water goal section — only if nutrition assignment is active */}
      {nutritionStatus === 'active' ? (
        <WaterGoalCard
          studentId={studentId ?? ''}
          goalInput={goalInput}
          goalError={goalError}
          isSaving={isSavingGoal}
          isWriteLocked={isWriteLocked}
          waterState={waterState}
          palette={palette}
          t={t}
          onChangeGoal={setGoalInput}
          onSaveGoal={handleSetGoal}
        />
      ) : null}
    </ScrollView>
  );
}

// ─── Assignment Card ──────────────────────────────────────────────────────────

function AssignmentCard({
  specialtyLabel,
  status,
  palette,
  t,
  testID,
}: {
  specialtyLabel: string;
  status: AssignmentStatus;
  palette: Palette;
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
    status === 'active' ? '#16a34a' : status === 'pending' ? palette.icon : palette.icon + '99';

  return (
    <View
      style={[styles.card, { borderColor: palette.icon + '44' }]}
      testID={`${testID}.assignmentCard`}
      accessibilityLabel={`${specialtyLabel}: ${statusLabel as string}`}>
      <Text style={[styles.cardTitle, { color: palette.text }]}>{specialtyLabel}</Text>
      <Text style={[styles.statusBadge, { color: statusColor }]}>{statusLabel}</Text>
    </View>
  );
}

// ─── Plan Change Requests Card ────────────────────────────────────────────────

function PlanChangeRequestsCard({
  requests,
  loadError,
  actionError,
  isWriteLocked,
  palette,
  t,
  onReview,
  onDismiss,
}: {
  requests: PlanChangeRequest[];
  loadError: string | null;
  actionError: string | null;
  isWriteLocked: boolean;
  palette: Palette;
  t: TFn;
  onReview: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <View
      style={[styles.card, { borderColor: palette.icon + '44' }]}
      testID="pro.student_profile.planChangeRequests">
      <Text style={[styles.cardTitle, { color: palette.text }]}>
        {t('pro.student_profile.plan_change_requests.title')}
      </Text>

      {loadError ? (
        <View accessibilityLiveRegion="polite">
          <Text
            style={[styles.errorText, { color: '#b3261e' }]}
            testID="pro.student_profile.planChangeRequests.loadError">
            {loadError}
          </Text>
        </View>
      ) : requests.length === 0 ? (
        <Text style={[styles.meta, { color: palette.icon }]}>
          {t('pro.student_profile.plan_change_requests.empty')}
        </Text>
      ) : (
        requests.map((req) => (
          <View
            key={req.id}
            style={[styles.requestRow, { borderColor: palette.icon + '33' }]}
            testID={`pro.student_profile.planChangeRequest.${req.id}`}>
            <Text style={[styles.requestText, { color: palette.text }]}>{req.requestText}</Text>
            <Text style={[styles.meta, { color: palette.icon }]}>
              {req.planType} · {req.status}
            </Text>
            {!isWriteLocked ? (
              <View style={styles.requestActions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onReview(req.id)}
                  style={[styles.actionButton, { borderColor: palette.tint }]}
                  testID={`pro.student_profile.planChangeRequest.${req.id}.review`}>
                  <Text style={[styles.actionButtonText, { color: palette.tint }]}>
                    {t('pro.student_profile.plan_change_requests.review')}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => onDismiss(req.id)}
                  style={[styles.actionButton, { borderColor: palette.icon }]}
                  testID={`pro.student_profile.planChangeRequest.${req.id}.dismiss`}>
                  <Text style={[styles.actionButtonText, { color: palette.icon }]}>
                    {t('pro.student_profile.plan_change_requests.dismiss')}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))
      )}

      {actionError ? (
        <View accessibilityLiveRegion="polite">
          <Text
            style={[styles.errorText, { color: '#b3261e' }]}
            testID="pro.student_profile.planChangeRequests.actionError">
            {actionError}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ─── Water Goal Card ──────────────────────────────────────────────────────────

function WaterGoalCard({
  goalInput,
  goalError,
  isSaving,
  isWriteLocked,
  palette,
  t,
  onChangeGoal,
  onSaveGoal,
}: {
  studentId: string;
  goalInput: string;
  goalError: string | null;
  isSaving: boolean;
  isWriteLocked: boolean;
  waterState: ReturnType<typeof useWaterTracking>['state'];
  palette: Palette;
  t: TFn;
  onChangeGoal: (v: string) => void;
  onSaveGoal: () => void;
}) {
  return (
    <View
      style={[styles.card, { borderColor: palette.tint + '66' }]}
      testID="pro.student_profile.waterGoalCard">
      <Text style={[styles.cardTitle, { color: palette.text }]}>
        {t('pro.student_profile.water_goal.title')}
      </Text>

      <Text style={[styles.fieldLabel, { color: palette.text }]}>
        {t('pro.student_profile.water_goal.label')}
      </Text>
      <TextInput
        style={[styles.input, { borderColor: palette.icon + '66', color: palette.text }]}
        placeholder={t('pro.student_profile.water_goal.placeholder') as string}
        placeholderTextColor={palette.icon}
        value={goalInput}
        onChangeText={onChangeGoal}
        keyboardType="numeric"
        editable={!isWriteLocked}
        testID="pro.student_profile.waterGoal.input"
        accessibilityLabel={t('pro.student_profile.water_goal.label') as string}
      />

      {goalError ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.errorText, { color: '#b3261e' }]}>{goalError}</Text>
        </View>
      ) : null}

      {isWriteLocked ? (
        <Text style={[styles.meta, { color: '#b3261e' }]}>
          {t('offline.write_lock')}
        </Text>
      ) : isSaving ? (
        <ActivityIndicator accessibilityLabel={t('a11y.loading.saving') as string} />
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={onSaveGoal}
          style={[styles.primaryButton, { backgroundColor: palette.tint }]}
          testID="pro.student_profile.waterGoal.save">
          <Text style={styles.primaryButtonText}>
            {t('pro.student_profile.water_goal.save')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 16 },
  lockBanner: {
    backgroundColor: '#b3261e11',
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  card: { borderRadius: 12, borderWidth: 1.5, gap: 8, padding: 16 },
  cardTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
  statusBadge: { fontSize: 14, fontWeight: '600' },
  meta: { fontSize: 13, lineHeight: 18 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  errorText: { fontSize: 13 },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  destructiveButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 48,
  },
  destructiveButtonText: { fontSize: 15, fontWeight: '600' },
  requestRow: {
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
    padding: 10,
  },
  requestText: {
    fontSize: 14,
    lineHeight: 20,
  },
  requestActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 10,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  offlineBanner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  offlineBannerText: { fontSize: 13, lineHeight: 18 },
});
