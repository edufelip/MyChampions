import { act, fireEvent, render, screen, userEvent } from '@testing-library/react-native';
import { useCallback } from 'react';
import { View } from 'react-native';
import { ExerciseSearchModal } from '@/components/ds/patterns/ExerciseSearchModal';
import { DsSpace, getDsTheme } from '@/constants/design-system';
import {
  searchExerciseLibrary,
  type ExerciseItem,
  type ExerciseSearchResult,
} from '@/features/plans/exercise-service-source';
import { useExerciseSearch } from '@/features/plans/use-exercise-search';
import { SUPPORTED_LOCALES, t } from '@/localization/core';
import { hideKeyboard, measureHostViewsAs, showKeyboard } from './keyboard-test-utils';

jest.mock('@/features/plans/exercise-service-source', () => ({ searchExerciseLibrary: jest.fn() }));
const transport = jest.mocked(searchExerciseLibrary);
const exercise: ExerciseItem = {
  id: 'exercise-1',
  slug: 'squat',
  title: 'Synthetic squat',
  muscleGroup: 'quads',
  equipment: 'none',
  hasVideo: false,
  hasVideoWhite: false,
  hasVideoGym: false,
};
const result = (exercises: ExerciseItem[]): ExerciseSearchResult => ({
  page: 1,
  pageSize: 20,
  total: exercises.length,
  exercises,
});

describe.each(SUPPORTED_LOCALES)(
  'exercise search rendered behavior: %s (SC-208/TC-332)',
  (locale) => {
    const confirm = jest.fn();
    const close = jest.fn();
    function Harness({
      scheme = 'light',
      visible = true,
    }: {
      scheme?: 'light' | 'dark';
      visible?: boolean;
    }) {
      const { state, search, clear } = useExerciseSearch();
      const onSearch = useCallback(
        (query: string) => {
          void search(query);
        },
        [search],
      );
      return (
        <ExerciseSearchModal
          isVisible={visible}
          onClose={close}
          onConfirm={confirm}
          searchState={state}
          onSearch={onSearch}
          onClear={clear}
          scheme={scheme}
          theme={getDsTheme(scheme)}
          t={(key, params) => t(locale, key, params)}
        />
      );
    }
    beforeEach(() => {
      jest.useFakeTimers();
      transport.mockReset();
      confirm.mockReset();
      close.mockReset();
    });
    async function query(text = 'squat') {
      await fireEvent.changeText(screen.getByTestId('exerciseSearch.input'), text);
      await act(() => {
        jest.advanceTimersByTime(400);
      });
    }
    test('debounced search shows loading then empty; mounted query survives a supported rerender', async () => {
      let resolve!: (value: ExerciseSearchResult) => void;
      transport.mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const rendered = await render(<Harness />);
      expect(screen.getByTestId('exerciseSearch.initialState')).toBeOnTheScreen();
      await fireEvent.changeText(screen.getByTestId('exerciseSearch.input'), 'squat');
      await act(() => {
        jest.advanceTimersByTime(399);
      });
      expect(transport).not.toHaveBeenCalled();
      await act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(screen.getByTestId('exerciseSearch.loadingState')).toBeOnTheScreen();
      await act(() => {
        resolve(result([]));
      });
      expect(screen.getByTestId('exerciseSearch.emptyState')).toHaveTextContent(
        t(locale, 'pro.plan.item.search.empty'),
      );
      await rendered.rerender(<Harness scheme="dark" />);
      expect(screen.getByTestId('exerciseSearch.input')).toHaveDisplayValue('squat');
      expect(screen.getByTestId('exerciseSearch.emptyState')).toBeOnTheScreen();
      expect(transport).toHaveBeenCalledTimes(1);
    });
    test('transport rejection displays an error and retry searches the same query', async () => {
      transport
        .mockRejectedValueOnce(new Error('Synthetic search failure'))
        .mockResolvedValueOnce(result([exercise]));
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      await render(<Harness />);
      await query();
      expect(screen.getByTestId('exerciseSearch.errorState')).toBeOnTheScreen();
      expect(screen.getByTestId('exerciseSearch.input')).toHaveDisplayValue('squat');
      expect(error).toHaveBeenCalledWith(
        '[useExerciseSearch] Search failed:',
        expect.objectContaining({ query: 'squat', message: 'Synthetic search failure' }),
      );
      error.mockRestore();
      await userEvent.setup().press(screen.getByTestId('exerciseSearch.retry'));
      expect(screen.getByRole('button', { name: exercise.title })).toBeOnTheScreen();
      expect(transport.mock.calls).toEqual([['squat'], ['squat']]);
    });
    test('selection opens details; confirmation sends exact identity and trimmed fields; close resets search', async () => {
      transport.mockResolvedValue(result([exercise]));
      const rendered = await render(<Harness />);
      const user = userEvent.setup();
      await query();
      await user.press(screen.getByRole('button', { name: exercise.title }));
      expect(screen.getByTestId('exerciseSearch.detail')).toHaveTextContent(exercise.title);
      await fireEvent.changeText(
        screen.getByLabelText(t(locale, 'pro.plan.item.field.quantity.label')),
        '  3 x 10  ',
      );
      await fireEvent.changeText(
        screen.getByLabelText(t(locale, 'pro.plan.item.field.notes.label')),
        '  Controlled tempo  ',
      );
      await user.press(screen.getByTestId('exerciseSearch.confirm'));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm).toHaveBeenCalledWith(exercise, '3 x 10', 'Controlled tempo');
      await user.press(screen.getByRole('button', { name: t(locale, 'common.cta.close') }));
      expect(close).toHaveBeenCalledTimes(1);
      await rendered.rerender(<Harness visible={false} />);
      await rendered.rerender(<Harness />);
      expect(screen.getByTestId('exerciseSearch.input')).toHaveDisplayValue('');
      expect(screen.getByTestId('exerciseSearch.initialState')).toBeOnTheScreen();
      expect(screen.queryByTestId('exerciseSearch.detail')).not.toBeOnTheScreen();
    });
  },
);

describe('exercise search keyboard avoidance (SC-208)', () => {
  test('keeps the title and the focused search box between the top safe area and the keyboard', async () => {
    measureHostViewsAs(View, 0, 844);
    await render(
      <ExerciseSearchModal
        isVisible
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        searchState={{ kind: 'idle' }}
        onSearch={jest.fn()}
        onClear={jest.fn()}
        scheme="light"
        theme={getDsTheme('light')}
        t={(key, params) => t('en-US', key, params)}
      />,
    );
    const frame = screen.getByTestId('exerciseSearch.keyboardFrame');
    await fireEvent(frame, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } },
    });
    expect(screen.getByTestId('exerciseSearch.modal')).toHaveStyle({ minHeight: '75%' });

    await showKeyboard(500, 344);
    expect(frame).toHaveStyle({ paddingBottom: 344 });
    // The sheet's 75% minimum no longer pushes its header off the top: it is
    // capped to the space above the keyboard and the result list shrinks.
    const available = 844 - 344 - DsSpace.sm;
    expect(screen.getByTestId('exerciseSearch.modal')).toHaveStyle({
      minHeight: available,
      maxHeight: available,
    });
    expect(screen.getByTestId('exerciseSearch.title')).toBeOnTheScreen();
    expect(screen.getByTestId('exerciseSearch.input')).toBeOnTheScreen();

    await hideKeyboard();
    expect(frame).not.toHaveStyle({ paddingBottom: 344 });
    expect(screen.getByTestId('exerciseSearch.modal')).toHaveStyle({ minHeight: '75%' });
  });
});
