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
  dialogTitleTestID?: string;
}) {
  const onCloseRef = useRef(input.onClose);
  useEffect(() => {
    onCloseRef.current = input.onClose;
  }, [input.onClose]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !input.isVisible || typeof document === 'undefined') return;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.querySelector<HTMLElement>(`[data-testid="${input.testID}"]`);
    const title = input.dialogTitleTestID
      ? document.querySelector<HTMLElement>(`[data-testid="${input.dialogTitleTestID}"]`)
      : null;
    const previousAttributes = root
      ? {
          role: root.getAttribute('role'),
          ariaModal: root.getAttribute('aria-modal'),
          ariaLabel: root.getAttribute('aria-label'),
          ariaLabelledBy: root.getAttribute('aria-labelledby'),
        }
      : null;
    const previousTitleId = title ? title.getAttribute('id') : null;
    const generatedTitleId =
      title && !previousTitleId
        ? `${input.testID.replace(/[^a-zA-Z0-9_-]/g, '-')}-title`
        : previousTitleId;
    const canApplyDialogSemantics = Boolean(root && title);

    if (root && canApplyDialogSemantics) {
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      if (generatedTitleId) {
        if (!previousTitleId) title?.setAttribute('id', generatedTitleId);
        root.setAttribute('aria-labelledby', generatedTitleId);
      }
    }
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
      if (root && canApplyDialogSemantics && previousAttributes) {
        if (previousAttributes.role === null) root.removeAttribute('role');
        else root.setAttribute('role', previousAttributes.role);
        if (previousAttributes.ariaModal === null) root.removeAttribute('aria-modal');
        else root.setAttribute('aria-modal', previousAttributes.ariaModal);
        if (previousAttributes.ariaLabel === null) root.removeAttribute('aria-label');
        else root.setAttribute('aria-label', previousAttributes.ariaLabel);
        if (previousAttributes.ariaLabelledBy === null) root.removeAttribute('aria-labelledby');
        else root.setAttribute('aria-labelledby', previousAttributes.ariaLabelledBy);
      }
      if (title && canApplyDialogSemantics) {
        if (previousTitleId === null) title.removeAttribute('id');
        else title.setAttribute('id', previousTitleId);
      }
      previouslyFocused?.focus();
    };
  }, [input.dialogTitleTestID, input.isVisible, input.testID]);
}
