/**
 * SC-211 Relationship Management — Student view
 * Route: /student/professionals
 *
 * Surfaces: invite-code entry, QR code scanner (BL-002), pending/active
 * connection status, canceled_code_rotated state (BL-003 / D-064 / D-069),
 * and unbind confirmation flow.
 */
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { DsRadius, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
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

export default function StudentProfessionalsScreen() {
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

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const emittedCanceledRef = useRef(false);
  useEffect(() => {
    if (state.kind !== 'ready' || emittedCanceledRef.current) return;
    const hasCanceled = state.displayStates.some((ds) => ds.kind === 'canceled_code_rotated');
    if (hasCanceled) {
      emittedCanceledRef.current = true;
      emitEvent(buildInvitePendingCanceled());
    }
  }, [state, emitEvent]);

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
    if (cameraPermission?.granted) {
      setIsQrModalOpen(true);
      return;
    }
    const result = await requestCameraPermission();
    if (result.granted) {
      setIsQrModalOpen(true);
    } else {
      setSubmitError(t('relationship.qr.permission_denied'));
    }
  }, [cameraPermission, requestCameraPermission, t]);

  const onQrCodeScanned = useCallback(
    (code: string) => {
      setIsQrModalOpen(false);
      void onSubmitCode(code, 'qr');
    },
    [onSubmitCode]
  );

  const onUnbind = (connectionId: string) => {
    Alert.alert(
      t('relationship.unbind.confirm_title'),
      t('relationship.unbind.confirm_body'),
      [
        {
          text: t('relationship.unbind.confirm_no'),
          style: 'cancel',
        },
        {
          text: t('relationship.unbind.confirm_yes'),
          style: 'destructive',
          onPress: async () => {
            const err = await unbindConnection(connectionId);
            if (err) {
              Alert.alert(t('relationship.unbind.error'));
            }
          },
        },
      ]
    );
  };

  return (
    <>
      <DsScreen scheme={scheme} testID="student.professionals.screen" contentContainerStyle={styles.content}>
        <Stack.Screen options={{ title: t('relationship.title'), headerShown: true }} />

        <Text style={[styles.intro, { color: theme.color.textPrimary }]}>{t('relationship.intro')}</Text>
        <Text style={[styles.helper, { color: theme.color.textSecondary }]}>
          {t('relationship.helper_self_guided')}
        </Text>

        <View style={styles.row}>
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
            disabled={!inviteCode.trim()}
            fullWidth={false}
            style={styles.connectButton}
            testID="student.professionals.connectButton"
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
        ) : state.kind === 'ready' && state.displayStates.length === 0 ? (
          <View style={styles.centered}>
            <Text style={[styles.emptyText, { color: theme.color.textSecondary }]}>
              {t('common.empty.no_data')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              testID="student.professionals.selfGuidedCta">
              <Text style={[styles.link, { color: theme.color.accentPrimary }]}> 
                {t('relationship.empty.cta_continue_self')}
              </Text>
            </Pressable>
          </View>
        ) : state.kind === 'ready' ? (
          state.displayStates.map((displayState, index) => (
            <ConnectionCard
              key={displayState.connectionId}
              displayState={displayState}
              onUnbind={onUnbind}
              scheme={scheme}
              t={t}
              testIndex={index}
            />
          ))
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
  const scannedRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      scannedRef.current = false;
      setScanError(null);
    }
  }, [isOpen]);

  const handleBarCodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scannedRef.current) return;

      const result = parseQrInvitePayload(data);
      if (result.kind === 'ok') {
        scannedRef.current = true;
        onCodeScanned(result.code);
      } else {
        setScanError(t('relationship.qr.invalid_payload'));
        scannedRef.current = false;
      }
    },
    [onCodeScanned, t]
  );

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent={false}
      visible={isOpen}
      testID="student.professionals.qrModal">
      <SafeAreaView style={styles.qrContainer}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleBarCodeScanned}
        />

        {scanError ? (
          <View style={styles.qrErrorBanner} testID="student.professionals.qrScanError">
            <Text style={styles.qrErrorText}>{scanError}</Text>
          </View>
        ) : null}

        <View style={styles.qrCloseRow}>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
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
        <Text style={[styles.cardStatus, { color: theme.color.textSecondary }]}>
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
  codeInput: {
    borderRadius: DsRadius.sm,
    borderWidth: 1.5,
    flex: 1,
    fontSize: 16,
    letterSpacing: 2,
    minHeight: 48,
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
  emptyText: {
    fontSize: 15,
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
    backgroundColor: '#000',
  },
  qrErrorBanner: {
    backgroundColor: 'rgba(179,38,30,0.9)',
    borderRadius: DsRadius.sm,
    margin: 20,
    padding: 14,
  },
  qrErrorText: {
    color: '#fff',
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
});
