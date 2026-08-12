/**
 * Shared WebView Screen
 * Route: /shared/webview
 *
 * Generic screen to display web content (e.g., Privacy Policy, Terms of Use)
 * within the app using react-native-webview.
 *
 * URL contract: `url` is validated by `resolveSafeExternalUrl` before use
 * (see `@/features/platform/external-url`) — arbitrary deep-link URLs must
 * use the fixed `eduwaldo.com` origin, while exact configured legal URLs may
 * use their operator-approved host. Development loopback URLs are also
 * supported. On an invalid `url`, this native screen renders a localized
 * invalid-link state with a back action; the web platform variant
 * (`webview.web.tsx`) renders its own equivalent state.
 */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  StyleSheet,
  View,
  ActivityIndicator,
  Text,
  Pressable,
  Platform,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { getDsTheme, DsRadius, DsSpace } from '@/constants/design-system';
import { resolveTermsConfigFromExpo } from '@/features/auth/terms-config';
import {
  allowInsecureLocalhostForDevelopment,
  buildOriginWhitelistForUrl,
  EDUWALDO_HTTPS_HOSTNAME,
  resolveSafeExternalUrl,
} from '@/features/platform/external-url';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function WebViewScreen() {
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
  const [error, setError] = useState(false);
  const [key, setKey] = useState(0); // For retry
  const screenTitle = typeof title === 'string' ? title : '';
  const fallbackPath =
    intent === 'terms' ? '/auth/accept-terms' : intent === 'account' ? '/settings/account' : '/';

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(fallbackPath);
  };

  // Validate the route param before it ever reaches WebView/Linking. This screen is a
  // file-based expo-router route and is reachable via the app's own deep-link scheme
  // (mychampions://shared/webview?url=...), so `url` must not be trusted as-is — the
  // WebView's `originWhitelist` prop below is not a substitute for this app-level check.
  const safeUrl = resolveSafeExternalUrl(url, {
    allowInsecureLocalhost: allowInsecureLocalhostForDevelopment(),
    approvedHttpsHostname: EDUWALDO_HTTPS_HOSTNAME,
    approvedHttpsUrls: configuredLegalUrls,
  });

  if (!safeUrl) {
    return (
      <View
        style={[styles.container, styles.centered, { backgroundColor: theme.color.canvas }]}
        collapsable={false}
        testID="shared.webview.screen"
      >
        <Stack.Screen options={{ title: screenTitle, headerShown: true }} />
        <Text style={[styles.errorText, { color: theme.color.textPrimary }]}>
          {t('auth.terms.invalid_link')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          onPress={goBack}
          style={[styles.retryButton, { backgroundColor: theme.color.accentPrimary }]}
          testID="shared.webview.invalidLink.backButton"
        >
          <Text style={[styles.retryText, { color: theme.color.onAccent }]}>
            {t('common.back')}
          </Text>
        </Pressable>
      </View>
    );
  }

  // react-native-webview doesn't support Web. Fallback to external link.
  if (Platform.OS === 'web') {
    return (
      <View
        style={[styles.container, styles.centered, { backgroundColor: theme.color.canvas }]}
        collapsable={false}
        testID="shared.webview.screen"
      >
        <Stack.Screen options={{ title: screenTitle, headerShown: true }} />
        <Text
          style={[styles.errorText, { color: theme.color.textPrimary, marginBottom: DsSpace.md }]}
        >
          {t('auth.terms.offline_hint')}
        </Text>
        <Pressable
          onPress={() => Linking.openURL(safeUrl)}
          style={[styles.retryButton, { backgroundColor: theme.color.accentPrimary }]}
        >
          <Text style={[styles.retryText, { color: theme.color.onAccent }]}>
            {t('auth.terms.open_link')}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      collapsable={false}
      testID="shared.webview.screen"
    >
      <Stack.Screen
        options={{
          title: screenTitle,
          headerShown: true,
          headerStyle: {
            backgroundColor: theme.color.surface,
          },
          headerTintColor: theme.color.textPrimary,
        }}
      />
      {error ? (
        <View style={[styles.centered, { padding: DsSpace.lg }]}>
          <Text style={[styles.errorText, { color: theme.color.textPrimary }]}>
            {t('common.error.generic')}
          </Text>
          <Pressable
            onPress={() => {
              setError(false);
              setKey((k) => k + 1);
            }}
            style={[
              styles.retryButton,
              { backgroundColor: theme.color.accentPrimary, marginTop: DsSpace.md },
            ]}
          >
            <Text style={[styles.retryText, { color: theme.color.onAccent }]}>
              {t('common.error.retry')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          testID="shared.webview.webview"
          key={key}
          source={{ uri: safeUrl }}
          style={styles.webview}
          startInLoadingState
          originWhitelist={buildOriginWhitelistForUrl(safeUrl)}
          onError={() => setError(true)}
          onHttpError={() => setError(true)}
          renderLoading={() => (
            <View
              style={[styles.loading, { backgroundColor: theme.color.canvas }]}
              testID="shared.webview.loading"
            >
              <ActivityIndicator size="large" color={theme.color.accentPrimary} />
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webview: {
    flex: 1,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: DsSpace.lg,
    paddingVertical: DsSpace.sm,
    borderRadius: DsRadius.md,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
