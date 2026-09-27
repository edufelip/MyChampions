# ET-229 exercise retrieval and explicit suggestions

Status: **In progress**. This document records the app contract for the disabled-by-default ET-229 pilot. It does not enable TypeSafe, approve a provider trial, or establish production accuracy.

## User outcome and boundaries

SC-208 keeps ordinary exercise search available through the MyChampions server. The server may improve lexical retrieval deterministically behind `EXERCISE_SEARCH_V2_ENABLED`. A professional can then press an explicit, localized **Get a suggested match** action for the current query. The disclosure beside the action says that the current search text is sent to TypeSafe and that the professional chooses what to add.

The action is the consent event. It is never triggered by opening the modal, typing, ordinary search debounce, locale changes, ordinary Retry, or a previous consent. The suggestion can only highlight one catalog ID returned in the same response. It never adds to a draft, opens detail automatically, changes quantity or notes, saves a plan, or sends video URLs. Existing selection, Confirm, Save, role ownership, offline locks, and ID-only plan persistence remain authoritative.

The app build flag `EXPO_PUBLIC_EXERCISE_SUGGESTIONS_ENABLED` defaults to false. A flag alone does not authorize server inference; the server still requires both its own feature flags and explicit request consent. Missing/old server support, disabled provider, no match, unsupported constraints, rate limiting, malformed responses, and provider failure leave ordinary search usable.

## Client state and stale-response contract

`useExerciseSearch` keeps ordinary search and suggestion state separately. Every query transition, including an empty query, immediately invalidates both request generations through `invalidateQuery`. Ordinary and suggestion requests use independent counters so a suggestion cannot leave an ordinary request permanently loading, while query matching still requires the exact current trimmed query. Modal close/clear invalidates both counters and resets both states; mounted state is restored on effect setup for Strict Mode replay.

The modal cancels its 400 ms ordinary-search debounce when the explicit suggestion action is pressed. While a suggestion is pending, the input and ordinary rows remain available. When the suggestion response is for the current query, its server-returned rows replace the visible result set in server order and the selected row receives an accessible text badge. A stale response is hidden and cannot be selected. Unavailable/unsupported/no-match states are localized and offer an explicit retry where appropriate; no retry runs automatically.

## App HTTP contract

Ordinary search remains `POST /integrations/exercise/search` with bearer auth, `query`, `lang`, `page`, `pageSize`, and `x-request-id`. The new source operation calls only `POST /integrations/exercise/suggest` after the CTA, with the same auth/correlation headers and `{ query, lang, page: 1, pageSize, consent: true }`. It requires `schemaVersion: exercise-suggestion.v1`, the documented status union, and validates `suggestion.exerciseId` against returned result IDs before exposing it to UI. Malformed responses become a typed source error. A 404/old server is a recoverable unavailable path for the explicit action and does not change ordinary search behavior.

The dev-only E2E fixture mirrors the server response shape and delays it briefly so loading and stale-response guards can be observed without provider calls. Fixture captures are development evidence only; they are not held-out provider validation.

## Documentation traceability

- Screen: `SC-208` exercise search/detail behavior and plan-save boundaries.
- Functional/domain requirements: `FR-001` training-plan and server-proxy requirements.
- Business rules: `BR-002` plan ownership and ID-only persistence.
- Use case: `UC-002.22` exercise search via the MyChampions server.
- Acceptance criteria: `AC-002` exercise proxy and key-exposure scenarios.
- Test cases: `TC-315`–`TC-319`, `TC-332`, and the ET-229 semantic browser/source suites.
- Copy source: `docs/screens/v2/localized-copy-table-v2.md`; every key is populated in `en-US`, `pt-BR`, and `es-ES`.

The app implementation deliberately does not import the TypeSafe SDK or store a provider credential. The server owns candidate retrieval, eligibility, limits, response validation, and provider configuration.

## Activation gates and pending wiring

The current acceptance evidence is deterministic source/unit coverage, a fake-adapter local route, and a dev-only fixture browser run. It does not prove held-out precision, recall, cost, production latency, or live provider behavior. Before any enablement, the owner must freeze and label the required multilingual held-out set, publish candidate recall and semantic precision with confidence intervals, review hard-constraint violations, install spend controls, and verify the single-process limiter assumption. Until then, the app and server flags remain disabled by default.

The ET-229 task card and `docs/discovery/pending-wiring-checklist-v1.md` track this status separately from implementation completion. No native runtime change is introduced; a native smoke run remains a follow-up if the shared modal changes native behavior.
