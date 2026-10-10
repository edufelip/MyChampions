import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import NutritionPlanBuilderScreen from '@/app/professional/nutrition/plans/[planId]';
import TrainingPlanBuilderScreen from '@/app/professional/training/plans/[planId]';
import { SUPPORTED_LOCALES, t } from '@/localization/core';
import { setComponentLocale } from './setup';
import type * as ReactModule from 'react';
import type * as ReactNativeModule from 'react-native';

// SC-207/SC-208: removing one part of a plan confirms that part by name, never
// with the whole-plan delete copy (pro.plan.delete.body).

let mockPathname = '/professional/training/plans/plan-1';
const mockRouter = { back: jest.fn(), canGoBack: () => true, push: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({
  Redirect: () => null,
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ planId: 'plan-1' }),
  usePathname: () => mockPathname,
  useRouter: () => mockRouter,
}));
jest.mock('@react-navigation/native', () => {
  const navigation = { addListener: () => () => undefined, dispatch: jest.fn() };
  return { useNavigation: () => navigation };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual<Record<string, unknown>>(
    '@react-native-async-storage/async-storage/jest/async-storage-mock',
  ),
);
jest.mock('react-native-reanimated', () =>
  jest.requireActual<Record<string, unknown>>('react-native-reanimated/mock'),
);
jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  return {
    SafeAreaInsetsContext: React.createContext(null),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('@/components/ui/icon-symbol', () => {
  const React = jest.requireActual<typeof ReactModule>('react');
  const { Text } = jest.requireActual<typeof ReactNativeModule>('react-native');
  return { IconSymbol: ({ name }: { name: string }) => React.createElement(Text, null, name) };
});
jest.mock('@/features/auth/auth-session', () => {
  const session = { currentUser: { uid: 'pro-1' }, lockedRole: 'professional' };
  return { useAuthSession: () => session };
});
jest.mock('@/hooks/use-persistent-guidance', () => {
  const guidance = [false, jest.fn()];
  return { usePersistentGuidance: () => guidance };
});
jest.mock('@/features/plans/use-plans', () => {
  const plans = {
    createDraftAssignedPlan: jest.fn(),
    submitChangeRequest: jest.fn(),
    validateChangeRequest: jest.fn(() => null),
  };
  return { usePlans: () => plans };
});
jest.mock('@/features/plans/use-exercise-search', () => {
  const search = { state: { kind: 'idle' }, search: jest.fn(), clear: jest.fn() };
  return { useExerciseSearch: () => search };
});
jest.mock('@/features/professional/professional-source', () => ({
  getProfessionalStudentRoster: jest.fn(() => Promise.resolve([])),
}));
jest.mock('@/features/professional/use-professional', () => {
  const specialties = {
    state: { kind: 'ready', specialties: [{ specialty: 'nutritionist', isActive: true }] },
  };
  return { useSpecialties: () => specialties };
});
jest.mock('@/features/plans/use-plan-builder', () => {
  // Stable results: the screens key effects on these object identities.
  const builder = {
    loadPlan: jest.fn(),
    initNewPlan: jest.fn(),
    validateInput: () => ({}),
    deletePlan: jest.fn(),
  };
  const training = {
    ...builder,
    savePlanWithSessions: jest.fn(),
    state: {
      kind: 'ready',
      plan: {
        id: 'plan-1',
        name: 'Strength',
        isDraft: false,
        sourceKind: 'predefined',
        sessions: [
          {
            id: 'session-1',
            name: 'Push Day',
            notes: '',
            items: [{ id: 'item-1', name: 'E2E Push-Up', quantity: '3 x 10', notes: '' }],
          },
        ],
      },
    },
  };
  const nutrition = {
    ...builder,
    createPlan: jest.fn(),
    savePlan: jest.fn(),
    addMeal: jest.fn(),
    removeMeal: jest.fn(),
    reorderMeals: jest.fn(),
    state: {
      kind: 'ready',
      plan: {
        id: 'plan-1',
        name: 'Cut',
        isDraft: false,
        sourceKind: 'predefined',
        hydrationGoalMl: 2200,
        caloriesTarget: 0,
        carbsTarget: 0,
        proteinsTarget: 0,
        fatsTarget: 0,
        meals: [{ id: 'meal-1', name: 'Breakfast', items: [] }],
      },
    },
  };
  return {
    useTrainingPlanBuilder: () => training,
    useNutritionPlanBuilder: () => nutrition,
  };
});

describe.each(SUPPORTED_LOCALES)('plan builder removal confirmations: %s', (locale) => {
  beforeEach(() => {
    setComponentLocale(locale);
  });

  function alertBody(alert: jest.SpyInstance) {
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, body] = alert.mock.calls[0] as [string, string];
    expect(title).toBe(t(locale, 'common.cta.delete'));
    expect(body).not.toBe(t(locale, 'pro.plan.delete.body'));
    expect(body).not.toContain('{name}');
    return body;
  }

  test('removing one exercise names the exercise and its session', async () => {
    mockPathname = '/professional/training/plans/plan-1';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<TrainingPlanBuilderScreen />);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('pro.training_plan.itemRow.E2E_Push-Up.remove'));
    });
    expect(alertBody(alert)).toBe(
      t(locale, 'pro.plan.session_item.delete.body', { name: 'E2E Push-Up' }),
    );
  });

  test('removing a session names the session, not the whole plan', async () => {
    mockPathname = '/professional/training/plans/plan-1';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<TrainingPlanBuilderScreen />);
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Remove session Push Day'));
    });
    expect(alertBody(alert)).toBe(t(locale, 'pro.plan.session.delete.body', { name: 'Push Day' }));
  });

  test('removing a meal names the meal, not the whole plan', async () => {
    mockPathname = '/professional/nutrition/plans/plan-1';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await render(<NutritionPlanBuilderScreen />);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('pro.nutrition_plan.mealRow.Breakfast.remove'));
    });
    expect(alertBody(alert)).toBe(t(locale, 'pro.plan.meal.delete.body', { name: 'Breakfast' }));
  });
});

describe('plan builder inline forms opt into keyboard avoidance', () => {
  test('the training builder lets taps reach the add-session form while the keyboard is open', async () => {
    mockPathname = '/professional/training/plans/plan-1';
    await render(<TrainingPlanBuilderScreen />);
    expect(screen.getByTestId('pro.training_plan.screen')).toHaveProp(
      'keyboardShouldPersistTaps',
      'handled',
    );
    await act(async () => {
      await fireEvent.press(screen.getByTestId('pro.training_plan.addSession'));
    });
    expect(screen.getByTestId('pro.training_plan.addSession.form')).toBeOnTheScreen();
    expect(screen.getByTestId('pro.training_plan.addSession.confirm')).toBeOnTheScreen();
  });

  test('the nutrition builder lets taps reach the add-meal form while the keyboard is open', async () => {
    mockPathname = '/professional/nutrition/plans/plan-1';
    await render(<NutritionPlanBuilderScreen />);
    expect(screen.getByTestId('pro.nutrition_plan.screen')).toHaveProp(
      'keyboardShouldPersistTaps',
      'handled',
    );
    await act(async () => {
      await fireEvent.press(screen.getByTestId('pro.nutrition_plan.addMeal'));
    });
    expect(screen.getByTestId('pro.nutrition_plan.addMeal.form')).toBeOnTheScreen();
    expect(screen.getByTestId('pro.nutrition_plan.addMeal.confirm')).toBeOnTheScreen();
  });
});
