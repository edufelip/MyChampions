/**
 * SC-202 Professional Specialty Setup
 * Routes: /onboarding/professional-specialty  (also reachable post-onboarding)
 *         /professional/settings/specialties
 *
 * Allows professionals to:
 *  - Add / remove Nutritionist or Fitness Coach specialty
 *  - Submit optional per-specialty registry credential
 *  - See removal-blocker reasons (active/pending students, last-specialty rule)
 *
 * Docs: docs/screens/v2/SC-202-professional-specialty-setup.md
 * Refs: D-100, FR-103, FR-119, FR-158, FR-174–177, BR-202, BR-212, BR-229, BR-237–239
 *
 * Offline wiring: real network status via useNetworkStatus (BL-008, FR-214).
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { Colors, Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import { useSpecialties } from '@/features/professional/use-professional';
import type { Specialty, SpecialtyRecord } from '@/features/professional/specialty.logic';
import {
  resolveRemovalAssistState,
  buildActionMetadata,
  getRemovalBlockedMessageKeys,
  type RemovalAssistState,
} from '@/features/professional/specialty-removal-assist.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type CredentialFormData = {
  registryId: string;
  authority: string;
  country: string;
};

type Palette = (typeof Colors)['light'];
type TFn = ReturnType<typeof useTranslation>['t'];

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ProfessionalSpecialtyScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const palette = Colors[colorScheme];
  const { t } = useTranslation();
  const { currentUser } = useAuthSession();
  const router = useRouter();

  const networkStatus = useNetworkStatus();
  const offlineDisplay: OfflineDisplayState = resolveOfflineDisplayState({
    networkStatus,
    lastSyncedAtIso: null,
  });
  const isWriteLocked = offlineDisplay.showOfflineBanner;

  const { state, addSpecialty, removeSpecialty, checkRemoval, upsertCredential } =
    useSpecialties(currentUser);

  // Credential form state: null = closed; set to specialty when open
  const [credentialFor, setCredentialFor] = useState<Specialty | null>(null);
  const [credentialForm, setCredentialForm] = useState<CredentialFormData>({
    registryId: '',
    authority: '',
    country: '',
  });
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [isSavingCredential, setIsSavingCredential] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);

  // BL-011: blocked removal assist state
  const [blockedAssist, setBlockedAssist] = useState<{
    specialty: Specialty;
    assistState: RemovalAssistState;
  } | null>(null);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function findRecord(specialty: Specialty): SpecialtyRecord | undefined {
    if (state.kind !== 'ready') return undefined;
    return state.specialties.find((s) => s.specialty === specialty);
  }

  async function handleAdd(specialty: Specialty) {
    setActionError(null);
    const err = await addSpecialty(specialty);
    if (err) {
      setActionError(t('pro.specialty.add_error') as string);
    }
  }

  async function handleRemove(specialty: Specialty) {
    setActionError(null);
    setBlockedAssist(null);
    const record = findRecord(specialty);
    if (!record) return;

    // activeCount / pendingCount come from the record when available (stubbed 0 — real wiring deferred).
    // We pass the same counts to both the guard check and the assist state so the block reason
    // is derived once from a single source of truth (checkRemoval → result.reason).
    const activeStudentCount = 0;
    const pendingStudentCount = 0;
    const result = checkRemoval(specialty, activeStudentCount, pendingStudentCount);
    if (result.allowed === false) {
      const totalSpecialties = state.kind === 'ready' ? state.specialties.length : 1;
      // Use the same counts that produced result.reason — no independent re-derivation.
      const assistState = resolveRemovalAssistState({
        specialty,
        activeStudentCount,
        pendingStudentCount,
        totalActiveSpecialties: totalSpecialties,
      });
      setBlockedAssist({ specialty, assistState });
      return;
    }

    const err = await removeSpecialty(specialty);
    if (err) {
      setActionError(t('pro.specialty.remove_error') as string);
    }
  }

  function openCredentialForm(specialty: Specialty) {
    setCredentialFor(specialty);
    setCredentialForm({ registryId: '', authority: '', country: '' });
    setCredentialError(null);
  }

  async function handleSaveCredential() {
    if (!credentialFor) return;
    setCredentialError(null);
    setIsSavingCredential(true);

    const err = await upsertCredential(credentialFor, credentialForm);
    setIsSavingCredential(false);

    if (err) {
      setCredentialError(t('pro.specialty.credential.save_error') as string);
    } else {
      setCredentialFor(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
      testID="pro.specialty.screen">
      <Stack.Screen options={{ title: t('pro.specialty.title'), headerShown: true }} />

      {/* Offline banner (BL-008) */}
      {offlineDisplay.showOfflineBanner ? (
        <View
          style={[styles.offlineBanner, { backgroundColor: '#b3261e22', borderColor: '#b3261e' }]}
          testID="pro.specialty.offlineBanner">
          <Text style={[styles.offlineBannerText, { color: palette.text }]}>
            {t('offline.banner')}
          </Text>
        </View>
      ) : null}

      {/* Loading */}
      {state.kind === 'loading' ? (
        <ActivityIndicator
          testID="pro.specialty.loading"
          style={styles.centered}
          accessibilityLabel={t('a11y.loading.default') as string}
        />
      ) : null}

      {/* Error */}
      {state.kind === 'error' ? (
        <Text
          style={[styles.errorText, { color: '#b3261e' }]}
          testID="pro.specialty.error">
          {state.message}
        </Text>
      ) : null}

      {/* Action error */}
      {actionError ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.errorText, { color: '#b3261e' }]} testID="pro.specialty.actionError">
            {actionError}
          </Text>
        </View>
      ) : null}

      {/* BL-011: Inline removal assist card */}
      {blockedAssist ? (
        <RemovalAssistCard
          specialty={blockedAssist.specialty}
          assistState={blockedAssist.assistState}
          palette={palette}
          t={t}
          onAction={(navigationTarget) => {
            setBlockedAssist(null);
            // `as never` is required because expo-router typed routes only accept literal
            // string types at compile time, not runtime string variables. The runtime route
            // strings returned by buildActionMetadata are validated at the logic layer.
            if (navigationTarget) router.push(navigationTarget as never);
          }}
          onDismiss={() => setBlockedAssist(null)}
        />
      ) : null}

      {/* Empty */}
      {state.kind === 'ready' && state.specialties.length === 0 ? (
        <Text
          style={[styles.emptyText, { color: palette.icon }]}
          testID="pro.specialty.empty">
          {t('pro.specialty.empty')}
        </Text>
      ) : null}

      {/* Specialty rows */}
      {state.kind === 'ready' ? (
        <SpecialtyList
          specialties={state.specialties}
          palette={palette}
          t={t}
          onRemove={handleRemove}
          onOpenCredential={openCredentialForm}
          isWriteLocked={isWriteLocked}
        />
      ) : null}

      {/* Add buttons */}
      <AddSpecialtyButtons
        specialties={state.kind === 'ready' ? state.specialties : []}
        palette={palette}
        t={t}
        onAdd={handleAdd}
        isWriteLocked={isWriteLocked}
      />

      {/* Credential form */}
      {credentialFor ? (
        <CredentialForm
          specialty={credentialFor}
          form={credentialForm}
          error={credentialError}
          isSaving={isSavingCredential}
          palette={palette}
          t={t}
          onChange={(field, value) =>
            setCredentialForm((prev: CredentialFormData) => ({ ...prev, [field]: value }))
          }
          onSave={handleSaveCredential}
          onSkip={() => setCredentialFor(null)}
          isWriteLocked={isWriteLocked}
        />
      ) : null}
    </ScrollView>
  );
}

// ─── Removal Assist Card (BL-011) ────────────────────────────────────────────

function RemovalAssistCard({
  specialty,
  assistState,
  palette,
  t,
  onAction,
  onDismiss,
}: {
  specialty: Specialty;
  assistState: RemovalAssistState;
  palette: Palette;
  t: TFn;
  onAction: (navigationTarget: string | undefined) => void;
  onDismiss: () => void;
}) {
  if (!assistState.blocked || !assistState.blockReason) return null;

  const { titleKey, bodyKey } = getRemovalBlockedMessageKeys(assistState.blockReason);
  const actions = assistState.availableActions.map((a) => buildActionMetadata(a, specialty));

  return (
    <View
      style={[styles.assistCard, { borderColor: '#b3261e66', backgroundColor: '#b3261e11' }]}
      accessibilityRole="alert"
      testID="pro.specialty.removalAssist">
      <Text style={[styles.assistTitle, { color: '#b3261e' }]}>
        {t(titleKey)}
      </Text>
      <Text style={[styles.assistBody, { color: palette.text }]}>
        {t(bodyKey)}
      </Text>

      {actions.map((meta) => (
        <Pressable
          key={meta.action}
          accessibilityRole="button"
          accessibilityLabel={t(meta.label)}
          onPress={() => onAction(meta.navigationTarget)}
          style={[
            styles.assistAction,
            meta.priority === 'primary'
              ? { backgroundColor: palette.tint }
              : { borderColor: palette.tint, borderWidth: 1.5 },
          ]}
          testID={`pro.specialty.removalAssist.${meta.action}`}>
          <Text
            style={[
              styles.assistActionText,
              meta.priority === 'primary' ? { color: '#fff' } : { color: palette.tint },
            ]}>
            {t(meta.label)}
          </Text>
          <Text style={[styles.assistActionDesc, { color: meta.priority === 'primary' ? '#ffffffbb' : palette.icon }]}>
            {t(meta.description)}
          </Text>
        </Pressable>
      ))}

      <Pressable
        accessibilityRole="button"
        onPress={onDismiss}
        testID="pro.specialty.removalAssist.dismiss">
        <Text style={[styles.link, { color: palette.icon }]}>
          {t('pro.specialty.remove_blocked.dismiss') as string}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── Specialty List ───────────────────────────────────────────────────────────

function SpecialtyList({
  specialties,
  palette,
  t,
  onRemove,
  onOpenCredential,
  isWriteLocked,
}: {
  specialties: SpecialtyRecord[];
  palette: Palette;
  t: TFn;
  onRemove: (s: Specialty) => void;
  onOpenCredential: (s: Specialty) => void;
  isWriteLocked: boolean;
}) {
  return (
    <>
      {specialties.map((record) => (
        <View
          key={record.specialty}
          style={[styles.card, { borderColor: palette.tint + '66' }]}
          testID={`pro.specialty.row.${record.specialty}`}>
          <Text style={[styles.cardTitle, { color: palette.text }]}>
            {record.specialty === 'nutritionist'
              ? t('pro.specialty.nutritionist')
              : t('pro.specialty.fitness_coach')}
          </Text>

          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenCredential(record.specialty)}
              disabled={isWriteLocked}
              testID={`pro.specialty.credential.${record.specialty}`}>
              <Text style={[styles.link, { color: isWriteLocked ? palette.icon : palette.tint }]}>
                {t('pro.specialty.credential.title')}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => onRemove(record.specialty)}
              disabled={isWriteLocked}
              testID={`pro.specialty.remove.${record.specialty}`}>
              <Text style={[styles.link, { color: isWriteLocked ? palette.icon : '#b3261e' }]}>
                {t('pro.specialty.remove')}
              </Text>
            </Pressable>
          </View>
        </View>
      ))}
    </>
  );
}

// ─── Add Specialty Buttons ────────────────────────────────────────────────────

function AddSpecialtyButtons({
  specialties,
  palette,
  t,
  onAdd,
  isWriteLocked,
}: {
  specialties: SpecialtyRecord[];
  palette: Palette;
  t: TFn;
  onAdd: (s: Specialty) => void;
  isWriteLocked: boolean;
}) {
  const hasNutritionist = specialties.some((s) => s.specialty === 'nutritionist');
  const hasFitnessCoach = specialties.some((s) => s.specialty === 'fitness_coach');

  return (
    <View style={styles.addButtonsRow}>
      {!hasNutritionist ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onAdd('nutritionist')}
          disabled={isWriteLocked}
          style={[styles.outlineButton, { borderColor: isWriteLocked ? palette.icon : palette.tint }]}
          testID="pro.specialty.add.nutritionist">
          <Text style={[styles.outlineButtonText, { color: isWriteLocked ? palette.icon : palette.tint }]}>
            {t('pro.specialty.add_nutritionist')}
          </Text>
        </Pressable>
      ) : null}

      {!hasFitnessCoach ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onAdd('fitness_coach')}
          disabled={isWriteLocked}
          style={[styles.outlineButton, { borderColor: isWriteLocked ? palette.icon : palette.tint }]}
          testID="pro.specialty.add.fitness_coach">
          <Text style={[styles.outlineButtonText, { color: isWriteLocked ? palette.icon : palette.tint }]}>
            {t('pro.specialty.add_fitness_coach')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ─── Credential Form ──────────────────────────────────────────────────────────

function CredentialForm({
  specialty,
  form,
  error,
  isSaving,
  palette,
  t,
  onChange,
  onSave,
  onSkip,
  isWriteLocked,
}: {
  specialty: Specialty;
  form: CredentialFormData;
  error: string | null;
  isSaving: boolean;
  palette: Palette;
  t: TFn;
  onChange: (field: keyof CredentialFormData, value: string) => void;
  onSave: () => void;
  onSkip: () => void;
  isWriteLocked: boolean;
}) {
  const specialtyLabel =
    specialty === 'nutritionist'
      ? t('pro.specialty.nutritionist')
      : t('pro.specialty.fitness_coach');

  return (
    <View
      style={[styles.card, { borderColor: palette.tint + '66' }]}
      testID="pro.specialty.credentialForm">
      <Text style={[styles.cardTitle, { color: palette.text }]}>
        {t('pro.specialty.credential.title')} — {specialtyLabel}
      </Text>

      <LabeledInput
        label={t('pro.specialty.credential.registry_id.label') as string}
        placeholder={t('pro.specialty.credential.registry_id.placeholder') as string}
        value={form.registryId}
        onChangeText={(v) => onChange('registryId', v)}
        palette={palette}
        testID="pro.specialty.credential.registryId"
      />

      <LabeledInput
        label={t('pro.specialty.credential.authority.label') as string}
        placeholder={t('pro.specialty.credential.authority.placeholder') as string}
        value={form.authority}
        onChangeText={(v) => onChange('authority', v)}
        palette={palette}
        testID="pro.specialty.credential.authority"
      />

      <LabeledInput
        label={t('pro.specialty.credential.country.label') as string}
        placeholder={t('pro.specialty.credential.country.placeholder') as string}
        value={form.country}
        onChangeText={(v) => onChange('country', v)}
        palette={palette}
        testID="pro.specialty.credential.country"
      />

      {error ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.errorText, { color: '#b3261e' }]}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.row}>
        {isSaving ? (
          <ActivityIndicator accessibilityLabel={t('a11y.loading.saving') as string} />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={onSave}
            disabled={isWriteLocked || isSaving}
            style={[styles.primaryButton, { backgroundColor: isWriteLocked ? palette.icon : palette.tint }]}
            testID="pro.specialty.credential.save">
            <Text style={styles.primaryButtonText}>
              {t('pro.specialty.credential.save')}
            </Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={onSkip}
          testID="pro.specialty.credential.skip">
          <Text style={[styles.link, { color: palette.icon }]}>
            {t('pro.specialty.credential.skip')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ─── Labeled Input ────────────────────────────────────────────────────────────

function LabeledInput({
  label,
  placeholder,
  value,
  onChangeText,
  palette,
  testID,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (v: string) => void;
  palette: Palette;
  testID: string;
}) {
  return (
    <View style={styles.fieldWrapper}>
      <Text style={[styles.fieldLabel, { color: palette.text }]}>{label}</Text>
      <TextInput
        style={[styles.input, { borderColor: palette.icon + '66', color: palette.text }]}
        placeholder={placeholder}
        placeholderTextColor={palette.icon}
        value={value}
        onChangeText={onChangeText}
        testID={testID}
        accessibilityLabel={label}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40, gap: 16 },
  centered: { alignSelf: 'center', marginVertical: 16 },
  card: { borderRadius: 12, borderWidth: 1.5, gap: 10, padding: 16 },
  cardTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
  },
  row: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  addButtonsRow: { gap: 12 },
  link: { fontSize: 14, fontWeight: '600' },
  outlineButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 48,
  },
  outlineButtonText: { fontSize: 15, fontWeight: '600' },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 10,
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  emptyText: { fontSize: 14, textAlign: 'center' },
  errorText: { fontSize: 13 },
  fieldWrapper: { gap: 4 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  offlineBanner: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  offlineBannerText: { fontSize: 13, lineHeight: 18 },
  assistCard: {
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 12,
    padding: 16,
  },
  assistTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 15,
    fontWeight: '700',
  },
  assistBody: { fontSize: 13, lineHeight: 18 },
  assistAction: {
    borderRadius: 10,
    gap: 2,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  assistActionText: { fontSize: 14, fontWeight: '600' },
  assistActionDesc: { fontSize: 12 },
});
