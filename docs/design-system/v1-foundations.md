# V1 Design System Foundations

## Purpose
Define and operationalize the mobile design language inspired by the provided dashboard reference: energetic fitness palette, clean cards, and high-contrast CTA hierarchy.

## Source Aesthetic Extracted From Reference
- Primary accent is electric green (`#13ec49`) used for momentum actions and progress emphasis.
- Secondary anchor is fitness navy (`#0A2463`) used for contrast text on bright CTA surfaces and key navigation emphasis.
- Background strategy is low-noise neutral canvas (`#f6f8f6` light / `#102215` dark) with elevated white/dark cards.
- Card-first composition with strong rounded corners, soft borders, and restrained shadows.
- Dense-but-readable mobile spacing rhythm with compact headers and strong primary CTAs.

## Subtle UI/UX Insights Captured
- Bright accent should indicate commitment actions, not generic decoration.
- Progress widgets benefit from category hue support (green/blue/cyan) while keeping one global action accent.
- Sticky navigation and sticky action areas need clear border contrast, not heavy shadows.
- Visual confidence comes from fewer token families used consistently, not more decorative variants.
- Dark mode should preserve hierarchy via surface depth and border contrast instead of saturated backgrounds.

## Artistic Direction
- Tone: athletic, optimistic, and focused.
- Visual metaphor: "gym floor + dashboard instrumentation" rather than playful consumer pastel.
- Typography intent: geometric sans cadence (Manrope-style) with bold section headers and compact supporting text.

## Scope
- Semantic design tokens in `constants/design-system.ts`
- Theme bridge in `constants/theme.ts`
- Reusable primitives in `components/ds/primitives/`
- Reusable patterns in `components/ds/patterns/`
- Navigation shell consumption in `app/_layout.tsx` and `app/(tabs)/_layout.tsx`

## Design Tokens
### Color tokens
- Canvas/background: `color.canvas`
- Shell overlay: `color.shell`
- Surfaces: `color.surface`, `color.surfaceMuted`, `color.surfaceElevated`, `color.surfaceWarning`
- Text: `color.textPrimary`, `color.textSecondary`, `color.textTertiary`
- Accent family: `color.accentPrimary`, `color.accentPrimaryHover`, `color.accentPrimarySoft`, `color.accentBlue`, `color.accentBlueSoft`, `color.accentCyan`, `color.accentCyanSoft`
- Status: `color.success`, `color.successSoft`, `color.warning`, `color.warningSoft`, `color.danger`, `color.dangerSoft`, `color.dangerBorder`, `color.readOnlyText`
- Border/overlay: `color.border`, `color.borderStrong`, `color.onAccent`, `color.overlaySoft`, `color.overlayStrong`
- Decorative blobs: `blob.topLeft`, `blob.bottomRight`

### Typography tokens
- `title`
- `screenTitle`
- `cardTitle`
- `body`
- `caption`
- `button`
- `micro`

### Layout tokens
- Radius scale: `DsRadius`
- Spacing scale: `DsSpace`
- Elevation presets: `DsShadow` (`none`, `soft`, `floating`)

## Primitive Components
### `DsScreen`
- Standardized screen canvas and optional decorative blob background.

### `DsBlobBackground`
- Decorative top-left / bottom-right blob rendering with theme-aware colors.

### `DsCard`
- Reusable surface card with semantic variants:
  - `default`
  - `warning`
  - `muted`

### `DsPillButton`
- Reusable pill CTA with variants:
  - `primary`
  - `secondary`
- Supports loading, icon slots, and full-width/compact mode.

### `DsOfflineBanner`
- Reusable offline alert banner pattern for BL-008 compliance.

### `DsIconButton`
- Reusable circular icon button.

## Pattern Components
### `WeekStrip`
- Date strip for daily-overview surfaces with active-day accent emphasis.

### `ReadOnlyNoticeCard`
- Assigned-plan read-only message card (D-006/D-071 aligned usage).

### `HeroEmptyState`
- Reusable empty state hero with icon, helper text, and CTA.

### `PlanChangeRequestCard`
- Standardized plan-change request form with validation, success/error states, and write-lock handling.

## Usage Rules
1. New or redesigned screens must consume DS primitives before adding local one-off styles.
2. User-facing copy must come from localization keys.
3. Offline/write-lock states must use `DsOfflineBanner` + existing business logic (`resolveOfflineDisplayState`).
4. Business hooks (`usePlans`, `useWaterTracking`, etc.) remain outside DS components.
5. New shared components must not introduce fixed hex values if an existing semantic token fits.

## Validation Checklist
- Lint passes on migrated screens and DS files.
- Existing testIDs are preserved for core interactions.
- Offline/read-only and assigned/self-guided behavior remains unchanged.
- No new user-facing strings are hardcoded.
