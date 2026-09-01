import { useWindowDimensions } from 'react-native';
import { DsRadius, DsSpace } from '@/constants/design-system';
import type { ViewStyle } from 'react-native';


// Same compact/desktop threshold DsScreen already uses for its own
// responsive content width (see components/ds/primitives/DsScreen.tsx).
const DESKTOP_BREAKPOINT = 768;
const DESKTOP_DIALOG_MAX_WIDTH = 560;
const DESKTOP_DIALOG_MAX_HEIGHT_RATIO = 0.85;

export type DsModalSheetLayout = {
  isDesktop: boolean;
  /** Spread after a modal's own overlay style so mobile stays a bottom sheet. */
  overlayStyle: ViewStyle;
  /** Spread after a modal's own content style so mobile stays a bottom sheet. */
  contentStyle: ViewStyle;
};

/**
 * Shared responsive layout for `Modal`-based dialogs (support, plan/student
 * pickers, exercise search, …). Below `DESKTOP_BREAKPOINT` this is a no-op —
 * every modal keeps the bottom-sheet visual treatment ET-114 established as
 * correct for mobile/compact widths. At or above it, the caller's own
 * bottom-anchored overlay/content styles are overridden with a centered
 * desktop dialog so the sheet no longer anchors to the viewport edge (ET-172).
 */
export function useDsModalSheetLayout(): DsModalSheetLayout {
  const { width, height } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

  if (!isDesktop) {
    return { isDesktop, overlayStyle: {}, contentStyle: {} };
  }

  return {
    isDesktop,
    overlayStyle: {
      justifyContent: 'center',
      alignItems: 'center',
      padding: DsSpace.lg,
    },
    contentStyle: {
      borderTopLeftRadius: DsRadius.xl,
      borderTopRightRadius: DsRadius.xl,
      borderBottomLeftRadius: DsRadius.xl,
      borderBottomRightRadius: DsRadius.xl,
      minHeight: 0,
      maxHeight: height * DESKTOP_DIALOG_MAX_HEIGHT_RATIO,
      maxWidth: DESKTOP_DIALOG_MAX_WIDTH,
      width: '100%',
    },
  };
}
