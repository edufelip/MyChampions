# P1 Water Tracking And Predefined Plan Library Spec (Proposed)

## Purpose
Define behavior for two selected P1 items:
- BL-104 water tracking with personal/professional goal ownership.
- BL-106 named predefined plans with clone/bulk assignment and per-student fine-tuning.

## Scope
- Hydration tracking (water only).
- Water-goal ownership and precedence.
- Hydration streak behavior.
- Professional predefined-plan library.
- Bulk assignment workflow and copy isolation.

## Definitions
- Personal water goal: student-defined daily hydration target.
- Nutritionist water goal: assigned professional override target for student hydration.
- Effective water goal: active target used for completion/streak calculations.
- Predefined plan: named professional-owned plan artifact reusable for assignment.

## Expected Behavior
1. Hydration tracking under BL-104 is limited to water intake.
2. Student can log water consumption for each day.
3. Student can set/update personal daily water goal.
4. Assigned nutritionist can set/update water goal for actively assigned student.
5. If nutritionist override exists in active assignment context, it is the effective water goal.
6. If no active nutritionist override exists, student personal goal is effective target.
7. Hydration streak increments on days that meet/exceed effective goal and breaks on non-complete days.
8. Professional can create named predefined nutrition/training plans in private library.
9. Professional can select predefined plan and bulk-assign to multiple students.
10. Professional can fine-tune each student draft before confirming assignments.
11. Assigned plans from bulk flow are independent copies per student.
12. Later edits to source predefined plan do not mutate previously assigned student copies.

## Invariants
- Hydration scope for BL-104 excludes sleep and steps.
- Water-goal precedence is deterministic (nutritionist override > personal fallback).
- Bulk-assigned plans do not share mutable references across students.

## Traceability
- Functional requirements: `FR-218`, `FR-219`, `FR-220`, `FR-221`, `FR-222`, `FR-223`, `FR-224`, `FR-225`, `FR-226`.
- Use cases: `UC-002.19`, `UC-002.20`.
- Acceptance criteria: `AC-259`, `AC-260`, `AC-261`, `AC-262`, `AC-263`, `AC-264`, `AC-265`.
- Business rules: `BR-276`, `BR-277`, `BR-278`, `BR-279`, `BR-280`, `BR-281`, `BR-282`, `BR-283`.
- Test cases: `TC-264`, `TC-265`, `TC-266`, `TC-267`, `TC-268`, `TC-269`, `TC-270`.
- Screens: `SC-203`, `SC-205`, `SC-206`, `SC-207`, `SC-208`, `SC-209`.

## Open Questions
- None currently.
