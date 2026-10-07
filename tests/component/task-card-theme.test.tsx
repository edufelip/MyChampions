import { render, screen, userEvent } from '@testing-library/react-native';
import { TaskCard } from '@/app/professional/home';
import { getDsTheme } from '@/constants/design-system';

// Native/provider adapter boundaries loaded by the home module. TaskCard's
// rendering, theme selection and Pressable behavior remain real.
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: jest.fn() }));
jest.mock('@/features/analytics/use-analytics', () => ({ useAnalytics: jest.fn() }));
jest.mock('@/features/auth/auth-session', () => ({ useAuthSession: jest.fn() }));
jest.mock('@/features/connections/use-connections', () => ({ useConnections: jest.fn() }));
jest.mock('@/features/plans/plan-source', () => ({ getProfessionalPlanChangeRequests: jest.fn() }));
jest.mock('@/features/platform/share-adapter', () => ({ shareAdapter: jest.fn() }));
jest.mock('@/features/professional/use-professional', () => ({
  useInviteCode: jest.fn(),
  useSpecialties: jest.fn(),
}));
jest.mock('@/features/subscription/use-subscription', () => ({ useSubscription: jest.fn() }));

describe.each(['light', 'dark'] as const)('TaskCard rendered theme: %s (TC-001)', (scheme) => {
  test('uses the real accent foreground and invokes the supplied action', async () => {
    const onPress = jest.fn();
    await render(
      <TaskCard
        body="Synthetic body"
        compact={false}
        cta="Synthetic action"
        iconName="assignment"
        onPress={onPress}
        scheme={scheme}
        testID="task-card"
        title="Synthetic title"
      />,
    );
    expect(
      screen.getByTestId('material-icon.assignment', { includeHiddenElements: true }),
    ).toHaveStyle({
      color: getDsTheme(scheme).color.onAccent,
    });
    expect(screen.getByTestId('task-card')).toHaveStyle({
      backgroundColor: getDsTheme(scheme).color.accentPrimarySoft,
      borderColor: getDsTheme(scheme).color.accentPrimary,
    });
    await userEvent.setup().press(screen.getByTestId('task-card'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
