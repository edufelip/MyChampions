import { StyleSheet, Text, View } from 'react-native';

import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

/**
 * Legacy Expo starter route.
 * Hidden from product navigation in app/(tabs)/_layout.tsx via `href: null`.
 * Kept as an internal diagnostics/info screen only.
 */
export default function ExploreScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);

  return (
    <DsScreen scheme={scheme} contentContainerStyle={styles.content}>
      <DsCard scheme={scheme} style={styles.card}>
        <Text style={[styles.title, { color: theme.color.textPrimary }]}>{t('shell.explore.title')}</Text>
        <Text style={[styles.body, { color: theme.color.textSecondary }]}>{t('shell.explore.description')}</Text>

        <View style={[styles.note, { borderColor: theme.color.border }]}>
          <Text style={[styles.noteText, { color: theme.color.textSecondary }]}>
            {t('shell.explore.section.routing.title')}
          </Text>
        </View>
      </DsCard>
    </DsScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    padding: DsSpace.lg,
  },
  card: {
    gap: DsSpace.md,
  },
  title: {
    ...DsTypography.title,
    fontSize: 28,
  },
  body: {
    ...DsTypography.body,
  },
  note: {
    borderRadius: 12,
    borderWidth: 1,
    padding: DsSpace.md,
  },
  noteText: {
    ...DsTypography.caption,
  },
});
