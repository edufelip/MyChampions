import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  Dimensions,
  Keyboard,
  LayoutAnimation,
  Platform,
  TextInput,
  type KeyboardEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type View,
} from 'react-native';
import { DsSpace } from '@/constants/design-system';

/*
 * Keyboard avoidance shared by DsScreen (opt-in `keyboardAware`), bottom sheets
 * and bottom panels. React Native built-ins only.
 *
 * Why this exists: the app is edge-to-edge on Android, so
 * `windowSoftInputMode="adjustResize"` no longer shrinks the window when the
 * keyboard opens (Android 15+ enforces edge-to-edge), and iOS never did.
 * Content therefore makes room from the keyboard's own metrics: a view
 * measures how much of it the keyboard covers and pads or scrolls by that.
 *
 * Coordinates: keyboard events report `screenY` in screen points. Views are
 * measured with `measure()`'s page coordinates (relative to the React root or
 * modal root, which sit at the screen origin in this edge-to-edge app), not
 * `measureInWindow()`, which on Android is offset by the status bar.
 */

/** The software keyboard in screen coordinates: `top` is its top edge. */
export type DsKeyboardFrame = { top: number; height: number };

type MeasureCallback = (x: number, y: number, width: number, height: number) => void;
type MeasureWithPageCallback = (
  x: number,
  y: number,
  width: number,
  height: number,
  pageX: number,
  pageY: number,
) => void;

/** The host-view methods used here; every native view instance provides them. */
export type DsMeasurableNode = {
  measure?: (callback: MeasureWithPageCallback) => void;
  measureLayout?: (relativeTo: never, onSuccess: MeasureCallback, onFail?: () => void) => void;
};

/** Space kept between a revealed field and the keyboard or the top safe area. */
export const DS_KEYBOARD_REVEAL_MARGIN = DsSpace.md;

// iOS announces the keyboard before it animates in, so layout can move with
// it; Android reports it once it is on screen.
const SHOW_EVENT = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
const HIDE_EVENT = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

export function toDsKeyboardFrame(
  metrics: { screenY: number; height: number } | null | undefined,
  windowHeight: number = Dimensions.get('window').height,
): DsKeyboardFrame | null {
  if (!metrics || !(metrics.height > 0)) return null;
  const top =
    Number.isFinite(metrics.screenY) && metrics.screenY > 0
      ? metrics.screenY
      : windowHeight - metrics.height;
  return { top, height: metrics.height };
}

/** Points of a view (bottom edge at `viewBottom`, screen coordinates) under the keyboard. */
export function computeKeyboardOverlap(
  viewBottom: number,
  keyboard: DsKeyboardFrame | null,
): number {
  if (!keyboard) return 0;
  if (!Number.isFinite(viewBottom) || viewBottom <= 0) return Math.round(keyboard.height);
  return Math.max(0, Math.round(viewBottom - keyboard.top));
}

/**
 * Scroll distance that brings `[top, bottom]` inside `[visibleTop, visibleBottom]`
 * (all in the same coordinates); positive scrolls down. A target taller than
 * the visible range keeps its top edge visible.
 */
export function computeRevealScrollDelta({
  top,
  bottom,
  visibleTop,
  visibleBottom,
}: {
  top: number;
  bottom: number;
  visibleTop: number;
  visibleBottom: number;
}): number {
  if (bottom > visibleBottom) return Math.round(Math.min(bottom - visibleBottom, top - visibleTop));
  if (top < visibleTop) return Math.round(top - visibleTop);
  return 0;
}

/**
 * Height bounds that keep a bottom sheet between the top safe area and the
 * keyboard: the sheet may shrink (its list scrolls) but its header stays on
 * screen. `null` while the keyboard is hidden.
 */
export function computeKeyboardSheetBounds({
  containerHeight,
  overlap,
  topInset,
  preferredMinHeight,
}: {
  containerHeight: number;
  overlap: number;
  topInset: number;
  preferredMinHeight: number;
}): { minHeight: number; maxHeight: number } | null {
  if (overlap <= 0 || !(containerHeight > 0)) return null;
  const available = Math.max(0, Math.floor(containerHeight - overlap - topInset - DsSpace.sm));
  return { minHeight: Math.min(preferredMinHeight, available), maxHeight: available };
}

/** Calls back with the node's top edge and height in page (screen) coordinates. */
function measureOnPage(
  node: DsMeasurableNode | null | undefined,
  callback: (top: number, height: number) => void,
): boolean {
  if (!node?.measure) return false;
  node.measure((_x, _y, _width, height, _pageX, pageY) => callback(pageY, height));
  return true;
}

function currentKeyboardFrame(): DsKeyboardFrame | null {
  return Keyboard.isVisible() ? toDsKeyboardFrame(Keyboard.metrics()) : null;
}

function subscribeToKeyboard(
  onChange: (keyboard: DsKeyboardFrame | null, event?: KeyboardEvent) => void,
): () => void {
  const subscriptions = [
    Keyboard.addListener(SHOW_EVENT, (event) =>
      onChange(toDsKeyboardFrame(event.endCoordinates), event),
    ),
    Keyboard.addListener(HIDE_EVENT, (event) => onChange(null, event)),
  ];
  return () => subscriptions.forEach((subscription) => subscription.remove());
}

/** Moves the next layout change with the iOS keyboard (as KeyboardAvoidingView does). */
function animateWithKeyboard(event?: KeyboardEvent) {
  if (Platform.OS !== 'ios' || !event?.duration) return;
  const duration = Math.max(event.duration, 10);
  LayoutAnimation.configureNext({
    duration,
    update: {
      duration,
      type: (event.easing && LayoutAnimation.Types[event.easing]) || LayoutAnimation.Types.keyboard,
    },
  });
}

// Views that lift themselves above the keyboard (useDsKeyboardOverlap): a
// bottom sheet, a modal or a bottom panel. A keyboard-aware DsScreen leaves
// their inputs to them. With the New Architecture, a Modal rendered inside the
// screen's scroll view still measures as part of the scroll content
// (measureLayout stops at the modal root instead of failing), so without this
// check the screen behind an open sheet would scroll away from where it was.
const selfLiftingViews = new Set<RefObject<DsMeasurableNode | null>>();

/** Calls back with whether `focused` sits inside a mounted self-lifting view. */
function isInsideSelfLiftingView(focused: DsMeasurableNode, done: (inside: boolean) => void) {
  const roots = [...selfLiftingViews]
    .map((ref) => ref.current)
    .filter((node): node is DsMeasurableNode => node != null);
  const check = (index: number) => {
    const root = roots[index];
    if (!root || !focused.measureLayout) {
      done(false);
      return;
    }
    // measureLayout fails when `focused` is not inside `root`.
    focused.measureLayout(
      root as never,
      () => done(true),
      () => check(index + 1),
    );
  };
  check(0);
}

/**
 * Points of `viewRef`'s bottom edge the software keyboard covers (0 while it
 * is hidden). Pad the view's bottom by this amount to lift its content above
 * the keyboard on both platforms. Measure a view whose frame does not depend
 * on that padding (a full-screen overlay or modal root). While enabled, a
 * keyboard-aware DsScreen behind the view leaves the view's inputs alone.
 */
export function useDsKeyboardOverlap(
  viewRef: RefObject<DsMeasurableNode | null>,
  enabled = true,
): number {
  const [overlap, setOverlap] = useState(0);
  const overlapRef = useRef(0);

  useEffect(() => {
    let sequence = 0;
    const commit = (next: number, event?: KeyboardEvent) => {
      if (next === overlapRef.current) return;
      overlapRef.current = next;
      animateWithKeyboard(event);
      setOverlap(next);
    };
    if (!enabled || Platform.OS === 'web') {
      commit(0);
      return undefined;
    }
    selfLiftingViews.add(viewRef);
    const apply = (keyboard: DsKeyboardFrame | null, event?: KeyboardEvent) => {
      const current = ++sequence;
      if (!keyboard) {
        commit(0, event);
        return;
      }
      const measured = measureOnPage(viewRef.current, (top, height) => {
        if (current === sequence) commit(computeKeyboardOverlap(top + height, keyboard), event);
      });
      if (!measured) commit(Math.round(keyboard.height), event);
    };
    apply(currentKeyboardFrame());
    const unsubscribe = subscribeToKeyboard(apply);
    return () => {
      sequence += 1;
      unsubscribe();
      selfLiftingViews.delete(viewRef);
    };
  }, [enabled, viewRef]);

  return enabled ? overlap : 0;
}

// ─── Keyboard targets ─────────────────────────────────────────────────────────

// Mounted targets app-wide. A scroll view only uses a target that contains the
// focused input and sits inside its own content (both checked by measureLayout).
const keyboardTargets = new Set<DsMeasurableNode>();
const targetMountListeners = new Set<() => void>();

/**
 * Callback ref for a view that must stay fully visible above the keyboard
 * while one of its inputs is focused — an inline form together with its
 * Add/Cancel buttons. Without one, a `keyboardAware` DsScreen reveals just the
 * focused input. Only a `keyboardAware` DsScreen acts on it.
 */
export function useDsKeyboardTarget(): (node: object | null) => void {
  const nodeRef = useRef<DsMeasurableNode | null>(null);
  // Typed loosely so it also fits animated views; any host view instance works.
  return useCallback((node: object | null) => {
    if (nodeRef.current) keyboardTargets.delete(nodeRef.current);
    nodeRef.current = node as DsMeasurableNode | null;
    if (!nodeRef.current) return;
    keyboardTargets.add(nodeRef.current);
    // A form that mounts while the keyboard is already open.
    targetMountListeners.forEach((listener) => listener());
  }, []);
}

/** First mounted target that contains `focused`, else `focused` itself. */
function resolveRevealNode(
  focused: DsMeasurableNode,
  targets: DsMeasurableNode[],
  done: (node: DsMeasurableNode) => void,
) {
  const [target, ...rest] = targets;
  if (!target || !focused.measureLayout) {
    done(focused);
    return;
  }
  // measureLayout fails when `focused` is not inside `target`.
  focused.measureLayout(
    target as never,
    () => done(target),
    () => resolveRevealNode(focused, rest, done),
  );
}

// ─── Scroll views ─────────────────────────────────────────────────────────────

type KeyboardAwareScrollOptions = {
  enabled: boolean;
  /**
   * `spacer`: the scroll view keeps its frame and runs under the keyboard
   * (a full-screen DsScreen), so it gets keyboard-height bottom space.
   * `resized`: a parent lifts or shrinks the scroll view (a bottom sheet).
   */
  mode: 'spacer' | 'resized';
  /** Height of the top safe area that content scrolled beneath stays hidden by. */
  topInset?: number;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

/**
 * Keeps the focused input — or the keyboard target that contains it — visible
 * inside a scroll view while the keyboard is open.
 */
export function useDsKeyboardAwareScroll({
  enabled,
  mode,
  topInset = 0,
  onScroll,
  onLayout,
}: KeyboardAwareScrollOptions) {
  const active = enabled && Platform.OS !== 'web';
  const scrollRef = useRef<ScrollView>(null);
  const innerViewRef = useRef<View>(null);
  const offsetRef = useRef(0);
  const keyboardRef = useRef<DsKeyboardFrame | null>(null);
  const spacerRef = useRef(0);
  const pendingRevealRef = useRef(false);
  const [spacerHeight, setSpacerHeight] = useState(0);

  const reveal = useCallback(() => {
    const keyboard = keyboardRef.current;
    const scrollView = scrollRef.current as (ScrollView & DsMeasurableNode) | null;
    const focused = TextInput.State.currentlyFocusedInput() as DsMeasurableNode | null;
    const content = innerViewRef.current as DsMeasurableNode | null;
    if (!keyboard || !scrollView || !focused || !content) return;
    const revealInScrollView = () =>
      measureOnPage(scrollView, (viewportTop, viewportHeight) => {
        const covered = computeKeyboardOverlap(viewportTop + viewportHeight, keyboard);
        resolveRevealNode(focused, [...keyboardTargets], (node) => {
          node.measureLayout?.(
            content as never,
            (_left, top, _width, height) => {
              const offset = offsetRef.current;
              const delta = computeRevealScrollDelta({
                top,
                bottom: top + height,
                visibleTop:
                  offset + Math.max(0, topInset - viewportTop) + DS_KEYBOARD_REVEAL_MARGIN,
                visibleBottom: offset + viewportHeight - covered - DS_KEYBOARD_REVEAL_MARGIN,
              });
              if (delta !== 0) {
                scrollView.scrollTo({ y: Math.max(0, offset + delta), animated: true });
              }
            },
            // The node is not inside this scroll view (another screen).
            () => undefined,
          );
        });
      });
    if (mode === 'resized') {
      // This scroll view lives inside the sheet that lifts it.
      revealInScrollView();
      return;
    }
    // A screen leaves an open sheet's or panel's inputs to that sheet.
    isInsideSelfLiftingView(focused, (inside) => {
      if (!inside) revealInScrollView();
    });
  }, [mode, topInset]);

  useEffect(() => {
    if (!active) {
      keyboardRef.current = null;
      spacerRef.current = 0;
      setSpacerHeight(0);
      return undefined;
    }
    let sequence = 0;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    const apply = (keyboard: DsKeyboardFrame | null, event?: KeyboardEvent) => {
      const current = ++sequence;
      keyboardRef.current = keyboard;
      clearTimeout(revealTimer);
      if (!keyboard) {
        pendingRevealRef.current = false;
        spacerRef.current = 0;
        setSpacerHeight(0);
        return;
      }
      if (mode === 'resized') {
        // The parent lifts or shrinks this scroll view with the keyboard;
        // reveal once that has settled (onLayout reveals sooner when the
        // frame changes).
        pendingRevealRef.current = true;
        revealTimer = setTimeout(reveal, (event?.duration ?? 0) + 50);
        return;
      }
      measureOnPage(scrollRef.current as DsMeasurableNode | null, (top, height) => {
        if (current !== sequence) return;
        const next = computeKeyboardOverlap(top + height, keyboard);
        if (next === spacerRef.current) {
          requestAnimationFrame(reveal);
          return;
        }
        // Reveal once the spacer is laid out, so there is room to scroll into.
        spacerRef.current = next;
        pendingRevealRef.current = true;
        setSpacerHeight(next);
      });
    };
    const onTargetMount = () => {
      if (keyboardRef.current) requestAnimationFrame(reveal);
    };
    apply(currentKeyboardFrame());
    const unsubscribe = subscribeToKeyboard(apply);
    targetMountListeners.add(onTargetMount);
    return () => {
      sequence += 1;
      clearTimeout(revealTimer);
      unsubscribe();
      targetMountListeners.delete(onTargetMount);
    };
  }, [active, mode, reveal]);

  const revealPending = useCallback(() => {
    if (!pendingRevealRef.current || !keyboardRef.current) return;
    pendingRevealRef.current = false;
    reveal();
  }, [reveal]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetRef.current = event.nativeEvent.contentOffset.y;
      onScroll?.(event);
    },
    [onScroll],
  );

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      if (mode === 'resized') revealPending();
      onLayout?.(event);
    },
    [mode, onLayout, revealPending],
  );

  return {
    scrollRef,
    /** Bottom space to render after the content (`spacer` mode). */
    spacerHeight: active && mode === 'spacer' ? spacerHeight : 0,
    onSpacerLayout: revealPending,
    scrollViewProps: active
      ? {
          // RN's typings want a non-null RefObject; the ref is null until mount.
          innerViewRef: innerViewRef as RefObject<View>,
          onScroll: handleScroll,
          onLayout: handleLayout,
          scrollEventThrottle: 16,
          // Taps reach buttons (Add, Cancel, Send) while the keyboard is open.
          keyboardShouldPersistTaps: 'handled' as const,
        }
      : { onScroll, onLayout },
  };
}
