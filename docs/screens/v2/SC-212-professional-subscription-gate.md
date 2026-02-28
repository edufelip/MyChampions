# SC-212 Professional Subscription Gate (V2)

## Route
- `/professional/subscription`

## Objective
- Enforce and manage monetization for professional accounts exceeding 10 active students.

## User Actions
- Primary:
  - View current entitlement status.
  - Purchase subscription.
  - Restore subscription.
- Secondary:
  - Review feature unlock details.

## States
- Loading: fetch entitlement and student-count usage.
- Empty: no active entitlement.
- Warning: entitlement is still active but near lapse for cap-sensitive operations.
- Error: purchase/restore/sync failure.
- Success: entitlement active and cap-gated actions unlocked.

## Validation Rules
- Students are never routed to this paywall context.
- Professional cap above 10 active students requires active entitlement.
- Active student count is computed by unique active student accounts (one student counts once even with dual specialty assignment).
- Entitlement state must align with RevenueCat + store billing.
- If entitlement is inactive while over cap, new activations and student-plan update actions remain locked.
- Pre-lapse warning must appear before lock state with clear renew/restore path.
- Accessibility baseline applies for readable warnings/CTAs with proper labels and focus order.

## Data Contract
- Inputs:
  - Professional id.
  - Active student count.
  - RevenueCat entitlement and storefront purchase state.
- Outputs:
  - Updated entitlement state.
  - Unlock signal for cap-sensitive operations.

## Edge Cases
- Entitlement active but stale local cache should reconcile on refresh.
- Purchase canceled should preserve blocked state with clear retry path.
- Pre-lapse warning may clear automatically after entitlement refresh confirms healthy state.

## Links
- Functional requirement: FR-126, FR-127, FR-128, FR-129, FR-156, FR-185, FR-215, FR-217
- Use case: UC-002.6, UC-002.15, UC-002.18
- Acceptance criteria: AC-219, AC-220, AC-221, AC-301, AC-302, AC-303, AC-304, AC-309, AC-311, AC-312, AC-512
- Business rules: BR-218, BR-219, BR-220, BR-221, BR-228, BR-247, BR-273, BR-275
- Test cases: TC-220, TC-221, TC-222, TC-301, TC-302, TC-303, TC-308, TC-310, TC-311, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
