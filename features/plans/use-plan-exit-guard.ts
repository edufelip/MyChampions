import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Alert } from 'react-native';
import type { TranslationBinding } from '@/localization';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

/** Native removal can fire before React commits queued dirty-state updates. */
export function usePlanExitGuard({
  navigation,
  hasUnsavedChanges,
  onDiscard,
  t,
}: {
  navigation: Pick<NavigationProp<ParamListBase>, 'addListener' | 'dispatch'>;
  hasUnsavedChanges: boolean;
  onDiscard: () => void;
  t: TranslationBinding['t'];
}) {
  const unsaved = useRef(hasUnsavedChanges);
  const awaitingCleanCommit = useRef(false);
  useLayoutEffect(() => {
    // Router removal can arrive between the successful acknowledgement and
    // canonical draft reconciliation. Do not re-arm on that stale dirty state.
    if (awaitingCleanCommit.current && hasUnsavedChanges) return;
    awaitingCleanCommit.current = false;
    unsaved.current = hasUnsavedChanges;
  });
  const markClean = useCallback(() => {
    awaitingCleanCommit.current = true;
    unsaved.current = false;
  }, []);
  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (!unsaved.current) return;
        event.preventDefault();
        Alert.alert(t('pro.plan.discard.title'), t('pro.plan.discard.body'), [
          { text: t('pro.plan.discard.no'), style: 'cancel' },
          {
            text: t('pro.plan.discard.yes'),
            style: 'destructive',
            onPress: () => {
              markClean();
              onDiscard();
              navigation.dispatch(event.data.action);
            },
          },
        ]);
      }),
    [navigation, t, onDiscard, markClean],
  );
  return markClean;
}
