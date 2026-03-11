import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useState, useRef } from 'react';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';

import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import type { useExerciseSearch } from '@/features/plans/use-exercise-search';
import type { ExerciseItem } from '@/features/plans/exercise-service-source';
import { useTranslation, type TranslationKey } from '@/localization';

type TFn = ReturnType<typeof useTranslation>['t'];

const EXERCISE_MUSCLE_GROUP_KEYS = new Set([
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'full_body',
]);

function translateMuscleGroup(slug: string, t: TFn): string {
  if (!EXERCISE_MUSCLE_GROUP_KEYS.has(slug)) return slug;
  return t(`exercise.muscle_group.${slug}` as TranslationKey);
}

export function ExerciseSearchModal({
  isVisible,
  onClose,
  onConfirm,
  searchState,
  onSearch,
  onClear,
  scheme,
  theme,
  t,
}: {
  isVisible: boolean;
  onClose: () => void;
  onConfirm: (exercise: ExerciseItem, quantity: string, notes: string) => void;
  searchState: ReturnType<typeof useExerciseSearch>['state'];
  onSearch: (query: string) => void;
  onClear: () => void;
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
}) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'search' | 'detail'>('search');
  const [selectedExercise, setSelectedExercise] = useState<ExerciseItem | null>(null);
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const notesRef = useRef<TextInput>(null);

  // Debounce search
  useEffect(() => {
    if (!isVisible || view === 'detail') return;
    
    const timeoutId = setTimeout(() => {
      onSearch(query);
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [query, onSearch, isVisible, view]);

  // Reset state when closed
  useEffect(() => {
    if (!isVisible) {
      setQuery('');
      setView('search');
      setSelectedExercise(null);
      setQuantity('');
      setNotes('');
      onClear();
    }
  }, [isVisible, onClear]);

  const handleSelectExercise = (exercise: ExerciseItem) => {
    setSelectedExercise(exercise);
    setView('detail');
  };

  const handleBackToSearch = () => {
    setView('search');
  };

  const handleConfirm = () => {
    if (!selectedExercise) return;
    onConfirm(selectedExercise, quantity.trim(), notes.trim());
  };

  return (
    <Modal visible={isVisible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.modalOverlay, { backgroundColor: theme.color.overlaySoft }]}>
        <View style={[styles.modalContent, { backgroundColor: theme.color.surface }]}>
          <View style={styles.modalHeader}>
            <Text style={[styles.modalTitle, { color: theme.color.textPrimary }]}>
              {view === 'detail' ? t('pro.plan.item.field.name.label') : t('pro.plan.item.search.placeholder')}
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: theme.color.accentPrimary, fontWeight: '600' }}>
                {t('auth.role.cta_back')}
              </Text>
            </Pressable>
          </View>

          {view === 'search' ? (
            // ── Search View ──────────────────────────────────────────────────
            <>
              <View
                style={[
                  styles.searchInputWrap,
                  {
                    borderColor: theme.color.border,
                    backgroundColor: theme.color.surfaceMuted,
                  },
                ]}>
                <MaterialIcons
                  name="search"
                  size={18}
                  color={theme.color.textSecondary}
                  style={styles.searchIcon}
                />
                <TextInput
                  style={[
                    styles.searchInput,
                    { color: theme.color.textPrimary },
                  ]}
                  placeholder={t('pro.plan.item.search.placeholder') as string}
                  placeholderTextColor={theme.color.textSecondary}
                  value={query}
                  onChangeText={setQuery}
                  autoFocus
                  accessibilityLabel={t('pro.plan.item.search.placeholder') as string}
                />
                {query.length > 0 && (
                  <Pressable onPress={() => setQuery('')} hitSlop={12}>
                    <MaterialIcons name="close" size={18} color={theme.color.textSecondary} />
                  </Pressable>
                )}
              </View>

              <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled">
                {searchState.kind === 'loading' && (
                  <ActivityIndicator color={theme.color.accentPrimary} style={{ marginTop: 40 }} />
                )}

                {searchState.kind === 'error' && (
                  <Text style={[styles.emptyText, { color: theme.color.danger, marginTop: 40 }]}>
                    {t('pro.plan.item.search.error')}
                  </Text>
                )}

                {searchState.kind === 'done' && searchState.results.length === 0 && (
                  <Text style={[styles.emptyText, { color: theme.color.textSecondary, marginTop: 40 }]}>
                    {t('pro.plan.item.search.empty')}
                  </Text>
                )}

                {searchState.kind === 'done' &&
                  searchState.results.map((exercise) => (
                    <Pressable
                      key={exercise.id}
                      style={[styles.exerciseRow, { borderColor: theme.color.border }]}
                      onPress={() => handleSelectExercise(exercise)}>
                      
                      {exercise.thumbnailUrl ? (
                        <Image source={{ uri: exercise.thumbnailUrl }} style={styles.thumbnail} contentFit="cover" />
                      ) : (
                        <View style={[styles.thumbnailPlaceholder, { backgroundColor: theme.color.surfaceMuted }]}>
                          <MaterialIcons name="fitness-center" size={24} color={theme.color.textSecondary} />
                        </View>
                      )}

                      <View style={{ flex: 1 }}>
                        <Text style={[styles.exerciseName, { color: theme.color.textPrimary }]}>
                          {exercise.title}
                        </Text>
                        {exercise.muscleGroup && (
                          <Text style={{ fontSize: 12, color: theme.color.textSecondary }}>
                            {translateMuscleGroup(exercise.muscleGroup, t)}
                          </Text>
                        )}
                      </View>
                      <MaterialIcons name="chevron-right" size={24} color={theme.color.textSecondary} />
                    </Pressable>
                  ))}

              </ScrollView>
            </>
          ) : (
            // ── Detail View ──────────────────────────────────────────────────
            <ScrollView style={styles.detailsContainer} contentContainerStyle={{ paddingBottom: 40 }}>
              <Pressable onPress={handleBackToSearch} hitSlop={12} style={styles.backButton}>
                <MaterialIcons name="arrow-back" size={20} color={theme.color.accentPrimary} />
                <Text style={{ color: theme.color.accentPrimary, fontSize: 14, fontWeight: '600', marginLeft: 4 }}>
                  {t('pro.plan.item.search.back')}
                </Text>
              </Pressable>

              <Text style={[styles.detailTitle, { color: theme.color.textPrimary }]}>
                {selectedExercise?.title}
              </Text>

              <ExerciseVideoPlayer 
                videoUrl={selectedExercise?.videoUrl} 
                thumbnailUrl={selectedExercise?.thumbnailUrl} 
                theme={theme}
              />

              <View style={styles.detailMeta}>
                {selectedExercise?.category && (
                  <View style={[styles.tag, { backgroundColor: theme.color.surfaceMuted }]}>
                    <Text style={[styles.tagText, { color: theme.color.textSecondary }]}>
                      {selectedExercise.category}
                    </Text>
                  </View>
                )}
                {selectedExercise?.muscleGroup && (
                  <View style={[styles.tag, { backgroundColor: theme.color.surfaceMuted }]}>
                    <Text style={[styles.tagText, { color: theme.color.textSecondary }]}>
                      {translateMuscleGroup(selectedExercise.muscleGroup, t)}
                    </Text>
                  </View>
                )}
              </View>

              {selectedExercise?.description && (
                <View style={styles.detailSection}>
                  <Text style={[styles.sectionTitle, { color: theme.color.textPrimary }]}>{t('pro.plan.item.detail.description')}</Text>
                  <Text style={[styles.sectionBody, { color: theme.color.textSecondary }]}>
                    {selectedExercise.description}
                  </Text>
                </View>
              )}

              {selectedExercise?.instructions && selectedExercise.instructions.length > 0 && (
                <View style={styles.detailSection}>
                  <Text style={[styles.sectionTitle, { color: theme.color.textPrimary }]}>{t('pro.plan.item.detail.instructions')}</Text>
                  {selectedExercise.instructions.map((step, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={[styles.bullet, { color: theme.color.textSecondary }]}>•</Text>
                      <Text style={[styles.bulletText, { color: theme.color.textSecondary }]}>{step}</Text>
                    </View>
                  ))}
                </View>
              )}

              {selectedExercise?.importantPoints && selectedExercise.importantPoints.length > 0 && (
                <View style={styles.detailSection}>
                  <Text style={[styles.sectionTitle, { color: theme.color.textPrimary }]}>{t('pro.plan.item.detail.important_points')}</Text>
                  {selectedExercise.importantPoints.map((point, i) => (
                    <View key={i} style={styles.bulletRow}>
                      <Text style={[styles.bullet, { color: theme.color.textSecondary }]}>•</Text>
                      <Text style={[styles.bulletText, { color: theme.color.textSecondary }]}>{point}</Text>
                    </View>
                  ))}
                </View>
              )}

              <View style={[styles.formSection, { borderTopColor: theme.color.border }]}>
                <Text style={[styles.fieldLabel, { color: theme.color.textPrimary }]}>
                  {t('pro.plan.item.field.quantity.label')}
                </Text>
                <TextInput
                  style={[
                    styles.textInput,
                    { color: theme.color.textPrimary, borderColor: theme.color.border },
                  ]}
                  placeholder={t('pro.plan.item.field.quantity.placeholder') as string}
                  placeholderTextColor={theme.color.textSecondary}
                  value={quantity}
                  onChangeText={setQuantity}
                  returnKeyType="next"
                  onSubmitEditing={() => notesRef.current?.focus()}
                  accessibilityLabel={t('pro.plan.item.field.quantity.label') as string}
                />

                <Text style={[styles.fieldLabel, { color: theme.color.textPrimary }]}>
                  {t('pro.plan.item.field.notes.label')}
                </Text>
                <TextInput
                  ref={notesRef}
                  style={[
                    styles.textInput,
                    { color: theme.color.textPrimary, borderColor: theme.color.border },
                  ]}
                  placeholder={t('pro.plan.item.field.notes.placeholder') as string}
                  placeholderTextColor={theme.color.textSecondary}
                  value={notes}
                  onChangeText={setNotes}
                  returnKeyType="done"
                  onSubmitEditing={handleConfirm}
                  accessibilityLabel={t('pro.plan.item.field.notes.label') as string}
                />

                <View style={styles.actionsFooter}>
                  <DsPillButton
                    scheme={scheme}
                    label={t('pro.plan.cta.add_item') as string}
                    onPress={handleConfirm}
                  />
                </View>
              </View>
            </ScrollView>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ExerciseVideoPlayer({ videoUrl, thumbnailUrl, theme }: { videoUrl?: string | null, thumbnailUrl?: string | null, theme: DsTheme }) {
  const player = useVideoPlayer(videoUrl ?? '', (player) => {
    player.loop = true;
    player.play();
  });

  if (!videoUrl) {
    return (
      <View style={[styles.videoPlaceholder, { backgroundColor: theme.color.surfaceMuted }]}>
        {thumbnailUrl ? (
          <Image source={{ uri: thumbnailUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
        ) : (
          <MaterialIcons name="videocam-off" size={48} color={theme.color.textSecondary} />
        )}
      </View>
    );
  }

  return (
    <VideoView
      style={styles.videoPlayer}
      player={player}
      allowsFullscreen
      allowsPictureInPicture
    />
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: DsRadius.xl,
    borderTopRightRadius: DsRadius.xl,
    minHeight: '75%',
    maxHeight: '90%',
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
  searchInputWrap: {
    alignItems: 'center',
    borderRadius: DsRadius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 44,
    paddingHorizontal: DsSpace.sm,
    marginBottom: DsSpace.md,
  },
  searchIcon: {
    marginRight: DsSpace.xs,
  },
  searchInput: {
    flex: 1,
    borderRadius: DsRadius.lg,
    fontSize: 15,
    minHeight: 40,
    paddingHorizontal: 0,
    paddingVertical: DsSpace.sm,
  },
  modalScroll: { gap: DsSpace.md, paddingBottom: 40 },
  exerciseRow: {
    borderWidth: 1,
    borderRadius: DsRadius.lg,
    padding: DsSpace.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: DsSpace.md,
  },
  thumbnail: {
    width: 50,
    height: 50,
    borderRadius: DsRadius.md,
  },
  thumbnailPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: DsRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseName: { fontWeight: '700', fontSize: 15 },
  emptyText: {
    ...DsTypography.body,
    padding: DsSpace.xxl,
    textAlign: 'center',
  },
  // Details View Styles
  detailsContainer: {
    flex: 1,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: DsSpace.md,
  },
  detailTitle: {
    ...DsTypography.cardTitle,
    fontSize: 20,
    marginBottom: DsSpace.md,
  },
  videoPlayer: {
    width: '100%',
    height: 200,
    borderRadius: DsRadius.lg,
    marginBottom: DsSpace.md,
  },
  videoPlaceholder: {
    width: '100%',
    height: 200,
    borderRadius: DsRadius.lg,
    marginBottom: DsSpace.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  detailMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DsSpace.sm,
    marginBottom: DsSpace.lg,
  },
  tag: {
    paddingHorizontal: DsSpace.sm,
    paddingVertical: 4,
    borderRadius: DsRadius.sm,
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
  },
  detailSection: {
    marginBottom: DsSpace.lg,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: DsSpace.xs,
  },
  sectionBody: {
    ...DsTypography.body,
    fontSize: 14,
    lineHeight: 20,
  },
  bulletRow: {
    flexDirection: 'row',
    marginBottom: 4,
    paddingRight: DsSpace.md,
  },
  bullet: {
    fontSize: 14,
    marginRight: 8,
  },
  bulletText: {
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  formSection: {
    marginTop: DsSpace.md,
    paddingTop: DsSpace.lg,
    borderTopWidth: 1,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
    marginBottom: 4,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: DsRadius.lg,
    padding: DsSpace.md,
    fontSize: 15,
    marginBottom: DsSpace.md,
    minHeight: 48,
  },
  actionsFooter: {
    marginTop: DsSpace.sm,
    paddingBottom: DsSpace.xl,
  },
});
