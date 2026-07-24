# RevenueCat Custom Paywalls Specification

Status: Professional Paywall v1 and temporary Student Paywall v1 Test were published and live-validated through RevenueCat Test Store on 2026-07-24. Promotion to `default_student` and platform-store validation remain pending and separately approval-gated.

## Purpose

Define the first custom RevenueCat paywalls for the two independent MyChampions subscription privileges:

- `default_professional` grants only `professional_pro`.
- `default_student` grants only `student_pro`.
- Temporary development/Test Store offering `test_student` grants only `student_pro` and must never resolve in production.

The paywalls must preserve the product, entitlement, offering, account-isolation, restore, and fail-closed behavior defined by D-132, D-152, BR-338, SC-212, and SC-219.

## Provider Preconditions

A platform-store paywall may be published to test targeting only after all of the following are true:

1. App Store Connect products no longer report `Missing Metadata`.
2. Google Play monthly and annual base plans are available to the approved test track.
3. RevenueCat resolves monthly and annual packages for both offerings on both platforms.
4. Every product is attached to exactly one intended entitlement.
5. A provider mutation window and reviewer are explicitly approved.

The RevenueCat dashboard had no custom paywalls during the 2026-07-23 audit. On 2026-07-24 the user approved a narrower Test Store exception for the first professional slice and then a controlled student slice: create temporary offering `test_student`, attach only the two student Test Store packages, publish `Student Paywall v1 Test`, and capture live app evidence. Neither exception clears an App Store or Google Play prerequisite. A dashboard preview or Test Store result is not evidence that App Store or Google Play packages resolve.

## Offering Contract

| Paywall | Offering | Packages | Entitlement after purchase | Forbidden result |
|---|---|---|---|---|
| Professional | `default_professional` | `$rc_monthly`, `$rc_annual` | `professional_pro` active | `student_pro` changes because of this purchase |
| Student AI | `default_student` | `$rc_monthly`, `$rc_annual` | `student_pro` active | `professional_pro` changes because of this purchase |
| Student AI Test | `test_student` (temporary dev/Test Store only) | `$rc_monthly`, `$rc_annual` | `student_pro` active | Any production resolution or `professional_pro` change |

Prices, currencies, billing periods, introductory eligibility, and renewal terms must come from the platform package presented by the RevenueCat SDK. They must not be hard-coded into the paywall copy.

### Package mapping by provider app

The paywall binds RevenueCat package identifiers, not a hard-coded product ID. Before test publication, each app-specific package mapping must match this table:

| Provider app | `default_professional` `$rc_monthly` / `$rc_annual` | `default_student` `$rc_monthly` / `$rc_annual` | Readiness |
|---|---|---|---|
| Production App Store | `professional_monthly` / `professional_annual` | `student_monthly` / `student_annual` | Blocked on App Store metadata completion |
| Production Google Play | `professional_monthly` / `professional_annual` | `student_monthly` / `student_annual` | Blocked; products/base plans do not exist |
| Development Google Play | `professional_monthly` / `professional_annual` | `student_monthly` / `student_annual` | Blocked; RevenueCat development Android app and Play app/catalog do not exist |
| RevenueCat Test Store | `professional_test_monthly` / `professional_test_annual` | `student_test_monthly` / `student_test_annual` | Configured for deterministic provider testing; not platform restore evidence |

The existing development App Store products `professional_test` and legacy `student_text` remain compatibility-only development mappings. They do not satisfy the final two-package platform matrix and must not be presented as production catalog evidence.

## Content and Layout

Use one visually distinct paywall per offering while keeping interaction order consistent:

1. Close control with an accessibility label.
2. Plan-specific title and value proposition.
3. Monthly and annual package choices using localized storefront price and period.
4. Clear selected-package state.
5. Purchase CTA whose label does not imply a free trial unless the selected store product confirms eligibility.
6. Auto-renewal and store-management note.
7. Restore purchase action.
8. Terms of Service and Privacy Policy links.
9. Provider/store error area that leaves close and restore usable.

Professional value proposition must describe professional capacity and tools without promising that a subscription alone creates or assigns students. Student value proposition must describe AI meal-analysis access without implying professional-management access.

Student Paywall v1 uses the same MyChampions tokens and interaction order as Professional Paywall v1, with a camera/sparkles header and no decorative media or professional-capacity messaging. Monthly is selected by default and Annual is the alternative. The package price and billing period remain provider variables.

The exact localized student benefits are:

| Locale | Benefits |
|---|---|
| `en-US` | Estimate calories and macros from a meal photo · Review and edit every estimate before saving · Keep standard meal tracking available for free |
| `pt-BR` | Estime calorias e macronutrientes a partir de uma foto da refeição · Revise e edite cada estimativa antes de salvar · Continue usando o acompanhamento padrão de refeições gratuitamente |
| `es-ES` | Estima calorías y macronutrientes a partir de una foto de la comida · Revisa y edita cada estimación antes de guardar · Sigue usando gratis el seguimiento estándar de comidas |

Reuse the app's approved legal destinations:

- Terms fallback: `https://portfolio.eduwaldo.com/projects/my-champions/terms_of_use`
- Privacy fallback: `https://portfolio.eduwaldo.com/projects/my-champions/privacy_policy`

Runtime environments may supply the approved `EXPO_PUBLIC_TERMS_URL` and `EXPO_PUBLIC_PRIVACY_POLICY_URL`; provider content must be kept aligned with those destinations.

## Localization

Initial supported locales are `en-US`, `pt-BR`, and `es-ES`. Provider copy must be reviewed beside the corresponding app subscription/legal vocabulary. Existing app strings such as `pro.subscription.cta_restore`, `pro.subscription.purchase_note`, and the account Terms/Privacy labels are terminology references, not permission to publish unreviewed copy.

### Provider copy

The professional rows and temporary Student Paywall v1 Test rows below are the
published 2026-07-24 copy. Promotion of the student design to
`default_student` remains separately approval-gated. Dynamic storefront price
and period appear beside the content and must remain provider-driven.

| Element | `en-US` | `pt-BR` | `es-ES` |
|---|---|---|---|
| Professional title | Grow your professional practice | Expanda sua atuação profissional | Haz crecer tu práctica profesional |
| Professional value | Manage more than 10 active students and unlock AI meal-photo analysis. | Gerencie mais de 10 alunos ativos e desbloqueie a análise de refeições por foto com IA. | Gestiona más de 10 alumnos activos y desbloquea el análisis de comidas por foto con IA. |
| Student title | Unlock AI meal analysis | Desbloqueie a análise de refeições com IA | Desbloquea el análisis de comidas con IA |
| Student value | Analyze meal photos with AI. Student tracking remains available without a subscription. | Analise fotos de refeições com IA. O acompanhamento do aluno continua disponível sem assinatura. | Analiza fotos de comidas con IA. El seguimiento del alumno sigue disponible sin suscripción. |
| Purchase CTA | Continue with selected plan | Continuar com o plano selecionado | Continuar con el plan seleccionado |
| Restore | Restore purchases | Restaurar compra | Restaurar compra |
| Store note | Subscription is managed through your device app store. | A assinatura é gerenciada pela loja de aplicativos do seu dispositivo. | La suscripción se gestiona mediante la tienda de aplicaciones de tu dispositivo. |
| Close accessibility label | Close subscription offer | Fechar oferta de assinatura | Cerrar oferta de suscripción |
| Terms | Terms of Service | Termos de Uso | Términos de servicio |
| Privacy | Privacy Policy | Política de Privacidade | Política de Privacidad |

Do not display savings percentages, trial claims, “best value,” or renewal dates unless they are derived from the selected storefront package and reviewed for every supported locale.

Long translations, dynamic prices, large accessibility text, and right-to-left behavior where the provider component supports it must not clip the package selector, purchase CTA, restore action, legal links, or close control.

## Interaction and Recovery

- Dismissal without purchase refreshes customer info and returns to the locked surface when the intended entitlement is still inactive.
- Purchase success refreshes both known entitlement snapshots, while only the purchased offering's entitlement becomes active.
- Cancellation is not an error and never grants access.
- Store/provider/network failure preserves the user's ability to close, retry, or restore.
- Restore runs through the platform receipt/token flow for App Store and Google Play evidence. RevenueCat Test Store retained-customer behavior is not accepted as platform restore proof.
- Account changes remain serialized through the process-global RevenueCat coordinator. A result for user A cannot update user B.
- Paywall presentation resolves the exact required offering before calling
  RevenueCatUI. A missing `default_professional`, `default_student`, or approved
  development-only `test_student` offering is a configuration failure; the app
  must not pass an absent offering and allow the SDK to fall back to its current
  offering.

## Accessibility and Visual Review

Before test publication, capture and review both paywalls on the smallest and largest supported phone sizes in light and dark appearance:

- Screen reader announces title, package price/period, selected state, purchase, restore, close, Terms, Privacy, and errors.
- Focus order follows the visual order and never traps the user.
- Interactive targets meet the app's minimum touch-target policy.
- Dynamic Type / font scaling keeps purchase, restore, legal, and close controls reachable.
- Contrast and selected-package indication do not rely on color alone.
- Loading and disabled states are announced and do not enable duplicate purchase submissions.

## Test Publication Gate

Publish first only to an explicitly approved test audience. The evidence package must include:

- RevenueCat screenshots showing the paywall-to-offering bindings.
- Package mapping screenshots for both platforms and both entitlements.
- Light/dark and supported-locale previews.
- Detox purchase success, cancellation, failure, duplicate-tap, close, and restore selectors.
- App Store and Google Play sandbox purchase/reinstall/restore evidence using unique customers.
- RevenueCat customer events and MyChampions server snapshots proving the unrelated entitlement and alternate users stayed inactive.

### Validation matrix

| ID | Mode | Scenario | Expected result | Accepted evidence |
|---|---|---|---|---|
| PW-01 | RevenueCat preview | Professional and student paywalls in all three locales, light/dark, smallest/largest supported phones | Copy, dynamic price/period slots, close, restore, Terms, and Privacy remain visible and reachable | Provider screenshots plus accessibility review |
| PW-02 | Provider mapping audit | Inspect both offerings for every provider app | Monthly/annual packages match the package table; every product attaches to only its intended entitlement | RevenueCat product/entitlement/offering screenshots |
| PW-03 | Deterministic Detox | Open each locked app surface and dismiss with close | Correct offering opens; dismissal grants nothing; source surface remains usable | Detox selectors/logs |
| PW-04 | Deterministic Detox | Cancellation, store error, network error, repeated purchase tap | No grant; no duplicate purchase; retry, restore, and close remain available | Detox selectors/logs |
| PW-05 | Test Store | Buy professional, then buy student with a separate unique user | First user becomes professional-only; second becomes student-only; server snapshots agree | RevenueCat events, runner logs, server snapshots |
| PW-06 | App Store sandbox | Buy, cancel/fail, reinstall, and explicitly restore monthly and annual packages with unique users | StoreKit receipt restore returns only the purchased entitlement | Video/screenshots, RevenueCat events, server snapshots |
| PW-07 | Google Play sandbox | Buy, cancel/fail, reinstall, and explicitly restore monthly and annual base plans with licensed testers | Play purchase-token restore returns only the purchased entitlement | Internal-track video/screenshots, RevenueCat events, server snapshots |
| PW-08 | Platform sandbox | Switch from purchaser A to unrelated user B during/after purchase or restore | Serialized login completes; A state never updates B; switching back returns A state | Runner log, both customer records, both server snapshots |
| PW-09 | Platform sandbox | Renewal, grace/account hold, expiration, refund/revoke where supported | Canonical state follows store/provider lifecycle; unrelated entitlement is preserved; restricted writes fail closed | Store/RevenueCat timeline and server snapshots |
| PW-10 | Targeting audit | Inspect test and production targeting after initial test publication | Only the approved test audience receives the custom paywalls; production targeting remains unchanged | RevenueCat targeting screenshots and reviewer sign-off |

PW-03 and PW-04 validate app integration but cannot complete PW-06 or PW-07. PW-05 validates provider orchestration but cannot complete platform receipt/token restore.

Production targeting remains a separate approval after the test evidence is accepted.

## Professional V1 Validation Record

The 2026-07-24 professional slice produced
`docs/reviews/revenuecat-professional-paywall-v1-evidence-report.md` and the
evidence bundle under `artifacts/revenuecat-paywall-v1-20260724/`.

Completed:

- RevenueCat paywall `pwb482ef7d20a04e4f` published on
  `default_professional`;
- en-US, pt-BR, and es-ES copy plus light/dark previews reviewed;
- iPhone SE responsive preview and live iPhone 17 render reviewed;
- native accessibility labels asserted for headline, Annual, Monthly,
  purchase, restore, Terms, and Privacy;
- live Test Store dismissal, cancellation, failure, valid purchase, restore,
  account isolation, and student/professional privilege isolation passed.

Still open:

- promotion of the approved student design from temporary `test_student` to a
  distinct `default_student` production paywall;
- RevenueCat Targeting rules (Professional V1 is published directly on the
  explicitly presented offering);
- Android live rendering;
- Dynamic Type, full screen-reader focus traversal, and RTL review;
- App Store and Google Play catalog resolution and true platform sandbox
  purchase/reinstall/restore evidence.

## Student V1 Test Validation Record

The 2026-07-24 controlled student slice produced
`docs/reviews/revenuecat-student-paywall-v1-test-evidence-report.md` and the
evidence bundle under
`artifacts/revenuecat-student-paywall-v1-20260724/`.

Completed:

- temporary offering `test_student` contains only `$rc_monthly` /
  `student_test_monthly` and `$rc_annual` / `student_test_annual`;
- RevenueCat paywall `pw92ab4568bc274596` is published on `test_student`;
- en-US, pt-BR, and es-ES copy plus light/dark, iPhone SE, and largest-phone
  previews were reviewed;
- the first live dismissal exposed an unlabeled native close control; localized
  `Close`, `Fechar`, and `Cerrar` labels were added, republished, and asserted;
- the app resolves `test_student` only for explicit development Test Store
  builds, rejects the override in production, and routes professional AI gates
  to `default_professional`;
- all nine live scenarios passed: dismissal, cancellation, simulated failure,
  duplicate activation, monthly purchase, annual purchase, reinstall/restore,
  account switch, and professional-route isolation;
- provider customer records confirm the student customer holds only
  `student_pro` and the professional-route customer holds only
  `professional_pro`.

Still open:

- separately approved duplication/promotion to `default_student`, followed by
  deactivation of the temporary test paywall;
- Android live rendering, Dynamic Type, full screen-reader focus traversal, and
  RTL review;
- App Store and Google Play catalog resolution and true platform sandbox
  purchase/reinstall/restore evidence.
