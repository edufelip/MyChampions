import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import {
  DsTypography,
  type DsColorScheme,
  getDsTheme,
} from '@/constants/design-system';

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
        <View style={[styles.heroBlob, { backgroundColor: theme.color.surface }]}> 
          <View style={[styles.innerBlob, { backgroundColor: theme.color.accentMint + '66' }]} />
          <MaterialIcons color={theme.color.accentPrimary} name={icon} size={76} />
        </View>

        <Text style={[styles.title, { color: theme.color.textPrimary }]}>{title}</Text>
        <Text style={[styles.body, { color: theme.color.textSecondary }]}>{body}</Text>

        <DsPillButton
          scheme={scheme}
          label={ctaLabel}
          onPress={onPressCta}
          disabled={disabled}
          testID={ctaTestID}
          leftIcon={<MaterialIcons color="#ffffff" name="add-circle" size={20} />}
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
  heroBlob: {
    alignItems: 'center',
    borderColor: '#fff5f0',
    borderRadius: 96,
    borderWidth: 8,
    height: 192,
    justifyContent: 'center',
    marginBottom: 4,
    position: 'relative',
    width: 192,
  },
  innerBlob: {
    borderRadius: 64,
    height: 128,
    position: 'absolute',
    right: 18,
    top: 14,
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
