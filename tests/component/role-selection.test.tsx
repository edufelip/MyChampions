import { act, render, screen, userEvent, waitFor } from '@testing-library/react-native';
import RoleSelectionScreen from '@/app/auth/role-selection';
import { SUPPORTED_LOCALES, t } from '@/localization/core';
import { setComponentLocale } from './setup';

const mockReplace = jest.fn();
const mockLockRole = jest.fn();
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ replace: mockReplace }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/features/auth/auth-session', () => ({
  useAuthSession: () => ({
    isHydrated: true,
    currentUser: { uid: 'role-user' },
    lockRole: mockLockRole,
    beginRoleSelectionNavigation: jest.fn(),
    completeRoleSelectionNavigation: jest.fn(),
  }),
}));
jest.mock('@/features/analytics/use-analytics', () => ({
  useAnalytics: () => ({ emitEvent: jest.fn() }),
}));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));

describe.each(SUPPORTED_LOCALES)('role selection: %s (TC-249/TC-201/TC-202)', (locale) => {
  beforeEach(() => {
    jest.useFakeTimers();
    setComponentLocale(locale);
    mockLockRole.mockReset().mockResolvedValue(undefined);
    mockReplace.mockReset();
  });
  afterEach(async () => {
    await act(() => {
      jest.runOnlyPendingTimers();
    });
  });
  test.each([
    ['student', 'auth.roleSelection.studentCard', '/'],
    ['professional', 'auth.roleSelection.professionalCard', '/professional/specialty'],
  ] as const)(
    'Continue stays disabled until selecting %s, then persists only that role',
    async (role, card, route) => {
      const user = userEvent.setup();
      await render(<RoleSelectionScreen />);
      const button = screen.getByTestId('auth.roleSelection.continueButton');
      expect(screen.getByTestId('auth.roleSelection.continueButton.label')).toHaveTextContent(
        t(locale, 'auth.role.cta_continue'),
      );
      expect(button).toBeDisabled();
      await user.press(button);
      expect(mockLockRole).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
      await user.press(screen.getByTestId(card));
      expect(screen.getByTestId('auth.roleSelection.continueButton')).toBeEnabled();
      await user.press(screen.getByTestId('auth.roleSelection.continueButton'));
      await waitFor(() => expect(mockReplace).toHaveBeenCalledWith(route));
      expect(mockLockRole).toHaveBeenCalledTimes(1);
      expect(mockLockRole).toHaveBeenCalledWith(role);
    },
  );
});
