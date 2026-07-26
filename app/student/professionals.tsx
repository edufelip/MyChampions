/**
 * SC-211 Relationship Management — Student view
 * Route: /student/professionals
 *
 * Surfaces: invite-code entry, QR code scanner (BL-002), pending/active
 * connection status, canceled_code_rotated state (BL-003 / D-064 / D-069),
 * and unbind confirmation flow.
 */
import { CameraView } from 'expo-camera';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsRadius, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useQrScannerAdapter } from '@/features/platform/qr-scanner-adapter';
import { useConnections } from '@/features/connections/use-connections';
import type { ConnectionDisplayState } from '@/features/connections/connection.logic';
import { mapInviteSubmitReasonToMessageKey } from '@/features/connections/connection.logic';
import { parseQrInvitePayload } from '@/features/connections/qr-invite.logic';
import {
  buildInvitePendingCanceled,
  buildInvitePendingCreated,
  buildInviteSubmitFailed,
  buildInviteSubmitRequested,
} from '@/features/analytics/analytics.logic';
import { useAnalytics } from '@/features/analytics/use-analytics';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation, type TranslationKey } from '@/localization';
import { useWebDialogAccessibility } from '@/hooks/use-web-dialog-accessibility';

export default function StudentProfessionalsScreen() {
  const { width: viewportWidth } = useWindowDimensions();
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuthSession();
  const { emitEvent } = useAnalytics();

  const { state, reload, submitCode, unbindConnection } = useConnections(Boolean(currentUser));

  const [inviteCode, setInviteCode] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [pendingUnbindConnectionId, setPendingUnbindConnectionId] = useState<string | null>(null);
  const [isUnbinding, setIsUnbinding] = useState(false);
  const [unbindError, setUnbindError] = useState<string | null>(null);
  const canSubmitInviteCode = Boolean(inviteCode.trim());
  const usesCompactInviteLayout = viewportWidth < 480;

  const qrScanner = useQrScannerAdapter();

  const emittedCanceledRef = useRef(false);
  useEffect(() => {
    if (state.kind !== 'ready' || emittedCanceledRef.current) return;
    const hasCanceled = state.displayStates.some((ds) => ds.kind === 'canceled_code_rotated');
    if (hasCanceled) {
      emittedCanceledRef.current = true;
      emitEvent(buildInvitePendingCanceled());
    }
  }, [state, emitEvent]);

  const openQrScanner = useCallback(async () => {
    try {
      if (getE2EQrInvitePayload()) {
        setIsQrModalOpen(true);
        return;
      }

      const isCameraAvailable = await qrScanner.isAvailable();
      if (!isCameraAvailable) {
        setSubmitError(t('relationship.qr.camera_unavailable'));
        return;
      }

      setIsQrModalOpen(true);
    } catch {
      setSubmitError(t('relationship.qr.camera_unavailable'));
    }
  }, [qrScanner, t]);

  const onSubmitCode = useCallback(
    async (code: string, surface: 'manual' | 'qr') => {
      const trimmed = code.trim();
      if (!trimmed) return;

      setIsSubmitting(true);
      setSubmitError(null);

      emitEvent(buildInviteSubmitRequested(surface));

      const errorReason = await submitCode(trimmed);

      setIsSubmitting(false);

      if (!errorReason) {
        emitEvent(buildInvitePendingCreated(surface));
        setInviteCode('');
        return;
      }

      emitEvent(buildInviteSubmitFailed(surface, errorReason));

      const messageKey = mapInviteSubmitReasonToMessageKey(errorReason);
      setSubmitError(t(messageKey as Parameters<typeof t>[0]));
    },
    [emitEvent, submitCode, t]
  );

  const onScanQr = useCallback(async () => {
    setSubmitError(null);

    if (qrScanner.permissionGranted) {
      await openQrScanner();
      return;
    }
    const granted = await qrScanner.requestPermission();
    if (granted) {
      await openQrScanner();
    } else {
      setSubmitError(t('relationship.qr.permission_denied'));
    }
  }, [openQrScanner, qrScanner, t]);

  const onQrCodeScanned = useCallback(
    (code: string) => {
      setIsQrModalOpen(false);
      void onSubmitCode(code, 'qr');
    },
    [onSubmitCode]
  );

  const onUnbind = (connectionId: string) => {
    setPendingUnbindConnectionId(connectionId);
    setUnbindError(null);
  };

  const cancelUnbind = () => {
    if (isUnbinding) return;
    setPendingUnbindConnectionId(null);
    setUnbindError(null);
  };

  const confirmUnbind = async () => {
    if (!pendingUnbindConnectionId || isUnbinding) return;

    setIsUnbinding(true);
    setUnbindError(null);
    const err = await unbindConnection(pendingUnbindConnectionId);
    setIsUnbinding(false);

    if (err) {
      setUnbindError(t('relationship.unbind.error'));
      return;
    }

    setPendingUnbindConnectionId(null);
  };

  return (
    <>
      <DsScreen scheme={scheme} contentWidth="content" testID="student.professionals.screen" contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: t('relationship.title'), headerShown: false }} />

        <DsBackButton
          scheme={scheme}
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }

            router.replace('/');
          }}
          accessibilityLabel={t('auth.role.cta_back') as string}
          style={styles.backButton}
          testID="student.professionals.backButton"
        />

        <Text style={[styles.intro, { color: theme.color.textPrimary }]}>{t('relationship.intro')}</Text>
        <Text style={[styles.helper, { color: theme.color.textSecondary }]}>
          {t('relationship.helper_self_guided')}
        </Text>

        <View style={[styles.row, usesCompactInviteLayout && styles.compactRow]}>
          <TextInput
            accessibilityLabel={t('relationship.input.invite_code')}
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={(value) => {
              setInviteCode(value);
              setSubmitError(null);
            }}
            placeholder={t('relationship.input.invite_code')}
            placeholderTextColor={theme.color.textSecondary}
            returnKeyType="done"
            style={[
              styles.codeInput,
              {
                backgroundColor: theme.color.surface,
                borderColor: submitError ? theme.color.danger : theme.color.border,
                color: theme.color.textPrimary,
              },
            ]}
            testID="student.professionals.codeInput"
            value={inviteCode}
            onSubmitEditing={() => {
              void onSubmitCode(inviteCode, 'manual');
            }}
          />

          <DsPillButton
            scheme={scheme}
            label={t('relationship.cta_submit_code')}
            onPress={() => {
              void onSubmitCode(inviteCode, 'manual');
            }}
            loading={isSubmitting}
            disabled={!canSubmitInviteCode}
            fullWidth={usesCompactInviteLayout}
            style={styles.connectButton}
            testID={
              canSubmitInviteCode
                ? 'student.professionals.connectButton'
                : 'student.professionals.connectButton.disabled'
            }
          />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void onScanQr();
          }}
          testID="student.professionals.scanQrButton">
          <Text style={[styles.link, { color: theme.color.accentPrimary }]}>{t('relationship.cta_scan_qr')}</Text>
        </Pressable>

        <View accessibilityLiveRegion="polite">
          {submitError ? (
            <Text style={[styles.inlineError, { color: theme.color.danger }]} testID="student.professionals.submitError">
              {submitError}
            </Text>
          ) : null}
        </View>

        {state.kind === 'loading' ? (
          <ActivityIndicator
            accessibilityLabel={t('a11y.loading.default')}
            style={styles.centered}
            testID="student.professionals.loading"
            color={theme.color.accentPrimary}
          />
        ) : state.kind === 'error' ? (
          <View style={styles.centered}>
            <Text style={[styles.errorText, { color: theme.color.textPrimary }]}>
              {t('common.error.generic')}
            </Text>
            <Pressable accessibilityRole="button" onPress={reload} testID="student.professionals.retryButton">
              <Text style={[styles.link, { color: theme.color.accentPrimary }]}>{t('common.error.retry')}</Text>
            </Pressable>
          </View>
        ) : state.kind === 'ready' ? (
          <>
            {state.displayStates.map((displayState, index) => (
              <ConnectionCard
                key={displayState.connectionId}
                displayState={displayState}
                onUnbind={onUnbind}
                scheme={scheme}
                t={t}
                testIndex={index}
              />
            ))}
            {pendingUnbindConnectionId ? (
              <UnbindConfirmationPanel
                isSubmitting={isUnbinding}
                error={unbindError}
                onCancel={cancelUnbind}
                onConfirm={confirmUnbind}
                scheme={scheme}
                t={t}
              />
            ) : null}
          </>
        ) : null}
      </DsScreen>

      <QrScannerModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        onCodeScanned={onQrCodeScanned}
        t={t}
        scheme={scheme}
      />
    </>
  );
}

function QrScannerModal({
  isOpen,
  onClose,
  onCodeScanned,
  t,
  scheme,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCodeScanned: (code: string) => void;
  t: (key: TranslationKey) => string;
  scheme: 'light' | 'dark';
}) {
  const theme = getDsTheme(scheme);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const scannedRef = useRef(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const e2eQrInvitePayload = getE2EQrInvitePayload();

  useEffect(() => {
    if (isOpen) {
      scannedRef.current = false;
      setScanError(null);
      setIsCameraActive(!e2eQrInvitePayload);
    }

    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [e2eQrInvitePayload, isOpen]);

  const handleClose = useCallback(() => {
    scannedRef.current = true;
    setScanError(null);
    setIsCameraActive(false);

    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 100);
  }, [onClose]);
  useWebDialogAccessibility({
    isVisible: isOpen,
    onClose: handleClose,
    testID: 'student.professionals.qrModal',
  });

  const handleBarCodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scannedRef.current) return;

      const result = parseQrInvitePayload(data);
      if (result.kind === 'ok') {
        scannedRef.current = true;
        setIsCameraActive(false);
        onCodeScanned(result.code);
      } else {
        setScanError(t('relationship.qr.invalid_payload'));
        scannedRef.current = false;
      }
    },
    [onCodeScanned, t]
  );

  useEffect(() => {
    if (!isOpen || !e2eQrInvitePayload) return;

    const timer = setTimeout(() => {
      handleBarCodeScanned({ data: e2eQrInvitePayload });
    }, 100);

    return () => clearTimeout(timer);
  }, [e2eQrInvitePayload, handleBarCodeScanned, isOpen]);

  if (!isOpen) return null;

  return (
    <Modal
      animationType="slide"
      onRequestClose={handleClose}
      transparent={false}
      visible
      testID="student.professionals.qrModal">
      <SafeAreaView style={styles.qrContainer}>
        {e2eQrInvitePayload ? null : (
          <CameraView
            active={isCameraActive}
            style={StyleSheet.absoluteFillObject}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={isCameraActive ? handleBarCodeScanned : undefined}
          />
        )}

        {scanError ? (
          <View style={styles.qrErrorBanner} testID="student.professionals.qrScanError">
            <Text style={styles.qrErrorText}>{scanError}</Text>
          </View>
        ) : null}

        {e2eQrInvitePayload ? (
          <View style={styles.qrE2ERow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('relationship.cta_scan_qr') as string}
              onPress={() => handleBarCodeScanned({ data: e2eQrInvitePayload })}
              style={[styles.qrE2EButton, { backgroundColor: theme.color.accentPrimary }]}
              testID="student.professionals.qrE2EScanButton">
              <Text
                style={[styles.qrE2EText, { color: theme.color.surface }]}
                testID="student.professionals.qrE2EScanButton.label">
                {t('relationship.cta_scan_qr')}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.qrCloseRow}>
          <Pressable
            accessibilityRole="button"
            onPress={handleClose}
            style={[styles.qrCloseButton, { backgroundColor: theme.color.surface }]}
            testID="student.professionals.qrCloseButton">
            <Text style={[styles.qrCloseText, { color: theme.color.textPrimary }]}>
              {t('relationship.qr.close')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function getE2EQrInvitePayload(): string | null {
  const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
  const appVariant = process.env.APP_VARIANT;
  const isDevVariant = appVariant === undefined || appVariant === '' || appVariant === 'dev';
  const isAuthHarnessEnabled = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION === 'true';
  const payload = process.env.EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD?.trim();

  if (!isDev || !isDevVariant || !isAuthHarnessEnabled || !payload) {
    return null;
  }

  return payload;
}

function UnbindConfirmationPanel({
  error,
  isSubmitting,
  onCancel,
  onConfirm,
  scheme,
  t,
}: {
  error: string | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  scheme: 'light' | 'dark';
  t: (key: TranslationKey) => string;
}) {
  const theme = getDsTheme(scheme);

  return (
    <DsCard
      scheme={scheme}
      style={[styles.unbindPanel, { borderColor: theme.color.danger }]}
      testID="student.professionals.unbindConfirm">
      <Text style={[styles.cardSpecialty, { color: theme.color.textPrimary }]}>
        {t('relationship.unbind.confirm_title')}
      </Text>
      <Text style={[styles.cardStatus, { color: theme.color.textSecondary }]}>
        {t('relationship.unbind.confirm_body')}
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={[styles.inlineError, { color: theme.color.danger }]}>
          {error}
        </Text>
      ) : null}
      <View style={styles.unbindActions}>
        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={onCancel}
          style={[styles.unbindSecondaryButton, { borderColor: theme.color.border, opacity: isSubmitting ? 0.5 : 1 }]}
          testID="student.professionals.unbindConfirm.cancel">
          <Text style={[styles.unbindSecondaryText, { color: theme.color.textPrimary }]}>
            {t('relationship.unbind.confirm_no')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={isSubmitting}
          onPress={onConfirm}
          style={[styles.unbindDangerButton, { backgroundColor: theme.color.danger, opacity: isSubmitting ? 0.5 : 1 }]}
          testID="student.professionals.unbindConfirm.confirm">
          {isSubmitting ? (
            <ActivityIndicator color={theme.color.surface} />
          ) : (
            <Text style={[styles.unbindDangerText, { color: theme.color.surface }]}>
              {t('relationship.unbind.confirm_yes')}
            </Text>
          )}
        </Pressable>
      </View>
    </DsCard>
  );
}

function ConnectionCard({
  displayState,
  onUnbind,
  scheme,
  t,
  testIndex,
}: {
  displayState: ConnectionDisplayState;
  onUnbind: (id: string) => void;
  scheme: 'light' | 'dark';
  t: (key: TranslationKey) => string;
  testIndex: number;
}) {
  const theme = getDsTheme(scheme);
  const borderColor =
    displayState.kind === 'active'
      ? theme.color.accentPrimary
      : displayState.kind === 'pending'
      ? theme.color.textSecondary
      : theme.color.danger;

  return (
    <DsCard
      scheme={scheme}
      style={[styles.connectionCard, { borderColor, borderLeftColor: borderColor }]}
      testID={`student.professionals.connectionCard.${testIndex}`}>
      <Text style={[styles.cardSpecialty, { color: theme.color.textPrimary }]}> 
        {displayState.specialty === 'nutritionist' ? 'Nutritionist' : 'Fitness Coach'}
      </Text>

      {displayState.kind === 'pending' ? (
        <Text
          style={[styles.cardStatus, { color: theme.color.textSecondary }]}
          testID={`student.professionals.connectionPending.${displayState.connectionId}`}>
          {t('relationship.pending.helper')}
        </Text>
      ) : displayState.kind === 'canceled_code_rotated' ? (
        <Text accessibilityRole="alert" style={[styles.cardStatus, { color: theme.color.danger }]}> 
          {t('relationship.pending.canceled_code_rotated')}
        </Text>
      ) : displayState.kind === 'active' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onUnbind(displayState.connectionId)}
          testID={`student.professionals.unbindButton.${testIndex}`}>
          <Text style={[styles.link, { color: theme.color.danger }]}>{t('relationship.unbind.cta')}</Text>
        </Pressable>
      ) : displayState.kind === 'ended' ? (
        <Text
          accessibilityRole="text"
          style={[styles.cardStatus, { color: theme.color.textSecondary }]}
          testID={`student.professionals.connectionEnded.${testIndex}`}>
          {t('relationship.unbind.ended')}
        </Text>
      ) : null}
    </DsCard>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 16,
  },
  backButton: { marginBottom: 4 },
  intro: {
    fontFamily: Fonts.rounded,
    fontSize: 26,
    fontWeight: '700',
  },
  helper: {
    ...DsTypography.body,
  },
  row: {
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  compactRow: {
    flexDirection: 'column',
  },
  codeInput: {
    borderRadius: DsRadius.sm,
    borderWidth: 1.5,
    flex: 1,
    fontSize: 16,
    letterSpacing: 2,
    minHeight: 48,
    minWidth: 0,
    paddingHorizontal: 12,
  },
  connectButton: {
    minHeight: 48,
    paddingHorizontal: 14,
  },
  inlineError: {
    ...DsTypography.caption,
  },
  connectionCard: {
    borderLeftWidth: 4,
    gap: DsSpace.sm,
    padding: 14,
  },
  unbindPanel: {
    borderWidth: 1.5,
    gap: DsSpace.sm,
    padding: 14,
  },
  unbindActions: {
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  unbindSecondaryButton: {
    alignItems: 'center',
    borderRadius: DsRadius.sm,
    borderWidth: 1.5,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  unbindDangerButton: {
    alignItems: 'center',
    borderRadius: DsRadius.sm,
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  unbindSecondaryText: {
    fontSize: 14,
    fontWeight: '700',
  },
  unbindDangerText: {
    fontSize: 14,
    fontWeight: '700',
  },
  cardSpecialty: {
    fontSize: 15,
    fontWeight: '700',
  },
  cardStatus: {
    ...DsTypography.caption,
  },
  centered: {
    alignItems: 'center',
    gap: DsSpace.md,
    paddingVertical: 32,
  },
  errorText: {
    fontSize: 15,
  },
  link: {
    fontSize: 15,
    fontWeight: '600',
  },
  qrContainer: {
    flex: 1,
    backgroundColor: 'black',
  },
  qrErrorBanner: {
    backgroundColor: 'rgba(179,38,30,0.9)',
    borderRadius: DsRadius.sm,
    margin: 20,
    padding: 14,
  },
  qrErrorText: {
    color: 'white',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  qrCloseRow: {
    alignItems: 'center',
    bottom: 40,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  qrCloseButton: {
    borderRadius: DsRadius.sm,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  qrCloseText: {
    fontSize: 15,
    fontWeight: '600',
  },
  qrE2ERow: {
    alignItems: 'center',
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: '45%',
    zIndex: 20,
  },
  qrE2EButton: {
    borderRadius: DsRadius.sm,
    minHeight: 56,
    minWidth: 220,
    paddingHorizontal: 24,
    paddingVertical: 12,
    zIndex: 21,
  },
  qrE2EText: {
    fontSize: 15,
    fontWeight: '700',
  },
});
