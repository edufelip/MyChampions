# RevenueCat Student Paywall v1 Test Evidence Report

Date: 2026-07-24
Environment: RevenueCat project `49195782`, MyChampions development app,
iPhone 17 / iOS 26.5, RevenueCat Test Store

## Controlled-batch outcome

The approved Test Store slice created and published `Student Paywall v1 Test`
on the temporary development offering `test_student`. The production
`default_student` offering was not modified.

The app now routes AI upgrades by the account's locked role:

- student accounts resolve `default_student`, except an explicit development
  Test Store build resolves `test_student`;
- professional accounts resolve `default_professional`;
- missing or malformed roles fail closed without presenting a paywall.

Existing valid `student_pro` entitlements remain backward-compatible and unlock
AI regardless of role. A professional cannot initiate a new student purchase
from the app.

No App Store Connect, Google Play, Android RevenueCat app/catalog, deployment,
merge, or production release action was performed in this batch.

## Provider configuration

| Field | Confirmed value |
|---|---|
| Paywall ID | `pw92ab4568bc274596` |
| Name | `Student Paywall v1 Test` |
| State | Published |
| Offering | `test_student` (`ofrng29278ed23b`) |
| Packages | `$rc_monthly` -> `student_test_monthly`; `$rc_annual` -> `student_test_annual` |
| Entitlement contract | Both student products grant only `student_pro` |
| Default selection | Monthly |
| Price source | RevenueCat product variables, including `{{ product.price_per_period }}` and annual `{{ product.price_per_month }}` |
| Locales | `en-US`, `pt-BR`, `es-ES` |
| Appearance | Light and dark |
| Allowlist | Exact 13 approved Test Store customer IDs |

The temporary offering contains only the two approved student packages:

![Temporary student offering packages](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/01-test-student-offering-packages.png)

The published-paywalls list contains the professional production paywall and
the temporary student Test Store paywall. No `default_student` production
paywall was created:

![Published paywalls](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/10-published-paywalls-list.png)

The student close action was remediated during the live matrix after the first
native accessibility assertion exposed an unlabeled control. The published
paywall now exposes localized `Close`, `Fechar`, and `Cerrar` labels while
retaining the close icon and compact layout:

![Published paywalls after close-label remediation](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/12-published-paywalls-accessible-close.png)

The exact Test Store allowlist was reopened after saving and showed 13 customer
IDs:

![Test Store allowlist](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/09-sandbox-allowlist-13.png)

## Design and localization review

The student design uses the MyChampions visual tokens and the same interaction
order as the professional paywall, while keeping its own value proposition:

- camera/sparkles header with no decorative media;
- AI meal-photo analysis only, with no professional-capacity messaging;
- all three approved student benefits;
- provider-driven Monthly and Annual prices;
- close, selected-plan indication, CTA, renewal disclosure, restore, Terms,
  Privacy, and native accessibility labels.

English light appearance:

![English light student paywall](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/04-editor-en-light.png)

English dark appearance:

![English dark student paywall](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/05-editor-en-dark.png)

Brazilian Portuguese:

![Brazilian Portuguese student paywall](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/02-editor-pt-br-light.png)

Spanish (Spain):

![Spanish student paywall](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/03-editor-es-light.png)

The compact layout was specifically tightened so the iPhone SE preview keeps
all three benefits, both packages, CTA, renewal, restore, legal links, and close
control present and unclipped:

![iPhone SE student paywall](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/06-editor-en-iphone-se-light.png)

Largest reviewed phone:

![iPhone 17 Pro Max student paywall](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/07-editor-en-iphone-17-pro-max-light.png)

## App implementation

The app configuration accepts `test_student` only when all three guards are
true: development variant, Test Store enabled, and explicit student-offering
override. Production and normal development resolve `default_student`;
production rejects the temporary override.

`openAiUpgradePaywall(role)` is the single role-aware action used by both
custom-meal AI entry points. Offering-specific provider presentation remains
internal and independently unit-tested.

The live Detox spec keeps student and professional paywall contracts separate:
copy, package labels, legal labels, native coordinates, and expected
entitlements are not shared. Each scenario runs with a dedicated allowlisted
customer.

## Automated validation

| Check | Result |
|---|---|
| App config, offering resolver, role resolver, entitlement logic, E2E identity tests | Passed: 121/121 |
| JavaScript syntax for live Detox spec | Passed |
| Shell syntax for both RevenueCat live runners | Passed |
| Targeted ESLint | Passed |
| `git diff --check` | Passed |
| Workspace TypeScript | Not used as a green gate: the workspace retains unrelated pre-existing `fetch.preconnect` errors |

## Live Test Store matrix

| Scenario | Dedicated customer | Result | Required proof |
|---|---|---|---|
| Student paywall propagation and dismissal | `rc-student-v1-dismiss` | Passed | Student V1 and native close label visible; dismissal grants nothing |
| Cancellation | `rc-student-v1-cancel` | Passed | Neither entitlement is granted |
| Simulated failure | `rc-student-v1-fail` | Passed | Neither entitlement is granted |
| Duplicate purchase activation | `rc-student-v1-duplicate` | Passed | One provider sheet; cancellation grants nothing |
| Monthly purchase | `rc-student-v1-monthly` | Passed | AI active; professional capability inactive |
| Annual purchase | `rc-student-v1-annual` | Passed | Annual selected; AI active; professional capability inactive |
| Reinstall and Test Store restore | `rc-student-v1-restore` | Passed | Student AI restored; professional capability inactive |
| Account switching | `rc-student-v1-switch` / `rc-student-v1-switch-alt` | Passed | Alternate locked; purchaser active after return |
| Professional AI route | `rc-student-v1-pro-route` | Passed | Professional V1 shown; only professional privilege purchased; AI active |

All nine approved live scenarios passed. The final focused professional-route
run passed in 47.239 seconds after the independent professional renewal-copy
matcher was corrected to match its existing published paywall.

Live student paywall:

![Student Paywall v1 on live iPhone simulator](../../artifacts/revenuecat-student-paywall-v1-20260724/app/01-student-paywall-live.png)

Monthly student purchase activates AI while professional capacity remains
inactive:

![Student monthly AI active](../../artifacts/revenuecat-student-paywall-v1-20260724/app/09-monthly-active.png)

![Student monthly professional capability inactive](../../artifacts/revenuecat-student-paywall-v1-20260724/app/10-monthly-professional-inactive.png)

Reinstall and Test Store restore recover student AI without granting the
professional privilege:

![Student restore keeps professional capability inactive](../../artifacts/revenuecat-student-paywall-v1-20260724/app/13-restore-professional-inactive.png)

![Student AI restored](../../artifacts/revenuecat-student-paywall-v1-20260724/app/14-restored-active.png)

Account switching is isolated:

![Alternate account remains locked](../../artifacts/revenuecat-student-paywall-v1-20260724/app/15-alternate-account-locked.png)

![Original student account remains active](../../artifacts/revenuecat-student-paywall-v1-20260724/app/16-primary-account-active.png)

The professional AI gate presents the independent professional design and
activates professional access:

![Professional route paywall](../../artifacts/revenuecat-student-paywall-v1-20260724/app/17-professional-route-paywall.png)

![Professional route active](../../artifacts/revenuecat-student-paywall-v1-20260724/app/18-professional-active.png)

## Provider entitlement isolation

RevenueCat sandbox customer evidence independently confirms the live app
assertions. `rc-student-v1-monthly` has exactly `student_pro` backed by
`student_test_monthly`:

![Student customer has only student_pro](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/13-student-customer-entitlement.png)

`rc-student-v1-pro-route` has exactly `professional_pro` backed by
`professional_test_monthly`:

![Professional route customer has only professional_pro](../../artifacts/revenuecat-student-paywall-v1-20260724/dashboard/14-professional-route-customer-entitlement.png)

The remaining live captures for cancellation, simulated failure, duplicate
activation, annual purchase, and their provider sheets are retained under
`artifacts/revenuecat-student-paywall-v1-20260724/app/`.

## Scope boundaries

- This is RevenueCat Test Store evidence, not App Store receipt restore or
  Google Play purchase-token restore evidence.
- The temporary student paywall remains published on `test_student` so the
  reviewed state is reproducible. Promoting the approved design to
  `default_student` and then deactivating the temporary paywall requires the
  separate approval described in the rollout plan.
- Development Android RevenueCat app permissions, Android products/base plans,
  App Store missing product metadata, Android live rendering, and true
  two-platform sandbox restore remain separate release-readiness action items.
- No RevenueCat Targeting rule was created; the app explicitly presents the
  role-resolved offering.
