import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useState, useEffect } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from '@/features/platform/haptics-adapter';

import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useSupport } from '@/features/support/use-support';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useAuthSession } from '@/features/auth/auth-session';
import type { useTranslation } from '@/localization';
import { useWebDialogAccessibility } from '@/hooks/use-web-dialog-accessibility';

type TFn = ReturnType<typeof useTranslation>['t'];

const SUBJECT_LIMIT = 50;
const BODY_LIMIT = 500;

export function SupportModal({
  isVisible,
  onClose,
  scheme,
  theme,
  t,
}: {
  isVisible: boolean;
  onClose: () => void;
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
}) {
  const { state, submit, reset } = useSupport();
  const { lockedRole } = useAuthSession();
  const networkStatus = useNetworkStatus();
  const isOffline = networkStatus === 'offline';

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const isSubmitting = state.kind === 'submitting';
  const isSuccess = state.kind === 'success';
  const isError = state.kind === 'error';
  const isSubmitLocked = isSubmitting || isOffline;
  useWebDialogAccessibility({
    isVisible,
    onClose,
    testID: 'settings.account.support.modal',
  });

  useEffect(() => {
    if (isVisible) {
      setSubject('');
      setBody('');
      reset();
    }
  }, [isVisible, reset]);

  const handleSubmit = async () => {
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();
    
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    
    await submit({
      subject: trimmedSubject,
      body: trimmedBody,
      userRole: lockedRole,
    });
  };

  useEffect(() => {
    if (state.kind === 'success') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (state.kind === 'error') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [state.kind]);

  const handleClose = () => {
    onClose();
  };

  return (
    <Modal visible={isVisible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.flex}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <View style={[styles.modalOverlay, { backgroundColor: theme.color.overlaySoft }]}>
            <View
              style={[styles.modalContent, { backgroundColor: theme.color.surface }]}
              testID="settings.account.support.modal">
                <View style={styles.modalHeader}>
                  <Text
                    style={[styles.modalTitle, { color: theme.color.textPrimary }]}
                    accessibilityRole="header">
                    {t('settings.account.support.dialog.title')}
                  </Text>
                  <Pressable
                    onPress={handleClose}
                    onTouchEnd={handleClose}
                    disabled={isSubmitting}
                    hitSlop={12}
                    style={styles.closeButton}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cta.cancel') as string}
                    testID="settings.account.support.closeButton">
                    <MaterialIcons
                      name="close"
                      size={24}
                      color={theme.color.textTertiary}
                      style={{ opacity: isSubmitting ? 0.3 : 1 }}
                    />
                  </Pressable>
                </View>

                {isSuccess ? (
                  <View
                    style={styles.successContainer}
                    accessibilityLiveRegion="polite"
                    testID="settings.account.support.success">
                    <View style={[styles.successIcon, { backgroundColor: theme.color.successSoft }]}>
                      <MaterialIcons name="check-circle" size={48} color={theme.color.success} />
                    </View>
                    <View style={styles.successTextColumn}>
                      <Text style={[styles.successText, { color: theme.color.textPrimary }]}>
                        {t('settings.account.support.success')}
                      </Text>
                    </View>
                    <DsPillButton
                      scheme={scheme}
                      label={t('auth.role.cta_continue') as string}
                      onPress={handleClose}
                      variant="primary"
                    />
                  </View>
                ) : (
                  <ScrollView
                    contentContainerStyle={styles.modalScroll}
                    keyboardShouldPersistTaps="handled">
                    <Text style={[styles.disclaimer, { color: theme.color.textSecondary }]}>
                      {t('settings.account.support.dialog.disclaimer')}
                    </Text>

                    <View style={styles.field}>
                      <View style={styles.labelRow}>
                        <Text style={[styles.label, { color: theme.color.textPrimary }]}>
                          {t('settings.account.support.field.subject.label')}
                        </Text>
                        <Text
                          style={[
                            styles.counter,
                            {
                              color:
                                subject.length >= SUBJECT_LIMIT
                                  ? theme.color.danger
                                  : theme.color.textTertiary,
                            },
                          ]}>
                          {subject.length}/{SUBJECT_LIMIT}
                        </Text>
                      </View>
                      <TextInput
                        testID="settings.account.support.subjectInput"
                        style={[
                          styles.input,
                          {
                            backgroundColor: theme.color.surfaceMuted,
                            color: theme.color.textPrimary,
                            borderColor:
                              state.kind === 'error' && state.reason.includes('subject')
                                ? theme.color.danger
                                : 'transparent',
                          },
                        ]}
                        placeholder={t('settings.account.support.field.subject.placeholder') as string}
                        placeholderTextColor={theme.color.textTertiary}
                        value={subject}
                        onChangeText={setSubject}
                        maxLength={SUBJECT_LIMIT}
                        editable={!isSubmitting}
                        accessibilityLabel={t('settings.account.support.field.subject.label') as string}
                      />
                      {state.kind === 'error' && state.reason === 'subject_required' && (
                        <Text
                          style={[styles.errorText, { color: theme.color.danger }]}
                          accessibilityRole="alert"
                          testID="settings.account.support.subjectError">
                          {t('settings.account.support.validation.subject_required')}
                        </Text>
                      )}
                    </View>

                    <View style={styles.field}>
                      <View style={styles.labelRow}>
                        <Text style={[styles.label, { color: theme.color.textPrimary }]}>
                          {t('settings.account.support.field.body.label')}
                        </Text>
                        <Text
                          style={[
                            styles.counter,
                            {
                              color:
                                body.length >= BODY_LIMIT
                                  ? theme.color.danger
                                  : theme.color.textTertiary,
                            },
                          ]}>
                          {body.length}/{BODY_LIMIT}
                        </Text>
                      </View>
                      <TextInput
                        testID="settings.account.support.bodyInput"
                        style={[
                          styles.input,
                          styles.textArea,
                          {
                            backgroundColor: theme.color.surfaceMuted,
                            color: theme.color.textPrimary,
                            borderColor:
                              state.kind === 'error' && state.reason.includes('body')
                                ? theme.color.danger
                                : 'transparent',
                          },
                        ]}
                        placeholder={t('settings.account.support.field.body.placeholder') as string}
                        placeholderTextColor={theme.color.textTertiary}
                        value={body}
                        onChangeText={setBody}
                        maxLength={BODY_LIMIT}
                        multiline
                        numberOfLines={6}
                        textAlignVertical="top"
                        editable={!isSubmitting}
                        accessibilityLabel={t('settings.account.support.field.body.label') as string}
                      />
                      {state.kind === 'error' && state.reason === 'body_required' && (
                        <Text
                          style={[styles.errorText, { color: theme.color.danger }]}
                          accessibilityRole="alert"
                          testID="settings.account.support.bodyError">
                          {t('settings.account.support.validation.body_required')}
                        </Text>
                      )}
                    </View>

                    {state.kind === 'error' && !state.reason.includes('required') && (
                      <View
                        style={[styles.errorBanner, { backgroundColor: theme.color.dangerSoft }]}
                        accessibilityRole="alert"
                        testID="settings.account.support.errorBanner">
                        <Text style={[styles.errorBannerText, { color: theme.color.danger }]}>
                          {t('settings.account.support.error')}
                        </Text>
                      </View>
                    )}

                    {isOffline && (
                      <View
                        style={[styles.errorBanner, { backgroundColor: theme.color.warningSoft }]}
                        accessibilityRole="alert"
                        testID="settings.account.support.offlineBanner">
                        <Text style={[styles.errorBannerText, { color: theme.color.warning }]}>
                          {t('offline.write_lock')}
                        </Text>
                      </View>
                    )}

                    <DsPillButton
                      scheme={scheme}
                      label={
                        isError && !state.reason.includes('required')
                          ? (t('common.error.retry') as string)
                          : (t('settings.account.support.cta_submit') as string)
                      }
                      onPress={handleSubmit}
                      loading={isSubmitting}
                      disabled={isSubmitLocked}
                      variant="primary"
                      style={styles.submitButton}
                      testID="settings.account.support.submitCta"
                    />
                    <DsPillButton
                      scheme={scheme}
                      label={t('common.cta.cancel') as string}
                      onPress={handleClose}
                      disabled={isSubmitting}
                      variant="ghost"
                      style={styles.cancelButton}
                      testID="settings.account.support.cancelCta"
                    />
                  </ScrollView>
                )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: DsRadius.xl,
    borderTopRightRadius: DsRadius.xl,
    minHeight: '60%',
    maxHeight: '90%',
    padding: DsSpace.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: DsSpace.md,
  },
  closeButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  modalTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 22,
  },
  modalScroll: {
    gap: DsSpace.md,
    paddingBottom: 40,
  },
  disclaimer: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: DsSpace.xs,
  },
  field: {
    gap: 8,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
  },
  counter: {
    fontSize: 12,
    fontWeight: '500',
  },
  input: {
    borderRadius: DsRadius.lg,
    borderWidth: 1.5,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 56,
  },
  textArea: {
    minHeight: 140,
    paddingTop: 12,
  },
  submitButton: {
    marginTop: DsSpace.sm,
  },
  cancelButton: {
    marginTop: -DsSpace.xs,
  },
  errorText: {
    fontSize: 12,
    marginLeft: 4,
    marginTop: -4,
  },
  errorBanner: {
    padding: 12,
    borderRadius: DsRadius.md,
    marginBottom: DsSpace.xs,
  },
  errorBannerText: {
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  successContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 24,
  },
  successIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTextColumn: {
    alignItems: 'center',
    gap: 8,
  },
  successText: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  offlineNotice: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },
});
