# Open Questions V1 (Remaining)

- Operational promotion questions remain below; product behavior questions
  already resolved in this file remain closed.

## Decision Notes

### Q-011 Specialty Removal Guard Scope (Resolved)

- Decision made:
  - Block specialty removal when there are `active + pending` requests.
- Option A (`active` only):
  - Pros: professional can reorganize specialties faster.
  - Cons: pending requests can become orphaned or inconsistent after specialty removal unless extra cleanup logic is added.
- Option B (`active + pending`):
  - Pros: deterministic lifecycle integrity; no pending request survives for a specialty that no longer exists.
  - Cons: professional may need to clear pending queue before removing specialty.
- Decision:
  - Use `active + pending`.
  - Include explicit decline/cancel flows for pending requests.
- Why this is safer:
  - Prevents invalid state transitions and reduces hidden side effects.

### Q-012 Student-Visible Credential Field Scope (Resolved)

- Decision made:
  - Show `registry_id + authority + country`.
- Option A (`registry_id` only):
  - Pros: minimal data exposure and simpler UI.
  - Cons: low interpretability in international context; students may not understand what the ID refers to.
- Option B (`registry_id + authority + country`):
  - Pros: enough context for global markets and clearer trust signal without verification badges.
  - Cons: slightly more profile data shown.
- Decision:
  - Use `registry_id + authority + country`.
  - Keep visibility only for currently assigned professionals.
  - Keep copy neutral (no verification badge/filter).
- Why this is safer:
  - Better user comprehension with limited additional exposure.

### Q-013 Pending Requests On Invite-Code Regeneration (Resolved)

- Decision made:
  - Auto-cancel pending requests created from old code when code is regenerated.
- Option A (keep pending):
  - Pros: no disruption to legitimate pending students.
  - Cons: weaker leak-response path; old leaked requests stay in queue.
- Option B (auto-cancel pending from old code):
  - Pros: strongest leak containment and clean queue reset.
  - Cons: legitimate pending students must request again using new code.
- Decision:
  - Auto-cancel pending requests tied to the superseded code.
  - Record `canceled_reason = code_rotated` for auditability and support.
- Why this is safer:
  - Regeneration becomes a complete containment action instead of partial mitigation.

## Resolved

- `Q-010`: Food API final selection approved behind the MyChampions server food integration route. Mobile calls `POST /integrations/food/search`; the server owns the food-service provider boundary and local catalog Postgres mirror.
- `Q-011`: Specialty-removal guard fixed to `active + pending` constraint.
- `Q-012`: Student-visible credential field scope fixed to `registry_id + authority + country` (assigned professionals only).
- `Q-013`: Invite-code regeneration fixed to auto-cancel pending requests tied to superseded code.
- `Q-015`: Offline cache policy fixed to 24-hour TTL with stale-data indicator and last-sync timestamp.
- `Q-016`: Password special-character policy fixed to ASCII punctuation symbols only.
- `Q-017`: Native directories (`ios/`, `android/`) committed from day 1; generate once with `expo prebuild` and maintain directly.
- `Q-018`: Tailwind library for MVP fixed to NativeWind.
- `Q-019`: OTA strategy fixed to `store-only` for MVP.
- `Q-020`: CI signing strategy fixed to `platform-native secret management`.
- `Q-021`: QA distribution is fixed to TestFlight on release branches. Pull
  requests to `main` use ephemeral native build/test proof; successful binaries
  are not uploaded and one-day failure diagnostics are the only PR artifacts.
- `Q-022`: Post-compression media upload limits fixed at `<= 1.5 MB` and `<= 1600 px` longest side.
- `Q-023`: Non-crash monitoring deferred; crash/ANR monitoring provider selection remains required before production release.
- `Q-024`: When will the corrected selective-CI publisher and protected native
  workflows receive exact-head hosted reruns on the approved self-hosted
  runners? Local workflow and contract checks pass, but hosted status,
  cancellation-cleanup, and duration/SLO evidence are not available yet.
- `Q-025`: When will the provider owner grant the permissions and Android
  catalog/app configuration required for Test Store and platform-store
  validation? Until then, provider and store-live evidence is blocked rather
  than represented by deterministic subscription fixtures.
- `Q-026`: Which approved visual baselines and ignore rectangles should be
  committed for the browser checkpoints? The comparator is implemented and
  unbaselined captures are emitted, but no baseline refresh is authorized by
  this change.
- `Q-027`: Which approved recurring schedule should run the persona rotation
  and monthly gap sweep? The first browser-first QA Run and dated report are
  complete; unattended automation remains intentionally unwired pending an
  explicit schedule and environment owner.
- `Q-028` (ET-104 / SC-205): Should a settled professional roster read error
  fall back to a cached read-only roster when one exists from a prior
  successful load, following the same stale-data policy as the professional
  dashboard (see `Q-015`), instead of always replacing the shell with the
  error card? Currently any settled error hides the roster shell regardless
  of prior successful data; see `docs/screens/v2/SC-205-student-roster.md`.
