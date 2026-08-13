# SC-214 Custom Meal Builder (V2)

## Route
- `/nutrition/custom-meals/:mealId`

## Objective
- Let any authenticated user create and edit custom meals with nutrition totals, total weight, and optional ingredient cost.
- The AI meal photo analysis CTA (SC-219) is embedded in this screen and is gated behind a RevenueCat paywall (D-132): only users with an active `professional_pro` OR `student_pro` entitlement can access the AI feature. Users without an active entitlement see a locked paywall banner with an "Upgrade to unlock" CTA.

## Browser Behavior

- Photo selection uses the browser image input/camera surface and canvas JPEG compression through `PhotoPickerAdapter`.
- Recipe sharing uses Web Share when available and clipboard fallback otherwise.
- AI entitlement checks use the server snapshot and the upgrade CTA performs mobile handoff rather than browser billing.

## UX Copy Intent
- Keep meal creation simple and practical for self-guided users.
- Explain that meal totals are used to calculate any logged portion size.

## Design Structure (D-134)
- Route uses `DsScreen` shell with shared background and semantic DS color tokens.
- Offline communication uses `DsOfflineBanner` while preserving BL-008 write-lock behavior.
- Primary action hierarchy follows DS pill-button patterns and shared spacing/typography tokens.
- AI/paywall and quick-log/builder sections keep existing business logic and localization keys, with DS visual structure.
- Native toolbar is disabled; this route runs inside the Nutrition tab stack so bottom tab navigation remains visible, while in-content back affordance is preserved.

## User Actions
- Primary:
  - Create new custom meal.
  - Enter required fields: name, total grams, calories, carbs, proteins, fats.
  - Upload or update recipe image.
  - Optionally enter ingredient cost.
  - Save meal.
  - Tap "Analyze with AI" to pre-fill fields via photo analysis (entitlement-gated, SC-219, D-132).
  - Tap "Upgrade to unlock" to open the native RevenueCat paywall or browser mobile handoff when entitlement is not active.
- Secondary:
  - Edit existing meal.
  - Generate share link for recipe.

## States
- Loading: fetch existing meal definition (edit mode). Shown as a bounded spinner (`meal.builder.loading`); the form is not rendered while resolving.
- Empty: new meal form with no values.
- Edit hydrated: when existing meal has `imageUrl`, upload section starts in `completed/change photo` state before selecting a new image.
- Image preview: when upload state is `completed`, show a thumbnail preview above the upload/change action area.
- Uploading: image upload in progress with visible percentage/progress indicator.
- Error: validation, save failure, or recoverable image-upload failure.
- Edit-resource not found / load error (ET-100, TC-401): a missing, deleted, or unauthorized `mealId`, or a failed meals-list fetch, renders a semantic error card (`meal.builder.error`) instead of the form. It shows localized copy (`meal.builder.error.not_found` or `meal.builder.error.load`), a Retry action (`meal.builder.error.retry`, re-runs the meals-list load) and a Back to recipes action (`meal.builder.error.backToLibrary`, returns to `/nutrition/custom-meals`). Save and Share are absent in this state — they only appear once a real meal has hydrated. Once hydration has happened once, a later background reload never falls back to this state, so an in-progress draft is preserved (see `resolveEditLoadStatus` in `features/nutrition/custom-meal.logic.ts`).
- Success: meal saved and available in custom meal library.

## Validation Rules
- Name is required.
- Total grams must be greater than zero.
- Calories/carbs/proteins/fats must be non-negative.
- Ingredient cost is optional but must be non-negative if provided.
- Share link generation requires existing saved meal record.
- `mealId` route parameter must resolve to a UUIDv7 record for edit mode. A missing, deleted, or unauthorized `mealId` must never render a blank editable form — it fails closed to the not-found/load-error state described above (AC-401, TC-401).
- Recoverable image-upload failures must show reason and retry action without discarding current draft fields.

## Data Contract
- Inputs:
  - Meal fields (name, grams, calories, carbs, proteins, fats, optional cost).
  - Optional image asset for recipe photo.
- Outputs:
  - Saved custom meal entity with UUIDv7 identifier and version/update metadata.
  - Image upload state (`uploading`, `failed_retryable`, `completed`) and progress value.
  - Immutable nutrition-only share link payload for selected recipe.

`features/nutrition/custom-meal-source.ts` now creates, updates, deletes, reads, and shares custom meal definitions through the local MyChampions server (`POST /nutrition/custom-meals`, `PUT /nutrition/custom-meals/:mealId`, `DELETE /nutrition/custom-meals/:mealId`, `GET /nutrition/custom-meals/:mealId`, `POST /nutrition/custom-meals/:mealId/share-links`) and fails closed outside E2E fixtures when local server URL/auth is unavailable. Image upload posts compressed JPEG bytes to `POST /nutrition/custom-meal-images/:mealId` and stores the returned local media URL with the custom meal.

## Edge Cases
- Editing a meal must not rewrite existing historical log entries.
- Large values should still validate numeric bounds safely.
- Source recipe deletion after sharing does not remove recipient-owned copies already saved.
- If upload fails on transient network error, user can retry without losing current draft edits.
- A stale, deleted, mistyped, or unauthorized `mealId` (e.g. `/nutrition/custom-meals/not-a-real-meal`) must render the not-found/load-error card, not a blank create-looking form (ET-100, TC-401).
- Whether the server distinguishes a 404 (not found) from a 403 (unauthorized) in user-facing copy is an open product question; both currently render the same generic "could not load" copy.
- If the same mounted screen instance transitions from an already-hydrated edit target into create mode (`/nutrition/custom-meals/new`) — e.g. a `replace`/deep-link navigation rather than a fresh screen push — the previously hydrated meal's form fields, `savedMealId`, and image-upload state are reset instead of leaking into what renders as a fresh create form (ET-100 follow-up hardening).

## Native Validation Notes
- Deterministic Detox coverage runs the source-sheet state and synthetic successful-upload state in separate fresh-Metro phases. The source-sheet phase explicitly clears the success fixture; the success phase bypasses the native picker and validates the preview. An authenticated run without a valid `sheet|success` runner scenario fails closed.

## Copy Draft (Initial)
- Title: `Create custom meal`
- Helper: `Add total meal weight and nutrients. We use this to calculate any portion you log.`
- CTA save: `Save meal`
- CTA share: `Share recipe`

## Links
- Functional requirement: FR-137, FR-138, FR-142, FR-143, FR-144, FR-148, FR-150, FR-155, FR-159, FR-162, FR-197, FR-202, FR-213
- Use case: UC-003.1, UC-003.3, UC-003.4, UC-003.8, UC-003.9
- Acceptance criteria: AC-401, AC-402, AC-406, AC-407, AC-408, AC-412, AC-413, AC-418, AC-420, AC-423, AC-424, AC-425
- Business rules: BR-257, BR-261, BR-271, BR-301, BR-302, BR-303, BR-308, BR-309, BR-310, BR-313, BR-316, BR-322, BR-324, BR-327
- Test cases: TC-401, TC-402, TC-403, TC-407, TC-408, TC-409, TC-412, TC-413, TC-415, TC-420, TC-422, TC-425, TC-426, TC-427, TC-428
- Decisions: D-132 (AI paywall gate — `useSubscription` wired; `hasAiAccess`, `isSubscriptionLoading`, `onOpenPaywall` passed to `MealPhotoAnalysisSection`)
- Related screen: SC-219 (AI Meal Photo Analysis)
- Diagram: docs/diagrams/domain-relationships.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
