# SC-215 Custom Meal Library And Quick Log (V2)

## Route
- `/nutrition/custom-meals`

## Objective
- Let any authenticated user browse saved custom meals and log consumed grams quickly.

## UX Copy Intent
- Emphasize fast logging from already-saved meals.
- Keep the grams-to-nutrients outcome clear before confirmation.

## User Actions
- Primary:
  - View saved custom meal list.
  - Select a meal and enter consumed grams.
  - Confirm and save quick log entry.
- Secondary:
  - Open meal builder to create/edit meal.
  - Open share action for owned recipes.

## States
- Loading: fetch custom meal library.
- Empty: no saved meals yet.
- Error: fetch/log save failure.
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
- Use case: UC-003.2, UC-003.3, UC-003.4, UC-003.6
- Acceptance criteria: AC-403, AC-404, AC-405, AC-406, AC-407, AC-408, AC-411, AC-413
- Business rules: BR-304, BR-305, BR-306, BR-307, BR-308, BR-309, BR-310, BR-313, BR-316
- Test cases: TC-404, TC-405, TC-406, TC-407, TC-408, TC-409, TC-412, TC-414, TC-415
- Diagram: docs/diagrams/domain-relationships.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
