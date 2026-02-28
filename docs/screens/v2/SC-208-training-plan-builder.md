# SC-208 Training Plan Builder (V2)

## Route
- `/professional/training/plans/:planId`

## Objective
- Let fitness coaches define fully customizable training templates and student-specific plans.

## User Actions
- Primary:
  - Create/edit training templates.
  - Create named predefined training plans in private library.
  - Start from starter template and clone to editable draft.
  - Define custom session structure/fields.
  - Assign training plan to selected student or bulk-assign to selected students.
- Secondary:
  - Duplicate existing template.
  - Fine-tune per-student drafts before bulk-assignment confirmation.

## States
- Loading: fetch template/plan context and assignment info.
- Empty: new plan with no sessions.
- Error: save/assign failure.
- Success: training plan saved and optionally assigned.

## Validation Rules
- No fixed mandatory workout fields beyond system metadata.
- Assigned training plans are read-only for students.
- Assignment must respect active-relationship governance.
- Starter templates are immutable system baselines; edits apply to cloned drafts only.
- Predefined plans require user-defined names and are stored in professional private library.
- Bulk assignment must produce independent per-student plan copies.

## Data Contract
- Inputs:
  - Professional custom schema payload.
  - Student assignment context.
- Outputs:
  - Persisted training template/plan.
  - Student assignment mapping.
  - Bulk-assignment draft set with per-student overrides.

## Edge Cases
- Custom field evolution across template versions must preserve old records.
- Assignment ended state must prevent new assignment from this screen.
- Starter template updates from system library must not mutate existing cloned drafts.
- Editing source predefined plan after assignment must not mutate already assigned student copies.

## Links
- Functional requirement: FR-111, FR-112, FR-123, FR-132, FR-212, FR-223, FR-224, FR-225, FR-226
- Use case: UC-002.2, UC-002.7, UC-002.14, UC-002.20
- Acceptance criteria: AC-208, AC-216, AC-223, AC-256, AC-264, AC-265
- Business rules: BR-209, BR-215, BR-224, BR-270, BR-281, BR-282, BR-283
- Test cases: TC-208, TC-216, TC-224, TC-260, TC-268, TC-269, TC-270
- Diagram: docs/diagrams/domain-relationships.md
