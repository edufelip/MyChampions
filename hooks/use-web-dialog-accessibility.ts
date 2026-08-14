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
    // React Native's <Modal> already renders a web ancestor with role="dialog" and
    // aria-modal="true" (react-native-web's ModalContent) once it activates. Reusing that
    // ancestor — instead of stamping a second, nested role="dialog" on `root` — avoids two
    // overlapping dialog roles being exposed to assistive tech, only one of which would be
    // named. `aria-modal` is applied by that ancestor unconditionally (even before the
    // activation-driven `role` lands), so it is a stable way to find it synchronously.
    const dialogEl = root?.closest<HTMLElement>('[aria-modal="true"]') ?? root;
    const ownsDialogRole = dialogEl === root;
    const previousAttributes = dialogEl
      ? {
          role: dialogEl.getAttribute('role'),
          ariaModal: dialogEl.getAttribute('aria-modal'),
          ariaLabel: dialogEl.getAttribute('aria-label'),
          ariaLabelledBy: dialogEl.getAttribute('aria-labelledby'),
        }
      : null;
    const previousTitleId = title ? title.getAttribute('id') : null;
    const generatedTitleId =
      title && !previousTitleId
        ? `${input.testID.replace(/[^a-zA-Z0-9_-]/g, '-')}-title`
        : previousTitleId;
    const canApplyDialogSemantics = Boolean(dialogEl && title);

    if (dialogEl && canApplyDialogSemantics) {
      // Only take ownership of role/aria-modal when no ancestor already manages them —
      // otherwise React Native's own re-renders of that ancestor own those attributes.
      if (ownsDialogRole) {
        dialogEl.setAttribute('role', 'dialog');
        dialogEl.setAttribute('aria-modal', 'true');
      }
      if (generatedTitleId) {
        if (!previousTitleId) title?.setAttribute('id', generatedTitleId);
        dialogEl.setAttribute('aria-labelledby', generatedTitleId);
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
      if (dialogEl && canApplyDialogSemantics && previousAttributes) {
        if (ownsDialogRole) {
          if (previousAttributes.role === null) dialogEl.removeAttribute('role');
          else dialogEl.setAttribute('role', previousAttributes.role);
          if (previousAttributes.ariaModal === null) dialogEl.removeAttribute('aria-modal');
          else dialogEl.setAttribute('aria-modal', previousAttributes.ariaModal);
          if (previousAttributes.ariaLabel === null) dialogEl.removeAttribute('aria-label');
          else dialogEl.setAttribute('aria-label', previousAttributes.ariaLabel);
        }
        if (previousAttributes.ariaLabelledBy === null) dialogEl.removeAttribute('aria-labelledby');
        else dialogEl.setAttribute('aria-labelledby', previousAttributes.ariaLabelledBy);
      }
      if (title && canApplyDialogSemantics) {
        if (previousTitleId === null) title.removeAttribute('id');
        else title.setAttribute('id', previousTitleId);
      }
      previouslyFocused?.focus();
    };
  }, [input.dialogTitleTestID, input.isVisible, input.testID]);
}
