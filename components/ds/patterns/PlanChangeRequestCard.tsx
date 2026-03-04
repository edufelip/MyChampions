import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  DsRadius,
  DsTypography,
  type DsColorScheme,
  getDsTheme,
} from '@/constants/design-system';
import type {
  PlanChangeRequestErrorReason,
  PlanChangeRequestValidationErrors,
} from '@/features/plans/plan-change-request.logic';
import type { TranslationKey } from '@/localization';

import { DsCard } from '../primitives/DsCard';
import { DsPillButton } from '../primitives/DsPillButton';

type PlanChangeRequestCardProps = {
  scheme: DsColorScheme;
  t: (key: TranslationKey) => string;
  testID: string;
  isWriteLocked: boolean;
  keys: {
    title: TranslationKey;
    label: TranslationKey;
    placeholder: TranslationKey;
    cta: TranslationKey;
    success: TranslationKey;
    validationRequired: TranslationKey;
    validationTooShort: TranslationKey;
    errorPlanNotFound: TranslationKey;
    errorNoActiveAssignment: TranslationKey;
    errorNetwork: TranslationKey;
    errorUnknown: TranslationKey;
  };
  validate: (input: { requestText: string }) => PlanChangeRequestValidationErrors;
  submit: (requestText: string) => Promise<{ data: unknown } | { error: PlanChangeRequestErrorReason }>;
};

export function PlanChangeRequestCard({
  scheme,
  t,
  testID,
  isWriteLocked,
  keys,
  validate,
  submit,
}: PlanChangeRequestCardProps) {
  const theme = getDsTheme(scheme);
  const [requestText, setRequestText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const onSubmit = async () => {
    const errors = validate({ requestText });
    if (errors.requestText) {
      setFieldError(
        errors.requestText === 'required' ? t(keys.validationRequired) : t(keys.validationTooShort)
      );
      return;
    }

    setIsSubmitting(true);
    setFieldError(null);
    setSuccessMsg(null);

    const result = await submit(requestText);
    setIsSubmitting(false);

    if ('data' in result) {
      setRequestText('');
      setSuccessMsg(t(keys.success));
      return;
    }

    switch (result.error) {
      case 'plan_not_found':
        setFieldError(t(keys.errorPlanNotFound));
        break;
      case 'no_active_assignment':
        setFieldError(t(keys.errorNoActiveAssignment));
        break;
      case 'network':
        setFieldError(t(keys.errorNetwork));
        break;
      default:
        setFieldError(t(keys.errorUnknown));
    }
  };

  return (
    <DsCard scheme={scheme} style={styles.card} testID={testID}>
      <Text style={[styles.title, { color: theme.color.textPrimary }]}>{t(keys.title)}</Text>

      {isWriteLocked ? (
        <Text style={[styles.errorText, { color: theme.color.danger }]}>{t('offline.write_lock')}</Text>
      ) : (
        <>
          <Text style={[styles.label, { color: theme.color.textPrimary }]}>{t(keys.label)}</Text>
          <TextInput
            accessibilityLabel={t(keys.label)}
            multiline
            numberOfLines={4}
            onChangeText={(value) => {
              setRequestText(value);
              setFieldError(null);
              setSuccessMsg(null);
            }}
            placeholder={t(keys.placeholder)}
            placeholderTextColor={theme.color.textSecondary}
            style={[
              styles.input,
              {
                borderColor: fieldError ? theme.color.danger : 'transparent',
                backgroundColor: theme.color.surfaceMuted,
                color: theme.color.textPrimary,
              },
            ]}
            testID={`${testID}.input`}
            value={requestText}
          />

          {fieldError ? (
            <View accessibilityLiveRegion="polite">
              <Text style={[styles.errorText, { color: theme.color.danger }]} testID={`${testID}.error`}>
                {fieldError}
              </Text>
            </View>
          ) : null}

          {successMsg ? (
            <View accessibilityLiveRegion="polite">
              <Text style={styles.successText} testID={`${testID}.success`}>
                {successMsg}
              </Text>
            </View>
          ) : null}

          <DsPillButton
            scheme={scheme}
            label={t(keys.cta)}
            onPress={() => {
              void onSubmit();
            }}
            loading={isSubmitting}
            testID={`${testID}.submitButton`}
            rightIcon={
              isSubmitting ? <ActivityIndicator accessibilityLabel={t('a11y.loading.submitting')} color="#ffffff" /> : undefined
            }
          />
        </>
      )}
    </DsCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
  },
  title: {
    ...DsTypography.cardTitle,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    borderRadius: DsRadius.lg,
    borderWidth: 2,
    fontSize: 14,
    minHeight: 104,
    padding: 12,
    textAlignVertical: 'top',
  },
  errorText: {
    ...DsTypography.caption,
  },
  successText: {
    color: '#16a34a',
    ...DsTypography.caption,
    fontWeight: '700',
  },
});
