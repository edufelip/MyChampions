/**
 * Professional Nutrition placeholder
 * SC-207 Nutrition Plan Builder is not yet implemented.
 * This screen is shown in the Nutrition tab for professional users.
 *
 * Deferred: docs/discovery/pending-wiring-checklist-v1.md
 * Docs: docs/screens/v2/SC-207-nutrition-plan-builder.md
 */
import { StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function ProNutritionPlaceholderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <Stack.Screen options={{ title: t('shell.tabs.nutrition'), headerShown: true }} />
      <Text style={[styles.title, { color: palette.text }]}>{t('shell.tabs.nutrition')}</Text>
      <Text style={[styles.body, { color: palette.icon }]}>
        {t('shell.placeholder.coming_soon')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 20,
    fontWeight: '700',
  },
  body: { fontSize: 14, textAlign: 'center', lineHeight: 22 },
});
