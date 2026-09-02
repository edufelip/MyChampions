import { MaterialIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { DsPillButton } from '@/components/ds/primitives/DsPillButton';
import { IconSymbol } from '@/components/ui/icon-symbol';
import {
  DsRadius,
  DsShadow,
  DsSpace,
  DsTypography,
  getDsTheme,
  type DsTheme,
} from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import { type TranslationKey } from '@/localization';
import type { CustomMeal } from '@/features/nutrition/custom-meal.logic';
import type { FoodSearchState, FoodSearchResult } from '@/features/plans/use-plan-builder';

const WEB_TEXTAREA_RESET =
  Platform.OS === 'web' ? ({ resize: 'none' } as unknown as TextStyle) : undefined;

type AddItemFormProps = {
  palette: {
    text: string;
    icon: string;
    tint: string;
  };
  theme: DsTheme;
  t: (key: TranslationKey) => string;
  tr: (pro: TranslationKey, student: TranslationKey) => string;
  name: string;
  quantity: string;
  notes: string;
  carbs?: string;
  proteins?: string;
  fats?: string;
  foodQuery: string;
  foodSearchState: FoodSearchState;
  selectedFood?: FoodSearchResult;
  customMeals?: CustomMeal[];
  isCustomMealsLoading?: boolean;
  selectedCustomMealName?: string;
  isInteractionLocked?: boolean;
  onNameChange: (v: string) => void;
  onQuantityChange: (v: string) => void;
  onNotesChange: (v: string) => void;
  onCarbsChange: (v: string) => void;
  onProteinsChange: (v: string) => void;
  onFatsChange: (v: string) => void;
  onQueryChange: (v: string) => void;
  onSearch: () => void;
  onSelectFood: (food: FoodSearchResult) => void;
  onClearFood: () => void;
  onSelectCustomMeal?: (meal: CustomMeal) => void;
  onClearCustomMeal?: () => void;
  onAdd: () => void;
  onClose: () => void;
  style?: any;
  testIDPrefix?: string;
};

export const AddItemForm = React.memo(
  ({
    palette,
    theme,
    t,
    tr,
    name,
    quantity,
    notes,
    carbs,
    proteins,
    fats,
    foodQuery,
    foodSearchState,
    selectedFood,
    customMeals = [],
    isCustomMealsLoading = false,
    selectedCustomMealName,
    isInteractionLocked = false,
    onNameChange,
    onQuantityChange,
    onNotesChange,
    onCarbsChange,
    onProteinsChange,
    onFatsChange,
    onQueryChange,
    onSearch,
    onSelectFood,
    onClearFood,
    onSelectCustomMeal,
    onClearCustomMeal,
    onAdd,
    onClose,
    style,
    testIDPrefix,
  }: AddItemFormProps) => {
    const scheme = theme.color.canvas === getDsTheme('dark').color.canvas ? 'dark' : 'light';
    const hasSelectedCustomMeal = Boolean(selectedCustomMealName);
    const hasSelectedSource = Boolean(selectedFood || selectedCustomMealName);

    return (
      <Animated.View
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(200)}
        style={[styles.container, { backgroundColor: theme.color.surface }, style]}
        testID={testIDPrefix ? `${testIDPrefix}.form` : undefined}
      >
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>
            {tr('pro.plan.cta.add_food', 'student.plan.cta.add_food')}
          </Text>
          <Pressable
            onPress={onClose}
            disabled={isInteractionLocked}
            hitSlop={12}
            testID={testIDPrefix ? `${testIDPrefix}.close` : undefined}
          >
            <MaterialIcons name="close" size={24} color={palette.icon} />
          </Pressable>
        </View>

        {onSelectCustomMeal && !hasSelectedSource && (
          <View style={styles.customMealSection}>
            <Text style={[styles.fieldLabel, { color: theme.color.textSecondary }]}>
              {t('pro.plan.custom_meal.section')}
            </Text>
            {isCustomMealsLoading ? (
              <ActivityIndicator color={palette.tint} style={styles.inlineLoader} />
            ) : customMeals.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.customMealList}
              >
                {customMeals.map((meal) => (
                  <Pressable
                    key={meal.id}
                    style={[
                      styles.customMealChip,
                      {
                        backgroundColor: theme.color.surfaceMuted,
                        borderColor: theme.color.border,
                      },
                    ]}
                    onPress={() => onSelectCustomMeal(meal)}
                    disabled={isInteractionLocked}
                    testID={testIDPrefix ? `${testIDPrefix}.customMeal.${meal.id}` : undefined}
                  >
                    <Text
                      style={[styles.customMealName, { color: palette.text }]}
                      numberOfLines={1}
                    >
                      {meal.name}
                    </Text>
                    <Text style={[styles.customMealMacros, { color: palette.icon }]}>
                      {meal.calories} {t('common.nutrition.calories')} •{' '}
                      {t('common.nutrition.carbs')}:{meal.carbs} {t('common.nutrition.proteins')}:
                      {meal.proteins} {t('common.nutrition.fats')}:{meal.fats}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Text style={[styles.customMealEmpty, { color: palette.icon }]}>
                {t('pro.plan.custom_meal.empty')}
              </Text>
            )}
          </View>
        )}

        {/* Search Input or Selected Food Indicator */}
        {!hasSelectedSource ? (
          <View style={[styles.searchRow, { backgroundColor: theme.color.surfaceMuted }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('pro.plan.food_search.placeholder')}
              disabled={isInteractionLocked || !foodQuery.trim()}
              onPress={onSearch}
              hitSlop={8}
              testID={testIDPrefix ? `${testIDPrefix}.searchButton` : undefined}
            >
              <IconSymbol name="magnifyingglass" size={18} color={palette.icon} />
            </Pressable>
            <TextInput
              style={[styles.searchInput, { color: palette.text }]}
              placeholder={t('pro.plan.food_search.placeholder')}
              placeholderTextColor={palette.icon}
              value={foodQuery}
              onChangeText={onQueryChange}
              onSubmitEditing={onSearch}
              editable={!isInteractionLocked}
              returnKeyType="search"
              testID={testIDPrefix ? `${testIDPrefix}.searchInput` : undefined}
            />
            {foodQuery.length > 0 && (
              <Pressable onPress={() => onQueryChange('')} disabled={isInteractionLocked}>
                <MaterialIcons name="cancel" size={18} color={palette.icon} />
              </Pressable>
            )}
          </View>
        ) : (
          <View
            style={[styles.selectedFoodRow, { backgroundColor: theme.color.surfaceMuted }]}
            testID={testIDPrefix ? `${testIDPrefix}.selectedFood` : undefined}
          >
            <View style={styles.selectedFoodInfo}>
              <IconSymbol name="checkmark.circle.fill" size={18} color={palette.tint} />
              <Text style={[styles.selectedFoodText, { color: palette.text }]} numberOfLines={1}>
                {selectedFood?.name ?? selectedCustomMealName}
              </Text>
              {hasSelectedCustomMeal && (
                <Text style={[styles.sourceBadge, { color: palette.tint }]}>
                  {t('pro.plan.custom_meal.badge')}
                </Text>
              )}
            </View>
            <Pressable
              onPress={hasSelectedCustomMeal ? onClearCustomMeal : onClearFood}
              disabled={isInteractionLocked}
              hitSlop={8}
              style={styles.clearFoodBtn}
            >
              <Text style={[styles.clearFoodText, { color: theme.color.danger }]}>
                {t('common.cta.clear') || 'Clear'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* Search Results */}
        {!hasSelectedSource && (
          <View style={styles.resultsWrap}>
            {foodSearchState.kind === 'searching' && (
              <ActivityIndicator color={palette.tint} style={styles.loader} />
            )}

            {foodSearchState.kind === 'done' && (
              <ScrollView
                style={styles.resultsList}
                contentContainerStyle={styles.resultsContent}
                keyboardShouldPersistTaps="handled"
              >
                {foodSearchState.results.map((item) => (
                  <FoodSearchItem
                    key={item.id}
                    item={item}
                    palette={palette}
                    theme={theme}
                    t={t}
                    disabled={isInteractionLocked}
                    onSelect={() => onSelectFood(item)}
                    testID={testIDPrefix ? `${testIDPrefix}.searchResult.${item.id}` : undefined}
                  />
                ))}
              </ScrollView>
            )}

            {foodSearchState.kind === 'error' && (
              <View style={styles.errorContainer}>
                <MaterialIcons name="error-outline" size={20} color={theme.color.danger} />
                <Text style={[styles.errorText, { color: theme.color.danger }]}>
                  {foodSearchState.reason === 'quota_exceeded'
                    ? t('pro.plan.food_search.error.quota')
                    : t('pro.plan.food_search.error')}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Detail Fields */}
        <View style={styles.detailsSection}>
          <View style={styles.fieldRow}>
            <View style={[styles.field, { flex: 2 }]}>
              <Text style={[styles.fieldLabel, { color: theme.color.textSecondary }]}>
                {t('pro.plan.item.field.nutrition_name.label')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textArea,
                  WEB_TEXTAREA_RESET,
                  { color: theme.color.textPrimary, backgroundColor: theme.color.surfaceMuted },
                ]}
                value={name}
                onChangeText={onNameChange}
                editable={!isInteractionLocked}
                placeholder={t('pro.plan.item.field.nutrition_name.placeholder')}
                placeholderTextColor={theme.color.textTertiary}
                multiline
                testID={testIDPrefix ? `${testIDPrefix}.name` : undefined}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.fieldLabel, { color: theme.color.textSecondary }]}>
                {t('pro.plan.item.field.nutrition_quantity.label')}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  { color: theme.color.textPrimary, backgroundColor: theme.color.surfaceMuted },
                ]}
                value={quantity}
                onChangeText={(text) => onQuantityChange(text.replace(/[^0-9.]/g, ''))}
                editable={!isInteractionLocked}
                keyboardType="decimal-pad"
                placeholder={t('pro.plan.item.field.nutrition_quantity.placeholder')}
                placeholderTextColor={theme.color.textTertiary}
                testID={testIDPrefix ? `${testIDPrefix}.quantity` : undefined}
              />
            </View>
          </View>

          <View style={styles.fieldRow}>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.fieldLabel, { color: theme.color.textSecondary }]}>
                {t('common.nutrition.carbs')} (g) {selectedFood ? '🔒' : ''}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: selectedFood ? theme.color.textSecondary : theme.color.textPrimary,
                    backgroundColor: theme.color.surfaceMuted,
                  },
                ]}
                value={carbs}
                onChangeText={(text) => onCarbsChange(text.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={theme.color.textTertiary}
                editable={!selectedFood && !hasSelectedCustomMeal && !isInteractionLocked}
                testID={testIDPrefix ? `${testIDPrefix}.carbs` : undefined}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.fieldLabel, { color: theme.color.textSecondary }]}>
                {t('common.nutrition.proteins')} (g) {selectedFood ? '🔒' : ''}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: selectedFood ? theme.color.textSecondary : theme.color.textPrimary,
                    backgroundColor: theme.color.surfaceMuted,
                  },
                ]}
                value={proteins}
                onChangeText={(text) => onProteinsChange(text.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={theme.color.textTertiary}
                editable={!selectedFood && !hasSelectedCustomMeal && !isInteractionLocked}
                testID={testIDPrefix ? `${testIDPrefix}.proteins` : undefined}
              />
            </View>
            <View style={[styles.field, { flex: 1 }]}>
              <Text style={[styles.fieldLabel, { color: theme.color.textSecondary }]}>
                {t('common.nutrition.fats')} (g) {selectedFood ? '🔒' : ''}
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: selectedFood ? theme.color.textSecondary : theme.color.textPrimary,
                    backgroundColor: theme.color.surfaceMuted,
                  },
                ]}
                value={fats}
                onChangeText={(text) => onFatsChange(text.replace(/[^0-9.]/g, ''))}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={theme.color.textTertiary}
                editable={!selectedFood && !hasSelectedCustomMeal && !isInteractionLocked}
                testID={testIDPrefix ? `${testIDPrefix}.fats` : undefined}
              />
            </View>
          </View>

          <View style={styles.field}>
            <Text style={[styles.fieldLabel, { color: theme.color.textSecondary }]}>
              {t('pro.plan.item.field.nutrition_notes.label')}
            </Text>
            <TextInput
              style={[
                styles.input,
                { color: theme.color.textPrimary, backgroundColor: theme.color.surfaceMuted },
              ]}
              value={notes}
              onChangeText={onNotesChange}
              editable={!isInteractionLocked}
              placeholder={t('pro.plan.item.field.nutrition_notes.placeholder')}
              placeholderTextColor={theme.color.textTertiary}
              testID={testIDPrefix ? `${testIDPrefix}.notes` : undefined}
            />
          </View>
        </View>

        <DsPillButton
          scheme={scheme}
          label={t('common.cta.add')}
          onPress={onAdd}
          disabled={isInteractionLocked || !name.trim()}
          style={styles.addBtn}
          testID={testIDPrefix ? `${testIDPrefix}.add` : undefined}
        />
      </Animated.View>
    );
  },
);

function FoodSearchItem({
  item,
  palette,
  theme,
  t,
  onSelect,
  disabled = false,
  testID,
}: {
  item: FoodSearchResult;
  palette: any;
  theme: any;
  t: (key: TranslationKey) => string;
  onSelect: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.searchItem,
        { borderBottomColor: theme.color.border },
        pressed && { backgroundColor: theme.color.surfaceMuted },
      ]}
      onPress={onSelect}
      disabled={disabled}
      testID={testID}
    >
      <View style={styles.searchItemInfo}>
        <Text style={[styles.searchItemName, { color: palette.text }]}>{item.name}</Text>
        <Text style={[styles.searchItemMacros, { color: palette.icon }]}>
          {item.caloriesPer100g} kcal • C:{item.carbsPer100g} P:{item.proteinsPer100g} F:
          {item.fatsPer100g} {t('pro.plan.food_search.per_100g')}
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
    top: 0,
    left: 0,
    right: 0,
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
  selectedFoodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: DsRadius.md,
    paddingHorizontal: DsSpace.sm,
    height: 44,
  },
  selectedFoodInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: DsSpace.xs,
    flex: 1,
    marginRight: DsSpace.sm,
  },
  selectedFoodText: {
    ...DsTypography.body,
    fontWeight: '600',
    flexShrink: 1,
  },
  sourceBadge: {
    ...DsTypography.micro,
    fontWeight: '700',
  },
  customMealSection: {
    gap: DsSpace.xs,
  },
  customMealList: {
    gap: DsSpace.xs,
    paddingVertical: 2,
  },
  customMealChip: {
    width: 180,
    borderWidth: 1,
    borderRadius: DsRadius.md,
    padding: DsSpace.sm,
    gap: 2,
  },
  customMealName: {
    ...DsTypography.caption,
    fontWeight: '700',
  },
  customMealMacros: {
    ...DsTypography.micro,
  },
  customMealEmpty: {
    ...DsTypography.caption,
  },
  inlineLoader: {
    alignSelf: 'flex-start',
    marginVertical: DsSpace.xs,
  },
  clearFoodBtn: {
    paddingVertical: DsSpace.xs,
  },
  clearFoodText: {
    ...DsTypography.body,
    fontWeight: '600',
  },
  searchInput: {
    flex: 1,
    ...DsTypography.body,
    height: '100%',
  },
  resultsWrap: {
    maxHeight: 200,
    marginTop: -8,
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
    paddingHorizontal: DsSpace.sm,
    height: 44,
    borderRadius: DsRadius.md,
  },
  textArea: {
    minHeight: 44,
    height: 'auto',
    paddingVertical: 12,
    textAlignVertical: 'center',
  },
  addBtn: {
    marginTop: DsSpace.sm,
  },
});
