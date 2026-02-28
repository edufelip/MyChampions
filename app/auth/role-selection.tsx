import { Stack, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function RoleSelectionPlaceholderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ title: t('auth.role.placeholder.title'), headerShown: false }} />

      <Text style={[styles.title, { color: palette.text }]}>{t('auth.role.placeholder.title')}</Text>
      <Text style={[styles.body, { color: palette.icon }]}>
        {t('auth.role.placeholder.body')}
      </Text>

      <Pressable onPress={() => router.replace('/explore')} style={styles.button}>
        <Text style={[styles.buttonText, { color: palette.tint }]}>
          {t('auth.role.placeholder.cta_open_app_shell')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 14,
  },
  title: {
    fontFamily: Fonts.rounded,
    fontSize: 28,
    fontWeight: '700',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  button: {
    paddingVertical: 8,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
