# SC-204 Professional Home Dashboard (V2)

## Route
- `/professional/home`

## Objective
- Give professionals a control center for student management, assignments, and plan operations.

## User Actions
- Primary:
  - Open student roster.
  - Open student profile to assign/customize plans.
  - Generate/share invite code (text and QR) for student onboarding.
  - Open pending requests queue with search/filter/bulk deny tools.
- Secondary:
  - View active and pending student counts separately.
  - Review latest pending student plan-change request notification.
  - Open subscription management screen when near/over cap.
  - Open custom meal library/builder for professional self-tracking and recipe-sharing workflows.
  - Navigate via bottom tabs: dashboard, students, nutrition, training, account/settings.

## States
- Loading: fetch roster summary, pending confirmations, cap state, and entitlement-risk state.
- Empty: no linked students yet.
- Error: dashboard data retrieval failure.
- Success: student management shortcuts and status widgets visible.

## Design Structure (D-134)
- Screen shell adopts DS structure (`DsScreen`) for consistent playful background and spacing.
- Home now establishes the professional surface baseline: top purpose summary, truthful KPI links, a first-class `Needs attention` queue, and direct work-management shortcuts.
- Pending connection requests and pending plan-change requests are distinct task types with separate destinations. Successful task data remains actionable when the other source fails.
- `You're all caught up` is shown only after both task sources settle successfully with no pending work; loading and partial-error states never masquerade as an empty queue.
- Desktop uses a two-column workbench with priorities and management shortcuts in the main column and invitation/subscription utilities in the secondary column. Compact layouts preserve a single reading order.
- Dashboard plan shortcuts reuse the role shell's specialty access rules; Nutrition is never offered from the dashboard when the professional does not have nutrition access.
- When no invite specialty exists, the invitation utility explains the prerequisite and links to specialty management instead of rendering an apparently empty card.
- Active-student capacity renders an em dash until an authoritative count has loaded; an unavailable count is never presented as zero.
- Operational dashboard and subscription surfaces use a low-noise canvas. The subscription shortcut communicates state with semantic iconography and text instead of generic fitness photography or decorative premium imagery.
- Dashboard blocks use DS surface primitives (`DsCard`) and unified CTA primitives (`DsPillButton`) with clear primary/secondary hierarchy.
- Offline and lock warnings follow DS semantic alert structure while preserving existing gating logic.
- Invite-code actions and navigation CTAs remain behavior-equivalent; presentation is standardized for cleaner visual rhythm.
- On compact native viewports, native validation scrolls the dashboard until the invite-code value and share/regenerate controls are visible before interacting with them.

## Validation Rules
- Any operation that would exceed 10 active students must trigger subscription gate if no entitlement.
- Invite-code initiated assignments stay pending until professional confirmation.
- Invite code lifecycle supports manual revoke/regenerate.
- Regenerating invite code invalidates old code and auto-cancels pending requests created from old code.
- Pending connection requests are capped at 10 awaiting accept/deny.
- If entitlement is inactive while above cap, plan update actions for students are locked.
- Pending queue actions support search/filter and bulk deny without bypassing lifecycle constraints.
- Pending plan-change requests submitted by students must surface on professional home as a local in-app notification and deep link to that student's profile for review.
- Pre-lapse entitlement warning must be visible before lock state when risk is detected.
- When offline, dashboard must show persistent read-only banner and explicit write-lock reasons for blocked actions.
- Accessibility baseline applies for text scaling, focus order, contrast, and screen-reader labels on dashboard controls.

## Data Contract
- Inputs:
  - Professional profile and specialties.
  - Active/pending assignments.
  - Entitlement status from RevenueCat sync.
- Outputs:
  - Navigation to roster, student profile, subscription, custom meal flows, and confirmation actions.
  - Separate count widgets for active students and pending requests.
  - Server-backed pending plan-change request count and latest request summary from `GET /professional/plan-change-requests?status=pending`.
  - Lock-state flags for disabled student-plan update actions.
  - Pre-lapse warning banner data with renew/restore CTA metadata.

## Edge Cases
- Professional with both specialties can manage both domains for same student.
- Entitlement stale state requires refresh before allowing cap-sensitive actions.
- Lapsed entitlement while above cap keeps dashboard readable but locks write actions.
- Offline mode keeps dashboard readable but blocks write CTAs with explicit lock reason.
- If tab wrapper renders during transient unavailable role state, shell fallback redirects to `/auth/role-selection` instead of showing a blank scene.

## Links
- Functional requirement: FR-105, FR-120, FR-121, FR-127, FR-128, FR-129, FR-150, FR-179, FR-180, FR-181, FR-185, FR-188, FR-204, FR-210, FR-214, FR-215, FR-217
- Use case: UC-002.2, UC-002.3, UC-002.6, UC-002.9, UC-002.12, UC-002.15, UC-002.17, UC-002.18, UC-003.1
- Acceptance criteria: AC-206, AC-213, AC-214, AC-220, AC-221, AC-237, AC-238, AC-241, AC-245, AC-249, AC-254, AC-257, AC-312, AC-413, AC-512
- Business rules: BR-206, BR-213, BR-219, BR-220, BR-221, BR-241, BR-242, BR-243, BR-247, BR-249, BR-263, BR-268, BR-272, BR-273, BR-275, BR-316
- Test cases: TC-206, TC-213, TC-214, TC-221, TC-222, TC-240, TC-241, TC-246, TC-250, TC-257, TC-258, TC-261, TC-300, TC-310, TC-311, TC-415, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
