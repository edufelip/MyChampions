# SC-206 Student Profile (Professional View) (V2)

## Route
- `/professional/students/:studentId`

## Objective
- Enable per-student assignment oversight and plan authoring/assignment workflows.

## Design Structure (D-134)
- Screen shell uses `DsScreen` with shared blob background and semantic DS theme tokens.
- Assignment and plan-change triage sections are presented as stacked `DsCard` blocks with consistent spacing/radius.
- Primary/secondary actions use DS pill button treatment; destructive action keeps warning color semantics.
- Offline/write-lock communication uses DS warning/offline surfaces while preserving existing business gating logic.
- Native toolbar is disabled; this pushed route uses an in-content icon-only back button.

## User Actions
- Primary:
  - View student assignment status by specialty.
  - Assign or update nutrition plan.
  - Assign or update training plan.
  - Review student-submitted plan change requests.
  - Confirm pending invite-based assignment.
  - Unbind assignment.
- Secondary:
  - Review archived student self-managed plans when consent exists.

## States
- Loading: fetch student profile, assignments, plan history, and consent flags.
- Empty: student has no current plan in one or both specialties.
- Error: load or save operations fail.
- Success: profile and assignment controls available.

## Validation Rules
- Must preserve one-active-professional-per-specialty invariant.
- Assigned plans become read-only to student.
- Archived self-managed plans visible only with student consent.
- If professional entitlement is inactive while above cap, plan assignment/update actions are locked.
- Plan change requests are advisory and must not grant direct student edit rights to assigned plans.

## Data Contract
- Inputs:
  - Student profile context.
  - Assignment lifecycle state.
- Plan records (assigned/self-managed/archived).
  - Plan change request records linked to assigned plan contexts.
  - Consent grant flag.
- Outputs:
  - Assignment confirmation/unbind actions.
  - Plan assignment updates.
  - Plan-change request triage actions.

## Edge Cases
- Re-assignment requires prior active binding to end first.
- Consent revoked after professional opens history should hide further access.
- When entitlement lock is active, screen remains readable but all write CTAs are disabled with lock explanation.
- Water-goal changes are authored inside nutrition plan builder/assignment flows, not directly in SC-206.

## Links
- Functional requirement: FR-106, FR-107, FR-108, FR-121, FR-123, FR-124, FR-125, FR-130, FR-131, FR-185, FR-211
- Use case: UC-002.2, UC-002.3, UC-002.5, UC-002.6, UC-002.13
- Acceptance criteria: AC-203, AC-204, AC-205, AC-214, AC-216, AC-217, AC-218, AC-222, AC-255, AC-311
- Business rules: BR-203, BR-204, BR-205, BR-213, BR-215, BR-216, BR-217, BR-222, BR-223, BR-247, BR-269
- Test cases: TC-204, TC-205, TC-214, TC-216, TC-217, TC-218, TC-219, TC-223, TC-259, TC-310
- Diagram: docs/diagrams/domain-relationships.md
