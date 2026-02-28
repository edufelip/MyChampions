# Milestone B/C UX Hardening Spec (Proposed)

## Purpose
Define behavior for the remaining P0 UX hardening scope after Milestone A, focused on queue operations, guided recovery states, plan-request collaboration, and accessibility baseline.

## Scope
- Pending-request cancellation visibility after invite-code regeneration.
- Professional pending queue tools (search/filter/bulk deny).
- Specialty-removal assist actions when blocked by active/pending links.
- Student plan-change request submission for assigned plans.
- Professional starter template flows for nutrition/training builders.
- Recipe image upload progress and retry behavior.
- Persistent offline banner + write-lock reason states.
- Subscription pre-lapse warning before lock enforcement.
- MVP accessibility baseline on core screens.

## Definitions
- Pre-lapse warning: warning state shown before entitlement lock to reduce abrupt lock transitions.
- Plan-change request: student-originated request attached to assigned plan context; advisory only.
- Starter template: immutable system baseline cloned into editable draft before assignment.

## Expected Behavior
1. Regenerating invite code auto-cancels impacted pending requests and shows reason + reconnect CTA to students.
2. Professional pending queue supports search/filter and bulk deny with lifecycle-safe transitions.
3. Specialty-removal blocked state links directly to blocker-resolution actions.
4. Assigned-plan students can submit change requests without gaining direct edit permissions.
5. Professionals can start plan authoring from starter templates that clone to editable drafts.
6. Recipe image upload shows progress; recoverable failures show reason + retry and preserve draft fields.
7. Offline mode shows persistent read-only banner and explicit write-lock reason on blocked writes.
8. Entitlement-at-risk professionals see pre-lapse warning and renew/restore path before lock.
9. Core screens satisfy baseline accessibility requirements (contrast, text scaling, focus order, labels).

## Invariants
- Pending queue and specialty-removal rules do not bypass existing assignment lifecycle constraints.
- Plan-change requests never mutate assigned plans directly.
- Starter template source artifacts stay immutable.
- Offline write-lock messaging is explicit and non-ambiguous.

## Traceability
- Functional requirements: `FR-209`, `FR-210`, `FR-211`, `FR-212`, `FR-213`, `FR-214`, `FR-215`, `FR-216`, `FR-217`.
- Use cases: `UC-002.12`, `UC-002.13`, `UC-002.14`, `UC-002.15`, `UC-002.16`, `UC-002.17`, `UC-002.18`, `UC-003.8`.
- Acceptance criteria: `AC-253`, `AC-254`, `AC-255`, `AC-256`, `AC-257`, `AC-258`, `AC-312`, `AC-424`, `AC-425`, `AC-512`.
- Business rules: `BR-267`, `BR-268`, `BR-269`, `BR-270`, `BR-271`, `BR-272`, `BR-273`, `BR-274`, `BR-275`.
- Test cases: `TC-256`, `TC-257`, `TC-258`, `TC-259`, `TC-260`, `TC-261`, `TC-262`, `TC-263`, `TC-311`, `TC-426`, `TC-427`, `TC-512`.
- Diagrams: `docs/diagrams/role-journey-flow.md`, `docs/diagrams/screen-state-flows-v2-batch1.md`.

## Open Questions
- None currently.
