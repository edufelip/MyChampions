import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { BuilderInsetGroup } from '@/components/ds/patterns/BuilderInsetGroup';
import { DsSpace, DsTypography, type DsTheme } from '@/constants/design-system';
import { Fonts } from '@/constants/theme';
import type { validateNutritionPlanInput } from '@/features/plans/plan-builder.logic';

type PlanMetadataFormProps = {
  palette: {
    text: string;
    icon: string;
    danger: string;
  };
  theme: DsTheme;
  t: (key: string) => string;
  tr: (pro: string, student: string) => string;
  name: string;
  caloriesTarget: string;
  carbsTarget: string;
  proteinsTarget: string;
  fatsTarget: string;
  errors: ReturnType<typeof validateNutritionPlanInput>;
  onNameChange: (v: string) => void;
  autoFocus?: boolean;
};

export const PlanMetadataForm = React.memo(({
  palette,
  theme,
  t,
  tr,
  name,
  caloriesTarget,
  carbsTarget,
  proteinsTarget,
  fatsTarget,
  errors,
  onNameChange,
  autoFocus,
}: PlanMetadataFormProps) => {
  return (
    <BuilderInsetGroup theme={theme}>
      {/* Name */}
      <View style={styles.fieldSection}>
        <Text style={[styles.insetGroupLabel, { color: palette.text }]}> 
          {t('pro.plan.field.name.label')}
        </Text>
        <TextInput
          style={[styles.titleInput, { color: palette.text }]}
          placeholder={tr('pro.plan.field.nutrition_name.support', 'student.plan.field.nutrition_name.support')}
          placeholderTextColor={palette.icon}
          value={name}
          onChangeText={onNameChange}
          accessibilityLabel={t('pro.plan.field.name.label')}
          autoFocus={autoFocus}
        />
        {errors.name && (
          <Text style={[styles.fieldError, { color: palette.danger }]}>
            {errors.name === 'required' ? t('pro.plan.validation.name_required') : t('pro.plan.validation.name_too_short')}
          </Text>
        )}
      </View>

      <View style={[styles.divider, { backgroundColor: theme.color.border }]} />

      {/* Calorie target */}
      <View style={styles.fieldSection}>
        <Text style={[styles.insetGroupLabel, { color: palette.text }]}>
          {t('pro.plan.field.calories_target.label')}
        </Text>
        <Text style={[styles.targetLabel, { color: palette.text }]}>
          {caloriesTarget || '0'} kcal
        </Text>
      </View>

      <View style={[styles.divider, { backgroundColor: theme.color.border }]} />

      {/* Macro targets row */}
      <View style={styles.macroRow}>
        <MacroField
          label={t('pro.plan.field.carbs_target.label')}
          value={carbsTarget}
          palette={palette}
        />
        <View style={[styles.verticalDivider, { backgroundColor: theme.color.border }]} />
        <MacroField
          label={t('pro.plan.field.proteins_target.label')}
          value={proteinsTarget}
          palette={palette}
        />
        <View style={[styles.verticalDivider, { backgroundColor: theme.color.border }]} />
        <MacroField
          label={t('pro.plan.field.fats_target.label')}
          value={fatsTarget}
          palette={palette}
        />
      </View>
    </BuilderInsetGroup>
  );
});

function MacroField({ label, value, palette }: { 
  label: string; 
  value: string; 
  palette: any; 
}) {
  return (
    <View style={styles.macroField}>
      <Text style={[styles.macroLabel, { color: palette.icon }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.macroValue, { color: palette.text }]}>
        {value || '0'}g
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldSection: { gap: 2 },
  insetGroupLabel: { ...DsTypography.micro, opacity: 0.6 },
  titleInput: { ...DsTypography.title, fontFamily: Fonts?.rounded ?? 'normal', paddingVertical: DsSpace.xxs },
  targetLabel: { ...DsTypography.cardTitle, fontFamily: Fonts?.rounded ?? 'normal', paddingVertical: DsSpace.xxs },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: DsSpace.sm, opacity: 0.5 },
  verticalDivider: { width: StyleSheet.hairlineWidth, height: '60%', alignSelf: 'center', opacity: 0.5 },
  macroRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  macroField: { flex: 1, alignItems: 'center' },
  macroLabel: { ...DsTypography.micro, opacity: 0.6, marginBottom: 4 },
  macroValue: { ...DsTypography.body, fontWeight: '700', textAlign: 'center' },
  fieldError: { ...DsTypography.micro, marginTop: 2 },
});
