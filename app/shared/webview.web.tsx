import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { DsSpace, getDsTheme } from '@/constants/design-system';
import { resolveTermsConfigFromExpo } from '@/features/auth/terms-config';
import {
  allowInsecureLocalhostForDevelopment,
  EDUWALDO_HTTPS_HOSTNAME,
  resolveSafeExternalUrl,
} from '@/features/platform/external-url';
import { shareAdapter } from '@/features/platform/share-adapter';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function WebExternalLinkScreen() {
  const { intent, url, title } = useLocalSearchParams<{
    intent?: string | string[];
    url?: string | string[];
    title?: string | string[];
  }>();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const { t } = useTranslation();
  const { termsUrl, privacyPolicyUrl } = resolveTermsConfigFromExpo();
  const configuredLegalUrls = [termsUrl, privacyPolicyUrl];
  const screenTitle = typeof title === 'string' ? title : '';
  const fallbackPath =
    intent === 'terms' ? '/auth/accept-terms' : intent === 'account' ? '/settings/account' : '/';
  const safeUrl = resolveSafeExternalUrl(url, {
    allowInsecureLocalhost: allowInsecureLocalhostForDevelopment(),
    approvedHttpsHostname: EDUWALDO_HTTPS_HOSTNAME,
    approvedHttpsUrls: configuredLegalUrls,
  });
  const [openError, setOpenError] = useState(false);
  const openLabel = screenTitle
    ? t('shared.webview.open_cta', { title: screenTitle })
    : t('auth.terms.open_link');

  const goBack = () => {
    if (Platform.OS === 'web') {
      router.replace(fallbackPath);
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(fallbackPath);
  };

  const handleOpenExternal = async () => {
    if (!safeUrl) return;
    try {
      await shareAdapter.openExternalLink(safeUrl);
      setOpenError(false);
    } catch {
      // A browser popup blocker (or another open failure) shouldn't strand
      // the user on a dead CTA — surface a recoverable, observable message
      // with the destination URL instead of failing silently.
      setOpenError(true);
    }
  };

  return (
    <View
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      testID="shared.webview.screen"
    >
      <Stack.Screen options={{ title: screenTitle, headerShown: true }} />
      <Text style={[styles.body, { color: theme.color.textPrimary }]}>
        {safeUrl ? t('shared.webview.browser_hint') : t('auth.terms.invalid_link')}
      </Text>
      <View accessibilityRole="alert">
        {safeUrl && openError ? (
          <Text
            style={[styles.body, styles.errorText, { color: theme.color.danger }]}
            testID="shared.webview.openError"
          >
            {t('shared.webview.open_error', { url: safeUrl })}
          </Text>
        ) : null}
      </View>
      {safeUrl ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={openLabel}
          onPress={() => void handleOpenExternal()}
          style={[styles.button, { backgroundColor: theme.color.accentPrimary }]}
          testID="shared.webview.openExternal"
        >
          <Text style={{ color: theme.color.onAccent }}>{openLabel}</Text>
        </Pressable>
      ) : null}
      {safeUrl ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={goBack}
          style={[
            styles.button,
            styles.secondaryButton,
            { backgroundColor: theme.color.surface, borderColor: theme.color.border },
          ]}
          testID="shared.webview.backButton"
        >
          <Text style={{ color: theme.color.textSecondary }}>{t('common.back')}</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={goBack}
          style={[styles.button, { backgroundColor: theme.color.accentPrimary }]}
          testID="shared.webview.invalidLink.backButton"
        >
          <Text style={{ color: theme.color.onAccent }}>{t('common.back')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    flex: 1,
    gap: DsSpace.md,
    justifyContent: 'center',
    padding: DsSpace.lg,
  },
  body: { maxWidth: 560, textAlign: 'center' },
  errorText: { fontSize: 13, opacity: 0.8 },
  button: {
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: DsSpace.lg,
    justifyContent: 'center',
  },
  secondaryButton: {
    borderWidth: 1,
  },
});
