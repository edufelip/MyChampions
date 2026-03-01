/**
 * SC-213 Account & Privacy Settings
 * Route: /settings/account
 *
 * Provides compliance-critical controls: privacy policy link and account
 * deletion initiation (FR-133, FR-157, BR-225, BR-231).
 *
 * Account deletion API wiring is deferred — deletion request is stubbed as a
 * no-op until the Data Connect profile-delete operation is implemented.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-213-account-privacy-settings.md
 * Refs: FR-133, FR-157, UC-002.5, AC-305–308, AC-310, BR-225, BR-231
 *       TC-304–307, TC-309
 */
import { useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type DeleteRequestState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'success' }
  | { kind: 'error'; reason: 'network' | 'already_requested' | 'unknown' };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function AccountSettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();

  const [deleteState, setDeleteState] = useState<DeleteRequestState>({ kind: 'idle' });

  // Privacy policy URL — deferred: replace with env-based legal config link
  const PRIVACY_POLICY_URL = 'https://example.com/privacy';

  function handleOpenPrivacyPolicy() {
    void Linking.openURL(PRIVACY_POLICY_URL);
  }

  function handleRequestDeletion() {
    Alert.alert(
      t('settings.account.delete.confirm_title') as string,
      t('settings.account.delete.confirm_body') as string,
      [
        {
          text: t('settings.account.delete.confirm_no') as string,
          style: 'cancel',
        },
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
      // Account deletion API call deferred (pending-wiring-checklist-v1.md)
      // Will call Data Connect profile-delete operation when wired.
      await Promise.resolve(); // stub — no-op
      setDeleteState({ kind: 'success' });
    } catch {
      setDeleteState({ kind: 'error', reason: 'unknown' });
    }
  }

  const errorMessage =
    deleteState.kind === 'error'
      ? deleteState.reason === 'network'
        ? t('settings.account.delete.error.network')
        : deleteState.reason === 'already_requested'
          ? t('settings.account.delete.error.already_requested')
          : t('settings.account.delete.error.unknown')
      : null;

  const isSubmitting = deleteState.kind === 'pending';

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      testID="settings.account.screen">
      <Stack.Screen options={{ title: t('settings.account.title'), headerShown: true }} />

      {/* Privacy policy */}
      <View
        style={[styles.section, { borderColor: palette.icon + '33' }]}
        testID="settings.account.privacySection">
        <Text style={[styles.sectionTitle, { color: palette.text }]}>
          {t('settings.account.privacy_policy.label')}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={handleOpenPrivacyPolicy}
          style={[styles.linkButton, { borderColor: palette.tint }]}
          testID="settings.account.privacyPolicy.cta">
          <Text style={[styles.linkButtonText, { color: palette.tint }]}>
            {t('settings.account.privacy_policy.cta')}
          </Text>
        </Pressable>
      </View>

      {/* Account deletion */}
      <View
        style={[styles.section, { borderColor: palette.icon + '33' }]}
        testID="settings.account.deleteSection">
        <Text style={[styles.sectionTitle, { color: palette.text }]}>
          {t('settings.account.delete.title')}
        </Text>
        <Text style={[styles.body, { color: palette.icon }]}>
          {t('settings.account.delete.body')}
        </Text>

        {deleteState.kind === 'success' ? (
          <View
            style={[styles.successBanner, { borderColor: '#16a34a' }]}
            testID="settings.account.deleteSuccess"
            accessibilityRole="alert">
            <Text style={[styles.successText, { color: '#16a34a' }]}>
              {t('settings.account.delete.success')}
            </Text>
          </View>
        ) : (
          <>
            {errorMessage ? (
              <View accessibilityLiveRegion="polite">
                <Text
                  style={[styles.errorText, { color: '#b3261e' }]}
                  testID="settings.account.deleteError">
                  {errorMessage}
                </Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={handleRequestDeletion}
              disabled={isSubmitting}
              style={[
                styles.destructiveButton,
                { borderColor: '#b3261e', opacity: isSubmitting ? 0.6 : 1 },
              ]}
              testID="settings.account.deleteCta">
              <Text style={[styles.destructiveButtonText, { color: '#b3261e' }]}>
                {t('settings.account.delete.cta')}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 20 },
  section: {
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
    padding: 16,
  },
  sectionTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
  body: { fontSize: 13, lineHeight: 20 },
  linkButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 44,
  },
  linkButtonText: { fontSize: 14, fontWeight: '600' },
  successBanner: {
    backgroundColor: '#16a34a11',
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
  },
  successText: { fontSize: 13 },
  errorText: { fontSize: 13 },
  destructiveButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 48,
  },
  destructiveButtonText: { fontSize: 15, fontWeight: '600' },
});
