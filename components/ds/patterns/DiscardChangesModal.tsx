import { Modal, StyleSheet, Text, View } from 'react-native';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import {
  DsRadius,
  DsSpace,
  DsTypography,
  type DsColorScheme,
  type DsTheme,
} from '@/constants/design-system';
import { useWebDialogAccessibility } from '@/hooks/use-web-dialog-accessibility';

export function DiscardChangesModal({
  isVisible,
  onCancel,
  onConfirm,
  scheme,
  theme,
  title,
  body,
  cancelLabel,
  confirmLabel,
  testID,
}: {
  isVisible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  scheme: DsColorScheme;
  theme: DsTheme;
  title: string;
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  testID: string;
}) {
  useWebDialogAccessibility({ isVisible, onClose: onCancel, testID });

  return (
    <Modal visible={isVisible} animationType="fade" onRequestClose={onCancel} transparent>
      <View
        accessible
        accessibilityViewIsModal
        role="dialog"
        style={[styles.overlay, { backgroundColor: theme.color.overlayStrong }]}
        testID={testID}
      >
        <View style={[styles.card, { backgroundColor: theme.color.surface }]}>
          <Text style={[styles.title, { color: theme.color.textPrimary }]}>{title}</Text>
          <Text style={[styles.body, { color: theme.color.textSecondary }]}>{body}</Text>
          <View style={styles.actions}>
            <DsPillButton
              scheme={scheme}
              variant="ghost"
              label={cancelLabel}
              onPress={onCancel}
              fullWidth={false}
              style={styles.action}
              testID={`${testID}.cancel`}
            />
            <DsPillButton
              scheme={scheme}
              variant="primary"
              label={confirmLabel}
              onPress={onConfirm}
              fullWidth={false}
              style={styles.action}
              testID={`${testID}.confirm`}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: DsSpace.lg,
  },
  card: {
    borderRadius: DsRadius.xl,
    maxWidth: 420,
    padding: DsSpace.lg,
    width: '100%',
  },
  title: {
    ...DsTypography.cardTitle,
    marginBottom: DsSpace.sm,
  },
  body: {
    ...DsTypography.body,
  },
  actions: {
    flexDirection: 'row',
    gap: DsSpace.sm,
    marginTop: DsSpace.lg,
  },
  action: {
    flex: 1,
  },
});
