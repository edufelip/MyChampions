# V1 Design System Foundations

## Purpose
Create a reusable, implementation-ready UI system for the current playful visual direction used by auth and student surfaces.

## Scope
- Semantic design tokens in `constants/design-system.ts`
- Reusable primitives in `components/ds/primitives/`
- Reusable patterns in `components/ds/patterns/`
- Initial consumer screens:
  - `app/student/nutrition.tsx`
  - `app/student/training.tsx`

## Design Tokens
### Color tokens
- Canvas/background: `color.canvas`
- Shell overlay: `color.shell`
- Surfaces: `color.surface`, `color.surfaceMuted`, `color.surfaceWarning`
- Text: `color.textPrimary`, `color.textSecondary`
- Accent: `color.accentPrimary`, `color.accentPrimarySoft`, `color.accentBlueSoft`, `color.accentMint`, `color.accentYellow`
- Status: `color.danger`, `color.dangerSoft`, `color.dangerBorder`, `color.readOnlyText`
- Border: `color.border`
- Background blobs: `blob.topLeft`, `blob.bottomRight`

### Typography tokens
- `title`
- `cardTitle`
- `body`
- `caption`
- `button`

### Layout tokens
- Radius scale: `DsRadius`
- Spacing scale: `DsSpace`
- Elevation presets: `DsShadow`

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
- Date strip used by training-style daily overviews.

### `ReadOnlyNoticeCard`
- Assigned-plan read-only message card (D-006/D-071 aligned usage).

### `HeroEmptyState`
- Reusable playful empty state with icon, helper text, and CTA.

### `PlanChangeRequestCard`
- Standardized plan-change request form UI with validation, success/error states, and write-lock handling.

## Usage Rules
1. New or redesigned student/auth screens should use DS primitives before adding local one-off styles.
2. User-facing copy must still come from localization keys (no literals in TSX).
3. Offline/write-lock states must use `DsOfflineBanner` + existing business logic (`resolveOfflineDisplayState`).
4. Business hooks (`usePlans`, `useWaterTracking`, etc.) remain outside DS components.

## Migration Strategy
1. Build tokens/primitives.
2. Build high-value patterns.
3. Migrate existing screens incrementally.
4. Remove duplicated local style structures only after migration validation.

## Validation Checklist
- Lint passes on migrated screens and DS files.
- Existing testIDs are preserved for core interactions.
- Offline/read-only and assigned/self-guided behavior remains unchanged.
- No new user-facing strings are hardcoded.
