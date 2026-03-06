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
  - Start self-guided student path by selecting Student and tapping Continue.
- Secondary:
  - View role explanation.

## States
- Loading: session check and role-save processing.
- Empty: first-time account with no role selected.
- Error: session failure, role-save failure, or post-save route transition failure.
- Success: role saved and immutable for account; route transition executes.

## Validation Rules
- Role selection is required before entering the main app journey.
- Role cannot be changed in this account after confirmation.
- Copy must explicitly communicate that users can continue without connecting to a professional.
- Screen is only available for authenticated accounts with unlocked role state.
- Unauthenticated visits to `/auth/role-selection` must redirect to `/auth/sign-in`.
- Selecting `student` then tapping Continue commits `student` role and routes directly to self-managed setup.
- Accessibility baseline applies for text scaling, focus order, contrast, and screen-reader labels.

## Copy Draft (Initial)
- Screen title: `How do you want to use the app?`
- Intro: `You can start on your own now and connect with a professional later.`
- Option A title: `I want to track my own progress`
- Option A subtitle: `Student account`
- Option B title: `I’m a nutritionist or fitness coach`
- Option B subtitle: `Professional account`
- Role lock helper: `Account type can’t be changed later. Please choose carefully based on your needs.`

## Implementation Snapshot (2026-03-04)
- Implemented in code:
  - `app/auth/role-selection.tsx`
  - `features/auth/role-selection.logic.ts`
  - `features/auth/role-selection.logic.test.ts`
- Current implementation status:
  - Full role-card UX is implemented with student/professional options, role-lock helper copy, and required-selection validation.
  - Self-guided start path is implemented through Student selection + Continue, commits `student` role lock through auth profile source abstraction, and routes to student home.
  - Continue action commits selected role lock through auth profile source abstraction and routes to role-specific journeys:
    - Student -> `/` (self-managed tracking shell).
    - Professional -> `/professional/specialty` (SC-202 onboarding specialty setup).
  - Error handling distinguishes role persistence failure (`auth.role.error.save_failed`) from post-save navigation failure (`auth.role.error.navigation_failed`).
  - Continue action is blocked when no authenticated session is available and routes to sign-in with `auth.role.error.auth_required`.
  - Role-lock persistence includes a defensive profile upsert fallback and one read-after-write retry to absorb transient consistency delays from Data Connect responses.
  - Route auto-bypass for locked-role accounts is enforced by global auth guard in `app/_layout.tsx`.
  - Authentication session source is Firebase Auth; role-lock profile source is now Data Connect-backed via `features/auth/profile-source.ts` (remote-only reads/writes).
  - Visual layout is aligned with Stitch role-selection reference (`0e872419a1ff45b39fbc89d7c3592c44`) using the same playful auth system as SC-217/SC-218:
    - Soft peach background with decorative blobs.
    - No back control.
    - Top content respects device safe area inset to avoid status-bar overlap.
    - Bottom safe-area padding applied to prevent CTA overlap.
    - Elevated rounded role cards with selected badge and icon treatment.
    - Selected role outline transition is animated on pick/unpick.
    - Highlighted lock-note panel and rounded primary CTA.

## Design Reference Assets
- `docs/design-assets/stitch/13906080126528974652/0e872419a1ff45b39fbc89d7c3592c44.html`
- `docs/design-assets/stitch/13906080126528974652/0e872419a1ff45b39fbc89d7c3592c44.png`

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
- If authenticated user closes and reopens app before role is persisted, app must keep user locked on `/auth/role-selection` and block tab/home access.
- If session expires while this screen is open, Continue remains disabled and user is redirected to sign-in when pressed.
- If user signs out and a different account signs in, role-lock session state must reset before profile hydration; new account cannot inherit prior account role context.
- Hydrated role-lock must only be accepted when returned profile `authUid` matches the active Firebase Auth UID; mismatches are treated as unlocked-role state.

## Links
- Functional requirement: FR-102, FR-118, FR-135, FR-136, FR-173, FR-203, FR-206, FR-207, FR-208, FR-217
- Use case: UC-002.1, UC-002.8, UC-002.11, UC-002.18
- Acceptance criteria: AC-201, AC-211, AC-224, AC-233, AC-248, AC-251, AC-252, AC-512
- Business rules: BR-201, BR-211, BR-226, BR-227, BR-236, BR-262, BR-265, BR-266, BR-275
- Test cases: TC-201, TC-211, TC-225, TC-235, TC-249, TC-254, TC-255, TC-290, TC-291, TC-292, TC-293, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
- Copy guidance: docs/screens/v2/copy-guidelines-v2.md
