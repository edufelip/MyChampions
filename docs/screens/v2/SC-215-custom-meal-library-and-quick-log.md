# SC-215 Custom Meal Library And Quick Log (V2)

## Route
- `/nutrition/custom-meals`

## Objective
- Let any authenticated user browse saved custom meals and log consumed grams quickly.
- The AI meal photo analysis CTA (SC-219) is embedded in the quick-log panel (`QuickLogAnalysisRow`) and is gated behind a RevenueCat paywall (D-132): only users with an active `professional_pro` OR `student_pro` entitlement can access the AI feature. Users without an active entitlement see a locked paywall banner with an "Upgrade to unlock" CTA.

## Browser Behavior

- The library and builder use responsive `DsScreen` content constraints without changing mobile layouts.
- Share actions use Web Share with clipboard fallback.
- Browser meal-photo capture and compression use `PhotoPickerAdapter`; denied/unavailable media access returns to the existing idle/error state.
- Subscription upgrade actions perform mobile handoff and never initialize RevenueCat preview mode.
- Saved-meal actions form a compact, wrapping action row under the meal summary instead of a sparse trailing column.
- Quick log is a bottom sheet on phones and a centered, width-capped dialog on tablet/desktop, with a dimmed backdrop and unchanged keyboard/accessibility behavior.

## Native Automation Contract

- The cross-platform quick-log story focuses the grams input, atomically replaces
  and verifies the intended value, dismisses Android's active keyboard with the
  native back action or iOS's localized accessory action after its keyboard
  animation settles, and submits through the stable confirm identifier. It does
  not fall back to screen coordinates hidden beneath an IME.

## UX Copy Intent
- Emphasize fast logging from already-saved meals.
- Keep the grams-to-nutrients outcome clear before confirmation.

## Design Structure (D-134)
- Route uses `DsScreen` shell with shared background and semantic DS color tokens.
- Route runs inside the Nutrition tab stack so bottom tab navigation remains visible.
- Because meal library rows use `FlatList`, route uses `DsScreen scrollable={false}` to avoid nested VirtualizedList containers.
- Offline communication uses `DsOfflineBanner` while preserving BL-008 write-lock behavior.
- Primary action hierarchy follows DS pill-button patterns and shared spacing/typography tokens.
- AI/paywall and quick-log/builder sections keep existing business logic and localization keys, with DS visual structure.
- Library content is capped to the `content` lane so meal rows and create actions remain readable on large displays.

## User Actions
- Primary:
  - View saved custom meal list.
  - Select a meal and enter consumed grams.
  - Confirm and save quick log entry.
  - Tap "Analyze with AI" in the quick-log panel to pre-fill nutrition via photo analysis (entitlement-gated, SC-219, D-132).
  - Tap "Upgrade to unlock" to open the native RevenueCat paywall or browser mobile handoff when entitlement is not active.
- Secondary:
  - Open meal builder to create/edit meal.
  - Open share action for owned recipes.

## States
- Loading: fetch custom meal library. Shown as a bounded spinner (`meal.library.loading`).
- Empty: no saved meals yet (successful zero-meal response) — renders the illustrated empty state and `meal.library.empty.cta` Create meal CTA, distinct from the error state below.
- Error (ET-103, TC-401): a recoverable library read failure renders `meal.library.error` with localized copy, a Retry action (`meal.library.error.retry`, calls `useCustomMeals().reload()` and re-runs the load) and a safe fallback Create meal action (`meal.library.error.cta.create`, opens `/nutrition/custom-meals/new`). No stale meal rows remain mounted or interactive behind the error card, and the bottom tab navigation stays reachable. Retry transitions through the existing loading state (`meal.library.loading`) before settling into `ready` or back into `error`.
- Log save failure: quick-log panel shows an inline field error (`meal.library.quickLog.error`) without leaving the panel.
- Success: log saved and daily nutrition totals updated.

## Validation Rules
- Consumed grams must be greater than zero.
- Proportional nutrient calculation must execute before save confirmation.
- Share action is available for recipes owned by current account.

## Data Contract
- Inputs:
  - Custom meal definition.
  - Consumed grams.
- Outputs:
  - Portion log entry with nutrition snapshot.
  - Updated daily totals in nutrition tracking.
  - Deep link navigation target for shared recipe confirmation flow.

`features/nutrition/custom-meal-source.ts` now reads custom meal definitions through the local MyChampions server (`GET /nutrition/custom-meals`), and quick logging reads the selected meal through `GET /nutrition/custom-meals/:mealId` before writing `POST /nutrition/portion-logs`. Today's portion-log reads use `GET /nutrition/portion-logs`. Share links use `POST /nutrition/custom-meals/:mealId/share-links`; shared recipe previews use `GET /nutrition/custom-meal-shares/:shareToken`; imports use `POST /nutrition/custom-meal-shares/:shareToken/import`. These paths fail closed outside E2E fixtures when local server URL/auth is unavailable. Custom meal image URLs now come from local MyChampions server media storage.

## Edge Cases
- Consumed grams greater than meal total grams should still calculate correctly.
- If meal is edited later, old logs keep previous nutrition snapshot.
- Imported shared recipes are treated as recipient-owned and remain after source deletion.

## Copy Draft (Initial)
- Empty title: `No custom meals yet`
- Empty helper: `Create your first custom meal to log portions in seconds.`
- Quick log helper: `Enter grams consumed. We calculate calories and macros automatically.`
- CTA log: `Log meal`
- CTA share: `Share recipe`

## Links
- Functional requirement: FR-139, FR-140, FR-141, FR-142, FR-143, FR-144, FR-147, FR-150
- Use case: UC-003.2, UC-003.3, UC-003.4, UC-003.6, UC-003.9
- Acceptance criteria: AC-403, AC-404, AC-405, AC-406, AC-407, AC-408, AC-411, AC-413
- Business rules: BR-304, BR-305, BR-306, BR-307, BR-308, BR-309, BR-310, BR-313, BR-316
- Test cases: TC-404, TC-405, TC-406, TC-407, TC-408, TC-409, TC-412, TC-414, TC-415, TC-436
- Decisions: D-132 (AI paywall gate — `useSubscription` wired; `hasAiAccess`, `isSubscriptionLoading`, `onOpenPaywall` threaded through `QuickLogPanel` → `QuickLogAnalysisRow`)
- Related screen: SC-219 (AI Meal Photo Analysis)
- Diagram: docs/diagrams/domain-relationships.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
