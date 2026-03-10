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
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { useState, useEffect } from 'react';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useSupport } from '@/features/support/use-support';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useAuthSession } from '@/features/auth/auth-session';
import type { useTranslation } from '@/localization';

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

  return (
    <Modal visible={isVisible} animationType="slide" transparent>
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.flex}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.flex}>
            <View style={[styles.modalOverlay, { backgroundColor: theme.color.overlaySoft }]}>
              <View style={[styles.modalContent, { backgroundColor: theme.color.surface }]}>
                <View style={styles.modalHeader}>
                  <Text
                    style={[styles.modalTitle, { color: theme.color.textPrimary }]}
                    accessibilityRole="header">
                    {t('settings.account.support.dialog.title')}
                  </Text>
                  <Pressable
                    onPress={onClose}
                    disabled={isSubmitting}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={t('common.cta.cancel') as string}>
                    <MaterialIcons
                      name="close"
                      size={24}
                      color={theme.color.textTertiary}
                      style={{ opacity: isSubmitting ? 0.3 : 1 }}
                    />
                  </Pressable>
                </View>

                {isSuccess ? (
                  <View style={styles.successContainer} accessibilityLiveRegion="polite">
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
                      onPress={onClose}
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
                          accessibilityRole="alert">
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
                          accessibilityRole="alert">
                          {t('settings.account.support.validation.body_required')}
                        </Text>
                      )}
                    </View>

                    {state.kind === 'error' && !state.reason.includes('required') && (
                      <View
                        style={[styles.errorBanner, { backgroundColor: theme.color.dangerSoft }]}
                        accessibilityRole="alert">
                        <Text style={[styles.errorBannerText, { color: theme.color.danger }]}>
                          {t('settings.account.support.error')}
                        </Text>
                      </View>
                    )}

                    {isOffline && (
                      <View
                        style={[styles.errorBanner, { backgroundColor: theme.color.warningSoft }]}
                        accessibilityRole="alert">
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
                    />
                  </ScrollView>
                )}
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </TouchableWithoutFeedback>
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
