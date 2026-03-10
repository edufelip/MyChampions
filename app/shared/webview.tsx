/**
 * Shared WebView Screen
 * Route: /shared/webview
 *
 * Generic screen to display web content (e.g., Privacy Policy, Terms of Use)
 * within the app using react-native-webview.
 */
import { useLocalSearchParams, Stack } from 'expo-router';
import { StyleSheet, View, ActivityIndicator, Text, Pressable, Platform, Linking } from 'react-native';
import { WebView } from 'react-native-webview';
import { useState } from 'react';

import { getDsTheme, DsRadius, DsSpace } from '@/constants/design-system';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function WebViewScreen() {
  const { url, title } = useLocalSearchParams<{ url: string; title: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  const [key, setKey] = useState(0); // For retry

  if (!url) {
    return null;
  }

  // react-native-webview doesn't support Web. Fallback to external link.
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, styles.centered, { backgroundColor: theme.color.canvas }]}>
         <Stack.Screen options={{ title: title ?? '', headerShown: true }} />
         <Text style={[styles.errorText, { color: theme.color.textPrimary, marginBottom: DsSpace.md }]}>
           {t('auth.terms.offline_hint')}
         </Text>
         <Pressable
           onPress={() => Linking.openURL(url)}
           style={[styles.retryButton, { backgroundColor: theme.color.accentPrimary }]}>
           <Text style={[styles.retryText, { color: theme.color.onAccent }]}>
             {t('auth.terms.open_link')}
           </Text>
         </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.color.canvas }]}>
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
              setKey(k => k + 1);
            }}
            style={[styles.retryButton, { backgroundColor: theme.color.accentPrimary, marginTop: DsSpace.md }]}>
            <Text style={[styles.retryText, { color: theme.color.onAccent }]}>
              {t('common.error.retry')}
            </Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          key={key}
          source={{ uri: url }}
          style={styles.webview}
          startInLoadingState
          originWhitelist={['https://portfolio.eduwaldo.com', 'https://*.eduwaldo.com']}
          onError={() => setError(true)}
          onHttpError={() => setError(true)}
          renderLoading={() => (
            <View style={[styles.loading, { backgroundColor: theme.color.canvas }]}>
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
