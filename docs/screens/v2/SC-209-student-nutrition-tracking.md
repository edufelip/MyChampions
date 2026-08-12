# SC-209 Student Nutrition Tracking (V2)

## Route
- `/student/nutrition/today`

## Objective
- Enable daily meal logging, hydration tracking, and macro/calorie tracking against assigned or self-managed targets.

## User Actions
- Primary:
  - Log meal entries.
  - Expand a planned meal to inspect its food items without making the meal logging control a child of another interactive control.
  - Log water intake.
  - Log consumed grams from a saved custom meal.
  - Review daily calorie and macro totals.
  - Review daily water-goal completion and streak status.
  - Submit nutrition plan-change request for assigned plans.
- Secondary:
  - Inspect plan targets and progress breakdown.
  - Navigate to nutrition plan builder to change daily water goal when needed.
  - Open custom meal library/builder.

## States
- Loading: fetch current-day plan targets and existing logs.
- Empty: no active nutrition assignment; show illustrated acquisition empty state with direct nutritionist-hiring CTA and secondary self-guided action that opens student self-managed nutrition plan creation.
- Waiting: active nutritionist Connection exists but no published assigned plan exists; block self-managed create/edit and explain that the nutritionist is preparing the plan.
- Error: log write/read failure.
- Success: totals update and adherence status visible.
- Plan context and plan-change request actions are consumed through centralized plans store via `usePlans`.

## Validation Rules
- Macro totals must reflect carbs, proteins, fats.
- If professional-assigned plan exists, target settings are read-only.
- Draft assigned NutritionPlans are not shown and cannot drive tracking targets.
- Published assigned NutritionPlan takes precedence over Self-Managed Plan while the active nutritionist Connection exists.
- Student may submit change request while assigned-plan edit remains blocked.
- Offline mode must show persistent banner and explicit write-lock reasons for blocked mutations.
- Meal expansion and meal logging are separate accessible controls; the web render must not nest one button inside another.
- Effective hydration target uses nutritionist-defined goal when active assignment override exists; otherwise student personal goal is used.

## Data Contract
- Inputs:
  - Active nutrition plan context (assigned or self-managed).
  - Meal log entries.
  - Water-intake log entries.
  - Effective water-goal target + goal-owner metadata (`student` or `nutritionist`).
  - Nutrient values from selected foods.
  - Optional custom meal definition + consumed grams.
- Outputs:
  - Daily totals and adherence indicators.
  - Daily hydration completion state and streak indicators.
  - Persisted nutrition logs.

## Edge Cases
- When assignment activates while self-managed tracking exists, self-managed plan archives and tracking context switches.
- When active nutritionist Connection exists without published assigned plan, self-managed create/edit remains unavailable until the assigned plan is sent.
- When nutritionist Connection ends, assigned plan archives and the latest tied Self-Managed Plan is restored if present; otherwise no plan is auto-created.
- If no active nutritionist, self-managed plan flow remains available.
- If consumed grams from custom meal exceed meal total grams, proportional scaling still applies.
- If nutritionist override goal is removed or assignment ends, hydration target falls back to stored student personal goal.
- In empty state, acquisition CTA can be primary as long as self-guided creation remains directly available on screen.
- Empty-state self-guided CTA routes to `/student/nutrition/plans/new` so students can start a personal nutrition plan without a professional.
- Student self-guided builder entry uses student-branded titles/actions (for example, `Create my nutrition plan`, `Save my plan`).

## Copy Draft (Current)
- Screen title: `Nutrition`
- Empty state title: `Meal plan unavailable`
- Empty state helper: `To receive a personalized meal plan and reach your goals, you need support from a qualified professional.`
- Empty-state CTA: `Hire a nutritionist`
- Empty-state self-guided CTA: `Create my meal plan`
- Waiting state title: `Your nutritionist is preparing your plan`
- Waiting state helper: `Your nutritionist connection is active. You will see your meal plan here once it is sent.`
- Waiting state CTA: `View my nutritionist`
- Hydration widget title: `Water intake`
- Hydration goal badge (personal): `Personal Goal`
- Hydration goal badge (nutritionist): `Goal set by Nutritionist`
- Hydration intake CTA: `Log Intake`
- Hydration helper: `Water goal is defined in your nutrition plan.`

## Links
- Functional requirement: FR-114, FR-115, FR-116, FR-123, FR-124, FR-135, FR-139, FR-140, FR-141, FR-211, FR-214, FR-218, FR-219, FR-220, FR-221, FR-222
- Use case: UC-002.4, UC-002.13, UC-002.17, UC-002.19, UC-003.2
- Acceptance criteria: AC-209, AC-210, AC-216, AC-217, AC-225, AC-255, AC-257, AC-259, AC-260, AC-261, AC-262, AC-263, AC-403, AC-404, AC-405
- Business rules: BR-208, BR-210, BR-215, BR-216, BR-226, BR-269, BR-272, BR-276, BR-277, BR-278, BR-279, BR-280, BR-304, BR-305, BR-328, BR-329, BR-330, BR-333
- Test cases: TC-209, TC-210, TC-216, TC-217, TC-226, TC-259, TC-261, TC-264, TC-265, TC-266, TC-267, TC-404, TC-405, TC-406
- Diagram: docs/diagrams/role-journey-flow.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
