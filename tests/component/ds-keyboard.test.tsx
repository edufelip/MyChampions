import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useRef, type RefObject } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { DsScreen } from '@/components/ds/primitives/DsScreen';
import {
  computeKeyboardOverlap,
  computeKeyboardSheetBounds,
  computeRevealScrollDelta,
  toDsKeyboardFrame,
  useDsKeyboardAwareScroll,
  useDsKeyboardOverlap,
  useDsKeyboardTarget,
} from '@/components/ds/primitives/useDsKeyboard';
import { DsSpace } from '@/constants/design-system';
import { hideKeyboard, measureHostViewsAs, showKeyboard } from './keyboard-test-utils';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));

describe('keyboard geometry', () => {
  test('a keyboard frame needs a height and falls back to the window bottom for its top', () => {
    expect(toDsKeyboardFrame(null)).toBeNull();
    expect(toDsKeyboardFrame({ screenY: 844, height: 0 })).toBeNull();
    expect(toDsKeyboardFrame({ screenY: 500, height: 344 })).toEqual({ top: 500, height: 344 });
    expect(toDsKeyboardFrame({ screenY: 0, height: 300 }, 844)).toEqual({ top: 544, height: 300 });
  });

  test('overlap is the part of a view below the keyboard top', () => {
    const keyboard = { top: 500, height: 344 };
    expect(computeKeyboardOverlap(844, null)).toBe(0);
    expect(computeKeyboardOverlap(844, keyboard)).toBe(344);
    expect(computeKeyboardOverlap(760, keyboard)).toBe(260);
    expect(computeKeyboardOverlap(480, keyboard)).toBe(0);
    // An unmeasured view is assumed to reach the bottom of the screen.
    expect(computeKeyboardOverlap(0, keyboard)).toBe(344);
  });

  test('reveal scrolls only as far as needed and keeps a tall target top visible', () => {
    const visible = { visibleTop: 100, visibleBottom: 500 };
    expect(computeRevealScrollDelta({ top: 200, bottom: 300, ...visible })).toBe(0);
    expect(computeRevealScrollDelta({ top: 520, bottom: 640, ...visible })).toBe(140);
    expect(computeRevealScrollDelta({ top: 40, bottom: 90, ...visible })).toBe(-60);
    expect(computeRevealScrollDelta({ top: 300, bottom: 900, ...visible })).toBe(200);
  });

  test('a sheet is capped between the top safe area and the keyboard only while it is open', () => {
    const sheet = { containerHeight: 844, topInset: 47, preferredMinHeight: 633 };
    expect(computeKeyboardSheetBounds({ ...sheet, overlap: 0 })).toBeNull();
    // 844 - 344 - 47, less a small gap below the safe area.
    const available = 844 - 344 - 47 - DsSpace.sm;
    expect(computeKeyboardSheetBounds({ ...sheet, overlap: 344 })).toEqual({
      minHeight: available,
      maxHeight: available,
    });
    expect(computeKeyboardSheetBounds({ ...sheet, overlap: 100, preferredMinHeight: 200 })).toEqual(
      { minHeight: 200, maxHeight: 844 - 100 - 47 - DsSpace.sm },
    );
  });
});

describe('useDsKeyboardOverlap', () => {
  function Panel({ enabled = true }: { enabled?: boolean }) {
    const ref = useRef<View>(null);
    const overlap = useDsKeyboardOverlap(ref, enabled);
    return (
      <View ref={ref} testID="overlay" style={{ paddingBottom: overlap }}>
        <Text>Panel</Text>
      </View>
    );
  }

  test('pads a bottom panel by the measured overlap and clears it when the keyboard hides', async () => {
    measureHostViewsAs(View, 100, 700);
    await render(<Panel />);
    expect(screen.getByTestId('overlay')).toHaveStyle({ paddingBottom: 0 });
    await showKeyboard(500, 344);
    expect(screen.getByTestId('overlay')).toHaveStyle({ paddingBottom: 300 });
    await hideKeyboard();
    expect(screen.getByTestId('overlay')).toHaveStyle({ paddingBottom: 0 });
  });

  test('stays at zero while disabled', async () => {
    measureHostViewsAs(View, 0, 844);
    await render(<Panel enabled={false} />);
    await showKeyboard(500, 344);
    expect(screen.getByTestId('overlay')).toHaveStyle({ paddingBottom: 0 });
  });
});

describe('DsScreen keyboardAware', () => {
  test('is opt-in: a default screen keeps its scroll props and never adds keyboard space', async () => {
    measureHostViewsAs(ScrollView, 0, 844);
    await render(
      <DsScreen scheme="light" testID="screen">
        <Text>Content</Text>
      </DsScreen>,
    );
    expect(screen.getByTestId('screen')).not.toHaveProp('keyboardShouldPersistTaps');
    await showKeyboard(500, 344);
    expect(screen.queryByTestId('screen.keyboardSpacer')).toBeNull();
  });

  test('adds the covered height as bottom space while the keyboard is open', async () => {
    measureHostViewsAs(ScrollView, 0, 844);
    await render(
      <DsScreen scheme="light" keyboardAware testID="screen">
        <Text>Content</Text>
      </DsScreen>,
    );
    // Buttons such as Add or Cancel receive taps while the keyboard is open.
    expect(screen.getByTestId('screen')).toHaveProp('keyboardShouldPersistTaps', 'handled');
    expect(screen.queryByTestId('screen.keyboardSpacer')).toBeNull();
    await showKeyboard(500, 344);
    expect(screen.getByTestId('screen.keyboardSpacer')).toHaveStyle({ height: 344 });
    await hideKeyboard();
    expect(screen.queryByTestId('screen.keyboardSpacer')).toBeNull();
  });

  test('keeps a screen-chosen tap behavior', async () => {
    await render(
      <DsScreen scheme="light" keyboardAware keyboardShouldPersistTaps="always" testID="screen">
        <Text>Content</Text>
      </DsScreen>,
    );
    expect(screen.getByTestId('screen')).toHaveProp('keyboardShouldPersistTaps', 'always');
  });
});

describe('keyboard-aware screen reveal', () => {
  // The hook DsScreen uses, with its content view attached (the jest
  // ScrollView mock does not forward `innerViewRef`).
  const refs: {
    content?: RefObject<View | null>;
    sheet?: RefObject<View | null>;
  } = {};

  function Sheet() {
    const ref = useRef<View>(null);
    refs.sheet = ref;
    useDsKeyboardOverlap(ref);
    return <View ref={ref} testID="sheet" />;
  }

  // An inline form registered as a keyboard target, measuring `top` within the
  // screen content.
  function FormTarget({ top }: { top: number }) {
    const register = useDsKeyboardTarget();
    useEffect(() => {
      register({
        measureLayout: (
          relativeTo: unknown,
          onSuccess: (x: number, y: number, width: number, height: number) => void,
          onFail: () => void,
        ) => {
          if (relativeTo === refs.content?.current) onSuccess(0, top, 390, 120);
          else onFail();
        },
      });
      return () => register(null);
    }, [register, top]);
    return null;
  }

  function Screen({ withSheet, withForm = false }: { withSheet: boolean; withForm?: boolean }) {
    const keyboard = useDsKeyboardAwareScroll({ enabled: true, mode: 'spacer' });
    const { innerViewRef, ...scrollViewProps } = keyboard.scrollViewProps as {
      innerViewRef: RefObject<View | null>;
    };
    refs.content = innerViewRef;
    return (
      <>
        <ScrollView ref={keyboard.scrollRef} {...scrollViewProps}>
          <View ref={innerViewRef}>
            <Text>Plan</Text>
          </View>
          {keyboard.spacerHeight > 0 ? (
            <View
              style={{ height: keyboard.spacerHeight }}
              onLayout={keyboard.onSpacerLayout}
              testID="spacer"
            />
          ) : null}
        </ScrollView>
        {/* Rendered inside the screen, like ExerciseSearchModal in SC-208. */}
        {withSheet ? <Sheet /> : null}
        {withForm ? <FormTarget top={900} /> : null}
      </>
    );
  }

  // A focused input that measures `top` within the screen content. Like the
  // New Architecture, an input inside a modal still measures against the
  // screen content (from the modal root) instead of failing.
  function focusInput(top: number, { inSheet }: { inSheet: boolean }) {
    const input = {
      measureLayout: (
        relativeTo: unknown,
        onSuccess: (x: number, y: number, width: number, height: number) => void,
        onFail: () => void,
      ) => {
        if (relativeTo === refs.content?.current) onSuccess(0, top, 390, 40);
        else if (inSheet && relativeTo === refs.sheet?.current) onSuccess(0, top, 390, 40);
        else onFail();
      },
    };
    jest
      .spyOn(TextInput.State, 'currentlyFocusedInput')
      .mockReturnValue(
        input as unknown as ReturnType<typeof TextInput.State.currentlyFocusedInput>,
      );
  }

  async function openKeyboard() {
    await showKeyboard(500, 344);
    await fireEvent(screen.getByTestId('spacer'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 344 } },
    });
  }

  test('scrolls a screen input that the keyboard covers into view, even with a sheet open', async () => {
    measureHostViewsAs(ScrollView, 0, 844);
    measureHostViewsAs(View, 0, 844);
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    await render(<Screen withSheet />);
    focusInput(900, { inSheet: false });
    await openKeyboard();
    // Visible range: 16 below the top to 16 above the keyboard (844 - 344).
    expect(scrollTo).toHaveBeenCalledWith({ y: 900 + 40 - (844 - 344 - 16), animated: true });
  });

  test('leaves the screen behind an open sheet where it was while the sheet input is focused', async () => {
    measureHostViewsAs(ScrollView, 0, 844);
    measureHostViewsAs(View, 0, 844);
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    await render(<Screen withSheet />);
    // Below the keyboard top, so the screen would scroll if it handled it.
    focusInput(600, { inSheet: true });
    await openKeyboard();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  test('reveals a form that mounts while the keyboard is open, not the input that had focus', async () => {
    measureHostViewsAs(ScrollView, 0, 844);
    measureHostViewsAs(View, 0, 844);
    const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
    await render(<Screen withSheet={false} />);
    // The plan name near the top still reports focus while the new form mounts.
    focusInput(100, { inSheet: false });
    await openKeyboard();
    expect(scrollTo).not.toHaveBeenCalled();
    await screen.rerender(<Screen withSheet={false} withForm />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // Form 900..1020 against a visible bottom of 844 - 344 - 16 = 484.
    expect(scrollTo).toHaveBeenCalledWith({ y: 1020 - 484, animated: true });
  });
});
