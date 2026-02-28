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
