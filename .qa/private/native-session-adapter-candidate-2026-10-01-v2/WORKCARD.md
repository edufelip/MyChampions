# Candidate iOS explicit session charter workcard

Status: **Candidate only; source implementation prepared, public dispatcher/runtime
Pending**.

This v2 packet is a private review artifact. It does not edit canonical source,
public dispatch, inventory, declaration, documentation, product auth behavior,
or runtime resources. The unified diff is based on the final locale/lifecycle
capture source hash recorded below and keeps the legacy `auth-account` branch
unchanged.

## Governing contract

The authoritative session order is in
`docs/qa/native-pilot/test-cases.md` and the six rows in
`docs/qa/native-pilot/inventory.json`:

1. native coach login;
2. terminate/relaunch and restore the same coach;
3. open Account;
4. open and cancel sign-out confirmation;
5. reopen and confirm sign-out once;
6. terminate/relaunch while signed out;
7. compare the owned SQL domain before/after without claiming auth-session rows
   or server revocation.

The patch adds a private capture charter named `session` to the existing iOS
capture entry point. It does not reinterpret the old `auth-account` diagnostic,
whose sealed evidence remains preserved at
`.qa/artifacts/native-pilot/50ddeb1f3d43a32fd441b065/`.

Patch base: `scripts/testing/capture-native-testability.ts` SHA-256
`3421ffc87b3d8afb572cfd1e166169cb281504630c9f17bc633414632dac5b18`.

## Candidate source implementation

`capture-native-testability.session-charter.patch` adds:

- `session` to `iosNativeCharters`, so the existing argument parser can select
  it without a new harness;
- native auth identity capture bound to the seeded fixture accounts, plus an
  initial coach sign-in witness bound to the owned API PID/origin and request;
- `session.snapshot('native-entry-ios')` before credential actions and again
  after signed-out relaunch, persisted as
  `session-sql-before.private.json` and
  `session-sql-after-signed-out-relaunch.private.json`;
- a separate ordered branch after the shared login prelude. It performs restore
  first, then Account/identity, confirmation/cancel, reopen/confirm, and the
  signed-out relaunch. The legacy `auth-account` branch remains in place;
- `sessionAssertionSequence` tied to `nativeSessionAssertionIds` and
  `sessionUiObservationOrder` with distinct `signout-reopen` and
  `signout-confirmed` frames;
- `signedOutRelaunchTransport` sliced from the complete proxy stream with
  start/end ordinals and first/last request IDs. Every row must be native,
  forwarded, owned-API targeted, and free of sign-in or `/me/hydrate` routes;
- exact `trainingPlans`/`connections` equality after the signed-out relaunch,
  while preserving the FR-270/BR-342 `local-native-session-clear` scope and
  `serverRevocationQualified: false`.

The patch does not add SQL text or a second session/backend/proxy acquisition.
All SQL comes through the existing owned snapshot protocol and schema validator.

## Candidate validator and controls

`native-session-adapter.candidate.ts` validates the explicit `session` charter,
the frozen six-row ledger, exact UI sequence, fixture-bound initial auth
witness shape, restoration hydrate, signed-out transport ownership/range,
storage clearing, snapshot receipts, schema-valid snapshots, and unrelated
state equality. It always returns `nativePassingCases: 0` and is not a public
receipt.

`native-session-adapter.candidate.test.ts` is resource-free and uses synthetic
evidence only. It covers:

- a complete ordered bundle;
- rejection of the legacy charter, reordered UI and incomplete ledger;
- missing, authenticated, foreign-target, or range-tampered signed-out
  transport;
- missing/tampered snapshots and unrelated SQL mutation; and
- forged server-revocation qualification plus static patch boundaries.

Synthetic tests establish contract behavior only. Promotion still needs the
existing `readNativeEvidence` bytes/tree/selector rules, actual artifact
ownership, fixture actor witness, and public receipt/dispatch review.

`actual-capture-preflight.candidate.ts` reads the sealed legacy capture without
altering it. It reports that the original remains `observed`/`cleaned` with zero
passes, while the v2 `session` charter is rejected because the legacy capture
has no v2 ledger, identity, SQL, or signed-out-slice fields.

## Focused controls

```sh
./node_modules/.bin/tsx --test \
  .qa/private/native-session-adapter-candidate-2026-10-01-v2/native-session-adapter.candidate.test.ts
./node_modules/.bin/tsx \
  .qa/private/native-session-adapter-candidate-2026-10-01-v2/actual-capture-preflight.candidate.ts
./node_modules/.bin/prettier --check \
  .qa/private/native-session-adapter-candidate-2026-10-01-v2/WORKCARD.md \
  .qa/private/native-session-adapter-candidate-2026-10-01-v2/native-session-adapter.candidate.ts \
  .qa/private/native-session-adapter-candidate-2026-10-01-v2/native-session-adapter.candidate.test.ts \
  .qa/private/native-session-adapter-candidate-2026-10-01-v2/actual-capture-preflight.candidate.ts
git apply --check \
  .qa/private/native-session-adapter-candidate-2026-10-01-v2/capture-native-testability.session-charter.patch
yarn typecheck
```

The packet must be reviewed against `PACKET-MANIFEST.json` before any peer
review. No native simulator, backend, proxy, Metro process, build, or public
pilot denominator may be acquired for this candidate-only step.
