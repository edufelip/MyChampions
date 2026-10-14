import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ProfessionalStudentsScreen from '@/app/professional/students';
import {
  getProfessionalStudentRoster,
  type ProfessionalStudentRosterItem,
} from '@/features/professional/professional-source';
import type * as ReactModule from 'react';
import type * as ReactNativeModule from 'react-native';
import { enUS } from '@/localization/en-US';

type FocusEffect = () => void | (() => void);

const mockFocusController = {
  focused: true,
  callback: null as FocusEffect | null,
  cleanup: null as (() => void) | null,
  blur() {
    this.focused = false;
    this.cleanup?.();
    this.cleanup = null;
  },
  focus() {
    this.focused = true;
    this.cleanup?.();
    this.cleanup = this.callback?.() ?? null;
  },
  reset() {
    this.focused = true;
    this.callback = null;
    this.cleanup = null;
  },
};
const mockCurrentUser = { uid: 'professional-1' };
const mockBulkAssign = jest.fn();

jest.mock('@react-navigation/native', () => {
  const React = jest.requireActual<typeof ReactModule>('react');

  return {
    useFocusEffect: (callback: FocusEffect) => {
      React.useEffect(() => {
        mockFocusController.callback = callback;
        const cleanup = mockFocusController.focused ? callback() : undefined;
        mockFocusController.cleanup = cleanup ?? null;
        return () => {
          if (mockFocusController.callback === callback) {
            mockFocusController.cleanup?.();
            mockFocusController.cleanup = null;
          } else {
            cleanup?.();
          }
        };
      }, [callback]);
    },
  };
});

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/components/ds/patterns/PlanPickerModal', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const { Pressable } = jest.requireActual<typeof ReactNativeModule>('react-native');
  return {
    PlanPickerModal: ({
      isVisible,
      onSelect,
    }: {
      isVisible: boolean;
      onSelect: (planId: string) => void;
    }) =>
      isVisible
        ? React.createElement(Pressable, {
            onPress: () => onSelect('plan-1'),
            testID: 'pro.students.test.planSelect',
          })
        : null,
  };
});

jest.mock('@/components/ds/primitives/DsCard', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const { View } = jest.requireActual<typeof ReactNativeModule>('react-native');
  return {
    DsCard: ({ children, testID }: { children?: ReactModule.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children),
  };
});

jest.mock('@/components/ds/primitives/DsOfflineBanner', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const { View } = jest.requireActual<typeof ReactNativeModule>('react-native');
  return {
    DsOfflineBanner: ({ testID }: { testID?: string }) => React.createElement(View, { testID }),
  };
});

jest.mock('@/components/ds/primitives/DsPillButton', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const { Pressable, Text } = jest.requireActual<typeof ReactNativeModule>('react-native');
  return {
    DsPillButton: ({
      disabled,
      label,
      onPress,
      testID,
    }: {
      disabled?: boolean;
      label: string;
      onPress: () => void;
      testID?: string;
    }) =>
      React.createElement(
        Pressable,
        { disabled, onPress, testID },
        React.createElement(Text, null, label),
      ),
  };
});

jest.mock('@/components/ds/primitives/DsScreen', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const { View } = jest.requireActual<typeof ReactNativeModule>('react-native');
  return {
    DsScreen: ({ children, testID }: { children?: ReactModule.ReactNode; testID?: string }) =>
      React.createElement(View, { testID }, children),
  };
});

jest.mock('@/features/auth/auth-session', () => ({
  useAuthSession: () => ({ currentUser: mockCurrentUser }),
}));
jest.mock('@/features/offline/use-network-status', () => ({
  useNetworkStatus: () => 'online',
}));
jest.mock('@/features/plans/use-plans', () => ({
  usePlans: () => ({
    bulkAssign: mockBulkAssign,
    state: {
      kind: 'ready',
      lastSyncedAtIso: '2026-10-01T00:00:00.000Z',
      plans: [],
      predefinedPlans: [],
    },
  }),
}));
jest.mock('@/features/platform/share-adapter', () => ({
  shareAdapter: { shareText: jest.fn() },
}));
jest.mock('@/features/professional/professional-source', () => ({
  getProfessionalStudentRoster: jest.fn(),
}));
jest.mock('@/features/professional/use-professional', () => ({
  useInviteCode: () => ({ state: { kind: 'idle' } }),
  useSpecialties: () => ({ state: { kind: 'ready', lastSyncedAtIso: null, specialties: [] } }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

const readRoster = jest.mocked(getProfessionalStudentRoster);

const existingActive: ProfessionalStudentRosterItem = {
  studentAuthUid: 'existing-active',
  displayName: 'Existing active',
  specialty: 'fitness_coach',
  assignmentStatus: 'active',
  nutritionStatus: 'none',
  trainingStatus: 'active',
};
const confirmedTarget: ProfessionalStudentRosterItem = {
  studentAuthUid: 'confirmed-target',
  displayName: 'Confirmed target',
  specialty: 'fitness_coach',
  assignmentStatus: 'active',
  nutritionStatus: 'none',
  trainingStatus: 'active',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe('professional roster focus refresh (SC-205/TC-206/TC-214)', () => {
  beforeEach(() => {
    mockFocusController.reset();
    mockCurrentUser.uid = 'professional-1';
    mockBulkAssign.mockReset();
    readRoster.mockReset();
  });

  afterEach(() => {
    mockFocusController.reset();
  });

  test('reads the current roster on return and ignores the older focused request', async () => {
    const first = deferred<ProfessionalStudentRosterItem[]>();
    const second = deferred<ProfessionalStudentRosterItem[]>();
    readRoster.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const rendered = await render(<ProfessionalStudentsScreen />);
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(1));

    await act(() => mockFocusController.blur());
    await act(() => mockFocusController.focus());
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(2));

    await act(() => second.resolve([existingActive, confirmedTarget]));
    expect(await screen.findByTestId('pro.students.row.confirmed-target')).toBeOnTheScreen();

    await act(() => first.resolve([existingActive]));
    expect(screen.getByTestId('pro.students.row.confirmed-target')).toBeOnTheScreen();

    await rendered.unmount();
  });

  test('does not let an older rejection clear a newer request or its loading state', async () => {
    const first = deferred<ProfessionalStudentRosterItem[]>();
    const second = deferred<ProfessionalStudentRosterItem[]>();
    readRoster.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const rendered = await render(<ProfessionalStudentsScreen />);
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(1));
    await act(() => mockFocusController.blur());
    await act(() => mockFocusController.focus());
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(2));

    await act(() => first.reject(new Error('superseded roster read')));
    expect(screen.getByTestId('pro.students.loading')).toBeOnTheScreen();

    await act(() => second.resolve([confirmedTarget]));
    expect(await screen.findByTestId('pro.students.row.confirmed-target')).toBeOnTheScreen();

    await rendered.unmount();
  });

  test('preserves the active filter while a focused return refreshes the roster', async () => {
    const first = deferred<ProfessionalStudentRosterItem[]>();
    const second = deferred<ProfessionalStudentRosterItem[]>();
    readRoster.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const rendered = await render(<ProfessionalStudentsScreen />);
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(1));
    await fireEvent.press(screen.getByTestId('pro.students.filter.active'));

    await act(() => mockFocusController.blur());
    await act(() => first.resolve([existingActive]));
    expect(screen.queryByTestId('pro.students.row.existing-active')).toBeNull();

    await act(() => mockFocusController.focus());
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(2));
    await act(() => second.resolve([existingActive, confirmedTarget]));

    expect(screen.getByTestId('pro.students.filter.active').props.accessibilityState).toMatchObject(
      {
        selected: true,
      },
    );
    expect(await screen.findByTestId('pro.students.row.confirmed-target')).toBeOnTheScreen();

    await rendered.unmount();
  });

  test('ignores a bulk completion from the blurred identity and clears its stale spinner on return', async () => {
    const assignment = deferred<{ assignedCount: number }>();
    const currentRoster = deferred<ProfessionalStudentRosterItem[]>();
    readRoster.mockResolvedValueOnce([existingActive]);
    mockBulkAssign.mockReturnValueOnce(assignment.promise);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const rendered = await render(<ProfessionalStudentsScreen />);
    expect(await screen.findByTestId('pro.students.row.existing-active')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('pro.students.bulkAssignToggle'));
    await fireEvent.press(screen.getByTestId('pro.students.bulk.planType.training'));
    await fireEvent.press(screen.getByTestId('pro.students.row.existing-active'));
    await fireEvent.press(screen.getByTestId('pro.students.bulk.assignSelected'));
    await fireEvent.press(screen.getByTestId('pro.students.test.planSelect'));
    await waitFor(() => expect(mockBulkAssign).toHaveBeenCalledTimes(1));

    await act(() => mockFocusController.blur());
    mockCurrentUser.uid = 'professional-2';
    await rendered.rerender(<ProfessionalStudentsScreen />);

    readRoster.mockReturnValueOnce(currentRoster.promise);
    await act(() => mockFocusController.focus());
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(2));

    await act(() => assignment.resolve({ assignedCount: 1 }));
    expect(readRoster).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('pro.students.bulk.assignSelected')).toBeOnTheScreen();
    expect(screen.getByTestId('pro.students.loading')).toBeOnTheScreen();
    expect(alert).not.toHaveBeenCalled();

    await act(() => currentRoster.resolve([confirmedTarget]));
    expect(await screen.findByTestId('pro.students.row.confirmed-target')).toBeOnTheScreen();
    expect(screen.queryByTestId('pro.students.loading')).toBeNull();

    alert.mockRestore();
    await rendered.unmount();
  });

  test('reports a bulk completion and clears the selection when the same coach refocused meanwhile', async () => {
    const assignment = deferred<{ assignedCount: number }>();
    readRoster.mockResolvedValue([existingActive]);
    mockBulkAssign.mockReturnValueOnce(assignment.promise);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const rendered = await render(<ProfessionalStudentsScreen />);
    expect(await screen.findByTestId('pro.students.row.existing-active')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('pro.students.bulkAssignToggle'));
    await fireEvent.press(screen.getByTestId('pro.students.bulk.planType.training'));
    await fireEvent.press(screen.getByTestId('pro.students.row.existing-active'));
    await fireEvent.press(screen.getByTestId('pro.students.bulk.assignSelected'));
    await fireEvent.press(screen.getByTestId('pro.students.test.planSelect'));
    await waitFor(() => expect(mockBulkAssign).toHaveBeenCalledTimes(1));

    await act(() => mockFocusController.blur());
    await act(() => mockFocusController.focus());
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(2));

    await act(() => assignment.resolve({ assignedCount: 1 }));
    expect(alert).toHaveBeenCalledWith(enUS['pro.plan.assign.success']);
    // Selection mode ended, so the same students cannot be assigned again.
    expect(screen.queryByTestId('pro.students.bulk.assignSelected')).toBeNull();
    // The refocus already reloaded the roster; the completion does not repeat it.
    expect(readRoster).toHaveBeenCalledTimes(2);

    alert.mockRestore();
    await rendered.unmount();
  });

  test('does not start or publish a retry after blur, then resumes on focus', async () => {
    readRoster.mockRejectedValueOnce(new Error('temporary roster failure'));
    const rendered = await render(<ProfessionalStudentsScreen />);
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('pro.students.retry')).toBeOnTheScreen());

    await act(() => mockFocusController.blur());
    await fireEvent.press(screen.getByTestId('pro.students.retry'));
    expect(readRoster).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('pro.students.error')).toBeOnTheScreen();

    readRoster.mockResolvedValueOnce([confirmedTarget]);
    await act(() => mockFocusController.focus());
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('pro.students.row.confirmed-target')).toBeOnTheScreen();

    await rendered.unmount();
  });

  test('ignores a response from the previous authenticated identity', async () => {
    const previousIdentity = deferred<ProfessionalStudentRosterItem[]>();
    const currentIdentity = deferred<ProfessionalStudentRosterItem[]>();
    readRoster
      .mockReturnValueOnce(previousIdentity.promise)
      .mockReturnValueOnce(currentIdentity.promise);

    const rendered = await render(<ProfessionalStudentsScreen />);
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(1));

    mockCurrentUser.uid = 'professional-2';
    await rendered.rerender(<ProfessionalStudentsScreen />);
    await waitFor(() => expect(readRoster).toHaveBeenCalledTimes(2));

    await act(() => currentIdentity.resolve([confirmedTarget]));
    expect(await screen.findByTestId('pro.students.row.confirmed-target')).toBeOnTheScreen();

    await act(() => previousIdentity.resolve([existingActive]));
    expect(screen.getByTestId('pro.students.row.confirmed-target')).toBeOnTheScreen();

    await rendered.unmount();
  });
});
