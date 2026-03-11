# SC-220 Water Tracker (V2)

## Route
- Embedded widget in `/student/home` as `HydrationCard` component (SC-203).
- Embedded widget in `/student/nutrition` as `WaterWidget` component (SC-209).
- Water-goal authoring in nutrition plan builders: `/student/nutrition/plans/:planId` and `/professional/nutrition/plans/:planId` (SC-207).

> No standalone route exists for water tracking. This is intentional per D-115.

## Objective
Allow students to log daily water intake against an effective daily goal and visualize adherence streaks.
Water goals are authored in nutrition plan creation/edit flows for both self-guided students and professionals.

Effective goal precedence (D-081, BR-279): nutritionist-defined goal applies when an active nutrition assignment override exists; otherwise the student's personal goal is used.

## User Actions

### Student
- Log water intake amount (ml) via inline form.
- View today's consumed amount and progress toward effective goal.
- View current streak (consecutive days meeting the effective goal).
- View goal ownership label (personal vs. nutritionist-defined).
- See helper text indicating water goals are defined in nutrition plans.

### Plan authoring (SC-207)
- Student self-guided route defines personal daily water goal while creating/editing nutrition plan.
- Professional route defines assigned-student daily water goal while creating/editing nutrition plan.

## States

| State | Trigger | UI |
|---|---|---|
| Loading | `useWaterTracking` in `loading` phase | `ActivityIndicator` with `a11y.loading.default` label |
| No goal | goal context returns null | Helper text shown, with guidance to define goal in nutrition plan builder |
| Ready | goal context resolved | Progress bar, consumed/goal label, streak, and intake log CTA |
| Error | source fetch or mutation failed | Error message with retry CTA; `accessibilityLiveRegion="polite"` |

## Validation Rules
- Intake amount must be a positive integer (ml). See BR-277.
- Goal must be a positive integer (ml) when authoring nutrition plan.
- Nutritionist goal takes precedence over student personal goal when active nutrition assignment override exists (BR-279).
- Non-complete days (consumed < goal) break the active streak (BR-280).
- Student and professional water-goal edits occur in nutrition plan builder flows.

## Data Contract

### Inputs
| Field | Type | Validation |
|---|---|---|
| `amountMl` | positive integer | required, > 0 |
| `dailyMl` | positive integer | required, > 0 |

### Outputs
| Type | Description |
|---|---|
| `WaterIntakeLog[]` | Daily log entries |
| `EffectiveWaterGoal` | Resolved goal with ownership context |
| `WaterDayStatus` | Per-day met/not-met status |
| `streak` | Consecutive days meeting effective goal |

### Source Operations
| Operation | Actor |
|---|---|
| `getMyWaterLogs` | Student |
| `getMyWaterGoalContext` | Student |
| `logWaterIntake` | Student |
| `createNutritionPlan` / `updateNutritionPlan` (`hydrationGoalMl`) | Student / Nutritionist |

All operations are Firestore-backed in `features/nutrition/water-tracking-source.ts` using the source-layer dependency boundary and normalized source errors.

## Localization Keys

| Key | Screen(s) |
|---|---|
| `student.hydration.card_title` | SC-203 HydrationCard |
| `student.hydration.progress` | SC-203 HydrationCard |
| `student.hydration.streak` | SC-203 HydrationCard |
| `student.hydration.goal_owner_student` | SC-203/SC-209 |
| `student.hydration.goal_owner_nutritionist` | SC-203/SC-209 |
| `student.hydration.cta_log` | SC-209 WaterWidget |
| `student.home.hydration.title` | SC-203 |
| `student.home.hydration.progress` | SC-203 |
| `student.home.hydration.streak` | SC-203 |
| `student.home.hydration.goal_student` | SC-203 |
| `student.home.hydration.goal_nutritionist` | SC-203 |
| `student.home.hydration.no_goal` | SC-203 |
| `student.nutrition.water.goal_defined_in_plan` | SC-209 WaterWidget helper |
| `student.plan.field.hydration_goal.*` | SC-207 student builder |
| `pro.plan.field.hydration_goal.*` | SC-207 professional builder |
| `student.plan.validation.hydration_goal_*` | SC-207 student builder |
| `pro.plan.validation.hydration_goal_*` | SC-207 professional builder |

All keys are present in `en-US`, `pt-BR`, and `es-ES` locale bundles.

## Edge Cases
- No personal goal and no nutritionist goal: show helper text pointing to nutrition plan builder and suppress progress bar.
- Nutritionist goal present but assignment ends: student personal goal becomes effective.
- Zero intake on any day counts as not-met and resets streak from that day onward.
- Assigned-plan hydration goal is only effective while a matching active nutrition assignment exists.

## Implementation Files
| File | Purpose |
|---|---|
| `features/nutrition/water-tracking.logic.ts` | Pure functions: `resolveEffectiveWaterGoal`, `resolveWaterDayStatus`, `calculateWaterStreak`, `validateWaterGoalInput`, `validateWaterIntakeInput`, `normalizeWaterTrackingError` |
| `features/nutrition/water-tracking.logic.test.ts` | Unit tests (included in 301-test suite) |
| `features/nutrition/water-tracking-source.ts` | Firestore source surface with plan-first hydration-goal resolution and backward-compat fallback |
| `features/nutrition/use-water-tracking.ts` | React hook with `idle/loading/ready/error` state machine |
| `app/student/home.tsx` | `HydrationCard` component |
| `app/student/nutrition.tsx` | `WaterWidget` component |
| `app/professional/nutrition/plans/[planId].tsx` | Nutrition plan builder goal authoring |

## Links
| Artifact | IDs |
|---|---|
| Functional requirements | FR-218, FR-219, FR-220, FR-221, FR-222 |
| Use case | UC-002.19 |
| Acceptance criteria | AC-259, AC-260, AC-261, AC-262, AC-263 |
| Business rules | BR-276, BR-277, BR-278, BR-279, BR-280 |
| Test cases | TC-264, TC-265, TC-266, TC-267 |
| Decisions | D-078, D-079, D-081, D-115, D-172 |
| Backlog | BL-104 |
