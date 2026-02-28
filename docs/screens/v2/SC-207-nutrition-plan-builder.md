# SC-207 Nutrition Plan Builder (V2)

## Route
- `/professional/nutrition/plans/:planId`

## Objective
- Let nutritionists create templates and custom plans with calorie/macro targets backed by fatsecret food data.

## User Actions
- Primary:
  - Create or edit meal plan template.
  - Create named predefined nutrition plans in private library.
  - Start from starter template and clone to editable draft.
  - Add foods/meals using fatsecret search.
  - Set calorie and macro targets.
  - Assign plan to selected student or bulk-assign to selected students.
- Secondary:
  - Save draft template for later reuse.
  - Fine-tune per-student drafts before bulk-assignment confirmation.

## States
- Loading: fetch template/plan, fatsecret lookup data, and assignment context.
- Empty: new plan with no meals added.
- Error: fatsecret query failure, save failure, invalid target totals.
- Success: plan saved and optionally assigned.

## Validation Rules
- Macro tracking dimensions: carbs, proteins, fats.
- Professionally assigned plan is student read-only.
- Plan assignment obeys active relationship constraints.
- Starter templates are immutable baselines; edits apply only to cloned drafts.
- Predefined plans require user-defined names and are stored in professional private library.
- Bulk assignment must produce independent per-student plan copies.

## Data Contract
- Inputs:
  - Professional and student context.
  - fatsecret item/nutrient payloads.
  - Target calories and macro values.
- Outputs:
  - Persisted template/plan.
  - Assignment linkage to student and specialty.
  - Bulk-assignment draft set with per-student overrides.

## Edge Cases
- API unavailability should allow retry and preserve unsaved draft state.
- If assignment becomes inactive mid-edit, block publish/assign and allow template save only.
- Starter template updates from system library must not overwrite previously cloned drafts.
- Editing source predefined plan after assignment must not mutate already assigned student copies.

## Links
- Functional requirement: FR-109, FR-110, FR-114, FR-115, FR-117, FR-123, FR-134, FR-212, FR-223, FR-224, FR-225, FR-226
- Use case: UC-002.2, UC-002.14, UC-002.20
- Acceptance criteria: AC-207, AC-209, AC-216, AC-256, AC-264, AC-265
- Business rules: BR-209, BR-210, BR-215, BR-270, BR-281, BR-282, BR-283
- Test cases: TC-207, TC-209, TC-216, TC-260, TC-268, TC-269, TC-270
- Diagram: docs/diagrams/domain-relationships.md
