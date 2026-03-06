import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, Platform } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useState, useRef } from 'react';

import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { DsRadius, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import type { useYMoveSearch } from '@/features/plans/use-ymove-search';
import type { YMoveExercise } from '@/features/plans/ymove-source';
import type { useTranslation } from '@/localization';

type TFn = ReturnType<typeof useTranslation>['t'];

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
  onConfirm: (exercise: YMoveExercise, quantity: string, notes: string) => void;
  searchState: ReturnType<typeof useYMoveSearch>['state'];
  onSearch: (query: string) => void;
  onClear: () => void;
  scheme: 'light' | 'dark';
  theme: DsTheme;
  t: TFn;
}) {
  const [query, setQuery] = useState('');
  const [selectedExercise, setSelectedExercise] = useState<YMoveExercise | null>(null);
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const notesRef = useRef<TextInput>(null);

  // Debounce search
  useEffect(() => {
    if (!isVisible || selectedExercise) return;
    
    const timeoutId = setTimeout(() => {
      onSearch(query);
    }, 400);

    return () => clearTimeout(timeoutId);
  }, [query, onSearch, isVisible, selectedExercise]);

  // Reset state when closed
  useEffect(() => {
    if (!isVisible) {
      setQuery('');
      setSelectedExercise(null);
      setQuantity('');
      setNotes('');
      onClear();
    }
  }, [isVisible, onClear]);

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
              {selectedExercise ? t('pro.plan.item.field.name.label') : t('pro.plan.item.search.placeholder')}
            </Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={{ color: theme.color.accentPrimary, fontWeight: '600' }}>
                {t('auth.role.cta_back')}
              </Text>
            </Pressable>
          </View>

          {!selectedExercise ? (
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
                      onPress={() => setSelectedExercise(exercise)}>
                      
                      {exercise.thumbnailUrl ? (
                        <Image source={{ uri: exercise.thumbnailUrl }} style={styles.thumbnail} />
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
                            {exercise.muscleGroup}
                          </Text>
                        )}
                      </View>
                      <MaterialIcons name="chevron-right" size={24} color={theme.color.textSecondary} />
                    </Pressable>
                  ))}
              </ScrollView>
            </>
          ) : (
            // ── Details Form View ────────────────────────────────────────────
            <View style={styles.detailsContainer}>
              <View style={[styles.selectedHeader, { borderColor: theme.color.border }]}>
                 {selectedExercise.thumbnailUrl ? (
                    <Image source={{ uri: selectedExercise.thumbnailUrl }} style={styles.thumbnailLarge} />
                  ) : (
                    <View style={[styles.thumbnailPlaceholderLarge, { backgroundColor: theme.color.surfaceMuted }]}>
                      <MaterialIcons name="fitness-center" size={32} color={theme.color.textSecondary} />
                    </View>
                  )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.exerciseNameLarge, { color: theme.color.textPrimary }]}>
                    {selectedExercise.title}
                  </Text>
                  <Pressable onPress={() => setSelectedExercise(null)} hitSlop={12} style={{ marginTop: 4 }}>
                    <Text style={{ color: theme.color.accentPrimary, fontSize: 13, fontWeight: '600' }}>
                       Back to search
                    </Text>
                  </Pressable>
                </View>
              </View>

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
                autoFocus
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
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  selectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DsSpace.md,
    paddingBottom: DsSpace.md,
    marginBottom: DsSpace.md,
    borderBottomWidth: 1,
  },
  thumbnailLarge: {
    width: 72,
    height: 72,
    borderRadius: DsRadius.md,
  },
  thumbnailPlaceholderLarge: {
    width: 72,
    height: 72,
    borderRadius: DsRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseNameLarge: {
    ...DsTypography.cardTitle,
    fontFamily: Fonts?.rounded ?? 'normal',
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
    marginTop: 'auto',
    paddingTop: DsSpace.lg,
    paddingBottom: DsSpace.xl,
  }
});
