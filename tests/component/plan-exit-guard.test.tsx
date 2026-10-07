import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
import { usePlanExitGuard } from '@/features/plans/use-plan-exit-guard';
import { usePlanForm } from '@/features/plans/use-plan-form';
import { useTranslation } from '@/localization';
import { SUPPORTED_LOCALES, t } from '@/localization/core';
import { setComponentLocale } from './setup';
type Navigation = Parameters<typeof usePlanExitGuard>[0]['navigation'];

jest.mock('expo-router', () => ({ useRouter: () => ({ canGoBack: () => true, back: jest.fn() }) }));
const initialValues = { name: 'Saved' };
const action = { type: 'GO_BACK' };
type RemoveEvent = { preventDefault: () => void; data: { action: typeof action } };
function makeNavigation() {
  let listener: ((event: RemoveEvent) => void) | undefined;
  const prevented = jest.fn();
  const unsubscribe = jest.fn(() => {
    listener = undefined;
  });
  const dispatch = jest.fn(() => listener?.({ preventDefault: prevented, data: { action } }));
  const navigation = {
    addListener: jest.fn((_name: string, next: typeof listener) => {
      listener = next;
      return unsubscribe;
    }),
    dispatch,
  } as unknown as Navigation;
  return { navigation, prevented, dispatch, unsubscribe, remove: () => dispatch() };
}
function Harness({ navigation, save }: { navigation: Navigation; save: () => Promise<unknown> }) {
  const { t: translate } = useTranslation();
  const [sessionDirty, setSessionDirty] = useState(false);
  const form = usePlanForm({
    initialValues,
    t: translate,
    validate: () => ({}),
    onSave: save,
    onSuccess: () => {
      setSessionDirty(false);
      form.setIsDirty(false);
      markClean();
      navigation.dispatch(action);
    },
  });
  const markClean = usePlanExitGuard({
    navigation,
    hasUnsavedChanges: form.isDirty || sessionDirty,
    onDiscard: () => {
      form.setIsDirty(false);
      setSessionDirty(false);
    },
    t: translate,
  });
  return (
    <>
      <Pressable
        testID="edit"
        onPress={() => {
          form.setFieldValue('name', 'Draft');
          setSessionDirty(true);
        }}
      >
        <Text>Edit</Text>
      </Pressable>
      <Pressable
        testID="save"
        onPress={() => {
          void form.handleSave();
        }}
      >
        <Text>Save</Text>
      </Pressable>
    </>
  );
}

function DeferredCleanHarness({ navigation }: { navigation: Navigation }) {
  const { t: translate } = useTranslation();
  const [dirty, setDirty] = useState(true);
  const [revision, setRevision] = useState(0);
  const markClean = usePlanExitGuard({
    navigation,
    hasUnsavedChanges: dirty,
    onDiscard: () => setDirty(false),
    t: translate,
  });
  return (
    <>
      <Text>{revision}</Text>
      <Pressable testID="ack-save" onPress={markClean}>
        <Text>Acknowledge save</Text>
      </Pressable>
      <Pressable testID="intermediate-commit" onPress={() => setRevision((v) => v + 1)}>
        <Text>Commit</Text>
      </Pressable>
      <Pressable testID="clean-commit" onPress={() => setDirty(false)}>
        <Text>Reconcile</Text>
      </Pressable>
      <Pressable testID="new-edit" onPress={() => setDirty(true)}>
        <Text>Edit</Text>
      </Pressable>
    </>
  );
}

describe.each(SUPPORTED_LOCALES)(
  'plan removal guard: %s (SC-208, TC-278/TC-304 in TC-002)',
  (locale) => {
    beforeEach(() => setComponentLocale(locale));
    test('successful Save permits synchronous removal before queued dirty updates commit; new edits re-arm', async () => {
      const nav = makeNavigation();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const save = jest.fn().mockResolvedValue({ id: 'plan' });
      const view = await render(<Harness navigation={nav.navigation} save={save} />);
      await fireEvent.press(screen.getByTestId('edit'));
      await fireEvent.press(screen.getByTestId('save'));
      await waitFor(() => expect(nav.dispatch).toHaveBeenCalledTimes(1));
      expect(save).toHaveBeenCalledTimes(1);
      expect(nav.prevented).not.toHaveBeenCalled();
      expect(alert).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('edit'));
      await act(() => nav.remove());
      expect(nav.prevented).toHaveBeenCalledTimes(1);
      expect(alert).toHaveBeenCalledWith(
        t(locale, 'pro.plan.discard.title'),
        t(locale, 'pro.plan.discard.body'),
        expect.any(Array),
      );
      await view.unmount();
      expect(nav.unsubscribe).toHaveBeenCalled();
    });
    test('failed Save stays guarded; Keep editing does not dispatch; confirmed discard dispatches once without a second dialog', async () => {
      const nav = makeNavigation();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      const save = jest.fn().mockResolvedValue({ error: 'network' });
      await render(<Harness navigation={nav.navigation} save={save} />);
      await fireEvent.press(screen.getByTestId('edit'));
      await fireEvent.press(screen.getByTestId('save'));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      expect(nav.dispatch).not.toHaveBeenCalled();
      await act(() => nav.remove());
      expect(nav.prevented).toHaveBeenCalledTimes(1);
      const buttons = alert.mock.calls[0][2]!;
      expect(buttons[0].text).toBe(t(locale, 'pro.plan.discard.no'));
      expect(buttons[0].onPress).toBeUndefined();
      expect(nav.dispatch).toHaveBeenCalledTimes(1);
      await act(() => buttons[1].onPress?.());
      expect(nav.dispatch).toHaveBeenCalledTimes(2);
      expect(nav.prevented).toHaveBeenCalledTimes(1);
      expect(alert).toHaveBeenCalledTimes(1);
      await act(() => nav.remove());
      expect(nav.prevented).toHaveBeenCalledTimes(1);
    });
    test('acknowledged Save stays clean across an intermediate dirty commit before delayed removal; a later edit is guarded', async () => {
      const nav = makeNavigation();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      await render(<DeferredCleanHarness navigation={nav.navigation} />);
      await fireEvent.press(screen.getByTestId('ack-save'));
      await fireEvent.press(screen.getByTestId('intermediate-commit'));
      await act(() => nav.remove());
      expect(nav.prevented).not.toHaveBeenCalled();
      expect(alert).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByTestId('clean-commit'));
      await fireEvent.press(screen.getByTestId('new-edit'));
      await act(() => nav.remove());
      expect(nav.prevented).toHaveBeenCalledTimes(1);
      expect(alert).toHaveBeenCalledTimes(1);
    });
    test('clean plan removes without a dialog', async () => {
      const nav = makeNavigation();
      const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
      await render(
        <Harness navigation={nav.navigation} save={() => Promise.resolve({ id: 'plan' })} />,
      );
      await act(() => nav.remove());
      expect(nav.prevented).not.toHaveBeenCalled();
      expect(alert).not.toHaveBeenCalled();
    });
  },
);
