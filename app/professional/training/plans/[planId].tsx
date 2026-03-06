/**
 * SC-208 Training Plan Builder
 * Route: /professional/training/plans/:planId
 *
 * Allows fitness coaches to create and edit named predefined training plans with
 * fully customizable sessions and custom session items (no fixed workout fields).
 *
 * Starter template cloning supports local fallback templates and Firestore writes.
 *
 * Docs: docs/screens/v2/SC-208-training-plan-builder.md
 * Refs: D-013, D-111–D-114, FR-244–FR-248,
 *       BR-224, BR-281, BR-293–BR-296,
 *       AC-208, AC-223, AC-256, AC-264, AC-265,
 *       TC-278–TC-280
 */
import { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';

import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { TemplatePickerModal } from '@/components/ds/patterns/TemplatePickerModal';
import { StudentPickerModal } from '@/components/ds/patterns/StudentPickerModal';
import { ExerciseSearchModal } from '@/components/ds/patterns/ExerciseSearchModal';
import { DsRadius, DsSpace, DsTypography, getDsTheme, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useTrainingPlanBuilder } from '@/features/plans/use-plan-builder';
import { usePlans } from '@/features/plans/use-plans';
import { useYMoveSearch } from '@/features/plans/use-ymove-search';
import type { YMoveExercise } from '@/features/plans/ymove-source';
import {
  validateTrainingPlanInput,
  isStarterTemplate,
  type TrainingSession,
} from '@/features/plans/plan-builder.logic';
import { getProfessionalStudentRoster, type ProfessionalStudentRosterItem } from '@/features/professional/professional-source';
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
  | {
      kind: 'open';
      sessionId: string;
      name: string;
      quantity: string;
      notes: string;
      ymoveId?: string;
      thumbnailUrl?: string;
      videoUrl?: string;
    };

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
  const pathname = usePathname();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { currentUser } = useAuthSession();
  const isStudentBuilder = pathname.startsWith('/student/');

  const tr = useCallback(
    (proKey: Parameters<typeof t>[0], studentKey: Parameters<typeof t>[0]) =>
      t(isStudentBuilder ? studentKey : proKey),
    [isStudentBuilder, t]
  );

  const {
    state,
    templatePickerState,
    loadPlan,
    createPlan,
    savePlan,
    addSession,
    removeSession,
    addSessionItem,
    removeSessionItem,
    loadTemplates,
    cloneTemplate,
    validateInput,
    validateSessionItem,
  } = useTrainingPlanBuilder(Boolean(currentUser));

  const { bulkAssign } = usePlans(Boolean(currentUser), { fetchOnMount: false });

  // ── Local form state ───────────────────────────────────────────────────────
  const isNew = planId === 'new';
  const isStarterClone = typeof planId === 'string' && isStarterTemplate(planId);

  const [name, setName] = useState('');
  const [formErrors, setFormErrors] = useState<ReturnType<typeof validateTrainingPlanInput>>({});
  const [addSessionForm, setAddSessionForm] = useState<AddSessionFormState>({ kind: 'closed' });
  const [isSaving, setIsSaving] = useState(false);
  const [isTemplatePickerVisible, setIsTemplatePickerVisible] = useState(false);
  
  const [isStudentPickerVisible, setIsStudentPickerVisible] = useState(false);
  const [students, setStudents] = useState<ProfessionalStudentRosterItem[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  const { state: ymoveSearchState, search: searchYMove, clear: clearYMoveSearch } = useYMoveSearch();
  const [isExerciseSearchVisible, setIsExerciseSearchVisible] = useState(false);
  const [activeSessionIdForSearch, setActiveSessionIdForSearch] = useState<string | null>(null);

  const [isDirty, setIsDirty] = useState(false);
  const isMounted = useRef(true);
  const sessionNotesRef = useRef<TextInput>(null);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

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
      setIsDirty(false);
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
      if (isMounted.current) setIsSaving(false);
      if ('error' in result) {
        Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
      } else {
        setIsDirty(false);
        router.replace(
          `${isStudentBuilder ? '/student/training/plans' : '/professional/training/plans'}/${result.id}` as never
        );
      }
    } else {
      const err = await savePlan(planId!, input);
      if (isMounted.current) setIsSaving(false);
      if (err) {
        Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
      } else {
        setIsDirty(false);
      }
    }
  }, [name, validateInput, isNew, isStarterClone, createPlan, savePlan, planId, router, tr, isStudentBuilder]);

  // ── Template Cloning ───────────────────────────────────────────────────────
  const handleOpenTemplatePicker = () => {
    loadTemplates();
    setIsTemplatePickerVisible(true);
  };

  const handleSelectTemplate = async (templateId: string, templateName: string) => {
    setIsTemplatePickerVisible(false);
    setIsSaving(true);
    const result = await cloneTemplate(templateId, `${templateName} (Copy)`);
    if (isMounted.current) setIsSaving(false);

    if ('error' in result) {
      Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
    } else {
      router.replace(`/professional/training/plans/${result.id}` as never);
    }
  };

  // ── Assignment ─────────────────────────────────────────────────────────────
  const handleOpenStudentPicker = async () => {
    setIsLoadingStudents(true);
    setIsStudentPickerVisible(true);
    try {
      const roster = await getProfessionalStudentRoster();
      // Filter for students whose training specialty matches
      setStudents(roster.filter(s => s.specialty === 'fitness_coach'));
    } catch {
      Alert.alert(t('pro.students.error') as string);
      setIsStudentPickerVisible(false);
    } finally {
      setIsLoadingStudents(false);
    }
  };

  const handleAssignToStudent = async (studentUid: string) => {
    if (!planId) return;
    setIsStudentPickerVisible(false);
    setIsAssigning(true);
    const result = await bulkAssign(planId, [studentUid]);
    setIsAssigning(false);

    if ('error' in result) {
      Alert.alert(t('pro.plan.assign.error') as string);
    } else {
      Alert.alert(t('pro.plan.assign.success') as string);
    }
  };

  // ── Add session ────────────────────────────────────────────────────────────
  const handleAddSession = useCallback(async () => {
    if (addSessionForm.kind !== 'open' || state.kind !== 'ready') return;
    const { name: sessionName, notes } = addSessionForm;
    if (!sessionName.trim()) return;

    const err = await addSession(state.plan.id, { name: sessionName, notes });
    if (err) {
      Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
    } else {
      setAddSessionForm({ kind: 'closed' });
    }
  }, [addSessionForm, state, addSession, tr]);

  // ── Remove session ─────────────────────────────────────────────────────────
  const handleRemoveSession = useCallback(
    (sessionId: string) => {
      if (state.kind !== 'ready') return;
      void removeSession(state.plan.id, sessionId);
    },
    [state, removeSession]
  );

  // ── YMove Search Handlers ──────────────────────────────────────────────────
  const handleOpenExerciseSearch = (sessionId: string) => {
    setActiveSessionIdForSearch(sessionId);
    setIsExerciseSearchVisible(true);
  };

  const handleConfirmExercise = async (exercise: YMoveExercise, quantity: string, notes: string) => {
    if (!activeSessionIdForSearch) return;
    
    setIsExerciseSearchVisible(false);
    const sessionId = activeSessionIdForSearch;
    setActiveSessionIdForSearch(null);
    clearYMoveSearch();

    const err = await addSessionItem(sessionId, {
      name: exercise.title,
      quantity,
      notes,
      ymoveId: exercise.id,
      thumbnailUrl: exercise.thumbnailUrl,
      videoUrl: exercise.videoUrl,
    });

    if (err) {
      Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
    }
  };

  // ── Remove session item ────────────────────────────────────────────────────
  const handleRemoveSessionItem = useCallback(
    (sessionId: string, itemId: string) => {
      void removeSessionItem(sessionId, itemId);
    },
    [removeSessionItem]
  );

  const screenTitle = isNew || isStarterClone
    ? tr('pro.plan.training.title.create', 'student.plan.training.title.create')
    : tr('pro.plan.training.title.edit', 'student.plan.training.title.edit');

  const sessions: TrainingSession[] = state.kind === 'ready' ? state.plan.sessions : [];

  return (
    <DsScreen
      scheme={scheme}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: screenTitle, headerShown: false }} />

      <View style={styles.headerRow}>
        <DsBackButton
          scheme={scheme}
          onPress={() => {
            const goBack = () => {
              if (router.canGoBack()) {
                router.back();
              } else {
                router.replace('/');
              }
            };

            if (isDirty) {
              Alert.alert(
                t('pro.plan.discard.title') as string,
                t('pro.plan.discard.body') as string,
                [
                  { text: t('pro.plan.discard.no') as string, style: 'cancel' },
                  { text: t('pro.plan.discard.yes') as string, style: 'destructive', onPress: goBack },
                ]
              );
            } else {
              goBack();
            }
          }}
          accessibilityLabel={t('auth.role.cta_back') as string}
          style={styles.backButton}
          testID={isStudentBuilder ? 'student.plan.training.backButton' : 'pro.plan.training.backButton'}
        />

        {isNew && !isStudentBuilder && (
          <DsPillButton
            scheme={scheme}
            variant="outline"
            size="sm"
            label={t('pro.plan.cta.clone_template')}
            onPress={handleOpenTemplatePicker}
            fullWidth={false}
            style={styles.templateCta}
          />
        )}
      </View>

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {state.kind === 'error' && (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.errorBanner, { backgroundColor: palette.icon }]}
        >
          <Text style={[styles.errorBannerText, { color: palette.background }]}>
            {tr('pro.plan.error.load', 'student.plan.error.load')}
          </Text>
        </View>
      )}

      {/* ── Loading state ─────────────────────────────────────────────────── */}
      {(state.kind === 'loading' || isAssigning) && (
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
          onChangeText={(val) => {
            setName(val);
            setIsDirty(true);
          }}
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
          {tr('pro.plan.section.sessions', 'student.plan.section.sessions')}
      </Text>

      {sessions.length === 0 && state.kind === 'ready' && (
        <Text style={[styles.emptyText, { color: palette.icon }]}>
          {tr('pro.library.training.empty', 'student.plan.training.empty_sessions')}
        </Text>
      )}

      {sessions.map((session) => (
        <SessionCard
          key={session.id}
          session={session}
          palette={palette}
          t={t}
          onRemoveSession={() => handleRemoveSession(session.id)}
          onAddItem={() => handleOpenExerciseSearch(session.id)}
          onRemoveItem={(itemId) => handleRemoveSessionItem(session.id, itemId)}
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
            autoFocus
            returnKeyType="next"
            onSubmitEditing={() => sessionNotesRef.current?.focus()}
            accessibilityLabel={t('pro.plan.session.field.name.label')}
          />
          <TextInput
            ref={sessionNotesRef}
            style={[styles.textInput, { color: palette.text, borderColor: palette.icon }]}
            placeholder={t('pro.plan.session.field.notes.label')}
            placeholderTextColor={palette.icon}
            value={addSessionForm.notes}
            onChangeText={(v) =>
              setAddSessionForm((prev) =>
                prev.kind === 'open' ? { ...prev, notes: v } : prev
              )
            }
            returnKeyType="done"
            onSubmitEditing={handleAddSession}
            accessibilityLabel={t('pro.plan.session.field.notes.label')}
          />
          <View style={styles.rowActions}>
            <Pressable
              style={[styles.primaryBtn, { backgroundColor: palette.tint, flex: 1 }]}
              onPress={handleAddSession}
              accessibilityRole="button"
              accessibilityLabel={tr('pro.plan.cta.add_session', 'student.plan.cta.add_session')}
            >
              <Text style={[styles.primaryBtnText, { color: palette.background }]}>
                {tr('pro.plan.cta.add_session', 'student.plan.cta.add_session')}
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
          accessibilityLabel={tr('pro.plan.cta.add_session', 'student.plan.cta.add_session')}
        >
          <Text style={[styles.secondaryBtnText, { color: palette.tint }]}>
            {tr('pro.plan.cta.add_session', 'student.plan.cta.add_session')}
          </Text>
        </Pressable>
      )}

      {/* ── Footer Actions ────────────────────────────────────────────────── */}
      <View style={styles.footerActions}>
        <Pressable
          style={[
            styles.primaryBtn,
            { backgroundColor: palette.tint, flex: 1, marginTop: 0 },
            isSaving && styles.btnDisabled,
          ]}
          onPress={handleSave}
          disabled={isSaving}
          accessibilityRole="button"
          accessibilityLabel={tr('pro.plan.cta.save', 'student.plan.cta.save')}
          accessibilityState={{ disabled: isSaving, busy: isSaving }}
        >
          {isSaving ? (
            <ActivityIndicator color={palette.background} accessibilityLabel={t('a11y.loading.saving')} />
          ) : (
            <Text style={[styles.primaryBtnText, { color: palette.background }]}>
              {tr('pro.plan.cta.save', 'student.plan.cta.save')}
            </Text>
          )}
        </Pressable>

        {!isNew && !isStudentBuilder && (
          <DsPillButton
            scheme={scheme}
            variant="outline"
            label={t('pro.plan.cta.assign')}
            onPress={handleOpenStudentPicker}
            style={{ flex: 1, minHeight: 48 }}
          />
        )}
      </View>

      <TemplatePickerModal
        isVisible={isTemplatePickerVisible}
        onClose={() => setIsTemplatePickerVisible(false)}
        onSelect={handleSelectTemplate}
        state={templatePickerState}
        scheme={scheme}
        theme={theme}
        t={t}
      />

      <StudentPickerModal
        isVisible={isStudentPickerVisible}
        onClose={() => setIsStudentPickerVisible(false)}
        onSelect={handleAssignToStudent}
        students={students}
        isLoading={isLoadingStudents}
        scheme={scheme}
        theme={theme}
        t={t}
      />

      <ExerciseSearchModal
        isVisible={isExerciseSearchVisible}
        onClose={() => {
          setIsExerciseSearchVisible(false);
          setActiveSessionIdForSearch(null);
        }}
        onConfirm={handleConfirmExercise}
        searchState={ymoveSearchState}
        onSearch={searchYMove}
        onClear={clearYMoveSearch}
        scheme={scheme}
        theme={theme}
        t={t}
      />
    </DsScreen>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

type SessionCardProps = {
  session: TrainingSession;
  palette: Palette;
  t: TFn;
  onRemoveSession: () => void;
  onAddItem: () => void;
  onRemoveItem: (itemId: string) => void;
};

function SessionCard({
  session,
  palette,
  t,
  onRemoveSession,
  onAddItem,
  onRemoveItem,
}: SessionCardProps) {
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
          style={styles.removeBtnWrapper}
        >
          <MaterialIcons name="remove-circle-outline" size={24} color={palette.icon} />
        </Pressable>
      </View>
      {session.notes ? (
        <Text style={[styles.sessionNotes, { color: palette.icon }]}>{session.notes}</Text>
      ) : null}

      {/* Items */}
      {session.items.map((item) => (
        <View key={item.id} style={[styles.itemRow, { borderColor: palette.icon }]}>
          {item.thumbnailUrl ? (
            <Image source={{ uri: item.thumbnailUrl }} style={styles.thumbnail} />
          ) : (
            <View style={[styles.thumbnailPlaceholder, { backgroundColor: palette.icon }]}>
              <Text style={{ color: palette.background, fontSize: 16 }}>🏃</Text>
            </View>
          )}
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
            style={styles.removeBtnWrapper}
          >
            <MaterialIcons name="remove-circle-outline" size={22} color={palette.icon} />
          </Pressable>
        </View>
      ))}

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
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 12, paddingBottom: 40 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  backButton: { marginBottom: 0 },
  templateCta: { minHeight: 40 },
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
  removeBtnWrapper: { padding: DsSpace.sm, justifyContent: 'center', alignItems: 'center' },
  thumbnail: {
    width: 44,
    height: 44,
    borderRadius: DsRadius.md,
  },
  thumbnailPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: DsRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  footerActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: DsRadius.xl,
    borderTopRightRadius: DsRadius.xl,
    minHeight: '50%',
    maxHeight: '85%',
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
  },
  modalScroll: { gap: DsSpace.md, paddingBottom: 40 },
  templateRow: {
    borderWidth: 1,
    borderRadius: DsRadius.lg,
    padding: DsSpace.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DsSpace.sm,
  },
  templateName: { fontWeight: '700', fontSize: 15 },
  templateDesc: { fontSize: 13, marginTop: 2 },
});
