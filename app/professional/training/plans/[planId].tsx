/**
 * SC-208 Training Plan Builder
 * Route: /professional/training/plans/:planId
 *
 * Allows fitness coaches to create and edit named predefined training plans with
 * fully customizable sessions and custom session items (no fixed workout fields).
 *
 * Starter template cloning and Data Connect plan CRUD are stubbed; wiring deferred.
 * Deferred items tracked in docs/discovery/pending-wiring-checklist-v1.md.
 *
 * Docs: docs/screens/v2/SC-208-training-plan-builder.md
 * Refs: D-013, D-111–D-114, FR-244–FR-248,
 *       BR-224, BR-281, BR-293–BR-296,
 *       AC-208, AC-223, AC-256, AC-264, AC-265,
 *       TC-278–TC-280
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useTrainingPlanBuilder } from '@/features/plans/use-plan-builder';
import {
  validateTrainingPlanInput,
  isStarterTemplate,
  type TrainingSession,
} from '@/features/plans/plan-builder.logic';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

// ─── Types ────────────────────────────────────────────────────────────────────

type TFn = ReturnType<typeof useTranslation>['t'];
type Palette = {
  background: string;
  text: string;
  tint: string;
  icon: string;
  danger: string;
};

type AddSessionFormState =
  | { kind: 'closed' }
  | { kind: 'open'; name: string; notes: string };

type AddItemFormState =
  | { kind: 'closed' }
  | { kind: 'open'; sessionId: string; name: string; quantity: string; notes: string };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TrainingPlanBuilderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  const palette = {
    background: theme.color.canvas,
    text: theme.color.textPrimary,
    tint: theme.color.accentPrimary,
    icon: theme.color.textSecondary,
    danger: theme.color.danger,
  };
  const { t } = useTranslation();
  const router = useRouter();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { currentUser } = useAuthSession();

  const {
    state,
    loadPlan,
    createPlan,
    savePlan,
    addSession,
    removeSession,
    addSessionItem,
    removeSessionItem,
    validateInput,
    validateSessionItem,
  } = useTrainingPlanBuilder(Boolean(currentUser));

  // ── Local form state ───────────────────────────────────────────────────────
  const isNew = planId === 'new';
  const isStarterClone = typeof planId === 'string' && isStarterTemplate(planId);

  const [name, setName] = useState('');
  const [formErrors, setFormErrors] = useState<ReturnType<typeof validateTrainingPlanInput>>({});
  const [addSessionForm, setAddSessionForm] = useState<AddSessionFormState>({ kind: 'closed' });
  const [addItemForm, setAddItemForm] = useState<AddItemFormState>({ kind: 'closed' });
  const [isSaving, setIsSaving] = useState(false);

  // ── Load existing plan ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isNew && !isStarterClone && planId) {
      loadPlan(planId);
    }
  }, [planId, isNew, isStarterClone, loadPlan]);

  // ── Populate form from loaded plan ─────────────────────────────────────────
  useEffect(() => {
    if (state.kind === 'ready') {
      setName(state.plan.name);
    }
  }, [state]);

  // ── Save / Create ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const input = { name };
    const errors = validateInput(input);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});
    setIsSaving(true);

    if (isNew || isStarterClone) {
      const result = await createPlan(input);
      setIsSaving(false);
      if ('error' in result) {
        Alert.alert(t('pro.plan.error.save'));
      } else {
        router.replace(`/professional/training/plans/${result.id}`);
      }
    } else {
      const err = await savePlan(planId!, input);
      setIsSaving(false);
      if (err) Alert.alert(t('pro.plan.error.save'));
    }
  }, [name, validateInput, isNew, isStarterClone, createPlan, savePlan, planId, router, t]);

  // ── Add session ────────────────────────────────────────────────────────────
  const handleAddSession = useCallback(async () => {
    if (addSessionForm.kind !== 'open' || state.kind !== 'ready') return;
    const { name: sessionName, notes } = addSessionForm;
    if (!sessionName.trim()) return;

    const err = await addSession(state.plan.id, { name: sessionName, notes });
    if (err) {
      Alert.alert(t('pro.plan.error.save'));
    } else {
      setAddSessionForm({ kind: 'closed' });
    }
  }, [addSessionForm, state, addSession, t]);

  // ── Remove session ─────────────────────────────────────────────────────────
  const handleRemoveSession = useCallback(
    (sessionId: string) => {
      if (state.kind !== 'ready') return;
      void removeSession(state.plan.id, sessionId);
    },
    [state, removeSession]
  );

  // ── Add session item ───────────────────────────────────────────────────────
  const handleAddSessionItem = useCallback(async () => {
    if (addItemForm.kind !== 'open') return;
    const { sessionId, name: itemName, quantity, notes } = addItemForm;
    const itemErrors = validateSessionItem({ name: itemName, quantity, notes });
    if (Object.keys(itemErrors).length > 0) return;

    const err = await addSessionItem(sessionId, { name: itemName, quantity, notes });
    if (err) {
      Alert.alert(t('pro.plan.error.save'));
    } else {
      setAddItemForm({ kind: 'closed' });
    }
  }, [addItemForm, validateSessionItem, addSessionItem, t]);

  // ── Remove session item ────────────────────────────────────────────────────
  const handleRemoveSessionItem = useCallback(
    (sessionId: string, itemId: string) => {
      void removeSessionItem(sessionId, itemId);
    },
    [removeSessionItem]
  );

  const screenTitle = isNew || isStarterClone
    ? t('pro.plan.training.title.create')
    : t('pro.plan.training.title.edit');

  const sessions: TrainingSession[] = state.kind === 'ready' ? state.plan.sessions : [];

  return (
    <DsScreen
      scheme={scheme}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: screenTitle, headerShown: true }} />

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {state.kind === 'error' && (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.errorBanner, { backgroundColor: palette.icon }]}
        >
          <Text style={[styles.errorBannerText, { color: palette.background }]}>
            {t('pro.plan.error.load')}
          </Text>
        </View>
      )}

      {/* ── Loading state ─────────────────────────────────────────────────── */}
      {state.kind === 'loading' && (
        <ActivityIndicator
          style={styles.loader}
          accessibilityLabel={t('a11y.loading.default')}
        />
      )}

      {/* ── Plan name field ───────────────────────────────────────────────── */}
      <View style={styles.formSection}>
        <Text style={[styles.fieldLabel, { color: palette.text }]}>
          {t('pro.plan.field.name.label')}
        </Text>
        <TextInput
          style={[
            styles.textInput,
            { color: palette.text, borderColor: formErrors.name ? palette.danger : palette.icon },
          ]}
          placeholder={t('pro.plan.field.name.placeholder')}
          placeholderTextColor={palette.icon}
          value={name}
          onChangeText={setName}
          accessibilityLabel={t('pro.plan.field.name.label')}
        />
        {formErrors.name && (
          <View accessibilityLiveRegion="polite">
            <Text style={[styles.fieldError, { color: palette.danger }]}>
              {formErrors.name === 'required'
                ? t('pro.plan.validation.name_required')
                : t('pro.plan.validation.name_too_short')}
            </Text>
          </View>
        )}
      </View>

      {/* ── Sessions list ─────────────────────────────────────────────────── */}
      <Text style={[styles.sectionHeader, { color: palette.text }]}>
        {t('pro.plan.section.sessions')}
      </Text>

      {sessions.length === 0 && state.kind === 'ready' && (
        <Text style={[styles.emptyText, { color: palette.icon }]}>
          {t('pro.library.training.empty')}
        </Text>
      )}

      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          palette={palette}
          t={t}
          onRemoveSession={() => handleRemoveSession(session.id)}
          onAddItem={() =>
            setAddItemForm({ kind: 'open', sessionId: session.id, name: '', quantity: '', notes: '' })
          }
          onRemoveItem={(itemId) => handleRemoveSessionItem(session.id, itemId)}
          addItemForm={addItemForm}
          onAddItemFormNameChange={(v) =>
            setAddItemForm((prev) =>
              prev.kind === 'open' && prev.sessionId === session.id ? { ...prev, name: v } : prev
            )
          }
          onAddItemFormQuantityChange={(v) =>
            setAddItemForm((prev) =>
              prev.kind === 'open' && prev.sessionId === session.id ? { ...prev, quantity: v } : prev
            )
          }
          onAddItemFormNotesChange={(v) =>
            setAddItemForm((prev) =>
              prev.kind === 'open' && prev.sessionId === session.id ? { ...prev, notes: v } : prev
            )
          }
          onConfirmAddItem={handleAddSessionItem}
          onCancelAddItem={() => setAddItemForm({ kind: 'closed' })}
        />
      ))}

      {/* ── Add session form ──────────────────────────────────────────────── */}
      {state.kind === 'ready' && addSessionForm.kind === 'open' && (
        <View style={[styles.addCard, { borderColor: palette.icon }]}>
          <TextInput
            style={[styles.textInput, { color: palette.text, borderColor: palette.icon }]}
            placeholder={t('pro.plan.session.field.name.placeholder')}
            placeholderTextColor={palette.icon}
            value={addSessionForm.name}
            onChangeText={(v) =>
              setAddSessionForm((prev) =>
                prev.kind === 'open' ? { ...prev, name: v } : prev
              )
            }
            accessibilityLabel={t('pro.plan.session.field.name.label')}
          />
          <TextInput
            style={[styles.textInput, { color: palette.text, borderColor: palette.icon }]}
            placeholder={t('pro.plan.session.field.notes.label')}
            placeholderTextColor={palette.icon}
            value={addSessionForm.notes}
            onChangeText={(v) =>
              setAddSessionForm((prev) =>
                prev.kind === 'open' ? { ...prev, notes: v } : prev
              )
            }
            accessibilityLabel={t('pro.plan.session.field.notes.label')}
          />
          <View style={styles.rowActions}>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: palette.tint, flex: 1 }]}
              onPress={handleAddSession}
              accessibilityRole="button"
              accessibilityLabel={t('pro.plan.cta.add_session')}
            >
              <Text style={[styles.primaryBtnText, { color: palette.background }]}>
                {t('pro.plan.cta.add_session')}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, { borderColor: palette.icon, flex: 1 }]}
              onPress={() => setAddSessionForm({ kind: 'closed' })}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryBtnText, { color: palette.icon }]}>
                {t('meal.library.quick_log.cta_cancel')}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {state.kind === 'ready' && addSessionForm.kind === 'closed' && (
        <Pressable
          style={[styles.secondaryBtn, { borderColor: palette.tint }]}
          onPress={() => setAddSessionForm({ kind: 'open', name: '', notes: '' })}
          accessibilityRole="button"
          accessibilityLabel={t('pro.plan.cta.add_session')}
        >
          <Text style={[styles.secondaryBtnText, { color: palette.tint }]}>
            {t('pro.plan.cta.add_session')}
          </Text>
        </Pressable>
      )}

      {/* ── Save CTA ──────────────────────────────────────────────────────── */}
      <Pressable
        style={[
          styles.primaryBtn,
          { backgroundColor: palette.tint },
          isSaving && styles.btnDisabled,
        ]}
        onPress={handleSave}
        disabled={isSaving}
        accessibilityRole="button"
        accessibilityLabel={t('pro.plan.cta.save')}
        accessibilityState={{ disabled: isSaving, busy: isSaving }}
      >
        {isSaving ? (
          <ActivityIndicator color={palette.background} accessibilityLabel={t('a11y.loading.saving')} />
        ) : (
          <Text style={[styles.primaryBtnText, { color: palette.background }]}>
            {t('pro.plan.cta.save')}
          </Text>
        )}
      </Pressable>
    </DsScreen>
  );
}

// ─── SessionCard ──────────────────────────────────────────────────────────────

type SessionCardProps = {
  session: TrainingSession;
  palette: Palette;
  t: TFn;
  addItemForm: AddItemFormState;
  onRemoveSession: () => void;
  onAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
  onAddItemFormNameChange: (v: string) => void;
  onAddItemFormQuantityChange: (v: string) => void;
  onAddItemFormNotesChange: (v: string) => void;
  onConfirmAddItem: () => void;
  onCancelAddItem: () => void;
};

function SessionCard({
  session,
  palette,
  t,
  addItemForm,
  onRemoveSession,
  onAddItem,
  onRemoveItem,
  onAddItemFormNameChange,
  onAddItemFormQuantityChange,
  onAddItemFormNotesChange,
  onConfirmAddItem,
  onCancelAddItem,
}: SessionCardProps) {
  const isAddingItem =
    addItemForm.kind === 'open' && addItemForm.sessionId === session.id;

  return (
    <View style={[styles.sessionCard, { borderColor: palette.icon }]}>
      {/* Session header */}
      <View style={styles.sessionHeader}>
        <Text style={[styles.sessionName, { color: palette.text }]}>{session.name}</Text>
        <Pressable
          onPress={onRemoveSession}
          accessibilityRole="button"
          accessibilityLabel={`Remove session ${session.name}`}
          hitSlop={8}
        >
          <Text style={[styles.removeBtn, { color: palette.icon }]}>✕</Text>
        </Pressable>
      </View>
      {session.notes ? (
        <Text style={[styles.sessionNotes, { color: palette.icon }]}>{session.notes}</Text>
      ) : null}

      {/* Items */}
      {session.items.map((item) => (
        <View key={item.id} style={[styles.itemRow, { borderColor: palette.icon }]}>
          <View style={styles.itemInfo}>
            <Text style={[styles.itemName, { color: palette.text }]}>{item.name}</Text>
            {item.quantity ? (
              <Text style={[styles.itemMeta, { color: palette.icon }]}>{item.quantity}</Text>
            ) : null}
            {item.notes ? (
              <Text style={[styles.itemMeta, { color: palette.icon }]}>{item.notes}</Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => onRemoveItem(item.id)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${item.name}`}
            hitSlop={8}
          >
            <Text style={[styles.removeBtn, { color: palette.icon }]}>✕</Text>
          </Pressable>
        </View>
      ))}

      {/* Add item inline form */}
      {isAddingItem && (
        <View style={styles.addItemInline}>
          <TextInput
            style={[styles.textInput, { color: palette.text, borderColor: palette.icon }]}
            placeholder={t('pro.plan.item.field.name.placeholder')}
            placeholderTextColor={palette.icon}
            value={addItemForm.name}
            onChangeText={onAddItemFormNameChange}
            accessibilityLabel={t('pro.plan.item.field.name.label')}
          />
          <TextInput
            style={[styles.textInput, { color: palette.text, borderColor: palette.icon }]}
            placeholder={t('pro.plan.item.field.quantity.placeholder')}
            placeholderTextColor={palette.icon}
            value={addItemForm.quantity}
            onChangeText={onAddItemFormQuantityChange}
            accessibilityLabel={t('pro.plan.item.field.quantity.label')}
          />
          <TextInput
            style={[styles.textInput, { color: palette.text, borderColor: palette.icon }]}
            placeholder={t('pro.plan.item.field.notes.label')}
            placeholderTextColor={palette.icon}
            value={addItemForm.notes}
            onChangeText={onAddItemFormNotesChange}
            accessibilityLabel={t('pro.plan.item.field.notes.label')}
          />
          <View style={styles.rowActions}>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: palette.tint, flex: 1 }]}
              onPress={onConfirmAddItem}
              accessibilityRole="button"
              accessibilityLabel={t('pro.plan.cta.add_item')}
            >
              <Text style={[styles.primaryBtnText, { color: palette.background }]}>
                {t('pro.plan.cta.add_item')}
              </Text>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, { borderColor: palette.icon, flex: 1 }]}
              onPress={onCancelAddItem}
              accessibilityRole="button"
            >
              <Text style={[styles.secondaryBtnText, { color: palette.icon }]}>
                {t('meal.library.quick_log.cta_cancel')}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {!isAddingItem && (
        <Pressable
          style={[styles.secondaryBtn, { borderColor: palette.tint, marginTop: 8 }]}
          onPress={onAddItem}
          accessibilityRole="button"
          accessibilityLabel={t('pro.plan.cta.add_item')}
        >
          <Text style={[styles.secondaryBtnText, { color: palette.tint }]}>
            {t('pro.plan.cta.add_item')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  loader: { marginVertical: 24 },
  errorBanner: { borderRadius: 8, padding: 12, marginBottom: 8 },
  errorBannerText: { fontSize: 14, fontWeight: '600', textAlign: 'center' },
  formSection: { gap: 8 },
  sectionHeader: {
    fontFamily: Fonts?.rounded ?? 'normal',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 4,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginTop: 8 },
  fieldError: { fontSize: 12, marginTop: 2 },
  textInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 15 },
  emptyText: { fontSize: 14, textAlign: 'center', marginVertical: 8 },
  sessionCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginBottom: 4,
  },
  sessionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sessionName: { fontSize: 15, fontWeight: '700', flex: 1 },
  sessionNotes: { fontSize: 13 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    gap: 8,
  },
  itemInfo: { flex: 1, gap: 2 },
  itemName: { fontSize: 14, fontWeight: '600' },
  itemMeta: { fontSize: 12 },
  removeBtn: { fontSize: 16, fontWeight: '700', paddingHorizontal: 4 },
  addItemInline: { gap: 8, marginTop: 4 },
  addCard: { borderWidth: 1, borderRadius: 8, padding: 12, gap: 8 },
  rowActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  primaryBtn: {
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },
});
