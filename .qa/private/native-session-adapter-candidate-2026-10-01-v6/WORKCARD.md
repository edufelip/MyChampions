# Private iOS session adapter candidate v6

Status: **frozen private candidate; no dispatcher adoption, runtime qualification, or public receipt**.

This packet is based on the canonical capture source SHA-256
`3421ffc87b3d8afb572cfd1e166169cb281504630c9f17bc633414632dac5b18`, the
canonical auth reader SHA-256
`af905026aaa69a7965c62395a6ff456626668e2842c5531122c248d36a286052`, and the
shared comparator source SHA-256
`74166588e6c2aed1fc47aa350914e2fed76dffa891f64da84754cb48d572092b`.
The cumulative capture patch includes the frozen v4 cancel/abort seams and v6
actual checkpoint acquisition. It does not edit canonical files in this
worktree or acquire a simulator, server session, proxy, Metro process, or
build.

## Governing contract

The source of truth remains `docs/qa/native-pilot/declaration-contract.md`,
`docs/qa/native-pilot/testability.md`,
`docs/qa/native-pilot/test-cases.md`, the `SCN-session-ios` declaration in
`docs/qa/native-pilot/inventory.json`, and the generated
`scripts/testing/native-pilot-contract.ts`. The deferred public wiring remains
tracked in `docs/discovery/pending-wiring-checklist-v1.md` and
`docs/discovery/decisions-log-v1.md`. The v6 source preserves
FR-270/BR-342 local session clearing and the existing ordered journey:

1. coach signs in through the owned native proxy;
2. the app is terminated and relaunched, restoring the same coach;
3. Account shows the restored identity;
4. sign-out confirmation is opened and cancelled, with the confirmation subtree absent and persisted metadata retained;
5. sign-out confirmation is reopened and confirmed once;
6. the signed-out app is terminated and relaunched;
7. owned domain and connection projections are checked at all four checkpoints.

The old `auth-account` capture at
`.qa/artifacts/native-pilot/50ddeb1f3d43a32fd441b065/` stays
`observed`/`cleaned` with `nativePassingCases: 0`. The v6 loader reports it as
`incomplete` because it has no v6 checkpoint declarations; it never relabels
that diagnostic.

## Actual capture wiring

`capture-native-testability.session-charter.v6.patch` is cumulative from the
canonical source and is ready for a maintainer to apply after review.
`capture-native-testability.session-charter.v6-on-v4.patch` contains only the
v6 additions for a checkout where the frozen v4 patch has already been
applied; apply exactly one of these capture patches. The v6 wiring adds:

- a bounded `connectionSnapshot('native-entry-ios')` and domain `snapshot` at each of `beforeLogin`, `afterLogin`, `afterRestoration`, and `afterSignedOutRelaunch`;
- eight distinct owned private JSON files, with profile and domain names kept separate;
- write/readback receipts containing the capture run, backend run, fixture scope, API PID/origin, allowlist hash, byte count, and SHA-256;
- exact login and restoration request windows, including one native forwarded `POST /auth/email/sign-in` 201 and one native forwarded `POST /me/hydrate` 200;
- a transport receipt that is written and re-read before the final ledger;
- redacted persisted-coach identity hashes after login and after restoration, read through `observeIosAuthMetadata` from the real cached `session.profile.authUid`;
- a call to `verifyNativeSessionProfileCheckpoints` before `sessionEvidencePublication: complete`;
- v4 cancel no-op hierarchy/metadata checks and direct-I/O abort cleanup, including the new `profileAuthUidHash` absence check after sign-out.

`native-auth-observation.v6.patch` changes only the reader shape: it returns
`sha256(session.profile.authUid)` as `profileAuthUidHash` when present, never
returns the raw UID or token values, and preserves the existing shape when the
profile UID is absent.

## Actual loader

`actual-capture-preflight.v6.candidate.ts` reads `capture.private.json`, the
owned backend manifest and fixtures, transport, auth identities, and all eight
checkpoint files through `readNativeEvidence`. It checks every declared path,
mode, owner, byte count, hash, run/scope, artifact root, API PID/origin, and
fixture allowlist binding. It then builds the shared comparator input from the
re-read bytes and invokes `verifyNativeSessionProfileCheckpoints`; it does not
construct replacement snapshots, IDs, actors, origins, or hashes.

The loader returns `loaded` only when the declared verification result matches
its re-read result. Missing files, hash mutation, foreign receipt roots,
legacy captures, invalid auth metadata, or invalid request windows remain
`incomplete`. The loader is a private candidate control and does not stage a
public receipt.

The profile evidence proves the complete declared `connection-snapshot-v1`
projection: every fixture `authUid`, `lockedRole`, `acceptedTermsVersion`,
`createdAt`, `updatedAt`, row count, and projected relationship row. It does
not claim unprojected physical profile columns such as display name or email.
The domain evidence is the complete declared `domain-snapshot-v1` projection.

## Transfer map

A maintainer may transfer the cumulative source hunk into
`scripts/testing/capture-native-testability.ts` and the auth hunk into
`scripts/testing/native-auth-observation.ts`. Keep the loader private until an
actual iOS session run supplies all bytes. The public adapter must retain the
existing `readNativeEvidence`, owned session/manifest/fixture, proxy identity,
Maestro frame, and cleanup finalizers, and must bind the same scenario,
requirement, source, backend, fixture, API, request-window, and receipt hashes
before staging the six assertion documents. `nativePassingCases` remains zero
until the existing finalizer and human/native gates qualify the run.

## Validation

All validation was read-only except for synthetic files under the private test
fixture directory, which are removed by each test:

```sh
./node_modules/.bin/tsx --test \
  .qa/private/native-session-adapter-candidate-2026-10-01-v6/actual-capture-preflight.v6.candidate.test.ts
./node_modules/.bin/tsx --test \
  .qa/private/native-session-adapter-candidate-2026-10-01-v6/native-auth-observation.v6.candidate.test.ts
./node_modules/.bin/tsx --test \
  .qa/private/native-session-adapter-candidate-2026-10-01-v6/native-session-capture-v6.candidate.test.ts
./node_modules/.bin/tsx \
  .qa/private/native-session-adapter-candidate-2026-10-01-v6/actual-capture-preflight.v6.candidate.ts \
  --capture-root .qa/artifacts/native-pilot/50ddeb1f3d43a32fd441b065
git apply --check capture-native-testability.session-charter.v6.patch
git apply --check native-auth-observation.v6.patch
```

The source candidate passes isolated TypeScript (`moduleResolution: bundler`)
and esbuild compilation. The five loader/auth controls and two static patch
controls pass. The legacy preflight preserves `auth-account`, `observed`,
`cleaned`, and zero native passing cases while reporting all missing v6
fields. Packet files are mode `0600` inside a mode `0700` directory.
