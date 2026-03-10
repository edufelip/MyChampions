/**
 * SC-213 Account & Privacy Settings
 * Route: /settings/account  (re-exported from app/(tabs)/account.tsx for both roles)
 *
 * Production-ready settings screen covering:
 *   — Profile header (avatar initials, display name, email, role badge)
 *   — Account section: email display, change password, language switcher
 *   — Legal & Privacy section: privacy policy, terms of service
 *   — Support section: contact support (mailto)
 *   — Sign out
 *   — Danger zone: account deletion (FR-133, FR-157, BR-225, BR-231)
 *
 * Change-password flow:
 *   - Email/password accounts → sendPasswordResetEmail → inline success/error
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
import { sendPasswordResetEmail, signOut } from 'firebase/auth';
import Constants from 'expo-constants';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { SupportModal } from '@/components/ds/patterns/SupportModal';
import { DsRadius, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import {
  deleteAccountAndDataFromSource,
  ProfileSourceError,
} from '@/features/auth/profile-source';
import { getFirebaseAuth } from '@/features/auth/firebase';

import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
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
  | { kind: 'error'; reason: 'network' | 'already_requested' | 'requires_recent_login' | 'unauthenticated' | 'unknown' };

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

function isEmailPasswordAccount(providerData: { providerId: string }[]): boolean {
  return providerData.some((p) => p.providerId === 'password');
}

function resolveOAuthProviderLabel(providerData: { providerId: string }[]): string {
  if (providerData.some((p) => p.providerId === 'google.com')) return 'Google';
  if (providerData.some((p) => p.providerId === 'apple.com')) return 'Apple';
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

  const { currentUser, lockedRole, clearSession, termsUrl, privacyPolicyUrl } = useAuthSession();

  // ── Offline state ──────────────────────────────────────────────────────────
  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  // ── Feature state ──────────────────────────────────────────────────────────
  const [deleteState, setDeleteState] = useState<DeleteRequestState>({ kind: 'idle' });
  const [passwordState, setPasswordState] = useState<PasswordResetState>({ kind: 'idle' });
  const [isSupportModalVisible, setIsSupportModalVisible] = useState(false);


  // ── Derived ────────────────────────────────────────────────────────────────
  const email = currentUser?.email ?? null;
  const displayName = resolveDisplayName(currentUser?.displayName ?? null, email);
  const avatarInitial = resolveAvatarInitial(currentUser?.displayName ?? null, email);
  const providerData = currentUser?.providerData ?? [];
  const isEmailUser = isEmailPasswordAccount(providerData);
  const oauthProvider = resolveOAuthProviderLabel(providerData);
  const isStudent = lockedRole === 'student';
  const isProfessional = lockedRole === 'professional';
  const roleBadgeLabel = isStudent
    ? t('settings.account.role.student')
    : t('settings.account.role.professional');
  const topInsetPadding = insets.top;

  const isSubmittingDelete = deleteState.kind === 'pending';
  const isDeleteLocked = isSubmittingDelete || isWriteLocked;
  const isPasswordPending = passwordState.kind === 'pending';

  const deleteErrorMessage =
    deleteState.kind === 'error'
      ? deleteState.reason === 'network'
        ? t('settings.account.delete.error.network')
        : deleteState.reason === 'already_requested'
          ? t('settings.account.delete.error.already_requested')
          : deleteState.reason === 'requires_recent_login'
            ? t('settings.account.delete.error.requires_recent_login')
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

    Alert.alert(
      t('settings.account.change_password.confirm_title') as string,
      t('settings.account.change_password.confirm_body', { email: email ?? '' }) as string,
      [
        { text: t('settings.account.change_password.confirm_no') as string, style: 'cancel' },
        {
          text: t('settings.account.change_password.confirm_yes') as string,
          onPress: submitPasswordReset,
        },
      ]
    );
  }

  async function submitPasswordReset() {
    if (!email) return;
    setPasswordState({ kind: 'pending' });
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), email);
      setPasswordState({ kind: 'success' });
    } catch {
      setPasswordState({ kind: 'error' });
    }
  }

  function handleLanguagePicker() {
    router.push('/settings/language-select');
  }

  function handleSignOut() {
    Alert.alert(
      t('settings.account.sign_out.confirm_title') as string,
      t('settings.account.sign_out.confirm_body') as string,
      [
        { text: t('settings.account.sign_out.confirm_no') as string, style: 'cancel' },
        {
          text: t('settings.account.sign_out.confirm_yes') as string,
          style: 'destructive',
          onPress: submitSignOut,
        },
      ]
    );
  }

  function submitSignOut() {
    clearSession();
    void signOut(getFirebaseAuth());
  }

  function handleRequestDeletion() {
    Alert.alert(
      t('settings.account.delete.confirm_title') as string,
      t('settings.account.delete.confirm_body') as string,
      [
        { text: t('settings.account.delete.confirm_no') as string, style: 'cancel' },
        {
          text: t('settings.account.delete.confirm_yes') as string,
          style: 'destructive',
          onPress: submitDeletionRequest,
        },
      ]
    );
  }

  async function submitDeletionRequest() {
    setDeleteState({ kind: 'pending' });
    try {
      await deleteAccountAndDataFromSource();
      clearSession();
      // Optional: signOut is redundant if deleteUser succeeds, but safe to call.
      void signOut(getFirebaseAuth());
      setDeleteState({ kind: 'success' });
    } catch (err) {
      if (err instanceof ProfileSourceError) {
        if (err.code === 'requires_recent_login') {
          setDeleteState({ kind: 'error', reason: 'requires_recent_login' });
        } else if (err.code === 'network') {
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
      style={[styles.root, { backgroundColor: theme.color.canvas }]}
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

      {/* ── Sign out ───────────────────────────────────────────────────── */}
      <Pressable
        onPress={handleSignOut}
        style={[styles.signOutButton, { borderColor: theme.color.warning }]}
        testID="settings.account.signOutCta">
        <Text style={[styles.signOutText, { color: theme.color.warning }]}>
          {t('settings.account.sign_out.cta')}
        </Text>
      </Pressable>

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
            <Pressable
              accessibilityRole="button"
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

  // Footer
  versionFooter: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 24,
    marginBottom: 8,
  },
});
