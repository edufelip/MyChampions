# SC-202 Professional Specialty Setup (V2)

## Route
- `/onboarding/professional-specialty`
- `/professional/settings/specialties` (post-onboarding edit entry)

## Objective
- Capture and manage professional specialty profile and optional per-specialty registry credentials.

## Design Structure (D-134)
- Screen shell uses `DsScreen` with shared blob background and DS semantic color tokens.
- Specialty rows, credential form, and removal-assist state are rendered as stacked `DsCard` containers.
- Primary and secondary specialty actions use DS pill-button treatment, with destructive intent preserved.
- Offline communication uses `DsOfflineBanner` while keeping existing BL-008 write-lock behavior.
- Native toolbar is disabled; this pushed route uses an in-content icon-only back button.

## User Actions
- Primary:
  - Choose specialty: Nutritionist, Fitness Coach, or Both.
  - Submit optional per-specialty `professional_registry` credential.
  - Skip credential submission and continue.
- Secondary:
  - Edit submitted credential info.
  - Add specialty post-onboarding.
  - Remove specialty when policy allows.
  - Open direct blocker-resolution actions when removal is blocked.

## States
- Loading: fetch specialty profile and persist specialty updates.
- Empty: no specialty selected yet.
- Error: save failure or malformed credential payload.
- Success: specialty changes persisted.

## Validation Rules
- At least one specialty must be selected.
- Credential submission is optional and cannot block onboarding completion.
- At most one `professional_registry` credential record is accepted per specialty in MVP.
- Removing a specialty is blocked if that specialty has active or pending students.
- Removing a specialty is blocked if it would leave account with zero specialties.
- Blocked specialty-removal state must expose direct assist actions (view active/pending blockers and queue-management shortcuts).
- Accessibility baseline applies for text scaling, focus order, contrast, and screen-reader labels.

## Data Contract
- Inputs:
  - Professional account identifier.
  - Specialty selection.
  - Optional specialty-scoped credential metadata (`professional_registry`).
- Outputs:
  - Persisted specialty profile.
  - Optional credential submission record.

## Edge Cases
- Dual-specialty selection enables both professional capabilities.
- Skipped credential submission leaves specialty active without credential record.
- Credential status is internal and must not generate student-facing verification badges/filters.
- In country/context without applicable registry, user can skip credential submission.
- Specialty-removal flow remains blocked until all active/pending blockers are resolved.

## Links
- Functional requirement: FR-103, FR-119, FR-158, FR-174, FR-175, FR-176, FR-177, FR-216, FR-217
- Use case: UC-002.1, UC-002.1b, UC-002.1c, UC-002.16, UC-002.18
- Acceptance criteria: AC-202, AC-212, AC-226, AC-234, AC-235, AC-236, AC-258, AC-512
- Business rules: BR-202, BR-212, BR-229, BR-237, BR-238, BR-239, BR-274, BR-275
- Test cases: TC-202, TC-203, TC-212, TC-227, TC-236, TC-237, TC-238, TC-239, TC-262, TC-263, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
