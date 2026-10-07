# Candidate iOS explicit session charter v4 workcard

Status: **private candidate only; no dispatcher adoption, runtime qualification,
or public receipt**.

This packet is an immutable review artifact. It does not edit canonical source,
public dispatch, inventory, declarations, product auth behavior, or runtime
resources. The v4 source patch is based on the frozen capture source
SHA-256 `3421ffc87b3d8afb572cfd1e166169cb281504630c9f17bc633414632dac5b18`
and has patch SHA-256
`39e449771bed3a224c6d45391f4c477ef7df7311f6e1d04584af521c635e7294`.
Packets v1, v2, and v3 remain immutable; v3 manifest SHA-256 is
`de151620f6b1b9fc530ba74588fe7136efe62ada495718d17c4b8f2c67ab2589`.

## Governing order

The authoritative session contract is in
`docs/qa/native-pilot/test-cases.md`, the `SCN-session-ios` rows in
`docs/qa/native-pilot/inventory.json`, and the generated
`scripts/testing/native-pilot-contract.ts` assertion IDs. The adapter must
execute and record this order:

1. native coach login;
2. terminate/relaunch and restore the same coach;
3. open Account and capture the restored identity;
4. open and cancel sign-out confirmation;
5. reopen and confirm sign-out once;
6. terminate/relaunch while signed out;
7. compare the owned SQL domain before/after without claiming server
   revocation.

The sealed `auth-account` diagnostic at
`.qa/artifacts/native-pilot/50ddeb1f3d43a32fd441b065/` remains a legacy
observation. The v4 preflight reads it as-is, records the missing session
contract fields, and never relabels it as a session run.

## v4 source contract

`capture-native-testability.session-charter.v4.patch` includes the v3 ordered
session branch plus two strict seams:

- **Cancel is a real no-op checkpoint.** The generated Maestro flow includes
  `assertNotVisible` for `settings.account.signOutConfirm` after tapping the
  cancel CTA. The source then reads the actual post-cancel hierarchy, rejects a
  retained confirmation subtree, reads auth metadata again, and requires the
  session to remain present. The frame carries
  `notVisibleSelectors` and `cancelSignoutCheckpoint`; both are bound by the
  private candidate validator.
- **Session direct I/O is abort-safe.** Session-only container lookup, auth
  metadata reads, simulator terminate/launch, device verification, SQL
  snapshots, evidence reads/writes, and final frame publication run through
  `sessionDirectIo`. Bounded commands receive `controller.signal`. The ledger
  checks the signal before and after assignment, clears partial fields on an
  abort, and marks `sessionEvidencePublication` as
  `aborted-before-complete`. The outer cleanup guard removes any session ledger
  fields if cancellation races finalization.

The branch keeps the existing `session.snapshot('native-entry-ios')`, owned API
proxy identity capture, `readNativeEvidence`, and
`validateNativeRuntimeFrameFiles` paths. It adds no SQL text, backend/session
acquisition, auth policy, product copy, or public adapter dispatch.

## Private validator and actual loader

`native-session-adapter.candidate.ts` validates the six-row ledger, exact UI
order, actual PNG/hierarchy hashes/selectors, cancel subtree absence, retained
session metadata, fixture-bound auth identities, owned transport ranges, owned
SQL receipts, and abort-safe publication controls. Synthetic tests keep
`nativePassingCases: 0` and do not acquire a simulator, backend, proxy, Metro
process, or build.

`actual-capture-preflight.candidate.ts` exports
`loadActualIosSessionAdapterInput({ repositoryRoot, captureRoot })`. It loads
only owner/private bytes through `readNativeEvidence`:

- `capture.private.json` and the declared transport file in the capture root;
- `manifest.json` and `fixtures-native-entry-ios.private.json` in the actual
  owned backend artifact root declared by the capture;
- the declared native-auth identity and before/after SQL files, once the
  capture declares their relative paths.

It derives the current `SCN-session-ios` selection through
`selectNativePilotScenario`, binds the candidate manifest/API identity to the
read manifest, fixture, auth receipt, and transport bytes, and returns
`status: incomplete` when any byte or required session field is absent. It does
not construct substitute IDs, origins, fixture actors, snapshots, or receipt
hashes. When all required bytes exist, the CLI invokes the private validator;
that result is still a candidate contract result, never a runtime/public pass.

## Next canonical transfer mapping

After review, a maintainer may transfer the source hunk into
`scripts/testing/capture-native-testability.ts` and extract the local helpers
into `scripts/testing/native-session-observation.ts` if reuse is preferred. The
canonical focused test should be named
`scripts/testing/native-session-adapter-contract.test.ts` and import the
existing:

- `native-pilot-contract.ts` for `nativeSessionAssertionIds` and current
  scenario selection;
- `native-view-evidence.ts` for `readNativeEvidence` and
  `validateNativeRuntimeFrameFiles`;
- `native-auth-observation.ts`, `owned-session.ts`, and `owned-api-proxy.ts`
  for actual auth metadata, manifest/fixture/snapshot, and API observation
  provenance.

The public `run-native-pilot.ts` adapter must stage the six assertion documents
only after it re-reads the same actual bytes and binds scenario/requirement
hashes, capture/backend run IDs, fixture hash/allowlist, API PID/origin,
transport ordinal ranges, cancel checkpoint, auth metadata, SQL receipt hashes,
and every actual frame hash. It must retain `nativePassingCases: 0` until the
existing finalizer qualifies the receipt. No runtime/session pass is claimed by
this packet.

## Actual-capture preflight invocation

```sh
./node_modules/.bin/tsx \
  .qa/private/native-session-adapter-candidate-2026-10-01-v4/actual-capture-preflight.candidate.ts \
  --capture-root .qa/artifacts/native-pilot/50ddeb1f3d43a32fd441b065
```

The output is logged in `validation-preflight-v4.log`; the sealed legacy
capture must remain `observed`/`cleaned` with zero native passing cases and
report the absent session fields. A future explicit session run uses the same
invocation with its private capture root after cleanup, then the validator
must be reviewed before any staging or dispatcher wiring.

## Focused controls

```sh
./node_modules/.bin/tsx --test \
  .qa/private/native-session-adapter-candidate-2026-10-01-v4/native-session-adapter.candidate.test.ts
./node_modules/.bin/prettier --check \
  .qa/private/native-session-adapter-candidate-2026-10-01-v4/WORKCARD.md \
  .qa/private/native-session-adapter-candidate-2026-10-01-v4/actual-capture-preflight.candidate.ts \
  .qa/private/native-session-adapter-candidate-2026-10-01-v4/native-session-adapter.candidate.ts \
  .qa/private/native-session-adapter-candidate-2026-10-01-v4/native-session-adapter.candidate.test.ts
git apply --check \
  .qa/private/native-session-adapter-candidate-2026-10-01-v4/capture-native-testability.session-charter.v4.patch
```

The candidate test covers valid evidence, reordered UI, incomplete ledger,
transport/range tampering, positive metadata after sign-out, SQL receipt
mutation, forged auth ownership, retained confirmation subtree, actual
hierarchy-byte/selector mutation, and direct-I/O abort before/after and during
ledger publication. Promotion still requires a fresh actual iOS capture, public
adapter staging, final receipt review, and separate native/engine/runtime
qualification.
