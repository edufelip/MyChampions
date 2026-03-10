import { useCallback, useState, useRef, useEffect } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

type UsePlanFormOptions<T extends Record<string, any>> = {
  initialValues: T;
  validate: (values: T) => Record<string, any>;
  onSave: (values: T) => Promise<{ id?: string; error?: any } | any>;
  onSuccess?: (id?: string) => void;
  onClearDraft?: () => void;
  t: (key: string) => string;
};

export function usePlanForm<T extends Record<string, any>>({
  initialValues,
  validate,
  onSave,
  onSuccess,
  onClearDraft,
  t,
}: UsePlanFormOptions<T>) {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const router = useRouter();
  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Sync values when initialValues change (e.g. after data fetch)
  useEffect(() => {
    if (!isDirty) {
      setValues(initialValues);
    }
  }, [initialValues, isDirty]);

  const setFieldValue = useCallback((field: keyof T, value: any) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    const formErrors = validate(values);
    if (Object.keys(formErrors).length > 0) {
      setErrors(formErrors);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

    setErrors({});
    setIsSaving(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const result = await onSave(values);
    
    if (isMounted.current) setIsSaving(false);

    // Some handlers return an error object, others return a result with id
    const hasError = result && (result.error || (typeof result === 'string' && result !== ''));
    
    if (hasError) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return result; // Allow component to handle specific alert if needed
    } else {
      setIsDirty(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (onClearDraft) {
        onClearDraft();
      }
      if (onSuccess) {
        onSuccess(result?.id);
      }
    }
    return result;
  }, [values, validate, onSave, onSuccess, onClearDraft]);

  const handleBack = useCallback(() => {
    const goBack = () => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/');
      }
    };

    if (isDirty) {
      Alert.alert(
        t('pro.plan.discard.title'),
        t('pro.plan.discard.body'),
        [
          { text: t('pro.plan.discard.no'), style: 'cancel' },
          { text: t('pro.plan.discard.yes'), style: 'destructive', onPress: goBack },
        ]
      );
    } else {
      goBack();
    }
  }, [isDirty, router, t]);

  return {
    values,
    setValues,
    setFieldValue,
    errors,
    setErrors,
    isSaving,
    isDirty,
    setIsDirty,
    handleSave,
    handleBack,
  };
}
