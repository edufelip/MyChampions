# SC-201 Auth / Role Selection (V2)

## Route
- `/auth/role-selection`

## Objective
- Let authenticated first-time accounts choose and lock journey context as Student or Professional.

## UX Copy Intent
- Make self-guided usage obvious for first-time users who do not have a professional.
- Reduce jargon in visible labels while preserving internal role model.

## User Actions
- Primary:
  - Select role: Student or Professional.
  - Continue to role-specific journey.
  - Start quick self-guided student path.
- Secondary:
  - View role explanation.
  - Return to previous auth/account screen.

## States
- Loading: session check and role-save processing.
- Empty: first-time account with no role selected.
- Error: session failure, role save failure.
- Success: role saved and immutable for account; route transition executes.

## Validation Rules
- Role selection is required before entering the main app journey.
- Role cannot be changed in this account after confirmation.
- Copy must explicitly communicate that users can continue without connecting to a professional.
- Screen is only available for authenticated accounts with unlocked role state.
- Quick self-guided start commits `student` role and routes directly to self-managed setup.
- Accessibility baseline applies for text scaling, focus order, contrast, and screen-reader labels.

## Copy Draft (Initial)
- Screen title: `How do you want to use the app?`
- Intro: `You can start on your own now and connect with a professional later.`
- Option A title: `I want to track my own progress`
- Option A subtitle: `Log meals and workouts by yourself. No professional required.`
- Option B title: `I’m a nutritionist or fitness coach`
- Option B subtitle: `Manage clients, assign plans, and track student progress.`
- Role lock helper: `Account type can’t be changed later. You can create another account with a different email if needed.`
- Quick self-guided CTA: `Start on my own now`

## Implementation Snapshot (2026-02-28)
- Implemented in code:
  - `app/auth/role-selection.tsx`
  - `features/auth/role-selection.logic.ts`
  - `features/auth/role-selection.logic.test.ts`
- Current implementation status:
  - Full role-card UX is implemented with student/professional options, role-lock helper copy, and required-selection validation.
  - Quick self-guided action is implemented, commits `student` role lock through auth profile source abstraction, and routes to student home placeholder destination.
  - Continue action commits selected role lock through auth profile source abstraction and routes role-specific placeholder destinations for student/professional paths.
  - Route auto-bypass for locked-role accounts is enforced by global auth guard in `app/_layout.tsx`.
  - Authentication session source is Firebase Auth; role-lock profile source is now Data Connect-backed via `features/auth/profile-source.ts` (remote-only reads/writes).

## Data Contract
- Inputs:
  - Authenticated account context.
  - Selected role (`student` or `professional`).
  - Existing role-lock state (if any).
- Outputs:
  - Persisted immutable role profile.
  - Routing decision to Student or Professional onboarding/home.

## Edge Cases
- Existing account with prior role bypasses selection and routes directly.
- If user attempts to re-open this route after role lock, app hard-redirects to role home.

## Links
- Functional requirement: FR-102, FR-118, FR-135, FR-136, FR-173, FR-203, FR-206, FR-207, FR-208, FR-217
- Use case: UC-002.1, UC-002.8, UC-002.11, UC-002.18
- Acceptance criteria: AC-201, AC-211, AC-224, AC-233, AC-248, AC-251, AC-252, AC-512
- Business rules: BR-201, BR-211, BR-226, BR-227, BR-236, BR-262, BR-265, BR-266, BR-275
- Test cases: TC-201, TC-211, TC-225, TC-235, TC-249, TC-254, TC-255, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
