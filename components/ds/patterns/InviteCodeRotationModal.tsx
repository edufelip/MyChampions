import { Modal, StyleSheet, Text, View } from 'react-native';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useWebDialogAccessibility } from '@/hooks/use-web-dialog-accessibility';
import type { useTranslation } from '@/localization';

type TFn = ReturnType<typeof useTranslation>['t'];

export function InviteCodeRotationModal({
  isVisible,
  isSubmitting,
  onClose,
  onConfirm,
  errorMessage,
  scheme,
  theme,
  t,
}: {
  isVisible: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  errorMessage: string | null;
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
}) {
  useWebDialogAccessibility({
    isVisible,
    onClose,
    testID: 'pro.home.rotateCodeModal',
  });

  return (
    <Modal visible={isVisible} animationType="fade" onRequestClose={onClose} transparent>
      <View
        style={[styles.overlay, { backgroundColor: theme.color.overlaySoft }]}
        testID="pro.home.rotateCodeModal"
      >
        <View
          accessibilityViewIsModal
          style={[styles.content, { backgroundColor: theme.color.surface }]}
          testID="pro.home.rotateCodeModal.content"
        >
          <Text
            accessibilityRole="header"
            style={[styles.title, { color: theme.color.textPrimary }]}
            testID="pro.home.rotateCodeModal.title"
          >
            {t('pro.home.invite_code.rotate_confirm_title')}
          </Text>
          <Text style={[styles.body, { color: theme.color.textSecondary }]}>
            {t('pro.home.invite_code.rotate_confirm_body')}
          </Text>

          {errorMessage ? (
            <Text
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              style={[styles.error, { color: theme.color.danger }]}
              testID="pro.home.rotateCodeModal.error"
            >
              {errorMessage}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <DsPillButton
              scheme={scheme}
              label={t('pro.home.invite_code.rotate_confirm_no')}
              onPress={onClose}
              disabled={isSubmitting}
              variant="ghost"
              style={styles.actionButton}
              testID="pro.home.rotateCodeCancelCta"
            />
            <DsPillButton
              scheme={scheme}
              label={t('pro.home.invite_code.rotate_confirm_yes')}
              onPress={onConfirm}
              loading={isSubmitting}
              variant="primary"
              style={styles.actionButton}
              testID="pro.home.rotateCodeConfirmCta"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: DsSpace.md,
  },
  content: {
    borderRadius: DsRadius.xl,
    gap: DsSpace.md,
    padding: DsSpace.lg,
  },
  title: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts.rounded,
    fontSize: 22,
  },
  body: {
    ...DsTypography.body,
    lineHeight: 22,
  },
  error: {
    ...DsTypography.caption,
  },
  actions: {
    gap: DsSpace.sm,
  },
  actionButton: {
    minHeight: 48,
    width: '100%',
  },
});
