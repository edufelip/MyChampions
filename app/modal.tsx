import { useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function ModalScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);

  return (
    <DsScreen scheme={scheme} contentContainerStyle={styles.content}>
      <DsCard scheme={scheme} style={styles.card}>
        <Text style={[styles.title, { color: theme.color.textPrimary }]}>
          {t('shell.modal.body_title')}
        </Text>

        <Text style={[styles.body, { color: theme.color.textSecondary }]}>
          {t('shell.explore.description')}
        </Text>

        <DsPillButton
          scheme={scheme}
          label={t('shell.modal.link_home') as string}
          onPress={() => router.replace('/')}
          testID="shell.modal.home"
        />
      </DsCard>
    </DsScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    flexGrow: 1,
    justifyContent: 'center',
    padding: DsSpace.lg,
  },
  card: {
    gap: DsSpace.md,
    maxWidth: 520,
    width: '100%',
  },
  title: {
    ...DsTypography.title,
    fontSize: 28,
  },
  body: {
    ...DsTypography.body,
  },
});
