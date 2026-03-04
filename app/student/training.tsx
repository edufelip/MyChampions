/**
 * SC-210 Student Training Tracking
 * Route: /student/training
 *
 * Visual refresh (2026-03-04): playful training dashboard style aligned with auth/home/nutrition family.
 * Keeps BL-008 offline/write-lock and D-071 assigned-plan change-request behavior.
 */
import { Stack } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { resolveOfflineDisplayState } from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { usePlans } from '@/features/plans/use-plans';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

type CalendarDay = {
  dayLabel: string;
  dayNumber: string;
  isToday: boolean;
};

function getWeekStrip(locale: string): CalendarDay[] {
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
      dayLabel,
      dayNumber: String(date.getDate()),
      isToday: date.toDateString() === today.toDateString(),
    };
  });
}

export default function StudentTrainingScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const isDark = colorScheme === 'dark';
  const { t, locale } = useTranslation();
  const { currentUser } = useAuthSession();

  const networkStatus = useNetworkStatus();
  const offlineDisplay = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  const { state: plansState, submitChangeRequest, validateChangeRequest } = usePlans(Boolean(currentUser));

  const assignedTrainingPlan =
    plansState.kind === 'ready'
      ? plansState.plans.find(
          (plan) => plan.planType === 'training' && plan.sourceKind === 'assigned' && !plan.isArchived
        ) ?? null
      : null;

  const hasActiveTrainingAssignment = assignedTrainingPlan !== null;

  const weekStrip = useMemo(() => getWeekStrip(locale), [locale]);

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: isDark ? '#221410' : '#fff5f0' }]}
      contentContainerStyle={styles.content}
      testID="student.training.screen">
      <Stack.Screen options={{ title: t('student.training.title'), headerShown: false }} />

      <View
        pointerEvents="none"
        style={[styles.blob, styles.blobTopLeft, { backgroundColor: isDark ? '#5f4f29' : '#ffeca1' }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.blob,
          styles.blobBottomRight,
          { backgroundColor: isDark ? '#2e5b4a' : '#a1e8cc' },
        ]}
      />

      <View style={[styles.shell, { backgroundColor: isDark ? '#00000033' : '#ffffff66' }]}> 
        <View style={styles.headerRow}>
          <Text style={[styles.pageTitle, { color: palette.text }]}>{t('student.training.title')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('student.training.calendar.cta')}
            onPress={() => {
              void 0;
            }}
            style={({ pressed }) => [
              styles.calendarButton,
              {
                backgroundColor: isDark ? '#1f2937' : '#ffffff',
                transform: [{ scale: pressed ? 0.96 : 1 }],
              },
            ]}
            testID="student.training.calendarButton">
            <MaterialIcons color={palette.text} name="calendar-today" size={20} />
          </Pressable>
        </View>

        {offlineDisplay.showOfflineBanner ? (
          <View style={styles.offlineBanner} testID="student.training.offlineBanner" accessibilityRole="alert">
            <MaterialIcons color="#ef4444" name="cloud-off" size={18} />
            <Text style={styles.offlineBannerText}>{t('offline.banner')}</Text>
          </View>
        ) : null}

        <View style={styles.weekStrip}>
          {weekStrip.map((day) => (
            <View
              key={`${day.dayLabel}-${day.dayNumber}`}
              style={day.isToday ? styles.weekDayActive : styles.weekDay}
              testID={day.isToday ? 'student.training.weekDay.today' : undefined}>
              <Text style={day.isToday ? styles.weekDayLabelActive : styles.weekDayLabel}>{day.dayLabel}</Text>
              <Text style={day.isToday ? styles.weekDayNumberActive : styles.weekDayNumber}>{day.dayNumber}</Text>
            </View>
          ))}
        </View>

        {plansState.kind === 'loading' ? (
          <View style={[styles.card, styles.loadingCard]} testID="student.training.plansLoading">
            <ActivityIndicator accessibilityLabel={t('a11y.loading.default')} color="#ff7b72" />
          </View>
        ) : hasActiveTrainingAssignment ? (
          <View style={styles.sectionStack}>
            <View style={styles.readOnlyCard} testID="student.training.assignedPlanNotice">
              <Text style={styles.readOnlyLabel}>{t('student.training.assigned_plan.read_only_notice')}</Text>
            </View>

            <View style={[styles.card, styles.sessionCard]} testID="student.training.sessionSummary">
              <View style={styles.sessionIconBubble}>
                <MaterialIcons color="#ff7b72" name="fitness-center" size={34} />
              </View>
              <Text style={[styles.sessionTitle, { color: palette.text }]}>{t('student.training.session.title')}</Text>
              <Text style={[styles.sessionBody, { color: palette.icon }]}>{t('student.training.session.body')}</Text>
            </View>

            <PlanChangeRequestForm
              planId={assignedTrainingPlan.id}
              palette={palette}
              t={t}
              isWriteLocked={isWriteLocked}
              submitChangeRequest={submitChangeRequest}
              validateChangeRequest={validateChangeRequest}
            />
          </View>
        ) : (
          <View style={[styles.card, styles.emptyCard]} testID="student.training.emptyState">
            <View style={styles.emptyIconWrap}>
              <View style={styles.emptyIconInnerBlob} />
              <MaterialIcons color="#ff7b72" name="directions-run" size={76} />
            </View>

            <Text style={[styles.emptyTitle, { color: palette.text }]}>{t('student.training.empty.title')}</Text>
            <Text style={[styles.emptyBody, { color: palette.icon }]}>{t('student.training.empty.body')}</Text>

              <Pressable
                accessibilityRole="button"
                disabled={isWriteLocked}
                onPress={() => Alert.alert(t('student.training.empty.cta'))}
                style={({ pressed }) => [
                styles.primaryPillButton,
                {
                  backgroundColor: '#ff7b72',
                  opacity: isWriteLocked ? 0.6 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
              testID="student.training.emptyCta">
              <MaterialIcons color="#ffffff" name="add-circle" size={20} />
              <Text style={styles.primaryPillButtonText}>{t('student.training.empty.cta')}</Text>
            </Pressable>

            {isWriteLocked ? <Text style={styles.writeLockText}>{t('offline.write_lock')}</Text> : null}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

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
          ? t('student.training.plan_change.validation.required')
          : t('student.training.plan_change.validation.too_short')
      );
      return;
    }

    setIsSubmitting(true);
    setFieldError(null);
    setSuccessMsg(null);

    const result = await submitChangeRequest(planId, 'training', requestText);
    setIsSubmitting(false);

    if ('data' in result) {
      setRequestText('');
      setSuccessMsg(t('student.training.plan_change.success'));
      return;
    }

    switch (result.error) {
      case 'plan_not_found':
        setFieldError(t('student.training.plan_change.error.plan_not_found'));
        break;
      case 'no_active_assignment':
        setFieldError(t('student.training.plan_change.error.no_active_assignment'));
        break;
      case 'network':
        setFieldError(t('student.training.plan_change.error.network'));
        break;
      default:
        setFieldError(t('student.training.plan_change.error.unknown'));
    }
  };

  return (
    <View style={[styles.card, styles.planChangeCard]} testID="student.training.planChangeForm">
      <Text style={[styles.planChangeTitle, { color: palette.text }]}>{t('student.training.plan_change.title')}</Text>

      {isWriteLocked ? (
        <Text style={styles.writeLockText}>{t('offline.write_lock')}</Text>
      ) : (
        <>
          <Text style={[styles.planChangeLabel, { color: palette.text }]}>{t('student.training.plan_change.label')}</Text>
          <TextInput
            accessibilityLabel={t('student.training.plan_change.label')}
            multiline
            numberOfLines={4}
            onChangeText={(value) => {
              setRequestText(value);
              setFieldError(null);
              setSuccessMsg(null);
            }}
            placeholder={t('student.training.plan_change.placeholder')}
            placeholderTextColor={palette.icon}
            style={[styles.multilineInput, fieldError ? styles.textInputError : null]}
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
              <Text style={styles.successText} testID="student.training.planChangeForm.success">
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
            style={({ pressed }) => [
              styles.primaryPillButton,
              {
                backgroundColor: '#ff7b72',
                opacity: isSubmitting ? 0.7 : 1,
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
            ]}
            testID="student.training.planChangeForm.submitButton">
            {isSubmitting ? (
              <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting')} color="#ffffff" />
            ) : (
              <Text style={styles.primaryPillButtonText}>{t('student.training.plan_change.cta')}</Text>
            )}
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
  blob: {
    borderRadius: 999,
    opacity: 0.6,
    position: 'absolute',
  },
  blobTopLeft: {
    height: 250,
    left: -70,
    top: -30,
    width: 250,
  },
  blobBottomRight: {
    bottom: 20,
    height: 300,
    right: -90,
    width: 300,
  },
  shell: {
    borderRadius: 28,
    flex: 1,
    marginHorizontal: 16,
    marginTop: 18,
    paddingBottom: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  pageTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  calendarButton: {
    alignItems: 'center',
    borderRadius: 20,
    elevation: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  offlineBanner: {
    alignItems: 'center',
    backgroundColor: '#fee2e2',
    borderColor: '#fecaca',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  offlineBannerText: {
    color: '#b91c1c',
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  weekStrip: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    elevation: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  weekDay: {
    alignItems: 'center',
    borderRadius: 999,
    height: 56,
    justifyContent: 'center',
    width: 44,
  },
  weekDayActive: {
    alignItems: 'center',
    backgroundColor: '#ff7b72',
    borderRadius: 999,
    height: 64,
    justifyContent: 'center',
    width: 52,
  },
  weekDayLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
  },
  weekDayLabelActive: {
    color: '#ffffffcc',
    fontSize: 11,
    fontWeight: '600',
  },
  weekDayNumber: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },
  weekDayNumberActive: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  sectionStack: {
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffffee',
    borderColor: '#f1f5f9',
    borderRadius: 30,
    borderWidth: 1,
    elevation: 1,
    padding: 16,
  },
  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 140,
  },
  readOnlyCard: {
    backgroundColor: '#fff7ed',
    borderColor: '#fed7aa',
    borderRadius: 18,
    borderWidth: 1,
    padding: 12,
  },
  readOnlyLabel: {
    color: '#9a3412',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  sessionCard: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 22,
  },
  sessionIconBubble: {
    alignItems: 'center',
    backgroundColor: '#ffe4e1',
    borderRadius: 38,
    height: 76,
    justifyContent: 'center',
    width: 76,
  },
  sessionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  sessionBody: {
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 300,
    textAlign: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  emptyIconWrap: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#fff5f0',
    borderRadius: 96,
    borderWidth: 8,
    height: 192,
    justifyContent: 'center',
    marginBottom: 2,
    position: 'relative',
    width: 192,
  },
  emptyIconInnerBlob: {
    backgroundColor: '#a1e8cc66',
    borderRadius: 64,
    height: 128,
    position: 'absolute',
    right: 18,
    top: 14,
    width: 128,
  },
  emptyTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 34,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 6,
    maxWidth: 300,
    textAlign: 'center',
  },
  planChangeCard: {
    gap: 10,
  },
  planChangeTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 19,
    fontWeight: '700',
  },
  planChangeLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  multilineInput: {
    backgroundColor: '#f8fafc',
    borderColor: 'transparent',
    borderRadius: 16,
    borderWidth: 2,
    color: '#0f172a',
    fontSize: 14,
    minHeight: 104,
    padding: 12,
    textAlignVertical: 'top',
  },
  textInputError: {
    borderColor: '#b3261e',
  },
  inlineError: {
    color: '#b3261e',
    fontSize: 13,
    lineHeight: 18,
  },
  successText: {
    color: '#16a34a',
    fontSize: 13,
    fontWeight: '700',
  },
  primaryPillButton: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
    width: '100%',
  },
  primaryPillButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  writeLockText: {
    color: '#b3261e',
    fontSize: 13,
    lineHeight: 18,
  },
});
