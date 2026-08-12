import { Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DsSpace, getDsTheme } from '@/constants/design-system';
import {
  allowInsecureLocalhostForDevelopment,
  EDUWALDO_HTTPS_HOSTNAME,
  resolveSafeExternalUrl,
} from '@/features/platform/external-url';
import { shareAdapter } from '@/features/platform/share-adapter';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function WebExternalLinkScreen() {
  const { url, title } = useLocalSearchParams<{ url?: string; title?: string }>();
  const colorScheme = useColorScheme() ?? 'light';
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const { t } = useTranslation();
  const safeUrl = resolveSafeExternalUrl(url, {
    allowInsecureLocalhost: allowInsecureLocalhostForDevelopment(),
    approvedHttpsHostname: EDUWALDO_HTTPS_HOSTNAME,
  });

  return (
    <View
      style={[styles.container, { backgroundColor: theme.color.canvas }]}
      testID="shared.webview.screen"
    >
      <Stack.Screen options={{ title: title ?? '', headerShown: true }} />
      <Text style={[styles.body, { color: theme.color.textPrimary }]}>
        {safeUrl ? t('auth.terms.offline_hint') : t('auth.terms.invalid_link')}
      </Text>
      {safeUrl ? (
        <Pressable
          accessibilityRole="link"
          onPress={() => void shareAdapter.openExternalLink(safeUrl)}
          style={[styles.button, { backgroundColor: theme.color.accentPrimary }]}
          testID="shared.webview.openExternal"
        >
          <Text style={{ color: theme.color.onAccent }}>{t('auth.terms.open_link')}</Text>
        </Pressable>
      ) : null}
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
  button: {
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: DsSpace.lg,
    justifyContent: 'center',
  },
});
