# Typed Error Contracts v1 (ET-230)

## Scope and intent

ET-230 replaces message parsing at the meal-photo, email sign-up, and
RevenueCat boundaries with typed, source-specific classification. A producer
emits a machine-readable code or transport context once; downstream hooks and
screens consume the resulting domain reason. Diagnostic prose is never a
machine contract, never displayed as backend text, and never used to grant,
revoke, or infer access.

This change preserves the existing server envelopes, auth/session lifecycle,
account-enumeration protections, RevenueCat offerings, entitlement rules, and
successful macro response shape. There is no schema migration, provider SDK
upgrade, purchase retry, or production provider operation in this scope.

## Producer and consumer inventory

| Boundary | Producer | Domain mapper | Consumers | Contract status |
| --- | --- | --- | --- | --- |
| Meal photo | `features/nutrition/meal-photo-analysis-source.ts`, server `POST /nutrition/meal-photo-analysis` | `photo-analysis-error.ts`, source HTTP status/body adapter | `use-meal-photo-analysis`, SC-214 builder, SC-215 quick log, SC-219 | Done for current flat and nested envelopes; provider-live validation remains separate |
| Email sign-up | `email-auth-source.ts`, `server-auth-source.ts`, typed `CreateAccountFailure` branches | `features/auth/create-account.logic.ts` | SC-218 create-account submit/error state and auth route handoff | Done; session and anti-enumeration behavior unchanged |
| Subscription purchase/restore | RevenueCat source wrappers and paywall outcome adapter | `features/subscription/revenuecat-error.ts`, `subscription-source.ts` | SC-212 professional subscription, SC-214/SC-215/SC-219 AI gate, `useSubscription` | Done for installed SDK declarations; store receipt validation remains separate |

All unknown or malformed values have deterministic fallback behavior. The
shared `read-error-fields.ts` helper only reads own data properties through
descriptors, does not invoke getters or coercion, bounds inspected strings to
128 characters, and survives arrays, symbols, throwing proxies, and revoked
proxies. It performs no domain classification.

## Meal-photo mapping

The existing `PhotoAnalysisErrorReason` union remains authoritative:

`permission_denied | file_too_large | unrecognizable_image |
quota_exceeded | network | invalid_response | configuration |
unauthenticated | unknown`

| Input | Result | Precedence |
| --- | --- | --- |
| Native `photo_permission_denied` | `permission_denied` | Exact producer alias |
| Exact domain code | Same domain reason | Code is independent of message/locales |
| Fetch rejection | `network` | Applies only around the fetch call |
| HTTP 401/403 | `unauthenticated` | Overrides body semantics |
| HTTP 413 | `file_too_large` | Applies even to HTML/empty bodies |
| HTTP 429 | `quota_exceeded` | Applies even to HTML/empty bodies |
| Nested `error.code`, string `error`, or flat `code` | Exact documented code mapping | Conflicting/present malformed fields become `invalid_response` |
| Unknown non-empty code | `unknown` | Message cannot rescue it |
| 2xx recognized error body | Mapped typed error | It cannot be parsed as success |
| Remaining non-2xx with valid object body | `unknown` | Macro-shaped body never succeeds on non-2xx |
| Non-object, array, or invalid JSON body | `invalid_response` | No unsafe coercion |

The server continues to return its current `401` nested unauthorized envelope,
`422` domain envelope, `429` quota envelope, and `503` configuration envelope.
The client accepts those shapes plus the current flat compatibility shape. Raw
messages are not shown and manual meal entry remains available after every
failure.

## Sign-up mapping and privacy

`CreateAccountErrorReason` remains:
`requires_sign_in | network | provider_conflict | configuration | unknown`.

Only a validated `CreateAccountFailure` or an exact structured source code is
accepted. ASCII-lowercased aliases are deliberately narrow:

| Exact code alias | Result |
| --- | --- |
| `network`, `network_error`, `timeout` | `network` |
| `provider_conflict`, `provider-conflict` | `provider_conflict` |
| `configuration`, `missing_config`, `server_not_configured` | `configuration` |

Message-only text, duplicate-account wording, `USER_ALREADY_EXISTS`,
`already registered`, and near-matches remain `unknown`. `requires_sign_in`
comes only from the existing explicit session-establishment branch after a
privacy-preserving create-account acknowledgement. The email-auth source's
status mapping and the follow-up sign-in/session persistence sequence are
unchanged. No user-facing or analytics output distinguishes whether an email
already exists.

## RevenueCat mapping

The table is pinned by a contract test to the installed
`@revenuecat/purchases-typescript-internal` declaration used by
`react-native-purchases@9.15.2` (internal declaration `17.55.1`). The internal
package is read only by the test; production code does not import it.

| Installed provider code | Domain reason |
| --- | --- |
| `1` `PURCHASE_CANCELLED_ERROR` | `purchase_cancelled` |
| `20` `PAYMENT_PENDING_ERROR` | `payment_pending` |
| `10`, `32`, `35` | `network` |
| `11`, `14`, `17`, `23` | `configuration` |
| `19` | `unauthenticated` (classification only) |
| `2`, `3`, `4`, `5`, `6`, `7`, `8`, `9`, `13` | `store_problem` |
| Every other current or future value | `unknown` |

Supported readable aliases are explicit: `purchase_cancelled`,
`purchase_canceled`, `payment_pending`, `network_error`,
`configuration_error`, `invalid_api_key`, `store_problem`,
`store_transaction_unverified`, `unauthorized`, and the exact lowercased
installed enum names.

Normalization precedence is:

1. Preserve a validated local `SubscriptionSourceError` reason.
2. Map a known string or explicit finite non-negative integer provider code.
3. Treat a present but unknown/malformed provider code as `unknown`; neither
   `message` nor `userCancelled` can rescue it.
4. When no code exists, read exact recognized `userInfo.readableErrorCode`, then
   deprecated top-level `readableErrorCode`; conflicting recognized aliases are
   `unknown`.
5. Use `userCancelled: true` as the narrow no-code compatibility fallback.
6. Otherwise return `unknown`.

`20` always maps to `payment_pending`, including when `userCancelled` is true.
Provider messages are ignored. Source wrappers throw short fixed diagnostic
messages through `SubscriptionSourceError`; raw SDK objects do not reach UI or
ordinary logs.

## Payment-pending semantics and consumers

`payment_pending` means the store has not completed processing. It is neither
success nor voluntary cancellation. The hook clears loading, preserves the
current auth-scoped entitlement state, and shows a neutral localized notice.
It does not poll, retry purchase/restore, grant access, revoke existing access,
or mutate server entitlement state. A late result is ignored after the current
auth UID changes. Existing explicit Refresh/Check status actions remain the
user's recovery path.

The same reason is rendered by every affected consumer:

- SC-212 `/professional/subscription` keeps the current active/inactive status
  and renders a polite live pending notice.
- SC-219 AI analysis uses the same notice in both SC-214 builder and SC-215
  quick-log surfaces. The notice does not open a paywall or change the AI
  entitlement gate.
- `subscription-error-copy.ts` is an exhaustive
  `Record<SubscriptionErrorReason, TranslationKey>` so a new reason cannot
  silently fall back to a cancellation message.

The pending text is present in `en-US`, `pt-BR`, and `es-ES` under
`subscription.error.payment_pending`, and the copy table records all three
translations.

## Validation and deferred evidence

The app mapper tests cover every installed numeric enum, numeric/string
equivalence, every readable enum alias, hostile prototype names, malformed
objects, revoked proxies, code/flag precedence, and pending consumer state.
Meal-photo tests cover status precedence, flat/nested envelopes, malformed
bodies, conflicts, unknown codes, 2xx error bodies, and non-2xx macro-shaped
bodies. Auth tests cover exact aliases, message-only negatives,
anti-enumeration wording, and revoked proxies. The server contract tests retain
the current `401/422/429/503` envelopes and request-validation behavior.

Local unit/typecheck evidence can establish classification and presentation
contracts. Real RevenueCat receipt behavior, platform restore, and provider
live catalog validation remain pending under the existing store-validation
gate; no purchase or provider credential was used for ET-230.
