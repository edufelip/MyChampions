# SC-208 Training Plan Builder (V2)

## Route
- `/professional/training/plans/:planId` — builder/editor for a specific plan.
- `/professional/training` (tab) — plan library list with create and open CTAs.
- Shared student self-guided alias: `/student/training/plans/:planId` (same builder engine with student-branded titles/actions).

> `planId = 'new'` signals plan creation mode. Any other UUID loads an existing plan.

## Objective
Let fitness coaches create and edit fully customizable named predefined training plans stored in their private library. Plans consist of sessions; each session holds custom exercise items (name, quantity/sets-reps, optional notes). Plans can be assigned to individual students or bulk-assigned.

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

## User Actions

### Plan Library (`/professional/training`)
- View list of existing predefined training plans.
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
- Save plan (create or update) as a single persistence step that writes the current local draft to Firestore.
- Delete plan; after a successful delete, show the blocking loading scrim and then return the user to the training library.
- If the user attempts to leave with unsaved local changes, show a discard-confirmation dialog before navigation.
- Assign plan to a student.
- Bulk-assign plan to multiple students with per-student fine-tune step.

## Exercise Service Search Integration

Exercise items are added via the `ExerciseSearchModal` component, which:
1. Debounces user input (400 ms) and calls `searchExerciseLibrary` via the `useExerciseSearch` hook.
2. Displays a scrollable list of search results (title + localized muscle group + thumbnail).
3. On item selection, shows a detail/confirmation form for `quantity` and `notes`.
4. On confirm, calls `handleConfirmExercise` which adds the item to the local draft; Firestore is updated only when the user presses `Save`.

### Proxy Contract
- Base URL: `https://exerciseservice.eduwaldo.com`
- Endpoint: `POST /proxy`
- Request body shape:
  - `lang`: normalized locale (`en`, `pt`, `es`; fallback `en`)
  - `request.url`: upstream URL under `https://exercise-api.ymove.app/api/v2/exercises...`
  - `request.method`: `GET`
  - `request.headers`: `{ "Accept": "application/json" }`
- Request header: send `x-request-id` on every call.
- Response header: service always returns `x-request-id` for correlation.
- The mobile app never sends YMove API keys; the proxy injects key server-side.

### Video URL Caching Policy (API Contract — Critical)
Upstream pre-signed CDN URLs (video, HLS, thumbnail) **expire after 48 hours**.
- **Only `exerciseId` (the UUID) is persisted to Firestore.**
- Thumbnail/video URLs are **never stored** in Firestore.
- `SessionCard` re-fetches a fresh thumbnail via `useExerciseThumbnail(item.exerciseId)` → `getExerciseById` at display time.
- Legacy `ymoveId` values are still read as fallback for existing records during migration.

## States

| State | Trigger | UI |
|---|---|---|
| Idle | Initial mount | Empty form or loading gated |
| Loading | `loadPlan` called on existing planId | `ActivityIndicator` |
| Saving | `savePlan`, `createPlan` (for a new draft on explicit save), delete plan in flight | Existing builder content stays visible; relevant write CTAs are disabled and a blocking loading scrim with centered spinner is shown |
| Ready | Plan loaded or created successfully | Full form with sessions/items list, CTAs |
| Error | Source fetch or mutation failed | Inline error with retry; `accessibilityLiveRegion="polite"` |

## Validation Rules
- Plan name is required and must be at least 2 characters (BR-293).
- Session name is required when adding a session; session notes are optional.
- Exercise item name is required (BR-294); quantity and notes are optional.
- Bulk assignment produces independent per-student plan copies; later library edits do not mutate assigned copies (BR-283, D-082).
- Assigned plans are read-only for students (D-006, D-013).
- No fixed mandatory fields beyond name for session items (D-013).
- Session add/remove/reorder and item add/remove/reorder are local draft edits only; Firestore is not called until the user presses `Save`.
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
| Item `exerciseId` | string (UUID) | optional; stable upstream exercise ID — only ID field stored in Firestore |

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

Plan library and builder persistence are Firestore-backed via `features/plans/plan-builder-source.ts` and `features/plans/plan-source.ts`.

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
| `pro.plan.item.search.placeholder` | Exercise search input placeholder |
| `pro.plan.item.search.empty` | No results state |
| `pro.plan.item.search.error` | Search error state |
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
| `features/plans/plan-builder-source.ts` | Firestore source ops: `createTrainingPlan`, `updateTrainingPlan`, `getTrainingPlanDetail`, `addTrainingSession`, `removeTrainingSession`, `addTrainingSessionItem`, `removeTrainingSessionItem` |
| `features/plans/use-plan-builder.ts` | React hook `useTrainingPlanBuilder` with state machine: `idle/loading/ready/saving/error` |
| `features/plans/exercise-service-source.ts` | Exercise service proxy client: `searchExerciseLibrary`, `getExerciseById`; types: `ExerciseItem`, `ExerciseVideo`, `ExerciseSearchResult` |
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
| Test cases | TC-268, TC-269, TC-270, TC-277, TC-278, TC-279, TC-280, TC-315, TC-316, TC-317, TC-318, TC-319 |
| Decisions | D-013, D-072, D-080, D-082, D-111, D-112, D-114, D-157 |
| Backlog | BL-106 |
