# Student-Professional Network And Plan Ownership Spec (Proposed)

## Purpose
Specify the target domain behavior for role-based journeys, professional assignments, and personalized plan management.

## Scope
- Role selection and journey branching.
- Student-professional relationship constraints.
- Plan ownership for nutrition and training.
- Self-managed fallback behavior for students.

## Definitions And Terminology
- Student: user consuming assigned or self-managed plans.
- Professional: nutritionist, fitness coach, or dual-specialty account.
- Active assignment: current linked relationship for a specialty.
- Plan template: reusable base plan created by a professional.
- Customized plan: student-specific adaptation of a template.

## Inputs And Outputs
- Inputs:
  - User role/specialty selection.
  - Assignment requests/acceptance.
  - Professional plan authoring actions.
  - Student daily tracking entries.
- Outputs:
  - Journey routing by role.
  - Assignment validation decisions.
  - Stored and visible plans.
  - Daily progress views for students.

## Expected Behavior
1. User authenticates via email/password, Google, or Apple.
2. Create-account enforces required fields and password policy (8+ chars, uppercase, number, special char, no emoji), including password confirmation match and reveal/hide controls.
3. Email is globally unique for account creation; social sign-in with matching email links provider to existing account.
4. User selects role context (Student or Professional) once; role is immutable for that account.
5. Accounts with locked role bypass role-selection and are auto-routed to role home.
6. Professional onboarding captures specialty profile (nutritionist, fitness coach, or both).
7. Optional specialty-scoped `professional_registry` credentials may be submitted or skipped in MVP.
8. Professionals may add specialties later; removal is blocked if active or pending students exist in that specialty or if no specialty would remain.
9. Professional shares invite code with student to initiate assignment.
10. Invite code is persistent by default, can be revoked/regenerated, and only one active code exists at a time; regenerating code invalidates the old code and auto-cancels pending requests tied to it.
11. Student submits invite code and assignment enters pending state only if pending-cap constraints pass.
12. Pending requests are capped at 10 per professional.
13. Professional confirmation is required before assignment becomes active.
14. Student connections to professionals are validated by specialty uniqueness constraints.
15. Professionals can manage many students and issue customized plans.
16. Professionally assigned plans are read-only for students.
17. Students can track daily progress against assigned nutrition/training context.
18. Students lacking active professionals can use self-managed planning for missing specialties.
19. When assignment activates for a specialty, existing self-managed plan in that specialty is archived.
20. Professional review of archived self-managed plan requires student consent.
21. Ended assignments retain relationship and plan history.
22. Students never require paid subscription entitlement.
23. Professionals can manage up to 10 active students without subscription; exceeding this cap requires active entitlement.
24. Active-student cap uses unique active student accounts regardless of one or two active specialties per student.
25. If entitlement lapses while professional is above cap, new activations and student-plan update actions are locked until entitlement is restored.
26. Subscription purchase/restore flows use platform billing with RevenueCat entitlement sync.
27. Account settings expose privacy policy access and account deletion initiation per store baseline.
28. Student-facing connection flows do not expose professional credential/verification status as badge/filter.
29. Student can view credential info only for currently assigned professionals, limited to `registry_id`, `authority`, and `country`.
30. Nutrition plan search/lookup nutrient data is sourced from the VPS food-search microservice (`https://foodservice.eduwaldo.com/searchFoods`) for MVP.
31. Users can create reusable custom meals with total grams and nutrient totals.
32. Users can log consumed grams from saved custom meals and receive proportional calorie/macro calculations.
33. Editing custom meal definitions does not mutate previously stored nutrition logs.
34. Custom meal owners can share recipes by link with other users.
35. Recipients save shared recipes via confirmation flow and receive account-owned copies.
36. Recipient recipe copies remain available even when source creator deletes original recipe.
37. Custom meal create/edit/share and shared-save flows are available to all authenticated role types.
38. Shared recipe links do not expire and cannot be revoked by creators.
39. Shared-link save requires authentication; logged-out opens resume the same link flow after login.
40. Re-import on same link by same recipient is idempotent and returns existing saved copy.
41. Custom meal/recipe entities use UUIDv7 primary identifiers, including imported recipient-owned copies.
42. Recipe sharing endpoints are rate-limited and full link/token values are excluded from analytics/observability logs.
43. App shell uses role-specific bottom navigation models:
  - Professional: dashboard, students, nutrition, training, account/settings.
  - Student: home, nutrition, training, recipes, account/settings.
44. Student home prioritizes nutrition content above training and highlights pending connection status.
45. Offline mode provides read-only cached content and blocks writes until connectivity is restored.
46. Student role-selection surfaces self-guided start via Student selection + Continue and routes directly to self-managed tracking setup.
47. Relationship flow supports QR invite scan with same validation/outcome behavior as manual code entry.
48. Auth and invite failures use reason-specific actionable copy (no generic fallback-only errors for known reasons).
49. Milestone A analytics emits standardized funnel events for auth entry, role selection, self-guided start, invite submit, and invite outcomes.
50. Milestone A analytics payloads include required context fields and redact sensitive inputs.
51. Students impacted by invite-code regeneration cancellation see explicit reason and reconnect action.
52. Professional pending queue supports search/filter and bulk deny operations.
53. Students can submit plan-change requests on assigned plans while direct plan editing remains blocked.
54. Professional plan builders provide starter templates cloned into editable drafts.
55. Offline core screens show persistent read-only banner and explicit write-lock reasons for blocked writes.
56. Professional monetization flow surfaces pre-lapse warning before lock activation.
57. Specialty-removal blocked state exposes direct blocker-resolution actions.
58. Core screens support accessibility baseline for dynamic text scaling, screen-reader labels, logical focus order, and contrast.
59. Hydration tracking scope includes water only, with daily intake logging, effective-goal completion, and streaks.
60. Water goals are authored in nutrition plan creation/edit flows: self-guided students define personal hydration goals and assigned nutritionists define override goals in assigned plan authoring.
61. Professionals can create named predefined nutrition/training plans and bulk assign them to multiple students.
62. Bulk assignment supports per-student fine-tuning and produces independent assigned copies.

## Error Handling And Edge Cases
- Attempting second active professional in same specialty is rejected.
- Relationship transitions must enforce lifecycle-state validity (`invited`, `pending_confirmation`, `active`, `ended`).
- Conflicts between assigned and self-managed plans require deterministic precedence policy.

## Invariants And Guarantees
- At most one active nutritionist per student.
- At most one active fitness coach per student.
- One professional may satisfy both specialties when dual-qualified.
- Role cannot be changed in-place on an account.
- Assigned plans are immutable for student editors.
- Historical relationship and plan data must remain accessible according to policy.
- Student role is never subscription-payer.
- 10-student free limit applies per professional account unless subscription entitlement is active.
- Self-guided nutrition tracking includes reusable custom meal support.
- Shared recipe imports use copy-on-save ownership isolation.
- Custom meal sharing is role-agnostic for authenticated users.
- Student-cap billing count is account-unique, not specialty-multiplied.
- Assignment transitions are deterministic: `invited` -> `pending_confirmation` -> `active` -> `ended`.
- Professional pending-request queue cannot exceed 10.
- Specialty-removal rules always preserve at least one specialty on professional accounts and block removal when active or pending students exist in that specialty.

## Non-Goals
- Billing provider technical details.
- Medical/legal diagnosis workflows.
- Wearable integrations until explicitly defined.

## Open Questions Or Ambiguities
- See `docs/discovery/open-questions-v1.md`.
