# SC-208 Training Plan Builder (V2)

## Route
- `/professional/training/plans/:planId` — builder/editor for a specific plan.
- `/professional/training` (tab) — plan library list with create and open CTAs.
- Shared student route: `/student/training/plans/:planId` renders through the same builder engine but branches on the loaded plan's `sourceKind` (D-006, D-013, ET-107): a `self_managed` plan (including `new`) stays fully editable with student-branded titles/actions; any other `sourceKind` (`assigned`, `predefined`) renders read-only — no Save/Delete/Add-session/reorder/add-item controls, a disabled name field, a localized `student.training.assigned_plan.read_only_notice` banner (`student.training_plan.readOnlyNotice` testID), and a `PlanChangeRequestCard` (`student.training_plan.planChangeForm` testID). The gate is computed by `isReadOnlyForStudentSurface` (`features/plans/plan-ownership.logic.ts`) and fails closed for any non-self-managed source kind.

> `planId = 'new'` signals plan creation mode. Any other UUID loads an existing plan.

## Objective
Let fitness coaches create and edit fully customizable named Professional Library Plans stored in their private library. Plans consist of sessions; each session holds custom exercise items (name, quantity/sets-reps, optional notes). Professional Library Plans can be assigned to individual students or bulk-assigned.

## Design Structure (D-134)
- Library route (`/professional/training`) uses `DsScreen` shell, DS card surfaces, and DS typography/spacing tokens with the SC-204 professional surface baseline (hero header + contextual helper).
- Library header is rendered as an elevated hero card with contextual training icon and compact helper copy.
- Library list rendering uses `FlatList`; route uses `DsScreen scrollable={false}` to avoid nested VirtualizedList containers.
- Empty and error states are presented inside `DsCard` containers with consistent semantics.
- Empty state uses a centered hero treatment (soft glow + icon circle) and localized copy.
- Plan rows use icon-leading card treatment aligned with the nutrition library, including open-status pill + trailing chevron.
- Session cards and the "Add session" form use a reduced vertical padding (`DsSpace.xs` / 8px) to maximize content density.
- Primary create/retry actions use DS pill buttons and localization-key copy only.
- Builder route (`/professional/training/plans/:planId`) follows the same DS shell and component schema.
- Builder route native toolbar is disabled and uses an in-content icon-only back button.
- On compact native viewports, native validation scrolls the builder until the current action (including a reopened plan's `Add session` CTA) is visible. After confirming an exercise it waits for the native modal transition to leave the hierarchy, then adds bottom-navigation clearance before tapping the footer save action below longer session/item content.
- State orchestration uses centralized plans store (`features/plans/plans-store.ts`) through the existing `useTrainingPlanBuilder` adapter hook.

## User Actions

### Plan Library (`/professional/training`)
- View list of existing Professional Library Plans.
- Create a new plan (navigates to builder with `planId = 'new'`).
- Open an existing plan (navigates to builder with the plan's UUID).

### Plan Builder (`/professional/training/plans/:planId`)
- Enter or edit the plan name (required, min 2 chars).
- In create mode (`planId = 'new'`), plan name, sessions, and exercises remain local draft edits until the user explicitly presses `Save`.
- Add training sessions (name required, notes optional).
- When no sessions exist yet, tapping `Add session` opens the creation form in the same empty-state region, layered above the empty-state helper copy instead of pushing it downward.
- The main `Add session` CTA uses a solid accent-green pill treatment with light text so it reads as the primary creation action.
- Remove sessions.
- Add exercise items to a session via proxy-backed exercise search (name required, quantity and notes optional) or by typing a custom name.
- Remove exercise items from a session.
- Save plan (create or update) as a single persistence step that writes the current local draft to the MyChampions server.
- Delete plan; after a successful delete, show the blocking loading scrim and then return the user to the training library.
- If the user attempts to leave with unsaved local changes, show a discard-confirmation dialog before navigation.
- Assign plan to a single student by creating a draft assigned copy, routing the Professional into the builder to fine-tune that Student-specific copy, then publishing it with `Assign & Send`.
- Bulk-assign plan to multiple students only as an explicit send-unchanged action; if per-student fine-tuning is needed, each Student receives an independent draft assigned copy before publishing.

## Exercise Service Search Integration

Exercise items are added via the `ExerciseSearchModal` component, which:
1. Debounces user input (400 ms) and calls `searchExerciseLibrary` via the `useExerciseSearch` hook.
2. Displays a scrollable list of search results (title + localized muscle group + thumbnail).
3. On item selection, shows a detail/confirmation form for `quantity` and `notes`.
4. On confirm, calls `handleConfirmExercise` which adds the item to the local draft; the MyChampions server plan update is sent only when the user presses `Save`.

On web, the search sheet does not use the native slide-in animation: it is viewport-bounded as soon as it opens so the title, Back action, and focused search field are usable on compact mobile emulation. The results region owns its scroll so long result sets do not push the modal outside the viewport.

### Catalog Service Contract
- Base URL: `EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL`
- Search endpoint: `POST /integrations/exercise/search`
- Detail endpoint: `GET /integrations/exercise/exercises/:id`
- Search request body shape:
  - `query`: user-entered exercise search string
  - `lang`: effective app/device locale such as `en-US`, `pt-BR`, or `es-ES`
  - `page`, `pageSize`: pagination controls
- Request headers: send `Authorization: Bearer <MyChampions token>` and `x-request-id` on every call.
- Response header: service always returns `x-request-id` for correlation.
- The mobile app never sends YMove API keys; the MyChampions server reads the mirrored local exercise catalog and owns any upstream/provider integration.

### Video URL Caching Policy (API Contract — Critical)
Upstream pre-signed CDN URLs (video, HLS, thumbnail) **expire after 48 hours**.
- **Only `exerciseId` (the UUID) is persisted to the MyChampions server plan payload.**
- Thumbnail/video URLs are **never stored** in plan persistence.
- `SessionCard` re-fetches a fresh thumbnail via `useExerciseThumbnail(item.exerciseId)` → `getExerciseById` at display time.
- Legacy `ymoveId` values are still read as fallback for existing records during migration.

## States

| State | Trigger | UI |
|---|---|---|
| Idle | Initial mount | Empty form or loading gated |
| Search opened | User taps Add exercise | One named, viewport-bounded `role="dialog"` with `aria-modal="true"`, localized initial helper state, and focused input; web opens without an off-screen transition |
| Loading | `loadPlan` called on existing planId | `ActivityIndicator` |
| Saving | `savePlan`, `createPlan` (for a new draft on explicit save), delete plan in flight | Existing builder content stays visible; relevant write CTAs are disabled and a blocking loading scrim with centered spinner is shown |
| Ready | Plan loaded or created successfully | Full form with sessions/items list, CTAs |
| Error | Source fetch or mutation failed | Inline error with retry; `accessibilityLiveRegion="polite"` |

## Validation Rules
- Plan name is required and must be at least 2 characters (BR-293).
- Session name is required when adding a session; session notes are optional.
- Exercise item name is required (BR-294); quantity and notes are optional.
- Single-student assignment creates an independent draft assigned copy before the plan is visible to the Student.
- Draft assigned plans are completely invisible to the Student, including title, sessions, and exercise items; the Student may only see a generic waiting-for-plan state until publish.
- Bulk assignment produces independent per-student plan copies; later Professional Library Plan edits do not mutate assigned copies (BR-283, D-082). Bulk assignment may publish immediately only when the Professional explicitly chooses a send-unchanged flow.
- Assigned plans are read-only for students (D-006, D-013).
- Published assigned plans remain editable by the owning Professional while the matching `fitness_coach` Connection is active; edits apply directly to the Student-visible plan until a separate audit/change-history workflow is introduced.
- When the matching `fitness_coach` Connection ends, the assigned training plan becomes read-only history and Professional write access stops.
- No fixed mandatory fields beyond name for session items (D-013).
- Session add/remove/reorder and item add/remove/reorder are local draft edits only; the MyChampions server is not called until the user presses `Save`.
- If local draft edits exist, back navigation must require explicit discard confirmation before leaving the screen.

## Data Contract

### Inputs
| Field | Type | Validation |
|---|---|---|
| Plan `name` | string | required, min 2 chars |
| Session `name` | string | required |
| Session `notes` | string | optional |
| Item `name` | string | required |
| Item `quantity` | string | optional free-form (e.g. "3 sets × 10 reps") |
| Item `notes` | string | optional |
| Item `exerciseId` | string (UUID) | optional; stable upstream exercise ID — only ID field stored in plan persistence |

### Outputs
| Type | Description |
|---|---|
| `TrainingPlanDetail` | Full plan with id, name, sessions list, timestamps |
| `TrainingSession` | Session with id, name, notes, items array |
| `TrainingSessionItem` | Exercise item with id, name, quantity, notes, optional exerciseId |

### Exercise Service Types
| Type | Description |
|---|---|
| `ExerciseItem` | Full exercise model used by SC-208 (title, muscleGroup, equipment, difficulty, exerciseType[], instructions[], videos, pre-signed URLs) |
| `ExerciseVideo` | Single video variant (white-background or gym-shot, with tag/orientation/isPrimary) |
| `ExerciseSearchResult` | Proxy search response (`page`, `pageSize`, `total`, `exercises[]`) plus response `x-request-id` metadata |

### Source Operations
| Operation | Description |
|---|---|
| `createTrainingPlan` | Create new plan in professional's library |
| `updateTrainingPlan` | Update plan name |
| `getTrainingPlanDetail` | Load plan with sessions and items |
| `addTrainingSession` | Add session to plan |
| `removeTrainingSession` | Remove session from plan |
| `addTrainingSessionItem` | Add exercise item to session |
| `removeTrainingSessionItem` | Remove exercise item from session |

Plan library reads, predefined assignment/draft operations, and builder mutations use the MyChampions server through `features/plans/plan-source.ts` and `features/plans/plan-builder-source.ts`; outside E2E fixtures, missing local server auth fails closed. Under the explicit provider-free E2E plan fixture, detail resolution loads a newly created assigned draft when its runtime ID is absent from the static builder catalog; an ID absent from both fixture stores still fails closed.

## Localization Keys

| Key | Context |
|---|---|
| `pro.library.training.title` | Library screen header |
| `pro.library.training.empty` | Library empty state |
| `pro.library.training.cta_create` | Create plan CTA |
| `pro.library.cta_open` | Open plan CTA |
| `pro.library.error` | Library load error |
| `pro.plan.training.title.create` | Builder screen title (create mode) |
| `pro.plan.training.title.edit` | Builder screen title (edit mode) |
| `pro.plan.field.name.label` | Plan name field label |
| `pro.plan.field.name.placeholder` | Plan name placeholder |
| `pro.plan.section.sessions` | Sessions section header |
| `pro.plan.cta.add_session` | Add session CTA |
| `pro.plan.cta.add_item` | Add session item CTA |
| `pro.plan.cta.save` | Save plan CTA |
| `pro.plan.cta.assign` | Assign to student CTA |
| `pro.plan.cta.bulk_assign` | Bulk assign CTA |
| `pro.plan.session.field.name.label` | Session name field label |
| `pro.plan.session.field.name.placeholder` | Session name placeholder |
| `pro.plan.session.field.notes.label` | Session notes label |
| `pro.plan.item.field.name.label` | Item name field label |
| `pro.plan.item.field.name.placeholder` | Item name placeholder |
| `pro.plan.item.field.quantity.label` | Item quantity label |
| `pro.plan.item.field.quantity.placeholder` | Item quantity placeholder |
| `pro.plan.item.field.notes.label` | Item notes label |
| `pro.plan.validation.name_required` | Name required error |
| `pro.plan.validation.name_too_short` | Name too short error |
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
| `pro.plan.item.search.dialog_title` | Accessible name for the single exercise-search dialog root |
| `pro.plan.item.search.placeholder` | Exercise search input placeholder |
| `pro.plan.item.search.initial` | Initial helper state before a query is entered |
| `pro.plan.item.search.loading` | Accessible loading announcement while search is pending |
| `pro.plan.item.search.empty` | No results state |
| `pro.plan.item.search.error` | Search error state |
| `pro.plan.item.search.retry` | Retry search CTA in the error state |
| `pro.plan.item.search.back` | "Back to search" link in exercise detail form |
| `exercise.muscle_group.chest` | Muscle group label: Chest |
| `exercise.muscle_group.back` | Muscle group label: Back |
| `exercise.muscle_group.shoulders` | Muscle group label: Shoulders |
| `exercise.muscle_group.biceps` | Muscle group label: Biceps |
| `exercise.muscle_group.triceps` | Muscle group label: Triceps |
| `exercise.muscle_group.forearms` | Muscle group label: Forearms |
| `exercise.muscle_group.quads` | Muscle group label: Quads |
| `exercise.muscle_group.hamstrings` | Muscle group label: Hamstrings |
| `exercise.muscle_group.glutes` | Muscle group label: Glutes |
| `exercise.muscle_group.calves` | Muscle group label: Calves |
| `exercise.muscle_group.core` | Muscle group label: Core |
| `exercise.muscle_group.full_body` | Muscle group label: Full Body |

All keys are present in `en-US`, `pt-BR`, and `es-ES` locale bundles.

## Edge Cases
- If assignment ends while the builder is open: block assign action; plan save remains available.
- Editing a predefined plan after bulk-assignment does not mutate already assigned student copies (D-082, BR-283).
- Custom field evolution across template versions must preserve old records.

## Implementation Files
| File | Purpose |
|---|---|
| `features/plans/plan-builder.logic.ts` | Pure functions: `validateTrainingPlanInput`, `validateTrainingSessionItemInput`, `isStarterTemplate`, `normalizePlanBuilderError` |
| `features/plans/plan-builder.logic.test.ts` | Unit tests (included in 301-test suite) |
| `features/plans/plan-builder-source.ts` | Server source ops: `createTrainingPlan`, `updateTrainingPlan`, `getTrainingPlanDetail`, session/item mutations, starter templates, and food search |
| `features/plans/use-plan-builder.ts` | React hook `useTrainingPlanBuilder` with state machine: `idle/loading/ready/saving/error` |
| `features/plans/exercise-service-source.ts` | MyChampions server exercise catalog client: `searchExerciseLibrary`, `getExerciseById`; types: `ExerciseItem`, `ExerciseVideo`, `ExerciseSearchResult` |
| `features/plans/use-exercise-search.ts` | Hook `useExerciseSearch` — state machine: `idle/loading/error/done` |
| `features/plans/use-exercise-thumbnail.ts` | Hook `useExerciseThumbnail(exerciseId)` — fetches fresh thumbnail URL on demand; never caches |
| `components/ds/patterns/ExerciseSearchModal.tsx` | Two-phase modal: search results list → exercise detail/confirm form |
| `features/plans/components/SessionCard.tsx` | Renders session items; `SessionItemRow` sub-component calls `useExerciseThumbnail` per item |
| `app/professional/training.tsx` | Plan library list screen |
| `app/professional/training/plans/[planId].tsx` | Plan builder screen |

## Links
| Artifact | IDs |
|---|---|
| Functional requirements | FR-244, FR-245, FR-246, FR-247, FR-248, FR-254, FR-255, FR-256, FR-223, FR-224, FR-225, FR-226 |
| Use case | UC-002.14, UC-002.20 |
| Acceptance criteria | AC-256, AC-264, AC-265 |
| Business rules | BR-281, BR-282, BR-283, BR-293, BR-294, BR-303, BR-304, BR-305, BR-306 |
| Test cases | TC-268, TC-269, TC-269A, TC-270, TC-277, TC-278, TC-279, TC-280, TC-315, TC-316, TC-317, TC-318, TC-319 |
| Decisions | D-013, D-072, D-080, D-082, D-111, D-112, D-114, D-157, D-173 |
| Backlog | BL-106 |
