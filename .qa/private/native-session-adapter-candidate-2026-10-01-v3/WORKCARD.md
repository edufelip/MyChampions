# Candidate iOS explicit session charter v3 workcard

Status: **private candidate only; no dispatcher adoption, runtime qualification,
or public receipt**.

This packet is an immutable review artifact. It does not edit canonical source,
public dispatch, inventory, declarations, documentation, product auth behavior,
or runtime resources. The v3 patch is based on the final frozen capture source
SHA-256 `3421ffc87b3d8afb572cfd1e166169cb281504630c9f17bc633414632dac5b18`.
The v1 and v2 packets remain immutable.

## Governing contract

The authoritative order is in `docs/qa/native-pilot/test-cases.md` and the
six rows for `SCN-session-ios` in `docs/qa/native-pilot/inventory.json`:

1. native coach login;
2. terminate/relaunch and restore the same coach;
3. open Account and capture the restored identity;
4. open and cancel sign-out confirmation;
5. reopen and confirm sign-out once;
6. terminate/relaunch while signed out;
7. compare the owned SQL domain before/after without claiming auth-session rows
   or server revocation.

The patch adds a private `session` charter and preserves the sealed legacy
`auth-account` diagnostic at
`.qa/artifacts/native-pilot/50ddeb1f3d43a32fd441b065/`. The old diagnostic is
never relabeled as a session run.

## v3 source implementation

`capture-native-testability.session-charter.v3.patch` adds the ordered session
branch and closes the five promotion blockers identified by peer review:

- enables and persists `native-auth-identities.private.json`, records its
  bounded-reader hash and owned run/API/fixture allowlist binding, and requires
  the verified coach identity to match the owned API PID/origin and fixture UID;
- records exact `relaunchTransportRange` and requires every restore row to be
  native, forwarded, originless, fault-free, and targeted at the owned API;
- recomputes both SQL receipt hashes with `readNativeEvidence` after writing
  mode-0600 files under the mode-0700 capture root, and binds each receipt to
  the existing owned session manifest/run/scope/API identity;
- rejects positive profile, expiry, or plaintext-token metadata after local
  sign-out and after signed-out relaunch;
- seals each actual PNG and hierarchy through `readNativeEvidence` and
  `validateNativeRuntimeFrameFiles`, recording hashes and exact selectors from
  the existing `nativeObservedSelectors` map.

The source uses the existing `session.snapshot('native-entry-ios')`, owned
proxy identity capture, and native evidence reader. It adds no SQL text, new
backend/session/proxy acquisition, auth policy, or product copy.

## Public adapter/staging contract for the next integration step

Root may wire `run-native-pilot.ts` only after this private packet is reviewed
and an actual capture is staged. The public adapter must consume the `session`
capture and stage six assertion documents in this exact order:

| Order | Assertion ID                      | Required evidence                                                                                                                                                                                                                      |
| ----- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `NAT-session-login`               | One native forwarded `201` sign-in row, verified coach identity row, owned API PID/origin, fixture allowlist hash, and actual entry/password/home PNG plus hierarchy bytes/selectors.                                                  |
| 2     | `NAT-session-restore`             | Exact all-observation ordinal slice for terminate/relaunch, all rows native/forwarded/originless/fault-free/owned, exactly one `200` `/me/hydrate`, no second sign-in, persisted session metadata present, and restored-home evidence. |
| 3     | `NAT-session-account`             | Ordered Account, restored identity, confirmation, and cancel frames with actual bytes/hashes/selectors; fixture coach identity remains bound.                                                                                          |
| 4     | `NAT-session-signout`             | Distinct reopen/confirm frames, metadata absent with no positive profile/expiry/plaintext flags, and the local `FR-270`/`BR-342` clear contract with `serverRevocationQualified: false`.                                               |
| 5     | `NAT-session-signed-out-relaunch` | Exact signed-out transport ordinal slice, every present row native/forwarded/originless/fault-free/owned, no sign-in or hydrate, absent metadata, and signed-out relaunch evidence.                                                    |
| 6     | `NAT-session-unrelated-state`     | Before/after `domain-snapshot-v1` files read through the bounded private reader, receipt hashes recomputed from bytes, same owned run/scope, and exact `trainingPlans`/`connections` equality.                                         |

Every staged assertion document must use the existing native pilot assertion
contract hashes and carry `nativePassingCases: 0` until the public receipt
finalizer qualifies it. It must bind `selection` (`ios`, `maestro`,
`SCN-session-ios`, `integration`), scenario/requirement hashes, capture run,
owned session manifest/run, fixture scope and hash, API PID/origin, transport
ordinal ranges, native auth identity file hash, snapshot file hashes, and all
actual frame file hashes. The public adapter must call the existing bounded
`readNativeEvidence` and `validateNativeRuntimeFrameFiles` paths again while
staging; candidate shapes or filenames alone cannot qualify a pass.

## Candidate controls and limits

`native-session-adapter.candidate.ts` is resource-free at the runtime level but
uses temporary mode-0700 evidence roots in tests. It validates the six-row
ledger, exact UI order and selectors, actual PNG/hierarchy bytes and hashes,
persisted fixture-bound auth identities, exact restore/signed-out transport
ranges, owned manifest binding, absent metadata negatives, and recomputed SQL
receipt hashes.

`native-session-adapter.candidate.test.ts` covers valid evidence plus reordered
ledger/UI, foreign/tampered transport, range tampering, positive absent
metadata, SQL receipt mutation, forged identity ownership, hierarchy selector
mutation, and static source boundaries.

`actual-capture-preflight.candidate.ts` reads the sealed legacy capture only.
It reports the missing v3 fields and preserves the original `observed`/
`cleaned`/zero-pass diagnostic without relabeling it.

Synthetic controls establish contract behavior only. Promotion still requires
an actual iOS capture, public adapter staging, final receipt review, and
separate native/engine/runtime qualification. No simulator, backend, proxy,
Metro process, build, or other runtime resource was acquired for this packet.

## Focused controls

```sh
./node_modules/.bin/tsx --test \
  .qa/private/native-session-adapter-candidate-2026-10-01-v3/native-session-adapter.candidate.test.ts
./node_modules/.bin/tsx \
  .qa/private/native-session-adapter-candidate-2026-10-01-v3/actual-capture-preflight.candidate.ts
./node_modules/.bin/prettier --check \
  .qa/private/native-session-adapter-candidate-2026-10-01-v3/WORKCARD.md \
  .qa/private/native-session-adapter-candidate-2026-10-01-v3/native-session-adapter.candidate.ts \
  .qa/private/native-session-adapter-candidate-2026-10-01-v3/native-session-adapter.candidate.test.ts \
  .qa/private/native-session-adapter-candidate-2026-10-01-v3/actual-capture-preflight.candidate.ts
git apply --check \
  .qa/private/native-session-adapter-candidate-2026-10-01-v3/capture-native-testability.session-charter.v3.patch
yarn typecheck
```
