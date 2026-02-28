# CP-001 Store And Privacy Baseline (As Of 2026-02-26)

## Decision
Adopt a **store-compliance-first baseline** for MVP, aligned with current Apple App Store and Google Play requirements, with US-first rollout and globally safe defaults for privacy/account controls.

## Scope
- iOS App Store submission eligibility.
- Google Play submission eligibility.
- Health-adjacent user-data handling for nutrition/training context.
- Subscription handling for professional-only paid tier.

## Mandatory MVP Controls

### 1) Payments And Subscriptions
- Professional-only paid features (more than 10 active students) must use:
  - Apple In-App Purchase on iOS.
  - Google Play Billing on Android.
- RevenueCat is used as entitlement orchestration layer above store billing.
- Students remain non-paying accounts.

### 2) Privacy Policy And Data Disclosure
- Publish a privacy policy URL in both store listings and in-app surfaces.
- Describe collected data, purpose, sharing, retention, and deletion handling.
- Keep Play Data safety declarations accurate and updated.
- Keep Apple App Privacy labels accurate and updated.

### 3) Account Deletion And Data Deletion
- If account creation exists, in-app account deletion initiation is mandatory.
- User must be able to request deletion of account and associated user data.
- If full immediate deletion is not possible for technical/legal reasons, communicate retention timeline and scope clearly.
- Retained historical records must remove direct personal identifiers and keep only anonymized/pseudonymized minimum data needed for:
  - Legal and tax compliance.
  - Billing dispute and fraud/security investigations.
  - Data continuity for counterpart users (for example, relationship history and plan context where applicable).
- Deletion baseline implementation:
  - Remove or permanently de-link direct identifiers (email, phone, auth-subject mapping, profile identifiers).
  - Revoke sessions/tokens and disable account access immediately.
  - Replace retained actor references with irreversible internal tombstone identifiers.
  - Preserve only minimum event metadata (timestamps, lifecycle state transitions, non-personalized plan/history artifacts) required by policy.

### 4) Health-Related Data Handling
- Treat nutrition/training data as sensitive user data.
- Do not use health-related personal data for advertising or unauthorized profiling.
- Collect only data needed for product functionality (data minimization).
- Require explicit user-facing disclosures for any sensitive data sharing.

### 5) Security Baseline
- Encrypt data in transit (HTTPS/TLS).
- Protect session/auth tokens and credentials.
- Maintain access controls so only authorized professional-student relationships can access plan data.
- Maintain auditability for assignments, unbinds, plan publication, and consent grants.
- Redact or omit full shared-link values/raw share tokens from analytics and operational logs.

## Release Gate Checklist
- [ ] Store-compliant billing flow is active for professional subscription tier.
- [ ] Privacy policy URL configured and content validated.
- [ ] Apple privacy labels and Google Play data safety forms match actual behavior.
- [ ] In-app account deletion flow implemented and verified on both platforms.
- [ ] Deletion pipeline verified to remove direct identifiers from retained historical data.
- [ ] Consent and access controls validated for archived self-managed plan sharing.
- [ ] No prohibited health-data advertising usage patterns detected.

## Notes
- This is a product/engineering baseline, not legal counsel.
- If launch expands beyond US, add jurisdiction-specific controls (for example GDPR/LGPD workflows) before regional release.

## Policy Sources
- Apple App Store Review Guidelines (3.1 Payments, 5.1 Privacy): https://developer.apple.com/app-store/review/guidelines/
- Apple account deletion requirement reminder (effective date noted by Apple): https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Apple App Privacy details: https://developer.apple.com/app-store/app-privacy-details/
- Google Play User Data Policy (privacy policy, data safety, account deletion references): https://support.google.com/googleplay/android-developer/answer/9888076
- Google Play account deletion policy overview: https://support.google.com/googleplay/android-developer/answer/13327111
- Google Play Payments policy guidance: https://support.google.com/googleplay/android-developer/answer/10281818
- Google Play Health apps declaration/support policy context: https://support.google.com/googleplay/android-developer/answer/12991134
