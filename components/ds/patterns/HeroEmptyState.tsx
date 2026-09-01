import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { DsTypography, type DsColorScheme, getDsTheme } from '@/constants/design-system';
import { DsCard } from '../primitives/DsCard';
import { DsPillButton } from '../primitives/DsPillButton';

type IconName = keyof typeof MaterialIcons.glyphMap;

type HeroEmptyStateProps = {
  scheme: DsColorScheme;
  icon: IconName;
  title: string;
  body: string;
  ctaLabel: string;
  onPressCta: () => void;
  ctaTestID: string;
  disabled?: boolean;
  testID?: string;
};

export function HeroEmptyState({
  scheme,
  icon,
  title,
  body,
  ctaLabel,
  onPressCta,
  ctaTestID,
  disabled = false,
  testID,
}: HeroEmptyStateProps) {
  const theme = getDsTheme(scheme);

  return (
    <DsCard scheme={scheme} style={styles.card} testID={testID}>
      <View style={styles.heroWrap}>
        <View style={[styles.iconBadge, { backgroundColor: theme.color.accentPrimarySoft }]}>
          <MaterialIcons color={theme.color.accentPrimary} name={icon} size={56} />
        </View>

        <Text style={[styles.title, { color: theme.color.textPrimary }]}>{title}</Text>
        <Text style={[styles.body, { color: theme.color.textSecondary }]}>{body}</Text>

        <DsPillButton
          scheme={scheme}
          label={ctaLabel}
          onPress={onPressCta}
          disabled={disabled}
          testID={ctaTestID}
          leftIcon={<MaterialIcons color={theme.color.onAccent} name="add-circle" size={20} />}
        />
      </View>
    </DsCard>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  heroWrap: {
    alignItems: 'center',
    width: '100%',
  },
  iconBadge: {
    alignItems: 'center',
    borderRadius: 96,
    height: 128,
    justifyContent: 'center',
    marginBottom: 12,
    width: 128,
  },
  title: {
    ...DsTypography.title,
    textAlign: 'center',
  },
  body: {
    ...DsTypography.body,
    marginBottom: 6,
    maxWidth: 300,
    textAlign: 'center',
  },
});
