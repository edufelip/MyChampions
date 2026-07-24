# TC-003 Monetization And Store Compliance (Proposed)

## Test Cases

| ID | Area | Preconditions | Steps | Expected Result |
|---|---|---|---|---|
| TC-301 | Professional Billing Gate | Professional has 10 active students and no entitlement | Try to activate student #11 | Blocked and paywall/subscription path shown |
| TC-302 | Entitlement Sync | Subscription purchase completed | Refresh session | RevenueCat entitlement active and capability unlocked |
| TC-303 | Student Billing Exemption | Student account | Navigate student flows | No subscription purchase requirement appears |
| TC-304 | Privacy Policy Exposure | Build configured for store release | Open settings and listing metadata | Privacy policy URL is present and valid |
| TC-305 | Account Deletion | Account exists | Trigger in-app deletion flow | Deletion request starts and confirmation shown |
| TC-306 | Disclosure Consistency | Data safety/privacy labels prepared | Compare runtime events vs declared fields | No undocumented collection/sharing found |
| TC-307 | Health Data Usage | Tracking data available | Run ad/analytics payload inspection | No prohibited health-data ad usage detected |
| TC-308 | Unique Active Student Counting | Professional has one student active in both specialties | Evaluate active-student usage and attempt cap transition | Student counts once toward cap calculations |
| TC-309 | Deletion Anonymization | User with assignment/plan history requests account deletion | Execute deletion and inspect retained history records | Direct identifiers removed; retained records are anonymized/pseudonymized per policy |
| TC-310 | Lapsed Entitlement Lock | Professional is above cap and entitlement turns inactive | Attempt new activation and plan update actions | Both activation and student-plan updates are blocked until entitlement restored |
| TC-311 | Pre-Lapse Warning Visibility | Professional is at-risk of entitlement lapse while cap-sensitive operations exist | Open professional dashboard/subscription surfaces before lapse | Warning state appears with explicit renew/restore actions prior to lock |
| TC-312 | RevenueCat Server Identity | Authenticated server user A opens a subscription surface, then user B signs in before the next subscription operation | Initialize RevenueCat under user A; switch to user B; request entitlement or paywall action; attempt to sync an old result | Initial SDK configuration uses A's self-managed auth UID; B's operation waits for `logIn(B)`; old result never updates B's state or posts with B's bearer token |
| TC-313 | Production Provider Release Gate | iOS or Android release workflow receives `ENV_FILE` values | Run the release workflow with missing Google client ID or an absent/incorrect RevenueCat public key | Workflow fails before native compilation; iOS requires its Google client ID plus `appl_*` key, Android requires its Google client ID plus `goog_*` key |
| TC-428 | Canonical Webhook Reconciliation | Customer has independent professional and AI entitlements; webhook concerns one product | Deliver a valid webhook and inspect the subscriber API request and stored snapshot | Both canonical entitlement states persist; unrelated entitlement is not downgraded; observation is ordered |
| TC-429 | Transfer Reconciliation | RevenueCat transfer contains source and destination App User IDs | Deliver the transfer event | Every affected customer is fetched and reconciled before 200; a failed fetch returns retryable non-2xx |
| TC-430 | Webhook Failure Boundaries | Authorization, HMAC, payload, secret key, or subscriber API response is invalid | Exercise every invalid/configuration/provider branch | No false privilege write; auth/payload fail closed; provider/configuration failures are retryable |
| TC-431 | Professional Renewal Risk | Active entitlement has an expiry with renew, unsubscribe, billing issue, or malformed combinations | Map native and canonical server customer data and render professional surfaces | Warning is true only for authoritative active-at-risk combinations; expiry is normalized; malformed data fails closed |
| TC-432 | Native Paywall Outcome Matrix | Deterministic dev E2E subscription fixture enabled | Run success, cancel, network, and storefront-problem paywall scenarios plus refresh/restore | Success refreshes active access; cancellation is nonfatal; errors remain visible/actionable; restore never grants on failure |
| TC-433 | Cap-State Detox Matrix | Deterministic professional auth/roster/entitlement fixtures enabled | Run warning, lapsed-over-cap, and unknown-state scenarios | Warning precedes lapse; cap-sensitive writes lock after lapse; purchase/restore recovery remains available; unknown fails closed |
