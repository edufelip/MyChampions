import React from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { MaterialIcons } from '@expo/vector-icons';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { DsRadius, DsShadow, DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import type { FoodSearchState, FoodSearchResult } from '@/features/plans/use-plan-builder';

type AddItemFormProps = {
  palette: {
    text: string;
    icon: string;
    tint: string;
  };
  theme: DsTheme;
  t: (key: string) => string;
  tr: (pro: string, student: string) => string;
  name: string;
  quantity: string;
  notes: string;
  foodQuery: string;
  foodSearchState: FoodSearchState;
  onNameChange: (v: string) => void;
  onQuantityChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  onSelectFood: (food: FoodSearchResult) => void;
  onAdd: () => void;
  onClose: () => void;
};

export const AddItemForm = React.memo(({
  palette,
  theme,
  t,
  tr,
  name,
  quantity,
  notes,
  foodQuery,
  foodSearchState,
  onNameChange,
  onQuantityChange,
  onNotesChange,
  onQueryChange,
  onSearch,
  onSelectFood,
  onAdd,
  onClose,
}: AddItemFormProps) => {
  const scheme = theme.color.canvas === '#102215' ? 'dark' : 'light';

  return (
    <Animated.View 
      entering={FadeIn.duration(300)} 
      exiting={FadeOut.duration(200)}
      style={[styles.container, { backgroundColor: theme.color.surface }]}
    >
      <View style={styles.header}>
        <Text style={[styles.title, { color: palette.text }]}>
          {tr('pro.plan.cta.add_food', 'student.plan.cta.add_food')}
        </Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <MaterialIcons name="close" size={24} color={palette.icon} />
        </Pressable>
      </View>

      {/* Search Input */}
      <View style={[styles.searchRow, { backgroundColor: theme.color.surfaceMuted }]}>
        <IconSymbol name="magnifyingglass" size={18} color={palette.icon} />
        <TextInput
          style={[styles.searchInput, { color: palette.text }]}
          placeholder={t('pro.plan.food_search.placeholder')}
          placeholderTextColor={palette.icon}
          value={foodQuery}
          onChangeText={onQueryChange}
          onSubmitEditing={onSearch}
          returnKeyType="search"
        />
        {foodQuery.length > 0 && (
          <Pressable onPress={() => onQueryChange('')}>
            <MaterialIcons name="cancel" size={18} color={palette.icon} />
          </Pressable>
        )}
      </View>

      {/* Search Results */}
      <View style={styles.resultsWrap}>
        {foodSearchState.kind === 'searching' && (
          <ActivityIndicator color={palette.tint} style={styles.loader} />
        )}

        {foodSearchState.kind === 'done' && (
          <FlatList
            data={foodSearchState.results}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <FoodSearchItem item={item} palette={palette} theme={theme} t={t} onSelect={() => onSelectFood(item)} />
            )}
            style={styles.resultsList}
            contentContainerStyle={styles.resultsContent}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {foodSearchState.kind === 'error' && (
          <View style={styles.errorContainer}>
            <MaterialIcons name="error-outline" size={20} color={theme.color.danger} />
            <Text style={[styles.errorText, { color: theme.color.danger }]}>
              {t('pro.plan.food_search.error')}
            </Text>
          </View>
        )}
      </View>

      {/* Detail Fields */}
      <View style={styles.detailsSection}>
        <View style={styles.fieldRow}>
          <View style={[styles.field, { flex: 2 }]}>
            <Text style={[styles.fieldLabel, { color: theme.color.textSecondary }]}>
              {t('pro.plan.item.field.nutrition_name.label')}
            </Text>
            <TextInput
              style={[styles.input, { color: theme.color.textPrimary }]}
              value={name}
              onChangeText={onNameChange}
              placeholder={t('pro.plan.item.field.nutrition_name.placeholder')}
              placeholderTextColor={theme.color.textTertiary}
            />
          </View>
          <View style={[styles.field, { flex: 1 }]}>
            <Text style={[styles.fieldLabel, { color: theme.color.textSecondary }]}>
              {t('pro.plan.item.field.nutrition_quantity.label')}
            </Text>
            <TextInput
              style={[styles.input, { color: theme.color.textPrimary }]}
              value={quantity}
              onChangeText={onQuantityChange}
              placeholder={t('pro.plan.item.field.nutrition_quantity.placeholder')}
              placeholderTextColor={theme.color.textTertiary}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={[styles.fieldLabel, { color: theme.color.textSecondary }]}>
            {t('pro.plan.item.field.nutrition_notes.label')}
          </Text>
          <TextInput
            style={[styles.input, { color: theme.color.textPrimary }]}
            value={notes}
            onChangeText={onNotesChange}
            placeholder={t('pro.plan.item.field.nutrition_notes.placeholder')}
            placeholderTextColor={theme.color.textTertiary}
          />
        </View>
      </View>

      <DsPillButton
        scheme={scheme}
        label={t('common.cta.add') as string}
        onPress={onAdd}
        disabled={!name.trim()}
        style={styles.addBtn}
      />
    </Animated.View>
  );
});

function FoodSearchItem({ 
  item, 
  palette, 
  theme, 
  t, 
  onSelect 
}: { 
  item: FoodSearchResult; 
  palette: any; 
  theme: any; 
  t: (key: string) => string; 
  onSelect: () => void 
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.searchItem,
        { borderBottomColor: theme.color.border },
        pressed && { backgroundColor: theme.color.surfaceMuted }
      ]}
      onPress={onSelect}
    >
      <View style={styles.searchItemInfo}>
        <Text style={[styles.searchItemName, { color: palette.text }]}>{item.name}</Text>
        <Text style={[styles.searchItemMacros, { color: palette.icon }]}>
          {item.caloriesPer100g} kcal • C:{item.carbsPer100g} P:{item.proteinsPer100g} F:{item.fatsPer100g} {t('pro.plan.food_search.per_100g')}
        </Text>
      </View>
      <MaterialIcons name="add-circle-outline" size={24} color={palette.tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: DsRadius.xl,
    padding: DsSpace.md,
    gap: DsSpace.sm,
    ...DsShadow.floating,
    position: 'absolute',
    bottom: 100, // Moved up considerably
    left: DsSpace.md,
    right: DsSpace.md,
    zIndex: 1000,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: DsSpace.xs,
  },
  title: {
    ...DsTypography.screenTitle,
    fontFamily: Fonts.rounded,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: DsRadius.md,
    paddingHorizontal: DsSpace.sm,
    height: 44,
    gap: DsSpace.xs,
  },
  searchInput: {
    flex: 1,
    ...DsTypography.body,
    height: '100%',
  },
  resultsWrap: {
    maxHeight: 200,
  },
  resultsList: {
    width: '100%',
  },
  resultsContent: {
    paddingVertical: DsSpace.xs,
  },
  searchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: DsSpace.sm,
    borderBottomWidth: 1,
    gap: DsSpace.sm,
  },
  searchItemInfo: {
    flex: 1,
  },
  searchItemName: {
    ...DsTypography.body,
    fontWeight: '600',
  },
  searchItemMacros: {
    ...DsTypography.caption,
    fontSize: 11,
    marginTop: 2,
  },
  loader: {
    marginVertical: DsSpace.md,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: DsSpace.xs,
    padding: DsSpace.md,
  },
  errorText: {
    ...DsTypography.caption,
    fontWeight: '600',
  },
  detailsSection: {
    gap: DsSpace.sm,
    marginTop: DsSpace.xs,
  },
  fieldRow: {
    flexDirection: 'row',
    gap: DsSpace.sm,
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    ...DsTypography.micro,
    fontWeight: '700',
  },
  input: {
    ...DsTypography.body,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: 'transparent', // Uses theme text if focused/filled maybe, keep simple for now
  },
  addBtn: {
    marginTop: DsSpace.sm,
  },
});
