/**
 * SC-210 Student Training Tracking
 * Route: /student/training
 *
 * Surfaces:
 *  - Today's training session from assigned or self-managed plan
 *  - Plan change request form for assigned training plans (advisory, D-071)
 *  - Offline banner + write-lock (D-041, D-074)
 *  - Empty state with self-guided CTA when no coach assigned
 *
 * Docs: docs/screens/v2/SC-210-student-training-tracking.md
 * Refs: D-041, D-071, D-074, FR-211, FR-214, BR-269, BR-272
 *
 * Session completion tracking is deferred — tracked in pending-wiring-checklist-v1.md.
 */
import { Stack } from 'expo-router';
import { useState } from 'react';
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
import { usePlans } from '@/features/plans/use-plans';
import { resolveOfflineDisplayState } from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function StudentTrainingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const { currentUser } = useAuthSession();

  // Real network connectivity via NetInfo (BL-008, FR-214, BR-272)
  const networkStatus = useNetworkStatus();
  const offlineDisplay = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  const { state: plansState, submitChangeRequest, validateChangeRequest } = usePlans(currentUser);

  const assignedTrainingPlan =
    plansState.kind === 'ready'
      ? plansState.plans.find(
          (p) => p.planType === 'training' && p.sourceKind === 'assigned' && !p.isArchived
        ) ?? null
      : null;

  const hasActiveTrainingAssignment = assignedTrainingPlan !== null;

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      testID="student.training.screen">
      <Stack.Screen options={{ title: t('student.training.title'), headerShown: true }} />

      {/* ── Offline banner ─────────────────────────────────── */}
      {offlineDisplay.showOfflineBanner ? (
        <View
          style={[styles.offlineBanner, { backgroundColor: '#b3261e22', borderColor: '#b3261e' }]}
          testID="student.training.offlineBanner"
          accessibilityRole="alert">
          <Text style={[styles.offlineBannerText, { color: palette.text }]}>
            {t('offline.banner')}
          </Text>
        </View>
      ) : null}

      {/* ── Training plan area ────────────────────────────── */}
      {plansState.kind === 'loading' ? (
        <ActivityIndicator
          accessibilityLabel={t('a11y.loading.default')}
          style={styles.centered}
          testID="student.training.plansLoading"
        />
      ) : hasActiveTrainingAssignment ? (
        <>
          {/* Assigned plan: read-only notice + change request */}
          <View
            style={[styles.infoBox, { borderColor: palette.tint + '66' }]}
            testID="student.training.assignedPlanNotice">
            <Text style={[styles.infoText, { color: palette.icon }]}>
              {t('student.training.assigned_plan.read_only_notice')}
            </Text>
          </View>
          {/* Session summary stub — wiring deferred */}
          <View
            style={[styles.card, { borderColor: palette.icon + '44' }]}
            testID="student.training.sessionSummary">
            <Text style={[styles.cardTitle, { color: palette.text }]}>
              {t('student.training.title')}
            </Text>
            <Text style={[styles.cardMeta, { color: palette.icon }]}>
              {t('common.loading.default')}
            </Text>
          </View>
          <PlanChangeRequestForm
            planId={assignedTrainingPlan!.id}
            palette={palette}
            t={t}
            isWriteLocked={isWriteLocked}
            submitChangeRequest={submitChangeRequest}
            validateChangeRequest={validateChangeRequest}
          />
        </>
      ) : (
        /* Empty state */
        <View style={styles.emptyState} testID="student.training.emptyState">
          <Text style={[styles.emptyTitle, { color: palette.text }]}>
            {t('student.training.empty.title')}
          </Text>
          <Text style={[styles.emptyBody, { color: palette.icon }]}>
            {t('student.training.empty.body')}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={isWriteLocked}
            onPress={() => Alert.alert(t('student.training.empty.cta'))}
            style={[
              styles.primaryButton,
              { backgroundColor: isWriteLocked ? palette.icon : palette.tint },
            ]}
            testID="student.training.emptyCta">
            <Text style={styles.primaryButtonText}>{t('student.training.empty.cta')}</Text>
          </Pressable>
          {isWriteLocked ? (
            <Text style={[styles.writeLock, { color: '#b3261e' }]}>
              {t('offline.write_lock')}
            </Text>
          ) : null}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Plan Change Request Form ─────────────────────────────────────────────────

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

function PlanChangeRequestForm({
  planId,
  palette,
  t,
  isWriteLocked,
  submitChangeRequest,
  validateChangeRequest,
}: {
  planId: string;
  palette: Palette;
  t: TFn;
  isWriteLocked: boolean;
  submitChangeRequest: ReturnType<typeof usePlans>['submitChangeRequest'];
  validateChangeRequest: ReturnType<typeof usePlans>['validateChangeRequest'];
}) {
  const [requestText, setRequestText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const onSubmit = async () => {
    const errors = validateChangeRequest({ requestText });
    if (errors.requestText) {
      setFieldError(
        errors.requestText === 'required'
          ? t('student.nutrition.plan_change.validation.required')
          : t('student.nutrition.plan_change.validation.too_short')
      );
      return;
    }

    setIsSubmitting(true);
    setFieldError(null);
    setSuccessMsg(null);

    const result = await submitChangeRequest(planId, requestText);

    setIsSubmitting(false);

    if ('data' in result) {
      setRequestText('');
      setSuccessMsg(t('student.training.plan_change.success'));
    } else {
      setFieldError(t('student.training.plan_change.error.unknown'));
    }
  };

  return (
    <View
      style={[styles.card, { borderColor: palette.icon + '44' }]}
      testID="student.training.planChangeForm">
      <Text style={[styles.cardTitle, { color: palette.text }]}>
        {t('student.training.plan_change.title')}
      </Text>

      {isWriteLocked ? (
        <Text style={[styles.writeLock, { color: '#b3261e' }]}>{t('offline.write_lock')}</Text>
      ) : (
        <>
          <Text style={[styles.fieldLabel, { color: palette.text }]}>
            {t('student.training.plan_change.label')}
          </Text>
          <TextInput
            accessibilityLabel={t('student.training.plan_change.label')}
            multiline
            numberOfLines={4}
            onChangeText={(v) => {
              setRequestText(v);
              setFieldError(null);
              setSuccessMsg(null);
            }}
            placeholder={t('student.training.plan_change.placeholder')}
            placeholderTextColor={palette.icon}
            style={[
              styles.multilineInput,
              {
                backgroundColor: palette.background,
                borderColor: fieldError ? '#b3261e' : palette.icon,
                color: palette.text,
              },
            ]}
            testID="student.training.planChangeForm.input"
            value={requestText}
          />

          {fieldError ? (
            <View accessibilityLiveRegion="polite">
              <Text style={styles.inlineError} testID="student.training.planChangeForm.error">
                {fieldError}
              </Text>
            </View>
          ) : null}

          {successMsg ? (
            <View accessibilityLiveRegion="polite">
              <Text
                style={[styles.successText, { color: palette.tint }]}
                testID="student.training.planChangeForm.success">
                {successMsg}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting}
            onPress={() => {
              void onSubmit();
            }}
            style={[
              styles.primaryButton,
              { backgroundColor: isSubmitting ? palette.icon : palette.tint },
            ]}
            testID="student.training.planChangeForm.submitButton">
            {isSubmitting ? (
              <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting')} color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>{t('student.training.plan_change.cta')}</Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 16,
  },
  centered: {
    alignSelf: 'center',
    marginVertical: 16,
  },
  offlineBanner: {
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  offlineBannerText: {
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
    padding: 16,
  },
  cardTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
  cardMeta: {
    fontSize: 13,
    lineHeight: 18,
  },
  infoBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  infoText: {
    fontSize: 13,
    lineHeight: 18,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  multilineInput: {
    borderRadius: 10,
    borderWidth: 1.5,
    fontSize: 14,
    minHeight: 96,
    padding: 12,
    textAlignVertical: 'top',
  },
  inlineError: {
    color: '#b3261e',
    fontSize: 13,
  },
  successText: {
    fontSize: 13,
    fontWeight: '600',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  emptyState: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 32,
  },
  emptyTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  writeLock: {
    fontSize: 13,
  },
});
