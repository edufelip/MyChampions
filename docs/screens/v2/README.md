# V2 Screen-By-Screen Specs

This folder contains the V2 screen specifications for the product model currently defined in FR/UC/AC/BR/TC.

## Scope
- Multi-provider authentication (email/password, Google, Apple) and role-lock onboarding.
- Quick self-guided student start and contextual auth/invite error messaging.
- Student and professional journeys.
- Assignment lifecycle constraints.
- Invite-code entry via manual input and QR scan.
- Pending-request cancellation visibility, professional queue tools, and specialty-removal assist actions.
- Student plan-change request flow and professional starter-template authoring flows.
- Water tracking (hydration-only) with student/personal and nutritionist-assigned goals.
- Named predefined plan libraries and bulk assignment with per-student fine-tuning.
- Professional monetization gate (10 active students free, subscription above cap).
- Pre-lapse subscription warnings before entitlement lock states.
- Custom meal creation and portion-by-grams nutrition logging.
- Recipe image upload progress/retry UX with preserved drafts.
- Recipe sharing by link with save-to-account ownership confirmation.
- Compliance-required account/privacy settings.
- Accessibility baseline coverage for core screens.
- DS visual baseline aligned with electric-green + fitness-blue token set (`#13ec49`, `#0A2463`) and neutral layered surfaces.

## Traceability Rule
Each screen spec must link to:
- Functional requirements (`FR-*`)
- Use cases (`UC-*`)
- Acceptance criteria (`AC-*`)
- Business rules (`BR-*`)
- Test cases (`TC-*`)

## Current V2 Spec Files
- `copy-guidelines-v2.md`
- `localized-copy-table-v2.md`
- `SC-217-auth-sign-in.md`
- `SC-218-auth-create-account.md`
- `SC-221-auth-accept-terms.md`
- `SC-201-auth-role-selection.md`
- `SC-202-professional-specialty-setup.md`
- `SC-203-student-home-dashboard.md`
- `SC-204-professional-home-dashboard.md`
- `SC-205-student-roster.md`
- `SC-206-student-profile-professional-view.md`
- `SC-207-nutrition-plan-builder.md`
- `SC-208-training-plan-builder.md`
- `SC-209-student-nutrition-tracking.md`
- `SC-210-student-training-tracking.md`
- `SC-211-relationship-management.md`
- `SC-212-professional-subscription-gate.md`
- `SC-213-account-privacy-settings.md`
- `SC-214-custom-meal-builder.md`
- `SC-215-custom-meal-library-and-quick-log.md`
- `SC-216-shared-recipe-save-confirmation.md`
