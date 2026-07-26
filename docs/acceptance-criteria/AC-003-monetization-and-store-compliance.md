# AC-003 Monetization And Store Compliance (Proposed)

## Feature
Professional-only subscription tier and store-policy readiness for release.

## Acceptance Criteria
- `AC-301`: Student accounts are never prompted to purchase subscription for core app usage.
- `AC-302`: Professional account can manage up to 10 active students without paid entitlement.
- `AC-303`: Activating/managing above 10 active students requires valid professional subscription entitlement.
- `AC-304`: Subscription purchase and restore flows use store billing and synchronize entitlement through RevenueCat.
- `AC-305`: App exposes a valid privacy policy URL in-app and in store listing metadata.
- `AC-306`: App supports in-app account deletion initiation for accounts created in-app.
- `AC-307`: App privacy disclosures/data safety declarations are aligned with actual runtime data collection/sharing behavior.
- `AC-308`: Health-related user data is not used for advertising or unauthorized profiling.
- `AC-309`: Professional 10-student cap counts unique active student accounts, not specialty assignments.
- `AC-310`: Account deletion removes direct personal identifiers from retained historical records and keeps only anonymized/pseudonymized minimum data required for legal, billing, security, and continuity constraints.
- `AC-311`: If a professional is above cap with inactive entitlement, new activations and student-plan update actions are locked until entitlement is restored.
- `AC-312`: Professionals receive pre-lapse warning with clear renew/restore path before entitlement lock is applied.
- `AC-313`: RevenueCat SDK operations are bound to the current self-managed server auth UID; an account switch finishes before the next SDK operation, and stale entitlement results cannot synchronize to another server account.
- `AC-314`: A production mobile release fails before native compilation unless its platform Google OAuth client ID and matching public RevenueCat SDK key are present and correctly prefixed.
- `AC-315`: A valid RevenueCat webhook reconciles `professional_pro` and `student_pro` from the canonical subscriber record, preserves the unrelated entitlement, and returns non-2xx when provider reconciliation cannot complete.
- `AC-316`: A RevenueCat transfer reconciles every source and destination App User ID before acknowledgement so privileges do not remain attached to the wrong MyChampions account.
- `AC-317`: Professional expiry warning appears only for an active entitlement with an authoritative expiration timestamp and explicit non-renewal, unsubscribe, or billing-issue risk; cancellation and provider failures do not grant access.

## Gherkin Scenarios
```gherkin
Feature: Monetization and policy compliance

  Scenario: Professional cap enforcement
    Given a professional has 10 active students
    And no active subscription entitlement
    When attempting to activate an additional student
    Then the action is blocked
    And a subscription purchase path is presented

  Scenario: Student role has no subscription charge
    Given a student account
    When using student journey features
    Then no subscription purchase requirement is shown

  Scenario: In-app account deletion availability
    Given a signed-in user
    When user opens account settings
    Then account deletion action is available

  Scenario: Professional cap counts unique student accounts
    Given a dual-specialty professional with one student active in both specialties
    When cap usage is calculated
    Then that student counts as one active student toward the cap

  Scenario: Account deletion anonymizes retained history
    Given a user has historical assignment and plan records
    When account deletion is processed
    Then direct personal identifiers are removed from retained historical records
    And only minimum anonymized/pseudonymized records are kept per policy

  Scenario: Lapsed entitlement lock when above cap
    Given a professional is above active-student cap
    And subscription entitlement becomes inactive
    Then activation of new students is blocked
    And student-plan update actions are locked until entitlement is active

  Scenario: Pre-lapse warning before lock
    Given a professional is near entitlement lapse and at-risk for cap lock
    When professional opens dashboard or subscription surface
    Then app shows pre-lapse warning state
    And app provides renew/restore recovery actions

  Scenario: RevenueCat identity follows the self-managed server account
    Given RevenueCat has been configured for one signed-in MyChampions user
    When a different MyChampions user signs in before the next subscription operation
    Then RevenueCat logs in the new server auth UID before that operation
    And entitlement state or snapshots from the first user are not applied to the second user

  Scenario: Partial webhook preserves the other entitlement
    Given a customer has independent professional and AI entitlements
    When RevenueCat sends an event for only one product
    Then the server reloads the canonical subscriber
    And persists both entitlement states without revoking the unrelated privilege

  Scenario: Authoritative pre-lapse warning
    Given a professional entitlement is active with a provider expiration timestamp
    And RevenueCat reports non-renewal, unsubscribe, or billing-issue risk
    When the subscription state is refreshed
    Then the professional sees the pre-lapse warning
    And active-student count alone can never activate that warning
```
