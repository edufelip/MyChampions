# SC-220 Water Tracker (V2)

## Route
- Embedded widget in `/student/home` as `HydrationCard` component (SC-203).
- Embedded widget in `/student/nutrition` as `WaterWidget` component (SC-209).
- Nutritionist override goal form in `/professional/student-profile` (SC-206).

> No standalone route exists for water tracking. This is intentional per D-115.

## Objective
Allow students to log daily water intake against an effective daily goal and visualize adherence streaks.
Allow nutritionists to set or update a water goal for an assigned student.

Effective goal precedence (D-081, BR-279): nutritionist-defined goal applies when an active nutrition assignment override exists; otherwise the student's personal goal is used.

## User Actions

### Student
- Log water intake amount (ml) via inline form.
- Set or update personal daily water goal (ml) via inline form.
- View today's consumed amount and progress toward effective goal.
- View current streak (consecutive days meeting the effective goal).
- View goal ownership label (personal vs. nutritionist-defined).

### Nutritionist (via SC-206)
- Set or update the student's daily water goal (ml).

## States

| State | Trigger | UI |
|---|---|---|
| Loading | `useWaterTracking` in `loading` phase | `ActivityIndicator` with `a11y.loading.default` label |
| No goal | goal context returns null | Set-goal CTA shown; no progress bar |
| Ready | goal context resolved | Progress bar, consumed/goal label, streak, log and set-goal CTAs |
| Error | source fetch or mutation failed | Error message with retry CTA; `accessibilityLiveRegion="polite"` |

## Validation Rules
- Intake amount must be a positive integer (ml). See BR-277.
- Goal must be a positive integer (ml). See BR-276.
- Nutritionist goal takes precedence over student personal goal when active nutrition assignment override exists (BR-279).
- Non-complete days (consumed < goal) break the active streak (BR-280).
- Student personal goal can be set or updated at any time (BR-278).

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
| `setStudentWaterGoal` | Student |
| `setNutritionistWaterGoalForStudent` | Nutritionist |

All operations are stubs in `features/nutrition/water-tracking-source.ts` following the `gql<T>()` + `WaterSourceError` pattern. Data Connect endpoint wiring is deferred (see pending-wiring-checklist-v1.md).

## Localization Keys

| Key | Screen(s) |
|---|---|
| `student.hydration.card_title` | SC-203 HydrationCard |
| `student.hydration.progress` | SC-203 HydrationCard |
| `student.hydration.streak` | SC-203 HydrationCard |
| `student.hydration.goal_owner_student` | SC-203/SC-209 |
| `student.hydration.goal_owner_nutritionist` | SC-203/SC-209 |
| `student.hydration.cta_log` | SC-209 WaterWidget |
| `student.hydration.cta_set_goal` | SC-209 WaterWidget |
| `student.home.hydration.title` | SC-203 |
| `student.home.hydration.progress` | SC-203 |
| `student.home.hydration.streak` | SC-203 |
| `student.home.hydration.goal_student` | SC-203 |
| `student.home.hydration.goal_nutritionist` | SC-203 |
| `student.home.hydration.no_goal` | SC-203 |
| `student.nutrition.water.*` | SC-209 WaterWidget |
| `pro.student_profile.water_goal.*` | SC-206 |

All keys are present in `en-US`, `pt-BR`, and `es-ES` locale bundles.

## Edge Cases
- No personal goal and no nutritionist goal: show set-goal CTA; suppress progress bar.
- Nutritionist goal present but assignment ends: student personal goal becomes effective.
- Zero intake on any day counts as not-met and resets streak from that day onward.
- Nutritionist goal cannot be set without an active nutrition assignment.

## Implementation Files
| File | Purpose |
|---|---|
| `features/nutrition/water-tracking.logic.ts` | Pure functions: `resolveEffectiveWaterGoal`, `resolveWaterDayStatus`, `calculateWaterStreak`, `validateWaterGoalInput`, `validateWaterIntakeInput`, `normalizeWaterTrackingError` |
| `features/nutrition/water-tracking.logic.test.ts` | Unit tests (included in 301-test suite) |
| `features/nutrition/water-tracking-source.ts` | Data Connect stub surface |
| `features/nutrition/use-water-tracking.ts` | React hook with `idle/loading/ready/error` state machine |
| `app/student/home.tsx` | `HydrationCard` component |
| `app/student/nutrition.tsx` | `WaterWidget` component |
| `app/professional/student-profile.tsx` | Nutritionist water goal form |

## Links
| Artifact | IDs |
|---|---|
| Functional requirements | FR-218, FR-219, FR-220, FR-221, FR-222 |
| Use case | UC-002.19 |
| Acceptance criteria | AC-259, AC-260, AC-261, AC-262, AC-263 |
| Business rules | BR-276, BR-277, BR-278, BR-279, BR-280 |
| Test cases | TC-264, TC-265, TC-266, TC-267 |
| Decisions | D-078, D-079, D-081, D-115 |
| Backlog | BL-104 |
