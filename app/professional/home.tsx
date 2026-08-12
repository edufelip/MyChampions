/**
 * SC-204 Professional Home Dashboard
 * Route: /professional/home
 *
 * Control center for professionals:
 *  - Invite code display, share, and rotation (with confirmation)
 *  - Active student count widget
 *  - Subscription pre-lapse warning + entitlement lock notice
 *  - CTAs to student roster and subscription (card)
 *  - Offline read-only banner + write-lock feedback
 */
import { MaterialIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsRadius, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useConnections } from '@/features/connections/use-connections';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
  type StaleElapsed,
} from '@/features/offline/offline.logic';
import { resolveLatestSyncTimestamp } from '@/features/offline/sync-timestamps.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import {
  buildProfessionalPlanChangeNotificationSummary,
  type ProfessionalPlanChangeNotificationSummary,
} from '@/features/plans/plan-change-request.logic';
import { getProfessionalPlanChangeRequests } from '@/features/plans/plan-source';
import { shareAdapter } from '@/features/platform/share-adapter';
import { resolvePrimaryInviteCodeSpecialty } from '@/features/professional/connection-invite.logic';
import { resolveProfessionalHomeAttention } from '@/features/professional/professional-home.logic';
import { canAccessNutritionSurface } from '@/features/professional/specialty.logic';
import { useInviteCode, useSpecialties } from '@/features/professional/use-professional';
import {
  resolveSubscriptionState,
  isPlanUpdateLocked,
} from '@/features/subscription/subscription.logic';
import { useSubscription } from '@/features/subscription/use-subscription';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

const emptyPlanChangeNotificationSummary: ProfessionalPlanChangeNotificationSummary = {
  pendingCount: 0,
  latestRequest: null,
  affectedStudentUids: [],
  planTypes: [],
};

export default function ProfessionalHomeScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { currentUser } = useAuthSession();
  const { width: viewportWidth } = useWindowDimensions();
  const usesDesktopLayout = viewportWidth >= 1024;
  const usesCompactMobileLayout = viewportWidth < 400;

  const { state: specialtiesState } = useSpecialties(Boolean(currentUser));
  const inviteSpecialty =
    specialtiesState.kind === 'ready'
      ? resolvePrimaryInviteCodeSpecialty(specialtiesState.specialties)
      : null;
  const canUseNutrition = canAccessNutritionSurface({
    role: 'professional',
    specialties: specialtiesState.kind === 'ready' ? specialtiesState.specialties : [],
  });
  const { state: codeState, rotate } = useInviteCode(Boolean(currentUser), inviteSpecialty);
  const { state: connectionsState, reload: reloadConnections } = useConnections(
    Boolean(currentUser),
  );
  const {
    entitlementStatus,
    professionalEntitlementRenewalRisk,
    activeStudentCount,
    isActiveStudentCountKnown,
    lastSyncedAtIso: subscriptionSyncedAtIso,
  } = useSubscription(currentUser?.uid ?? null, { loadProfessionalActiveStudentCount: true });
  const networkStatus = useNetworkStatus();
  const lastSyncedAtIso = resolveLatestSyncTimestamp([
    specialtiesState.kind === 'ready' ? specialtiesState.lastSyncedAtIso : null,
    codeState.kind === 'ready' ? codeState.lastSyncedAtIso : null,
    connectionsState.kind === 'ready' ? connectionsState.lastSyncedAtIso : null,
    subscriptionSyncedAtIso,
  ]);
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso,
  });
  const subState = resolveSubscriptionState({
    activeStudentCount,
    entitlementStatus,
    isExpiringSoon: professionalEntitlementRenewalRisk,
  });
  const isWriteLocked = isPlanUpdateLocked(subState) || offlineDisplay.showOfflineBanner;

  const [rotateError, setRotateError] = useState<string | null>(null);
  const [planChangeNotification, setPlanChangeNotification] =
    useState<ProfessionalPlanChangeNotificationSummary>(emptyPlanChangeNotificationSummary);
  const [planChangeState, setPlanChangeState] = useState<'loading' | 'ready' | 'error'>('loading');
  const planChangeLoadGenerationRef = useRef(0);

  const loadPlanChangeNotifications = useCallback(() => {
    const generation = planChangeLoadGenerationRef.current + 1;
    planChangeLoadGenerationRef.current = generation;

    if (!currentUser) {
      setPlanChangeNotification(emptyPlanChangeNotificationSummary);
      setPlanChangeState('loading');
      return () => {
        if (planChangeLoadGenerationRef.current === generation) {
          planChangeLoadGenerationRef.current += 1;
        }
      };
    }

    setPlanChangeState('loading');
    getProfessionalPlanChangeRequests()
      .then((requests) => {
        if (planChangeLoadGenerationRef.current === generation) {
          setPlanChangeNotification(buildProfessionalPlanChangeNotificationSummary(requests));
          setPlanChangeState('ready');
        }
      })
      .catch(() => {
        if (planChangeLoadGenerationRef.current === generation) {
          setPlanChangeNotification(emptyPlanChangeNotificationSummary);
          setPlanChangeState('error');
        }
      });

    return () => {
      if (planChangeLoadGenerationRef.current === generation) {
        planChangeLoadGenerationRef.current += 1;
      }
    };
  }, [currentUser]);

  useEffect(() => loadPlanChangeNotifications(), [loadPlanChangeNotifications]);

  function confirmRotate() {
    Alert.alert(
      t('pro.home.invite_code.rotate_confirm_title'),
      t('pro.home.invite_code.rotate_confirm_body'),
      [
        {
          text: t('pro.home.invite_code.rotate_confirm_no'),
          style: 'cancel',
        },
        {
          text: t('pro.home.invite_code.rotate_confirm_yes'),
          onPress: async () => {
            setRotateError(null);
            const err = await rotate();
            if (err) {
              setRotateError(t('pro.home.invite_code.rotate_error'));
            }
          },
        },
      ],
    );
  }

  async function handleShareCode(code: string) {
    await shareAdapter.shareText(code);
  }

  const codeValue =
    codeState.kind === 'ready' && codeState.displayCode.kind === 'active'
      ? codeState.displayCode.code.codeValue
      : null;
  const pendingConnections = useMemo(
    () =>
      connectionsState.kind === 'ready'
        ? connectionsState.connections.filter(
            (connection) => connection.status === 'pending_confirmation',
          )
        : [],
    [connectionsState],
  );
  const connectionSourceState =
    connectionsState.kind === 'ready'
      ? 'ready'
      : connectionsState.kind === 'error'
        ? 'error'
        : 'loading';
  const attentionState = resolveProfessionalHomeAttention({
    connectionRequestCount: pendingConnections.length,
    connectionState: connectionSourceState,
    planChangeRequestCount: planChangeNotification.pendingCount,
    planChangeState,
  });
  const unavailableValue = t('common.value.unavailable');
  const activeStudentLabel = isActiveStudentCountKnown
    ? String(activeStudentCount)
    : unavailableValue;
  const pendingConnectionLabel =
    connectionsState.kind === 'ready' ? String(pendingConnections.length) : unavailableValue;

  function reloadAttention() {
    reloadConnections();
    loadPlanChangeNotifications();
  }

  return (
    <DsScreen
      scheme={scheme}
      contentWidth="wide"
      withBlobs={false}
      testID="pro.home.screen"
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ title: t('pro.home.title'), headerShown: false }} />

      <View style={styles.heroWrap}>
        <Text style={[styles.screenTitle, { color: theme.color.textPrimary }]}>
          {t('pro.home.title')}
        </Text>
        <Text style={[styles.screenSubtitle, { color: theme.color.textSecondary }]}>
          {t('pro.home.subtitle')}
        </Text>
        {subState.isPreLapseWarningVisible || isActiveStudentCountKnown ? (
          <View
            style={[
              styles.contextPill,
              {
                backgroundColor: subState.isPreLapseWarningVisible
                  ? theme.color.warningSoft
                  : theme.color.accentPrimarySoft,
                borderColor: subState.isPreLapseWarningVisible
                  ? theme.color.warning
                  : theme.color.accentPrimary,
              },
            ]}
          >
            <MaterialIcons
              name={subState.isPreLapseWarningVisible ? 'warning-amber' : 'verified-user'}
              size={16}
              color={
                subState.isPreLapseWarningVisible ? theme.color.warning : theme.color.accentPrimary
              }
            />
            <Text
              style={[
                styles.contextPillText,
                {
                  color: subState.isPreLapseWarningVisible
                    ? theme.color.warning
                    : theme.color.accentPrimary,
                },
              ]}
            >
              {subState.isPreLapseWarningVisible
                ? t('pro.subscription.pre_lapse.title')
                : t('pro.subscription.cap_usage')
                    .replace('{count}', activeStudentLabel)
                    .replace('{limit}', '10')}
            </Text>
          </View>
        ) : null}
      </View>

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={buildOfflineText(offlineDisplay.staleElapsed, t)}
          testID="pro.home.offlineBanner"
        />
      ) : null}

      {subState.isPreLapseWarningVisible ? (
        <DsCard
          scheme={scheme}
          variant="warning"
          testID="pro.home.subscriptionWarning"
          style={styles.warningBanner}
        >
          <Text style={[styles.warningText, { color: theme.color.textPrimary }]}>
            {t('pro.home.subscription.warning')}
          </Text>
          <DsPillButton
            scheme={scheme}
            label={t('pro.home.subscription.cta_renew')}
            variant="outline"
            size="sm"
            onPress={() => router.push('/professional/subscription')}
            fullWidth={false}
            style={styles.warningCta}
            testID="pro.home.subscriptionRenewCta"
          />
        </DsCard>
      ) : null}

      {isWriteLocked && !offlineDisplay.showOfflineBanner ? (
        <DsCard scheme={scheme} testID="pro.home.entitlementLock">
          <Text style={[styles.errorText, { color: theme.color.danger }]}>
            {t('pro.home.entitlement_lock')}
          </Text>
        </DsCard>
      ) : null}

      <View
        style={[styles.dashboardColumns, usesDesktopLayout ? styles.dashboardColumnsDesktop : null]}
      >
        <View
          style={[styles.primaryColumn, usesDesktopLayout ? styles.primaryColumnDesktop : null]}
          testID="pro.home.primaryColumn"
        >
          <Text style={[styles.sectionTitle, { color: theme.color.textPrimary }]}>
            {t('pro.home.overview')}
          </Text>
          <View style={[styles.statsRow, usesCompactMobileLayout ? styles.statsRowCompact : null]}>
            <SummaryLinkCard
              label={t('pro.home.active_students')}
              value={activeStudentLabel}
              scheme={scheme}
              iconName="groups"
              onPress={() => router.push('/(tabs)/students')}
              compact={usesCompactMobileLayout}
              testID="pro.home.activeStudents"
            />
            <SummaryLinkCard
              label={t('pro.home.connection_requests')}
              value={pendingConnectionLabel}
              scheme={scheme}
              iconName="person-add-alt-1"
              onPress={() => router.push('/professional/pending')}
              compact={usesCompactMobileLayout}
              testID="pro.home.pendingConnections"
            />
          </View>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.color.textPrimary }]}>
              {t('pro.home.needs_attention')}
            </Text>
            {attentionState.hasLoadError ? (
              <Pressable
                accessibilityRole="button"
                onPress={reloadAttention}
                style={({ pressed }) => [styles.retryLink, pressed ? styles.pressed : null]}
                testID="pro.home.attentionRetry"
              >
                <MaterialIcons
                  name="refresh"
                  size={16}
                  color={theme.color.accentPrimary}
                  aria-hidden
                />
                <Text style={[styles.retryLinkText, { color: theme.color.accentPrimary }]}>
                  {t('common.error.retry')}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {attentionState.hasConnectionRequests ? (
            <TaskCard
              scheme={scheme}
              iconName="person-add-alt-1"
              title={t('pro.home.connection_requests')}
              body={t('pro.home.connection_requests_body').replace(
                '{count}',
                String(pendingConnections.length),
              )}
              cta={t('pro.home.cta_pending')}
              compact={usesCompactMobileLayout}
              onPress={() => router.push('/professional/pending')}
              testID="pro.home.connectionRequestTask"
            />
          ) : null}

          {attentionState.hasPlanChangeRequests && planChangeNotification.latestRequest ? (
            <TaskCard
              scheme={scheme}
              iconName="notifications-active"
              title={t('pro.home.plan_change_notification.title')}
              body={t('pro.home.plan_change_notification.body')
                .replace('{count}', String(planChangeNotification.pendingCount))
                .replace('{studentUid}', planChangeNotification.latestRequest.studentUid)}
              cta={t('pro.home.plan_change_notification.cta')}
              compact={usesCompactMobileLayout}
              onPress={() => {
                router.push(
                  `/professional/student-profile?studentId=${encodeURIComponent(
                    planChangeNotification.latestRequest?.studentUid ?? '',
                  )}`,
                );
              }}
              testID="pro.home.planChangeNotification"
            />
          ) : null}

          {attentionState.showAllCaughtUp ? (
            <DsCard
              scheme={scheme}
              variant="muted"
              style={styles.clearCard}
              testID="pro.home.allCaughtUp"
            >
              <View style={[styles.clearIcon, { backgroundColor: theme.color.successSoft }]}>
                <MaterialIcons name="done-all" size={20} color={theme.color.success} />
              </View>
              <View style={styles.clearCopy}>
                <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>
                  {t('pro.home.all_caught_up_title')}
                </Text>
                <Text style={[styles.cardSubtitle, { color: theme.color.textSecondary }]}>
                  {t('pro.home.all_caught_up_body')}
                </Text>
              </View>
            </DsCard>
          ) : null}

          {attentionState.isLoading && !attentionState.hasAnyAttention ? (
            <DsCard
              scheme={scheme}
              variant="muted"
              style={styles.loadingCard}
              testID="pro.home.attentionLoading"
            >
              <ActivityIndicator color={theme.color.accentPrimary} />
              <Text style={[styles.cardSubtitle, { color: theme.color.textSecondary }]}>
                {t('pro.home.attention_loading')}
              </Text>
            </DsCard>
          ) : null}

          {attentionState.hasLoadError ? (
            <DsCard
              scheme={scheme}
              variant="warning"
              style={styles.inlineIssue}
              testID="pro.home.attentionError"
            >
              <MaterialIcons name="info-outline" size={18} color={theme.color.warning} />
              <Text
                style={[
                  styles.cardSubtitle,
                  styles.inlineIssueText,
                  { color: theme.color.textPrimary },
                ]}
              >
                {t('pro.home.attention_error')}
              </Text>
            </DsCard>
          ) : null}

          <Text
            style={[styles.sectionTitle, styles.manageTitle, { color: theme.color.textPrimary }]}
          >
            {t('pro.home.manage')}
          </Text>
          <View
            style={[
              styles.quickActionsGrid,
              usesDesktopLayout ? styles.quickActionsGridDesktop : null,
            ]}
          >
            <QuickActionCard
              scheme={scheme}
              iconName="groups"
              label={t('pro.home.cta_roster')}
              onPress={() => router.push('/(tabs)/students')}
              usesGridLayout={usesDesktopLayout}
              testID="pro.home.rosterCta"
            />
            {canUseNutrition ? (
              <QuickActionCard
                scheme={scheme}
                iconName="restaurant-menu"
                label={t('pro.home.cta_nutrition')}
                onPress={() => router.push('/professional/nutrition')}
                usesGridLayout={usesDesktopLayout}
                testID="pro.home.nutritionCta"
              />
            ) : null}
            <QuickActionCard
              scheme={scheme}
              iconName="fitness-center"
              label={t('pro.home.cta_training')}
              onPress={() => router.push('/professional/training')}
              usesGridLayout={usesDesktopLayout}
              testID="pro.home.trainingCta"
            />
          </View>
        </View>

        <View
          style={[styles.secondaryColumn, usesDesktopLayout ? styles.secondaryColumnDesktop : null]}
          testID="pro.home.secondaryColumn"
        >
          <DsCard
            scheme={scheme}
            testID="pro.home.inviteCodeCard"
            style={styles.inviteCard}
            variant="muted"
          >
            <View style={styles.cardHeader}>
              <View
                style={[
                  styles.cardHeaderIconWrap,
                  {
                    backgroundColor: theme.color.accentPrimarySoft,
                    borderColor: theme.color.accentPrimary,
                  },
                ]}
              >
                <MaterialIcons name="group-add" size={18} color={theme.color.accentPrimary} />
              </View>
              <View style={styles.cardHeaderCopy}>
                <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>
                  {t('pro.home.invite_code.title')}
                </Text>
                <Text style={[styles.cardSubtitle, { color: theme.color.textSecondary }]}>
                  {t('pro.home.invite_code.careful_sharing')}
                </Text>
              </View>
            </View>

            {codeState.kind === 'loading' ? (
              <ActivityIndicator
                testID="pro.home.inviteCodeLoading"
                accessibilityLabel={t('a11y.loading.invite_code')}
                color={theme.color.accentPrimary}
              />
            ) : codeState.kind === 'ready' ? (
              <>
                {codeValue ? (
                  <Text
                    style={[styles.inviteCode, { color: theme.color.accentPrimary }]}
                    testID="pro.home.inviteCodeValue"
                    accessibilityLabel={`${t('pro.home.invite_code.title')}: ${codeValue}`}
                  >
                    {codeValue}
                  </Text>
                ) : (
                  <Text style={[styles.meta, { color: theme.color.textSecondary }]}>
                    {t('pro.home.invite_code.empty')}
                  </Text>
                )}

                {rotateError ? (
                  <Text style={[styles.errorText, { color: theme.color.danger }]}>
                    {rotateError}
                  </Text>
                ) : null}

                <View style={styles.codeActionsRow}>
                  {codeValue ? (
                    <DsPillButton
                      scheme={scheme}
                      variant="primary"
                      size="xs"
                      label={t('pro.home.invite_code.share')}
                      onPress={() => {
                        void handleShareCode(codeValue);
                      }}
                      fullWidth={false}
                      style={styles.outlineButtonCompact}
                      testID="pro.home.shareCodeCta"
                    />
                  ) : null}

                  <DsPillButton
                    scheme={scheme}
                    variant="primary"
                    size="xs"
                    label={t('pro.home.invite_code.rotate')}
                    onPress={confirmRotate}
                    fullWidth={false}
                    style={styles.outlineButtonCompact}
                    testID="pro.home.rotateCodeCta"
                  />
                </View>
              </>
            ) : codeState.kind === 'error' ? (
              <Text style={[styles.errorText, { color: theme.color.danger }]}>
                {t('pro.home.error')}
              </Text>
            ) : specialtiesState.kind === 'loading' ? (
              <ActivityIndicator color={theme.color.accentPrimary} />
            ) : (
              <View style={styles.inviteSetup} testID="pro.home.inviteSpecialtyRequired">
                <Text style={[styles.meta, { color: theme.color.textSecondary }]}>
                  {t('pro.home.invite_code.specialty_required')}
                </Text>
                <DsPillButton
                  scheme={scheme}
                  variant="outline"
                  size="xs"
                  label={t('pro.home.invite_code.add_specialty')}
                  onPress={() => router.push('/professional/specialty')}
                  fullWidth={false}
                  testID="pro.home.inviteSpecialtyCta"
                />
              </View>
            )}
          </DsCard>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/professional/subscription')}
            style={({ pressed }) => [
              styles.subscriptionCard,
              { backgroundColor: theme.color.surface, borderColor: theme.color.border },
              pressed ? styles.pressed : null,
            ]}
            testID="pro.home.subscriptionCta"
          >
            <View
              style={[styles.subscriptionIcon, { backgroundColor: theme.color.accentPrimarySoft }]}
            >
              <MaterialIcons
                name="workspace-premium"
                size={22}
                color={theme.color.accentPrimary}
                aria-hidden
              />
            </View>
            <View style={styles.subscriptionContent}>
              <Text style={[styles.subscriptionTitle, { color: theme.color.textPrimary }]}>
                {t('pro.subscription.title')}
              </Text>
              <Text style={[styles.subscriptionSubtitle, { color: theme.color.textSecondary }]}>
                {isActiveStudentCountKnown
                  ? t('pro.subscription.cap_usage')
                      .replace('{count}', activeStudentLabel)
                      .replace('{limit}', '10')
                  : t('pro.home.subscription_status_unknown')}
              </Text>
            </View>
            <MaterialIcons
              name="chevron-right"
              size={24}
              color={theme.color.textTertiary}
              aria-hidden
            />
          </Pressable>
        </View>
      </View>
    </DsScreen>
  );
}

function buildOfflineText(
  staleElapsed: StaleElapsed | null,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (!staleElapsed) {
    return t('offline.banner');
  }

  const stalePart =
    staleElapsed.unit === 'minutes'
      ? t('offline.stale_minutes').replace('{value}', String(staleElapsed.value))
      : staleElapsed.unit === 'hours'
        ? t('offline.stale_hours').replace('{value}', String(staleElapsed.value))
        : t('offline.stale_days').replace('{value}', String(staleElapsed.value));

  return `${t('offline.banner')} • ${stalePart}`;
}

function SummaryLinkCard({
  compact,
  label,
  value,
  scheme,
  iconName,
  onPress,
  testID,
}: {
  compact: boolean;
  label: string;
  value: string;
  scheme: 'light' | 'dark';
  iconName: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  testID: string;
}) {
  const theme = getDsTheme(scheme);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${value} ${label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.statCard,
        compact ? styles.statCardCompact : null,
        { backgroundColor: theme.color.surface, borderColor: theme.color.border },
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <View style={styles.statTopRow}>
        <View style={[styles.statIconWrap, { backgroundColor: theme.color.accentPrimarySoft }]}>
          <MaterialIcons color={theme.color.accentPrimary} name={iconName} size={18} />
        </View>
        <MaterialIcons color={theme.color.textTertiary} name="arrow-forward" size={18} />
      </View>
      <Text style={[styles.statValue, { color: theme.color.accentPrimary }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: theme.color.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function TaskCard({
  body,
  compact,
  cta,
  iconName,
  onPress,
  scheme,
  testID,
  title,
}: {
  body: string;
  compact: boolean;
  cta: string;
  iconName: keyof typeof MaterialIcons.glyphMap;
  onPress: () => void;
  scheme: 'light' | 'dark';
  testID: string;
  title: string;
}) {
  const theme = getDsTheme(scheme);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.taskCard,
        compact ? styles.taskCardCompact : null,
        {
          backgroundColor: theme.color.accentPrimarySoft,
          borderColor: theme.color.accentPrimary,
        },
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <View style={[styles.taskIcon, { backgroundColor: theme.color.accentPrimary }]}>
        <MaterialIcons name={iconName} size={20} color={theme.color.onAccent} aria-hidden />
      </View>
      <View style={styles.taskCopy}>
        <Text style={[styles.cardTitle, { color: theme.color.textPrimary }]}>{title}</Text>
        <Text style={[styles.cardSubtitle, { color: theme.color.textSecondary }]}>{body}</Text>
      </View>
      <View style={[styles.taskCta, compact ? styles.taskCtaCompact : null]}>
        <Text style={[styles.taskCtaText, { color: theme.color.accentPrimary }]}>{cta}</Text>
        <MaterialIcons
          name="chevron-right"
          size={20}
          color={theme.color.accentPrimary}
          aria-hidden
        />
      </View>
    </Pressable>
  );
}

function QuickActionCard({
  iconName,
  label,
  onPress,
  scheme,
  testID,
  usesGridLayout,
}: {
  iconName: keyof typeof MaterialIcons.glyphMap;
  label: string;
  onPress: () => void;
  scheme: 'light' | 'dark';
  testID: string;
  usesGridLayout: boolean;
}) {
  const theme = getDsTheme(scheme);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickActionCard,
        usesGridLayout ? styles.quickActionCardDesktop : null,
        { backgroundColor: theme.color.surface, borderColor: theme.color.border },
        pressed ? styles.pressed : null,
      ]}
      testID={testID}
    >
      <View style={[styles.quickActionIcon, { backgroundColor: theme.color.accentPrimarySoft }]}>
        <MaterialIcons name={iconName} size={20} color={theme.color.accentPrimary} aria-hidden />
      </View>
      <Text style={[styles.quickActionLabel, { color: theme.color.textPrimary }]}>{label}</Text>
      <MaterialIcons name="chevron-right" size={20} color={theme.color.textTertiary} aria-hidden />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: DsSpace.md,
    paddingBottom: DsSpace.xxl,
    paddingHorizontal: DsSpace.lg,
    paddingTop: DsSpace.lg,
  },
  heroWrap: {
    gap: DsSpace.xs,
    marginBottom: DsSpace.xs,
  },
  screenTitle: {
    ...DsTypography.title,
    fontFamily: Fonts.rounded,
    fontSize: 30,
    lineHeight: 36,
  },
  screenSubtitle: {
    ...DsTypography.body,
    maxWidth: 680,
  },
  contextPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: DsRadius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
    paddingHorizontal: DsSpace.sm,
    paddingVertical: 6,
  },
  contextPillText: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  warningBanner: {
    gap: 6,
    borderRadius: DsRadius.lg,
  },
  warningCta: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  warningText: {
    ...DsTypography.caption,
  },
  dashboardColumns: {
    gap: DsSpace.lg,
  },
  dashboardColumnsDesktop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },
  primaryColumn: {
    gap: DsSpace.sm,
    minWidth: 0,
  },
  primaryColumnDesktop: {
    flex: 1.65,
  },
  secondaryColumn: {
    gap: DsSpace.md,
    minWidth: 0,
  },
  secondaryColumnDesktop: {
    flex: 1,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: DsSpace.md,
  },
  sectionTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  manageTitle: {
    marginTop: DsSpace.md,
  },
  statsRow: { flexDirection: 'row', gap: DsSpace.sm },
  statsRowCompact: { flexDirection: 'column' },
  statCard: {
    borderWidth: 1,
    borderRadius: DsRadius.lg,
    flex: 1,
    gap: 6,
    minHeight: 126,
    minWidth: 0,
    padding: DsSpace.md,
  },
  statCardCompact: {
    flex: 0,
    width: '100%',
  },
  statTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statIconWrap: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  statValue: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
  },
  statLabel: { fontSize: 13, fontWeight: '600' },
  retryLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    minHeight: 44,
    paddingHorizontal: DsSpace.xs,
  },
  retryLinkText: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.76,
  },
  taskCard: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: DsSpace.sm,
    minHeight: 78,
    padding: DsSpace.md,
  },
  taskCardCompact: {
    flexWrap: 'wrap',
  },
  taskIcon: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  taskCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  taskCta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  taskCtaCompact: {
    flexBasis: '100%',
    justifyContent: 'flex-end',
    paddingLeft: 46,
    paddingTop: DsSpace.xs,
  },
  taskCtaText: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  clearCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  clearIcon: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  clearCopy: {
    flex: 1,
    gap: 2,
  },
  loadingCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: DsSpace.sm,
    minHeight: 72,
  },
  inlineIssue: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  inlineIssueText: {
    flex: 1,
  },
  quickActionsGrid: {
    gap: DsSpace.sm,
  },
  quickActionsGridDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  quickActionCard: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: DsSpace.sm,
    minHeight: 64,
    minWidth: 0,
    padding: DsSpace.sm,
    width: '100%',
  },
  quickActionCardDesktop: {
    flexBasis: '48%',
    flexGrow: 1,
    width: 'auto',
  },
  quickActionIcon: {
    alignItems: 'center',
    borderRadius: DsRadius.md,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  quickActionLabel: {
    flex: 1,
    fontFamily: Fonts.rounded,
    fontSize: 14,
    fontWeight: '700',
  },
  inviteCard: {
    borderRadius: DsRadius.xl,
    gap: DsSpace.sm,
    padding: DsSpace.md,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  cardHeaderIconWrap: {
    alignItems: 'center',
    borderRadius: DsRadius.pill,
    borderWidth: 1,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  cardHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontFamily: Fonts.rounded,
    fontSize: 16,
    fontWeight: '700',
  },
  cardSubtitle: {
    ...DsTypography.caption,
  },
  inviteCode: { fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center' },
  inviteSetup: {
    gap: DsSpace.sm,
  },
  codeActionsRow: { flexDirection: 'row', gap: DsSpace.sm },
  outlineButtonCompact: {
    flex: 1,
    minHeight: 48,
  },
  meta: { ...DsTypography.caption },
  errorText: { ...DsTypography.caption },
  subscriptionCard: {
    alignItems: 'center',
    borderRadius: DsRadius.xl,
    borderWidth: 1,
    flexDirection: 'row',
    gap: DsSpace.sm,
    minHeight: 92,
    padding: DsSpace.md,
  },
  subscriptionIcon: {
    alignItems: 'center',
    borderRadius: DsRadius.md,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  subscriptionContent: {
    flex: 1,
    justifyContent: 'center',
    gap: 3,
  },
  subscriptionTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts.rounded,
    fontSize: 16,
  },
  subscriptionSubtitle: {
    ...DsTypography.caption,
  },
});
