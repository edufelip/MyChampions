import { StyleSheet, View } from 'react-native';
import { useLocale } from '@/localization/locale-context';
import { isLocaleDiagnosticAvailable } from './locale-diagnostic-build-guard';

const styles = StyleSheet.create({
  // Keep the seam in the app viewport so native hierarchy tools can retain
  // its test IDs while the transparent, pointer-free pixel remains invisible.
  root: {
    backgroundColor: 'transparent',
    elevation: 1,
    height: 8,
    left: 4,
    opacity: 1,
    position: 'absolute',
    top: 32,
    width: 8,
    zIndex: 9999,
  },
  node: {
    backgroundColor: 'transparent',
    height: 2,
    width: 2,
  },
});

function DiagnosticNode({ testID }: { testID: string }) {
  return (
    <View
      accessible={false}
      importantForAccessibility="yes"
      collapsable={false}
      pointerEvents="none"
      style={styles.node}
      testID={testID}
    />
  );
}

/**
 * Dev-only, non-user-facing native hierarchy seam. Values are closed IDs from
 * LocaleContext; raw storage and exception text are never rendered.
 */
export function LocaleDiagnostic() {
  const { diagnostic } = useLocale();
  if (!isLocaleDiagnosticAvailable()) return null;

  const nodes = [
    `testing.locale.hydration.${diagnostic.hydration}`,
    `testing.locale.override.${diagnostic.override.status}`,
  ];
  if (diagnostic.effectiveLocale !== null && diagnostic.hydration === 'hydrated')
    nodes.push(`testing.locale.effective.${diagnostic.effectiveLocale}`);
  if (diagnostic.override.status === 'present' && diagnostic.override.value !== null)
    nodes.push(`testing.locale.overrideValue.${diagnostic.override.value}`);

  return (
    <View
      accessible={false}
      importantForAccessibility="yes"
      collapsable={false}
      pointerEvents="none"
      style={styles.root}
      testID="testing.locale.diagnostic"
    >
      {nodes.map((testID) => (
        <DiagnosticNode key={testID} testID={testID} />
      ))}
    </View>
  );
}
