# SC-207 Nutrition Plan Builder (V2)

## Route
- `/professional/nutrition/plans/:planId` — builder/editor for a specific plan.
- `/professional/nutrition/plans/:planId/meals/:mealId` — meal-item builder for a meal inside a nutrition plan.
- `/professional/nutrition` (tab) — plan library list with create and open CTAs.
- Shared student route: `/student/nutrition/plans/:planId` renders through the same builder engine but branches on the loaded plan's `sourceKind` (D-006, ET-107): a `self_managed` plan (including `new`) stays fully editable with student-branded titles/actions; any other `sourceKind` (`assigned`, `predefined`) renders read-only — no Save/Delete/Add-meal/reorder controls, disabled name/hydration fields, a localized `student.nutrition.assigned_plan.read_only_notice` banner (`student.nutrition_plan.readOnlyNotice` testID), and a `PlanChangeRequestCard` (`student.nutrition_plan.planChangeForm` testID). The gate is computed by `isReadOnlyForStudentSurface` (`features/plans/plan-ownership.logic.ts`) and fails closed for any non-self-managed source kind. The nested meal route (`/student/nutrition/plans/:planId/meals/:mealId`) applies the same gate to item add/remove.

> `planId = 'new'` signals plan creation mode. Any other UUID loads an existing plan.

## Objective
Let nutritionists create and edit named predefined nutrition plans (calorie/macro targets + food item list) stored in their private library, then create student-specific assigned drafts for connected Students. Student route aliases create Self-Managed Plans, not predefined plans.

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
- A fresh professional builder reaches the Ready state after route-scope reset and exposes the Add meal action immediately after plan metadata is entered, including at 390x844 and 320x720 compact web viewports.
- The `PlanMetadataForm` name field (`pro.plan.metadata.name` testID, shared by the nutrition and training builders) renders `multiline` whenever the plan is read-only (an assigned plan viewed by a Student, D-006). At 320px width a long plan name — e.g. "Assigned Nutrition Plan" — now wraps onto a second line instead of being hard-clipped mid-word by the single-line editable `<TextInput>` (ET-165). The professional's own editable name field stays single-line so Enter still advances focus to the hydration field.
- Native professional and self-managed builder validation submits the controlled
  name and hydration values before save and verifies both exact values. From
  name to hydration, Android dismisses Gboard through native Back and taps the
  semantic hydration field; iOS Return invokes the form's intentional focus
  handoff and validation waits for hydration to report focused without
  re-tapping through the keyboard-type transition. The hydration editor is then
  dismissed through the same platform path before waiting for the save control
  to report enabled.
- Native compact-viewport coverage scrolls the mounted add-meal confirmation
  control fully into view after asserting the exact meal name and dismissing
  its editor through native Back on Android or Return on iOS, and before
  tapping it. After opening the taller add-food form, coverage asserts that the
  form is mounted in measured page flow and scrolls the search input, result,
  quantity, and add action into view instead of requiring the entire form to
  satisfy a visibility threshold. Search asserts the exact query, dismisses
  Gboard, and waits for the debounced result on Android or uses iOS Return, and
  after a successful Add the editor leaves the native hierarchy before coverage
  targets the new row's visible remove action. Removal selects the semantic
  localized confirmation action without screen coordinates.
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
- In a new plan with no meals, use Add meal to create the first meal before adding food items.
- Add food items (name, quantity, optional notes).
- Add saved CustomMeals from the current user's library as copied meal snapshots.
- Remove food items.
- Search foods via the MyChampions server `POST /integrations/food/search` route backed by the local catalog Postgres mirror.
- Save plan (create or update).
- Delete plan; after a successful delete, show the blocking loading scrim and then return the user to the nutrition library.
- Assign plan to a student with an active nutritionist Connection.
- Bulk-assign plan to active nutritionist-connected Students with per-student fine-tune step.
- Send/publish assigned drafts when ready.

## States

| State | Trigger | UI |
|---|---|---|
| Idle | Initial mount | Empty form or loading gated |
| Loading | `loadPlan` called on existing planId | `ActivityIndicator` |
| Saving | `createPlan`, `savePlan`, delete plan, add/remove/reorder meal/item in flight | Existing builder content stays visible; relevant write CTAs are disabled and a blocking loading scrim with centered spinner is shown |
| Ready | Plan loaded or created successfully | Full form with item list, CTAs |
| Error | Initial `loadPlan` fetch failed | Replaces the form entirely with a `DsCard` error state (`role="alert"`, `accessibilityLiveRegion="polite"`): message, Retry (re-invokes `loadPlan`), and Back to library. No metadata inputs, add-meal, or Save controls are mounted while in this state. |
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
- Draft assigned NutritionPlans are invisible to Students and cannot become Effective Plans until sent/published.
- Published assigned NutritionPlans remain editable by the owning Professional while the matching active nutritionist Connection exists.
- Assigned create/send/bulk assignment requires active nutritionist Connection and nutrition-scoped targets.
- Professionals without nutritionist Specialty cannot access this route; their Nutrition tab is hidden and direct `/professional/nutrition` entry redirects to the dashboard.
- Professionals cannot add Student-owned CustomMeals into assigned plans unless shared/imported first; assigned meals use stable snapshots.
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
| Meal item `sourceKind` | `manual \| food_search \| custom_meal` | CustomMeal selections persist `custom_meal` |
| Meal item `customMealSnapshot` | object | copied snapshot with name, serving grams, calories, macros, and source kind; excludes reusable meal id/owner/cost/image/timestamps |

### Outputs
| Type | Description |
|---|---|
| `NutritionPlanDetail` | Full plan with id, name, macro targets, items list, timestamps |
| `NutritionMealItem` | Individual food item with id, name, quantity, notes |
| `CustomMealPlanSnapshot` | CustomMeal-derived plan item snapshot containing display/nutrition facts only, without direct reusable meal access |
| `NutritionTotals` | Parsed numeric totals from raw string inputs |
| `FoodSearchResult[]` | Normalized food search results from the MyChampions server food integration |

### Food Search Server Contract
| Field | Value |
|---|---|
| URL | MyChampions server `POST /integrations/food/search` |
| Method | `POST` |
| Headers | `Content-Type: application/json`, `Authorization: Bearer <MyChampions token>` |
| Request body | `{ query: string, maxResults: number, region: string, language: string }` |
| Success body | `{ results: Array<{ id: string, name: string, carbohydrate: number, protein: number, fat: number, serving: 100 }> }` |
| Client normalization | App maps macros to per-100g result fields and derives calories as `carbohydrate*4 + protein*4 + fat*9` |
| Known errors | `400` (`bad_request`), `401`, `429`, `500`, `502` (`upstream_ip_not_allowlisted` / `upstream_error`), and `200 { error: "quota_exceeded" }` |

### Source Operations
| Operation | Description |
|---|---|
| `createNutritionPlan` | Create new professional-library, assigned-draft, or student self-managed plan according to route context |
| `updateNutritionPlan` | Update plan name and macro targets |
| `getNutritionPlanDetail` | Load plan with items |
| `addNutritionMealItem` | Add food item to plan |
| `removeNutritionMealItem` | Remove food item from plan |
| `searchFoods` | MyChampions server food-search source backed by the local catalog mirror |
| `getMyCustomMeals` | Load the current user's saved CustomMeal library for snapshot insertion |

Plan library and builder persistence use the MyChampions server through `features/plans/plan-builder-source.ts` and `features/plans/plan-source.ts`; outside E2E fixtures, missing local server auth fails closed. Under the explicit provider-free E2E plan fixture, detail resolution loads a newly created assigned draft when its runtime ID is absent from the static builder catalog; an ID absent from both fixture stores still fails closed.

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
| `pro.plan.custom_meal.section` | CustomMeal picker section header |
| `pro.plan.custom_meal.empty` | Empty CustomMeal picker state |
| `pro.plan.custom_meal.badge` | Selected CustomMeal snapshot badge |
| `pro.plan.validation.name_required` | Name required error |
| `pro.plan.validation.name_too_short` | Name too short error |
| `pro.plan.validation.hydration_goal_required` | Hydration-goal required error |
| `pro.plan.validation.hydration_goal_positive` | Hydration-goal positive error |
| `pro.plan.validation.calories_non_negative` | Negative calories error |
| `pro.plan.validation.macros_non_negative` | Negative macros error |
| `pro.plan.error.save` | Save error |
| `pro.plan.error.load` | Load error |
| `pro.plan.error.cta_back_to_library` | Back to library CTA on the load-error state |
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
- Selecting a CustomMeal copies its current name, serving grams, calories, macros, and `custom_meal` source kind into the plan item; later CustomMeal edits do not mutate the plan item.
- CustomMeal snapshots never persist reusable meal ids, owner ids, ingredient cost, image URLs, or timestamps.
- If assignment becomes inactive mid-edit: block assigning and saving assigned-plan changes; only independent Professional Library Plan edits remain available.
- Editing a predefined plan after it has been bulk-assigned does not mutate already assigned student copies (D-082, BR-283).
- If a Student opens self-managed create/edit while an active nutritionist Connection exists, block save and return to the waiting nutrition state.

## Implementation Files
| File | Purpose |
|---|---|
| `features/plans/plan-builder.logic.ts` | Pure functions: `validateNutritionPlanInput`, `calculateNutritionTotals`, `isStarterTemplate`, `normalizePlanBuilderError` |
| `features/plans/plan-builder.logic.test.ts` | Unit tests (included in 301-test suite) |
| `features/plans/plan-builder-source.ts` | Server source ops: `createNutritionPlan`, `updateNutritionPlan`, `getNutritionPlanDetail`, meal/item mutations, starter templates, and `searchFoods` |
| `features/nutrition/custom-meal.logic.ts` | CustomMeal plan snapshot helper |
| `features/nutrition/custom-meal.logic.test.ts` | Snapshot privacy/unit coverage |
| `features/plans/use-plan-builder.ts` | React hook `useNutritionPlanBuilder` with state machine: `idle/loading/ready/saving/error` |
| `features/professional/nutrition-specialty-gate.logic.test.ts` | Pure resolver coverage for Student access and Professional nutritionist Specialty gate |
| `app/professional/nutrition.tsx` | Plan library list screen |
| `app/professional/nutrition/plans/[planId].tsx` | Plan builder screen |
| `app/professional/nutrition/plans/[planId]/meals/[mealId].tsx` | Meal builder screen |

## Links
| Artifact | IDs |
|---|---|
| Functional requirements | FR-240, FR-241, FR-242, FR-243, FR-247, FR-248, FR-223, FR-224, FR-225, FR-226 |
| Use case | UC-002.14, UC-002.20 |
| Acceptance criteria | AC-256, AC-264, AC-265, AC-267, AC-541 |
| Business rules | BR-281, BR-282, BR-283, BR-291, BR-292, BR-328, BR-331, BR-332, BR-334, BR-337, BR-343 |
| Test cases | TC-268, TC-269, TC-269A, TC-270, TC-275, TC-275A, TC-276, TC-277, TC-280, TC-328 |
| Decisions | D-072, D-080, D-082, D-111, D-112, D-113, D-114, D-173, D-194 |
| Backlog | BL-106 |
