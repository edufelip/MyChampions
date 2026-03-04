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
 * Refs: D-100, D-134, FR-103, FR-119, FR-158, FR-174–177, BR-202, BR-212, BR-229, BR-237–239
 *
 * Offline wiring: real network status via useNetworkStatus (BL-008, FR-214).
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';

import { DsCard } from '@/components/ds/primitives/DsCard';
import { DsOfflineBanner } from '@/components/ds/primitives/DsOfflineBanner';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import {
  DsRadius,
  DsSpace,
  DsTypography,
  getDsTheme,
} from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import {
  resolveOfflineDisplayState,
  type OfflineDisplayState,
} from '@/features/offline/offline.logic';
import { useNetworkStatus } from '@/features/offline/use-network-status';
import {
  buildActionMetadata,
  getRemovalBlockedMessageKeys,
  resolveRemovalAssistState,
  type RemovalAssistState,
} from '@/features/professional/specialty-removal-assist.logic';
import type { Specialty, SpecialtyRecord } from '@/features/professional/specialty.logic';
import { useSpecialties } from '@/features/professional/use-professional';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

type CredentialFormData = {
  registryId: string;
  authority: string;
  country: string;
};

type TFn = ReturnType<typeof useTranslation>['t'];

export default function ProfessionalSpecialtyScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const palette = {
    text: theme.color.textPrimary,
    icon: theme.color.textSecondary,
    tint: theme.color.accentPrimary,
  };

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
    useSpecialties(Boolean(currentUser));

  const [credentialFor, setCredentialFor] = useState<Specialty | null>(null);
  const [credentialForId, setCredentialForId] = useState<string | null>(null);
  const [credentialForm, setCredentialForm] = useState<CredentialFormData>({
    registryId: '',
    authority: '',
    country: '',
  });
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [isSavingCredential, setIsSavingCredential] = useState(false);

  const [actionError, setActionError] = useState<string | null>(null);

  const [blockedAssist, setBlockedAssist] = useState<{
    specialty: Specialty;
    assistState: RemovalAssistState;
  } | null>(null);

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

    const activeStudentCount = 0;
    const pendingStudentCount = 0;
    const result = checkRemoval(specialty, activeStudentCount, pendingStudentCount);
    if (!result.allowed) {
      const totalSpecialties = state.kind === 'ready' ? state.specialties.length : 1;
      const assistState = resolveRemovalAssistState({
        specialty,
        activeStudentCount,
        pendingStudentCount,
        totalActiveSpecialties: totalSpecialties,
      });
      setBlockedAssist({ specialty, assistState });
      return;
    }

    const err = await removeSpecialty(record.id);
    if (err) {
      setActionError(t('pro.specialty.remove_error') as string);
    }
  }

  function openCredentialForm(specialty: Specialty) {
    const record = findRecord(specialty);
    setCredentialFor(specialty);
    setCredentialForId(record?.id ?? null);
    setCredentialForm({ registryId: '', authority: '', country: '' });
    setCredentialError(null);
  }

  async function handleSaveCredential() {
    if (!credentialFor || !credentialForId) return;
    setCredentialError(null);
    setIsSavingCredential(true);

    const err = await upsertCredential(credentialForId, credentialForm);
    setIsSavingCredential(false);

    if (err) {
      setCredentialError(t('pro.specialty.credential.save_error') as string);
      return;
    }

    setCredentialFor(null);
    setCredentialForId(null);
  }

  return (
    <DsScreen scheme={scheme} testID="pro.specialty.screen" contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: t('pro.specialty.title'), headerShown: true }} />

      {offlineDisplay.showOfflineBanner ? (
        <DsOfflineBanner
          scheme={scheme}
          text={t('offline.banner') as string}
          testID="pro.specialty.offlineBanner"
        />
      ) : null}

      {state.kind === 'loading' ? (
        <ActivityIndicator
          testID="pro.specialty.loading"
          style={styles.centered}
          accessibilityLabel={t('a11y.loading.default') as string}
          color={theme.color.accentPrimary}
        />
      ) : null}

      {state.kind === 'error' ? (
        <Text style={[styles.errorText, { color: theme.color.danger }]} testID="pro.specialty.error">
          {state.message}
        </Text>
      ) : null}

      {actionError ? (
        <View accessibilityLiveRegion="polite">
          <Text style={[styles.errorText, { color: theme.color.danger }]} testID="pro.specialty.actionError">
            {actionError}
          </Text>
        </View>
      ) : null}

      {blockedAssist ? (
        <RemovalAssistCard
          specialty={blockedAssist.specialty}
          assistState={blockedAssist.assistState}
          scheme={scheme}
          palette={palette}
          t={t}
          onAction={(navigationTarget) => {
            setBlockedAssist(null);
            if (navigationTarget) router.push(navigationTarget as never);
          }}
          onDismiss={() => setBlockedAssist(null)}
        />
      ) : null}

      {state.kind === 'ready' && state.specialties.length === 0 ? (
        <DsCard scheme={scheme} variant="muted">
          <Text style={[styles.emptyText, { color: palette.icon }]} testID="pro.specialty.empty">
            {t('pro.specialty.empty')}
          </Text>
        </DsCard>
      ) : null}

      {state.kind === 'ready' ? (
        <SpecialtyList
          specialties={state.specialties}
          scheme={scheme}
          palette={palette}
          t={t}
          onRemove={handleRemove}
          onOpenCredential={openCredentialForm}
          isWriteLocked={isWriteLocked}
        />
      ) : null}

      <AddSpecialtyButtons
        specialties={state.kind === 'ready' ? state.specialties : []}
        scheme={scheme}
        palette={palette}
        t={t}
        onAdd={handleAdd}
        isWriteLocked={isWriteLocked}
      />

      {credentialFor ? (
        <CredentialForm
          specialty={credentialFor}
          form={credentialForm}
          error={credentialError}
          isSaving={isSavingCredential}
          scheme={scheme}
          palette={palette}
          t={t}
          onChange={(field, value) =>
            setCredentialForm((prev: CredentialFormData) => ({ ...prev, [field]: value }))
          }
          onSave={handleSaveCredential}
          onSkip={() => {
            setCredentialFor(null);
            setCredentialForId(null);
          }}
          isWriteLocked={isWriteLocked}
        />
      ) : null}
    </DsScreen>
  );
}

function RemovalAssistCard({
  specialty,
  assistState,
  scheme,
  palette,
  t,
  onAction,
  onDismiss,
}: {
  specialty: Specialty;
  assistState: RemovalAssistState;
  scheme: 'light' | 'dark';
  palette: { text: string; icon: string; tint: string };
  t: TFn;
  onAction: (navigationTarget: string | undefined) => void;
  onDismiss: () => void;
}) {
  if (!assistState.blocked || !assistState.blockReason) return null;

  const { titleKey, bodyKey } = getRemovalBlockedMessageKeys(assistState.blockReason);
  const actions = assistState.availableActions.map((a) => buildActionMetadata(a, specialty));

  return (
    <DsCard scheme={scheme} variant="warning" accessibilityRole="alert" testID="pro.specialty.removalAssist">
      <Text style={[styles.assistTitle, { color: '#b3261e' }]}>{t(titleKey)}</Text>
      <Text style={[styles.assistBody, { color: palette.text }]}>{t(bodyKey)}</Text>

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
          <Text
            style={[
              styles.assistActionDesc,
              { color: meta.priority === 'primary' ? '#ffffffbb' : palette.icon },
            ]}>
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
    </DsCard>
  );
}

function SpecialtyList({
  specialties,
  scheme,
  palette,
  t,
  onRemove,
  onOpenCredential,
  isWriteLocked,
}: {
  specialties: SpecialtyRecord[];
  scheme: 'light' | 'dark';
  palette: { text: string; icon: string; tint: string };
  t: TFn;
  onRemove: (s: Specialty) => void;
  onOpenCredential: (s: Specialty) => void;
  isWriteLocked: boolean;
}) {
  return (
    <>
      {specialties.map((record) => (
        <DsCard scheme={scheme} key={record.specialty} testID={`pro.specialty.row.${record.specialty}`}>
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
        </DsCard>
      ))}
    </>
  );
}

function AddSpecialtyButtons({
  specialties,
  scheme,
  t,
  onAdd,
  isWriteLocked,
}: {
  specialties: SpecialtyRecord[];
  scheme: 'light' | 'dark';
  palette: { text: string; icon: string; tint: string };
  t: TFn;
  onAdd: (s: Specialty) => void;
  isWriteLocked: boolean;
}) {
  const hasNutritionist = specialties.some((s) => s.specialty === 'nutritionist');
  const hasFitnessCoach = specialties.some((s) => s.specialty === 'fitness_coach');

  return (
    <View style={styles.addButtonsRow}>
      {!hasNutritionist ? (
        <DsPillButton
          scheme={scheme}
          variant="secondary"
          label={t('pro.specialty.add_nutritionist') as string}
          onPress={() => onAdd('nutritionist')}
          disabled={isWriteLocked}
          testID="pro.specialty.add.nutritionist"
        />
      ) : null}

      {!hasFitnessCoach ? (
        <DsPillButton
          scheme={scheme}
          variant="secondary"
          label={t('pro.specialty.add_fitness_coach') as string}
          onPress={() => onAdd('fitness_coach')}
          disabled={isWriteLocked}
          testID="pro.specialty.add.fitness_coach"
        />
      ) : null}
    </View>
  );
}

function CredentialForm({
  specialty,
  form,
  error,
  isSaving,
  scheme,
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
  scheme: 'light' | 'dark';
  palette: { text: string; icon: string; tint: string };
  t: TFn;
  onChange: (field: keyof CredentialFormData, value: string) => void;
  onSave: () => void;
  onSkip: () => void;
  isWriteLocked: boolean;
}) {
  const specialtyLabel =
    specialty === 'nutritionist' ? t('pro.specialty.nutritionist') : t('pro.specialty.fitness_coach');

  return (
    <DsCard scheme={scheme} testID="pro.specialty.credentialForm" style={styles.cardGap}>
      <Text style={[styles.cardTitle, { color: palette.text }]}>
        {t('pro.specialty.credential.title')} - {specialtyLabel}
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
          <DsPillButton
            scheme={scheme}
            label={t('pro.specialty.credential.save') as string}
            onPress={onSave}
            disabled={isWriteLocked || isSaving}
            style={styles.saveButton}
            testID="pro.specialty.credential.save"
          />
        )}

        <Pressable accessibilityRole="button" onPress={onSkip} testID="pro.specialty.credential.skip">
          <Text style={[styles.link, { color: palette.icon }]}>{t('pro.specialty.credential.skip')}</Text>
        </Pressable>
      </View>
    </DsCard>
  );
}

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
  palette: { text: string; icon: string; tint: string };
  testID: string;
}) {
  return (
    <View style={styles.fieldWrapper}>
      <Text style={[styles.fieldLabel, { color: palette.text }]}>{label}</Text>
      <TextInput
        style={[styles.input, { borderColor: `${palette.icon}66`, color: palette.text }]}
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

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    gap: DsSpace.lg,
    padding: DsSpace.lg,
    paddingBottom: DsSpace.xxl,
  },
  centered: { alignSelf: 'center', marginVertical: DsSpace.md },
  cardTitle: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
  },
  row: { alignItems: 'center', flexDirection: 'row', gap: DsSpace.lg },
  addButtonsRow: { gap: DsSpace.md },
  link: { ...DsTypography.body, fontWeight: '700' },
  emptyText: { ...DsTypography.body, textAlign: 'center' },
  errorText: { ...DsTypography.caption },
  fieldWrapper: { gap: DsSpace.xs },
  fieldLabel: { ...DsTypography.caption, fontWeight: '700' },
  input: {
    borderRadius: DsRadius.md,
    borderWidth: 1,
    fontSize: 15,
    minHeight: 44,
    paddingHorizontal: DsSpace.md,
    paddingVertical: DsSpace.sm,
  },
  assistTitle: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 15,
    fontWeight: '700',
  },
  assistBody: { ...DsTypography.caption },
  assistAction: {
    borderRadius: DsRadius.md,
    gap: 2,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  assistActionText: { ...DsTypography.body, fontWeight: '700' },
  assistActionDesc: { ...DsTypography.caption },
  cardGap: { gap: DsSpace.sm },
  saveButton: { flex: 1 },
});
