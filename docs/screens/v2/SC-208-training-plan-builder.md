# SC-208 Training Plan Builder (V2)

## Route
- `/professional/training/plans/:planId` — builder/editor for a specific plan.
- `/professional/training` (tab) — plan library list with create and open CTAs.

> `planId = 'new'` signals plan creation mode. Any other UUID loads an existing plan.

## Objective
Let fitness coaches create and edit fully customizable named predefined training plans stored in their private library. Plans consist of sessions; each session holds custom exercise items (name, quantity/sets-reps, optional notes). Plans can be assigned to individual students or bulk-assigned. Starter templates are available to clone-then-customize.

## Design Structure (D-134)
- Library route (`/professional/training`) uses `DsScreen` shell, DS card surfaces, and DS typography/spacing tokens.
- Empty and error states are presented inside `DsCard` containers with consistent semantics.
- Primary create/retry actions use DS pill buttons and localization-key copy only.
- Builder route (`/professional/training/plans/:planId`) follows the same DS shell and component schema.

## User Actions

### Plan Library (`/professional/training`)
- View list of existing predefined training plans.
- Create a new plan (navigates to builder with `planId = 'new'`).
- Open an existing plan (navigates to builder with the plan's UUID).

### Plan Builder (`/professional/training/plans/:planId`)
- Enter or edit the plan name (required, min 2 chars).
- Add training sessions (name required, notes optional).
- Remove sessions.
- Add exercise items to a session (name required, quantity and notes optional).
- Remove exercise items from a session.
- Pick and clone a starter template (2 hardcoded stubs; D-114).
- Save plan (create or update).
- Assign plan to a student.
- Bulk-assign plan to multiple students with per-student fine-tune step.

## States

| State | Trigger | UI |
|---|---|---|
| Idle | Initial mount | Empty form or loading gated |
| Loading | `loadPlan` called on existing planId | `ActivityIndicator` |
| Saving | `createPlan` or `savePlan` in flight | Save CTA disabled, loading indicator |
| Ready | Plan loaded or created successfully | Full form with sessions/items list, CTAs |
| Error | Source fetch or mutation failed | Inline error with retry; `accessibilityLiveRegion="polite"` |
| Template picker loading | `loadTemplates` called | Template picker loading indicator |
| Template picker ready | Templates fetched | Picker list with 2 stub templates |

## Validation Rules
- Plan name is required and must be at least 2 characters (BR-293).
- Session name is required when adding a session; session notes are optional.
- Exercise item name is required (BR-294); quantity and notes are optional.
- Starter templates are immutable — edits apply to cloned drafts only (BR-295).
- Bulk assignment produces independent per-student plan copies; later library edits do not mutate assigned copies (BR-283, D-082).
- Assigned plans are read-only for students (D-006, D-013).
- No fixed mandatory fields beyond name for session items (D-013).

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

### Outputs
| Type | Description |
|---|---|
| `TrainingPlanDetail` | Full plan with id, name, sessions list, timestamps |
| `TrainingSession` | Session with id, name, notes, items array |
| `TrainingSessionItem` | Exercise item with id, name, quantity, notes |
| `StarterTemplate[]` | 2 hardcoded stub templates (D-114) |

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
| `getStarterTemplates('training')` | Fetch starter template list (stub) |
| `cloneStarterTemplate` | Clone starter into editable draft (stub) |

All Data Connect operations are stubs in `features/plans/plan-builder-source.ts`. Real endpoint wiring is deferred (pending-wiring-checklist-v1.md).

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
| `pro.plan.cta.clone_template` | Start from template CTA |
| `pro.plan.template.starter_label` | Starter templates section label |
| `pro.plan.template.picker_title` | Template picker title |
| `pro.plan.template.cta_use` | Use template CTA |
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
| `pro.template_library.*` | Template library section keys |
| `pro.template.clone_notice` | Template clone helper |

All keys are present in `en-US`, `pt-BR`, and `es-ES` locale bundles.

## Edge Cases
- Starter template cloning is stubbed; `cloneStarterTemplate` calls the Data Connect endpoint (deferred wiring); editing the source template does not mutate existing clones (BR-295).
- If assignment ends while the builder is open: block assign action; plan save remains available.
- Editing a predefined plan after bulk-assignment does not mutate already assigned student copies (D-082, BR-283).
- Custom field evolution across template versions must preserve old records.

## Implementation Files
| File | Purpose |
|---|---|
| `features/plans/plan-builder.logic.ts` | Pure functions: `validateTrainingPlanInput`, `validateTrainingSessionItemInput`, `isStarterTemplate`, `normalizePlanBuilderError` |
| `features/plans/plan-builder.logic.test.ts` | Unit tests (included in 301-test suite) |
| `features/plans/plan-builder-source.ts` | Data Connect stubs: `createTrainingPlan`, `updateTrainingPlan`, `getTrainingPlanDetail`, `addTrainingSession`, `removeTrainingSession`, `addTrainingSessionItem`, `removeTrainingSessionItem`, `getStarterTemplates`, `cloneStarterTemplate` |
| `features/plans/use-plan-builder.ts` | React hook `useTrainingPlanBuilder` with state machine: `idle/loading/ready/saving/error` |
| `app/professional/training.tsx` | Plan library list screen |
| `app/professional/training/plans/[planId].tsx` | Plan builder screen |

## Links
| Artifact | IDs |
|---|---|
| Functional requirements | FR-244, FR-245, FR-246, FR-247, FR-248, FR-223, FR-224, FR-225, FR-226 |
| Use case | UC-002.14, UC-002.20 |
| Acceptance criteria | AC-256, AC-264, AC-265 |
| Business rules | BR-281, BR-282, BR-283, BR-293, BR-294, BR-295 |
| Test cases | TC-268, TC-269, TC-270, TC-277, TC-278, TC-279, TC-280 |
| Decisions | D-013, D-072, D-080, D-082, D-111, D-112, D-114 |
| Backlog | BL-106 |
