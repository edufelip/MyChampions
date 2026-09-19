import { MaterialIcons } from '@expo/vector-icons';
import { useState, useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  View,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { useDsModalSheetLayout } from '@/components/ds/primitives/useDsModalSheetLayout';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import * as Haptics from '@/features/platform/haptics-adapter';
import { requestSupportModalDismissal } from '@/features/support/support.logic';
import { useSupport } from '@/features/support/use-support';
import { useWebDialogAccessibility } from '@/hooks/use-web-dialog-accessibility';
import type { useTranslation } from '@/localization';

const WEB_TEXTAREA_RESET =
  Platform.OS === 'web' ? ({ resize: 'none' } as unknown as TextStyle) : undefined;

type TFn = ReturnType<typeof useTranslation>['t'];

const SUBJECT_LIMIT = 50;
const BODY_LIMIT = 500;
const SHEET_DISMISS_DISTANCE = 120;

type SupportTouchPoint = {
  clientY?: number;
  pageY?: number;
};

type SupportTouchEvent = {
  nativeEvent?: SupportTouchPoint & {
    changedTouches?: ArrayLike<SupportTouchPoint>;
  };
};

function getSupportTouchPageY(event: SupportTouchEvent): number | null {
  const nativeEvent = event.nativeEvent;
  const changedTouch = nativeEvent?.changedTouches?.[0];
  const pageY = changedTouch?.pageY ?? nativeEvent?.pageY;
  if (typeof pageY === 'number' && Number.isFinite(pageY)) return pageY;

  const clientY = changedTouch?.clientY ?? nativeEvent?.clientY;
  if (typeof clientY !== 'number' || !Number.isFinite(clientY)) return null;

  const scrollOffset = Platform.OS === 'web' && typeof window !== 'undefined' ? window.scrollY : 0;
  return clientY + scrollOffset;
}

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
  const wasVisible = useRef(false);

  const isSubmitting = state.kind === 'submitting';
  const isSubmittingRef = useRef(isSubmitting);
  isSubmittingRef.current = isSubmitting;
  const isSuccess = state.kind === 'success';
  const isError = state.kind === 'error';
  const isCooldown = state.kind === 'cooldown';
  const isSubmitLocked = isSubmitting || isOffline || isCooldown;
  const modalLayout = useDsModalSheetLayout();
  const sheetTranslateY = useRef(new Animated.Value(0)).current;
  const sheetDragStart = useRef<{ pageY: number } | null>(null);

  const resetSheetPosition = () => {
    Animated.spring(sheetTranslateY, {
      toValue: 0,
      useNativeDriver: true,
    }).start();
  };

  const finishSheetDrag = (distance: number) => {
    if (distance < SHEET_DISMISS_DISTANCE || isSubmittingRef.current) {
      resetSheetPosition();
      return;
    }

    Animated.timing(sheetTranslateY, {
      toValue: 640,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      sheetTranslateY.setValue(0);
      requestSupportModalDismissal({ isSubmitting: isSubmittingRef.current, onClose });
    });
  };

  const handleSheetTouchStart = (event: SupportTouchEvent) => {
    if (modalLayout.isDesktop || isSubmitting) return;
    const pageY = getSupportTouchPageY(event);
    if (pageY === null) return;
    sheetDragStart.current = { pageY };
  };

  const handleSheetTouchMove = (event: SupportTouchEvent) => {
    if (!sheetDragStart.current) return;
    const pageY = getSupportTouchPageY(event);
    if (pageY === null) return;
    sheetTranslateY.setValue(Math.max(0, pageY - sheetDragStart.current.pageY));
  };

  const handleSheetTouchEnd = (event: SupportTouchEvent) => {
    const dragStart = sheetDragStart.current;
    sheetDragStart.current = null;
    if (!dragStart) return;

    const pageY = getSupportTouchPageY(event);
    if (pageY === null) {
      resetSheetPosition();
      return;
    }

    const distance = Math.max(0, pageY - dragStart.pageY);
    finishSheetDrag(distance);
  };

  const cancelSheetDrag = () => {
    sheetDragStart.current = null;
    resetSheetPosition();
  };
  useWebDialogAccessibility({
    dialogTitleTestID: 'settings.account.support.dialog.title',
    isVisible,
    onClose: handleClose,
    testID: 'settings.account.support.modal',
  });

  useEffect(() => {
    if (!isVisible) {
      wasVisible.current = false;
      return;
    }

    if (wasVisible.current) return;
    wasVisible.current = true;
    sheetTranslateY.setValue(0);

    if (state.kind === 'cooldown') return;

    setSubject('');
    setBody('');
    reset();
  }, [isVisible, reset, state.kind, sheetTranslateY]);

  const handleSubmit = async () => {
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();

    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    await submit({
      subject: trimmedSubject,
      body: trimmedBody,
      userRole: lockedRole,
    });
  };

  useEffect(() => {
    if (state.kind === 'success') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else if (state.kind === 'error') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, [state.kind]);

  function handleClose() {
    requestSupportModalDismissal({ isSubmitting, onClose });
  }

  return (
    <Modal visible={isVisible} animationType="slide" onRequestClose={handleClose} transparent>
      <View style={styles.flex}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <View
            style={[
              styles.modalOverlay,
              modalLayout.overlayStyle,
              { backgroundColor: theme.color.overlayNeutral },
            ]}
            testID="settings.account.support.overlay"
          >
            <Animated.View
              style={[
                styles.modalContent,
                modalLayout.contentStyle,
                { backgroundColor: theme.color.surface },
                { transform: [{ translateY: sheetTranslateY }] },
              ]}
              testID="settings.account.support.modal"
            >
              <View
                accessible={false}
                onTouchCancel={cancelSheetDrag}
                onTouchEnd={handleSheetTouchEnd}
                onTouchMove={handleSheetTouchMove}
                onTouchStart={handleSheetTouchStart}
                style={styles.dragHandleArea}
              >
                <View
                  style={[styles.dragHandle, { backgroundColor: theme.color.borderStrong }]}
                  testID="settings.account.support.dragHandle"
                />
              </View>
              <View style={styles.modalHeader}>
                <Text
                  style={[styles.modalTitle, { color: theme.color.textPrimary }]}
                  accessibilityRole="header"
                  testID="settings.account.support.dialog.title"
                >
                  {t('settings.account.support.dialog.title')}
                </Text>
                <Pressable
                  onPress={handleClose}
                  disabled={isSubmitting}
                  hitSlop={12}
                  style={styles.closeButton}
                  accessibilityRole="button"
                  accessibilityLabel={t('settings.account.support.dialog.close')}
                  testID="settings.account.support.closeButton"
                >
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
                  testID="settings.account.support.success"
                >
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
                    label={t('auth.role.cta_continue')}
                    onPress={handleClose}
                    variant="primary"
                  />
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={styles.modalScroll}
                  keyboardShouldPersistTaps="handled"
                >
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
                        ]}
                      >
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
                              : theme.color.border,
                        },
                      ]}
                      placeholder={t('settings.account.support.field.subject.placeholder')}
                      placeholderTextColor={theme.color.textTertiary}
                      value={subject}
                      onChangeText={setSubject}
                      maxLength={SUBJECT_LIMIT}
                      editable={!isSubmitting}
                      accessibilityLabel={t('settings.account.support.field.subject.label')}
                    />
                    {state.kind === 'error' && state.reason === 'subject_required' && (
                      <Text
                        style={[styles.errorText, { color: theme.color.danger }]}
                        accessibilityRole="alert"
                        testID="settings.account.support.subjectError"
                      >
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
                        ]}
                      >
                        {body.length}/{BODY_LIMIT}
                      </Text>
                    </View>
                    <TextInput
                      testID="settings.account.support.bodyInput"
                      style={[
                        styles.input,
                        styles.textArea,
                        WEB_TEXTAREA_RESET,
                        {
                          backgroundColor: theme.color.surfaceMuted,
                          color: theme.color.textPrimary,
                          borderColor:
                            state.kind === 'error' && state.reason.includes('body')
                              ? theme.color.danger
                              : theme.color.border,
                        },
                      ]}
                      placeholder={t('settings.account.support.field.body.placeholder')}
                      placeholderTextColor={theme.color.textTertiary}
                      value={body}
                      onChangeText={setBody}
                      maxLength={BODY_LIMIT}
                      multiline
                      numberOfLines={6}
                      textAlignVertical="top"
                      editable={!isSubmitting}
                      accessibilityLabel={t('settings.account.support.field.body.label')}
                    />
                    {state.kind === 'error' && state.reason === 'body_required' && (
                      <Text
                        style={[styles.errorText, { color: theme.color.danger }]}
                        accessibilityRole="alert"
                        testID="settings.account.support.bodyError"
                      >
                        {t('settings.account.support.validation.body_required')}
                      </Text>
                    )}
                  </View>

                  {state.kind === 'error' && !state.reason.includes('required') && (
                    <View
                      style={[styles.errorBanner, { backgroundColor: theme.color.dangerSoft }]}
                      accessibilityRole="alert"
                      testID="settings.account.support.errorBanner"
                    >
                      <Text style={[styles.errorBannerText, { color: theme.color.danger }]}>
                        {t('settings.account.support.error')}
                      </Text>
                    </View>
                  )}

                  {isCooldown && (
                    <View
                      style={[styles.errorBanner, { backgroundColor: theme.color.warningSoft }]}
                      accessibilityRole="alert"
                      testID="settings.account.support.cooldownBanner"
                    >
                      <Text style={[styles.errorBannerText, { color: theme.color.warning }]}>
                        {t('settings.account.support.cooldown', {
                          seconds: state.retryAfterSeconds,
                        })}
                      </Text>
                    </View>
                  )}

                  {isOffline && (
                    <View
                      style={[styles.errorBanner, { backgroundColor: theme.color.warningSoft }]}
                      accessibilityRole="alert"
                      testID="settings.account.support.offlineBanner"
                    >
                      <Text style={[styles.errorBannerText, { color: theme.color.warning }]}>
                        {t('offline.write_lock')}
                      </Text>
                    </View>
                  )}

                  <DsPillButton
                    scheme={scheme}
                    label={
                      isError && !state.reason.includes('required')
                        ? t('common.error.retry')
                        : t('settings.account.support.cta_submit')
                    }
                    onPress={() => void handleSubmit()}
                    loading={isSubmitting}
                    disabled={isSubmitLocked}
                    variant="primary"
                    style={[styles.submitButton, styles.submitButtonWithoutGlow]}
                    testID="settings.account.support.submitCta"
                  />
                  <DsPillButton
                    scheme={scheme}
                    label={t('common.cta.cancel')}
                    onPress={handleClose}
                    disabled={isSubmitting}
                    variant="ghost"
                    style={styles.cancelButton}
                    testID="settings.account.support.cancelCta"
                  />
                </ScrollView>
              )}
            </Animated.View>
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
  dragHandleArea: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    marginTop: -DsSpace.sm,
  },
  dragHandle: {
    borderRadius: DsRadius.pill,
    height: 4,
    width: 44,
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
  submitButtonWithoutGlow: {
    elevation: 0,
    shadowColor: 'transparent',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 0,
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
