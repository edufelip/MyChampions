# SC-207 Nutrition Plan Builder (V2)

## Route
- `/professional/nutrition/plans/:planId` — builder/editor for a specific plan.
- `/professional/nutrition` (tab) — plan library list with create and open CTAs.
- Shared student self-guided alias: `/student/nutrition/plans/:planId` (same builder engine with student-branded titles/actions).

> `planId = 'new'` signals plan creation mode. Any other UUID loads an existing plan.

## Objective
Let nutritionists create and edit named predefined nutrition plans (calorie/macro targets + food item list) stored in their private library. Plans can be assigned to individual students or bulk-assigned.

## Design Structure (D-134)
- Library route (`/professional/nutrition`) uses `DsScreen` as shell with DS spacing/typography tokens and the SC-204 professional surface baseline (hero header + contextual helper).
- Library header is rendered as an elevated hero card with contextual nutrition icon and compact helper copy.
- Library list rendering uses `FlatList`; route uses `DsScreen scrollable={false}` to avoid nested VirtualizedList containers.
- Empty, error, and plan-list framing use `DsCard` surfaces with shared radius and border semantics.
- Empty state uses a centered hero treatment (soft glow + icon circle) and localized copy.
- Plan rows include icon-leading visual treatment, open-status pill, and trailing chevron for faster scanability.
- Primary actions (create/retry) use DS pill buttons and keep localization-key based copy.
- Builder route (`/professional/nutrition/plans/:planId`) follows the same DS primitives/pattern layer.
- Builder route native toolbar is disabled and uses an in-content icon-only back button.
- State orchestration uses centralized plans store (`features/plans/plans-store.ts`) through the existing `useNutritionPlanBuilder` adapter hook.

## User Actions

### Plan Library (`/professional/nutrition`)
- View list of existing predefined nutrition plans.
- Create a new plan (navigates to builder with `planId = 'new'`).
- Open an existing plan (navigates to builder with the plan's UUID).

### Plan Builder (`/professional/nutrition/plans/:planId`)
- Enter or edit the plan name (required, min 2 chars).
- Enter or edit daily water goal (required, positive integer ml).
- Enter or edit calorie target (optional, must be ≥ 0).
- Enter or edit carbs/proteins/fats targets (optional, must be ≥ 0).
- Add food items (name, quantity, optional notes).
- Remove food items.
- Search foods via VPS food-search microservice integration (`https://foodservice.eduwaldo.com/searchFoods`).
- Save plan (create or update).
- Delete plan; after a successful delete, show the blocking loading scrim and then return the user to the nutrition library.
- Assign plan to a student.
- Bulk-assign plan to multiple students with per-student fine-tune step.

## States

| State | Trigger | UI |
|---|---|---|
| Idle | Initial mount | Empty form or loading gated |
| Loading | `loadPlan` called on existing planId | `ActivityIndicator` |
| Saving | `createPlan`, `savePlan`, delete plan, add/remove/reorder meal/item in flight | Existing builder content stays visible; relevant write CTAs are disabled and a blocking loading scrim with centered spinner is shown |
| Ready | Plan loaded or created successfully | Full form with item list, CTAs |
| Error | Source fetch or mutation failed | Inline error with retry; `accessibilityLiveRegion="polite"` |
| Food search idle | No query | Placeholder shown |
| Food search searching | Query in flight | Search loading indicator |
| Food search done | Results returned | Result list (empty state helper shown) |

## Validation Rules
- Plan name is required and must be at least 2 characters (BR-291).
- Daily water goal is required and must be greater than zero.
- Calorie target must be zero or greater if provided (BR-292).
- Carbs, proteins, and fats targets must each be zero or greater if provided (BR-292).
- Bulk assignment produces independent per-student plan copies; later library edits do not mutate assigned copies (BR-283, D-082).
- Assigned plans are read-only for students (D-006).
- Meal add/remove/item mutations must not clear already rendered builder content while the request is still pending; UI remains visible until the mutation resolves.

## Data Contract

### Inputs
| Field | Type | Validation |
|---|---|---|
| `name` | string | required, min 2 chars |
| `hydrationGoalMl` | string (raw field) | required, positive integer |
| `caloriesTarget` | string (raw field) | optional, ≥ 0 when provided |
| `carbsTarget` | string (raw field) | optional, ≥ 0 when provided |
| `proteinsTarget` | string (raw field) | optional, ≥ 0 when provided |
| `fatsTarget` | string (raw field) | optional, ≥ 0 when provided |
| Meal item `name` | string | required |
| Meal item `quantity` | string | optional free-form |
| Meal item `notes` | string | optional |

### Outputs
| Type | Description |
|---|---|
| `NutritionPlanDetail` | Full plan with id, name, macro targets, items list, timestamps |
| `NutritionMealItem` | Individual food item with id, name, quantity, notes |
| `NutritionTotals` | Parsed numeric totals from raw string inputs |
| `FoodSearchResult[]` | Normalized food search results from VPS food-search service integration |

### Food Search Service Contract
| Field | Value |
|---|---|
| URL | `https://foodservice.eduwaldo.com/searchFoods` |
| Method | `POST` |
| Headers | `Content-Type: application/json`, `Authorization: Bearer <Firebase ID token>` |
| Request body | `{ query: string, maxResults: number, region: string, language: string }` |
| Success body | `{ results: Array<{ id: string, name: string, carbohydrate: number, protein: number, fat: number, serving: 100 }> }` |
| Client normalization | App maps macros to per-100g result fields and derives calories as `carbohydrate*4 + protein*4 + fat*9` |
| Known errors | `400` (`bad_request`), `401`, `429`, `500`, `502` (`upstream_ip_not_allowlisted` / `upstream_error`), and `200 { error: "quota_exceeded" }` |

### Source Operations
| Operation | Description |
|---|---|
| `createNutritionPlan` | Create new plan in professional's library |
| `updateNutritionPlan` | Update plan name and macro targets |
| `getNutritionPlanDetail` | Load plan with items |
| `addNutritionMealItem` | Add food item to plan |
| `removeNutritionMealItem` | Remove food item from plan |
| `searchFoods` | VPS food-search service source |

Plan library and builder persistence are Firestore-backed via `features/plans/plan-builder-source.ts` and `features/plans/plan-source.ts`.

## Localization Keys

| Key | Context |
|---|---|
| `pro.library.nutrition.title` | Library screen header |
| `pro.library.nutrition.empty` | Library empty state |
| `pro.library.nutrition.cta_create` | Create plan CTA |
| `pro.library.cta_open` | Open plan CTA |
| `pro.library.error` | Library load error |
| `pro.plan.nutrition.title.create` | Builder screen title (create mode) |
| `pro.plan.nutrition.title.edit` | Builder screen title (edit mode) |
| `pro.plan.field.name.label` | Plan name field label |
| `pro.plan.field.name.placeholder` | Plan name placeholder |
| `pro.plan.field.hydration_goal.label` | Daily water-goal field label |
| `pro.plan.field.hydration_goal.placeholder` | Daily water-goal placeholder |
| `pro.plan.field.calories_target.label` | Calorie target label |
| `pro.plan.field.carbs_target.label` | Carbs target label |
| `pro.plan.field.proteins_target.label` | Proteins target label |
| `pro.plan.field.fats_target.label` | Fats target label |
| `pro.plan.section.meals` | Meals section header |
| `pro.plan.cta.add_meal` | Add food item CTA |
| `pro.plan.cta.save` | Save plan CTA |
| `pro.plan.cta.assign` | Assign to student CTA |
| `pro.plan.cta.bulk_assign` | Bulk assign CTA |
| `pro.plan.food_search.placeholder` | Food search input placeholder |
| `pro.plan.food_search.empty` | Empty food search result |
| `pro.plan.food_search.error.quota` | Food search rate-limit feedback |
| `pro.plan.food_search.stub_notice` | Empty meal helper text |
| `pro.plan.validation.name_required` | Name required error |
| `pro.plan.validation.name_too_short` | Name too short error |
| `pro.plan.validation.hydration_goal_required` | Hydration-goal required error |
| `pro.plan.validation.hydration_goal_positive` | Hydration-goal positive error |
| `pro.plan.validation.calories_non_negative` | Negative calories error |
| `pro.plan.validation.macros_non_negative` | Negative macros error |
| `pro.plan.error.save` | Save error |
| `pro.plan.error.load` | Load error |
| `pro.plan.error.assign` | Assign error |
| `pro.plan.assign.title` | Assign modal title |
| `pro.plan.assign.student_count` | Student count label |
| `pro.plan.assign.confirm` | Confirm assign CTA |
| `pro.plan.assign.fine_tune_notice` | Fine-tune notice |
| `pro.plan.predefined.label` | Predefined plan badge |
| `pro.predefined_plan.field_name` | Predefined plan name label |
| `pro.predefined_plan.cta_create` | Save predefined plan CTA |
| `pro.predefined_plan.bulk_assign.*` | Bulk assign flow keys |

All keys are present in `en-US`, `pt-BR`, and `es-ES` locale bundles.

## Edge Cases
- Food service unavailable/rate-limited: source call returns typed error and UI surfaces fallback copy.
- If assignment becomes inactive mid-edit: block assign action; plan save remains available.
- Editing a predefined plan after it has been bulk-assigned does not mutate already assigned student copies (D-082, BR-283).

## Implementation Files
| File | Purpose |
|---|---|
| `features/plans/plan-builder.logic.ts` | Pure functions: `validateNutritionPlanInput`, `calculateNutritionTotals`, `isStarterTemplate`, `normalizePlanBuilderError` |
| `features/plans/plan-builder.logic.test.ts` | Unit tests (included in 301-test suite) |
| `features/plans/plan-builder-source.ts` | Firestore source ops: `createNutritionPlan`, `updateNutritionPlan`, `getNutritionPlanDetail`, `addNutritionMealItem`, `removeNutritionMealItem`, `searchFoods` |
| `features/plans/use-plan-builder.ts` | React hook `useNutritionPlanBuilder` with state machine: `idle/loading/ready/saving/error` |
| `app/professional/nutrition.tsx` | Plan library list screen |
| `app/professional/nutrition/plans/[planId].tsx` | Plan builder screen |

## Links
| Artifact | IDs |
|---|---|
| Functional requirements | FR-240, FR-241, FR-242, FR-243, FR-247, FR-248, FR-223, FR-224, FR-225, FR-226 |
| Use case | UC-002.14, UC-002.20 |
| Acceptance criteria | AC-256, AC-264, AC-265 |
| Business rules | BR-281, BR-282, BR-283, BR-291, BR-292 |
| Test cases | TC-268, TC-269, TC-270, TC-275, TC-276, TC-280 |
| Decisions | D-072, D-080, D-082, D-111, D-112, D-113, D-114, D-173 |
| Backlog | BL-106 |
