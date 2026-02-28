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
```
