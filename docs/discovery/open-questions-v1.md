# Open Questions V1 (Remaining)

- None currently.

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
- `Q-010`: Food API final selection approved as fatsecret Platform API.
- `Q-011`: Specialty-removal guard fixed to `active + pending` constraint.
- `Q-012`: Student-visible credential field scope fixed to `registry_id + authority + country` (assigned professionals only).
- `Q-013`: Invite-code regeneration fixed to auto-cancel pending requests tied to superseded code.
- `Q-015`: Offline cache policy fixed to 24-hour TTL with stale-data indicator and last-sync timestamp.
- `Q-016`: Password special-character policy fixed to ASCII punctuation symbols only.
- `Q-017`: Native directories (`ios/`, `android/`) committed from day 1; generate once with `expo prebuild` and maintain directly.
- `Q-018`: Tailwind library for MVP fixed to NativeWind.
- `Q-019`: OTA strategy fixed to `store-only` for MVP.
- `Q-020`: CI signing strategy fixed to `platform-native secret management`.
- `Q-021`: QA distribution fixed to TestFlight on release branches and Firebase App Distribution on pull requests to `develop`.
- `Q-022`: Post-compression media upload limits fixed at `<= 1.5 MB` and `<= 1600 px` longest side.
- `Q-023`: Non-crash monitoring deferred; Crashlytics-only in MVP for crashes/ANRs.
