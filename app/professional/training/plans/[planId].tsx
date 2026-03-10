/**
 * SC-208 Training Plan Builder
 * Route: /professional/training/plans/:planId
 */
import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { BuilderGuidanceCard } from '@/components/ds/patterns/BuilderGuidanceCard';
import { BuilderInsetGroup } from '@/components/ds/patterns/BuilderInsetGroup';
import { TemplatePickerModal } from '@/components/ds/patterns/TemplatePickerModal';
import { StudentPickerModal } from '@/components/ds/patterns/StudentPickerModal';
import { ExerciseSearchModal } from '@/components/ds/patterns/ExerciseSearchModal';
import { SessionCard } from '@/features/plans/components/SessionCard';

import { DsRadius, DsShadow, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useTrainingPlanBuilder } from '@/features/plans/use-plan-builder';
import { usePlans } from '@/features/plans/use-plans';
import { useYMoveSearch } from '@/features/plans/use-ymove-search';
import type { YMoveExercise } from '@/features/plans/ymove-source';
import {
  validateTrainingPlanInput,
  isStarterTemplate,
} from '@/features/plans/plan-builder.logic';
import { getProfessionalStudentRoster, type ProfessionalStudentRosterItem } from '@/features/professional/professional-source';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';
import { usePlanForm } from '@/features/plans/use-plan-form';
import { usePlanDraft } from '@/features/plans/use-plan-draft';
import { usePersistentGuidance } from '@/hooks/use-persistent-guidance';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type AddSessionFormState =
  | { kind: 'closed' }
  | { kind: 'open'; name: string; notes: string };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TrainingPlanBuilderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  
  const palette = useMemo(() => ({
    background: theme.color.canvas,
    text: theme.color.textPrimary,
    tint: theme.color.accentPrimary,
    icon: theme.color.textSecondary,
    danger: theme.color.danger,
  }), [theme]);

  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { currentUser } = useAuthSession();
  const isStudentBuilder = pathname.startsWith('/student/');

  const tr = useCallback(
    (proKey: string, studentKey: string) =>
      t((isStudentBuilder ? studentKey : proKey) as any),
    [isStudentBuilder, t]
  );

  const {
    state,
    templatePickerState,
    loadPlan,
    initNewPlan,
    createPlan,
    savePlan,
    addSession,
    removeSession,
    reorderSessions,
    addSessionItem,
    removeSessionItem,
    reorderSessionItems,
    loadTemplates,
    cloneTemplate,
    validateInput,
  } = useTrainingPlanBuilder(Boolean(currentUser));

  const { bulkAssign } = usePlans(Boolean(currentUser), { fetchOnMount: false });

  // ── Form logic ─────────────────────────────────────────────────────────────
  const isNew = planId === 'new';
  const isStarterClone = typeof planId === 'string' && isStarterTemplate(planId);

  const initialValues = useMemo(() => ({
    name: state.kind === 'ready' ? state.plan.name : '',
  }), [state]);

  const {
    values,
    setValues,
    setFieldValue,
    errors: formErrors,
    setErrors,
    isSaving,
    isDirty,
    setIsDirty,
    handleSave,
    handleBack,
  } = usePlanForm({
    initialValues,
    validate: validateInput,
    t,
    onClearDraft: () => clearDraft(),
    onSave: async (formValues) => {
      if (isNew || isStarterClone) {
        return createPlan(formValues);
      }
      return savePlan(planId!, formValues);
    },
    onSuccess: (id) => {
      if (isNew || isStarterClone) {
        router.replace(
          `${isStudentBuilder ? '/student/training/plans' : '/professional/training/plans'}/${id}` as never
        );
      }
    }
  });

  const { checkDraft, clearDraft } = usePlanDraft(
    planId || 'new',
    values,
    isDirty,
    (restored) => setValues(restored),
    t
  );

  useEffect(() => {
    if (state.kind === 'ready') {
      checkDraft().then((draft) => {
        if (draft) {
          Alert.alert(t('pro.plan.draft.title'), t('pro.plan.draft.body'), [
            { text: t('pro.plan.draft.no'), style: 'destructive', onPress: clearDraft },
            { text: t('pro.plan.draft.yes'), onPress: () => setFieldValue('name', draft.name) },
          ]);
        }
      });
    }
  }, [state.kind, checkDraft, clearDraft, t, setFieldValue]);

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [addSessionForm, setAddSessionForm] = useState<AddSessionFormState>({ kind: 'closed' });
  const [isSortMode, setIsSortMode] = useState(false);
  const [showGuidance, hideGuidance] = usePersistentGuidance('guidance.training_builder');
  const [isTemplatePickerVisible, setIsTemplatePickerVisible] = useState(false);
  
  const [isStudentPickerVisible, setIsStudentPickerVisible] = useState(false);
  const [students, setStudents] = useState<ProfessionalStudentRosterItem[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);

  const { state: ymoveSearchState, search: searchYMove, clear: clearYMoveSearch } = useYMoveSearch();
  const [isExerciseSearchVisible, setIsExerciseSearchVisible] = useState(false);
  const [activeSessionIdForSearch, setActiveSessionIdForSearch] = useState<string | null>(null);

  const sessionNotesRef = useRef<TextInput>(null);

  // ── Load existing plan ─────────────────────────────────────────────────────
  useEffect(() => {
    if (isNew) {
      initNewPlan();
    } else if (!isStarterClone && planId) {
      loadPlan(planId);
    }
  }, [planId, isNew, isStarterClone, loadPlan, initNewPlan]);

  // ── Handlers with Animations ───────────────────────────────────────────────
  const handleNameChange = useCallback((val: string) => {
    setFieldValue('name', val);
  }, [setFieldValue]);

  const handleAddSession = useCallback(async () => {
    if (addSessionForm.kind !== 'open' || state.kind !== 'ready') return;
    const { name: sessionName, notes } = addSessionForm;
    if (!sessionName.trim()) return;

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const { planId: resolvedPlanId, error } = await addSession(
      state.plan.id,
      { name: sessionName, notes },
      { name: values.name }
    );
    if (error) {
      if (error === 'validation') {
        setErrors(validateInput({ name: values.name }));
        return;
      }
      Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
    } else {
      setAddSessionForm({ kind: 'closed' });
      setIsDirty(true);
      if (isNew && resolvedPlanId !== 'new') {
        router.replace(
          `${isStudentBuilder ? '/student/training/plans' : '/professional/training/plans'}/${resolvedPlanId}` as never
        );
      }
    }
  }, [addSessionForm, state, addSession, tr, setIsDirty, values.name, isNew, router, isStudentBuilder, setErrors, validateInput]);

  const handleRemoveSession = useCallback(
    (sessionId: string) => {
      if (state.kind !== 'ready') return;
      
      const session = state.plan.sessions.find(s => s.id === sessionId);
      const sessionName = session?.name || t('pro.plan.section.sessions');

      Alert.alert(
        t('common.cta.delete') as string,
        (t('pro.plan.delete.body') as string).replace('{name}', sessionName),
        [
          { text: t('common.cta.cancel'), style: 'cancel' },
          {
            text: t('common.cta.delete'),
            style: 'destructive',
            onPress: () => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              void removeSession(state.plan.id, sessionId);
              setIsDirty(true);
            },
          },
        ]
      );
    },
    [state, removeSession, setIsDirty, t]
  );

  const handleRemoveSessionItem = useCallback(
    (sessionId: string, itemId: string) => {
      if (state.kind !== 'ready') return;

      const session = state.plan.sessions.find(s => s.id === sessionId);
      const item = session?.items.find(i => i.id === itemId);
      const itemName = item?.name || t('pro.plan.section.sessions');

      Alert.alert(
        t('common.cta.delete') as string,
        (t('pro.plan.delete.body') as string).replace('{name}', itemName),
        [
          { text: t('common.cta.cancel'), style: 'cancel' },
          {
            text: t('common.cta.delete'),
            style: 'destructive',
            onPress: () => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              void removeSessionItem(sessionId, itemId);
              setIsDirty(true);
            },
          },
        ]
      );
    },
    [state, removeSessionItem, setIsDirty, t]
  );

  const handleConfirmExercise = useCallback(async (exercise: YMoveExercise, quantity: string, notes: string) => {
    if (!activeSessionIdForSearch) return;
    
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
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
    } else {
      setIsDirty(true);
    }
  }, [activeSessionIdForSearch, addSessionItem, clearYMoveSearch, tr, setIsDirty]);

  // ── Reordering logic ───────────────────────────────────────────────────────
  const handleMoveSession = useCallback(async (index: number, direction: 'up' | 'down') => {
    if (state.kind !== 'ready') return;
    const newSessions = [...state.plan.sessions];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSessions.length) return;

    const [moved] = newSessions.splice(index, 1);
    newSessions.splice(targetIndex, 0, moved);

    // Immediate visual update with animation
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    await reorderSessions(state.plan.id, newSessions.map(s => s.id));
  }, [state, reorderSessions]);

  const handleMoveItem = useCallback(async (sessionId: string, itemId: string, direction: 'up' | 'down') => {
    if (state.kind !== 'ready') return;
    const session = state.plan.sessions.find(s => s.id === sessionId);
    if (!session) return;

    const newItems = [...session.items];
    const index = newItems.findIndex(i => i.id === itemId);
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newItems.length) return;

    const [moved] = newItems.splice(index, 1);
    newItems.splice(targetIndex, 0, moved);

    // Immediate visual update with animation
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    await reorderSessionItems(sessionId, newItems.map(i => i.id));
  }, [state, reorderSessionItems]);

  // ── Template Cloning ───────────────────────────────────────────────────────
  const handleOpenTemplatePicker = useCallback(() => {
    loadTemplates();
    setIsTemplatePickerVisible(true);
  }, [loadTemplates]);

  const handleSelectTemplate = useCallback(async (templateId: string, templateName: string) => {
    setIsTemplatePickerVisible(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await cloneTemplate(templateId, `${templateName} (Copy)`);

    if ('error' in result) {
      Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace(`/professional/training/plans/${result.id}` as never);
    }
  }, [cloneTemplate, tr, router]);

  // ── Assignment ─────────────────────────────────────────────────────────────
  const handleOpenStudentPicker = useCallback(async () => {
    setIsLoadingStudents(true);
    setIsStudentPickerVisible(true);
    try {
      const roster = await getProfessionalStudentRoster();
      setStudents(roster.filter(s => s.specialty === 'fitness_coach'));
    } catch {
      Alert.alert(t('pro.students.error') as string);
      setIsStudentPickerVisible(false);
    } finally {
      setIsLoadingStudents(false);
    }
  }, [t]);

  const handleAssignToStudent = useCallback(async (studentUid: string) => {
    if (!planId) return;
    setIsStudentPickerVisible(false);
    setIsAssigning(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const result = await bulkAssign(planId, [studentUid]);
    setIsAssigning(false);

    if ('error' in result) {
      Alert.alert(t('pro.plan.assign.error') as string);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t('pro.plan.assign.success') as string);
    }
  }, [bulkAssign, planId, t]);

  const handleOpenExerciseSearch = useCallback((sessionId: string) => {
    setActiveSessionIdForSearch(sessionId);
    setIsExerciseSearchVisible(true);
  }, []);

  const sessions = state.kind === 'ready' ? state.plan.sessions : [];

  return (
    <DsScreen
      scheme={scheme}
      headerShown={false}
      style={[styles.container, { backgroundColor: palette.background }]}
      contentContainerStyle={styles.content}
    >
      <Stack.Screen options={{ headerShown: false }} />

      {/* ── Header Row ──────────────────────────────────────────────────── */}
      <View style={styles.headerRow}>
        <DsBackButton
          scheme={scheme}
          onPress={handleBack}
          accessibilityLabel={t('auth.role.cta_back') as string}
          style={styles.backButton}
        />

        <View style={{ flexDirection: 'row', gap: DsSpace.sm }}>
          {sessions.length > 1 && (
            <DsPillButton
              scheme={scheme}
              variant="ghost"
              size="sm"
              label={isSortMode ? t('pro.plan.cta.sort_done') : t('pro.plan.cta.sort')}
              onPress={() => {
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setIsSortMode(!isSortMode);
              }}
              fullWidth={false}
              style={styles.templateCta}
              leftIcon={<IconSymbol name={isSortMode ? "checkmark.circle.fill" : "arrow.up.arrow.down"} size={14} color={palette.tint} />}
            />
          )}
          {isNew && !isStudentBuilder && (
            <DsPillButton
              scheme={scheme}
              variant="outline"
              size="sm"
              label={t('pro.plan.cta.clone_template')}
              onPress={handleOpenTemplatePicker}
              fullWidth={false}
              style={styles.templateCta}
              leftIcon={<IconSymbol name="square.stack.3d.up.fill" size={14} color={palette.tint} />}
            />
          )}
        </View>
      </View>

      <BuilderGuidanceCard
        theme={theme}
        visible={showGuidance}
        onDismiss={hideGuidance}
        title={tr('pro.plan.builder.guidance.training.title', 'student.plan.builder.guidance.training.title')}
        description={tr('pro.plan.builder.guidance.training.body', 'student.plan.builder.guidance.training.body')}
      />

      {state.kind === 'ready' && state.backgroundError && (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[styles.errorBanner, { backgroundColor: theme.color.warningSoft, borderColor: theme.color.warning, borderWidth: 1 }]}
        >
          <Text style={[styles.errorBannerText, { color: theme.color.warning }]}>
            {t('common.error.generic')} • Background update failed
          </Text>
        </View>
      )}

      {(state.kind === 'loading' || isAssigning || isSaving) && (
        <ActivityIndicator
          style={styles.loader}
          accessibilityLabel={t('a11y.loading.default')}
        />
      )}

      {/* ── Plan name field ───────────────────────────────────────────────── */}
      <BuilderInsetGroup theme={theme}>
        <Text style={[styles.insetGroupLabel, { color: palette.text }]}>
          {t('pro.plan.field.name.label')}
        </Text>
        <TextInput
          style={[styles.titleInput, { color: palette.text }]}
          placeholder={tr('pro.plan.field.name.placeholder', 'student.plan.field.name.placeholder')}
          placeholderTextColor={palette.icon}
          value={values.name}
          onChangeText={handleNameChange}
          accessibilityLabel={t('pro.plan.field.name.label')}
        />
        <Text style={[styles.supportText, { color: palette.icon }]}>
          {tr('pro.plan.field.name.support', 'student.plan.field.name.support')}
        </Text>
        {formErrors.name && (
          <Text style={[styles.fieldError, { color: palette.danger }]}>
            {formErrors.name === 'required' ? t('pro.plan.validation.name_required') : t('pro.plan.validation.name_too_short')}
          </Text>
        )}
      </BuilderInsetGroup>

      {/* ── Sessions list ─────────────────────────────────────────────────── */}
      <View style={styles.sectionHeaderRow}>
        <Text style={[styles.sectionHeader, { color: palette.text }]}>
            {tr('pro.plan.section.sessions', 'student.plan.section.sessions')}
        </Text>
        <Text style={[styles.supportText, { color: palette.icon, marginTop: 2 }]}>
          {tr('pro.plan.section.sessions.support', 'student.plan.section.sessions.support')}
        </Text>
      </View>

      {sessions.length === 0 && state.kind === 'ready' && (
        <View style={styles.emptyContainer}>
          <View style={[styles.emptyIconWrapper, { backgroundColor: theme.color.surfaceMuted }]}>
            <IconSymbol name="list.bullet.clipboard" size={40} color={palette.icon} />
          </View>
          <Text style={[styles.emptyTitle, { color: palette.text }]}>
            {tr('pro.plan.training.empty.title', 'student.plan.training.empty.title')}
          </Text>
          <Text style={[styles.emptyText, { color: palette.icon }]}>
            {tr('pro.plan.training.empty.body', 'student.plan.training.empty.body')}
          </Text>
        </View>
      )}

      {sessions.map((session, index) => (
        <SessionCard
          key={session.id}
          session={session}
          palette={palette}
          theme={theme}
          t={t}
          tr={tr}
          onRemoveSession={() => handleRemoveSession(session.id)}
          onAddItem={() => handleOpenExerciseSearch(session.id)}
          onRemoveItem={(itemId) => handleRemoveSessionItem(session.id, itemId)}
          isSortMode={isSortMode}
          onMoveUp={() => handleMoveSession(index, 'up')}
          onMoveDown={() => handleMoveSession(index, 'down')}
          onMoveItemUp={(itemId) => handleMoveItem(session.id, itemId, 'up')}
          onMoveItemDown={(itemId) => handleMoveItem(session.id, itemId, 'down')}
          isFirst={index === 0}
          isLast={index === sessions.length - 1}
        />
      ))}

      {/* ── Add session form ──────────────────────────────────────────────── */}
      {!isSortMode && state.kind === 'ready' && addSessionForm.kind === 'open' && (
        <Animated.View 
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(200)}
          style={[styles.sessionCard, { backgroundColor: theme.color.surface }]}
        >
          <View style={styles.sessionHeader}>
            <TextInput
              style={[styles.sessionNameInput, { color: palette.text }]}
              placeholder={tr('pro.plan.session.field.name.placeholder', 'pro.plan.session.field.name.placeholder')}
              placeholderTextColor={palette.icon}
              value={addSessionForm.name}
              onChangeText={(v) => setAddSessionForm((prev) => prev.kind === 'open' ? { ...prev, name: v } : prev)}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={() => sessionNotesRef.current?.focus()}
              accessibilityLabel={t('pro.plan.session.field.name.label')}
            />
          </View>
          <TextInput
            ref={sessionNotesRef}
            style={[styles.sessionNotesInput, { color: palette.text }]}
            placeholder={t('pro.plan.session.field.notes.label')}
            placeholderTextColor={palette.icon}
            value={addSessionForm.notes}
            onChangeText={(v) => setAddSessionForm((prev) => prev.kind === 'open' ? { ...prev, notes: v } : prev)}
            returnKeyType="done"
            onSubmitEditing={handleAddSession}
            accessibilityLabel={t('pro.plan.session.field.notes.label')}
          />
          <View style={styles.rowActions}>
            <DsPillButton scheme={scheme} variant="filled" label={tr('pro.plan.cta.add_session', 'student.plan.cta.add_session')} onPress={handleAddSession} style={{ flex: 1 }} />
            <DsPillButton scheme={scheme} variant="ghost" label={t('meal.library.quick_log.cta_cancel')} onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setAddSessionForm({ kind: 'closed' }); }} style={{ flex: 1 }} />
          </View>
        </Animated.View>
      )}

      {!isSortMode && state.kind === 'ready' && addSessionForm.kind === 'closed' && (
        <Pressable
          style={[styles.addSessionBtn, { backgroundColor: theme.color.surface }]}
          onPress={() => {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setAddSessionForm({ kind: 'open', name: '', notes: '' });
          }}
          accessibilityRole="button"
          accessibilityLabel={tr('pro.plan.cta.add_session', 'student.plan.cta.add_session')}
        >
          <IconSymbol name="plus.circle.fill" size={20} color={palette.tint} />
          <Text style={[styles.addSessionBtnText, { color: palette.tint }]}>
            {tr('pro.plan.cta.add_session', 'student.plan.cta.add_session')}
          </Text>
        </Pressable>
      )}

      {/* ── Footer Actions ────────────────────────────────────────────────── */}
      <View style={styles.footerActions}>
        <DsPillButton
          scheme={scheme}
          variant="primary"
          label={tr('pro.plan.cta.save', 'student.plan.cta.save')}
          onPress={handleSave}
          isLoading={isSaving}
          style={{ flex: 1 }}
        />

        {!isNew && !isStudentBuilder && (
          <DsPillButton
            scheme={scheme}
            variant="outline"
            label={t('pro.plan.cta.assign')}
            onPress={handleOpenStudentPicker}
            style={{ flex: 1 }}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: DsSpace.md, gap: DsSpace.md, paddingBottom: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DsSpace.xs },
  backButton: { marginBottom: 0 },
  templateCta: { minHeight: 40 },
  loader: { marginVertical: DsSpace.xl },
  insetGroupLabel: { ...DsTypography.micro, marginBottom: DsSpace.xxs, opacity: 0.7 },
  titleInput: { ...DsTypography.title, fontFamily: Fonts?.rounded ?? 'normal', paddingVertical: DsSpace.xxs },
  supportText: { ...DsTypography.micro, textTransform: 'none', opacity: 0.6, marginTop: DsSpace.xxs },
  sectionHeaderRow: { marginTop: DsSpace.md, marginBottom: DsSpace.xs, paddingHorizontal: DsSpace.xs },
  sectionHeader: { ...DsTypography.screenTitle, fontFamily: Fonts?.rounded ?? 'normal' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: DsSpace.xxl, gap: DsSpace.xs },
  emptyIconWrapper: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: DsSpace.xs },
  emptyTitle: { ...DsTypography.cardTitle, fontWeight: '700' },
  emptyText: { ...DsTypography.body, textAlign: 'center', opacity: 0.7 },
  sessionCard: { borderRadius: DsRadius.lg, padding: DsSpace.md, gap: DsSpace.md, ...DsShadow.soft, marginBottom: DsSpace.xs },
  sessionHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  sessionNameInput: { ...DsTypography.cardTitle, fontFamily: Fonts?.rounded ?? 'normal', flex: 1, paddingVertical: DsSpace.xxs },
  sessionNotesInput: { ...DsTypography.body, paddingVertical: DsSpace.xs },
  addSessionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: DsSpace.xs, padding: DsSpace.md, borderRadius: DsRadius.lg, ...DsShadow.soft, marginTop: DsSpace.sm },
  addSessionBtnText: { ...DsTypography.button },
  rowActions: { flexDirection: 'row', gap: DsSpace.sm, marginTop: DsSpace.sm },
  footerActions: { flexDirection: 'row', gap: DsSpace.md, marginTop: DsSpace.xl, paddingBottom: DsSpace.xl },
  fieldError: { ...DsTypography.micro, color: '#ff0000', marginTop: 2 },
});
