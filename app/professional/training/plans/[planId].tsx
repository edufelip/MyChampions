/**
 * SC-208 Training Plan Builder
 * Route: /professional/training/plans/:planId
 */
import { useCallback, useEffect, useLayoutEffect, useState, useRef, useMemo } from 'react';
import {
  Alert,
  LayoutAnimation,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, usePathname, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { DsBackButton } from '@/components/ds/primitives/DsBackButton';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { BuilderGuidanceCard } from '@/components/ds/patterns/BuilderGuidanceCard';
import { BuilderInsetGroup } from '@/components/ds/patterns/BuilderInsetGroup';
import { StudentPickerModal } from '@/components/ds/patterns/StudentPickerModal';
import { ExerciseSearchModal } from '@/components/ds/patterns/ExerciseSearchModal';
import { SessionCard } from '@/features/plans/components/SessionCard';
import { BuilderBackgroundErrorBanner } from '@/features/plans/components/BuilderBackgroundErrorBanner';
import { BuilderLoadingScrim } from '@/features/plans/components/BuilderLoadingScrim';

import { DsRadius, DsShadow, DsSpace, DsTypography, getDsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useTrainingPlanBuilder } from '@/features/plans/use-plan-builder';
import { usePlans } from '@/features/plans/use-plans';
import { useExerciseSearch } from '@/features/plans/use-exercise-search';
import {
  createBuilderPalette,
  createBuilderRoleTranslator,
  enableBuilderLayoutAnimations,
} from '@/features/plans/builder-screen';
import type { ExerciseItem } from '@/features/plans/exercise-service-source';
import {
  isStarterTemplate,
  type TrainingSession,
} from '@/features/plans/plan-builder.logic';
import { generateId } from '@/features/firestore';
import { getProfessionalStudentRoster, type ProfessionalStudentRosterItem } from '@/features/professional/professional-source';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';
import { usePlanForm } from '@/features/plans/use-plan-form';
import { usePersistentGuidance } from '@/hooks/use-persistent-guidance';

enableBuilderLayoutAnimations();

// ─── Types ────────────────────────────────────────────────────────────────────

type AddSessionFormState =
  | { kind: 'closed' }
  | { kind: 'open'; name: string; notes: string };

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function TrainingPlanBuilderScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const theme = getDsTheme(scheme);
  
  const palette = useMemo(() => createBuilderPalette(theme), [theme]);

  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation<any>();
  const pathname = usePathname();
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const { currentUser } = useAuthSession();
  const isStudentBuilder = pathname.startsWith('/student/');

  const tr = useMemo(() => createBuilderRoleTranslator(isStudentBuilder, t), [isStudentBuilder, t]);

  const {
    state,
    loadPlan,
    initNewPlan,
    savePlanWithSessions,
    deletePlan,
    validateInput,
  } = useTrainingPlanBuilder(Boolean(currentUser), `${pathname}:plan:${planId ?? 'new'}`);

  const { bulkAssign } = usePlans(Boolean(currentUser), { fetchOnMount: false });

  // ── Form logic ─────────────────────────────────────────────────────────────
  const isNew = planId === 'new';
  const isStarterClone = typeof planId === 'string' && isStarterTemplate(planId);

  const initialValues = useMemo(() => ({
    name: state.kind === 'ready' ? state.plan.name : '',
  }), [state]);
  const [draftSessions, setDraftSessions] = useState<TrainingSession[]>([]);
  const [savedSessionsSnapshot, setSavedSessionsSnapshot] = useState<TrainingSession[]>([]);
  const savedSessionsSignature = useMemo(() => JSON.stringify(savedSessionsSnapshot), [savedSessionsSnapshot]);
  const draftSessionsSignature = useMemo(() => JSON.stringify(draftSessions), [draftSessions]);
  const hasSessionChanges = draftSessionsSignature !== savedSessionsSignature;

  const {
    values,
    setFieldValue,
    errors: formErrors,
    isSaving,
    isDirty,
    setIsDirty,
    handleSave,
  } = usePlanForm({
    initialValues,
    validate: validateInput,
    t,
    onSave: async (formValues) => {
      return savePlanWithSessions(planId ?? 'new', formValues, draftSessions);
    },
    onSuccess: (id) => {
      // After a successful save, we want to go back to the library.
      // We must clear the local dirty state first so the 'beforeRemove' 
      // listener doesn't trigger the discard dialog.
      setIsDirty(false);
      setSavedSessionsSnapshot(draftSessions);
      
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Navigate to the tab route so the bottom nav bar is visible
      router.replace('/training');
    }
  });

  // ── Local UI state ─────────────────────────────────────────────────────────
  const [addSessionForm, setAddSessionForm] = useState<AddSessionFormState>({ kind: 'closed' });
  const [isSortMode, setIsSortMode] = useState(false);
  const [showGuidance, hideGuidance] = usePersistentGuidance('guidance.training_builder');
  
  const [isStudentPickerVisible, setIsStudentPickerVisible] = useState(false);
  const [students, setStudents] = useState<ProfessionalStudentRosterItem[]>([]);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isDeletingPlan, setIsDeletingPlan] = useState(false);
  const [shouldNavigateAfterDelete, setShouldNavigateAfterDelete] = useState(false);
  const isMutating = state.kind === 'ready' && Boolean(state.isMutating);
  const isInitialLoading = state.kind === 'loading';
  const isBusy = isAssigning || isSaving || isMutating || isDeletingPlan;
  const hasUnsavedChanges = isDirty || hasSessionChanges;

  const { state: exerciseSearchState, search: searchExerciseLibrary, clear: clearExerciseSearch } = useExerciseSearch();
  const [isExerciseSearchVisible, setIsExerciseSearchVisible] = useState(false);
  const [activeSessionIdForSearch, setActiveSessionIdForSearch] = useState<string | null>(null);

  const planNameRef = useRef<TextInput>(null);
  const sessionNotesRef = useRef<TextInput>(null);

  // ── Auto-focus name on new plan ────────────────────────────────────────────
  useEffect(() => {
    if (isNew && !values.name && state.kind === 'ready') {
      const timer = setTimeout(() => {
        planNameRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isNew, values.name, state.kind]);

  // ── Load existing plan ─────────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (isNew) {
      initNewPlan();
    } else if (!isStarterClone && planId) {
      loadPlan(planId);
    }
  }, [planId, isNew, isStarterClone, loadPlan, initNewPlan]);

  useEffect(() => {
    if (!shouldNavigateAfterDelete || isDeletingPlan) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      setShouldNavigateAfterDelete(false);
      router.replace(isStudentBuilder ? '/student/training' : '/professional/training');
    });

    return () => cancelAnimationFrame(frame);
  }, [shouldNavigateAfterDelete, isDeletingPlan, router, isStudentBuilder]);

  useEffect(() => {
    if (state.kind !== 'ready') {
      return;
    }

    if (!hasUnsavedChanges || state.plan.id !== planId) {
      setDraftSessions(state.plan.sessions);
      setSavedSessionsSnapshot(state.plan.sessions);
    }
  }, [state, hasUnsavedChanges, planId]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (event: any) => {
      if (!hasUnsavedChanges) {
        return;
      }

      event.preventDefault();
      Alert.alert(
        t('pro.plan.discard.title'),
        t('pro.plan.discard.body'),
        [
          { text: t('pro.plan.discard.no'), style: 'cancel' },
          {
            text: t('pro.plan.discard.yes'),
            style: 'destructive',
            onPress: async () => {
              // Reset dirty states before dispatching so the listener doesn't fire again
              setIsDirty(false);
              setDraftSessions(savedSessionsSnapshot);
              navigation.dispatch(event.data.action);
            },
          },
        ]
      );
    });

    return unsubscribe;
  }, [hasUnsavedChanges, navigation, t, setIsDirty, savedSessionsSnapshot]);

  // ── Handlers with Animations ───────────────────────────────────────────────
  const handleNameChange = useCallback((val: string) => {
    setFieldValue('name', val);
  }, [setFieldValue]);

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/training');
    }
  }, [router]);

  const handleSaveDraft = useCallback(async () => {
    const result = await handleSave();
    if (result && 'error' in result && result.error && result.error !== 'validation') {
      Alert.alert(tr('pro.plan.error.save', 'student.plan.error.save'));
      return;
    }

    if (result && !('error' in result) && 'plan' in result) {
      setDraftSessions(result.plan.sessions);
      setSavedSessionsSnapshot(result.plan.sessions);
    }
  }, [handleSave, tr]);

  const handleDeletePlan = useCallback(() => {
    if (isBusy || isNew || !planId) return;

    Alert.alert(
      tr('pro.plan.delete.title', 'student.plan.delete.title'),
      tr('pro.plan.delete.body', 'student.plan.delete.body'),
      [
        { text: t('common.cta.cancel'), style: 'cancel' },
        {
          text: t('common.cta.delete'),
          style: 'destructive',
          onPress: async () => {
            setIsDeletingPlan(true);
            const err = await deletePlan(planId);
            if (!err) {
              setShouldNavigateAfterDelete(true);
              setIsDeletingPlan(false);
            } else {
              setIsDeletingPlan(false);
              Alert.alert(tr('pro.plan.error.delete', 'student.plan.error.delete'));
            }
          },
        },
      ]
    );
  }, [isBusy, isNew, planId, deletePlan, t, tr]);

  const handleAddSession = useCallback(async () => {
    if (isBusy || addSessionForm.kind !== 'open' || state.kind !== 'ready') return;
    const { name: sessionName, notes } = addSessionForm;
    if (!sessionName.trim()) return;

    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setDraftSessions((prev) => [
      ...prev,
      {
        id: generateId('training_session_local'),
        name: sessionName.trim(),
        notes: notes.trim(),
        items: [],
      },
    ]);
    setAddSessionForm({ kind: 'closed' });
    setIsDirty(true);
  }, [isBusy, addSessionForm, state.kind, setIsDirty]);

  const handleRemoveSession = useCallback(
    (sessionId: string) => {
      if (isBusy || state.kind !== 'ready') return;

      const session = draftSessions.find(s => s.id === sessionId);
      const sessionName = session?.name || t('pro.plan.section.sessions');

      Alert.alert(
        t('common.cta.delete') as string,
        (t('pro.plan.delete.body') as string).replace('{name}', sessionName),
        [
          { text: t('common.cta.cancel'), style: 'cancel' },
          {
            text: t('common.cta.delete'),
            style: 'destructive',
            onPress: async () => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setDraftSessions((prev) => prev.filter((candidate) => candidate.id !== sessionId));
              setIsDirty(true);
            },
          },
        ]
      );
    },
    [draftSessions, isBusy, state.kind, setIsDirty, t]
  );

  const handleRemoveSessionItem = useCallback(
    (sessionId: string, itemId: string) => {
      if (isBusy || state.kind !== 'ready') return;

      const session = draftSessions.find(s => s.id === sessionId);
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
            onPress: async () => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setDraftSessions((prev) => prev.map((sessionDraft) => {
                if (sessionDraft.id !== sessionId) {
                  return sessionDraft;
                }

                return {
                  ...sessionDraft,
                  items: sessionDraft.items.filter((candidate) => candidate.id !== itemId),
                };
              }));
              setIsDirty(true);
            },
          },
        ]
      );
    },
    [draftSessions, isBusy, state.kind, setIsDirty, t]
  );

  const handleConfirmExercise = useCallback(async (exercise: ExerciseItem, quantity: string, notes: string) => {
    if (isBusy || !activeSessionIdForSearch) return;
    
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    setIsExerciseSearchVisible(false);
    const sessionId = activeSessionIdForSearch;
    setActiveSessionIdForSearch(null);
    clearExerciseSearch();

    // Only persist the stable exerciseId — URLs are pre-signed, expire after 48 h,
    // and must not be cached. Re-fetch them on demand through exercise service.
    setDraftSessions((prev) => prev.map((sessionDraft) => {
      if (sessionDraft.id !== sessionId) {
        return sessionDraft;
      }

      return {
        ...sessionDraft,
        items: [
          ...sessionDraft.items,
          {
            id: generateId('training_item_local'),
            name: exercise.title,
            quantity,
            notes,
            exerciseId: exercise.id,
          },
        ],
      };
    }));
    setIsDirty(true);
  }, [isBusy, activeSessionIdForSearch, clearExerciseSearch, setIsDirty]);

  // ── Reordering logic ───────────────────────────────────────────────────────
  const handleMoveSession = useCallback(async (index: number, direction: 'up' | 'down') => {
    if (isBusy || state.kind !== 'ready') return;
    const newSessions = [...draftSessions];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSessions.length) return;

    const [moved] = newSessions.splice(index, 1);
    newSessions.splice(targetIndex, 0, moved);

    // Immediate visual update with animation
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    setDraftSessions(newSessions);
    setIsDirty(true);
  }, [draftSessions, isBusy, state.kind, setIsDirty]);

  const handleMoveItem = useCallback(async (sessionId: string, itemId: string, direction: 'up' | 'down') => {
    if (isBusy || state.kind !== 'ready') return;
    const session = draftSessions.find(s => s.id === sessionId);
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

    setDraftSessions((prev) => prev.map((sessionDraft) => {
      if (sessionDraft.id !== sessionId) {
        return sessionDraft;
      }

      return {
        ...sessionDraft,
        items: newItems,
      };
    }));
    setIsDirty(true);
  }, [draftSessions, isBusy, state.kind, setIsDirty]);

  // ── Assignment ─────────────────────────────────────────────────────────────
  const handleOpenStudentPicker = useCallback(async () => {
    if (isBusy) return;
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
  }, [isBusy, t]);

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
    if (isBusy) return;
    setActiveSessionIdForSearch(sessionId);
    setIsExerciseSearchVisible(true);
  }, [isBusy]);

  const sessions = state.kind === 'ready' ? draftSessions : [];
  const isEmptySessionsState = state.kind === 'ready' && sessions.length === 0;
  const addSessionDraft = addSessionForm.kind === 'open' ? addSessionForm : null;
  const isEmptyStateAddSessionOpen = !isSortMode && isEmptySessionsState && addSessionDraft !== null;

  return (
    <DsScreen
      scheme={scheme}
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
                if (isBusy) return;
                LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                setIsSortMode(!isSortMode);
              }}
              disabled={isBusy}
              fullWidth={false}
              style={styles.templateCta}
              leftIcon={<IconSymbol name={isSortMode ? "checkmark.circle.fill" : "arrow.up.arrow.down"} size={14} color={palette.tint} />}
            />
          )}
          {!isNew && (
            <Pressable 
              onPress={handleDeletePlan}
              disabled={isBusy}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('common.cta.delete') as string}
              style={styles.headerActionBtn}
            >
              <IconSymbol name="trash" size={20} color={palette.danger} />
            </Pressable>
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
        <BuilderBackgroundErrorBanner
          theme={theme}
          message={`${t('common.error.generic')} • Background update failed`}
        />
      )}

      {/* ── Plan name field ───────────────────────────────────────────────── */}
      <BuilderInsetGroup theme={theme}>
        <Text style={[styles.insetGroupLabel, { color: palette.text }]}>
          {tr('pro.plan.field.name.label', 'student.plan.field.name.label')}
        </Text>
        <TextInput
          ref={planNameRef}
          style={[styles.titleInput, { color: palette.text }]}
          placeholder={tr('pro.plan.field.name.placeholder', 'student.plan.field.name.placeholder')}
          placeholderTextColor={palette.icon}
          value={values.name}
          onChangeText={handleNameChange}
          accessibilityLabel={tr('pro.plan.field.name.label', 'student.plan.field.name.label')}
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

      {isEmptySessionsState && (
        <View style={styles.emptyStateStack}>
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

          {isEmptyStateAddSessionOpen && (
            <Animated.View
              entering={FadeIn.duration(300)}
              exiting={FadeOut.duration(200)}
              style={[
                styles.sessionCard,
                styles.emptyStateSessionOverlay,
                { backgroundColor: theme.color.surface },
              ]}
            >
              <View style={styles.sessionHeader}>
                <TextInput
                  style={[styles.sessionNameInput, { color: palette.text }]}
                  placeholder={tr('pro.plan.session.field.name.placeholder', 'student.plan.session.field.name.placeholder')}
                  placeholderTextColor={palette.icon}
                  value={addSessionDraft?.name ?? ''}
                  onChangeText={(v) => setAddSessionForm((prev) => prev.kind === 'open' ? { ...prev, name: v } : prev)}
                  editable={!isBusy}
                  autoFocus
                  returnKeyType="next"
                  onSubmitEditing={() => sessionNotesRef.current?.focus()}
                  accessibilityLabel={tr('pro.plan.session.field.name.label', 'pro.plan.session.field.name.label')}
                />
              </View>
              <TextInput
                ref={sessionNotesRef}
                style={[styles.sessionNotesInput, { color: palette.text }]}
                placeholder={t('pro.plan.session.field.notes.label')}
                placeholderTextColor={palette.icon}
                value={addSessionDraft?.notes ?? ''}
                onChangeText={(v) => setAddSessionForm((prev) => prev.kind === 'open' ? { ...prev, notes: v } : prev)}
                editable={!isBusy}
                returnKeyType="done"
                onSubmitEditing={handleAddSession}
                accessibilityLabel={t('pro.plan.session.field.notes.label')}
              />
              <View style={styles.rowActions}>
                <DsPillButton scheme={scheme} variant="primary" label={tr('pro.plan.cta.add_session', 'student.plan.cta.add_session')} onPress={handleAddSession} disabled={isBusy} style={{ flex: 1 }} />
                <DsPillButton scheme={scheme} variant="ghost" label={t('meal.library.quick_log.cta_cancel')} onPress={() => { if (isBusy) return; LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setAddSessionForm({ kind: 'closed' }); }} disabled={isBusy} style={{ flex: 1 }} />
              </View>
            </Animated.View>
          )}
        </View>
      )}

      {sessions.map((session, index) => (
        <SessionCard
          key={session.id}
          session={session}
          sessionIndex={index}
          totalSessions={sessions.length}
          palette={palette}
          theme={theme}
          t={t}
          tr={tr}
          onRemoveSession={handleRemoveSession}
          onAddItem={handleOpenExerciseSearch}
          onRemoveItem={handleRemoveSessionItem}
          isSortMode={isSortMode}
          isInteractionLocked={isBusy}
          onMoveSession={handleMoveSession}
          onMoveItem={handleMoveItem}
        />
      ))}

      {/* ── Add session form ──────────────────────────────────────────────── */}
      {!isEmptySessionsState && !isSortMode && state.kind === 'ready' && addSessionForm.kind === 'open' && (
        <Animated.View 
          entering={FadeIn.duration(300)}
          exiting={FadeOut.duration(200)}
          style={[styles.sessionCard, { backgroundColor: theme.color.surface }]}
        >
          <View style={styles.sessionHeader}>
            <TextInput
              style={[styles.sessionNameInput, { color: palette.text }]}
              placeholder={tr('pro.plan.session.field.name.placeholder', 'student.plan.session.field.name.placeholder')}
              placeholderTextColor={palette.icon}
              value={addSessionForm.name}
              onChangeText={(v) => setAddSessionForm((prev) => prev.kind === 'open' ? { ...prev, name: v } : prev)}
              editable={!isBusy}
              autoFocus
              returnKeyType="next"
              onSubmitEditing={() => sessionNotesRef.current?.focus()}
              accessibilityLabel={tr('pro.plan.session.field.name.label', 'pro.plan.session.field.name.label')}
            />
          </View>
          <TextInput
            ref={sessionNotesRef}
            style={[styles.sessionNotesInput, { color: palette.text }]}
            placeholder={t('pro.plan.session.field.notes.label')}
            placeholderTextColor={palette.icon}
            value={addSessionForm.notes}
            onChangeText={(v) => setAddSessionForm((prev) => prev.kind === 'open' ? { ...prev, notes: v } : prev)}
            editable={!isBusy}
            returnKeyType="done"
            onSubmitEditing={handleAddSession}
            accessibilityLabel={t('pro.plan.session.field.notes.label')}
          />
          <View style={styles.rowActions}>
            <DsPillButton scheme={scheme} variant="primary" label={tr('pro.plan.cta.add_session', 'student.plan.cta.add_session')} onPress={handleAddSession} disabled={isBusy} style={{ flex: 1 }} />
            <DsPillButton scheme={scheme} variant="ghost" label={t('meal.library.quick_log.cta_cancel')} onPress={() => { if (isBusy) return; LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setAddSessionForm({ kind: 'closed' }); }} disabled={isBusy} style={{ flex: 1 }} />
          </View>
        </Animated.View>
      )}

      {!isSortMode && state.kind === 'ready' && addSessionForm.kind === 'closed' && (
        <DsPillButton
          scheme={scheme}
          variant="primary"
          label={tr('pro.plan.cta.add_session', 'student.plan.cta.add_session')}
          onPress={() => {
            if (isBusy) return;
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setAddSessionForm({ kind: 'open', name: '', notes: '' });
          }}
          disabled={isBusy}
          leftIcon={<IconSymbol name="plus.circle.fill" size={18} color={theme.color.onAccent} />}
        />
      )}

      {/* ── Footer Actions ────────────────────────────────────────────────── */}
      <View style={styles.footerActions}>
        <DsPillButton
          scheme={scheme}
          variant="primary"
          label={tr('pro.plan.cta.save', 'student.plan.cta.save')}
          onPress={handleSaveDraft}
          disabled={!hasUnsavedChanges || isSaving || isMutating}
          loading={isSaving}
          style={{ flex: 1 }}
        />

        {!isNew && !isStudentBuilder && (
          <DsPillButton
            scheme={scheme}
            variant="outline"
            label={t('pro.plan.cta.assign')}
            onPress={handleOpenStudentPicker}
            disabled={isBusy || hasUnsavedChanges}
            style={{ flex: 1 }}
          />
        )}
      </View>

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
        searchState={exerciseSearchState}
        onSearch={searchExerciseLibrary}
        onClear={clearExerciseSearch}
        scheme={scheme}
        theme={theme}
        t={t}
      />

      {(isInitialLoading || isBusy) && (
        <BuilderLoadingScrim
          scheme={scheme}
          theme={theme}
          spinnerColor={palette.tint}
          label={t('a11y.loading.default')}
        />
      )}
    </DsScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: DsSpace.md, paddingVertical: DsSpace.xs, gap: DsSpace.md, paddingBottom: 60 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: DsSpace.xs },
  backButton: { marginBottom: 0 },
  templateCta: { minHeight: 40 },
  insetGroupLabel: { ...DsTypography.micro, marginBottom: DsSpace.xxs, opacity: 0.7 },
  titleInput: { ...DsTypography.title, fontFamily: Fonts?.rounded ?? 'normal', paddingVertical: DsSpace.xxs },
  supportText: { ...DsTypography.micro, textTransform: 'none', opacity: 0.6, marginTop: DsSpace.xxs },
  sectionHeaderRow: { marginTop: DsSpace.md, marginBottom: DsSpace.xs, paddingHorizontal: DsSpace.xs },
  sectionHeader: { ...DsTypography.screenTitle, fontFamily: Fonts?.rounded ?? 'normal' },
  emptyStateStack: { position: 'relative', minHeight: 240, justifyContent: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: DsSpace.xxl, gap: DsSpace.xs },
  emptyIconWrapper: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: DsSpace.xs },
  emptyTitle: { ...DsTypography.cardTitle, fontWeight: '700' },
  emptyText: { ...DsTypography.body, textAlign: 'center', opacity: 0.7 },
  sessionCard: { borderRadius: DsRadius.lg, paddingHorizontal: DsSpace.md, paddingVertical: DsSpace.xs, gap: DsSpace.md, ...DsShadow.soft, marginBottom: DsSpace.xs },
  emptyStateSessionOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 2, justifyContent: 'center', marginBottom: 0 },
  sessionHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  sessionNameInput: { ...DsTypography.cardTitle, fontFamily: Fonts?.rounded ?? 'normal', flex: 1, paddingVertical: DsSpace.xxs },
  sessionNotesInput: { ...DsTypography.body, paddingVertical: DsSpace.xs },
  headerActionBtn: { padding: DsSpace.xs, justifyContent: 'center', alignItems: 'center' },
  rowActions: { flexDirection: 'row', gap: DsSpace.sm, marginTop: DsSpace.sm },
  footerActions: { flexDirection: 'row', gap: DsSpace.md, marginTop: DsSpace.xl, paddingBottom: DsSpace.xl },
  fieldError: { ...DsTypography.micro, color: '#ff0000', marginTop: 2 },
});
