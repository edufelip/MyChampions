/**
 * SC-213 Account & Privacy Settings
 * Route: /settings/account  (re-exported from app/(tabs)/account.tsx for both roles)
 *
 * Production-ready settings screen covering:
 *   — Profile header (avatar initials, display name, email, role badge)
 *   — Account section: email display, change password, language switcher
 *   — Legal & Privacy section: privacy policy, terms of service
 *   — Support section: server-backed support dialog
 *   — Sign out
 *   — Danger zone: account deletion (FR-133, FR-157, BR-225, BR-231)
 *
 * Change-password flow:
 *   - Email/password accounts → server-backed password reset request → inline success/error
 *   - OAuth accounts (Google/Apple) → informational notice (no reset email)
 *
 * Language switcher:
 *   - Pushes to /settings/language-select (SC-222) via router.push.
 *   - Takes effect immediately in-session via LocaleContext (no app restart needed).
 *
 * Docs: docs/screens/v2/SC-213-account-privacy-settings.md
 * Refs: FR-133, FR-157, UC-002.5, AC-305–308, AC-310, BR-225, BR-231
 *       TC-304–307, TC-309
 */
import { useState } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { SupportModal } from '@/components/ds/patterns/SupportModal';
import { DsRadius, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import type { AuthProviderId } from '@/features/auth/auth-user';
import {
  requestPasswordResetFromSource,
  signOutFromSource,
} from '@/features/auth/account-auth-source';
import { E2E_AUTH_SESSION_UID } from '@/features/auth/e2e-auth-session';
import {
  deleteAccountAndDataFromSource,
  ProfileSourceError,
} from '@/features/auth/profile-source';

import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { resolveLatestSyncTimestamp } from '@/features/offline/sync-timestamps.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';
import { useLocale } from '@/localization/locale-context';

// ─── Constants ────────────────────────────────────────────────────────────────

const APP_VERSION: string =
  (Constants.expoConfig?.version as string | undefined) ?? '—';

// ─── Types ────────────────────────────────────────────────────────────────────

type DeleteRequestState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'error'; reason: 'network' | 'already_requested' | 'unauthenticated' | 'unknown' };

type PasswordResetState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'error' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveDisplayName(displayName: string | null, email: string | null): string {
  if (displayName && displayName.trim().length > 0) return displayName.trim();
  if (email) {
    const prefix = email.split('@')[0];
    if (prefix) return prefix;
  }
  return '—';
}

function resolveAvatarInitial(displayName: string | null, email: string | null): string {
  const name = resolveDisplayName(displayName, email);
  return (name[0] ?? '?').toUpperCase();
}

function isEmailPasswordAccount(authProviderIds: AuthProviderId[]): boolean {
  return authProviderIds.includes('email_password');
}

function resolveOAuthProviderLabel(authProviderIds: AuthProviderId[]): string {
  if (authProviderIds.includes('google')) return 'Google';
  if (authProviderIds.includes('apple')) return 'Apple';
  return 'your sign-in provider';
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AccountSettingsScreen() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const { t } = useTranslation();
  const router = useRouter();
  const { activeLocale } = useLocale();

  const {
    currentUser,
    lockedRole,
    clearSession,
    termsUrl,
    privacyPolicyUrl,
    lastProfileSyncedAtIso,
  } = useAuthSession();

  // ── Offline state ──────────────────────────────────────────────────────────
  const networkStatus = useNetworkStatus();
  const lastSyncedAtIso = resolveLatestSyncTimestamp([lastProfileSyncedAtIso]);
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  // ── Feature state ──────────────────────────────────────────────────────────
  const [deleteState, setDeleteState] = useState<DeleteRequestState>({ kind: 'idle' });
  const [passwordState, setPasswordState] = useState<PasswordResetState>({ kind: 'idle' });
  const [isPasswordConfirmVisible, setIsPasswordConfirmVisible] = useState(false);
  const [isSupportModalVisible, setIsSupportModalVisible] = useState(false);
  const [isSignOutConfirmVisible, setIsSignOutConfirmVisible] = useState(false);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);


  // ── Derived ────────────────────────────────────────────────────────────────
  const email = currentUser?.email ?? null;
  const displayName = resolveDisplayName(currentUser?.displayName ?? null, email);
  const avatarInitial = resolveAvatarInitial(currentUser?.displayName ?? null, email);
  const authProviderIds = currentUser?.authProviderIds ?? [];
  const isEmailUser = isEmailPasswordAccount(authProviderIds);
  const oauthProvider = resolveOAuthProviderLabel(authProviderIds);
  const isStudent = lockedRole === 'student';
  const isProfessional = lockedRole === 'professional';
  const roleBadgeLabel = isStudent
    ? t('settings.account.role.student')
    : t('settings.account.role.professional');
  const topInsetPadding = insets.top;
  const bottomNavigationInset = insets.bottom + 64;

  const isSubmittingDelete = deleteState.kind === 'pending';
  const isDeleteLocked = isSubmittingDelete || isWriteLocked;
  const isPasswordPending = passwordState.kind === 'pending';

  const deleteErrorMessage =
    deleteState.kind === 'error'
      ? deleteState.reason === 'network'
        ? t('settings.account.delete.error.network')
        : deleteState.reason === 'already_requested'
          ? t('settings.account.delete.error.already_requested')
          : deleteState.reason === 'unauthenticated'
            ? t('settings.account.delete.error.unauthenticated')
            : t('settings.account.delete.error.unknown')
      : null;

  // ── Handlers ───────────────────────────────────────────────────────────────

  function handleOpenPrivacyPolicy() {
    router.push({
      pathname: '/shared/webview',
      params: {
        url: privacyPolicyUrl,
        title: t('settings.account.privacy_policy.label') as string,
      },
    });
  }

  function handleOpenTerms() {
    router.push({
      pathname: '/shared/webview',
      params: {
        url: termsUrl,
        title: t('settings.account.terms.label') as string,
      },
    });
  }

  function handleContactSupport() {
    setIsSupportModalVisible(true);
  }

  function handleChangePassword() {
    if (!isEmailUser) {
      Alert.alert(
        '',
        t('settings.account.change_password.oauth_notice', { provider: oauthProvider }) as string,
        [{ text: 'OK' }]
      );
      return;
    }

    setPasswordState({ kind: 'idle' });
    setIsPasswordConfirmVisible(true);
  }

  async function submitPasswordReset() {
    if (!email) return;
    setIsPasswordConfirmVisible(false);
    setPasswordState({ kind: 'pending' });
    if (__DEV__ && currentUser?.uid === E2E_AUTH_SESSION_UID) {
      setPasswordState({ kind: 'success' });
      return;
    }
    try {
      await requestPasswordResetFromSource(email);
      setPasswordState({ kind: 'success' });
    } catch {
      setPasswordState({ kind: 'error' });
    }
  }

  function handleLanguagePicker() {
    router.push('/settings/language-select');
  }

  function handleSignOut() {
    setIsSignOutConfirmVisible(true);
  }

  function submitSignOut() {
    setIsSignOutConfirmVisible(false);
    void signOutFromSource().finally(() => clearSession());
  }

  function handleRequestDeletion() {
    setDeleteState({ kind: 'idle' });
    setIsDeleteConfirmVisible(true);
  }

  async function submitDeletionRequest() {
    setIsDeleteConfirmVisible(false);
    setDeleteState({ kind: 'pending' });
    try {
      await deleteAccountAndDataFromSource();
      try {
        await signOutFromSource();
      } catch {
        // Account deletion already succeeded; local session state must still be cleared.
      }
      clearSession();
      setDeleteState({ kind: 'success' });
    } catch (err) {
      if (err instanceof ProfileSourceError) {
        if (err.code === 'network') {
          setDeleteState({ kind: 'error', reason: 'network' });
        } else if (err.code === 'unauthenticated') {
          setDeleteState({ kind: 'error', reason: 'unauthenticated' });
        } else {
          setDeleteState({ kind: 'error', reason: 'unknown' });
        }
      } else {
        setDeleteState({ kind: 'error', reason: 'unknown' });
      }
    }
  }

  // ── Locale label for current language ─────────────────────────────────────
  // Reads from LocaleContext so the row updates immediately after returning
  // from the Language Select screen (SC-222) without needing an AsyncStorage read.
  const languageLabel =
    activeLocale === 'pt-BR'
      ? (t('settings.account.language.pt_br') as string)
      : activeLocale === 'es-ES'
        ? (t('settings.account.language.es_es') as string)
        : (t('settings.account.language.en_us') as string);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: theme.color.canvas, marginBottom: bottomNavigationInset }]}
      contentContainerStyle={[styles.content, { paddingTop: topInsetPadding + DsSpace.sm }]}
      testID="settings.account.screen">
      <Stack.Screen options={{ title: t('settings.account.title') as string, headerShown: false }} />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner') as string}
          testID="settings.account.offlineBanner"
        />
      ) : null}

      <View style={styles.heroWrap}>
        <Text style={[styles.screenTitle, { color: theme.color.textPrimary }]}>
          {t('settings.account.header_title')}
        </Text>
      </View>

      <View
        style={[
          styles.heroCard,
          {
            backgroundColor: isProfessional ? theme.color.accentPrimarySoft : theme.color.accentPrimarySoft,
            borderColor: isProfessional ? theme.color.accentPrimary : theme.color.accentPrimary,
            flexDirection: 'row',
            alignItems: 'center',
          },
        ]}
        testID="settings.account.profileCard">
        <View
          style={[
            styles.avatar,
            {
              backgroundColor: theme.color.surface,
              borderColor: isProfessional ? theme.color.accentPrimary : theme.color.accentPrimary,
            },
          ]}>
          <Text
            style={[
              styles.avatarInitial,
              { color: isProfessional ? theme.color.accentPrimary : theme.color.accentPrimary },
            ]}>
            {avatarInitial}
          </Text>
        </View>

        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, { color: theme.color.textPrimary }]} numberOfLines={1}>
            {displayName}
          </Text>
          {email ? (
            <Text
              style={[styles.profileEmail, { color: theme.color.textSecondary }]}
              numberOfLines={1}>
              {email}
            </Text>
          ) : null}

          <View style={styles.roleRow}>
            <View
              style={[
                styles.rolePill,
                { backgroundColor: isProfessional ? theme.color.accentPrimary : theme.color.accentPrimary },
              ]}>
              <Text style={[styles.rolePillText, { color: theme.color.surface }]}>
                {roleBadgeLabel}
              </Text>
            </View>
            {isProfessional ? (
              <Text
                style={[styles.freeTierText, { color: theme.color.textSecondary }]}
                numberOfLines={1}>
                {t('pro.subscription.free_tier')}
              </Text>
            ) : null}
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('settings.account.contact.label') as string}
          onPress={handleContactSupport}
          hitSlop={8}
          style={[styles.supportQuickButton, { backgroundColor: theme.color.surface, borderColor: theme.color.border }]}
          testID="settings.account.supportQuickCta">
          <MaterialIcons name="help-outline" size={20} color={theme.color.accentPrimary} />
        </Pressable>
      </View>

      {/* ── Account section ────────────────────────────────────────────── */}
      <SectionHeader label={t('settings.account.section.account') as string} theme={theme} />
      <View style={[styles.group, { backgroundColor: theme.color.surface, borderColor: theme.color.border }]}>
        <SettingsRow
          label={t('settings.account.email.label') as string}
          value={email ?? '—'}
          theme={theme}
          testID="settings.account.emailRow"
        />
        <RowDivider color={theme.color.border} />

        {/* Change password */}
        {passwordState.kind === 'success' ? (
          <View style={[styles.inlineBanner, { backgroundColor: theme.color.successSoft, borderColor: theme.color.success }]} testID="settings.account.passwordSuccess">
            <Text style={[styles.inlineBannerText, { color: theme.color.success }]}>
              {t('settings.account.change_password.success')}
            </Text>
          </View>
        ) : (
          <SettingsRow
            label={t('settings.account.change_password.label') as string}
            onPress={handleChangePassword}
            loading={isPasswordPending}
            theme={theme}
            testID="settings.account.changePasswordRow"
          />
        )}
        {isPasswordConfirmVisible ? (
          <View
            style={[styles.confirmCard, { backgroundColor: theme.color.accentPrimarySoft, borderColor: theme.color.accentPrimary }]}
            testID="settings.account.passwordConfirm">
            <Text style={[styles.confirmTitle, { color: theme.color.textPrimary }]}>
              {t('settings.account.change_password.confirm_title')}
            </Text>
            <Text style={[styles.confirmBody, { color: theme.color.textSecondary }]}>
              {t('settings.account.change_password.confirm_body', { email: email ?? '' })}
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setIsPasswordConfirmVisible(false)}
                style={[styles.confirmButton, { borderColor: theme.color.border }]}
                testID="settings.account.passwordCancelCta">
                <Text style={[styles.confirmButtonText, { color: theme.color.textSecondary }]}>
                  {t('settings.account.change_password.confirm_no')}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={submitPasswordReset}
                style={[styles.confirmButton, { backgroundColor: theme.color.accentPrimary, borderColor: theme.color.accentPrimary }]}
                testID="settings.account.passwordConfirmCta">
                <Text style={[styles.confirmButtonText, { color: theme.color.surface }]}>
                  {t('settings.account.change_password.confirm_yes')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {passwordState.kind === 'error' ? (
          <Text style={[styles.rowError, { color: theme.color.danger }]} testID="settings.account.passwordError">
            {t('settings.account.change_password.error')}
          </Text>
        ) : null}

        <RowDivider color={theme.color.border} />
        <SettingsRow
          label={t('settings.account.language.label') as string}
          value={languageLabel}
          onPress={handleLanguagePicker}
          theme={theme}
          testID="settings.account.languageRow"
        />
      </View>

      {/* ── Sign out ───────────────────────────────────────────────────── */}
      <Pressable
        onPress={handleSignOut}
        style={[styles.signOutButton, { borderColor: theme.color.warning }]}
        accessibilityRole="button"
        testID="settings.account.signOutCta">
        <Text style={[styles.signOutText, { color: theme.color.warning }]}>
          {t('settings.account.sign_out.cta')}
        </Text>
      </Pressable>
      {isSignOutConfirmVisible ? (
        <View
          style={[styles.confirmCard, { backgroundColor: theme.color.warningSoft, borderColor: theme.color.warning }]}
          testID="settings.account.signOutConfirm">
          <Text style={[styles.confirmTitle, { color: theme.color.textPrimary }]}>
            {t('settings.account.sign_out.confirm_title')}
          </Text>
          <Text style={[styles.confirmBody, { color: theme.color.textSecondary }]}>
            {t('settings.account.sign_out.confirm_body')}
          </Text>
          <View style={styles.confirmActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsSignOutConfirmVisible(false)}
              style={[styles.confirmButton, { borderColor: theme.color.border }]}
              testID="settings.account.signOutCancelCta">
              <Text style={[styles.confirmButtonText, { color: theme.color.textSecondary }]}>
                {t('settings.account.sign_out.confirm_no')}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={submitSignOut}
              style={[styles.confirmButton, styles.confirmDestructiveButton, { backgroundColor: theme.color.warning, borderColor: theme.color.warning }]}
              testID="settings.account.signOutConfirmCta">
              <Text style={[styles.confirmButtonText, { color: theme.color.surface }]}>
                {t('settings.account.sign_out.confirm_yes')}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* ── Legal & Privacy section ─────────────────────────────────────── */}
      <SectionHeader label={t('settings.account.section.legal') as string} theme={theme} />
      <View style={[styles.group, { backgroundColor: theme.color.surface, borderColor: theme.color.border }]}>
        <SettingsRow
          label={t('settings.account.privacy_policy.label') as string}
          onPress={handleOpenPrivacyPolicy}
          theme={theme}
          testID="settings.account.privacyPolicyRow"
        />
        <RowDivider color={theme.color.border} />
        <SettingsRow
          label={t('settings.account.terms.label') as string}
          onPress={handleOpenTerms}
          theme={theme}
          testID="settings.account.termsRow"
        />
      </View>

      {/* ── Support section ────────────────────────────────────────────── */}
      <SectionHeader label={t('settings.account.section.support') as string} theme={theme} />
      <View style={[styles.group, { backgroundColor: theme.color.surface, borderColor: theme.color.border }]}>
        <SettingsRow
          label={t('settings.account.contact.label') as string}
          onPress={handleContactSupport}
          theme={theme}
          testID="settings.account.contactRow"
        />
      </View>

      {/* ── Danger zone ────────────────────────────────────────────────── */}
      <SectionHeader label={t('settings.account.section.danger') as string} theme={theme} danger />
      <View style={[styles.group, { backgroundColor: theme.color.dangerSoft, borderColor: theme.color.dangerBorder }]}>
        <Text style={[styles.dangerBody, { color: theme.color.textSecondary }]}>
          {t('settings.account.delete.body')}
        </Text>

        {deleteState.kind === 'success' ? (
          <View
            style={[styles.inlineBanner, { backgroundColor: theme.color.successSoft, borderColor: theme.color.success }]}
            testID="settings.account.deleteSuccess"
            accessibilityRole="alert">
            <Text style={[styles.inlineBannerText, { color: theme.color.success }]}>
              {t('settings.account.delete.success')}
            </Text>
          </View>
        ) : (
          <>
            {deleteErrorMessage ? (
              <View accessibilityLiveRegion="polite">
                <Text
                  style={[styles.rowError, { color: theme.color.danger }]}
                  testID="settings.account.deleteError">
                  {deleteErrorMessage}
                </Text>
              </View>
            ) : null}
            {isDeleteConfirmVisible ? (
              <View
                style={[styles.confirmCard, { backgroundColor: theme.color.dangerSoft, borderColor: theme.color.danger }]}
                testID="settings.account.deleteConfirm">
                <Text style={[styles.confirmTitle, { color: theme.color.textPrimary }]}>
                  {t('settings.account.delete.confirm_title')}
                </Text>
                <Text style={[styles.confirmBody, { color: theme.color.textSecondary }]}>
                  {t('settings.account.delete.confirm_body')}
                </Text>
                <View style={styles.confirmActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setIsDeleteConfirmVisible(false)}
                    style={[styles.confirmButton, { borderColor: theme.color.border }]}
                    testID="settings.account.deleteCancelCta">
                    <Text style={[styles.confirmButtonText, { color: theme.color.textSecondary }]}>
                      {t('settings.account.delete.confirm_no')}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={submitDeletionRequest}
                    style={[styles.confirmButton, styles.confirmDestructiveButton, { backgroundColor: theme.color.danger, borderColor: theme.color.danger }]}
                    testID="settings.account.deleteConfirmCta">
                    <Text style={[styles.confirmButtonText, { color: theme.color.surface }]}>
                      {t('settings.account.delete.confirm_yes')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('settings.account.delete.cta') as string}
              onPress={handleRequestDeletion}
              disabled={isDeleteLocked}
              style={[
                styles.destructiveButton,
                { borderColor: theme.color.danger, opacity: isDeleteLocked ? 0.5 : 1 },
              ]}
              testID="settings.account.deleteCta">
              <Text style={[styles.destructiveButtonText, { color: theme.color.danger }]}>
                {t('settings.account.delete.cta')}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      {/* ── App version footer ────────────────────────────────────────── */}
      <Text style={[styles.versionFooter, { color: theme.color.textTertiary }]} testID="settings.account.version">
        {t('settings.account.app_version.label')} {APP_VERSION}
      </Text>

      <SupportModal
        isVisible={isSupportModalVisible}
        onClose={() => setIsSupportModalVisible(false)}
        scheme={scheme}
        theme={theme}
        t={t}
      />
    </ScrollView>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type DsThemeShape = ReturnType<typeof getDsTheme>;

function SectionHeader({
  label,
  theme,
  danger = false,
}: {
  label: string;
  theme: DsThemeShape;
  danger?: boolean;
}) {
  return (
    <Text
      style={[
        styles.sectionHeader,
        { color: danger ? theme.color.danger : theme.color.textTertiary },
      ]}>
      {label.toUpperCase()}
    </Text>
  );
}

function SettingsRow({
  label,
  value,
  onPress,
  loading = false,
  theme,
  testID,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
  loading?: boolean;
  theme: DsThemeShape;
  testID?: string;
}) {
  const isInteractive = Boolean(onPress) && !loading;
  return (
    <Pressable
      onPress={isInteractive ? onPress : undefined}
      disabled={!isInteractive}
      style={({ pressed }) => [
        styles.settingsRow,
        pressed && isInteractive && { opacity: 0.6 },
      ]}
      testID={testID}
      accessibilityRole={isInteractive ? 'button' : 'none'}>
      <Text style={[styles.rowLabel, { color: theme.color.textPrimary }]}>{label}</Text>
      <View style={styles.rowRight}>
        {value ? (
          <Text style={[styles.rowValue, { color: theme.color.textSecondary }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {isInteractive ? (
          <MaterialIcons
            name="chevron-right"
            size={18}
            color={theme.color.textTertiary}
            style={styles.chevronIcon}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function RowDivider({ color }: { color: string }) {
  return <View style={[styles.divider, { backgroundColor: color }]} />;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingBottom: 48, paddingHorizontal: DsSpace.lg, gap: DsSpace.sm },

  heroWrap: {
    gap: DsSpace.xs,
    marginBottom: DsSpace.xs,
  },
  screenTitle: {
    ...DsTypography.title,
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 30,
    lineHeight: 36,
  },

  heroCard: {
    borderRadius: DsRadius.xl,
    borderWidth: 1,
    gap: 14,
    marginBottom: DsSpace.xxs,
    padding: DsSpace.md,
  },

  // Profile
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 26,
    fontWeight: '700',
  },
  profileInfo: { flex: 1, gap: 2 },
  profileName: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 18,
    fontWeight: '700',
  },
  profileEmail: { fontSize: 13, marginBottom: 4 },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    flexShrink: 1,
  },
  rolePill: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  rolePillText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  freeTierText: { fontSize: 11, fontWeight: '500', flexShrink: 1 },
  supportQuickButton: {
    alignItems: 'center',
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },

  // Section header
  sectionHeader: {
    ...DsTypography.caption,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginTop: DsSpace.sm,
    marginBottom: 6,
    marginLeft: 4,
  },

  // Settings group
  group: {
    borderRadius: DsRadius.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },

  // Settings row
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.sm,
    minHeight: 50,
  },
  rowLabel: { fontSize: 15, flex: 1 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '50%' },
  rowValue: { fontSize: 14, textAlign: 'right', flexShrink: 1 },
  chevronIcon: { marginLeft: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 16 },

  // Inline banners
  inlineBanner: {
    borderRadius: DsRadius.md,
    borderWidth: 1,
    margin: 12,
    padding: 12,
  },
  inlineBannerText: { fontSize: 13, lineHeight: 18 },
  rowError: { fontSize: 13, paddingHorizontal: 16, paddingBottom: 10 },

  // Danger zone
  dangerBody: { fontSize: 13, lineHeight: 20, padding: 16, paddingBottom: 8 },
  destructiveButton: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 1.5,
    justifyContent: 'center',
    margin: 12,
    marginTop: 4,
    minHeight: 48,
  },
  destructiveButtonText: { fontSize: 15, fontWeight: '600' },

  // Sign out
  signOutButton: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 1.5,
    justifyContent: 'center',
    marginTop: DsSpace.lg,
    marginBottom: 4,
    minHeight: 48,
  },
  signOutText: { fontSize: 15, fontWeight: '600' },
  confirmCard: {
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    gap: 10,
    padding: DsSpace.md,
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  confirmBody: {
    fontSize: 13,
    lineHeight: 19,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  confirmButton: {
    alignItems: 'center',
    borderRadius: DsRadius.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: DsSpace.sm,
  },
  confirmDestructiveButton: {
    borderWidth: 1,
  },
  confirmButtonText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },

  // Footer
  versionFooter: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
});
