import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="button"]:not([aria-disabled="true"])';

function isVisibleFocusable(element: HTMLElement): boolean {
  return (
    !element.hidden &&
    element.getAttribute('aria-hidden') !== 'true' &&
    element.getClientRects().length > 0
  );
}

export function useWebDialogAccessibility(input: {
  isVisible: boolean;
  onClose: () => void;
  testID: string;
}) {
  const onCloseRef = useRef(input.onClose);
  useEffect(() => {
    onCloseRef.current = input.onClose;
  }, [input.onClose]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !input.isVisible || typeof document === 'undefined') return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.querySelector<HTMLElement>(`[data-testid="${input.testID}"]`);
    const focusable = () =>
      Array.from(root?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(isVisibleFocusable);
    const focusTimer = window.setTimeout(() => focusable()[0]?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (!root?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [input.isVisible, input.testID]);
}
