# Custom Meals And Portion Logging Spec (Proposed)

## Purpose
Define behavior for creating custom meals and logging consumed portions by grams with proportional calorie/macro calculation.

## Scope
- Custom meal creation and editing.
- Portion logging using saved meals.
- Proportional nutrient calculation.
- Historical log integrity when meal definitions change.
- Share-link distribution and recipient copy ownership.

## Definitions And Terminology
- Custom meal: user-defined meal with total weight and nutrient totals.
- Portion log: consumption entry recording grams consumed from a custom meal.
- Nutrition snapshot: stored nutrient values at time of log entry.
- Shared recipe link: tokenized link allowing recipient to preview and save a copy.
- Recipient-owned copy: independent recipe record created from a shared recipe.
- Recipe ID: UUIDv7 primary identifier used by each custom meal record.

## Inputs And Outputs
- Inputs:
  - Meal definition fields: name, total grams, calories, carbs, proteins, fats, optional ingredient cost.
  - Portion logging field: consumed grams.
  - Shared-link token and immutable nutrition snapshot payload (`name`, `total_grams`, `calories`, `carbs`, `proteins`, `fats`).
- Outputs:
  - Persisted custom meal record.
  - Persisted portion log entry with calculated nutrients.
  - Updated daily nutrition totals.
  - Share link payloads and recipient-owned copy records.

## Expected Behavior
1. User creates a custom meal with required nutrient and weight fields.
2. System validates positive grams and non-negative nutrient values.
3. User logs consumed grams from saved meal.
4. System calculates consumed nutrients proportionally.
5. System stores log entry and updates daily totals.
6. User can reuse same meal for future logs.
7. If meal is edited later, historical log entries remain unchanged.
8. Meal owner can generate share link for a saved meal.
9. Recipient opening valid link sees confirmation screen before save.
10. Recipient confirmation creates account-owned copy of recipe.
11. Recipient copy remains available if creator edits or deletes source meal.
12. Custom meal create/edit/share and shared-save flows are available to all authenticated account roles.
13. Shared links do not expire automatically.
14. Creators cannot revoke previously generated shared links.
15. If recipient opens shared link while unauthenticated, system requires login and resumes the same token flow after authentication.
16. Repeated save attempts by the same recipient on the same shared link are idempotent and do not create duplicate owned copies.
17. Existing shared links keep import behavior using immutable share snapshot, even if source meal is edited or deleted before save.
18. Every recipe record (source or imported copy) has a UUIDv7 primary identifier.
19. Sharing endpoints enforce rate limits for abuse control.
20. Full shared-link values/raw share tokens are excluded from analytics and general observability logs.
21. Recipe image uploads show visible progress state while transfer is in-flight.
22. Recoverable image-upload failures show reason + retry path and preserve recipe draft fields.

## Error Handling And Edge Cases
- Missing/invalid required meal fields block save.
- Consumed grams less than or equal to zero block log submission.
- Consumed grams may exceed saved meal total weight and still calculate correctly.
- API outages in other nutrition features must not block logging already-saved custom meals.
- Invalid or unknown share link must show recoverable error state.
- Source deletion before recipient save must not block import for existing valid links, because share snapshot is immutable at link generation.
- Re-opening a previously imported link by same recipient should resolve to already-saved copy state.
- Rate-limit thresholds exceeded on share/open/import endpoints must return retryable errors with backoff guidance.
- Recoverable image-upload failure must not clear already-entered recipe form values.

## Invariants And Guarantees
- Formula basis for each nutrient:
  - `consumed = (consumed_grams / meal_total_grams) * meal_total`
- Historical logs are immutable snapshots.
- Custom meal functionality remains available in self-guided mode.
- Share-save creates independent recipient ownership (copy-on-save).
- Source record lifecycle must not remove already-saved recipient copies.
- Role type does not restrict access to custom meal sharing flows when authenticated.
- Shared-link payload for import excludes ingredient-cost metadata.
- Shared-link behavior is non-expiring and non-revocable by creator policy.
- Recipe records use UUIDv7 primary identifiers.
- Full shared-link values/raw tokens are never emitted in analytics/observability telemetry.
- Image-upload UX must provide progress visibility and retry for recoverable failures.

## Non-Goals
- Automatic nutrient inference from recipe text.
- Ingredient-level micronutrient decomposition.
- Collaborative real-time editing of a single shared recipe entity.

## Open Questions Or Ambiguities
- None currently.
