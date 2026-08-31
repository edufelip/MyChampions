import { StyleSheet, Text, View } from 'react-native';
import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsRadius, DsSpace, DsTypography, type DsColorScheme } from '@/constants/design-system';

type BuilderLoadErrorCardProps = {
  scheme: DsColorScheme;
  message: string;
  errorTextColor: string;
  retryLabel: string;
  onRetry: () => void;
  backLabel: string;
  onBack: () => void;
  testIDPrefix: string;
};

export function BuilderLoadErrorCard({
  scheme,
  message,
  errorTextColor,
  retryLabel,
  onRetry,
  backLabel,
  onBack,
  testIDPrefix,
}: BuilderLoadErrorCardProps) {
  return (
    <View style={styles.wrap} testID={`${testIDPrefix}.wrap`}>
      <DsCard scheme={scheme} style={styles.card} testID={`${testIDPrefix}.card`}>
        <View accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={[styles.text, { color: errorTextColor }]} testID={testIDPrefix}>
            {message}
          </Text>
        </View>
        <View style={styles.actions}>
          <DsPillButton
            scheme={scheme}
            label={retryLabel}
            onPress={onRetry}
            testID={`${testIDPrefix}.retry`}
          />
          <DsPillButton
            scheme={scheme}
            variant="outline"
            label={backLabel}
            onPress={onBack}
            testID={`${testIDPrefix}.backToLibrary`}
          />
        </View>
      </DsCard>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: DsSpace.xl,
  },
  card: {
    alignItems: 'center',
    borderRadius: DsRadius.xl,
    gap: DsSpace.md,
    padding: DsSpace.lg,
  },
  actions: {
    alignSelf: 'stretch',
    gap: DsSpace.sm,
  },
  text: {
    ...DsTypography.body,
    textAlign: 'center',
  },
});
