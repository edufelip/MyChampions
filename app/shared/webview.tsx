/**
 * Shared WebView Screen
 * Route: /shared/webview
 *
 * Generic screen to display web content (e.g., Privacy Policy, Terms of Use)
 * within the app using react-native-webview.
 *
 * URL contract: `url` is validated by `resolveSafeExternalUrl` before use
 * (see `@/features/platform/external-url`) — only `https://eduwaldo.com` and
 * its subdomains are accepted, plus `http://localhost`/`127.0.0.1`/`[::1]`
 * when running in development. On an invalid `url`, this native screen
 * renders no UI at all (returns null); the web platform variant
 * (`webview.web.tsx`) instead renders its own localized invalid-link state,
 * since it has no separate "screen didn't load" case to fall back to.
 */
import { useLocalSearchParams, Stack } from 'expo-router';
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
import {
  allowInsecureLocalhostForDevelopment,
  EDUWALDO_HTTPS_HOSTNAME,
  resolveSafeExternalUrl,
} from '@/features/platform/external-url';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function WebViewScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  const [key, setKey] = useState(0); // For retry

  // Validate the route param before it ever reaches WebView/Linking. This screen is a
  // file-based expo-router route and is reachable via the app's own deep-link scheme
  // (mychampions://shared/webview?url=...), so `url` must not be trusted as-is — the
  // WebView's `originWhitelist` prop below is not a substitute for this app-level check.
  const safeUrl = resolveSafeExternalUrl(url, {
    allowInsecureLocalhost: allowInsecureLocalhostForDevelopment(),
    approvedHttpsHostname: EDUWALDO_HTTPS_HOSTNAME,
  });

  if (!safeUrl) {
    return null;
  }

  // react-native-webview doesn't support Web. Fallback to external link.
  if (Platform.OS === 'web') {
    return (
      <View
        style={[styles.container, styles.centered, { backgroundColor: theme.color.canvas }]}
        collapsable={false}
        testID="shared.webview.screen"
      >
        <Stack.Screen options={{ title: title ?? '', headerShown: true }} />
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
          title: title ?? '',
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
          originWhitelist={['https://portfolio.eduwaldo.com', 'https://*.eduwaldo.com']}
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
