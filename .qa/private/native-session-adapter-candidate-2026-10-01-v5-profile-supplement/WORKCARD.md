# iOS session profile snapshot supplemental v5

Status: **private supplemental candidate; no dispatcher adoption, runtime
qualification, public receipt, or native pass**.

This packet follows frozen v4 manifest
`.qa/private/native-session-adapter-candidate-2026-10-01-v4/PACKET-MANIFEST.json`
(SHA-256 `91bdcfd3ad61e285ff9e25bc5bd9f37fa3384970e4932ff3757bc85ed16704de`).
It does not mutate v4, canonical source, docs, the public runner, or runtime
resources.

## Required profile contract

The governing current documentation is the session profile section in
`docs/qa/native-pilot/test-cases.md` and both `SCN-session-ios` inventory rows
in `docs/qa/native-pilot/inventory.json`. The public adapter must capture four
owned, private, hashed snapshots using the same run/scope/API/fixture identity:

1. `session-sql-before-login.private.json` before the native sign-in;
2. `session-sql-after-initial-login.private.json` after the verified native
   `POST /auth/email/sign-in` (`201`);
3. `session-sql-after-restore.private.json` after relaunch and the restored
   native `POST /me/hydrate` (`200`);
4. `session-sql-after-signed-out-relaunch.private.json` after local sign-out and
   signed-out relaunch.

The first transition may change only the verified fixture coach's `updatedAt`.
The restore transition may change only that same coach's `updatedAt`. The value
may stay equal or advance, cannot regress, and cannot change encoding without
advancing. All other coach fields, every other fixture profile, and every other
row in the declared connection/profile projection must remain equal. From the
restore snapshot through cancel, confirmed local sign-out, and signed-out
relaunch, the entire projection is strict-equality. Auth-session records remain
outside this domain projection. The contract asserts no GET request.

## Candidate scope and intended canonical transfer

`session-profile-snapshot-supplement.candidate.ts` is a private review model
that consumes exact bytes already read through `readNativeEvidence`. It reuses
`verifyConnectionAuthCheckpoint` for the initial sign-in identity and the
existing `requireConnectionSnapshot`/`verifyConnectionSnapshotCheckpoint`
identity and projection checks. Root's canonical
`native-session-profile-checkpoints.ts` should own the shared four-snapshot
comparison; do not promote this candidate comparison as a second public helper.

`profile-snapshot-preflight.candidate.ts` is the bounded actual-capture seam.
It reads only the four declarations from `capture.private.json`, requires the
relative paths, receipt hash/byte count and run/scope/API/fixture metadata to
match the bytes read with `readNativeEvidence`, and returns `incomplete` when
the legacy capture lacks them. It does not fill auth, API, transport, or SQL
values and cannot qualify a runtime receipt.

Canonical wiring after review:

- Extend the owned session snapshot contract to carry the four full
  connection/profile projections and exact private file declarations.
- In `capture-native-testability.ts`, publish the four snapshots at the
  before-login, after-initial-login, after-restore, and after-signed-out-relaunch
  checkpoints; bind the two POST request windows to the same native coach auth
  identity/API PID/origin and fixture allowlist.
- In `run-native-pilot.ts` and its finalizer, re-read all four bytes, call the
  shared checkpoint helper, preserve `nativePassingCases: 0` until the final
  receipt qualifies, and retain `serverRevocationQualified: false` under
  FR-270/BR-342.
- Preserve the existing `NAT-session-unrelated-state` assertion ID and exact
  six-row order. No auth policy, product behavior, copy, or GET assertion is
  introduced.

## Validation and current evidence

Focused candidate controls:

```sh
./node_modules/.bin/tsx --test \
  .qa/private/native-session-adapter-candidate-2026-10-01-v5-profile-supplement/session-profile-snapshot-supplement.candidate.test.ts \
  .qa/private/native-session-adapter-candidate-2026-10-01-v5-profile-supplement/profile-snapshot-preflight.candidate.test.ts
./node_modules/.bin/tsx \
  .qa/private/native-session-adapter-candidate-2026-10-01-v5-profile-supplement/profile-snapshot-preflight.candidate.ts \
  --capture-root .qa/artifacts/native-pilot/50ddeb1f3d43a32fd441b065
```

The synthetic controls pass 8/8 with `nativePassingCases: 0`. The actual
legacy preflight remains `incomplete`: the original capture is preserved as
`charter: auth-account`, `result: observed`, `cleanup: cleaned`, and
`nativePassingCases: 0`; all four profile snapshot declarations are absent.
This packet makes no native/runtime/public claim.
