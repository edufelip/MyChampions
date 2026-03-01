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
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useConnections } from '@/features/connections/use-connections';
import type { ConnectionDisplayState } from '@/features/connections/connection.logic';
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
  const palette = Colors[colorScheme];
  const router = useRouter();
  const { t } = useTranslation();
  const { currentUser } = useAuthSession();
  const { emitEvent } = useAnalytics();

  const { state, reload, submitCode, unbindConnection } = useConnections(currentUser);

  const [inviteCode, setInviteCode] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // Emit canceled event once when canceled_code_rotated connections first appear.
  const emittedCanceledRef = useRef(false);
  useEffect(() => {
    if (state.kind !== 'ready' || emittedCanceledRef.current) return;
    const hasCanceled = state.displayStates.some((ds) => ds.kind === 'canceled_code_rotated');
    if (hasCanceled) {
      emittedCanceledRef.current = true;
      emitEvent(buildInvitePendingCanceled());
    }
  }, [state, emitEvent]);

  /**
   * Shared submit handler — used by both manual entry and QR scan.
   * BR-263: QR and manual paths converge here.
   */
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

      switch (errorReason) {
        case 'code_not_found':
        case 'code_expired':
          setSubmitError(t('relationship.error.invalid_code'));
          break;
        case 'already_connected':
          setSubmitError(t('relationship.error.already_connected'));
          break;
        case 'pending_cap_reached':
          setSubmitError(t('relationship.error.pending_cap'));
          break;
        case 'network':
          setSubmitError(t('relationship.error.network'));
          break;
        default:
          setSubmitError(t('relationship.error.unknown'));
      }
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

  /** Called by QrScannerModal when a valid code is extracted. */
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
      <ScrollView
        style={[styles.container, { backgroundColor: palette.background }]}
        contentContainerStyle={styles.content}
        testID="student.professionals.screen">
        <Stack.Screen options={{ title: t('relationship.title'), headerShown: true }} />

        {/* ── Invite code entry ─────────────────────────────────── */}
        <Text style={[styles.intro, { color: palette.text }]}>{t('relationship.intro')}</Text>
        <Text style={[styles.helper, { color: palette.icon }]}>
          {t('relationship.helper_self_guided')}
        </Text>

        <View style={styles.row}>
          <TextInput
            accessibilityLabel={t('relationship.input.invite_code')}
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={(v) => {
              setInviteCode(v);
              setSubmitError(null);
            }}
            placeholder={t('relationship.input.invite_code')}
            placeholderTextColor={palette.icon}
            returnKeyType="done"
            style={[
              styles.codeInput,
              {
                backgroundColor: palette.background,
                borderColor: submitError ? '#b3261e' : palette.icon,
                color: palette.text,
              },
            ]}
            testID="student.professionals.codeInput"
            value={inviteCode}
            onSubmitEditing={() => {
              void onSubmitCode(inviteCode, 'manual');
            }}
          />
          <Pressable
            accessibilityRole="button"
            disabled={isSubmitting || !inviteCode.trim()}
            onPress={() => {
              void onSubmitCode(inviteCode, 'manual');
            }}
            style={[
              styles.connectButton,
              {
                backgroundColor:
                  isSubmitting || !inviteCode.trim() ? palette.icon : palette.tint,
              },
            ]}
            testID="student.professionals.connectButton">
            {isSubmitting ? (
              <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting')} color="#fff" />
            ) : (
              <Text style={styles.connectButtonText}>{t('relationship.cta_submit_code')}</Text>
            )}
          </Pressable>
        </View>

        {/* ── QR scan CTA ───────────────────────────────────────── */}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void onScanQr();
          }}
          testID="student.professionals.scanQrButton">
          <Text style={[styles.link, { color: palette.tint }]}>{t('relationship.cta_scan_qr')}</Text>
        </Pressable>

        <View accessibilityLiveRegion="polite">
          {submitError ? (
            <Text style={styles.inlineError} testID="student.professionals.submitError">
              {submitError}
            </Text>
          ) : null}
        </View>

        {/* ── Connection list ───────────────────────────────────── */}
        {state.kind === 'loading' ? (
          <ActivityIndicator
            accessibilityLabel={t('a11y.loading.default')}
            style={styles.centered}
            testID="student.professionals.loading"
          />
        ) : state.kind === 'error' ? (
          <View style={styles.centered}>
            <Text style={[styles.errorText, { color: palette.text }]}>
              {t('common.error.generic')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={reload}
              testID="student.professionals.retryButton">
              <Text style={[styles.link, { color: palette.tint }]}>{t('common.error.retry')}</Text>
            </Pressable>
          </View>
        ) : state.kind === 'ready' && state.displayStates.length === 0 ? (
          <View style={styles.centered}>
            <Text style={[styles.emptyText, { color: palette.icon }]}>
              {t('common.empty.no_data')}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              testID="student.professionals.selfGuidedCta">
              <Text style={[styles.link, { color: palette.tint }]}>
                {t('relationship.empty.cta_continue_self')}
              </Text>
            </Pressable>
          </View>
        ) : state.kind === 'ready' ? (
          state.displayStates.map((ds, i) => (
            <ConnectionCard
              key={ds.connectionId}
              displayState={ds}
              onUnbind={onUnbind}
              palette={palette}
              t={t}
              testIndex={i}
            />
          ))
        ) : null}
      </ScrollView>

      {/* ── QR Scanner Modal ──────────────────────────────────────── */}
      <QrScannerModal
        isOpen={isQrModalOpen}
        onClose={() => setIsQrModalOpen(false)}
        onCodeScanned={onQrCodeScanned}
        t={t}
        palette={palette}
      />
    </>
  );
}

// ─── QR Scanner Modal ────────────────────────────────────────────────────────

type Palette = (typeof Colors)['light'];

function QrScannerModal({
  isOpen,
  onClose,
  onCodeScanned,
  t,
  palette,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCodeScanned: (code: string) => void;
  t: (key: TranslationKey) => string;
  palette: Palette;
}) {
  const [scanError, setScanError] = useState<string | null>(null);
  const scannedRef = useRef(false);

  // Reset scan state each time modal opens.
  useEffect(() => {
    if (isOpen) {
      scannedRef.current = false;
      setScanError(null);
    }
  }, [isOpen]);

  const handleBarCodeScanned = useCallback(
    ({ data }: { data: string }) => {
      // Prevent multiple rapid callbacks from the same scan.
      if (scannedRef.current) return;

      const result = parseQrInvitePayload(data);
      if (result.kind === 'ok') {
        scannedRef.current = true;
        onCodeScanned(result.code);
      } else {
        setScanError(t('relationship.qr.invalid_payload'));
        // Allow retry: reset so the next scan attempt can proceed.
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
      <SafeAreaView style={[styles.qrContainer, { backgroundColor: '#000' }]}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleBarCodeScanned}
        />

        {/* Overlay: error message */}
        {scanError ? (
          <View style={styles.qrErrorBanner} testID="student.professionals.qrScanError">
            <Text style={styles.qrErrorText}>{scanError}</Text>
          </View>
        ) : null}

        {/* Overlay: close button */}
        <View style={styles.qrCloseRow}>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.qrCloseButton, { backgroundColor: palette.background }]}
            testID="student.professionals.qrCloseButton">
            <Text style={[styles.qrCloseText, { color: palette.text }]}>
              {t('relationship.qr.close')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// ─── Connection Card ─────────────────────────────────────────────────────────

function ConnectionCard({
  displayState,
  onUnbind,
  palette,
  t,
  testIndex,
}: {
  displayState: ConnectionDisplayState;
  onUnbind: (id: string) => void;
  palette: Palette;
  t: (key: TranslationKey) => string;
  testIndex: number;
}) {
  const borderColor =
    displayState.kind === 'active'
      ? palette.tint
      : displayState.kind === 'pending'
        ? palette.icon
        : '#b3261e';

  return (
    <View
      style={[styles.card, { borderColor, borderLeftColor: borderColor }]}
      testID={`student.professionals.connectionCard.${testIndex}`}>
      <Text style={[styles.cardSpecialty, { color: palette.text }]}>
        {displayState.specialty === 'nutritionist' ? 'Nutritionist' : 'Fitness Coach'}
      </Text>

      {displayState.kind === 'pending' ? (
        <Text style={[styles.cardStatus, { color: palette.icon }]}>
          {t('relationship.pending.helper')}
        </Text>
      ) : displayState.kind === 'canceled_code_rotated' ? (
        <Text
          accessibilityRole="alert"
          style={[styles.cardStatus, { color: '#b3261e' }]}>
          {t('relationship.pending.canceled_code_rotated')}
        </Text>
      ) : displayState.kind === 'active' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onUnbind(displayState.connectionId)}
          testID={`student.professionals.unbindButton.${testIndex}`}>
          <Text style={[styles.link, { color: '#b3261e' }]}>{t('relationship.unbind.cta')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 16,
  },
  intro: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 20,
    fontWeight: '700',
  },
  helper: {
    fontSize: 14,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  codeInput: {
    borderRadius: 10,
    borderWidth: 1.5,
    flex: 1,
    fontSize: 16,
    letterSpacing: 2,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  connectButton: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 16,
  },
  connectButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  inlineError: {
    color: '#b3261e',
    fontSize: 13,
  },
  card: {
    borderLeftWidth: 4,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  cardSpecialty: {
    fontSize: 15,
    fontWeight: '700',
  },
  cardStatus: {
    fontSize: 13,
    lineHeight: 18,
  },
  centered: {
    alignItems: 'center',
    gap: 12,
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
  // QR Scanner Modal styles
  qrContainer: {
    flex: 1,
  },
  qrErrorBanner: {
    backgroundColor: 'rgba(179,38,30,0.9)',
    margin: 20,
    borderRadius: 10,
    padding: 14,
  },
  qrErrorText: {
    color: '#fff',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  qrCloseRow: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  qrCloseButton: {
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  qrCloseText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
