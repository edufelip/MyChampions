# Candidate iOS session adapter workcard

Status: **Candidate only; capture seam prepared, dispatcher/runtime Pending**.

This packet is intentionally outside the canonical declaration, contract,
inventory and public runner. It does not acquire an iOS simulator, backend,
proxy, Metro process or build, and it cannot produce a native/public pass.

## Reuse boundary

The adapter must reuse the existing `auth-account` path in
`scripts/testing/capture-native-testability.ts`. That charter already records:

- native UI hierarchy/screenshot frames for sign-in, home, account,
  sign-out confirmation/cancel, restored home/account/identity, signed-out
  state and signed-out relaunch;
- redacted owned-proxy observations in
  `transport-observations.private.json`;
- session metadata shape/presence through `observeIosAuthMetadata`; and
- the existing FR-270/BR-342 local-clear contract with server revocation left
  unqualified.

The current charter does not expose two inputs required by the six-row session
contract: a distinct signed-out-relaunch transport slice and before/after SQL
domain snapshots. The candidate validator rejects either input when absent;
`capture-native-testability.seam.patch` adds those fields by calling the
existing owned `session.snapshot('native-entry-ios')` contract, writing the two
private snapshots, and slicing proxy observations around the signed-out
relaunch. It does not reorder the existing diagnostic or adopt the dispatcher.

The latest sealed private diagnostic is
`.qa/artifacts/native-pilot/50ddeb1f3d43a32fd441b065/`. Its
`capture.private.json`, `transport-observations.private.json`, hierarchy/
screenshot pairs and `native-storage-system.private.log` provide the existing
UI/API/storage provenance. The capture has no SQL snapshot files and no
persisted signed-out-relaunch transport slice, so it is useful provenance for
this candidate but cannot be projected into a session-adapter result by itself.

## Candidate files

- `native-session-adapter.candidate.ts` validates a frozen
  `SCN-session-ios` / Maestro / integrated selection and the six ordered
  `NAT-session-*` rows, checks the canonical observation order and schema-valid
  UI/API/storage/SQL evidence. It returns
  `nativePassingCases: 0` and `serverRevocationQualified: false`.
- `native-session-adapter.candidate.test.ts` uses synthetic private evidence
  only. It covers the valid ordered bundle, missing/tampered signed-out
  transport and all-observation range, missing/tampered snapshots, storage
  leakage, unrelated SQL mutation, forged server-revocation qualification and
  reordered ledger rejection. Synthetic fixtures never establish runtime
  ownership.
- `actual-capture-preflight.candidate.ts` reads the sealed diagnostic as-is and
  reports the candidate seam rejection because exactly the two SQL provenance
  fields are absent. It separately records the missing transport slice and the
  source-order gap; it never relabels the original `observed`/`cleaned`
  diagnostic.
- `capture-native-testability.seam.patch` is a candidate-only unified diff
  against canonical source hash
  `c9d6e2975e3b36bf82599d95a7153db6da7965f368eed016a5e4e6fcb86575c`.
- `PACKET-MANIFEST.json` freezes every candidate byte, dependency hash and
  focused validation log for review. The manifest itself is metadata and is not
  included in its own file list.

## Minimal future wiring packet

1. Validate the current selection and `requireNativePilotAssertions` before
   acquiring anything.
2. Reuse one `runOwnedIosNativeSession({ charter: 'auth-account' })` capture.
3. At the existing auth-account callback seam, capture a read-only SQL domain
   snapshot before the journey and after signed-out relaunch. The snapshot
   must prove unchanged `trainingPlans` and `connections`; auth-session rows
   remain outside this declared domain scope.
4. Persist the transport observations made after final sign-out/relaunch as a
   separate `signedOutRelaunchTransport` slice, with its range linked to the
   all-observation stream. It must contain no sign-in or `/me/hydrate` request.
5. Pass the existing report, transport observations and the two snapshots to
   the candidate validator. Keep the private artifact paths and hashes under
   the existing capture artifact root.
6. Retain existing cleanup/source-identity checks. Keep public dispatch,
   public receipt staging, Maestro/Detox promotion and runtime status changes
   out of this packet.

## Evidence rules

- UI paths must include the exact account/confirmation/cancel/relaunch frames;
  duplicate or missing frame paths reject.
- API evidence requires exactly one native forwarded `201` sign-in, exactly one
  native forwarded `200` restoration hydrate, no second restoration sign-in,
  and no authenticated request after signed-out relaunch.
- Storage evidence requires a shaped session before/after restoration, absent
  metadata after sign-out and signed-out relaunch, and no plaintext token
  fields. The adapter does not read token values.
- SQL evidence compares the owned read-only domain snapshots exactly. It does
  not claim auth-session storage or server-side revocation from that snapshot.

## Promotion blockers intentionally retained

The current `auth-account` diagnostic opens Account and captures the first
sign-out confirmation/cancel before its restore relaunch. The source contract
requires login, terminate/relaunch restore, Account/cancel, then reopen and
confirm sign-out, followed by signed-out relaunch. The candidate's ordered
observation check therefore rejects the current diagnostic; this packet does
not rearrange old evidence or claim a P4 session pass. A promoted adapter must
use an explicit canonical session branch and capture a distinct reopen/confirm
witness while preserving the sealed diagnostic.

The candidate UI check remains structural: it checks required names and view ID
shapes but does not yet read owned PNG bytes, actual hierarchy trees or mapped
selectors. Promotion must route through `readNativeEvidence` and the existing
native-view-evidence selector/hash rules. Likewise, promotion must bind SQL
snapshots to the actual owned run/fixture identity, bind API observations to
the native sign-in witness and fixture actor, and link the signed-out slice to
the all-observation ordinal/range. No synthetic `owned-run` or unbound strings
can establish provenance.

## Focused controls

```sh
./node_modules/.bin/tsx --test \
  .qa/private/native-session-adapter-candidate-2026-10-01-v1/native-session-adapter.candidate.test.ts
./node_modules/.bin/tsx \
  .qa/private/native-session-adapter-candidate-2026-10-01-v1/actual-capture-preflight.candidate.ts
./node_modules/.bin/prettier --check \
  .qa/private/native-session-adapter-candidate-2026-10-01-v1/native-session-adapter.candidate.ts \
  .qa/private/native-session-adapter-candidate-2026-10-01-v1/native-session-adapter.candidate.test.ts \
  .qa/private/native-session-adapter-candidate-2026-10-01-v1/actual-capture-preflight.candidate.ts
yarn typecheck
```

The candidate test is resource-free and must remain separate from the 400-cell
pilot denominator until the capture seam and public adapter receive their own
review and runtime evidence.
