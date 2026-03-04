# SC-214 Custom Meal Builder (V2)

## Route
- `/nutrition/custom-meals/:mealId`

## Objective
- Let any authenticated user create and edit custom meals with nutrition totals, total weight, and optional ingredient cost.
- The AI meal photo analysis CTA (SC-219) is embedded in this screen and is gated behind a RevenueCat paywall (D-132): only users with an active `professional_unlimited` OR `premium_student` entitlement can access the AI feature. Users without an active entitlement see a locked paywall banner with an "Upgrade to unlock" CTA.

## UX Copy Intent
- Keep meal creation simple and practical for self-guided users.
- Explain that meal totals are used to calculate any logged portion size.

## Design Structure (D-134)
- Route uses `DsScreen` shell with shared background and semantic DS color tokens.
- Offline communication uses `DsOfflineBanner` while preserving BL-008 write-lock behavior.
- Primary action hierarchy follows DS pill-button patterns and shared spacing/typography tokens.
- AI/paywall and quick-log/builder sections keep existing business logic and localization keys, with DS visual structure.

## User Actions
- Primary:
  - Create new custom meal.
  - Enter required fields: name, total grams, calories, carbs, proteins, fats.
  - Upload or update recipe image.
  - Optionally enter ingredient cost.
  - Save meal.
  - Tap "Analyze with AI" to pre-fill fields via photo analysis (entitlement-gated, SC-219, D-132).
  - Tap "Upgrade to unlock" to open native RevenueCat paywall when entitlement is not active.
- Secondary:
  - Edit existing meal.
  - Generate share link for recipe.

## States
- Loading: fetch existing meal definition (edit mode).
- Empty: new meal form with no values.
- Uploading: image upload in progress with visible percentage/progress indicator.
- Error: validation, save failure, or recoverable image-upload failure.
- Success: meal saved and available in custom meal library.

## Validation Rules
- Name is required.
- Total grams must be greater than zero.
- Calories/carbs/proteins/fats must be non-negative.
- Ingredient cost is optional but must be non-negative if provided.
- Share link generation requires existing saved meal record.
- `mealId` route parameter must resolve to a UUIDv7 record for edit mode.
- Recoverable image-upload failures must show reason and retry action without discarding current draft fields.

## Data Contract
- Inputs:
  - Meal fields (name, grams, calories, carbs, proteins, fats, optional cost).
  - Optional image asset for recipe photo.
- Outputs:
  - Saved custom meal entity with UUIDv7 identifier and version/update metadata.
  - Image upload state (`uploading`, `failed_retryable`, `completed`) and progress value.
  - Immutable nutrition-only share link payload for selected recipe.

## Edge Cases
- Editing a meal must not rewrite existing historical log entries.
- Large values should still validate numeric bounds safely.
- Source recipe deletion after sharing does not remove recipient-owned copies already saved.
- If upload fails on transient network error, user can retry without losing current draft edits.

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
- Test cases: TC-401, TC-402, TC-403, TC-407, TC-408, TC-409, TC-412, TC-413, TC-415, TC-420, TC-422, TC-425, TC-426, TC-427
- Decisions: D-132 (AI paywall gate — `useSubscription` wired; `hasAiAccess`, `isSubscriptionLoading`, `onOpenPaywall` passed to `MealPhotoAnalysisSection`)
- Related screen: SC-219 (AI Meal Photo Analysis)
- Diagram: docs/diagrams/domain-relationships.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
