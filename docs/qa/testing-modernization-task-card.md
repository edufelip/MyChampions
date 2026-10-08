## Direction change: migrate to Maestro, drop Detox comparison — 2026-10-07

Owner decision (2026-10-07): the goal is to move native E2E from Detox to Maestro; the plan's Detox-vs-Maestro comparison (T15 cold matrix, Detox cells) is dropped. Detox work stops; the Maestro quality bar for each journey is a real passing run on each platform plus a deliberately introduced bug the flow detects, after which that journey's Detox test can be retired.

Android Maestro status on current code (local, Metro-attached devDebug, owned emulator, owned Postgres):

| Journey | Result | Attempt |
| --- | --- | --- |
| Camera denied | **Passed** 4/4 | `9832d7ce3a2d0b7828279e19` |
| Training | **Passed** 7/7 | `20566dce77ca6a3aa8aca5ca` |
| Connection | **Passed** 7/7 | `f8d08823cee5f613ac7ed4a4` |
| Session | Every UI step runs; **blocked by real product finding** (native sign-out keeps the server access cookie; same as Detox) | `9ea04465964705e39589101f` |
| Save-retry | No Maestro route yet | — |

Fixes made to get here (each from a real failing run): camera invite code injected after the step that types it (Maestro typed "undefined"); readiness flows asserted later selectors instantly (now wait for each); training result dropped `captureCleanup` (schema-invalid receipt); Maestro CLI blocked ~55 s on analytics during `--version` (now opted out); Maestro storage reader rejected committed SQLite journals, never relaunched after force-stopping for a snapshot (now relaunches, as its contract says), and choked on empty `sqlite3 -json` output; session cleanup compared the capture run id with the backend run id; Android roster rows sit beside (not under) the screen node in Maestro's tree; pending request is below the fold (scroll to it); Android capture build lacked `node`; connection proofs wrote into a missing `assertions/` folder; redacted invite-code frames were registered as copyable command artifacts. Host was cleared first (user's Pixel_10 emulator and seven leftover adb servers were holding the shared adb port).

Also observed (not changed, needs owner review): the coach pending-requests screen renders badly squeezed on the Pixel emulator (title breaks mid-word, request card text one letter per line).

## Android Detox session (T14-A): UI journey passes; real native-logout cookie finding — 2026-10-07

Status: **Product finding, Pending owner decision** (Android × Detox × postgres session). Attempt `0dcb99919616cf8e0c04612a` (build `c0ffee000000000000000093`, capture `native-pilot/c37d3aed0ab1d4065926d136`): the Detox child passes every UI step on the owned emulator (sign-in, relaunch restore, cancel sign-out, sign-out, signed-out relaunch) and every storage checkpoint is acknowledged. Harness verification then correctly rejects the run: **after sign-out and relaunch, the app still sends the server access cookie** (`knownAccessCookie: nonempty`, no Authorization header) on four `POST /analytics/events` requests (IDs 38–41). React Native's Android cookie store persists across relaunch and native sign-out does not clear it, which contradicts the 2026-10-03 owner decision that native logout clears device-local credentials/session. Not weakened in the test. Fixing it changes auth behavior and needs owner approval (options: clear the native cookie store on sign-out, send native requests without cookies, or stop issuing cookies to the native request profile).

Harness fixes found by real runs on this path (each original attempt retained): Detox ran on a **foreign host emulator** (`emulator-15758`, Pixel_10) because the session used the AVD-name `android.emu.debug` profile — now `android.att.debug` bound to the owned serial with `--reuse` and the owned `ANDROID_ADB_SERVER_PORT` (MyChampions and its test APK are present on that foreign emulator; left untouched pending owner instruction). Also: fresh-install before-login storage recorded as an explicit `absent` database (owned app-directory listing, no fake database); short commands whose start identity appears only in census requeries; Detox step deadline capped at 600 s; `RKStorage-journal` accepted only when empty or header-zeroed (checked before and after the copy); uppercase owned-command label for the `RKStorage` copy (both the Detox and Maestro capture paths; pinned capture hash updated); mid-flow checkpoints no longer force-stop the app the Detox flow is driving; step and cancel-checkpoint acknowledgements so the child never races a storage read; Metro bundle warm-up before the first Android launch; tap-and-verify after scrolls (first tap on a coasting ScrollView only stops the fling); empty `sqlite3 -json` output normalized to `[]`; emptied SharedPreferences `<map />` accepted; the immutable cancel checkpoint kept in later progress writes; error causes retained in storage/query diagnostics.

## Android Detox session (T14-A) blocked on fresh-install pre-login storage — 2026-10-07

Status: **Pending** (Android × Detox × postgres session). The non-cold Android session path had never executed; real runs fixed these gates in order (each original failing attempt retained under `.qa/artifacts/native-pilot{,-attempts}`): stale source identity after commit (rebuild), qualified build missing `toolVersionEvidence` (now recorded), session output colliding with the runner's census (`EEXIST`; the normal branch now allocates its own `native-pilot/<captureRunId>` like the cold route), proxy not bound to the APK's embedded API port (`requestedPort`), app never installed on the normal path (now reuses the reset preparation for install + test APK + reverses + Metro prefs), Android storage `runAdb` silently dropping stdin (both copies in `detox-android-connection-producer.ts` now forward it and record `inputSha256`), `adb pull` success text on stderr (now verified by file presence + byte hash), and Expo deadline above its 600 s cap. A private `detox-session-baseline-failure.private.json` now keeps the original error message.

Current blocker: the before-login checkpoint reads the app's AsyncStorage (`RKStorage`) before the app has ever run, so `databases/` does not exist on a fresh install. A trial that launched the app once (monkey) before the checkpoint did not create `RKStorage` within 180 s and was reverted. Decision needed (owner: client maintainer): either define "no AsyncStorage database" as the valid pre-login state in the storage checkpoint and its verifiers, or run the session cell only through the cold route. No product behavior changed.

Regression check: Android Detox camera passes again on the updated harness (attempt `207c96297e1ea04f49ad1927`, build `c0ffee000000000000000074`, 4/4, cleanup clean). Affected unit suites pass except the four pre-existing iOS V19/V22/V23 failures noted below.

## First passing native receipt: Android Detox camera denial — 2026-10-07

Status: **Locally verified** for one cell (T14-D, Android × Detox × postgres). Attempt `9cb42d3c147c4c8c6306f5af` (build `c0ffee000000000000000061`) exits 0 with `result: passed`, all four `NAT-camera-*` assertions passed with requirement refs, cleanup `cleaned`, no lingering process. Receipt: `.qa/artifacts/native-pilot-attempts/9cb42d3c147c4c8c6306f5af/receipt.json`. This is one local attempt — not a cold-matrix credit, not hosted, not iOS, not Maestro.

Handoff: continued by Claude Code after the Codex session hit its usage limit (last Codex attempt `3cad834993a3965a9b78fd80`, capture `f2c7012e7d403e91940f8dd4`). The app journey already passed there; every remaining blocker was a harness gate that had never seen real data. Fixes (each found from a real run, each with an original failing attempt retained):

| Gate / symptom | Root cause | Fix |
| --- | --- | --- |
| `changed target profiles` (3cad8349…) | UI sign-in upserts the profile and bumps only `updatedAt` | `native-connection-snapshot.ts`: profiles must match except `updatedAt`, which may only move forward; regression test added |
| Generic "child failed" diagnostic | Original cause dropped by `errorRecord` | Cause appended to the message (owned session, dispatch `readStable`, runner writes `terminal-verification-failure.private.json`) |
| `one forwarded POST 201` 3 !== 1 | Coach + student sign-in POSTs are also 201 | Count only `/connections/invite-submissions`, bind to the captured request ID, allow only sign-in otherwise |
| Runner held host lock ~40 min after receipt | `runDetoxConnectionDriverCleanup` scheduled `child-stop` only with a client; census `setInterval` never cleared | Schedule `child-stop` for client-less callers |
| `original screenshot path is not an owned Detox capture` | Real `takeScreenshot()` returns `detox-<workerPid>-<rand>.detox.png` | Accept that name bound to `flow.childPid` |
| `flags hash is missing` | Android qualified build never recorded `environmentHash`/`toolVersions` | `detox-android-qualified-build.ts` records APK config hash + Node/Detox versions |
| `timing is missing for build` (3 places) | Camera attempt reuses a qualified APK, so `build` = 0 | Allow `build >= 0` for the Android Detox camera adapter only |
| `camera source …private.bin could not be read` | Evidence reader filename allowlist lacked `.private.bin` | Allow `.private.bin` |
| Finalizer `98395 !== 98266` | Flow records the Jest worker PID, not the `detox test` launcher PID | Accept a PID the ownership census recorded in the same owned group |
| Outer `runtime-verification-failed` after `verified-native` | Stage logic only advanced on `'passed'` | Treat Android Detox camera `'verified-native'` as finalization-ready |
| Intermittent `submission body receipt is missing` / `requires an idle proxy` | Test never called its own `waitForSubmitCaptureReady()` before tapping Connect | Wait for the ack; owner waits for proxy quiescence before arming; proxy retains finalization failure reason |
| `device still authorizing` during boot | Transient adb state not classified | Added to `isTransientAndroidAdbReadinessError` with a test |

Validation: affected suites pass; declaration regenerated (23 views, 40 transitions, 10 scenarios). Full `yarn test:unit`: 3,406 tests, 3,345 pass, 27 fail, 34 skipped. The 27 failures are in areas these fixes did not touch and are recorded as pre-existing Codex drift (owner/next action: client maintainer): iOS password-sheet helper tests (missing `createAppNativeObservation`), iOS v14 V19/V22/V23 (fixture lacks `native-detox-camera-ios-ipc.ts`), `native-pilot-invocation` (`runtimeExecutionFailure` not defined in evaluated snippet), `native-session-public-finalization-real-path` and very likely `run-ios-session-attempt` (session helper list contains `.maestro/flows/camera-denied-android.yaml`, outside the source boundary), Maestro camera collector fixture (missing locale binding), two stale source-text greps (`launchCameraApp(true)`, `runDetoxTrainingOnExistingOwner({`). Verified unchanged by reverting the runner edits for the runner group; the rest by code inspection.

Environment: host disk is ~99% full; `.qa/artifacts` holds ~186 GB (`native-pilot` 137 GB, attempts 49 GB) and the emulator needs 7.4 GB free. Superseded builds c048–c060 created in this session were removed. Nothing is committed; the worktree is a detached HEAD at `9d0c3f4`.

Remaining (unchanged gates): the other T14 cells (iOS camera, both engines for session/training/connection/save-retry), the T15 400-attempt cold matrix, T16–T17 observed exploration, T18 hosted CI, T19 retirement, T20 reconciliation. D-218 / BL-018 remain **In progress**. No product, provider or localized-copy behavior changed.

## Android saved-flow/cold-owner composition integrated — 2026-10-06

Root integrated 34 source rows after exact current-Q preimage and sealed candidate checks, independent acceptance of both input packets, independent composition validation and root full-Q overlay TypeScript (930 roots, 2,030 sources, zero diagnostics). The three-way composition preserves the production saved-flow route/action hash/deadline/invite injection and the cold-owner platform-neutral training/connection boundaries. Narrow reconciliations register the actual saved-flow module and route, retain all three existing iOS helper-ledger inputs, allow only the exact declared Maestro route at helper boundaries and bind the camera control to the merged capture hash. No private generated inventory was copied.

Evidence: `/Users/eduwaldo/.codex/private-overlays/android-saved-flow-cold-composition-root-integration-20261006-v1/TRANSFER.private.json`; independent seal: `/Users/eduwaldo/.codex/private-overlays/android-saved-flow-v2-v4-composition-independent-review-20261006-v1/COMPOSITION-SEAL.private.json`. Canonical validation passes 116/116 controls (no skips/cancellations), full TypeScript, strict 31-file lint (zero errors/warnings), formatting and fresh declaration generation (537 test files; 23 source views, 40 transitions, 10 scenarios; zero runtime passes). All 34 integrated source hashes remain exact. Result: `/Users/eduwaldo/.codex/private-overlays/android-saved-flow-cold-composition-root-integration-20261006-v1/CANONICAL-RESULT.private.json`. D-218 / BL-018 remain **In progress**; current-source APK/native qualification, complete camera run, final configured unit cohort and cold attempts remain **Pending** with zero new runtime credit. This harness change alters no product/provider/localized-copy behavior.

## Fresh current-source iOS entry build timeout — 2026-10-06

D-218 / BL-018 remain **In progress**. The actual fresh entry capture `ee3a001b94bbe88140b1e204` ran under the native host lock and hit the original 900,000 ms build deadline while compiling native dependencies. Child exit was 2; the producer reports harness-blocked, cleanup cleaned, no observed views and zero native passing cases. No usable app binary or entry observation was produced. Root and independent cleanup inspections confirm owned processes, four ports, simulator, backend and Expo cache are absent; foreign devices and containers are preserved. All 1,362 client and 204 server source files and file sets remain exact. The source hold is released.

Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-camera-v22-current-app-entry-root-run-20261006-v1`; independent verdict `cleanup-audit-passed-entry-unqualified`: `/Users/eduwaldo/.codex/private-overlays/ios-camera-v22-current-app-entry-root-run-independent-audit-20261006-v1/REVIEW.private.json`. A bounded incremental compilation handoff repair and an entry evidence-path contract repair are **In progress** in private candidates. Neither is integrated or qualified yet. A new actual build, real entry screenshot/hierarchy review, source-qualified app reuse and complete camera run remain **Pending**. The fresh remote helper build remains build-only evidence. No product/provider/localized-copy behavior changes or runtime/cold credit are claimed.

## iOS V22 protected-auth/helper source integration — 2026-10-06

Status: **In progress** (D-218 / BL-018). Root integrated the independently accepted 22-row iOS camera/helper candidate and one declaration-generator supplement after verifying every current-source preimage, absent new path and sealed candidate hash. The protected report now retains actual proxy auth observations with exact fixture-allowlist binding, verified reason, fresh student/coach/student ordinals and request IDs, hashed identities and report/stage/terminal/verifier propagation. Two new runtime helper paths are explicitly registered in the generator; the read-only 210-path closure audit reports zero missing source revisions.

Pre-transfer root validation passes 42/42 source controls, full-Q overlay TypeScript and strict 17-file lint. Canonical checks after transfer pass: 42/42 source controls, full TypeScript, strict 17-file lint and formatting. Root generation inventories 535 tests and validates 23 views, 40 transitions and 10 scenarios; this grants no runtime credit. The author’s formatting log was stale because its executable path was absent; an independent valid 18-file recheck passed, and the stale log remains preserved. The author’s V22 patch is incremental against V21; root composed and dry-run checked the full 22-row patch against verified current-Q preimages without changing candidate bytes. Transfer: `/Users/eduwaldo/.codex/private-overlays/ios-camera-v22-auth-root-integration-20261006-v1/TRANSFER.private.json`; independent review: `/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-save-password-remote-helper-contract-v22-independent-review-20261006-v1/REVIEW.private.json`.

The separately sealed V22 build wrapper passes five root controls and preserves exact manifest/source integrity guards. The first actual build preflight exited before xcodebuild because Xcode’s versioned iPhoneSimulator SDK is a symlink to its canonical SDK directory; the wrapper currently rejects that legitimate alias. The wrapper repair now validates the alias and canonical target inside the active Xcode SDK directory; seven root controls pass. A fresh root-owned helper build completed successfully (PID/PGID 76974, exit 0, cleanup cleaned, source/toolchain before-after guards passed). Build receipt: `/Users/eduwaldo/.local/state/github-actions/mychampions-native-recovery/ios-remote-helper-v22-root-build-20261006-v2/ios-remote-service-build.private.json`. This is build-only evidence: nativeTestLaunched=false and runtime qualification=false. Current app reuse was rejected because V22 changed package.json, an input to the app source identity. Fresh current-source app build and entry qualification are required before the complete camera attempt. Helper build qualification passes; complete camera execution, protected runtime receipts and independent run cleanup remain **Pending**. Native and cold credit remain zero. Final configured unit validation still requires the remaining Android repairs and current declaration refresh. This harness change alters no product/provider/localized-copy behavior.

## Integrated iOS reset quiescence cancellation control — 2026-10-06

Root integrated the independently accepted one-row test repair after verifying the exact current-source preimage, candidate hash and unchanged production producer. Cancellation now occurs at actual proxy quiescence entry after the live abort listener is installed. The existing signal and no-publication assertions remain; an explicit assertion preserves the original 5,000 ms quiescence budget. Canonical controls pass 7/7 with no failures, skips or cancellations. Root full-Q overlay TypeScript passes with zero diagnostics. Transfer and evidence: `/Users/eduwaldo/.codex/private-overlays/t15-cold-ios-reset-race-root-integration-20261006-v1/TRANSFER.private.json` and `canonical-controls.log`.

This repairs one of the five failures in the latest configured full unit cohort; the other four remain under repair and a new full cohort is required after final integration/declaration refresh. Production behavior, product/provider/localized copy and native acceptance are unchanged. D-218 / BL-018 remain In progress; no native qualification or cold credit is granted.

## iOS V21 root validation and protected auth retention gap — 2026-10-06

Root verifies all 22 candidate rows and exact current-source preimages, clean patch applicability, and the existing `plist@^3.0.5` lock entry resolving to 3.1.0. Full-Q overlay TypeScript passes with 924 roots, 2,024 sources and zero diagnostics. A private regular copy of 1,354 current source files overlaid with the candidate passes 41/41 source controls and strict lint across all 17 changed JS/TS files, with zero errors or warnings. The three root qualification-wrapper controls also pass; none executes a native command. Root evidence: `/Users/eduwaldo/.codex/private-overlays/ios-camera-v21-root-overlay-20261006-v1/RESULT.private.json`. Earlier compiler-cwd, lint path and physical-resolver failures remain preserved and do not count as source acceptance.

Independent review finds a remaining protected evidence gap: runtime native-auth guards fail closed, but verified student/coach/student observations are not retained in the protected report, stage and terminal for later verifier reread. A successor must retain run-bound auth observations or exact receipt/hash projections and reject missing or substituted proof. V21 remains unintegrated; build qualification and a complete owned camera run follow accepted source repair. Review: `/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-save-password-remote-helper-v21-independent-review-20261006/REVIEW.private.json`. D-218 / BL-018 remain In progress; native and cold credit remain zero. This harness evidence repair changes no product/provider/localized-copy behavior.

## Latest configured unit result and camera gates — 2026-10-06

After the Android cold-owner integration, the full configured cohort exits 1: 3,365 tests, 3,326 passed, five failed, 34 skipped and zero cancelled. All 1,354 frozen source paths and their file set remain exact through terminal. The failures cover two connection helper-boundary controls, an obsolete Android capture source hash, an Android training dependency that imports an iOS dispatcher, and cancellation firing before the iOS reset quiescence stage. Repairs must preserve declared platform boundaries, exact reviewed source guards, the original deadline and late-publication prohibition. Exact result: `/Users/eduwaldo/.codex/private-overlays/t15-cold-android-maestro-v3-root-integration-20261006-v1/FULL-UNIT-RESULT.private.json`; original log: `full-unit-after-cold-owner.log`. Earlier passing cohorts remain historical evidence.

The sealed 22-row iOS V21 helper successor is under independent review and root full-Q overlay validation. It is not integrated or build-qualified. The next complete camera attempt requires accepted source integration, applicable validation, a fresh qualified helper build and an owned run with protected receipts and independent cleanup. Native qualification and cold credit remain zero for these changes. D-218 / BL-018 remain In progress. Product/provider/localized-copy behavior is unchanged; no functional or screen copy update is required.

## Cold-run controls join normal unit discovery — 2026-10-06

The two new Android cold-run test modules now live under `tests/ci/`, so the existing `test:unit` and trusted fast-quality unit command execute them. Their 14 controls, assertions and production wiring are unchanged; relative imports and the source-inspection directory were updated for the new location. Canonical relocated controls pass 14/14, full TypeScript and strict zero-warning lint pass, and formatting passes. Exact relocation preimages/postimages and result: `/Users/eduwaldo/.codex/private-overlays/t15-cold-android-maestro-v3-root-integration-20261006-v1/TEST-RELOCATION.private.json` and `TEST-RELOCATION-RESULT.private.json`.

This fixes test discovery without changing the public command or product/provider/localized-copy behavior. Native qualification and cold credit remain zero; final configured unit validation follows the pending source integrations.

## Android cold-owner V3 canonical checks and impact registry pass — 2026-10-06

Canonical source validation passes 25/25 cold-owner/build/capture-closure controls and 70/70 impact-selection/fixture-profile controls, with zero failures, skips or cancellations. Full TypeScript, strict zero-warning authored-row plus helper-ledger lint and formatting pass. Integration also registers four new runtime dependency revisions in the declaration generator and adds three actual transitive inputs to the iOS helper ledger. The original failed generator and omitted-input control remain preserved; no assertions were weakened. Exact results and supplemental repair hashes: `/Users/eduwaldo/.codex/private-overlays/t15-cold-android-maestro-v3-root-integration-20261006-v1/CANONICAL-RESULT.private.json`, `GENERATOR-REPAIR.private.json` and `HELPER-LEDGER-REPAIR.private.json`.

The impact validator now passes with 12 features, 47 suites and 66 UI specs. Android Detox camera is registered as `ci:false`; its owned fixture profile remains unavailable to selective CI. Current rendered component checks pass seven suites/60 tests. The configured broad lint command exits zero with 2,932 existing warnings; this is not a zero-warning project claim. Final configured unit validation after this source integration and protected hosted exact-SHA fast-quality proof remain Pending. Fresh native/APK qualification, camera execution and T15 runtime credit remain zero. Product/provider/localized-copy behavior is unchanged.

## Android cold-owner V3 source integration — 2026-10-06

Status: **In progress** for T15 (D-218 / BL-018). Root verified the immutable seal, all 17 candidate hashes, 11 current-source preimages and six absent new paths, patch applicability and the independent source-only acceptance. The 17-row source integration preserves actual producer wiring through the owned camera bridge and adds asynchronous bounded helper reads with cancellation/deadline checks, event-loop yields, descriptor/ancestor identity fences and terminal rereads. Root overlay TypeScript reports 920 roots, 2,019 sources and zero diagnostics; independent controls report 14/14 with strict zero-warning authored-row lint and formatting.

Canonical affected validation and declaration refresh are next. Fresh qualified APK/native execution, protected public receipts, cleanup and actual T15 cold attempts remain **Pending**; native passing cases and cold credit remain zero. Private generated artifacts were not copied. Exact guarded source transfer: `/Users/eduwaldo/.codex/private-overlays/t15-cold-android-maestro-v3-root-integration-20261006-v1/TRANSFER.private.json`. This internal harness integration changes no product/provider/localized-copy behavior.

## Full configured unit cohort passes after declaration refresh — 2026-10-06

The refreshed full configured cohort exits 0: 3,351 tests, 3,317 passed, zero failures, 34 skipped and zero cancelled. The missing-leader, publication-cancellation and camera staging controls pass. All 1,348 frozen source paths and their file set remain exact through the terminal. Exact immutable log and source-bound result: `/Users/eduwaldo/.codex/private-overlays/t16b-missing-leader-root-integration-20261006-v1/full-unit-after-declaration-refresh.log` and `REFRESHED-FULL-UNIT-RESULT.private.json`.

This establishes the current configured unit result before the pending camera successors. Later source integrations require their affected validation and final configured checks. The iOS V20 overlay is not integrated: root full-Q overlay compilation reports 14 diagnostics in impacted IPC/input fixtures, and protected prompt evidence/per-run XCTest environment materialization still require correction. Native qualification, complete camera execution and actual T15 cold attempts remain pending; no native credit is inferred from unit success. These internal harness/test corrections change no product/provider/localized-copy behavior.

## Full configured cohort requires declaration refresh — 2026-10-06

The full cohort after the missing-leader repair exits 1: 3,351 tests, 3,244 passed, 73 failed, 34 skipped and zero cancelled. All 73 failures are consistent with the stale native declaration: 72 report stale governing inputs directly; the entrypoint control returns `invalid-inventory` before reaching its expected host-lock rejection. The declaration still hashes the prior implementation handoff and prior Android instrumentation Java source. The missing-leader and publication-cancellation controls pass. No staging behavior or test expectation is changed to bypass freshness.

All 1,348 captured source paths remain exact through the terminal. Original failed log and classified result: `/Users/eduwaldo/.codex/private-overlays/t16b-missing-leader-root-integration-20261006-v1/full-unit-after-missing-leader.log`, `FULL-UNIT-RESULT.private.json` and `FULL-UNIT-SOURCE-POSTCHECK.private.json`. Root must refresh generated inventories/declarations and validate current sources before another configured cohort. This result grants no native qualification or cold credit.

## Integrated missing-leader census control repair — 2026-10-06

The test now uses a private, cheap shell census fixture that returns valid empty output on initial acquisition and strict leader requery. It preserves the original 500 ms production deadline and verifies repeated empty observations, exact retained PID/group identity, no fabricated ownership, strict empty census evidence and actual group absence. Production ownership and cleanup code are unchanged.

Canonical validation passes 27/27 controls, with zero failures, skips or cancellations, full TypeScript, strict zero-warning changed-file lint and formatting. Exact guarded integration and results: `/Users/eduwaldo/.codex/private-overlays/t16b-missing-leader-root-integration-20261006-v1/TRANSFER.private.json` and `RESULT.private.json`. The previous failed full cohort remains unchanged; final full configured validation is pending after accepted integrations. This internal test correction changes no product/provider/localized-copy behavior and grants no native qualification or cold credit.

## Next complete camera run blockers — 2026-10-06

The iOS helper cannot run only after bootstrap: the current child bootstrap itself waits for the password-save prompt to dismiss. The successor must invoke the owner-bound helper at that password stage, await protected helper evidence, and finish bootstrap before camera acquisition. It must materialize exact per-run XCTest environment values, preserve the original deadline, fence child/build identity, and bind helper execution and cleanup to camera evidence. The successful helper compilation qualifies only the previous draft; changed helper source requires a fresh owned build before the complete run.

Independent review accepts the Android saved-flow callback's real producer wiring but rejects integration until its loader uses bounded asynchronous descriptor reads, cancellation and the original deadline, source identity fences, and declared route hash checks. Private generated inventory/declarations must then be regenerated and the real callback controls rerun before resealing. Root overlay TypeScript passes; that result alone does not close these findings.

The Android instrumentation compiler repair is integrated and its actual compile passes. The missing-leader handshake test repair and final configured unit validation remain pending. No new camera pass, cold attempt, native qualification or resource acquisition is credited. These harness corrections change no product/provider/localized-copy behavior.

## Integrated Android Detox camera instrumentation compiler repair — 2026-10-06

Actual owned `:app:compileDevDebugAndroidTestJavaWithJavac` initially fails because `Os.fstat()` in `DetoxCameraPermissionBridge.stableFile()` throws a checked `ErrnoException` without handling it. The guarded one-row repair catches that exception and wraps it as the method's existing `IOException`; descriptor failure remains fail-closed. Permission actions, UI selectors and receipt assertions are unchanged.

The repeated instrumentation compile exits zero. Owned command cleanup is clean, PID/process group 58781 are absent, and all 1,348 frozen client files and the file set remain exact. No emulator, camera scenario, backend or native test ran. Compilation grants no native qualification or T15 credit. Exact repair, build result and postcheck: `/Users/eduwaldo/.codex/private-overlays/android-detox-instrumentation-repair-root-20261006-v2/TRANSFER.private.json`, `BUILD-DIAGNOSTIC.private.json` and `BUILD-POSTCHECK.private.json`. Original compiler failure remains under `/Users/eduwaldo/.codex/private-overlays/android-detox-instrumentation-build-root-20261006-v1/`.

The Java source hash changes from `2159b7d54009a4a28cad57556d34de780d806986e9c52b11f0a3ff9c9325a266` to `558e73f34af6f12fbc21db08a2fe3a2e311417f7be3d9b679e27cfdc7286dbf4`; future Android helper/build qualification must use current inputs. This internal instrumentation compiler repair changes no product, provider or localized copy behavior, so no wider functional/screen documentation update is needed.

## Current remote-service helper build and CLI contract — 2026-10-06

Root compiled the sealed six-file XCTest helper project with an owned `build-for-testing` command. The build exits zero, cleanup is clean, source hashes remain exact and its PID/process group are absent. No simulator test or camera assertion ran; the compiled draft is diagnostic evidence only, not a qualified replacement for the next corrected source. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-remote-helper-build-diagnostic-root-20261006-v1/BUILD-DIAGNOSTIC.private.json` and `BUILD-POSTCHECK.private.json`.

Actual Xcode rejects `-test-environment-variable` with exit 64. Its local manual also forbids combining `-xctestrun` and `-project`. The generated run file and manual support `EnvironmentVariables` and `TestingEnvironmentVariables` for the test host; `__TESTROOT__` resolves relative to the run-file directory. The private successor must correct these contracts, bind generated run-file paths and bytes to the qualified build, finish production owner/IPC wiring, and prove environment delivery and semantic dismissal on the owned UDID. Aggregate read limits, cancellation during preparation and installed helper provenance remain review findings. Source controls and compilation grant no native camera credit.

## Current full unit rerun after synchronization repair — 2026-10-06

The next full configured cohort exits **1**: **3,351 tests, 3,316 passed, one failed, 34 skipped, zero cancelled**. The repaired publication-cancellation control passes. The new failure is the missing-leader producer handshake control at `tests/ci/owned-native-command.test.ts:1307`: observed `failed-recovery-ledger-retained`, expected `running`. Ownership/deadline investigation is pending; this broad cohort is not green. Exact result and original log: `/Users/eduwaldo/.codex/private-overlays/t16b-publication-cancellation-root-20261006-v1/FULL-UNIT-RESULT.private.json` and `full-unit-after-repair.log`. Native credit remains zero for these source controls.

## Integrated publication-cancellation test synchronization repair — 2026-10-06

The parent-cancellation control now aborts at terminal publication entry instead of using a timer started before acquisition. This makes the intended publication-stage race deterministic under suite contention. The expected `blocked` result, missing completion marker, null final evidence and false publication eligibility remain unchanged. The controller's production behavior is unchanged.

Canonical validation passes **30/30** controller controls with zero failures, skips or cancellations, full TypeScript, strict zero-warning changed-file lint and formatting. Exact guarded one-row integration and logs: `/Users/eduwaldo/.codex/private-overlays/t16b-publication-cancellation-root-20261006-v1/RESULT.private.json`. The previous failed 3,351-test cohort is preserved; it is not reclassified as passing. Final full configured validation remains required after accepted integrations. This internal test repair changes no product, provider or localized copy behavior and grants no native credit.

## Current configured unit validation — 2026-10-06

The full configured Node unit cohort after V19 cleanup and declaration regeneration exits **1**: **3,351 tests, 3,316 passed, one failed, 34 skipped, zero cancelled**. The failed control is `tests/ci/t16b-owned-exploration-controller.test.ts:1075`, which expected `blocked` but received `cancelled` during delayed publication. Its fixed parent-cancellation timer starts before acquisition; investigation must distinguish an early valid cancellation from the intended publication-stage cancellation. The deterministic synchronization repair below has since passed focused validation; this original broad cohort remains failed.

Exact retained result and immutable log: `/Users/eduwaldo/.codex/private-overlays/ios-camera-prompt-scope-v19-root-20261006/FULL-UNIT-AFTER-V19.private.json` and `full-unit-after-v19-cleanup.log`. Source controls grant no native credit. Final configured unit validation must be repeated after accepted integrations.

## Current iOS Detox V19 remote-service lookup blocker — 2026-10-06

Fresh capture `9e270788589e3758ad7eb353` records 15 recognized app-native absences and six recognized SpringBoard absences for **Not Now**, followed by the original phase deadline timeout. The private screenshot still shows **Save Password?**. Camera assertions are zero; public promotion is false. Private diagnostics now preserve the lookup scope and native failures. An owned-device service census found SafariViewService active; ownership of the sheet remains an inference until a semantic remote-service query proves it.

The approved next repair is a repository-owned XCTest helper that queries the reviewed remote-service scope, requires an exact sheet witness and a unique visible, hittable **Not Now** control, and consumes the original deadline. Its source, binary provenance, owned-device binding, command receipts and cleanup must be validated before a fresh complete camera run. Source controls alone grant no native credit.

Root and independent V19 terminal audits verify all 40 historical owned PID identities and three groups absent, all four reserved listeners clear, owned simulator/backend/cache absent, foreign baseline preserved, and exact 1,348 client/204 server source files. The source hold is released. Original failure receipts remain unchanged. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-06-v19/ROOT-TERMINAL.private.json` and `INDEPENDENT-TERMINAL-AUDIT.private.json`; independent audit SHA-256 `9d013c959fc21832cb904f9bab45f1202ca64e73c7ba3a509b2ec3e73afa4e56`.

Accepted camera evidence remains two Maestro attempts. Full T14, actual T15 cold attempts (0/400), final full configured unit validation and later gates remain pending. Product, provider and localized copy behavior is unchanged; this update records harness evidence and deferred validation only.

## Current integrated iOS prompt-scope probe and diagnostics — 2026-10-06

The child now probes app-native **Not Now** label/text controls for two seconds and requires enabled, visible, hittable state plus two stable frames before a semantic tap. The probe and SpringBoard fallback consume the same original 120-second phase limit capped by the whole-run absolute deadline. No coordinates, permission grant or product autofill behavior changed. Private diagnostics retain separate lookup scopes, attempt timings, last native error and cause chains, bounded to 16 attempts, 512-character error messages and four causes. Timeout and unknown state cannot be promoted to successful evidence.

The exact independently reviewed three-row integration passes **64/64** canonical camera/preflight/acquisition/cleanup controls, with zero failures, skips or cancellations. Full TypeScript, strict zero-warning changed-file lint and formatting pass. The old-source sentinel fails. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-camera-prompt-scope-v19-root-20261006/TRANSFER.private.json`, canonical logs, and `/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-save-password-sheet-v18-independent-review-20261006/REVIEW.private.json`.

Fresh V19 follows final inventory/declaration regeneration and current-source iOS build requalification. App-native lookup viability is still unproven until the actual run. These source checks grant no native credit; V18 original failures remain unchanged. The two accepted Maestro camera attempts remain the native camera evidence. Full T14, actual T15 cold attempts (0/400), final full configured unit validation and later gates remain pending. Product/provider/copy/localization behavior is unchanged, so no wider functional or screen documentation update is needed for this harness repair.

## Current iOS Detox V18 prompt-lookup blocker — 2026-10-06

Fresh capture `4750e7f13fe7ef6e8179a75c` invokes the real public system API repeatedly, but the optional **Not Now** lookup still exceeds the shared 120-second phase budget. The private screenshot retains the **Save Password?** sheet. Camera assertions remain zero and public promotion remains false. Increasing time alone did not fix this lookup. The helper currently loses the earlier native absence details when its last invocation times out; the next approved repair preserves those private causes and probes the app-native semantic control without coordinates or permission bypass.

Exact Detox 20.47.0 primary source shows `PredicateHandler.createSystemQuery()` searches SpringBoard descendants, whereas the app-under-test scope is separate. This establishes system-query scope; it does not prove that an app-native lookup will find this credential sheet. Primary source: https://github.com/wix/Detox/blob/20.47.0/detox/ios/DetoxXCUITestRunner/DetoxXCUITestRunner/Handlers/PredicateHandler.swift . Root retained source snapshots under `/Users/eduwaldo/.codex/private-overlays/ios-camera-system-budget-v18-root-20261006/detox-source-1.swift` and `detox-source-2.swift`.

Root and independent terminal audits verify all known native/XCUITest processes and groups absent, listeners clear, owned simulator/backend/cache absent, foreign baseline states preserved, and exact 1,348 client/204 server source hashes and sets. The hold is released; original failed receipts remain unchanged. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-06-v18/ROOT-TERMINAL.private.json`, `ROOT-RECOVERY.private.json`, `TERMINAL-SOURCE-SNAPSHOT.private.json` and `INDEPENDENT-TERMINAL-AUDIT.private.json`.

The two accepted Maestro camera attempts remain the native camera evidence. Full T14, actual T15 cold attempts (0/400), final full configured unit validation and later gates remain pending. Product/provider/copy/localization behavior is unchanged.

## Current integrated iOS system-prompt startup budget repair — 2026-10-06

The child now gives each system-prompt phase a fixed 120-second budget capped by the original whole-run absolute deadline. Password-save and camera Allow observations use this budget; camera denial label observations and tap share one original anchor. Delayed XCUITest startup, late completion, expiry, cancellation and unknown errors cannot renew the budget or become accepted evidence. The public `require('detox').system` binding remains in use.

The independently reviewed three-row integration passes **60/60** canonical camera/preflight/acquisition/cleanup controls, with zero failures, skips or cancellations. Full TypeScript, strict zero-warning changed-file lint and formatting pass. The old-source sentinel fails. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-camera-system-budget-v18-root-20261006/TRANSFER.private.json`, canonical logs and `/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-save-password-sheet-v17-independent-review-20261006/REVIEW.private.json`.

Fresh V18 follows final inventory/declaration regeneration and current-source iOS build requalification. These source controls grant no native qualification. V17 original timeout receipts remain unchanged. Accepted camera evidence remains two Maestro attempts; full T14, actual T15 cold attempts (0/400), final full configured unit validation and later gates remain pending. Product/provider/copy/localization behavior is unchanged; no broader domain or screen documentation update is needed for the harness phase budget.

## Current iOS Detox V17 system-runner startup budget blocker — 2026-10-06

Fresh capture `d8d15b007131270476d59e0d` reaches the actual public Detox system API. The first optional password-save observation launches an XCUITest `xcodebuild test-without-building` runner, then exceeds its five-second local budget. Installed `XCUITestRunner.execute()` launches this subprocess per system expectation/action; it is not a fast device RPC. The whole-run absolute deadline remains unchanged. The approved successor uses a fixed system-prompt phase budget capped by that original deadline, shared across existence polling and the associated tap; no polling or tap renews the budget.

Root and independent terminal audits verify all recorded native/XCUITest processes and groups, listeners, owned simulator/backend/cache absence, foreign baseline preservation and exact 1,348 client/204 server source hashes and sets. The hold is released. Original failure receipts remain unchanged. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-06-v17/ROOT-TERMINAL.private.json`, `ROOT-RECOVERY.private.json`, `TERMINAL-SOURCE-SNAPSHOT.private.json` and `INDEPENDENT-TERMINAL-AUDIT.private.json`.

No camera assertions or public/native qualification pass. The two Maestro camera attempts remain accepted; full T14, actual T15 cold attempts (0/400), final full configured unit suite and later gates remain pending. Product/provider/copy/localization behavior is unchanged. Private phase-budget candidate controls are source-only and do not qualify a native attempt.

## Current integrated Detox public system namespace repair — 2026-10-06

All camera-child system controls now use the installed public `require('detox').system` wrapper. The child no longer accesses `device.system`. Controls execute the installed `DetoxContext` worker/public proxy binding, keep `device` without `system`, and fail against the old source. Semantic prompt actions, optional absence policy and original absolute/local deadline fences remain unchanged.

The exact independently reviewed three-row integration passes **57/57** canonical camera/preflight/acquisition/cleanup controls, with zero failures, skips or cancellations. Full TypeScript, strict zero-warning changed-file lint and formatting pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-camera-public-system-v17-root-20261006/TRANSFER.private.json`, canonical logs, and `/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-save-password-sheet-v16-independent-review-20261006/REVIEW.private.json`. Transfer stdout retained a copied two-row label, but the checked manifest and actual transfer contain exactly three rows.

Fresh V17 follows final inventory/declaration generation and current-source iOS build requalification. No source check grants native credit; original V15/V16 failures remain unchanged. Two Maestro camera attempts remain accepted; full T14, actual T15 cold attempts (0/400), final full configured unit suite and later gates remain pending. Product/provider/copy/localization behavior is unchanged; no wider domain or screen documentation change is needed.

## Current iOS Detox V16 public system binding blocker — 2026-10-06

Fresh capture `30571d4febab07ac8fed6dce` stops during bootstrap at the password-sheet lookup: `device.system` is undefined, producing `TypeError: Cannot read properties of undefined (reading 'element')`. Installed Detox exports `system` separately through `DetoxContext` and the worker matchers; it is not a property of the runtime device. The approved correction uses `require('detox').system` for every camera-child system control and tests the installed public wrapper with a device that has no `system` property. Earlier detached `system.js` controls did not prove this namespace binding.

Root and independent cleanup/source audits pass: owned processes/groups/listeners, simulator/backend/cache are absent, foreign baseline states are preserved, and exact 1,348 client/204 server source hashes and sets match. The hold is released; original failed receipts remain unchanged. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-06-v16/ROOT-TERMINAL.private.json`, `ROOT-RECOVERY.private.json`, `TERMINAL-SOURCE-SNAPSHOT.private.json` and `INDEPENDENT-TERMINAL-AUDIT.private.json`.

No camera assertions or native/public credit pass. The two Maestro camera attempts remain accepted; T14 matrix, actual T15 cold attempts (0/400), final full configured unit suite and later gates remain pending. Product/provider/copy/localization behavior is unchanged; this repair updates test-harness API binding only.

## Current integrated iOS password-sheet harness repair — 2026-10-06

The independently reviewed child now dismisses the observed iOS password-save sheet through the supported semantic system **Not Now** control after student sign-in landing and before camera navigation. Optional recognized absence is bounded by the original absolute/local deadline. Cancellation, expiry, unrecognized system errors and tap failures propagate; no coordinates or app autofill behavior changed.

Canonical camera/preflight/acquisition/cleanup controls pass **56/56**, with zero failures, skips or cancellations. Full TypeScript, strict zero-warning changed-file lint and formatting pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-camera-password-v16-root-20261006/TRANSFER.private.json`, canonical logs, and `/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-save-password-sheet-v1-independent-review-20261006/REVIEW.private.json`. The prior full-unit failure remains recorded. The isolated real-entry preflight control passes after declaration regeneration against fixed source; this does not promote the failed broad cohort. Final full configured unit validation remains required after integrations.

Fresh V16 follows inventory/declaration regeneration and current-source iOS build requalification. V15 retains its original harness-blocked result and private screenshot proving the password sheet. Source checks grant no native camera credit; accepted camera evidence remains the two Maestro attempts, full T14 is pending and actual T15 cold attempts remain 0/400. Product/provider/copy/localization behavior is unchanged, so no wider functional or screen-copy update is needed.

## Current iOS Detox V15 observed password-sheet blocker — 2026-10-06

Fresh capture `0203329a54e32e611715f167` authenticates and reaches the student home screen, then stops before the camera-entry tap because the account button never becomes hittable. The retained private screenshot now directly confirms an iOS **Save Password?** sheet with **Not Now** covering the home screen. The app hierarchy does not expose that system sheet; the raw hierarchy is retained unchanged. No camera assertion or native/public promotion passes.

Root and independent terminal audits verify owned processes/groups/listeners, simulator/backend/cache absence, foreign baseline preservation, and exact 1,347 client/204 server source hashes and sets. The hold is released. Original failed receipts remain unchanged. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-06-v15/ROOT-TERMINAL.private.json`, `ROOT-RECOVERY.private.json`, `TERMINAL-SOURCE-SNAPSHOT.private.json`, `INDEPENDENT-TERMINAL-AUDIT.private.json`; private capture failure PNG/XML. Next approved harness repair dismisses only the observed password-save prompt through the supported semantic system **Not Now** control, under the original deadline; absence, late completion and cancellation remain explicit.

The broad current unit cohort completed 3,337 tests: 3,302 pass, 34 existing conditional skips, one failure. The real-entry preflight test expected `invalid-environment` but received `invalid-inventory`; targeted reproduction is pending. This is not a current full-suite pass. The two Maestro camera attempts remain accepted; full T14 qualification, actual T15 cold attempts (0/400) and later gates remain pending. Product/provider/copy/localization behavior is unchanged.

## Current integrated iOS Detox camera entry repair — 2026-10-06

The independently reviewed child repair now waits for enabled, visible and hittable state with two stable frame samples before camera navigation taps. System camera prompts use the installed Detox 20.47.0 supported `toExist()` API. Native observations and diagnostic capture are fenced by local budgets capped by the original absolute deadline; late completions cannot supply accepted state or evidence. Command failure preserves the original error and retains private XML/PNG diagnostics with explicit complete, partial or unknown status.

Canonical source-executed camera/preflight/acquisition/cleanup controls pass **50/50**, with zero failures, skips or cancellations. Full TypeScript, strict zero-warning changed-file lint and formatting pass. Exact sealed integration evidence: `/Users/eduwaldo/.codex/private-overlays/ios-camera-child-v15-root-20261006/TRANSFER.private.json` and canonical logs; independent review `/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-child-actionable-failure-v1-20261006-independent-review-20261006/REVIEW.private.json`. These checks grant no native camera credit. Fresh V15 follows declaration regeneration and current-source iOS build requalification. V14 original failed receipts remain unchanged; the two Maestro camera passes are still the accepted camera evidence. Full T14, actual T15 cold attempts (0/400) and later gates remain pending.

Product behavior, server-provider baseline and user-facing copy/localization are unchanged; no wider domain or screen documentation update is needed for this test-harness repair.

## Current iOS Detox V14 entry-action blocker — 2026-10-06

Fresh capture `1ab873fb4caabefce9fcf885` verifies the integrated fixture/deadline repair through authenticated student bootstrap and both primary/isolation snapshot paths. It stops at the first camera-entry navigation tap: `student.home.accountButton` is visible but not hittable under `UITransitionView`. No camera callback/verification or assertion runs; the result remains harness-blocked with zero native/public credit. The error alone does not establish a password-sheet cause.

Capture and independent cleanup both pass. Root and independent terminal checks verify owned process groups/listeners, simulator/backend/cache absence, foreign baseline preservation and the exact 1,346 client/204 server source freeze; the hold is released. Original receipts remain unchanged. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-06-v14/ROOT-TERMINAL.private.json`, `ROOT-RECOVERY.private.json`, `TERMINAL-SOURCE-SNAPSHOT.private.json` and `INDEPENDENT-TERMINAL-AUDIT.private.json`.

Next repair is a bounded semantic actionable-state wait and private failure diagnostics for the owned child, preserving its original absolute deadline. Installed Detox 20.47.0 also exposes only `SystemExpect.toExist()` for system elements; the child camera-prompt `toBeVisible().withTimeout()` call must use the supported bounded system expectation before a fresh V15 attempt. No coordinates, permission grant, assertion removal or historical promotion is authorized by this repair. The two Maestro camera passes remain accepted; full T14 qualification, actual T15 cold attempts (0/400) and later plan gates remain pending. Product/provider/copy/localization behavior is unchanged.

## Current integrated iOS camera fixture and cleanup repair — 2026-10-06

The reviewed repair now seeds the separate `native-connection-isolation-ios` fixture before snapshots, validates fixture run/scope/roles and unique non-overlapping identities, and retains both credential-bearing fixture bodies under private evidence only. Primary and isolation snapshots each require their exact expected scope; the main camera owner identity remains unchanged. Proxy cleanup uses a bounded integer budget up to 30 seconds within the original aggregate absolute deadline, preserves cancellation and rejects an expired fractional budget before invoking the proxy.

Canonical source-executed projection/fixture/cleanup controls and the existing preflight/acquisition/cleanup cohort pass **41/41**, with zero failures, skips or cancellations. Full TypeScript, strict zero-warning two-file lint and formatting pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-camera-v14-root-repair-20261006/TRANSFER.private.json`, `FINAL-CANONICAL.private.json` and canonical logs. The original V13 failed receipt and independent recovery proof remain unchanged. Fresh V14 follows final declaration regeneration and current build requalification; these source checks grant no Detox camera or cold-attempt credit. The two accepted Maestro camera runs remain the only passing camera attempts, and T15 actual cold attempts remain 0/400.

Product behavior, backend-provider baseline and localization are unchanged. No broader domain/copy update is needed for these fixture and lifecycle repairs. Full T14 qualification, T15 measurement, T16/T17 and later hosted/migration gates remain required.

## Current iOS Detox V13 runtime blockers — 2026-10-05

Fresh V13 capture `0b2ea5445096ede37127e9a9` proves the repaired deadline path: Jest discovery completes with exit 0 and exactly one selected camera test; the actual child bootstraps, signs in the student and reaches `student.home.screen`. It then fails before camera assertions because `native-connection-isolation-ios` was not seeded before its connection snapshot. Cleanup also rejects a remaining whole-run budget passed directly to the proxy's 30-second quiescence API. These original failures remain unchanged, with zero assertions and no Detox camera/native promotion.

Root and independent terminal audits verify owned PID/start pairs, process groups/listeners, simulator/backend/cache absence, foreign baseline identity/state preservation and the exact 1,345 client/204 server source freeze. The source hold is released for the private isolation-seeding and bounded-quiescence repair, canonical validation and a fresh complete V14 attempt. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-05-v13/ROOT-TERMINAL.private.json`, `ROOT-RECOVERY.private.json`, `TERMINAL-SOURCE-SNAPSHOT.private.json` and `INDEPENDENT-TERMINAL-AUDIT.private.json`.

Accepted camera evidence remains the two Maestro Debug/integration attempts; actual T15 cold attempts remain 0/400. The full platform/engine matrix and later plan gates remain pending. Product/provider/copy/localization behavior is unchanged; these fixture/lifecycle repairs do not change domain requirements.

## Current shared-command deadline repair and iOS Detox V12 failure — 2026-10-05

V12 capture `4df5e76d2996194bf0d9bc8c` is terminal with exit 2 before camera discovery. Its actual Jest list-tests record remains harness-blocked/SIGTERM, ownership unproven and zero camera assertions; original receipts and failed recovery ledger are unchanged. Root and independent post-terminal checks verify all known owned resources absent, foreign simulator/container identity and state preserved, and exact 1,345 client/204 server source hashes and sets unchanged. The source hold is released solely for repair and a fresh attempt, without granting historical cleanup or native qualification.

A real owned subprocess reproduces the deterministic deadline defect: an explicit whole-run absolute budget longer than the ten-minute step cap bypassed the shorter relative command budget and was rejected by the execution wait. The shared helper now anchors acquisition/execution to the earlier caller absolute deadline or original command start plus its valid phase budget. Explicit initial-ownership budgets are validated before clamping; malformed values retain the historical harness-blocked/unknown/no-acquisition result, and pre-aborted requests retain cancelled/not-acquired behavior. Undefined ownership budgets, phase caps, cancellation and strict cleanup remain unchanged. Three real subprocess/malformed-input controls pass privately. Canonical ownership/preflight/cleanup controls pass **82/82** with zero failures, skips or cancellations; full TypeScript, strict zero-warning two-file lint and formatting pass. The fresh V13 iOS Detox attempt follows final inventory/declaration validation and build requalification.

Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-v12-long-command-deadline-reproduction-20261005/RESULT.private.json`, `/Users/eduwaldo/.codex/private-overlays/owned-command-effective-deadline-root-20261005-v3/TRANSFER.private.json` and primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-05-v12/ROOT-TERMINAL.private.json`. Accepted camera attempts remain two Maestro Debug/integration runs with eight passed assertions. Detox, the full T14 matrix, actual T15 cold attempts (0/400), T16/T17 and hosted gates remain pending. Product behavior, server-provider baseline and localized copy are unchanged; no wider functional/use-case/business-rule/screen-copy update is required for this harness correction.

## Current iOS preflight qualification and fresh V11 preparation — 2026-10-05

## Current canonical iOS discovery-diagnostic integration — 2026-10-05

The independently reviewed four-row preflight diagnostic successor is integrated. Actual-worktree TypeScript, strict zero-warning lint and formatting pass; the full selected discovery/cleanup/census cohort passes **38/38**, with zero failures, skips or cancellations. Changed-row hashes reread exactly. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-jest-preflight-proof-v2-root-frozen-20261005/TRANSFER.private.json`, `VALIDATION.private.json` and canonical logs.

A failed Jest preflight now retains its actual command, PID/PGID, execution, timing, census/output failure and ownership-artifact paths. Optional null preflight evidence preserves successful cleanup behavior. Known-clean projection requires validated ownership proof and a final empty census; malformed, stale, absent, symlinked, escaped or invalid-path artifacts remain uncertain/recovery-retained. Failed camera acquisition never becomes selection, assertion or native promotion success. Original absolute deadlines and handshake mode remain unchanged.

Historical V11 remains harness-blocked and underdiagnosed. Source-only exact-helper replay passes 20/20; that is neither historical root-cause proof nor native qualification. The next fresh iOS Detox V12 attempt follows final declaration generation and build requalification. Accepted native camera attempts remain the two Maestro runs; Detox and all 400 actual cold attempts remain pending. The new wrapper snapshots source hashes and file sets immediately at terminal and retains the source hold through independent cleanup. Product/provider/copy/localization behavior is unchanged.

## Current accepted Maestro camera evidence on both platforms — 2026-10-05

Android V39 and fresh iOS Maestro Debug/integration each pass the same four camera assertions: normal entry, denial guidance, manual submit and unrelated-state preservation. Accepted camera attempts are now **two (one per platform)**, with eight passed assertion outcomes. This does not qualify either Detox camera cell, bundled release, physical-device acceptance or the measured cold cohort; actual T15 cold attempts remain **0/400**.

The iOS attempt `adbfb0783d768de3351edcb9` / capture `3cd7908ba7ea47ecb45d34f4` uses requalified build `b95963f18d4a476549cb197f`, binary `09357100fe530645f37835e42037ab2d5a81e2c7ff125d9dd001688589e3ccdb`. All 55 native commands complete; protected public receipt passes four assertions with exit 0. Cleanup independently verifies 335 PID/start pairs, owned process groups/listeners/simulator/backend/cache absence and foreign baseline preservation. Broad system diagnostics exceeded their stdout buffer; the unavailable broad diagnostic is retained, while exact owned-resource queries pass.

Two untracked Android adapter files were mistakenly written after the iOS child had exited, while the source hold still awaited audit. The original failed file-set audit is retained. Root moved those files by rename into a private forensic packet, preserving inode/size/hash; independent review confirms their births follow terminal completion, they are outside the captured source/helper/argv graph, and all 136 helper hashes and app source identity remain unchanged. Root refreezes exactly the original 1,345 client and 204 server files before releasing the hold. The run is accepted for its exact Debug/integration scope after this recovery; no failure record is overwritten. Future wrappers record source hashes and file sets immediately at child terminal. Evidence: primary `.qa/artifacts/testing-modernization/ios-maestro-camera-public-live-2026-10-05-v1/ROOT-TERMINAL.private.json`, `ROOT-REFREEZE.private.json`, `ROOT-SOURCE-CHECK.private.json`, `ROOT-SOURCE-RECOVERY-CHECK.private.json` and final `INDEPENDENT-TERMINAL-AUDIT.private.json`.

The original iOS Detox V11 discovery failure remains underdiagnosed. Owned source-only Jest replays complete, including 20/20 exact-helper stress runs. The reviewed successor must preserve real failure/ownership diagnostics without speculative launcher changes or fabricated cleanup success. Full cold-owner normalization/build reuse, saved-flow fixture wiring, actual T15 measurement, T16 observation, T17 conversion, hosted gates and final reconciliation remain required. No product/provider/copy/localization behavior change is introduced by these harness checkpoints.

## Current accepted Android camera V39 — 2026-10-05

Fresh Android Maestro integration attempt `cd9ca4855261064d21985f26` / capture `905aa8a3bff548c880624116` passes all four public camera assertions: normal entry, denial guidance, manual submit and unrelated-state preservation. The fresh Metro-attached devDebug build succeeds in 2m 58s. The protected finalizer reports published-native and the public receipt passes with exit 0; retained V38 failures are unchanged. This is one accepted Android Maestro camera attempt, not bundled-release, Android Detox, iOS or T15 cold-cohort qualification. Actual T15 cold attempts remain 0/400.

Root and independent terminal audits pass: 317 PID/start pairs, 50 process groups and nine known ports have no survivors/listeners. Owned emulator/backend/ADB/cache resources are absent; the private owner ledger is preserved. All six foreign container states and the booted foreign simulator are unchanged. Exact 1,345 client and 204 server source hashes and sets match the freeze. Source hold is released. Evidence: primary `.qa/artifacts/testing-modernization/android-maestro-camera-public-live-2026-10-05-v39/ROOT-TERMINAL.private.json`, `ROOT-CLEANUP.private.json`, `ROOT-SOURCE-CHECK.private.json` and `INDEPENDENT-TERMINAL-AUDIT.private.json`; protected attempt `receipt.json` and `android-camera-native-runtime-finalization.private.json` are authoritative. The raw pre-publication runtime link is not acceptance evidence.

Next: integrate and validate the reviewed iOS discovery-diagnostic fix, perform a fresh iOS camera attempt, compose the missing Detox cold adapter cells, and complete platform/engine production ownership before the actual measured cohort. T16 observation, T17 conversion, hosted gates and final plan completion remain pending. No product behavior, provider baseline, user-facing copy or localization change is introduced by these harness repairs.

### Current camera blockers and origin repair — 2026-10-05

The Android V38 attempt reached the camera callback and stopped at a harness assertion equating the app-facing proxy origin with the raw backend origin. The three-row origin repair preserves app target/build binding and raw backend body/SQL/transport provenance; distinct-origin and forged-origin controls cover the contract. No retained V38 receipt is promoted, and accepted native camera evidence remains zero. A fresh V39 Android Maestro attempt is required after current-source validation and declaration generation.

The iOS V11 attempt stopped at owned Jest `--listTests` qualification before camera execution. Its original harness-blocked/failed-recovery-retained receipts remain unchanged. Root and independent terminal audits verified owned process groups, listeners, simulator, backend and Expo resources absent, foreign baselines preserved, and exact 1345-client/204-server source hashes and sets unchanged. The source hold is released. A private successor must preserve the preflight command outcome and ownership/cleanup diagnostics; it must not grant selection or native camera credit to a failed preflight.

The canonical Node24/tsx camera cohort passed 55/55 with zero skips or cancellations; strict changed-file lint, formatting and eight declaration/parent controls passed. An ad hoc Bun cohort retained one fault-injection failure (54/55); the exact rollback control and complete cohort passed under the configured Node runner. The current-source TypeScript command passed after origin integration. An earlier private CompilerHost invocation reported TS7022 in an unchanged declaration control; that invocation remains failed and is not counted as a pass. Native camera, T15 actual cold cohort (0/400), T16 actual exploration and T17 runtime conversion remain pending.

The reviewed iOS exact-one-test discovery and executed-module deadline correction, leader-proof ownership guard and deterministic deadline controls are integrated. The saved Debug build `b95963f18d4a476549cb197f` is requalified against current product/native/lockfile inputs; it remains Metro-attached Debug qualification, not a bundled release or native camera pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-v12-final-root-frozen-20261005/IOS-BUILD-REQUALIFICATION-V38.private.json`. Fresh iOS V11 will use the corrected tool PATH and one original caller deadline, with paired-source hashes/file sets and independent terminal cleanup. The original iOS V10 failure remains unchanged.

Android V38 is terminal with independently verified cleanup. Its raw-backend/app-facing-proxy verifier repair is under private source review and grants no acceptance. Root-owned native runs remain sequential; no source transfer occurs under a live native hold. Native camera passes, actual T15 cold attempts and actual T16 MCP observations remain zero. Product behavior, provider baseline, copy and localization are unchanged; these harness checks do not require broader domain artifact updates.

## Current configured source validation and exact V38 diagnosis — 2026-10-05

Configured client `yarn test:unit` passes 3,284/3,318 tests across 105 suites, with zero failures/cancellation and 34 existing conditional skips. All 1,345 client and 204 server source hashes and file sets remain unchanged. Evidence: `/Users/eduwaldo/.codex/private-overlays/client-full-unit-camera-v38-root-20261005/TERMINAL.private.json`. This source result does not qualify the blocked V38 native receipt; final configured validation must follow any further source repair.

Independent retained-evidence diagnosis locates V38's first failure at `native-android-camera-runtime-eligibility.ts`: producer `identity.apiOrigin` correctly records backend/upstream `55849`, whereas `identity.target.apiOrigin`, captured proxy origin and build origin correctly record app-facing proxy `55856`. The equality between these different roles is invalid. The adjacent app-facing target equality and backend/SQL/request-body/transport checks use their intended roles and must remain protected. The successor must validate the backend identity against the bound backend/proxy capture mapping and preserve the separate app-facing target equality, with a distinct-origin positive and forged-origin negatives. Fixtures previously reused one origin for both roles. No origin is guessed and no failure is promoted.

Source hold is released after the root/independent V38 cleanup recorded below. Accepted native/public camera passes and actual T15 cold attempts remain zero. Product behavior, server provider baseline, copy and localization are unchanged; these harness validation/binding changes do not require broader domain documentation updates.

## Current Android V38 origin-binding blocker — 2026-10-05

Fresh Android Maestro V38 attempt `f9039a867ae1300aa7c20f23`, capture `133c892302d075ceed3dce5f`, builds successfully in 1m 29s and completes the camera callback once. Capture is observed/cleaned; all 44 commands complete. The bounded APK reader advances past V37. Runtime verification then rejects an API-origin equality: actual `http://127.0.0.1:55849`, expected `http://127.0.0.1:55856`. The raw backend and app-facing owned proxy have distinct origins; the exact failing provenance boundary requires diagnosis and a role-preserving binding repair with positive and forged-origin controls. No equality is waived and no inferred mapping earns runtime credit. Original V38 remains harness-blocked, exit 2 with zero native/public camera passes.

Root and independent terminal cleanup pass: 308 PID/start pairs, 50 process groups and all five reserved ports have no survivors/listeners; owned device/cache/runtime children and private credentials are absent; all six foreign containers and the booted foreign simulator are preserved. All 1,345 client and 204 server hashes and file sets remain unchanged. Source hold is released. Evidence: primary `.qa/artifacts/testing-modernization/android-maestro-camera-public-live-2026-10-05-v38/ROOT-TERMINAL.private.json` and `INDEPENDENT-TERMINAL-AUDIT.private.json`.

The integrated APK, Detox runtime-child and explicit declaration bindings remain source-qualified by the checks below. A fresh camera attempt is required after the origin repair; original failed receipts are not promoted. Actual Detox instrumentation execution, actual T15 cold attempts, final configured source validation and broader plan acceptance remain pending. Product behavior, server provider baseline, copy and localization are unchanged; no broader domain artifact update is required for these harness fixes.

## Current camera source fixes and fresh V38 dispatch — 2026-10-05

The bounded APK reader correction is integrated and independently accepted. Canonical camera/eligibility/declaration controls pass 51/51 with zero failures, skips or cancellation. Actual-worktree CompilerHost reports zero diagnostics; canonical strict two-file lint has zero errors/warnings and formatting passes. The reader preserves the existing 256 MiB build bound, fixed-size streaming hash, complete file identity and final deadline/cancellation fences. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-v37-apk-bound-root-frozen-20261005/VALIDATION.private.json`.

The missing Android Detox child is added as one independently reviewed, formatted regular source row; syntax is unchanged by formatting. Canonical Android Detox source controls pass 17/17 and strict child lint passes with zero warnings. The reviewed 20-row composition's canonical lint and full TypeScript also pass after the import-order correction. Eleven imported route owners and three dynamic runtime assets have explicit source revisions; independent review accepts both mapping changes and confirms the generation guard is unchanged. Declaration regeneration/final input validation follows this documentation update. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-detox-camera-runtime-child-root-frozen-20261005/TRANSFER.private.json` and canonical logs; `/Users/eduwaldo/.codex/private-overlays/android-detox-camera-declaration-root-20261005/`.

Fresh Android Maestro V38 is the next complete camera attempt, with a fresh build, immutable paired source hashes/file sets, private runtime/public verification and independent terminal cleanup. Original V37/V36 failures remain unchanged. Native Java/instrumentation compilation and actual Detox execution, a real T15 cold reset/receipt, final configured client validation and all broader plan acceptance remain pending. Accepted native/public camera passes and actual T15 cold attempts are still zero. Product behavior, server provider baseline, copy and localization are unchanged; broader functional/use-case/acceptance/business-rule/screen-copy artifacts need no update for these harness fixes.

## Current integrated Android APK reader correction — 2026-10-05

The independently accepted two-row V37 blocker repair is integrated. APK eligibility uses the existing 256 MiB build limit, streams SHA-256 in 64 KiB chunks, verifies full pre/post descriptor and canonical-path identity, and checks cancellation/expiry through the final return boundary. Root actual-worktree CompilerHost passes with zero diagnostics, formatting passes, and canonical strict two-file lint passes with zero errors/warnings. All six targeted canonical APK controls pass with zero failures, skips or cancellation, including the observed 82,175,004-byte size, oversized files, hash/identity rejection and mid-stream abort. Private full eligibility controls pass 18/18; canonical full eligibility/configured validation remains pending. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-v37-apk-bound-root-frozen-20261005/TRANSFER.private.json` and canonical logs.

Declaration regeneration initially rejects eleven newly imported Android Detox camera owner paths without source revisions. Root adds their explicit source mappings while preserving the fail-closed generator and the sole recursive inventory exception. Canonical regeneration, declaration ownership controls and fresh dispatch selection must pass before runtime credit. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-detox-camera-declaration-root-20261005/TRANSFER.private.json`.

Original V37 receipts remain harness-blocked and unchanged. Fresh Android V38 still requires a fresh build, paired source hashes/file sets, actual camera/public verification and independent terminal cleanup. The integrated Detox camera route also still requires its omitted child test file, followed by canonical source controls and native instrumentation validation. Accepted native/public camera passes and actual T15 cold attempts remain zero. Product behavior, server provider baseline, user-facing copy and localization are unchanged; no broader domain artifact update is required for this bounded harness reader.

## Current Android Detox camera source composition — 2026-10-05

The independently reviewed V13 composition integrates 20 changed/new source rows. The formatted runner preserves identical syntax; the stale staging anchor is omitted and canonical `3b0d966e…` deadline behavior is preserved. Real acquired target identity/OS/ADB facts, original acquisition deadline, expectation-bound cold-reset ID and one Java instrumentation class are now composed. Actual-worktree CompilerHost passes with zero diagnostics. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-detox-camera-v13-root-frozen-20261005/TRANSFER.private.json` and `COMPILER-HOST-FORMATTED.private.log`.

Canonical source controls currently pass 16/17. The remaining failure is a real omitted runtime dependency, `e2e/detox-android-camera-denied.e2e.test.js`, which the route explicitly selects. The route fails closed until its actual child is added. The first canonical strict lint has one import-order warning; root fixes that ordering without changing behavior. Final canonical tests/lint/typecheck and native Java/Detox execution remain pending; no private-copy ENOENT is waived and no source-only control earns a native or T15 cold pass. The separate V37 APK evidence reader correction still requires final source review and a fresh complete V38 camera attempt. Product behavior, server provider baseline, copy and localization are unchanged; broader domain artifacts require no change for this harness composition.

## Current Android V37 APK evidence blocker — 2026-10-05

Fresh Android Maestro V37 attempt `bac1ce36aec4fbf223c9bd8d`, capture `a8ea94d9602f5e0792dc4893`, builds successfully in 1m 25s and completes the camera callback once. All 44 command records complete; capture is observed/cleaned. The integrated command deadline correction advances past V36. Runtime evidence verification then rejects the actual 82,175,004-byte Debug APK at its 64 MiB reader cap: `Android APK size is unbounded`. The next bounded repair must align with the existing 256 MiB APK verification limit, hash with fixed-size streaming reads, preserve file identity and original deadline/cancellation guards, and reject oversized or changed files. A fresh complete camera attempt remains required; the original V37 outer receipt stays harness-blocked, exit 2 with zero assertions and zero native/public camera credit.

Root and independent cleanup pass: 298 PID/start pairs, 50 process groups and all five reserved ports have no survivors/listeners; owned device/cache/runtime children/private credentials are absent; all six foreign container states and the booted foreign simulator are preserved. All 1,327 client and 204 server source hashes and file sets remain unchanged. Source hold is released. Evidence: primary `.qa/artifacts/testing-modernization/android-maestro-camera-public-live-2026-10-05-v37/ROOT-TERMINAL.private.json` and `INDEPENDENT-TERMINAL-AUDIT.private.json`.

The separate Android Detox camera V13 successor is private and under independent review. Root actual-worktree CompilerHost passes its 20 changed/new rows with zero diagnostics; its identical historical staging anchor is omitted to preserve the integrated deadline correction. No transfer, native Detox pass or actual T15 cold attempt is claimed. Final configured validation follows source integration. Product behavior, server provider baseline, copy and localization are unchanged, so no functional requirements, use cases, acceptance criteria, business rules or localized screen-copy update is needed for these harness repairs.

## Current canonical camera deadline gates — 2026-10-05

The independently reviewed two-file anchored deadline correction is integrated. After authoritative declaration regeneration, the complete canonical camera cohort passes all 30 tests with zero failures, skips or cancellation. Canonical full TypeScript and actual-worktree CompilerHost pass with zero diagnostics; strict two-file lint has zero errors/warnings and formatting passes. The four initial stale-declaration failures remain preserved as preparation evidence. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-v36-anchor-deadline-v2-final-root-frozen-20261005/VALIDATION.private.json` and `CANONICAL-TEST-FINAL.private.log`.

The existing step and whole-run caps remain unchanged. Finite caller deadlines, shortened step overrides, cancellation/expiry and the optional 30-second default retain their contracts. Android V37 is the fresh full camera attempt after this source correction; it requires a fresh build, immutable paired-source snapshot, private receipt verification and independent terminal cleanup. V36 and its failed private artifact remain unchanged; accepted native camera passes and actual T15 cold attempts are still zero. The previously passing configured client suite is evidence for its recorded pre-correction source revision; final configured validation follows remaining source integrations. Product behavior/provider/copy/localization are unchanged.

## Current reviewed command-deadline integration — 2026-10-05

Root integrates exactly the two independently accepted command-deadline rows. Anchored operations now use the configured step cap with an effective absolute deadline no later than the original caller deadline. Explicit Infinity/NaN are rejected before input creation or command acquisition; the optional 30-second default is preserved and exercised at runtime. Private focused controls pass 8/8; actual-worktree CompilerHost and canonical full TypeScript report zero diagnostics; strict actual-worktree two-file lint has zero errors/warnings and formatting passes. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-v36-anchor-deadline-v2-final-root-frozen-20261005/TRANSFER.private.json` and validation logs.

The initial canonical camera cohort runs before source-declaration regeneration and correctly rejects four stale-input finalizer fixtures. That receipt is retained; the declaration must be regenerated before the final canonical cohort and fresh Android V37 attempt. V36 remains unchanged and blocked, including its retained failed pre-command artifact. Accepted camera passes and actual T15 cold attempts remain zero. The separate private Detox camera successor still needs the reviewed target/reset/deadline/Java corrections. Product behavior, provider baseline, copy and localization are unchanged; no broader domain documentation change is required.

## Current Android V36 deadline-budget blocker — 2026-10-05

Fresh Android V36 attempt `26c32b33eec24a6c0b1ca02d` / capture `ebecbf6a8e03710f4d7d43d9` builds successfully in 1m 59s, completes the camera callback once, and forwards manual submission with HTTP 201. Capture is observed/cleaned; all 44 command records complete. The screenshot role binding advances past its former failure. Runtime verification then rejects the anchored operation's command deadline: it passes the remaining whole-run budget to a step command capped at 600,000 ms. The repair must shorten the command to the configured step cap and preserve the original whole-run bound, with no cap increase or deadline reset. The original outer receipt remains harness-blocked, exit 2 and zero assertions; accepted native/public camera counts remain zero.

Root cleanup and independent audit pass: 306 PID/start pairs, 50 groups and all known ports are absent; owned device/cache/runtime children and credentials are absent; all six foreign containers and the booted foreign simulator are preserved; all 1,327 client and 204 server hashes and file sets are unchanged. Source hold is released. The failed pre-command temporary artifact is retained unchanged with one input file, no ownership ledger and no live handle. Evidence: primary `.qa/artifacts/testing-modernization/android-maestro-camera-public-live-2026-10-05-v36/ROOT-TERMINAL.private.json`, `INDEPENDENT-TERMINAL.private.json` and `ROOT-ANCHOR-RETAINED.private.json`.

The command-budget correction is the next bounded source fix, followed by a fresh camera attempt. The private Android Detox camera successor is separately under review and grants no cold/native credit. The configured unit and declaration/session gate results below remain evidence for their recorded source revision; V36 is not promoted retrospectively. Product behavior/provider/copy/localization are unchanged.

## Current configured client and camera dispatch gates — 2026-10-05

The configured client `yarn test:unit` run passes 3,255/3,289 tests across 105 suites, with zero failures/cancellations and 34 existing conditional skips. All 1,327 client and 204 paired-server source hashes and file sets remain unchanged. Evidence: `/Users/eduwaldo/.codex/private-overlays/camera-session-final-source-gates-root-20261005/FULL-UNIT-TERMINAL.private.json`. This supersedes historical full-unit pending/failure statements below; it does not establish native, hosted, provider or store acceptance.

The reviewed two-row declaration repair is integrated and canonical validation passes all 22 declaration/session controls, including all 14 Android session terminal controls. Generation now rejects any nonrecursive owner lacking a source revision. Seven shared session owners are explicitly mapped; the inventory remains a source-only declaration. Evidence: `/Users/eduwaldo/.codex/private-overlays/native-declaration-session-closure-root-candidate-20261005/VALIDATION.private.json`.

The next camera attempt is fresh Android Maestro V36 with a fresh build, exact source hashes and file sets, private evidence and independent terminal cleanup. V35 remains unchanged and blocked. Accepted native camera passes and actual T15 cold attempts remain zero until fresh execution qualifies them. The separate Android Detox camera successor needs manual composition with the current session safeguards; its old packet is not transferred wholesale. No product/provider/copy/localization behavior changes in this declaration correction require broader domain documentation updates.

## Current combined camera source gates — 2026-10-05

The reviewed screenshot role binding, leader-proof ownership correction, deterministic deadline fixture and 27-row Android session composition are integrated. Canonical command/iOS controls pass 52/52 and session source controls pass 29/29. Full TypeScript passes; strict lint and formatting pass across the combined 36 source/test rows with zero warnings. Evidence: `/Users/eduwaldo/.codex/private-overlays/camera-session-final-source-gates-root-20261005/` and `/Users/eduwaldo/.codex/private-overlays/owned-command-deterministic-deadline-root-candidate-20261005/CANONICAL-TEST.private.log`.

The session packet census is corrected and its prior seal preserved. The deterministic fixture establishes real ownership before injecting census delay; missing-leader failure and retained recovery evidence remain authoritative. These results supersede the pending source-transfer/fixture statements in the historical sections below. The independently accepted two-row declaration repair is integrated: all seven newly discovered owners have source revisions, and generation rejects any future undeclared nonrecursive owner. Private graph controls pass 3/3, the unknown-owner negative fails closed, and actual-worktree compilation and strict lint pass. Canonical regeneration and terminal validation follow; freshness enforcement remains unchanged. Evidence: `/Users/eduwaldo/.codex/private-overlays/native-declaration-session-closure-root-candidate-20261005/TRANSFER.private.json`. Fresh camera execution follows the repaired terminal cohort. V35 remains blocked and unchanged; accepted camera passes and actual T15 cold attempts remain zero. Full configured client unit validation remains pending. Product behavior, server-provider baseline, copy and localization are unchanged, so no FR/UC/AC/BR or localized-copy update is required.

## Current role-typed screenshot source integration — 2026-10-05

Root integrates the independently accepted two-row Android collector correction. Log paths accept only the exact command-labelled `.private.log`; stdout accepts exact `.stdout` or `.png`, with owned stable reading, separate 8 MiB text/16 MiB frame bounds and PNG signature validation. Canonical collector controls pass 3/3, including role swaps, crossed labels and invalid PNG rejection; actual-worktree CompilerHost reports zero diagnostics and strict two-file lint/format pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-binary-output-binding-root-frozen-20261005/TRANSFER.private.json` and `VALIDATION.private.json`. V35 remains unchanged and blocked; only a fresh camera attempt can qualify runtime acceptance.

The minimal shared ownership correction is independently accepted: cleanup authority comes from a usable leader proof, never an empty census. The original missing-leader control passes unchanged. The separate 600 ms delayed-census control still expires before recording ownership and retains a truthful failed ledger; this also reproduces against the previous helper. A deterministic fixture must first prove ownership, then inject a query delay under one original deadline, retain failed artifacts and verify absence before disposal. Native dispatch remains held until that source gate passes. Root retained diagnostic evidence and independently found PID/PGID 38662 absent, without changing its failed receipt. Evidence: `/Users/eduwaldo/.codex/private-overlays/owned-command-deadline-retained-diagnostic-20261005/ROOT-ABSENCE.private.json`.

The Android session 27-row cold-route/receipt composition passes a joint actual-worktree CompilerHost with zero diagnostics and independent contract review; a private source-census metadata correction is pending before transfer. Full client unit, native and cold proof remain pending. Product behavior, server provider, copy and localization are unchanged.

## Current Android V35 runtime and iOS preflight integration — 2026-10-05

Fresh Android V35 attempt `55189de0a10d2497cfe6fd98` / capture `6f76644ac7689e5ea319550d` builds successfully and completes the camera-denial/manual-submission callback once with HTTP 201. All 44 command records retain nonempty ownership proof. Capture is observed/cleaned, but native/public credit remains zero: the native collector rejects binary screenshot command 12 because its actual `entry.png` stdout artifact is compared with `entry.stdout`. The outer receipt remains harness-blocked with exit 2; it is not repaired or promoted retrospectively. Root production cleanup passes 325 PID/start pairs with zero survivors/unknown queries; independent terminal audit verifies 49 ledgers, 272 unique PIDs/49 groups absent, owned ports/resources absent, foreign resources preserved, and all 1,307 client plus 204 server hashes and file sets unchanged. Source hold is released. Evidence: primary `.qa/artifacts/testing-modernization/android-maestro-camera-public-live-2026-10-05-v35/ROOT-TERMINAL.private.json`.

Root integrates the independently reviewed four-row iOS V12 preflight/helper composition. Production descriptor-reads and validates the cleaned ownership ledger before publishing exact-one-test discovery; executed-module evidence stays separate under the original deadline. An explicit initial acquisition deadline bounds setup/census/pre-spawn work without enabling the Android handshake for iOS. Actual-worktree CompilerHost and full TypeScript report zero diagnostics; strict changed-file lint with zero warnings and formatting pass. V14 controls pass 20/20. Combined V30/shared-command controls pass 31/32. Independent review identifies a production ownership-state defect: an empty initial census is treated as acquired ownership, so strict cleanup is attempted without a proven leader. The existing missing-leader expectation remains authoritative; its fixture-only replacement is rejected. A production correction must establish ownership only from a usable leader proof and preserve failed recovery evidence. Fresh iOS dispatch remains blocked until that correction passes the existing controls. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-v12-final-root-frozen-20261005/TRANSFER.private.json` and canonical logs.

T14/T15 remain in progress. Product/domain/provider/copy/localization requirements are unchanged. Full configured client unit rerun, fresh iOS camera execution, accepted native camera passes and actual cold-attempt qualification remain pending; runtime and test failures remain historical evidence.

## Current reviewed Android acquisition integration — 2026-10-05

Root integrates exactly four sealed and independently accepted Android acquisition rows. Actual-worktree CompilerHost reports zero diagnostics. Independent controls prove exact release-byte rejection, same-PID target execution, original deadline/cancellation classification and strict cleanup after usable initial ownership. The no-usable-handle race retains failed recovery evidence rather than claiming cleanup. Canonical controls pass 24/24 with zero failures, skips or cancellation; full TypeScript, strict four-file lint with zero warnings, formatting and diff checks pass. A fresh Android build/run is still required; this source proof grants no native credit. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-v35-successor3-root-frozen-20261005/TRANSFER.private.json`.

The iOS deadline/ledger successor remains private and must be sealed against these new shared-helper preimages before composition. Camera passes and actual cold attempts remain zero. These harness changes do not alter product behavior, backend provider, copy or localization. Prior rejected candidate and runtime receipts below remain historical evidence.

## Current Android partial-acquisition review — 2026-10-05

The private successor's 22 passing controls are insufficient for transfer. Independent delayed-census cancellation exposes real initial ownership while the later handshake flag remains false, so strict group cleanup is skipped and cancellation becomes a harness block. The initial ownership census also lacks the caller's absolute deadline/signal. The fresh repair must pass that budget into acquisition, recognize usable initial ownership independently of the later loop return, preserve deadline/cancelled classifications and verify the real post-exec target record under the same PID. Bounded recovery may finish after execution expiry without changing the failed outcome. No source integration or native dispatch follows.

Root and independent process observations find the diagnostic group and its five recorded PIDs absent. The diagnostic's original failed temporary ledger was removed by its finally block, so cleanup proof from that artifact remains unavailable and is not promoted to clean. Future failed-acquisition controls must retain recovery evidence until independent absence is recorded. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-v35-minimal-root-integration-20261005/SUCCESSOR3-REJECTION.private.json`. Native camera passes and actual cold attempts remain zero; product/provider/copy/localization requirements are unchanged.

## Current paired-source password-reset restoration — 2026-10-05

Root integrates the independently reviewed 19-row atomic successor into the current paired server checkout. Migration 0025 adds nullable `consumed_at`; hashing occurs before the transaction, while token CAS, credential replacement and same-account session revocation commit together. The production route has no non-atomic fallback. Canonical configured server unit validation passes 261/261 tests across 43 files, and the unmodified client source-contract test passes against the actual sibling server. The real private Postgres qualification passes all 22 files/86 tests, including both rollback hooks and concurrency, with independently verified cleanup and source preservation. Evidence: `/Users/eduwaldo/.codex/private-overlays/password-reset-atomic-minimal-root-integration-20261005/TRANSFER.private.json`, `UNIT.private.log`, `CLIENT-ROUTE.private.log` and `/Users/eduwaldo/.codex/private-overlays/password-reset-atomic-pg-root-v3-20261005/ROOT-TERMINAL.private.json`.

This closes the current local paired-source route gap for SC-227/ET-74. Historical missing-route and failed-fixture receipts remain unchanged. Migration deployment, hosted CI and provider/store proof remain pending; this is not native camera or T15 cold credit. SC-217/D-215 already specify the intended route, reset result and session revocation, so no FR/UC/AC/BR or localized client copy change is required. The full configured client unit command still needs a fresh receipt after the current camera source integrations.

## Current atomic password-reset real Postgres qualification — 2026-10-05

The fresh identity-qualified private candidate passes all 22 requested Postgres files and all 86 tests with zero failures. The confirmation suite exercises the public route, Argon2id old/new password behavior, token replay rejection, same-account session revocation with foreign sessions preserved, rollback immediately after token consumption and before commit, and concurrent one-success/one-invalid-token behavior. Root independently verifies owned container/network/allocated port and all recorded processes absent, foreign container states preserved, all 1,691 private source hashes and all four source file sets unchanged, and releases the source hold. Evidence: `/Users/eduwaldo/.codex/private-overlays/password-reset-atomic-pg-root-v3-20261005/ROOT-TERMINAL.private.json` (run `f05cdb18475d8c49081c05db`). The original failed fixture run remains unchanged.

This packet is high risk because it restores an auth endpoint and adds migration 0025. The existing modernization card remains the source of truth under the workspace evidence-delivery workflow. The user explicitly authorized continuing the already-approved fixes; this covers local implementation and owned validation. Production deployment, provider mutation and merge remain outside this authorization. Governing behavior is SC-227, D-215 and the corrected paired-source audit; the account-settings request rules FR-251/BR-299–301 and localized client copy remain unchanged. Required evidence covers atomic token/password/session changes, replay, expired or mismatched token, missing account, both rollback hooks, concurrency and foreign-session preservation; the real owned Postgres receipt above supplies the database rows. Canonical integration, server unit checks and the client source-contract check are complete as recorded in the paired-source restoration section; the full configured client unit rerun remains pending.

The 19-row server successor completed independent transfer review and canonical integration, server unit and client source-contract checks. The full configured client unit rerun remains pending. This private database qualification does not establish deployment, provider behavior, native camera success or a T15 cold attempt. The separate Android launch-gate and iOS preflight successors remain under review.

## Current camera launch-gate review — 2026-10-05

The frozen Android V35 three-file candidate passes the root CompilerHost against the actual current checkout with zero diagnostics; private-copy typing failures are not current-checkout baseline failures. Source transfer remains blocked by review of the launch gate: a zero-byte EOF can make the POSIX `dd` guard succeed without the required release byte, and the launcher creation error branch can remove an existing artifact that the current invocation did not create. The acquisition and execution waits also restart a relative deadline, so the successor must carry one absolute monotonic caller budget across both. A fresh successor must reject EOF/wrong-byte release and preserve pre-existing launcher files, with independent negative controls before integration and a fresh Android build/run. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-v35-minimal-root-integration-20261005/ROOT-REVIEW.private.json`.

The separate iOS blocker remains the five-second executed-module selection gate expiring during authentic Detox initialization. Namespace/tool-PATH repairs are already qualified; discovery and executed-module receipts must remain distinct and protected under the original caller deadline. Accepted native camera passes remain zero. These harness fixes do not change product requirements, server provider baseline, screen copy or localization.

## Current iOS V10 and first atomic Postgres runtime results — 2026-10-05

Fresh iOS V10 capture `fa6f8d33acecda107d4ea25c` publishes the actual namespace and resolves the installed applesimutils tool. It still remains harness-blocked: the owner requires the executed test module's exact-selection receipt within five seconds, while the installed Detox initialization hooks now run before module evaluation. The successor must reconcile protected exact-one-test discovery with bounded native initialization under the original caller deadline and preserve prompt natural-exit/cancellation handling; a fabricated receipt or arbitrary deadline waiver is not acceptable. Root independently verifies eleven PID/start pairs, two groups, all four known listeners and owned simulator/backend/cache absent, foreign resources preserved, all 1,508 source hashes and both file sets unchanged, and root child absent. Original failed-recovery-retained cleanup remains unchanged. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-05-v10/ROOT-RECOVERY.private.json`.

The private atomic password-reset candidate's first owned Postgres run requests all 22 files: 21 files pass, with 82 tests passing and four new confirmation tests failing. Raw postgres.js fixture interpolation receives Date objects instead of serialized timestamp strings, so rollback/concurrency acceptance is still pending. Container/network/port/process cleanup is independently verified and all 1,691 frozen private source hashes match. The candidate's copied Git pointer files also reference canonical worktree metadata; that receipt cannot qualify independent source identity. At this historical first-run boundary, a new private metadata composition and minimal raw-driver fixture correction were required. The v3 qualification and paired-source restoration sections above record their subsequent completion; this failed receipt remains unchanged and establishes no provider or hosted proof. Evidence: `/Users/eduwaldo/.codex/private-overlays/password-reset-atomic-pg-root-v2-20261005/ROOT-TERMINAL.private.json`. Accepted native camera passes and actual T15 cold attempts remain zero; no client product requirements, provider baseline, copy or localization changed.

## Current actual iOS Detox namespace repair — 2026-10-05

Root integrates exactly the actual iOS Detox owner's two-file namespace successor. Both partial and final cleanup-only capture publications bind platform, integration mode, capture ID and actual capture root; their failure/result and promotion guards remain unchanged. Canonical 20 controls pass with zero skips/cancellation; full TypeScript, strict two-file lint with zero warnings and formatting pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-detox-namespace-minimal-root-integration-20261005/VALIDATION.private.json`. The next fresh iOS run also corrects the explicit tool PATH for the existing applesimutils binary. These source/tool qualifications do not earn a native passing receipt or cold attempt. Product requirements, provider baseline, screen copy and localization are unchanged.

## Current fresh iOS V9 startup result — 2026-10-05

Fresh iOS capture `2a072d7dd41a5e467b0c74d2` launches the installed Detox Jest hooks. The previous undefined-device error is absent; initialization now fails before test discovery because the explicit native runtime PATH omits `/opt/homebrew/bin` and `applesimutils --version` cannot resolve. The existing `/opt/homebrew/bin/applesimutils` binary independently reports version 0.9.12; no installation is needed. The next fresh attempt must add that directory after pinned Node in the tool PATH. Original V9 remains harness-blocked with zero tests/native credit and failed-recovery-retained cleanup; it is not promoted.

Root independent recovery verifies seven recorded PID/start pairs, two groups, all four known ports, owned simulator/container/network/cache absent, private backend credentials/fixtures removed, foreign simulator and container states preserved, root child absent, and all 1,508 unique frozen file hashes and both file sets unchanged. Source hold is released only with that recovery evidence retained. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-05-v9/ROOT-RECOVERY.private.json` and `ROOT-TOOL-PATH.private.json`. Android fast-worker handshake and actual iOS Detox capture metadata successors remain private. Product requirements, server provider baseline, copy and localization remain unchanged.

## Current Android receipt fixture correction — 2026-10-05

Root independently reviews and adopts exactly two Android test-fixture corrections: outer attempt and its output directory receive a distinct ID, while capture, target-owner and backend identities retain their original bindings. Invalid-driver and full/missing/extra/duplicate artifact graph assertions are unchanged. All six previously failing canonical tests now pass with zero skips/cancellation; full current TypeScript, strict two-file lint with zero warnings and formatting pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-v34-fixture-minimal-root-adoption-20261005/VALIDATION.private.json`.

The adoption follows a retained private-copy audit: patching reused private symlinks accidentally wrote those two canonical tests before review. Root preserves before/after bytes and explicitly reviews the minimal deltas before accepting them; this does not retroactively make that write a reviewed transfer. Future private candidates must use new regular-copy directories with no source aliases. The latest full unit receipt remains the failed 3,241-test run; six scoped passes do not replace that receipt, and the missing password-reset route was still under transactional/real-Postgres qualification at that pre-restoration boundary. The current scoped route and Postgres proofs supersede that route-status conclusion; the full client command remains unrерun. No native or cold credit, product requirement, provider baseline, copy or localization change follows.

## Current namespace integration and private-copy recovery — 2026-10-05

Root integrates exactly three namespace rows: Android capture publishes its actual capture root, and protected-reader tests retain missing-root, crossed-root and symlink rejection plus exact-byte hash proof. Canonical 13 controls pass with zero failures/skips; full TypeScript, strict three-file lint with zero warnings and formatting pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/capture-namespace-minimal-root-integration-20261005/VALIDATION.private.json`. The actual iOS Detox owner uses a separate cleanup-only capture publisher from the generic iOS lifecycle; its explicit namespace successor remains under review, so a generic iOS initializer scan is not claimed as proof of that producer.

Validation catches a private-copy incident before any native dispatch: two existing private destination symlinks cause an agent copy to overwrite the canonical native-command helper and its test with older bytes. Root preserves unexpected bytes, confirms attribution, and atomically restores exactly both reviewed frozen preimages. Full TypeScript then passes. Evidence: `/Users/eduwaldo/.codex/private-overlays/native-helper-unexpected-drift-root-20261005/RESTORE.private.json`. The fast-command repair continues in a new independent private directory; runtime receipts must record authentic identity before execution, never accept empty process evidence. No native resources are live and no native or cold credit follows. Product requirements, provider baseline, copy and localization are unchanged.

## Current full unit rerun and camera blockers — 2026-10-05

The exact configured `yarn test:unit` rerun exits 1: 3,241 tests, 3,200 passed, seven failed, 34 skipped and none cancelled. All 1,307 client and 201 server held file hashes and both file sets match before source-hold release. Six remaining failures are Android runtime-receipt/terminal-closure fixtures under review after the four-distinct-identity repair; the seventh is the correctly failing required password-reset confirmation route contract. At this pre-restoration snapshot, the route successor still required atomic token consumption, credential replacement and same-account session revocation with rollback and concurrent-confirmation proof. Current scoped route and Postgres validation now prove that behavior; they do not replace this historical failed full-unit receipt. The 34 isolated-workspace skips remain explicit and are not passing evidence. Receipt: `/Users/eduwaldo/.codex/private-overlays/client-full-unit-current-v2-root-20261005/RESULT.private.json`.

The next complete camera run still requires reviewed Android command-process ownership and explicit capture-root/capture-ID publication at the actual producers. The protected reader and process checks remain intact. The integrated iOS Detox Jest initialization needs fresh build requalification and a new native attempt. The broad unit gate remains failed separately from scoped native smoke qualification. Accepted native camera passes and actual T15 cold attempts remain zero. These client harness changes do not change product requirements, provider baseline, copy or localization.

## Current Android V34 observed capture and next receipt repairs — 2026-10-05

Fresh Android public attempt `4c942ba17e92e56fcbc43230`, capture `bd832c3e0d7aab1f05d7a32d`, passes its fresh build and completes the real camera denial/manual-submission callback. Capture result is observed/cleaned and callback count is one/completed. Public receipt remains harness-blocked with zero assertions because native collection rejects `Android command 3 ownership processes are missing`, and protected target observation rejects `child capture JSON identity differs from its protected namespace`. The real report has a capture ID but omits the explicit capture-root field required by the shared protected reader. Neither failed result is promoted. Minimal command-ownership and producer namespace successors are in progress; PID/start, root-descriptor, no-follow, identity/hash and cross-substitution checks remain required.

Root independently runs the published Android cleanup inspector: passed, 147 PID/start pairs, zero survivors or unknown process queries, owned resources absent and foreign resources preserved. All 1,508 frozen unique file hashes and both file sets match; root child is absent before source-hold release. Evidence: primary `.qa/artifacts/testing-modernization/android-maestro-camera-public-live-2026-10-05-v34/ROOT-CLEANUP.private.json` and `ROOT-TERMINAL.private.json`. Accepted native camera passes and T15 actual cold attempts remain zero.

After terminal recovery, root integrates the independently accepted one-file iOS Jest fix: installed Detox 20.47.0 environment, global setup/teardown and reporter, preserving exact one-test selection. Official hooks initialize before the child's later guard; the owner first reads, hashes, copies, revalidates and seals the runner closure at immutable staged paths, so the V27 protected launch boundary remains intact. Root also integrates exactly three rebased session/training fixes: only the canonical Python helper is admitted by the finalizer; the fixture supplies required deterministic post-tap flow/hierarchy/PNG evidence; and tests cover both engines on both platforms with unsupported-engine negatives. Production training admission stays unchanged. The Maestro-only predecessor is withdrawn. Canonical full TypeScript, strict four-file lint with zero warnings, formatting and Jest-config syntax pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-jest-init-minimal-root-integration-20261005/TRANSFER.private.json` and `/Users/eduwaldo/.codex/private-overlays/session-training-minimal-root-integration-20261005/TRANSFER.private.json`. Full unit rerun and fresh native proof remain pending. These client QA repairs change no product requirements, provider baseline, copy or localization.

## Current Android identity and architecture repairs integrated — 2026-10-05

Root integrates exactly 13 independently accepted Android V33 identity rows. Public requested attempt, capture artifact, independently allocated target owner and backend session IDs remain distinct and bound to their actual caller/resource contexts; cross-substitution is rejected. Independent source cohort passes 52/52 with zero skips; all current preimages/candidate hashes match. Canonical full TypeScript, strict 13-file lint with zero warnings and formatting pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-v33-minimal-root-integration-20261005/TRANSFER.private.json`. A fresh Android build and native camera run remain required; no source result earns native or cold credit.

Root also integrates eight minimal architecture/provenance fixes, excluding the stale private generated inventory. Capture helper closure gains its six actual shared Android session/cleanup dependencies; the evidence helper boundary admits only the exact observed save/retry `.mjs` and connection ancestor-safe `.py` sidecars. Test fixtures preserve fail-closed transport/admission intent, canonical root/package paths and the complete locale helper ledger. Formatting of the capture source changes no behavior beyond those six dependencies, independently confirmed against its formatted preimage. Independent repair cohort passes 89/89; canonical full TypeScript, strict eight-file lint with zero warnings and formatting pass. Evidence: `/Users/eduwaldo/.codex/private-overlays/unit-admission-minimal-root-integration-20261005/SNAPSHOT.private.json`. Root regenerates the actual inventory after the QA checkpoint, preserving current source revisions. After that regeneration, the combined canonical camera/admission cohort passes all 145 tests with zero failures, skips or cancellation; see the Android integration packet `VALIDATION.private.json`.

The full unit gate remains pending repair/rerun after its retained 25-failure run. A private session/training candidate that narrows the shared binding to Maestro-only is rejected because T14 requires both engines; its successor must preserve current Maestro/Detox admission and repair the stale negative fixture. The iOS Detox initialization candidate awaits independent module-loading/ownership review. Product behavior, current server provider baseline, screen copy and localization remain unchanged by these client QA harness repairs.

## Current iOS V7/V8 runtime blockers and recovery — 2026-10-05

Fresh V7 preflight `ec9b8984d1690012b0aa30ad` rejects the canonical runner input because its link count is 2. Root reproduces this exact read-only rejection before build loading or owner creation. A private typed-test composition had created hard-link aliases; its owner replaces 11,676 private aliases with independent copies. Root confirms all 1,508 held source files now have one link and the exact protected runner-input loader passes. Original V7 remains failed, with its pre-resource rejection and source/file-set checks retained; no guard was weakened.

Fresh V8 `e5712009af5fe6c78eea21b6` acquires owned native/backend resources, binds exact protected Jest discovery and launches the child. It exits 1 with `ReferenceError: device is not defined`: the camera Jest config uses the Node environment without Detox initialization. The child outcome is now observed promptly and cleanup aggregate is cleaned without step errors; original capture/public cleanup remains failed-recovery-retained because complete owner qualification was not achieved. Root independently verifies all 13 recorded PIDs, two groups, known ports 61147/63032/63312/63315, owned simulator/backend container/network and Expo cache absent; backend credentials/fixtures removed; foreign booted simulator and five running/one stopped container states preserved; all 1,508 unique frozen file hashes and both file sets unchanged before source-hold release. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-05-v8/ROOT-RECOVERY.private.json`. No native camera or cold credit is claimed.

The next iOS successor must initialize the actual installed Detox Jest runtime while retaining protected runner-input and module-origin checks. Android V33 distinct-ID successor privately passes 52 source controls, full current-Q composition and strict 13-file lint/format; independent transfer review is pending. The overall unit gate remains failed until its 25 historical failures are repaired and the full command reruns; scoped native smoke evidence does not waive that gate. These QA harness changes leave product requirements, current server provider baseline, screen copy and localization unchanged.

## Current broad unit gate and integrated iOS successor — 2026-10-05

The exact configured `yarn test:unit` run exited 1: 3,237 tests, 3,178 passed, 25 failed, 34 skipped, none cancelled. All 1,307 held client source files and the complete file set remained unchanged. The 34 skips exactly match the conditional parent-workspace contract checks in `features/auth/firebase-config-removal-scan.test.ts`; required outer workspace documents/package manifest are absent from this isolated worktree. They remain skipped, not passed; classification is retained in `UNIT-SKIP-CLASSIFICATION.private.json`. The failed log and source hold receipt are retained at `/Users/eduwaldo/.codex/private-overlays/client-full-gates-root-20261005/`. These failures remain an overall gate; scoped green checks do not waive them. The configured impact check separately passes 12 features, 46 suites and 65 UI specs. Domain route-contract, native helper/provenance fixtures, admission policies and camera checks are under bounded diagnosis; no expectation is changed solely to match an implementation.

After that run ended, the independently accepted six-file iOS successor was integrated, excluding 13 inherited rows. It fixes the actual staged Detox config argument (`argv[4]`), binds exact Jest selection, and stops bootstrap waiting on an already-terminal child while preserving its original exit. Necessary V14 test doubles now expose the actual child-outcome contract; ownership/unsafe-group guards remain intact. Canonical controls pass 74/74, full TypeScript passes, and eight touched source/test/config files pass strict lint with zero warnings and formatting. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-v6-adapter-minimal-root-20261005/TRANSFER.private.json` and canonical logs. Native acceptance remains pending.

Two camera test defects are repaired: the invite-readiness architecture policy accepts either quote style while retaining the same required call/condition identities, and the positive cwd-isolation staging test uses an explicit bounded 120-second budget. Separate cancellation/deadline rejection cases remain unchanged. The old quote check fails in the retained focused preimage control; the first post-change cohort retained 24 passes and four stale-declaration gate failures. After declaration regeneration, the same canonical cohort passes all 28 tests with zero failures or skips; both logs remain retained. The real Android three-ID binding repair remains in progress. No product/provider/copy/localization changed. Full unit rerun and native/cold/hosted gates remain pending.

## Current overall client lint gate — 2026-10-05

The actual configured `yarn lint` command exited 0 with zero errors and 2,932 warnings. This is a successful configured command, not a warning-free result. Changed-file strict checks remain separate. Evidence: `/Users/eduwaldo/.codex/private-overlays/client-full-gates-root-20261005/RESULT.private.json` and its hashed `LINT.private.log`. The full unit command and final impact/type checks still require current-source validation after the pending camera repairs; no broad unit or final completion claim is made. Native camera acceptance and T15 cold attempts remain zero. No product behavior, provider terminology, copy or localization changed.

## Current Android V33 terminal and three-identity defect — 2026-10-05

Fresh public Android attempt `1087871c486b31898c0be10d`, capture `53c7602c0227b35abfa93477`, built successfully and progressed through native entry, coach-code setup and student-home readiness. The callback failed before camera denial/manual-submission assertions because it requires resource `ownerRunId` to equal the public requested attempt ID. Actual ownership allocates that resource ID independently: the public attempt, capture and Android target owner are three identities. The current source controls did not cover this legitimate three-ID runtime contract; their 30/30 pass cannot qualify the faulty binding. The successor must bind the public attempt explicitly through its bridge/execution context, while independently binding owner identity to the owned target and cleanup and capture identity to the retained capture root. All crossed identities must remain rejected.

Original capture and public receipt remain `harness-blocked`, public exit 2, zero assertions/native credit. Root independently ran the published cleanup inspector: 91 PID/start pairs, zero survivors and zero unknown process queries; cleanup passed. All 1,508 frozen unique files matched and the root child was absent before source hold release. Evidence: primary `.qa/artifacts/testing-modernization/android-maestro-camera-public-live-2026-10-05-v33/ROOT-CLEANUP.private.json` and `ROOT-TERMINAL.private.json`. A new private source repair is in progress; no automatic retry or failed-artifact promotion occurred. T15 cold attempts remain 0/400. Product requirements, server provider baseline, copy and localization remain unchanged.

## Current camera source gates and next replay — 2026-10-05

The remaining Android collector/public-caller capture aliases are repaired, preserving distinct capture and requested owner IDs and explicit producer/owner/root checks. Two canonical fixtures now use the retained SQL parent receipts/current selection binding, expected native app label, distinct owner output root and explicit capture ID. Root normalized formatting, removed two obsolete unused fixture helpers and corrected import order. Canonical caller/collector/identity controls pass 30/30 with no skips; full TypeScript, strict lint with zero warnings, and formatting pass. The first canonical test run retained eight stale-declaration gate failures; regeneration resolved that input drift without changing assertions. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-downstream-minimal-root-20261005/ROOT-VALIDATION.private.json`.

The independently accepted backend timeout cleanup delta is integrated in one production helper. It accepts only the authenticated clean timeout tuple for cleanup, preserving `harness-blocked`/exit 2 and rejecting unsolicited nonzero exits. Canonical backend/process controls pass 53/53; independent actual session controls pass 11/11. The iOS Jest/child-exit successor is still rejected until its two existing V14 child doubles implement the actual child-outcome contract and its strict lint warning is repaired. A fresh Android public camera replay is next. No native camera pass or T15 cold attempt is claimed. These harness changes leave product requirements, server provider baseline, copy and localization unchanged.

## Current browser sequential repeat — 2026-10-05

A fresh full browser matrix repeat passed all 45 requested cases and all 351 assertions across nine profiles and five scenarios, with zero skips, flaky tests or global errors. Client run `38e9589f3946f4c36e8ce576` and backend `dffbd022bc6839d914a8c82c` exited 0; the authenticated backend receipt is passed/cleaned. Root independently verified 56 recorded processes, three process groups, and 31 observed app/proxy/API/database ports absent; owned backend container/network and worker-control socket/root absent; private backend credentials/fixtures removed; foreign containers preserved; and all 1,508 frozen unique files unchanged before source hold release. Evidence: `/Users/eduwaldo/.codex/private-overlays/web-full-current-root-20261005/matrix4/ROOT-TERMINAL.private.json`. Together with the prior full matrix run, this closes the pending sequential full browser repeat on the current V4 backend helper. It supplies local browser evidence only; native camera and T15 cold proof remain zero. Product behavior/provider/copy/localization are unchanged.

## Current iOS V6 camera blocker and recovered absence — 2026-10-05

Fresh iOS public camera capture `ea214fa194821899290ddbfc` used the requalified build and launched its protected staged child. Jest selected zero tests and exited with code 1 before bootstrap or any camera assertions. The owner continued waiting for a bootstrap event from that exited child. Root cancelled only the verified owned Node parent; wrapper exit 130 and the original child exit 1 are retained. Original cleanup remains `failed-recovery-retained`: child-stop recorded SIGINT, and backend session-stop rejected a receipt whose result is `harness-blocked`, reason `timeout`, exit 2, cleanup `cleaned`. This does not count as camera success.

Independent recovery verifies all 21 recorded process IDs absent with zero unknown process queries, owned ports 63032/63315 absent, owned simulator and backend container/network absent, and unrelated simulator/containers preserved. All 1,508 unique frozen client/server files matched across 1,709 hash checks (the separate server map rechecks 201 entries) before source hold release. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-05-v6/ROOT-RECOVERY-AFTER.private.json`. The next run requires exact authenticated staged Jest discovery, prompt propagation of child termination during bootstrap, and an authenticated backend timeout cleanup contract that preserves the failed outcome. These private successors are in progress alongside Android downstream identity/fixture repair and its separate Detox camera adapter. Current accepted native passes remain 0; T15 actual cold attempts remain 0/400. Product behavior, server provider baseline, copy and localization are unchanged.

## Current native recovery and integrated successors — 2026-10-05

Android V32 attempt `255d6d55f4b7f3f14350b220`, capture `8a8929809df997694c7ec24a`, completed its fresh build but stopped before camera entry when a live competing Gradle job appeared (PID 33429, start `Mon Oct 5 09:06:47 2026`). The ADB consumer guard retained original failed cleanup instead of stopping a shared service. After that job exited, root independently revalidated owned ADB PID 19505/start/command/group/listener, zero connected devices and zero native jobs, then signaled only that owned PID. Recovery proves all 88 recorded PID/start pairs absent, zero unknown queries, owned ports/caches/backend project/network absent, foreign resources preserved, and all 1,508 frozen source files unchanged. The retained owner marker and original failed receipts are preserved; this is recovery evidence, not native success.

The accepted iOS process-transition repair is now integrated in exactly four modified rows, including the real unsafe new-PGID regression control. The accepted backend close/approved-process-ledger repair is integrated in exactly two rows (production session helper and necessary iOS fixture adaptation); private instrumentation is excluded. Combined canonical controls pass 53/53, full TypeScript passes, and all six touched files pass strict lint with zero warnings and formatting. The existing iOS build `b95963f18d4a476549cb197f` was requalified read-only with binary hash `09357100fe530645f37835e42037ab2d5a81e2c7ff125d9dd001688589e3ccdb`. A fresh iOS public camera run is next; no current native pass or cold attempt is claimed. These are QA harness changes; product requirements, provider baseline, screen copy and localization are unchanged.

## Current Android capture/parent repair — 2026-10-05

The V31 failure's capture/outer-attempt distinction is repaired in the public attempt callback and its core. The callback validates the producer against the owned capture ID and separately requires the owner ID to equal the requested outer attempt; the core checks execution/capture identity and retains backend/owner cleanup bindings. A valid distinct-ID control fails against the preserved preimage and passes after the repair; crossed capture, owner and cleanup identities remain rejected. Canonical camera controls pass 29/29 and the six affected public caller controls pass. The exact two production rows and portable four-control test were integrated; original producer/observation and terminal-closure guards remain unchanged. The next fresh native replay is pending; native passes remain zero. Existing broader staging/collector fixture failures reported by the author are retained and require separate diagnosis rather than being labeled passing.

## Current component proof acceptance — 2026-10-05

Independent review accepted the four current rendered component mutation/clean-control proofs and reverified the full component run (7 suites, 60 tests, no artifact naming collisions). Review artifact: `/Users/eduwaldo/.codex/private-overlays/component-controlled-regressions-current-root-20261005/REVIEW.private.json`, SHA-256 `40166fa869cf695eb45242329c49dad25c6f90c289457a4fba7de860c62e2b86`. All current source/test/config and eight log hashes match. Every retired-assertion replacement ID is present in the 510-file inventory and its current receipt exists. T05–T08 component interaction/regression evidence is locally verified; applicable overall unit/lint and hosted gates remain separate. TC-304.1 remains explicitly uncovered. No current native pass, cold attempt, browser repeat or hosted proof is claimed.

## Current component controlled regressions — 2026-10-05

The missing historical replacement receipts have been superseded by current private-overlay product mutation proofs. Canonical app source stayed unchanged. Support pending-dismissal bypass fails 3 tests then restored source passes 12/12; role preselection bypass fails 6 then clean 6/6; incorrect TaskCard icon foreground fails both themes then clean 2/2; exercise confirmation without trimming fails all three locales then clean 9/9. The failed assertions match the deliberate defects, rather than a module/tool failure. All source, test, configuration and log hashes are retained in `.qa/artifacts/testing-modernization/component-controlled-regressions-current-root-20261005/controlled-regressions.json`; the assertion replacement ledger now references this receipt and preserves its historical references. The full current component run separately passed 60/60. No native, browser, provider or hosted credit follows. TC-304.1 remains an explicit existing gap; no product expectation was changed.

## Current camera attempt — 2026-10-05 Android V31

Fresh public Android Maestro camera attempt `4c1ed65afdead71df08c7380`, capture `ddb4fdf29242c06db2bac96e`, built successfully and reached manual submission. The previous training projection defect is repaired, but the next callback receipt check incorrectly compares inner capture identity with outer attempt identity. The original outcome remains `harness-blocked`, with zero accepted assertions or native passing credit. A minimal identity-binding repair is under private review; no failed artifact is promoted.

Root independently reread the published capture and proved cleanup passed: 165 PID/start pairs, zero survivors, zero unknown process queries, owned resources absent, foreign resources preserved. All 1,507 frozen client/server files remained unchanged; the root child is absent and source hold is released. iOS successor remains blocked by a canonical cleanup test conflict; a successor must retain unsafe-transition recovery coverage. T15 remains 0/400 actual cold attempts.

## Current checkpoint — 2026-10-05 camera projection and component isolation

The independently accepted Android camera projection fix is integrated in the canonical worktree. It binds every embedded connection to the before/pending SQL snapshots and allows only the authenticated target invite transition; unrelated training state remains unchanged. The original raw snapshots and receipt bindings are retained. Canonical focused controls pass 25/25, full TypeScript passes, and formatting passes. This is source validation, not a native passing receipt. The next fresh Android camera attempt remains pending.

The component Jest configuration now excludes `.qa/` artifact modules from its module crawl. The actual rerun passes all 7 suites and 60 tests without the previous artifact package naming collision warnings. No product behavior, screen copy, functional requirements, or localization changed. iOS process-transition repair remains pending independent acceptance. Current accepted native passes remain 0 and T15 cold attempts remain 0/400.

# Task Card: Testing modernization (BL-018 / D-218)

- Current component/declaration verification (2026-10-05): actual rendered Jest component suite passes7/7 suites and60/60 tests in8.341s against the canonical worktree. This refreshes rendered-interaction evidence only; it is not fresh controlled-regression, browser, native, cold or hosted proof. Both exact Android Maestro and iOS Detox camera selections pass the strict current declaration after adding the protected iOS runner-input helper to the generator source revision/owner mapping. Current camera blockers remain Android expected target-connection snapshot preservation and iOS stable launch-process identity/census; successors are private. Web clean-close V2 is rejected for concurrent-stop, contradictory-receipt, acquired-to-ready provenance and production-hook gaps; no transfer. T15 source rebase and T20 full criterion audit are running privately without resource acquisition. Product/provider/copy/localization unchanged. Evidence: `/Users/eduwaldo/.codex/private-overlays/component-current-root-20261005/RESULT.private.json` and `/Users/eduwaldo/.codex/private-overlays/ios-v27-root-integration-20261005/DECLARATION-CLOSURE.private.json`.

- iOS camera V5 runtime checkpoint (2026-10-05): source review/38 controls and current reusable build qualification pass. V4 preflight exposes missing source revision for the new protected-input helper; generator now declares that helper and exact iOS selection passes. Fresh V5 acquires owned simulator/backend/proxy/Expo and launches immutable staged Detox/Jest inputs, then fails process census and child-stop identity validation before public camera assertions. Original attempt18d37587c5313db918c9a2c8 remains harness-blocked with failed cleanup. Root verifies recorded PID/start/PGID and private launch paths, terminates only the four owned Detox group members, then independently verifies eight recorded PIDs/two known listeners/owned simulator/backend network absent, foreign simulator/containers preserved, and all1506 held files unchanged before release. Recovery does not promote original cleanup or native evidence. Private owner-identity successor assigned; Android unrelated-snapshot successor also pending. Product/provider/copy/localization unchanged. Evidence: primary `.qa/artifacts/testing-modernization/ios-detox-camera-public-live-2026-10-05-v5/ROOT-TERMINAL.private.json`.

- Fresh Android complete camera V30 checkpoint (2026-10-05): build passes in4m38s and actual UI reaches camera denial, manual submission and pending connection. Post-capture verification then rejects the expected new target connection as a change to the entire unrelated training snapshot. Original attempt7d39bd5eb5055e47c383474a/capture87d835626a1cc8a17d7d09b0 remains harness-blocked with0 public assertions. A private successor must permit only the expected target connection addition, separately verify pending connection, and reject training or foreign-connection mutations. Canonical44 Android/38 iOS source controls passed before dispatch. Root independent cleanup passes216 PID/start pairs,0 survivors/unknown queries; all1506 held files unchanged and hold released. No current camera/cold pass. Current iOS reusable build b95963f18d4a476549cb197f qualifies against reviewed source, next public run pending. Product/provider/copy/localization unchanged. Evidence: primary `.qa/artifacts/testing-modernization/android-maestro-camera-public-live-2026-10-05-v30/ROOT-TERMINAL.private.json`.

- Camera runtime checkpoint (2026-10-05): all44 Android and38 iOS canonical camera controls pass with combined TypeScript, strict ESLint and formatting gates. Android V28 stops before acquisition because the final QA documentation update made the declaration stale; refreshed exact public selection passes. Fresh V29 then acquires Android resources but backend acquisition fails before a manifest because private web-repair overlays under client `.qa/private` contain non-regular untracked symlinks. Root reproduces both exact fingerprint errors and preserves/relocates the offending v1/v2 overlays outside the worktree. Original V28/V29 failed receipts remain failed, no native camera/cold pass. Root independently finds seven recorded V29 PIDs and five reserved listeners absent, all1506 held files unchanged; foreign containers remain preserved. Backend startup requalification is in progress. Product behavior/provider/copy/localization unchanged. Evidence: primary `.qa/artifacts/testing-modernization/android-maestro-camera-public-live-2026-10-05-v29/ROOT-TERMINAL.private.json` and `/Users/eduwaldo/.codex/private-overlays/android-v29-backend-acquisition-root-20261005`.

- Reviewed camera fixes integrated (2026-10-05): root transfers the exact Android V32 three-file repair plus one canonical full-finalizer test and the exact iOS V27 sixteen-row repair after independent acceptance. Canonical iOS controls pass38/38. Combined full TypeScript, strict ESLint and project Prettier pass; inventory now509 files (445 client/64 server). Post-seal iOS review confirms only unused-variable removal and import ordering; All44 canonical Android controls pass; Android post-format review remains pending before public dispatch. Android terminal closure now derives the full canonical artifact graph and rejects missing, extra and duplicate paths. iOS launch uses protected staged inputs and fresh filesystem type checks. These are QA harness changes; no product/provider/copy/localization change or current native/cold credit. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-v32-root-integration-20261005` and `/Users/eduwaldo/.codex/private-overlays/ios-v27-root-integration-20261005`.

- Camera repair checkpoint (2026-10-05): independent V27 review accepts the exact sixteen-row iOS source candidate. Root transfers those rows with preserved preimages; canonical camera controls pass38/38 and full TypeScript passes. Strict lint finds an unused staged-input variable and test import ordering; root applies only those cleanup changes, with post-seal review and final gates pending. Android V32 exact four-row current-worktree composition compiles869 roots/1968 sources with0 diagnostics; semantic review remains pending before transfer and complete public V28 dispatch. Neither patch has current native or cold credit. Product behavior, backend provider baseline, copy and localization are unchanged. Evidence: `/Users/eduwaldo/.codex/private-overlays/ios-v27-root-integration-20261005` and `/Users/eduwaldo/.codex/private-overlays/android-v32-minimal-root-composition-20261005`.

- Fresh full browser runtime checkpoint (2026-10-05): after Docker Desktop recovery, all45 requested cases execute and pass with351 passing assertions across five scenarios/nine profiles. Client run `3f5a5e6117c8bd6e89502db1`, backend `60f2062483ea4788acf906fd`, exit0; all45 fixture seeds complete. Root independently verifies56 recorded process identities,3 groups and3 known listeners absent, owned container/network and backend private fixtures/credentials removed, foreign running containers preserved, and all1501 held client/server files unchanged before hold release. A sequential fresh passing repeat remains Pending. Original matrix1 fixture timeout and matrix2 Docker-prerequisite failure remain failed; restored Docker availability does not establish matrix1 historical cause. Proof: primary `.qa/artifacts/testing-modernization/web-full-current-root-20261005/matrix3/ROOT-TERMINAL.private.json`. No native/cold or product/copy/localization credit.

- Root actual filesystem mutation checkpoint (2026-10-05): a separate owned-temporary-directory harness delegates original filesystem calls and applies real topology/link/file substitutions. V25 accepts all4 mutations, including two reads of outside synthetic bytes. V26 rejects all4 eventually but still reads substituted outside bytes in both directory/file cases; only2/4 satisfy the required rejection-before-read policy. This differs from the earlier simulated `/virtual/root` controls, which remain labeled mocked-FS evidence. V27 must reject all4 and perform zero outside reads before source acceptance. Harness SHA `e15f59548d1f8648850ae8fb15dd82ee2f4a281a63b80377a47b322e1b0d08c8`; proof: primary `.qa/artifacts/testing-modernization/ios-treehash-real-mutation-root-20261005/SUMMARY.private.json`. All temporary roots are cleaned; no native/backend/device/port or product/copy/localization change.

- Fresh complete browser matrix checkpoint (2026-10-05): all45 requested cases stop before browser execution during fixture preparation. Client run `d467aed1c7787ab0ee26ce47`, owned backend `ae225f0feada858ba53e9e25`, exit2;17 seed requests complete before the server reports `write CONNECT_TIMEOUT` on its disposable Postgres port. Original client cleanup remains failed-recovery-ledger-retained; backend session cleanup is cleaned. Root independently verifies all recorded processes, DB/proxy listeners, owned container/network and private credentials absent, foreign containers preserved, and1300 client/201 server hashes unchanged before source-hold release. No browser/native/cold pass is claimed. Connection-lifecycle investigation is assigned; a fresh full matrix and sequential repeat remain Pending. Proof: primary `.qa/artifacts/testing-modernization/web-full-current-root-20261005/ROOT-TERMINAL.private.json`. Product/copy/localization unchanged.

- Current complete-camera dispatch blockers (2026-10-05): independent V31 review confirms SQL retention/API identity checks and 10/10 private controls, but rejects terminal acceptance because its exact-set check covers only reserved SQL sidecars. The finalizer must derive the complete producer/staging artifact map and reject missing or extra non-SQL files; actual duplicate and full-finalizer omission/extra controls are required. V32 is assigned privately; V31 is untransferred and Android V28 remains prepared, undispatched. Independent iOS V26 review rejects stale filesystem entry types and verification after Detox/Jest module loading; V27 must add fresh type checks and protected launch inputs with dynamic mutation controls. Root complete V26 sixteen-row composition compiles with 0 diagnostics (872 roots/1980 sources), but this source result does not override semantic rejection. Canonical Android ledger/fixture controls remain40/40, inventory505, native inventory and test-impact checks pass. No native camera/cold credit or product/copy/localization change. Review evidence: `/tmp/android-v31-review-checkpoint-20261005.json` and `/Users/eduwaldo/.codex/private-overlays/ios-v26-semantic-independent-review-20261005/REVIEW.private.json`.

- Independent T18 review requires V9 after canonical source gates passed: protected preflight restoration failure exits before compact failure receipt finalization, and exported relocation metadata validation does not independently re-read artifacts. The three integrated rows remain unpromoted with0 hosted dispatches; failure-path repair/controls are in progress. Proof: `t18-minimal-root-integration-2026-10-04-v1/ROOT-REVIEW.private.json`; review SHA `d1122f65ccf73a04e3b0b31d0f95fa9dad056fecf86792d93bd2464a2f44b8b3`. Camera SQL-root repair must also retain authenticated parent bytes before backend teardown: server cleanup intentionally deletes snapshot private files, so changing the live root alone cannot establish post-cleanup public qualification. Original cleanup policy remains authoritative; scoped byte-preserving retention/provenance and post-cleanup re-read controls are required. No new native/cold/hosted or product/copy/localization credit.

- Root verifies V21 iOS candidate all12 source/preimage rows and full current-Q two-delta compilation (859 roots/1967 sources/0 diagnostics), then rejects transfer. Owner and producer both bootstrap; the child always relaunches and signs in, so the second bootstrap can wait on a missing login screen. Startup/cleanup census calls also omit original deadline/cancellation options and lack unknown/foreign startup rejection controls. Independent review confirms both P1 findings; V22 must carry a complete single-bootstrap readiness/protocol contract and bounded census controls. Proof: `ios-camera-v21-root-checkpoint-2026-10-04-v1/ROOT-REVIEW.private.json`; review SHA `654167186b353879c1d2246e0af9dd4e2616544ec52842326422a6ba7f44b593`. V21 remains private/untransferred; no new native/cold credit or product/copy/localization change.

- Root integrates exactly3 protected manual workflow rows after exact-preimage verification and a fresh full current-Q composition (859 roots/1967 sources/0 diagnostics), excluding stale historical closure files. The lane requires explicit private-restoration build source, exact relocation paths/receipt hashes and qualified native evidence before success publication; build ID alone fails. Canonical7/7 workflow controls, full-Q TypeScript, strict changed-TypeScript lint, YAML parse and formatting pass. Proof: `t18-minimal-root-integration-2026-10-04-v1/VALIDATION.private.json`. No hosted dispatch/native run or lane promotion occurred; hosted acceptance and T19 gates remain Pending. Product behavior/copy/localization unchanged.

- Fresh Android V27 advances beyond the analytics transport guard, then fails SQL evidence publication with ENOENT for `connection-snapshot-native-entry-android-connection-snapshot-6.private.json` under its capture directory. Capture `06283563b4647f0c33d63c42`, attempt `b5e1aa50a6dcd6fed354bea0` remain failed. Root independent cleanup passes, all281 held hashes unchanged, source hold released; receipt-path/root-binding investigation is in progress. Proof: `android-maestro-camera-public-live-2026-10-04-v27/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. No complete camera/cold credit or product/copy/localization change.

- Root integrates the exact analytics route repair after V26 actual transport and authoritative source establish post-fence `POST /analytics/events` responses202 around the single invite POST201. The verifier accepts only analytics POST202 and retains unknown-route, normal-response, duplicate-invite, ownership and fence checks. Five canonical rows include a portable six-case negative control;40/40 camera controls, full-Q TypeScript, strict changed-file lint and formatting pass. Proof: `android-analytics-v2-root-integration-2026-10-04-v1/VALIDATION.private.json`. The failed V26 did not publish numeric fences;36→40 is explicitly reconstructed, and the next qualified receipt must carry actual producer fences. Fresh native qualification remains pending, cold attempts0; product behavior/copy/localization unchanged.

- Fresh Android V26 passes the former equal-fence assertion and reaches the explicit closed-route guard, which fails with `Android camera post-fence history contains an undeclared route`. Original capture `41d15fc53344b5f0879b1a20` and attempt `f28bf6557babf7de550a89fe` remain failed. Independent cleanup passes and all281 frozen hashes are unchanged before hold release. Exact route provenance and a minimal repair are in progress; no route widening is integrated or complete camera/cold credit claimed. Proof: `android-maestro-camera-public-live-2026-10-04-v26/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`.

- Fresh iOS Detox camera V3 gets past the Metro port guard but fails at premature app-container validation while its child outcome remains unknown. Original run `fc7d26fd0cc098a958847cb1` and partial cleanup failure remain preserved. Root independently detects4 surviving recorded Detox process identities, verifies each PID/start time, sends SIGTERM, and then verifies absence of all6 recorded pairs, owned simulator/container/declared ports/cache, preserved foreign device state and665 unchanged source hashes. The separate recovery does not promote original cleanup or camera qualification. Lifecycle ordering and child-tree cleanup repairs are in progress. Proof: `ios-detox-camera-public-live-2026-10-04-v3/ROOT-RECOVERY-SIGNALS.private.json` and `ROOT-RESOURCE-ABSENCE-AFTER-RECOVERY.private.json`. Cold attempts remain0; product behavior/copy/localization are unchanged.

- Root identifies and repairs the original Android V25 post-capture assertion: cameraBoundary copied the proxy counter and cloned history once, so producer before/through fences were equal despite the actual POST. Only2 live getters are added, preserving the same owned proxy, quiescence, ownership, deadline, identity and closed-route validation. The old seam reproduces the exact unlabeled assertion; the live seam passes the real transport verifier. Root ports the private control to repository-relative paths. Canonical34/34 camera/causality/observation/sampler controls, full-Q TypeScript, strict lint and formatting pass; independent review accepts capture hash `768d52504f1d6e481cf847e42ce154522b51a9bdaf7e48224cd5eb4b75d588f4`. Analytics allowlist changes are excluded because their location relative to the true pre-submit fence is unproven. Proof: `android-live-proxy-v2-root-integration-2026-10-04-v1/VALIDATION.private.json`. Fresh complete native qualification is next; cold attempts remain0. Product behavior/copy/localization are unchanged.

- Fresh iOS Detox camera V2 acquires the owned resources but its child exits1 before app launch: redundant `DETOX_IOS_METRO_PORT=63032` forces shared Metro63032 through the49151 guard. Root integrates only2 V20 delta rows: explicitly clear that inherited override, retaining marked iOS shared63032, exact Expo/target/API identity and the Android ceiling. Canonical15/15 config/acquisition controls, full-Q TypeScript, strict lint and formatting pass; conditional review constraints are met by exact2-row transfer and fresh current-Q composition, with the packet source-root mismatch explicitly recorded. Original run `0e67e2af18bfbdd4f640d162` stays failed, including its partial-cleanup classification. Root separately verifies6 recorded process/start pairs absent, owned simulator/container/declared ports/cache absent, foreign simulator state preserved, and665 source hashes unchanged; the source hold is released without camera or cleanup promotion. Proof: `ios-detox-camera-public-live-2026-10-04-v2/ROOT-RESOURCE-ABSENCE.private.json` and `ios-camera-v20-root-integration-2026-10-04-v1/VALIDATION.private.json`. New native qualification is required; cold attempts remain0. Product behavior/copy/localization are unchanged.

- Root transfers only the12 reviewed iOS Detox camera V19 source/test rows, excluding all stale composition files outside the allowlist. The canonical output namespace, typed partial-acquisition evidence, original lifecycle deadline, resource-bound validation failures and explicitly lexical artifact-path provenance are integrated. Fresh full current-Q composition, canonical59/59 lifecycle/ownership controls, strict lint and formatting pass. Proof: `ios-camera-v19-root-integration-2026-10-04-v1/TRANSFER.private.json` and `VALIDATION.private.json`. Native camera qualification is still pending; no product behavior/copy/localization change or cold-attempt credit is introduced.

- Fresh Android camera V25 validates the sampler repair natively: fresh build passes4m28s, all3 entry assertions complete, and five sampler observations pass without a first cause. Camera entry, permission prompt, denial guidance, manual entry and exact pending frames are captured; the owned trace records one POST38 returning201/forwarded in25.36ms. The producer callback then fails an unlabeled assertion before qualification, so public result stays `runtime-post-capture-failed`. Root investigates retained post-capture evidence, preserving the original failure. Independent cleanup passes and all281 held hashes remain unchanged before hold release. Attempt `d91888d0ef0e3145c3f1ce10`, capture `252b5ffeaf384007547b2bec`; proof: `android-maestro-camera-public-live-2026-10-04-v25/ROOT-STAGE-RESULT.private.json`, `ROOT-TERMINAL.private.json`, `ROOT-CLEANUP.private.json`. Complete camera and cold attempts remain0; product behavior/copy/localization are unchanged.

- Root integrates the minimal V24 startup-sampler repair: strict owned census now uses bounded Darwin argv settling within the original absolute command/whole-run deadline and original cancellation signal. Unknown/foreign ownership and the failed-sampler downgrade remain fail-closed; no Maestro retry or extra UI action is added. Canonical28/28 ownership/sampler controls, full-Q TypeScript, strict lint and formatting pass; independent review accepts exact production hash `712bbac1e9f705c22bacfa7f2138f6c7d3d6a43b58c0fb95849f11f84a0b0433`. Proof: `android-startup-census-v1-root-integration-2026-10-04-v1/VALIDATION.private.json`. Fresh complete Android camera qualification is next; cold attempts remain0. Product behavior/copy/localization are unchanged.

- Fresh Android camera V24 stops during entry readiness before camera execution. All three actual Maestro sign-in assertions complete and the child exits0, but the owned command is classified harness-blocked; command census records an unavailable argv observation during child churn. Root retains the original failure and investigates the classification without treating unknown ownership as passing. Independent cleanup passes, all281 held source hashes remain unchanged, and the source hold is released. Attempt `273f38ee13e3c4f2c555e10d`, capture `86dee211e7fefb3d80d915c2`; proof: `android-maestro-camera-public-live-2026-10-04-v24/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. No complete camera or cold attempt is credited. The pending-guidance repair is independently accepted; product behavior/copy/localization remain unchanged.

## Current resume state (2026-10-04)

- Fresh Android camera V23 validates the proxy repair with exactly one POST38 returning201/forwarded in33.72ms and captures the exact pending card. It exposes a remaining verifier mismatch: current app puts connection ID and localized guidance on the same Text node, while the observer only searches descendants. Root repairs self-or-descendant matching inside the unique exact-ID node, retaining app scope, visibility, enabled state, locale and ambiguity rejection. Actual retained hierarchy fails before and passes after; canonical26/26, full-Q TypeScript, strict lint and formatting pass. Original attempt `bd64d088da998fbb08b61d4c`, capture `fe88e3e663fe7b230f5e451a`, failure remain unchanged. Independent cleanup passes193 PID/start pairs, all281 source hashes stay unchanged before hold release. Proof: `android-maestro-camera-public-live-2026-10-04-v23/ROOT-TERMINAL.private.json`, `ROOT-SUBMIT-TRANSPORT.private.json`, and `android-pending-guidance-self-root-repair-2026-10-04-v1/VALIDATION.private.json`. This is stage/regression evidence; a fresh complete camera run is still required, with0 cold attempts. Product behavior/copy/localization are unchanged.

- Root integrates the minimal owned proxy body-lifecycle repair after a delayed-ownership HTTP reproduction fails503 on original source and passes on repaired source. Request stays paused while ownership is checked; terminal listeners do not consume it, then native body collection is attached immediately before one upstream pipe. Ownership/deadline/body-size/hash/descriptor checks remain intact. Canonical14/14 lifecycle/auth controls, full-Q TypeScript, strict changed-file lint and formatting pass. V22 original503 and source receipts are preserved; actual native qualification remains pending. Proof: `proxy-body-v1-root-integration-2026-10-04-v1/TRANSFER.private.json` and `VALIDATION.private.json`. No complete camera/cold pass or product behavior/copy/localization change is credited.

- Root T15V3 filtered actual18-file production/test closure fails full-Q compilation16 diagnostics: required dispatcher changes are absent from the packet transfer list, and existing camera public-dispatch callers lack new mandatory identity arguments. Root excludes raw private fixtures, stale camera keyboard source, logs and copied inventory, requests complete sealed V4 closure, and leaves V3 untransferred. Proof: `t15-matrix-v3-root-checkpoint-2026-10-04-v1/compile.private.log`. Original20-cell/400-attempt scope remains unchanged with0 actual cold attempts.

- Fresh Android camera V22 validates actual keyboard dismissal followed by one completed Connect tap. The owned trace now records exactly one invite-submission POST38, returning503/upstream-failed in3.147ms; the failure screenshot shows localized generic submit error and no pending card. This proves progress beyond V21 zero-request failure, but complete camera assertions remain blocked. Root investigates the proxy asynchronous ownership/request-body collection boundary; historical cause is not yet proved. Attempt `dba41a221107174a1e41d0c6`, capture `df30336712a60a0cb8b77fa5`, original failure are preserved. Independent cleanup passes151 PID/start pairs, all281 hashes remain unchanged, and source hold is released. Proof: `android-maestro-camera-public-live-2026-10-04-v22/ROOT-TERMINAL.private.json`, `ROOT-SUBMIT-TRANSPORT.private.json`, and `ROOT-CLEANUP.private.json`. No complete camera/cold pass or product change is credited.

- Root verifies private iOS Detox camera V17 all12 current-Q preimages/candidate hashes and full-Q TypeScript855 roots/1963 sources/0 diagnostics. Independent semantic review requires preserving native acquisition error paths, unknown null/null child outcomes, lifecycle-fenced partial verifier reads, and resource-bound validation failure evidence before transfer. Root requests V18; V17 remains private, and no new native qualification is claimed. Proof: `ios-camera-v17-root-checkpoint-2026-10-04-v1/ROOT-COMPOSITION.private.json`; review SHA `22b4c75adb070e68885efe5d88c70058ee95d93978baaf4a76184c4274ccc0bf`. Product behavior/copy/localization are unchanged.

- Root implements the minimal Android camera keyboard V4 correction: `hideKeyboard` before exactly one Connect tap, retaining bounded pending-prefix scroll and original post-submit exact UI/API/SQL evidence. Canonical50/50 controls, full-Q TypeScript, strict changed-file lint, formatting and installed Maestro syntax checks pass. V21 zero-submit trace and original blocked receipt remain preserved. Fresh Android V22 is prepared for actual qualification; no pass or cold credit is inferred from source controls. Proof: `android-camera-keyboard-v4-root-integration-2026-10-04-v1/TRANSFER.private.json` and `VALIDATION.private.json`. Product behavior, copy and localization are unchanged.

- Root reads the actual V21 protected proxy trace:36 observations and zero path-hash matches for `/connections/invite-submissions`. The completed UI tap therefore did not issue the submission request. Current `DsScreen` renders a ScrollView without `keyboardShouldPersistTaps`, and the professionals screen supplies no override; the failure screenshot shows keyboard dismissed while code remains. Root requests the established harness `hideKeyboard` action before exactly one Connect tap, retaining bounded pending scroll and exact UI/API/SQL validation. Proof: `android-maestro-camera-public-live-2026-10-04-v21/ROOT-SUBMIT-TRANSPORT.private.json` binds original trace and current app/scaffold hashes. A product finding remains unconfirmed pending repeat/control; no T17 credit, native pass or cold attempt is added.

- Fresh Android camera V21 runs the integrated causal V3 producer through build, denial and manual entry. Actual Maestro records exactly one Connect tap completed, then the bounded pending-prefix scroll fails; the failure screenshot still shows entered invite code and enabled Connect with no pending card. Root treats keyboard dismissal consuming the tap as a hypothesis requiring actual proxy/parent-scroll evidence, and requests a private V4 investigation instead of a blind second submit. Attempt `09557cedf97c4c6d97767ac3`, capture `2ece4c7aadd6912556f4ea1e`, original failure and screenshots are preserved. Independent cleanup passes, all281 source hashes remain unchanged and hold is released. Proof: `android-maestro-camera-public-live-2026-10-04-v21/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. No complete camera or cold pass is added. Product behavior/copy/localization are unchanged.

- Root integrates the sealed four-file Android camera causal V3 harness repair: actual zero pre-submit witness, one owned UI Connect action, bounded pending-prefix scroll, post-submit SQL target ID, then exact-ID frame capture and unchanged UI/API/SQL/isolation validation. Full-Q TypeScript, strict changed-file lint and formatting pass. Canonical50/50 controls pass after declaration regeneration; the initial46/50 stale-governing-input failures remain preserved. Independent supplementary review is pending and fresh Android V21 is prepared, not dispatched. Proof: `android-camera-causal-v3-root-integration-2026-10-04-v1/TRANSFER.private.json` and `VALIDATION.private.json`. No actual camera/cold pass is added. Product behavior, copy and localization are unchanged.

- Independent semantic review blocks private iOS Detox camera V16 despite green full-Q TypeScript: throwing backend acquisition loses typed process/recovery facts, the partial ledger differs from the existing verifier contract, aggregate failure evidence is incomplete, and acquisition sequence can omit resources created before validation failure. Root requests a V17 successor with genuine injected failure controls; V16 remains untransferred and no native resources are acquired. Namespace and original aggregate deadline fixes are retained. Proof: `ios-camera-v16-root-checkpoint-2026-10-04-v1/ROOT-COMPOSITION.private.json`; independent review SHA `cba819227ae10f1c3c8df1aceb68e14be2ed66d87a824d9bf367b0df0b44c66f`. No camera/cold pass or product behavior change is credited.

- Root verifies Android camera causal V2 against all4 exact current-Q preimages/candidate hashes and passes full-Q TypeScript854 roots/1962 sources/0 diagnostics. V2 remains private: review identifies a visible-only pending wait before scrolling while the manual keyboard can remain open. A frozen V3 successor is requested to perform one UI Connect tap, bounded genuine pending-prefix scroll, post-submit SQL lookup, and exact-ID pending frame. Original V20 failure and V2 seals remain unchanged. No device run or cold credit is added. Proof: `android-camera-causal-v2-root-checkpoint-2026-10-04-v1/ROOT-COMPOSITION.private.json`. Harness-only scope requires no product copy or localization changes.

- Root verifies the private iOS Detox camera V16 successor against all8 exact current-Q preimages and candidate hashes; the full current-Q TypeScript overlay passes854 roots/1962 sources/0 diagnostics. Independent semantic review and guarded additive integration remain pending. This is source-only validation with no new native camera or cold credit. Android next-run blocker remains the actual V20 pre-submit pending-row requirement until the producer successor is integrated and validated. Proof: `ios-camera-v16-root-checkpoint-2026-10-04-v1/ROOT-COMPOSITION.private.json`. Product behavior, copy and localization are unchanged.

- Root accepts MCP V3 test-only readiness corrections: EOF failure publication is awaited explicitly, startup/request deadline semantics use an isolated clock/control, and cancellation/late-response cases wait for actual protocol events. Canonical suite43/43, full TypeScript, strict lint and formatting pass; independent process inspection finds no matching test fixtures. Production source remains unchanged, and installed Maestro V3 protocol/socket cleanup evidence retains its separate actual scope. Original failed V1/V2 runs are preserved. Proof: `t16-mcp-fixture-v3-root-integration-2026-10-04-v1/VALIDATION.private.json`. T16 device exploration and all400 cold attempts remain pending; no product behavior, copy or localization changes are introduced.

- Fresh Android camera V20 builds successfully in4m03s without a census failure, passes actual bounded invite scroll/parser, camera entry, system prompt, denial guidance, and manual code entry. It then exposes a causal producer bug: `native-camera-android-producer.ts` reads the pending snapshot and requires a target connection before executing the UI Connect action. Zero rows before submission are expected; manual submission never runs. Original attempt `a5e95e2dea388e84aa77565d`, capture `f1a0f6a2e11e47f166a53897`, and failure are retained. Root reviews actual denial/manual screenshots, independent cleanup passes189 PID/start pairs with no survivors, unknown queries or foreign changes, and all281 source hashes remain unchanged before hold release. A private successor must submit once through the owned UI, wait for pending state, then bind actual UI/API/SQL proof; no pre-seeding or direct backend substitute is allowed. Proof: `android-maestro-camera-public-live-2026-10-04-v20/ROOT-TERMINAL.private.json`, `ROOT-CLEANUP.private.json`, and `ROOT-INVITE-STAGE.private.json`. No complete camera or cold pass is credited; product behavior, copy and localization are unchanged.

- Root transfers MCP V2 test-only corrections: temporary roots are canonicalized, byte-limit controls use unique valid-sized envelopes, the current protected spool reader is exercised, and sessions close before directory removal. Both original raw-transcript failures pass in the canonical run, which terminates with41/43 passing and two separate timing failures (EOF-partial evidence ordering and startup process-ownership deadline); no complete-suite pass is claimed. Root full TypeScript, strict lint and formatting pass, and no matching test fixtures remain. Private V3 deterministic correction is assigned. The installed Maestro V3 lifecycle receipt remains independently passing in its original scope. Proof: `t16-mcp-fixture-v2-root-integration-2026-10-04-v1/VALIDATION.private.json`. No product behavior, copy or localization changes are introduced.

- Current-Q iOS camera V15 overlay compiles with0 diagnostics across854 roots/1962 source files, closing the V14 NODE_ENV type error with a validated allowlist. Root source review then finds a guaranteed default cleanup mismatch: the owner receives `native-pilot-attempts/<id>`, while the independent iOS cleanup verifier requires `native-pilot/<id>`. No source transfer or native run is performed; V16 must establish an explicit authenticated namespace contract or a genuine separately bound capture without relaxing arbitrary-path guards. Android session V13 separately compiles16 overlays against862 roots/1970 sources with0 diagnostics; authentic closure tests and independent review remain required. Proof: `ios-camera-v15-root-checkpoint-2026-10-04-v1/ROOT-COMPOSITION.private.json` and `android-session-v13-root-checkpoint-2026-10-04-v1/ROOT-COMPOSITION.private.json`. These are source checks, with no camera assertion or cold credit. Product behavior, copy and localization are unchanged.

- Root integrates the MCP close-order repair and executes a fresh installed Maestro2.6.1 protocol probe V3. Initialize/tools-list advertises9 tools; actual owned socket observations move from1 before EOF to0 after cleanup, the server exits0, independent PID/start/group absence passes, and source hashes remain unchanged. Original V2 unknown socket evidence is retained. This proves tool-server lifecycle only: no device tool action, T16 target observation or cold credit. Full canonical TypeScript, strict changed-file lint and formatting pass. The broader MCP unit suite exposes two raw-transcript fixture/contract failures whose origin remains under review and leaked test fixtures; root stops only authenticated owned fixtures and retains the failed/interrupted run while private correction proceeds. Proof: `maestro-mcp-current-tools-root-live-2026-10-04-v3/RESULT.private.json`, `ROOT-TERMINAL.private.json`, and `t16-mcp-close-race-root-integration-2026-10-04-v1/TRANSFER.private.json`. No product behavior, copy or localization changes are introduced.

- Fresh public Android camera V19 stops before camera assertions: the original android-build process census query times out after 5000 ms with empty output and SIGTERM. The command remains harness-blocked even though later build output exists; no success is inferred. Attempt `41eb53d8bb616bc2f7121a26`, capture `219d11626e9eb4269059617f`, and the original failure record are preserved. Root independent cleanup passes, all281 frozen source hashes are unchanged, and the hold is released. The V24 invite repair remains awaiting actual Android post-scroll qualification. Proof: `android-maestro-camera-public-live-2026-10-04-v19/ROOT-TERMINAL.private.json`, `ROOT-CLEANUP.private.json`, and the original capture census-failure record. Native camera credit and actual cold attempts remain0. Private approved iOS acquisition and process-census investigations continue; no product behavior, copy or localization changes are introduced.

- Root guarded-transfers Android invite readiness V24: camera/connection setup waits for exact coach home, performs a bounded DOWN scroll to the invite value, then retains the original coach frame/command/actor provenance. The Android callback uses its explicit platform contract and requires matching parsed codes in populated text attributes. Portable minimal synthetic fixture/tests replace the V23 private raw-path dependencies. Root full-Q overlay compilation and41 current camera/connection controls pass before transfer; installed Maestro2.6.1 check-syntax accepts both wait/scroll commands. Root verifies the historical post-scroll capture3b4da098 is iOS, correcting V23 attribution without changing its seal; actual Android post-scroll qualification remains pending fresh publicV19. Proof: `android-camera-invite-v24-root-checkpoint-2026-10-04-v1/SNAPSHOT.private.json` and `android-camera-invite-v24-root-integration-2026-10-04-v1/TRANSFER.private.json`. No product behavior, copy or localization changes are introduced.

- Actual pinned Maestro MCP handshake/tools-list probe succeeds and advertises all9 expected tools. The server exits0 and independent PID/start/group inspection finds no survivors, but the original close receipt keeps socket absence unknown because stdin closure precedes its PID census and the JVM exits before inspection. This is tool-surface evidence only, not T16 target qualification or observation; close-order repair is assigned without rewriting the receipt. Proof: `maestro-mcp-current-tools-root-live-2026-10-04-v2/RESULT.private.json` and `ROOT-TERMINAL.private.json`. A separate T15 read-only audit confirms the complete20-cell declaration still lacks shared production owner/reset/accounting routes; selection-aware registry and one terminal row per requested slot are assigned. All400 actual cold attempts and five controlled-regression bundles remain required, and actual cold credit remains0. No product behavior or localization changes are introduced.

- Fresh public iOS Detox camera V1 accepts the current qualified build but stops before native acquisition: the public runner and camera owner both publish `native-host-census.private.json` exclusively into the same attempt root, producing EEXIST. Attempt `00472095d60c1174b09896c8` and its original failed receipt remain unchanged. Root verifies the exact pre-acquisition boundary: only6 attempt entries, empty owner stage, capture callback count0, null backend/device identity and no resource ownership ledgers; all665 held source hashes are unchanged before release. The owner needs a distinct protected census location while preserving a fresh contention check; private repair is assigned. Proof: `ios-detox-camera-public-live-2026-10-04-v1/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. No iOS camera assertion or cold attempt is credited. Product behavior, copy and localization are unchanged.

- Root guarded-transfers the independently reviewed V20 fixture maintenance without changing production guards. The formerly failing runtime-dispatch fixtures now include complete primary/isolation provenance and all14 helper hashes; crossed actor/scope negatives reject before staging. The current checkout closure/runtime/inventory cohort passes25/25, full TypeScript, strict lint and formatting pass. The prior4 fixture failures are closed; actual native camera execution remains governed by its separate receipts. Proof: `android-camera-runtime-v20-root-integration-2026-10-04-v1/VALIDATION.private.json`. No product behavior or localization changes are introduced.

- Fresh public Android V18 builds successfully in2m32s and passes the actual camera permission prompt, denial readiness and repaired V21 denied-tree observation. It then fails before manual submission because the retained coach-home hierarchy contains no `pro.home.inviteCodeValue`; the callback uses the legacy invite reader. Current UI location/readiness must be established before changing the reader or journey. Attempt `1030da1417e0b9650ea9afee`, capture `30b86f76be19da9676d96475`, remains harness-blocked. Independent cleanup passes151 PID/start pairs, no survivors/unknown queries, and all281 source hashes remain unchanged before release. Proof: `android-maestro-camera-public-live-2026-10-04-v18/ROOT-TERMINAL.private.json`, `ROOT-CLEANUP.private.json`, and actual private coach/denied hierarchies. Manual/pending assertions and full camera qualification remain pending; native/cold credit remains0. Private additive investigation is assigned; no product behavior or copy change is established.

- Root integrates independently reviewed Android observation V21: one exact build-bound app root scopes denied/manual/pending controls, and missing visibility metadata requires valid positive bounds plus enabled state. The actual V17 prompt, entry and denied trees pass; foreign, duplicate, disabled and explicit invisible mutations reject. Full-Q overlay compilation and31 current camera controls pass before transfer; final canonical checks precede public V18 dispatch. Frozen author metadata incorrectly reported the raw tree unavailable; the separate root checkpoint preserves its actual hash without rewriting the seal. Camera journey and cold qualification remain pending. Proof: `android-camera-observation-v21-root-checkpoint-2026-10-04-v1/` and `android-camera-observation-v21-root-integration-2026-10-04-v1/TRANSFER.private.json`. No product behavior, copy or localization changes are introduced.

- Fresh owned iOS entry build `b95963f18d4a476549cb197f` completes successfully against current app source. Root reviews the unobscured sign-in screenshot and exact selectors; both production reusable-build and Detox build loaders qualify the Debug simulator binary. Independent cleanup passes38 PID/start pairs with no survivors or missing foreign devices, and all649 held files remain unchanged before release. The build prerequisite for the source-accepted iOS Detox camera route is now satisfied; camera assertions and cold-attempt qualification remain pending. Proof: `ios-current-entry-build-root-live-2026-10-04-v2/ROOT-TERMINAL.private.json`, `ROOT-ENTRY-REVIEW.private.json`, `ROOT-CLEANUP.private.json`, and both loader logs. This is entry/build evidence only; historical camera receipts retain their original source scope. No product behavior or localization changes are introduced.

- Fresh public V17 builds in1m42s, installs, passes real camera prompt readiness and hierarchy qualification, taps denial and passes guidance readiness. It then fails app-frame observation because the actual Maestro hierarchy supplies exact guidance text/resource ID plus bounds/enabled state, but omits `visible` and app `package`; the verifier expects those attributes. The same app-package assumptions would block manual/pending frames. A successor must support the actual app-frame format with explicit bounded visibility and original app-identity evidence, rather than infer identity from arbitrary text. Original attempt `20eb58cb08d23782d77e9926`, capture `eb05f6e0dcdace061663220f`, remains harness-blocked. Independent cleanup passes118 PID/start pairs with no survivors/unknown queries; all281 held source hashes are unchanged and the hold is released. Proof: `android-maestro-camera-public-live-2026-10-04-v17/ROOT-TERMINAL.private.json`, `ROOT-CLEANUP.private.json`, and actual private denied hierarchy. Native/cold passes remain0; actual expected guidance is present, so no product-copy fix is established.

- Root guarded-transfers the three changed V19 hierarchy/descriptor repair files after independent wiring review: bounded regexes remain Maestro readiness inputs, captured prompt qualification resolves concrete controller IDs, and those IDs bind the logical frame descriptor through its physical command label. Actual V16 hierarchy fails the old literal gate and passes the new exported check; full current-Q composition has851 roots/1,959 sources and zero diagnostics. Canonical camera controls pass27/27, full TypeScript and strict lint/format pass. Broader checkout cohort has20 passes and4 fixture failures: unchanged producer validation requires primary fixture identities omitted by the old runtime-dispatch fixture; a separate private fixture maintenance packet is assigned. All11 helper-closure and5 inventory controls pass. Fresh public V17 is next after inventory/preflight; native/cold passes remain0. Proof: `android-camera-hierarchy-v19-root-integration-2026-10-04-v1/VALIDATION.private.json`, actual-V16 probe, and retained broader-cohort failure log. No product behavior or localization change is introduced.

- Root checks all five cached iOS entry-qualified builds through the production `loadReusableIosBuild` validator against current source identity; each is rejected as stale or unknown. A fresh owned iOS build and entry qualification are required before reusing a build for the source-accepted Detox camera route. This read-only check acquires no native resources. Proof: `ios-detox-camera-v13-root-integration-2026-10-04-v1/BUILD-ELIGIBILITY.private.json`. Native/cold passes remain0.

- Fresh public V16 builds in1m32s, installs, reaches camera entry and passes both actual system-prompt readiness assertions. It then fails the hierarchy verifier because bounded Maestro readiness regexes are treated as literal required resource IDs (`Android actual hierarchy lacks exact required selector`). A successor must separate prompt readiness alternatives from exact captured hierarchy/descriptor qualification while preserving same-controller, app-label, locale and actionability checks. Original attempt `f34676c350416cc51b7637a7`, capture `69512045e419ad31cf5797a9`, remains harness-blocked. Independent cleanup passes104 PID/start pairs with no survivors/unknown queries; all281 held source hashes are unchanged and the hold is released. Proof: `android-maestro-camera-public-live-2026-10-04-v16/ROOT-TERMINAL.private.json`, `ROOT-CLEANUP.private.json`, and actual private prompt readiness/hierarchy artifacts. Native/cold passes remain0.

- Root guarded-transfers the independently accepted Android prompt V18 repair: readiness waits for bounded AOSP/Google PermissionController message and deny IDs; captured controls must match the expected app label, locale, controller subtree and actionability. Root reproduces the candidate V16 regex failure and verifies four actual ID matches plus six rejected lookalikes after repair. Both source tests use a sanitized portable fixture; full V15 commands/screenshots stay private. Canonical controls pass21/21, full TypeScript and strict changed-file lint/format pass; private actual V15 probe passes independently. Fresh public V16 is next after regenerated inventory and source-hold preflight. Native/cold passes remain0. Proof: `android-camera-prompt-v18-root-integration-2026-10-04-v1/VALIDATION.private.json`. No product behavior or localization changes are introduced.

- Root independently reviews and guarded-transfers iOS Detox camera V13, preserving the original lifecycle deadline and descriptor-bound worker readback. Canonical route controls pass38/38; shared Android camera/writer controls pass76/76 and selective execution controls pass33/33. Full TypeScript, strict lint and formatting pass. The new E2E spec is registered with the owned camera fixture profile as local-only (`ci:false`); the CI-promotion negative control rejects it. This accepts source integration only: iOS native camera qualification and all cold attempts remain0. Android V15’s system-prompt readiness repair remains the immediate next-run dependency. Proof: `ios-detox-camera-v13-root-integration-2026-10-04-v1/VALIDATION.private.json`. No product behavior or localization changes are introduced.

- Fresh V15 completes permission preparation and camera entry, then fails a harness readiness assertion requiring the QR modal while the real Android permission dialog is foreground. Actual screenshot/command hierarchy shows `Allow MyChampions Dev to take pictures and record video?`, with `com.android.permissioncontroller:id/permission_message` and `permission_deny_button`; app source requests permission before opening the QR modal. The bounded prompt repair must wait for the system control and correct the adapter’s controller-package/title/app-label assumptions before a fresh run. Original attempt `e990e91664d2765f007cfa39`, capture `54c61215d945549a14b4fed8`, remains harness-blocked. Independent cleanup passes120 PID/start pairs with no survivors/unknown queries; all269 source hashes are unchanged and the hold is released. Proof: `android-maestro-camera-public-live-2026-10-04-v15/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`, plus actual private prompt artifacts. Camera/cold passes remain0; no product behavior or copy change is proposed.

- Fresh V14 clears the unsupported permission command and reads actual User0 CAMERA dumps (`granted=false`, sensitive flags; both12,683byte stdout files retained), then stops on the command verifier expecting undefined while the real owned runner records null for absent census/output failures. The two-field contract repair accepts both typed no-failure representations and still rejects observed diagnostics; its actual-null fixture fails before and passes after. Original attempt `a3ac97d732bda3f7e1d95c45`, capture `3f1e5eed8e624242d7438467`, stays harness-blocked. Independent cleanup passes110 PID/start pairs with no survivors/unknown queries; all269 held source hashes are unchanged and the hold is released. The narrow receipt repair is independently accepted; canonical Node controls pass50/50, full TypeScript and strict lint/format plus inventory/impact checks pass. Fresh V15 is next; camera/cold passes remain0. Proof: `android-maestro-camera-public-live-2026-10-04-v14/ROOT-TERMINAL.private.json`, `ROOT-CLEANUP.private.json`, `ROOT-PERMISSION-QUERY.private.json`, and `android-camera-command-null-root-repair-2026-10-04-v1/before.private.log`/`after.private.log`.

- Root independently reviews and guarded-transfers the three-file Android camera permission repair: unsupported `pm check-permission` becomes package-targeted `dumpsys package`, clear/revoke explicitly target User0, and status/flags require nested package/User0/runtime rows plus known permission flag tokens. All four stdout receipts bind exact command paths, size, owner, mode and hash. Root reproduces three parser gaps before and rejects them after; independent review passes package/user/flags/receipt mutation controls. Canonical Node camera controls pass50/50, full TypeScript and strict lint/format pass; actual fixture and locale-label controls are rechecked against the new capture source. The retained Bun invocation fails on default5second timeout and node:test compatibility; it is not the accepted suite result. Fresh V14 is next, with no native/cold credit until actual runtime proof. Proof: `android-camera-permission-root-integration-2026-10-04-v1/VALIDATION.private.json`.

- Independent iOS Detox camera V11 review accepts the narrow nine-entry generated runtime-closure mapping (196 camera owners with no missing revisions;13/13 focused controls) but holds transfer on inherited lifecycle gaps: cleanup omits the original signal/monotonic deadline, and staging-link publication lacks a monotonic deadline/post-write fence. A private successor is required before native qualification. Proof: `/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-route-v11-independent-review-20261004-v1/REVIEW.private.json` (SHA256 `38b00ef4740323f7b97240949a7e15267b9ab4d7522a71ec67ea36fcbdd6edcf`). No native/cold qualification is added.

- Fresh V13 confirms the dev-only locale diagnostic in actual entry, coach-home and student-home hierarchies, then reaches camera permission preparation. Clearing user permission flags and revoking CAMERA succeed; the device rejects the subsequent `pm check-permission` command with exit255 and `Unknown command: check-permission`. The next fresh camera run requires a supported, package/user-bound `dumpsys package` permission query with strict status/flag validation. Original attempt `045266c698612dd59e327cfa`, capture `25ea6da5abb66c9d767a3eeb`, remains harness-blocked. Independent cleanup passes88 PID/start pairs with no survivors/unknown queries, and all269 held source hashes are unchanged before release. Proof: `android-maestro-camera-public-live-2026-10-04-v13/ROOT-TERMINAL.private.json`, `ROOT-CLEANUP.private.json` and `ROOT-DIAGNOSTIC-VISIBILITY.private.json`. Camera/cold passes remain0.

- Root guarded-transfers three independently reviewed diagnostic visibility files after full current-Q composition (836 roots/1,944 sources, zero diagnostics) and exact candidate/preimage checks. The unchanged dev/build guard remains authoritative; transparent8x8 nodes with explicit Android accessibility importance mount above navigation at left4/top32, below the measured24px status bar. Source controls are13 component/guard plus52 locale/parser/camera; canonical13/13 component/guard controls, full TypeScript, strict lint/format pass after an import-only actual-Q correction (all non-import AST statements unchanged); fresh V13 visibility proof follows. This is diagnostic visibility hardening, not an established historical cause or runtime locale qualification. Proof: `android-locale-diagnostic-root-integration-2026-10-04-v1/TRANSFER.private.json`. Camera/cold passes remain0.

- Fresh V12 clears prior fixture/sampling/locale-label blockers and invokes the camera producer, then stops with app-locale diagnostic-missing. Actual entry, coach-home and student-home hierarchies contain no testing.locale IDs; OS locale reads completed. Original attempt `38a70057c874dcd549f8b485`, capture `3c4d104b8b20f5dbb40173c0`, remains harness-blocked. Independent cleanup passes81 PID/start pairs with no survivors/unknown queries, and all269 source hashes are unchanged before release. Dev-only diagnostic render/build-guard/accessibility investigation is in progress; OS locale alone cannot qualify effective app locale. Proof: `android-maestro-camera-public-live-2026-10-04-v12/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. Camera/cold passes remain0.

- Root scopes camera-student locale commands separately while retaining initial labels and strict duplicate-label rejection. The actual capture function fails before on the second observer and passes after with four distinct protected command records; repeating the same scope still rejects. All33 locale/camera-production/sampling controls, full TypeScript and strict lint/format pass. Actual fixture-writer positive/crossed-primary/missing-original controls are rechecked against the final capture source. Fresh V12 preparation requires both accepted repair hashes. Proof: `android-locale-label-root-repair-2026-10-04-v1/VALIDATION.private.json`. Camera/cold passes remain0.

- Fresh V11 passes all startup-sampling stages (4/4/5 samples) after the interval repair, then stops because the camera student locale observer reuses the initial locale command label. Original attempt `93f980e9e2ec52720a64b96c`, capture `ceb78f8bf82ca664f38f967b`, stays harness-blocked. Cleanup independently passes96 PID/start pairs and all269 source hashes are unchanged before release. The repair scopes the second observer command label to camera-student while preserving initial labels and duplicate-label rejection. Proof: `android-maestro-camera-public-live-2026-10-04-v11/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. Camera/cold passes remain0.

- Root repairs startup sampling after V10: an early timer callback now checks elapsed time and rearms until the strict10second interval; stop cancels the rearmed timer and no additional sample starts. The actual regression fails before (2 samples before interval versus expected1) and passes after. All21 sampling/diagnostics/capture controls, full TypeScript and strict lint/format pass. The recorder requirement and20sample limit remain unchanged. Fresh V11 preparation requires this accepted source hash in addition to the fixture/readiness/cleanup gates. Proof: `android-sampling-interval-root-repair-2026-10-04-v1/VALIDATION.private.json`. No native camera or cold qualification is added.

- Fresh camera V10 clears the isolation fixture mismatch, builds successfully in2m19s and reaches student home with Maestro child exit0, but the startup sampler rejects its own intervals as shorter than10seconds. Original capture remains harness-blocked. Independent cleanup passes71 PID/start pairs with no survivors/unknown queries; all269 held paths are unchanged and the hold is released. Repair will recheck elapsed time when a scheduled callback fires and rearm early callbacks, preserving the strict10second recorder rule, bounded sample limit and stop/drain behavior. Proof: `android-maestro-camera-public-live-2026-10-04-v10/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. No native camera or cold qualification is added.

- Root independently accepts the complete fixture-only repair: 60 private composition controls pass, full 836-root/1,944-source TypeScript has zero diagnostics, strict lint/format pass, and the actual capture statements pass distinct-scope, crossed-primary and missing-original controls. Ten source/test files transfer with exact Q preimage backups. Original schema-valid isolation fixture bytes and full primary/isolation identities are reread at producer, staging, SQL and runtime eligibility boundaries; paired descriptor-writer helper coverage is retained. Canonical validation passes60/60 controls, full TypeScript, strict lint/format and native/unit inventory/impact/diff gates. Fresh Android Maestro camera V10 is now approved for preparation under one source hold and one native lock. Proof: `android-camera-isolation-fixture-root-checkpoint-2026-10-04-v2/REVIEW.private.json` and `android-camera-isolation-fixture-root-integration-2026-10-04-v1/TRANSFER.private.json`. No native or cold qualification is added; all20 T14 cells/400 T15 actual attempts and T16-T20 remain required.

- Root extracts a complete fixture-only candidate from the moving T15 extension into eight private files, preserving cold-reset work separately. Full836-root/1,944-source compilation haszero diagnostics; strict lint/format pass; all38 production/public fixture controls pass. Actual five capture statements pass a descriptor-writer positive and crossed-primary/missing-original negatives. Root fixes paired helper-ledger coverage of the newly loaded descriptor writer and its Python sidecar; the affected closure control passes. Transfer remains pending: original raw fixture and full primary expected identity must be revalidated by outer SQL/runtime consumers, and existing11 eligibility controls need qualified distinct-scope fixtures. Independent narrow-projection export proof currently accepts crossed primary identities. Root V10 scripts are staged only, with no LIVE receipt/source hold/acquisition, and require the dedicated accepted fixture integration gate before preparation. Proof: `android-camera-isolation-fixture-root-checkpoint-2026-10-04-v1/REVIEW.private.json`, `DEFAULT-FIXTURE-CONTROLS.private.json`, and `android-maestro-camera-public-live-2026-10-04-v10/SETUP.private.json`. Actual cold attempts remain0; all20 T14 cells/400 T15 attempts and T16-T20 remain required.

- Independent iOS Detox camera V8 review blocks transfer despite all16 hashes/two Q preimages and 9 focused controls passing. Actual exports prove unstaged original frame references reject, build timing remainszero, a forged terminal cleanup is accepted against clean report/stage, and recursive setup chmod changes a foreign symlink target before rejection. V9 must repair all four through production-path controls; final fractional-deadline controls pass against unchanged final source3f170. Proof: `/Users/eduwaldo/.codex/private-overlays/ios-detox-camera-route-v8-independent-review-2026-10-04/REVIEW.private.json` (SHA256 `f360b8c11128c53e7a5dde0fbcec56d36ae4ec823b26fa881beb4ed9146bb549`). No native/public/cold qualification is added.

- Root corrects one stale dispatch contract expectation: canonical iOS Detox training is already admitted, while its older test expected null. Actual baseline passes20/21 and fails only that expectation; the corrected matching-platform control passes, with strict lint and format passing. No product behavior, copy or native qualification changes. Proof: `native-dispatch-expectation-root-repair-2026-10-04-v1/VALIDATION.private.json`.

- Root verifies Android Detox camera V4: all 150 packet source hashes and 23 Q preimages match, but the default public projection still emits missing fixture/assertion hashes, zero phase timings and inferred child/backend metadata, so it cannot satisfy the canonical outer terminal. Complete runtime projection repair is required; inner finalizer promotion controls are insufficient. Root also reproduces Android connection V3 deletion of a replacement file at the final lstat-to-unlink fence, despite its earlier post-readdir race control passing; descriptor-relative mutations remain required. Proof: `android-detox-camera-v4-root-review-2026-10-04-v1/REVIEW.private.json` and `android-detox-connection-v3-root-review-2026-10-04-v1/CLEANUP-RACE.private.json`. Neither candidate is transferred and no native/cold pass is added.

- Fresh Android Maestro camera V9 clears startup, builds successfully in 2m56s, installs and reaches entry and coach home, then stops before camera assertions with `Connection snapshot fixture identity mismatch`. Attempt `8d7e7f0773e7103502fe424f`, capture `4c9352c5c6efaf0b82d41f47`. Root diagnosis: the separately seeded `native-conn-isolation-android` snapshot is checked against primary `native-entry-android` accounts after the isolation fixture return is discarded. Repair must retain and bind each scope's actual fixtures and original evidence through producer and SQL verification; strict identity checks remain required. Independent cleanup passes for 65 PID/start pairs, with no survivors or unknown queries; all 269 held paths are unchanged and the source hold is released. Proof: `android-maestro-camera-public-live-2026-10-04-v9/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. No native camera pass or actual cold attempt is credited.

- Root integrates the reviewed bounded startup-census repair in three files with exact preimage backups. Canonical owner/startup controls pass49/49, full TypeScript and strict lint/format pass, actual observer probes7 and default startup probes10 pass, and native/unit inventory/impact/diff checks pass. Startup settling permits only later fully available, boundary-checked census observations, max8, under the original boot deadline/signal; generic strict one-requery behavior and unavailable-argv rejection remain intact. The initial48/49 and three warning receipts are preserved; only deterministic new test fixtures were corrected. Fresh camera V9 is the next qualification. Proof: `android-census-root-integration-2026-10-04-v1/TRANSFER.private.json` and `VALIDATION.private.json`. Native/cold pass counts remain unchanged.

- Root census checkpoint has full 836-root/1,944-source compiler pass, seven actual observer-policy probes and ten actual startup-statement controls with unchanged deadline/cancellation forwarding. Its independent owner suite is 48/49: a new deterministic boundary test incorrectly uses expired absolute100 without a fake clock; strict lint finds three new require-await warnings. Repair/freeze is pending and canonical source is unchanged. Android connection V2 completes a runtime-to-terminal candidate but root reproduces unsafe replacement-directory deletion in its actual cleanup function; descriptor-bound creation/removal with recovery and a forced-exchange regression are required before transfer. Android session V7 and iOS camera V8 still contain unconditional source-only terminal downgrades, so authors must finish actual runtime verification rather than ask for an unchanged run. Proof: `android-census-root-checkpoint-2026-10-04-v1/REVIEW.private.json`, `android-detox-connection-v2-root-review-2026-10-04-v1/CLEANUP-RACE.private.json`, and `android-detox-session-v7-root-review-2026-10-04-v1/REVIEW.private.json`. No native/cold qualification is added.

- Current-Q ownership baseline passes 32/32 strict process-group/native-command controls after V8. Root independently verifies the iOS camera V8 actual deadline export: fractional future accepted; NaN, Infinity, negative and elapsed rejected, with unchanged source and no acquisitions. The complete iOS packet is still pending. T15 owner V4 cannot transfer because three exact preimages predate accepted composition and its readiness dependency still names V1; additive rebase must preserve current capture/runner/generator closure and readiness V3. Proof: camera V8 `PROCESS-CONTROLS.private.json`, `ios-detox-camera-v8-root-review-2026-10-04-v1/DEADLINE-CONTROLS.private.json`, and `t15-owner-v4-root-review-2026-10-04-v1/PREIMAGE-REVIEW.private.json`. T14 retains all 20 cells, T15 all 400 actual balanced attempts; T16–T20 remain required and no native/cold credit is added.

- Docker availability is restored and fresh camera V8 reaches owned emulator acquisition, then fails before guest qualification with `Owned worker command census unavailable`. Attempt `1d5945d8553732cd3c07cf5a`, capture `aace407ed8017ad2165f849d`, acquisition `eb0e2ac13e45cb79f61c941d`. No backend/build/journey is reached. Independent cleanup passes, all 269 held paths are unchanged and the hold is released. The original failure and ownership/requery evidence remain preserved; strict Darwin census investigation is in progress with no weakening of ownership checks. Proof: `android-maestro-camera-public-live-2026-10-04-v8/ROOT-TERMINAL.private.json`. No native/cold pass is credited.

- Fresh Android Maestro camera V7 actually dispatches after composition acceptance but stops before any emulator/backend/build acquisition because the Docker daemon is unavailable. Attempt `8e3b019083208a2cc5cb8b9f`, capture `44935892eb22de59d67c3952`, child exit 2. Original failed receipts are preserved; independent cleanup passes, all 269 held source paths are unchanged and the hold is released. Docker availability is the immediate host prerequisite. Proof: `android-maestro-camera-public-live-2026-10-04-v7/ROOT-TERMINAL.private.json`. No native/cold pass is credited.

- Root accepted and guarded 16 composition source/test files after verifying all 17 packet rows and exact Q preimages. Canonical full TypeScript, strict no-ignore lint, formatting, native/unit inventory, impact and diff checks pass; 83/83 owner, camera eligibility, runtime dispatch and closure controls pass. The finalizer module and default producer-context wiring are complete, and original deadlines and matching helper declarations are retained. Readiness V3 dispatch gate is unlocked for a fresh camera run; this adds no native or cold pass. Proof: `composition-root-integration-2026-10-04-v1/TRANSFER.private.json` and `VALIDATION.private.json`.

- Independent focused composition controls run 59 tests: 55 pass, four save/retry owner tests fail. Repairing stale request-window fixtures and persisting actual child responses moves the failure to the real producer-context boundary (owned-caller rerun: 21/25). Root source review finds the default existing-owner wrapper omits the producer context required by the new receipt guard, so this is incomplete production wiring and cannot be accepted. The guard must stay strict; the real qualified build/runtime metadata must be forwarded before the journey. Actual private-workspace no-ignore lint passes; a separate custom overlay import-parser failure is retained as a tooling limitation. Proof: `composition-root-postfix-2026-10-04-v1/RUNTIME-REVIEW.private.json`. Canonical source and camera dispatch remain pending.

- Independent composition postfix snapshot now passes the full 836-root/1,944-source compiler with 15 overlays and zero diagnostics. The actual child constructor rejects NaN, Infinity and negative absolute deadlines; paired camera eligibility helpers and generator finalizer source/recursive closure are present and Python syntax is valid. The earlier review findings are addressed in this snapshot. It remains untransferred pending a stable durable packet, focused owner/runtime/closure controls and strict lint. Proof: `composition-root-postfix-2026-10-04-v1/REVIEW.private.json`. Native/cold credits remain zero for this repair.

- Root independently snapshotted ten changed composition paths and compiled the full project overlay: 836 roots, 1,944 sources, zero diagnostics. This interim candidate clears the seven type errors but is not accepted or transferred. An actual constructor probe proves malformed absolute deadlines (NaN, Infinity, negative) are accepted by the new child-client option; validation and matching camera producer/consumer/declaration helper closure repairs remain required before qualification. Proof: `composition-root-checkpoint-2026-10-04-v1/REVIEW.private.json`. Camera V7 stays undispatched and canonical full-project repair is still pending.

- Fresh camera V7 preparation is now actually checked and fails at module load on missing `detox-save-retry-runtime-finalizer`, through save/retry owned dispatch, integrated connection driver and the public runner. It exits 1 before creating LIVE/preflight receipts, a source hold or native/backend/build resources. Proof: `android-maestro-camera-public-live-2026-10-04-v7/BLOCKED-PREPARATION.private.json`. The accepted readiness repair is retained; the complete composition repair is the immediate next prerequisite.
- Root verified all 17 transfer rows and the immutable manifest/freeze of the durable T15 Maestro owner extension V3. Its final wrapper always returns `harness-blocked`/source-only and `receipt: null` after protected staging, so it cannot produce a successful actual cold terminal. This source-only packet is insufficient for T15 and is not integrated. A complete actual owner-to-verified-terminal repair is in progress; source controls must remain separate from native facts. Proof: `t15-owner-v3-root-review-2026-10-04-v1/REVIEW.private.json`. All 20 cells and 400 actual attempts remain required; no cold credit is added.

- Root canonically integrated the narrowed readiness V3 source/test, preserving both exact preimages. Source SHA `37bad49ff794899c079099bb9f71738556e05171e4a03b355101fc1815acd837`; test SHA `d016e1d628770a909968905441fed439bde6e45bcb71a3e74f34b0c2a6fb5baa`. Only the expected serial's explicit pre-guest boot-probe absence retries; owned emulator liveness is rechecked before each child under the original deadline. Canonical controls pass 15/15, ten actual-production startup probes pass, formatting and canonical strict lint pass. The full 835-root overlay has exactly the same seven existing composition diagnostics as canonical Q, with zero candidate-added diagnostics. Independent source review is accepted with no findings and binds the frozen candidate (review SHA `fca7f6b552084fa41149bf17a4892a6414d6710d1c46dc9b256d0fdbe2a4c47f`). The separate complete composition repair remains pending, so native dispatch is locked. Proof: `android-readiness-v3-root-integration-2026-10-04-v1/TRANSFER.private.json` and `VALIDATION.private.json`. No product behavior/localization change or native/cold pass is credited.

- Fresh canonical full TypeScript validation now exits 2 with seven diagnostics: missing save/retry runtime-finalizer imports, a missing owned-command driver seam, and missing aggregate deadline forwarding in Android connection callers/tests. Android connection and save/retry dispatch source hashes differ from the recorded V6 snapshot; the existing changes are preserved for completion. Older passing compiler receipts do not qualify this current source. Root log: `android-readiness-v3-root-review-2026-10-04-v1/current-q-full-typecheck.private.log`. A separate guarded composition repair is in progress; native V7 remains undispatched.

- Readiness V2 is rejected by independent root review: its generic no-device fallback allows startup to qualify when the expected-serial-only contract requires a fatal error. The actual-production AST probe reproduces this in `android-readiness-v3-root-review-2026-10-04-v1/rejected-v2-startup-labelled.private.log`. Its initial compiler receipt also checked only two roots, not the full project. Initial V3 passes nine startup probes, but a stronger tenth probe shows it issues another boot command after the owned emulator exits. V3 must recheck owned emulator liveness before each retry child; eventual identity rejection is insufficient. The stronger failure is preserved in `android-readiness-v3-root-review-2026-10-04-v1/v3-emulator-prechild.private.log`. Canonical V1 remains unchanged; the corrected durable V3 and full validation are pending. The fresh camera V7 preparation script exists but has not been executed; no source hold, native acquisition, new camera pass or cold attempt is credited. This is harness-only work with no product behavior or localized copy change.

Use this section and the latest dated checkpoints below for dispatch. Earlier checkpoints are historical evidence, not current authorization or current inventory.

- Qualified test inventory: 486 files (422 client, 64 server).
- iOS Maestro camera: actual attempt `632b5909535b079dcb403416` passed all four assertions with verified cleanup at its executed source snapshot. Earlier blocked attempts remain blocked.
- T15 V12: 18-file canonical source accepted; 82 distinct focused controls passed. Actual cold attempts: zero. Full T14 twenty-cell qualification and T15 four-hundred-attempt comparison remain incomplete.
- Earlier iOS entry build `f94fc22bf57d4c63b35b222d` qualified at its recorded source snapshot and is now stale after the T16 package change. The shared iOS Detox step-budget clamp is integrated; 16 canonical controls and full TypeScript pass. Safe deadline regressions are integrated; actual native qualification remains pending; revalidate build/source/helper compatibility after fixes.
- T16 V4 is canonically integrated across 25 guarded paths. All 80 canonical controls, full TypeScript, 23-file strict lint and 24-file formatting pass. Actual bounded exploration remains pending. The real reusable-build loader rejects earlier iOS build `f94fc22bf57d4c63b35b222d` after the package-script change; a fresh final-source build is required. Preserve rejected V3 evidence.
- Android Maestro camera actual attempt `7edf33129cbe13803778f9cd` stopped before build: its isolation fixture scope is 35 characters while the owned backend protocol allows 32. Cleanup qualification also rejects a completed final-state diagnostic before engine acquisition; original failed recovery receipts remain unchanged. Source hold released with all 262 paths unchanged. The nine-file request repair now uses schema-valid `native-conn-isolation-android` (29 characters); full TypeScript, strict lint and formatting pass, and the original profile reproduces the actual `/scope:pattern` failure. Cleanup V2 is integrated and passes 9/9 controls; retained-capture independent census is available with zero survivors, unknown process queries, occupied owned ports or owned Docker resources, the owned device absent and foreign resources preserved. The original failed cleanup result remains failed. The direct full-bundle control now receives one anchored 120-second deadline and passes; production deadlines are unchanged. Full TypeScript and strict lint pass. The original failure is retained; the later retry and remaining repairs are recorded below. Proof: `android-cleanup-v2-root-integration-2026-10-04-v1`. Proof: `android-isolation-scope-root-repair-2026-10-04-v1`.
- Earlier Android Maestro camera retry `6e50023d1348819d8c667e6a` / capture `d3a36119dbf13a9c151c3d27` passed actual backend fixture setup but stopped before camera interaction: the executed capture requested 600 seconds despite the configured 900-second build budget. Internal camera cleanup also invokes its file-reading inspector before publishing `capture.private.json`. Cleanup V3 is independently blocked because its direct provisional inspector can override an existing failed capture and its new positives only inject verifier metadata; Cleanup V4 is also independently blocked: its exported camera cleanup helper accepts a caller-supplied verifier callback that can report passed/available without running the resource census. Independent review also reproduces a direct provisional-verifier bypass: it writes a successful external cleanup receipt beside an existing failed same-run capture. The 22 passing source controls do not close either bypass. The three-file V5 repair is now canonically integrated after independent source acceptance and a separately preserved, independently accepted README freeze-hash correction. Both exported paths use the real census, reject existing captures and invalid publication/run/root identities, and clone/freeze provisional evidence. Canonical cleanup, camera, closure and eligibility controls pass 43/43; full TypeScript and strict lint pass. Native qualification after the repair remains pending. Proof: `android-cleanup-order-v5-root-integration-2026-10-04-v1/TRANSFER.private.json`. Independent review: `/private/tmp/android-maestro-cleanup-final-state-v4-independent-review-20261004-v1/REVIEW.private.json`. The narrow build-budget call repair is canonically integrated: it now uses the existing validated `deadlines.buildMs`, with all seven deadline controls, full TypeScript, zero-warning lint and formatting passing; protocol caps, whole-run timer and step caps are unchanged. A native build after the repair remains pending. Proof: `android-build-budget-root-integration-2026-10-04-v1`. Fresh root inspection has an available 26-PID census with all owned processes/device/cache/ports/Docker absent and foreign resources preserved. Original attempt/cleanup remain failed; all 268 held paths unchanged and source hold released. Wrapper-only V2 double-lock timeout created no attempt/resources and is preserved separately. Proof: `android-maestro-camera-public-live-2026-10-04-v3` (actual) and `android-maestro-camera-public-live-2026-10-04-v2` (wrapper only).
- Root integrated the seven-file helper-path V2 correction, preserving root `package.json` through the iOS producer ledger and training/connection/session consumers. All 33 canonical producer/ledger/consumer/finalization controls, full TypeScript, zero-warning lint, formatting and impact validation pass. Inventory now has 486 files (422 client, 64 server). The separate two-file Android closure alignment adds the 14 missing shared T15/T16 ledger paths and preserves root package resolution in both producer and camera consumer. All 11 closure and 10 camera eligibility controls, full TypeScript, zero-warning lint and formatting pass. The original 10/11 failure is retained. Proof: `android-shared-helper-closure-root-repair-2026-10-04-v1`. No native qualification is credited. Proof: `t16-helper-path-v2-root-integration-2026-10-04-v1`.
- Earlier Android Maestro camera retry `b848c3a5e7e0be1e1d5d4788` / capture `106d5a63830ab403dea9c28d` stopped during emulator acquisition with `Owned worker command census unavailable`, before backend setup, build or camera assertions. Its original Darwin command-census requery journal is retained for diagnosis. The corrected provisional cleanup path executed without the former missing-capture error, but the original independent census was unavailable and cleanup remains failed. After terminal child exit 2, fresh read-only inspection has an available eight-PID census with no survivors, unknown process queries or occupied owned ports; owned device absent, six directories deleted, and foreign device/AVD/default ADB state preserved. Cache and Docker fields are not applicable to this pre-build/pre-backend acquisition and are not zero evidence. All 268 held paths stayed unchanged; hold released. No native or cold pass is credited. Source repair is in progress. Proof: `android-maestro-camera-public-live-2026-10-04-v4/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`.
- Latest distinct Android Maestro camera attempt `d05f918c98176f5c4a7aaf65` / capture `4040333133be2fee024e67c8` passed the strict command census but stopped during target verification: scoped `adb get-serialno` returned `device offline` after boot-completed and AVD-name observations. No backend, build or camera assertions executed. Do not weaken unknown-command ownership checks; the earlier unavailable census remains a genuine fail-closed result. A narrow readiness repair is being prepared under the original absolute boot deadline, with wrong-target, cancellation and unavailable-census failures retained. Root also reproduced a bounded orphan-timer issue from the exact production `captureBeforeDeadline` helper: immediate census returned in about 1 ms while process `beforeExit` waited about 402 ms for its losing 400-ms timer. The readiness packet must dispose that local timer without changing caller cancellation, phase budgets or in-flight settlement. Proof: `android-emulator-readiness-root-investigation-2026-10-04-v1/baseline-timer.private.log` (source control; no native execution). After terminal child exit 2, fresh published-capture inspection has an available nine-PID census, no survivors/unknown queries/occupied owned ports, owned device absent, six directories deleted and foreign device/AVD/default ADB state preserved. Original failed cleanup and all four original artifacts are retained. All 268 held source paths stayed unchanged; hold released. No native or cold pass is credited. Proof: `android-maestro-camera-public-live-2026-10-04-v5/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`.
- Fresh Android Maestro camera V6 attempt `8a0e0d4e6dff00508188945d` / capture `ee890017668f2d179527651b` executed the accepted readiness source but stopped before backend/build/UI when the first scoped `shell getprop sys.boot_completed` returned `adb: device emulator-5554 not found` during full emulator startup. V1 deliberately accepts typed offline/not-ready responses and rejects missing transports; actual V6 establishes a separate pre-boot expected-serial discovery case. Prepare V2 with retries only for that exact owned serial in pre-boot scoped child reads after strict emulator/ADB census and listener checks, under the same original deadline; foreign/mismatched targets, missing transport after identity qualification, unavailable ownership and cancellation remain fatal. No unchanged retry is authorized. Monitor terminal, actual child exit 2 and absent. Fresh read-only cleanup census is available for six PID/start pairs with no survivors/unknown queries/occupied owned ports, owned device absent, six directories deleted and foreign/default ADB state preserved; cache/Docker were not acquired. Original cleanup remains failed and all four original artifacts are bound unchanged. All 268 held paths stayed unchanged; hold released. No camera assertion or cold pass is credited. Proof: `android-maestro-camera-public-live-2026-10-04-v6/ROOT-TERMINAL.private.json`, `ROOT-CLEANUP.private.json` and `ORIGINAL-FAILED-BINDING.private.json`.
- Root corrected an independent Android camera cleanup wiring defect: acquisition uses the sibling `mychampions-android-pilot` runtime parent, but the provisional cleanup call passed `MYCHAMPIONS_NATIVE_STATE_ROOT` (the host-lock directory). The strict inspector correctly rejects that mismatch. An exact production-call probe fails against the retained V6 acquisition owner before the one-line repair and passes afterward; inspector guards and historical receipts are unchanged. Capture source now SHA256 `e5cdc0566b1f0f4411290bffe019c6d55bd338adf5d70ceb6d20ac9d33c7ff57`; All 43 canonical camera/cleanup/helper-closure/eligibility controls, full TypeScript, strict no-ignore lint and formatting pass. Proof: `android-camera-cleanup-runtime-root-repair-2026-10-04-v1/failing-before.private.log` and `passing-after.private.log`. Fresh native cleanup qualification is pending; no historical unavailable census is promoted.
- Android readiness V1 is canonically integrated and accepted by root non-author source review across two guarded files; production SHA `ab4865c80e50320a5a0f01472cba8cd31bee60b5720ab02bee429c038478eae6`. Scoped offline retry now spans boot/AVD/serial/nonce/metadata under the original boot deadline, caller cancellation reaches scoped ADB/listener children, and the losing census timer is disposed. Root exact-production AST probes pass offline recovery, wrong target, wrong nonce, unavailable census and cancellation; no native resources were used. Canonical 13/13 controls, full TypeScript and strict no-ignore lint pass after ten test callbacks were normalized to explicit promises (test SHA `edf336be1683e5c64ca0b98d4fdd76d8471a7a45593230d491c2da085b2b9a93`). Frozen V1 and original failures are preserved. Regenerated native/unit inventory, formatting, impact and diff checks pass. Root non-author source review is accepted, bound by `android-readiness-v1-root-review-2026-10-04-v1/REVIEW.private.json` (SHA256 `30147480d3a4e1bd178558d350afc1904671099d5be185674cce4bbd3973769c`); an additional peer review is in progress and any concrete finding remains actionable. The four-assertion Android Maestro camera V6 wrapper passed its source gate and executed, but its pre-boot transport failure remains failed; V2 source repair and a distinct fresh native qualification remain pending. Proof: `android-readiness-v1-root-integration-2026-10-04-v1/TRANSFER.private.json` and `android-readiness-v1-root-review-2026-10-04-v1/default-startup.private.log`. Native passing cases and actual cold attempts remain zero for this repair.
- Complete camera qualification is blocked by the unreachable iOS Detox route and missing producer assertion/provenance/cleanup/deadline contracts; independent V1 review rejects transfer. Independent reviews block both iOS and Android Detox camera V2 packets on full-path, original-evidence, ownership, cancellation and cleanup defects. Android Detox camera V3 is also rejected before transfer: Java bridge package disagrees with the qualified Gradle namespace; current Android capture preimage is omitted; producer failure discards post-acquisition cleanup facts; per-action command/frame provenance and descriptor-safe staging/rollback remain incomplete; frozen adapter imports depend on external worktree paths. Its 18 source rows and eight current-Q preimages match, and resource-free composition/typecheck/lint controls pass, but no Java/Gradle/native qualification is credited. Evidence: `/Users/eduwaldo/.codex/private-overlays/android-detox-camera-route-v3-independent-review-2026-10-04-v1/REVIEW.private.json` (SHA256 `85580ec6a9145903999b5413d7731b7f79a56f24ab45d47eb4e9ba81b40411a1`). Private Android V4 repair is in progress. Frozen iOS V5 adds generator/runtime wiring and passes its author composed checks, but root blocks transfer after verifying all 12 source rows/preimages and reproducing a protected evidence-write defect: replacing the checked directory at the pre-write lifecycle fence makes `writeOwnedExclusive` create a file in the foreign directory and return success. Final-component `O_NOFOLLOW` does not bind ancestors. Preserve V5; reuse qualified descriptor-bound namespace primitives in V6 and prove the forced-exchange regression. Root review: `ios-detox-camera-v5-root-review-2026-10-04-v1/REVIEW.private.json` (SHA256 `359753d23ea2b96aeac0c7269821f6171e019d90f955be43987f6828ea2e4375`). This probe acquires no native resources. Other native cells, bounded exploration, regression conversion, hosted adoption, retirement decisions and final reconciliation remain required. Retain Detox.

- Android Detox session V4 current-Q readiness audit required rebase because its generator dropped 11 current T16/exploration entries, its runner removed the current exploration export, its inventory was stale, and manifest modes disagreed with files. Frozen additive V5 preserves those entries; root verified all 12 transfer rows/preimages and independently replayed 9/9 focused controls. Transfer remains blocked: an exact staging-export probe replaces the checked parent at the pre-mkdir lifecycle fence, creates the child in a foreign directory, then rejects the changed parent without an owned rollback identity. Preserve V5 and prepare V6 with a no-foreign-write namespace contract and actual race regression. Root review: `android-detox-session-v5-root-review-2026-10-04-v1/REVIEW.private.json` (SHA256 `155e1978e34c393d772fc7cff04b7cbdb724b97468db6b3ea298add2a3c543e0`); probe is source-only, not native evidence. The current-Q broader cohort has two reproduced baseline failures under separate investigation. No native qualification is added.

## Historical checkpoints

Training V7 is independently accepted and guarded into Q (13 intentional
files). Canonical training controls pass 33/33; the selected shared publication,
runtime-dispatch and closed-stdin controls pass 27/27. Full TypeScript, strict
touched-file lint, formatting, regenerated native/unit inventories, impact and
diff checks pass. The first stale-declaration failure is retained; the fresh
canonical run passes after regeneration. Current inventory: 470 files (406
client, 64 server). The runner now carries the real verified finalization
candidate through protected staging and terminal validation instead of always
forcing source-only. Actual native/public qualification and cold counts remain
zero/pending. Evidence: `training-v7-root-canonical-integration-2026-10-03-v1/ACCEPTED-SOURCE.private.json`.

The prepared next camera diagnostic preflight now requires independent source
acceptance, completed-report and real producer-binding controls, explicit rejection
of the original missing-fixture-proof capture, full typecheck, strict touched lint,
and inventory/impact checks. Its original preflight is retained. No acceptance
receipt exists and dispatch remains disabled. Fresh actual replay, four camera
assertions, terminal publication and independent cleanup are still required for
public qualification; original blocked receipts stay unchanged.

Android Detox session V1f is source preparation, not a qualifying public cell.
The candidate runner unconditionally preserves its source-only outcome and the
six candidate controls inspect source structure. This does not prove the six
session assertions or terminal public reachability. Continue the actual owned
producer, storage/auth/local-logout evidence, protected staging, independent
cleanup and public terminal path; retain fail-closed behavior for missing proof.
The full T14/T15 session cell remains pending and no cold attempt is credited.

T16 V7 is frozen source preparation. Root independently verified all 199
candidate hashes, the current-qualified CompilerHost graph (816 roots, 2,079
sources, zero diagnostics), and 64 distinct focused controls across eight
entries, including actual stdio process start/call/close and cancelled recovery.
Independent source review is pending. Parent-owned runtime receipts and outer
cleanup binding remain operational requirements; native passing count is zero.
Evidence: `t16-v7-root-independent-controls-2026-10-03-v1/ROOT-CONTROLS.private.json`.

Camera r3 review identifies two producer defects before transfer: the isolation
binding uses the primary fixture identities instead of the distinct second scope,
and visibility success is not linked to a completed owned Maestro execution.
The original capture lacks the independent second-fixture receipt; retained
backend cleanup leaves only scope names, not fixture identities. That original
capture must reject the new proof contract and remain blocked. Do not synthesize
its missing fields. The next diagnostic can start only after corrected producer
and consumer source, actual command/fixture binding controls, independent review,
and canonical validation pass. It must acquire and retain fresh proof, complete
terminal publication and independent cleanup, then satisfy full actual replay
before any public passing assertion is credited.

Root integrated the narrow camera permission-label repair: exact ASCII and
curly apostrophe denial labels are accepted only with the Allow control. The
completed-report entry passes 17/17 distinct controls, including missing-button
and unsupported-label rejection. Full qualified TypeScript, touched-file strict
lint, formatting, native declaration validation, refreshed 468-file unit
inventory and impact validation pass. This clears only the label mismatch;
visibility provenance and independent isolation-fixture binding remain pending.
No new native run has started and the original blocked receipt is unchanged.
Evidence: `camera-permission-label-root-repair-2026-10-03-v1/LABEL-CONTROLS.private.json`.

## Status

### Current dispatch checkpoint (2026-10-04: camera retention and lifecycle repairs)

Use the qualified checkout `/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions` and its sibling server. Preserve the unrelated dirty primary checkout. Root owns canonical edits and native/backend resources; agents prepare private candidates. The current measured inventory has 505 test files (441 client, 64 server), 23 declared views, 40 transitions and 10 native scenarios. Declaration counts are not runtime coverage.

| Lane                               | Current authoritative state                                                                                                                                                                                                                                                                                                                                                               | Next action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Disposable Postgres refresh        | Two current-source sequential runs (`fc68186fb0646ec5a51bd6d1`, `5e2034c692e06de2bb2c826f`) each pass all21 requested files on first attempts with equal catalog fixture summaries. Both cleanups pass root resource inspection, five foreign containers preserved, frozen server inputs unchanged. Direct DB test invocation without an owned manifest is observed rejecting before SQL. | Current-source lifecycle verification additionally passes two concurrent runs with distinct ports/equal fixtures and three cancellation cases (SIGINT tests130; SIGTERM tests/API143). Bootstrap recovery passes container/network-before-ID, network-only and wrong-owner refusal controls. Root independently verifies owned resource absence and foreign-container preservation. Actual handoff verification also passes EOF/deadline/duplicate-request rejection, provider isolation, idempotent release and API write/restart persistence. Root independently inspects all eight handoff runs; browser/native/camera/cold qualification remains separate.                                                                                                                                                                                                                                                                                                                                                                                         |
| Android Maestro camera             | Live proxy getters and exact analytics POST202 handling are integrated;40 canonical camera controls and TypeScript/strict changed-file lint/format pass. Fresh V27 (`06283563b4647f0c33d63c42`) then fails SQL parent-path resolution. Independent cleanup passes and281 source hashes are unchanged.                                                                                     | Finish authenticated parent-root and byte-preserving retention so SQL proof remains readable after backend cleanup; review the complete frozen closure, run canonical checks, then a fresh complete four-assertion camera attempt.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| iOS Detox camera                   | V20 port repair is integrated. V3 (`fc7d26fd0cc098a958847cb1`) fails permission inspection before installation; strict cleanup refuses command drift. Root recovers four exact PID/start pairs and separately verifies known-resource absence with665 unchanged hashes. Original partial-cleanup failure remains failed.                                                                  | V24 exact10 closure passes root current-Q TypeScript and64 faithful controls; runtime duplicate-bootstrap rejection and installed UDID/bundle/build binding pass semantic review. Review still requires signal/deadline propagation through installed-app verification/hash and root-bound dynamic Jest/Detox config/test source ownership. V25 remains private: root faithful current-Q composition passes68 iOS/process controls, but independent semantic review finds lost launch hashes in final receipt, unbound imported `.detoxrc.js`, and missing post-traversal directory/symlink identity fences. V26 is requested. Root private23-overlay composition now passes full TypeScript (871 roots/1979 sources/zero diagnostics), with the accurate existing shared-session binder result type and strict SQL parent association. All four canonical Android runtime cohorts pass38/38 in the faithful private composition. Strict formatting/lint and V26 semantic review remain required before transfer. V21–V26 add no native qualification. |
| Protected manual workflow (T18)    | V10 three-file successor is integrated after clean independent review, including malformed-native finalizer failure probe. Nine canonical controls, full TypeScript, strict TS lint, YAML parsing and format pass. Failed receipts clear acceptance proof; publisher is private and validated relocation values frozen. Hosted runs/dispatches/promotion remain0.                         | Complete applicable protected hosted acceptance only after prerequisite native evidence exists and dispatch authorization is given; source checks add no hosted or native credit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Android Detox session              | V16 minimal15 source/test rows are integrated after independent review (34 session and37 preservation controls in private current-Q composition; full TypeScript and strict changed-file lint/format pass). Root adapted the source-test default to canonical repository root;34 canonical controls, declaration/inventory refresh and impact validation pass.                            | Complete canonical controls/inventory refresh, then native/public terminal qualification. Source integration adds no camera or cold pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Cold matrix (T15)                  | Private V6 preserves live getters but its producer/observation preimages are stale after the analytics repair. It requests the unchanged20 cells and400 balanced attempts;10 Maestro cells are wired and10 Detox cells remain Pending. Actual cold attempts are0.                                                                                                                         | Rebase the minimal complete caller/reset/ownership closure after camera source settles; finish pending Detox routes and collect actual same-attempt reset/build/native/cleanup proof. Do not shrink the matrix or count source controls.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Exploration and closeout (T16–T20) | Actual bounded device exploration, protected hosted acceptance and final reconciliation remain Pending. MCP initialize/tools-list is tooling proof only.                                                                                                                                                                                                                                  | Complete prerequisites, observed exploration and deterministic regression conversion, then applicable exact-head hosted gates and requirement-by-requirement Section12 closeout. Retain Detox unless its own comparison/hosted retirement gates pass.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Current camera source checkpoint: eight independently reviewed Android ledger/fixture source rows are integrated after exact preimage/hash verification. Full canonical TypeScript, strict zero-warning lint, formatting and four canonical runtime cohorts40/40 pass. Two stable wrong initial API attempt/ledger regressions fail before the guard and pass after it; the probe must bind directly to every authenticated SQL parent. The shared session map retains its existing Android binder result contract. Proof: primary `.qa/artifacts/testing-modernization/android-ledger-fixture-root-integration-20261005`. Remaining canonical retention source still requires complete terminal closure review and fresh native qualification; iOS V26 remains private pending complete current-Q composition/review. Original native failures remain failed, source hold released after all eight hashes remain unchanged, cold attempts0.

The native logout policy is resolved as device-local credential/session and identity clearing with signed-out relaunch and protected UI checks; server bearer revocation is outside native acceptance. Product behavior/copy/localization are unchanged by the current QA repairs. Original failed receipts are immutable. A corrected source gate does not promote a failed run, a scoped resource-absence check does not qualify the original partial cleanup, and no warm camera attempt counts toward the400 cold attempts.

Current proofs are the dated `android-live-proxy-v2-root-integration-2026-10-04-v1`, `android-analytics-v2-root-integration-2026-10-04-v1`, `android-maestro-camera-public-live-2026-10-04-v27`, `ios-detox-camera-public-live-2026-10-04-v3`, `ios-camera-v21-root-checkpoint-2026-10-04-v1`, and `t18-minimal-root-integration-2026-10-04-v1` packets under `.qa/artifacts/testing-modernization` in the primary checkout. Revalidate their exact source hashes before reuse. Recheck host disk/resource availability before acquisition; no historical availability result authorizes a fresh run.

### Historical dispatch checkpoint (2026-10-03, 21:03 UTC)

The qualified inventory contains 470 files (406 client, 64 server). The native
logout policy is resolved: device-local credential/session and identity clearing
only, with signed-out relaunch and protected UI checks (FR-270 / BR-342 /
AC-539 / TC-333). Source controls pass 25/25, full qualified TypeScript,
changed-test no-ignore lint, native inventory and test-impact validation pass.
The configured full-repository lint command exits 0 with zero errors and 2,932
warnings; this is not zero-warning qualification. Its retained receipt is
`native-local-logout-policy-2026-10-03-v1/FULL-LINT.private.json`.
The retained policy packet is `native-local-logout-policy-2026-10-03-v1`.

The camera boundary repair is independently accepted and transferred to the
qualified worktree. The completed-report entry runs its 16 distinct controls
once; the canonical camera/preflight/auth cohort passes 32/32. Full qualified
TypeScript, touched-file zero-warning lint, formatting, regenerated native and
unit inventory checks, test-impact validation and diff checks pass. Evidence:
`camera-completed-report-public-live-2026-10-03-v1/ACCEPTED-SOURCE.private.json`.
The fresh native replay built successfully and recorded the complete capture,
but public verification is harness-blocked: the selected camera prompt hierarchy
lacks both required platform permission controls. Its public receipt contains
zero assertions. Independent cleanup passed and all 203 native/acceptance source
hashes remained unchanged before release. Evidence:
`camera-completed-report-public-live-2026-10-03-v1/TERMINAL.private.json`.
The retained prompt contains exact `Allow` and `Don’t Allow` labels (U+2019),
while the consumer requires the ASCII apostrophe (U+0027). Both permission
controls were observed; the original blocked receipt is unchanged. The complete retained-replay offline source control passes 1/1 through the
production observer, terminal adapter, validator and protected staging. The
additional hierarchy visibility and distinct isolation-fixture identity changes
are blocked before transfer by independent review: missing visibility has no
normalized observation contract, isolation identity is only self-consistent, and
the consumer preimage is stale. A narrow current-source repair is in progress;
no source transfer or native promotion is credited. Evidence: `camera-v2-full-retained-root-control-2026-10-03-v1`.
Require accepted repair and canonical validation before another fresh build. Diagnosis:
`camera-prompt-label-diagnosis-2026-10-03-v1/DIAGNOSIS.private.json`.
Detox V6 is independently accepted and integrated in the qualified worktree.
All 54 canonical collector/runtime/cleanup controls pass. Full qualified
TypeScript, touched-file zero-warning lint, formatting, native/unit inventory,
test-impact and diff checks pass after the retained seven-warning lint repair.
Evidence: `detox-terminal-publication-v6-canonical-integration-2026-10-03-v1/ACCEPTED-SOURCE.private.json`.
This is source qualification; actual Detox native/public equivalence remains
pending. Primary code remains divergent and is not qualified by these checks.
The adjacent canonical public-runner, invocation and Node-wrapper cohort also
passes 51/51; no native resources were acquired. Evidence:
`detox-v6-adjacent-public-runner-controls-2026-10-03-v1/ROOT-CONTROLS.private.json`.
Detox V4 and V5 blockers are resolved by the accepted V6 source checkpoint
above; original failure and review receipts are retained. T14 equivalence, all
400 actual balanced T15 cold attempts and T16–T20 remain required; actual cold
attempts remain zero.

Exploration V6 preserves current qualified support sources. Root verified all
197 candidate files and 21 intended-path preimages; the full current qualified
CompilerHost reports 815 roots, 2,079 sources and zero diagnostics. The candidate
focused cohort passes 30/30. The initial run from the qualified working directory
read its older declaration and failed; that result is retained alongside the
corrected candidate-directory run. Independent review blocks transfer on renewed
nested deadlines, dropped terminal/cleanup deadline provenance, unobserved
recovery and cleanup scope, missing actual stdio lifecycle controls, and an OOM
in the retained formatting log. Repairs are in progress; passing preflight tests
do not establish lifecycle qualification. Review: `t16-owned-runtime-operational-source-preparation-2026-10-03-v6-independent-review-2026-10-03-v1`. Evidence: `t16-v6-root-pretransfer-controls-2026-10-03-v1`
and `t16-v6-root-focused-controls-2026-10-03-v1`. This creates zero native or cold
attempts. Cold-reset V7 still separates reset/cleanup from the later public child;
it cannot qualify same-target/backend execution until that lifecycle is joined.

The independently checked two-file Detox stdin repair is integrated in the
qualified worktree. It records asynchronous stdin errors, avoids writes to
closed streams and removes drain/error listeners during bounded recovery.
Canonical writer/publication controls pass 19/19, full qualified TypeScript
passes, and touched-file lint has zero warnings with formatting passing.
The remaining training public route is not enabled by this repair. Evidence:
`detox-closed-stdin-root-integration-2026-10-03-v1`. Native and cold counts
are unchanged.

Historical checkpoints below retain their original observations.

Current adapter integration is **In progress**. The qualified worktree unit inventory contains 467 files (403 client, 64 server). The 2026-10-03 current-source public iOS/Maestro training integration run passed all seven canonical assertions, with independently verified cleanup and unchanged frozen source. It qualifies the recorded Metro-attached Debug snapshot only. Primary sources remain divergent, including a preserved deleted plan source; qualified-worktree results do not establish primary qualification. Full T14 equivalence, 400 actual T15 cold attempts, exploration, hosted adoption and full-plan completion remain **Pending**. Dated entries retain their original snapshots; the latest dated qualification entry owns current runtime status.

### 2026-10-02 Android checkpoint producer v4 canonical integration

#### Current resume checkpoint

The existing runner dispatch test now follows the reviewed Android session adapter and explicitly rejects Detox, fixture mode and mismatched platforms. This is a test-only repair; product requirements and screen/localization docs need no update. Its original failing result is retained in `android-session-dispatch-expectation-repair-2026-10-02-v1`.

This table retains the 2026-10-02 integration checkpoint. Later dated records below supersede its source counts, graph diagnostics and runtime counts where explicitly stated. Source completion, native qualification, hosted adoption and full-plan completion are separate gates.

| Work item                                                | Current status                                                                                  | Evidence / next action                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T18 backend output                                       | Done: source integrated and independently accepted                                              | `t18-backend-output-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`; 74/74 relevant controls in each root, stable qualified Expo typecheck, both-root lint/format/impact/inventory checks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| T18 private session registration                         | Done: source; owned native execution Pending                                                    | `session-baseline-impact-registration-source-2026-10-02-v2/root-source-validation.private.json`; keep `ci: false`, the non-selective profile and conservative full fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| T15 comparison collector                                 | Done: reviewed comparison and protected-reader source                                           | Exact V8 source is integrated after non-author review with no open findings. Intake and collection use the shared bounded no-follow descriptor reader; actual intake objects retain original descriptor identity and reject post-intake growth, hardlinks and same-byte inode replacement. Both-root focused/reader controls pass 56/56; actual qualified 696-file TypeScript, repository lint/format and both-root inventory/impact checks pass. Original V7 failures are retained. Proof: `t15-v8-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`; synthetic controls create zero real cold attempts.                                                                     |
| T15 owned cold dispatcher                                | Done: reviewed dispatcher source; native cold runs Pending                                      | Exact four-file V8 transfer preserves the 400-row denominator, balanced engine order, first attempts, owned reset and build identity contracts. Its final collection detects a replaced original receipt after verified producer intake. Both-root 56 controls and actual canonical checks pass. Actual producer/CLI/reset production, closed ownership sidecars, all 400 measured attempts and adoption evidence remain Pending. Proof: `t15-v8-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`; native/public/cold zero.                                                                                                                                                  |
| T14 Detox XML conversion                                 | Done: coherent DXA V3 source and fixture V2 integrated; native/public Pending                   | Reviewed seventeen-file DXA/training transfer and subsequent six-file fixture/publication repair are integrated in both roots. Canonical staging/DXA/V4 controls pass 42/42. Preserve strict PNG provenance, cancellation binding and owned publication checks. Proof: `detox-dxa-v3-reviewed-current-root-source-integration-2026-10-02-v1` and `detox-fixture-v2-reviewed-source-integration-2026-10-02-v1`; full runner and native qualification remain Pending.                                                                                                                                                                                                                                          |
| Android session consumer / public dispatch               | Done: source; native qualification Pending                                                      | Done: independently reviewed source integrated and actual post-apply checks passed (98 qualified controls; 84 primary portable controls). Preserve the v4 original sidecar producer, v7 bounded consumer, exact Android/Maestro integration dispatch and source-only zero-pass boundary. Proof: `android-session-current-layout-reviewed-source-integration-2026-10-02-v1`.                                                                                                                                                                                                                                                                                                                                  |
| iOS public session finalization                          | Done: qualified source; native/public Pending                                                   | Reviewed fixture V2 is integrated in both roots using the authoritative 90-entry ledger, immediate fixture ownership and setup/cleanup error retention. Primary focused controls pass 10/10; qualified dependency/real-path/finalization/staging cohort passes 33/33 and actual full 690-file Expo typecheck passes. Broader primary finalization retains owner-path blocks; initial ENOSPC and original two-failure logs remain immutable. Proof: `ios-session-fixture-v2-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`; native/public zero.                                                                                                                             |
| Actual Detox connection caller                           | In progress: coherent DXA source and V2 fixture repair integrated; public runner/native Pending | Exact six-file V2 fixture/publication repair is integrated in both roots. Actual qualified staging/DXA/V4 controls pass 42/42, closing earlier fourteen staging and five V4 fixture failures. Real publication-window retry and foreign-hardlink rejection pass. Proof: `detox-fixture-v2-reviewed-source-integration-2026-10-02-v1`; full runner and native qualification remain Pending.                                                                                                                                                                                                                                                                                                                   |
| Detox training caller                                    | Done: reviewed V7 source integrated with DXA V3; public/native Pending                          | All nine accepted training files are integrated through the coherent seventeen-file DXA V3 closure in both roots. Twenty-two canonical training controls pass, including cancellation, no-replace publication and owned source rereads. Actual public Detox training selection and runtime qualification remain Pending. Proof: `detox-dxa-v3-reviewed-current-root-source-integration-2026-10-02-v1`; native/public zero.                                                                                                                                                                                                                                                                                   |
| Native training public staging                           | Done: V6 reviewed source integrated; runner/native Pending                                      | Both-root synthetic staging passes 2/2; actual rollback controls retain recovery without foreign deletion. Scoped lint/format pass. Canonical selection gaps and seven existing qualified runner type errors remain. Proof: `native-training-staging-v6-reviewed-source-integration-2026-10-03-v1`; native/public zero.                                                                                                                                                                                                                                                                                                                                                                                      |
| T18 private connection registration                      | Done: source; owned native execution Pending                                                    | Distinct `owned-integrated-connection` profile remains non-selective, empty-phase and `ci: false`. Both-root selective/impact controls pass 70/70; current 690-root qualified Expo typecheck, both-root impact/lint/format/freshness pass. Proof: `parallel-fixture-registration-reviewed-source-integration-2026-10-02-v1/accepted-registration-source-transfer.private.json`.                                                                                                                                                                                                                                                                                                                              |
| Android session source fixture reliability               | Done: V3 source; native/public Pending                                                          | Exact reviewed V3 replacement is integrated after guarding both canonical V1 base hashes; its V2-based delta was not applied alone. All 26 controls pass in both roots, including concurrent exact child selection, pre-abort no acquisition, cleanup failure and deadline/abort SIGKILL/reap/namespace absence. Qualified full 690-file TypeScript, scoped lint/format and both-root impact/inventory checks pass. Proof: `android-session-fixture-v3-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`; native/public zero.                                                                                                                                                 |
| T12–T17 native qualification, comparison and exploration | Pending                                                                                         | Native/public/cold passing counts are **0**. The reviewed cleanup now exceeds the 20 GiB host disk gate; recheck it before acquisition. The native logout policy is resolved; native runtime acceptance remains pending. Require actual platform/engine evidence, all 400 cold attempts and bounded observed exploration.                                                                                                                                                                                                                                                                                                                                                                                    |
| T18 hosted adoption / T19 retirement / T20               | Pending                                                                                         | Require exact-head protected hosted evidence and every original plan exit. Retain equivalent Detox coverage; source checks do not authorize retirement or full completion.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| T17 original regression evidence / repository identity   | Done: source and reviewed local product demonstration; observed exploration Pending             | Existing permanent rendered ExerciseSearchModal identity assertion detects a real temporary private source mutation: two fresh Jest processes each fail all three selected locale cases on the wrong ID; clean control and restored source each pass three. Same private mutant path is restored, canonical product/tests unchanged. Independent review verifies four source-control attempts and nineteen original references. Six other discovered cases per run are out of scope, not passes. Proof: t17-exercise-identity-controlled-product-regression-independent-review-2026-10-02-v1; T16 observation, native and full T17 phase acceptance remain Pending.                                          |
| Android save/retry caller                                | Done: qualified source; native execution Pending                                                | Exact nine-path V4 transfer preserves current T17 framing, bounded iOS fixture and CI registration. Actual current qualified checks pass: 22 save/adjacent controls plus five inventory controls, 13 T17/identity, 36 iOS and 24 runner/closure/contract controls; full 690-root Expo typecheck, scoped zero-warning lint and both-root impact/format/freshness pass. Primary portable controls are 13 passed, two owner-path blocks in preserved dirty source; no full primary qualification. Proof: `android-maestro-save-retry-v4-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`; native/public zero.                                                                   |
| Detox save/retry source                                  | Done: V3 reviewed source seam; real caller/native Pending                                       | Six exact new files are integrated in both roots after non-author acceptance and current proxy guards. Actual qualified canonical controls pass 15/15, closing fault-arm cancellation cleanup and PNG CRC/image-data gaps. Real owned Detox caller, termination/reaping, native evidence and public promotion remain Pending. Proof: `detox-save-retry-v3-reviewed-source-integration-2026-10-02-v1`; source controls qualify zero native cases.                                                                                                                                                                                                                                                             |
| Android camera caller                                    | Done: reviewed producer source in both roots; public/native Pending                             | The reviewed eight-file producer update binds manual hierarchy provenance, protected body/descriptor rereads and six SQL phases. Both canonical cohorts pass 18/18; scoped lint has zero warnings. Both inventories have 424 files after the save/retry source integration. Android public adapter/staging is In progress; actual native qualification remains Pending. Primary missing plan source is preserved. Proof: `android-camera-producer-v2-reviewed-source-integration-2026-10-02-v1/post-apply-validation.private.json`; native/public zero.                                                                                                                                                      |
| T16 owned exploration controller                         | Done: reviewed source; observed exploration Pending                                             | Original V7 transfer exposed packet-depth fixtures and repository lint warnings; initial canonical controls passed only 4/30 in each root. The final owned fixture repair passes 30/30 in both roots, clean-checkout before/after reproduction and two concurrent 30/30 runs with no remaining generated roots. Independent review accepts the exact final bytes; repository lint, format, full qualified 694-file TypeScript and both-root inventory/impact checks pass. All original failures and V6 reproduction remain retained. Proof: `t16-v7-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`; actual connector and observed exploration Pending, native/public zero. |
| T15 cold producer                                        | In progress: V2 and production V3 blocked; actual CLI wiring In progress                        | Independent production V3 review finds candidate TS7016, mismatched requested run identity/output root, absent actual reset/ownership producers, terminal publication after cancellation, duplicate ports and incomplete attempt/cell binding. The public runner identity path is being repaired first; real same-attempt reset and ownership receipts remain required. Proof: `t15-cold-production-independent-review-2026-10-02-v1/review.private.json` in the qualified root; native/public/cold zero.                                                                                                                                                                                                    |
| T15 public runner requested identity                     | Done: reviewed current runner source; graph/native Pending                                      | Five-file composition integrated with guarded current runner patches; both identity suites pass 25/25. Primary scoped lint and both formatting checks pass. Qualified graph retains missing camera public-attempt import and derived lint diagnostics. Proof: `t15-runner-v9-current-composition-source-integration-2026-10-03-v1/canonical-validation.private.json`; native/public/cold zero.                                                                                                                                                                                                                                                                                                               |
| T16 Maestro connector and wrapper                        | Done: reviewed V5 source in both roots; actual exploration Pending                              | Exact three-file V5 integration closes primary-only numeric inference and redundant assertions without changing reader behavior. Independent root V4 controls (25 connector and seven actual reader controls) and V5 both-graph controls/type/lint/format pass; canonical post-transfer checks follow in the integration packet. Primary and qualified proxy differences are preserved and validated separately. Full configured graphs still have unrelated plan/camera/pilot missing imports. Proof: t16-b-maestro-connector-v5-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json; native/public/exploration zero.                                                           |

Current inventories contain **430 files (367 client, 63 server) in each root**. Both inventory freshness and test-impact checks pass (12 features, 45 suites, 64 UI specs). Qualified full TypeScript and scoped zero-warning lint/format pass after current runtime-fence integration. Evidence: `ios-detox-runtime-fence-v4-current-integration-2026-10-03-v1/VALIDATION.private.json`. The primary deletion of `features/plans/plan-source.ts` remains preserved and broader primary graph/native generation is not claimed. One retained iOS Maestro training smoke passed seven assertions; no cold comparison or full matrix pass is claimed.

BL-018 / D-218 shared native evidence reader is **Done (source); runtime/public qualification Pending**. The independently reviewed exact two-file patch is integrated in both roots: finite 64 KiB descriptor reads within 8 MiB, no-follow opens, single-link ownership/mode checks, complete pre/post descriptor/path identity and guaranteed close. Actual filesystem growth, rename, hardlink and mode drift controls pass. The current qualified Expo graph typechecks; 42 reader/adjacent/declaration controls pass after qualified declaration regeneration. Primary reader/portable controls pass; broader primary declaration checks remain blocked by the preserved deleted plan source. Both-root zero-warning lint, formatting, impact and test inventories are required in the integration proof. Both inventories retain 394 files. The initial stale-declaration failures are preserved. Caller-owned cancellation, Android consumer/dispatch and native/public/cold qualification remain Pending / zero. Evidence: `native-view-evidence-reader-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`. This QA-only infrastructure change requires no product requirements, screen, localization, provider or authentication update.

BL-018 / D-218 T00 test inventory formatting is **Done (source, locally verified); independent review recorded separately**. The generator uses the existing repository Prettier dependency and configuration before writing or comparing exact bytes. Actual generation → formatter → freshness passes in both roots, while the original generator fails freshness after formatting. All parsed inventory content is exactly preserved: 394 files, classifications, assertions, owners and pilot scenarios. Both-root source/JSON formatting, zero-warning scoped lint, impact validation and touched diff checks pass; the current qualified Expo typecheck is required in the proof. No dependency or product/provider/authentication/localization behavior changes. Native/public/cold and full-plan qualification remain Pending. Evidence: `test-inventory-format-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`.

Historical T14-D/T14-E readiness audit (superseded for source status by the current resume table): full platform/engine qualification remained **Pending** at this checkpoint. The current source audit found no owned Android Maestro camera/save-retry callback, charter, runner or public dispatch; the Android save observer wrapper alone supplies no ownership proof. Camera currently depends on iOS TCC evidence. Detox camera/save callers are absent and dispatch remains null. Android save-retry private source preparation is **In progress**, owned by `android_session_review`: bind the existing real observer to owned UI/API/SQL receipts, scoped pre-forward failure, unchanged baseline, retained draft, real retry and exactly one durable write. Then prepare Android permission/manual-code camera evidence and installed-Detox callers. Coordinate additive capture/dispatch wiring with the Android session repair; no canonical or runtime success is claimed from preparation. The primary camera declaration and broader declaration checks remain gated by the preserved deleted source. Evidence: `t14-camera-save-retry-readiness-audit-2026-10-02-v1/review.private.json` (15 source controls passed, two generic runner failures preserved) and `detox-connection-adapter-independent-review-v3-2026-10-02-v2/review.private.json`. No product, auth-policy, provider or localization change is authorized by these QA gaps.

BL-018 / D-218 T16-B budget policy is **Done (source); execution and observed exploration Pending**. The exact independently reviewed module/test is integrated in both roots: fixed budgets imported from preparation, all UI outcomes counted, overlapping/foreign/duplicate completions rejected, monotonic inclusive deadline, cancellation, 100-action limit and immediate two-unchanged-failure stop. Both-root policy/preparation controls pass **14/14**, source/test/inventory formatting, zero-warning scoped lint, impact and freshness pass; the actual qualified Expo graph typechecks with 661 root files. A controlled private action-limit mutation fails one control, and the unchanged original source passes seven clean controls; this is unit policy evidence, not native product regression/restoration. Inventories now contain **395 files (332 client, 63 server)**. The actual owned connector/controller, append-only evidence ledger, in-flight deadline cancellation, cleanup audit, observed exploration and T17 conversion remain Pending. A policy permit is no observation or passing receipt; native/public/cold passing counts remain zero and full T20 Pending. Evidence: `exploration-budget-policy-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`. No product/provider/authentication/localization change.

Parallel private source frontier (2026-10-02): iOS v5 source review is accepted in `native-session-public-finalization-independent-review-v5-2026-10-02-v1/review.private.json`; its 31 controls are source fixtures. T15 comparison collector v2, repository-identity/T17 v2 and Android Maestro save/retry v1 are prepared for independent review. The T16 execution controller and Detox v5 cleanup/signal repair are being prepared separately. These packets do not change canonical runtime status or create native/public/cold passes. No product, screen, localization, provider or authentication behavior changed; corresponding FR/UC/AC/BR artifacts require no update.

Android current-layout v2 guarded source transfer is complete in both roots. Independent review `c5214d9045005b261ec5511f51a2bf3da99b5ae2d0cbc0afcbc469ea77a1fbd5` accepted all 19 exact source paths, the relocated `tests/ci` controls and the actual Android runner dependency closure. The private current Expo graph typecheck, zero-warning typed lint, formatting and repaired fixture controls pass; actual post-apply qualified source controls pass 98/98 and primary portable controls pass 84/84; the actual qualified Expo graph typechecks. Both inventories regenerated to 400 files; the qualified declaration regenerated to 23 source views, 40 transitions, ten untested scenarios and zero runtime receipts. The primary declaration remains preserved because its real plan source is deleted. The unknown-owner self symlink remains untouched. This QA infrastructure changes no product, authentication, provider, screen copy or localization behavior; no FR/UC/AC/BR/copy changes are needed. Native/public/cold passing counts remain zero; native execution, hosted adoption and retirement remain Pending.

The final Android source qualification also removes seven redundant type assertions across three files. All three emitted JavaScript outputs are byte-identical before/after; 668 other current Expo roots are verified unchanged. The actual 671-root qualified graph typechecks and both scoped linters pass with zero warnings after the cleanup. Fresh post-cleanup controls pass 98/98 qualified and 84/84 primary portable; original failed lint and overlay results remain preserved.

The next private source reviews retain explicit blockers: repository identity v2 needs race-safe reads; T17 v2 needs PNG/private-JSON permission distinctions and complete reference identity freshness; T16 controller v1 needs reachable failure budgets, owned in-flight drain, independently bound observations and transactional secret-safe publication. Repairs remain In progress. T15 collector v3 source is integrated and passes 26 controls in each root; actual cold attempts remain zero; Detox v5 and iOS-after-Android integration are under review/preparation. No private candidate creates native, public or cold passing evidence.

T15 collector hardening v3 is Done (source) after independent semantic/path review, a fresh 671-root qualified overlay and guarded three-file transfer into both roots. The collector binds canonical requirement/assertion/cohort ledgers and original receipt bytes/root/ownership; it accepts sequential PID/port reuse with non-overlapping windows and distinct process-start identities, while rejecting forged, foreign or overlapping ownership. Both-root 26-control runs, zero-warning scoped lint, formatting, impact/inventory freshness and the actual qualified full typecheck pass. The 400-receipt positive control uses synthetic fixtures; it does not execute or qualify any cold attempt. Actual paired native trials, T17 restoration evidence, owned runtime dispatch, hosted gates and retirement remain Pending. Only QA contracts and source tests changed; no product/provider/authentication/localization update is needed. Evidence: `t15-collector-hardening-reviewed-source-integration-2026-10-02-v1`.

#### Preserved validation snapshots

Android consumer v6 is **blocked before canonical transfer** by independent findings V6-001 and V6-002: receipt/frame/command readers can consume unbounded bytes after their pre-read stat cap, and raw frame/command/checkpoint readers lack the complete descriptor/path identity and single-link post-read fence. Root corroboration exercised the actual validator with tiny original files: PNG mode and hardlink drift after a read was incorrectly accepted with 30 frame paths. The separate hierarchy-mode drift control was correctly rejected downstream and remains preserved. V7 must bound actual reads, preserve cancellation between chunks and compare original descriptor/path metadata across every reader; its complete Expo validation must include the exact frozen canonical-layout candidate bytes, not stale overlay copies. The 24 prior focused controls remain source snapshots. Evidence: `android-public-session-dependency-independent-review-v6-2026-10-02-v1/review.private.json` and `android-session-consumer-v6-root-read-fence-repro-2026-10-02-v1/verified-source-finding.private.json`. Android dispatch/staging and all native/public/cold counts remain Pending/zero; no auth/provider/product/localization change is introduced.

BL-018/T18 backend output repair is **Done (source, independently reviewed)**. Selected `playwright-integration` suites now set `has_web_server=true`, consistent with `playwright-server`; browser/native-only outputs and accepted/invalid platform scopes retain their contracts. Both roots reproduced two failing-before cases and now pass all **74 output, resolver and selective-execution controls**. The actual qualified full Expo typecheck, zero-warning scoped lint, formatting and impact validation pass. Both inventories contain **394 files (331 client, 63 server)**. Only the resolver delta and portable regression were transferred; manifest/helper/workflow bytes, inactive suite activation, trust/status/SHA and backend boundaries remain unchanged. Hosted adoption, native/public/cold qualification, comparison, exploration and T20 remain Pending with zero passes. Evidence: `t18-backend-output-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json` and `t18-ci-backend-output-repair-v2-independent-review-2026-10-02-v1/review.private.json`. This QA-only correction needs no product requirements, screen, localization or backend-provider change.

The remaining adapter frontier is **In progress**. Android consumer v6 is independently blocked on unbounded reads after pre-stat caps and incomplete raw frame/command/checkpoint descriptor/path identity fences; a coherent v7 repair is being prepared. Android runner/stager/dispatch v3 review blocks transfer on stale dependency, synthetic positive seams, receipt/readback and destination identity gaps, incomplete canonical closure and non-durable selection; v4 repair is being prepared against v6. iOS finalization v2 review blocks transfer on original receipt binding during staging, abort/deadline fences, exact helper closure and missing complete producer-to-verifier controls; v3 repair is being prepared. Actual Detox connection caller v2 review blocks transfer on late-abort/PID identity, in-flight cleanup and per-action cancellation, original screenshot/XML provenance, synthetic ledger acceptance and config/test source binding; v3 repair is being prepared. None of these private candidates is canonically qualified. Native/public/cold counts remain zero and comparison, exploration, hosted adoption and T20 remain Pending. Evidence: `android-public-session-dependency-source-preparation-2026-10-02-v6`, `android-public-session-runner-independent-review-2026-10-02-v3/review.private.json`, `native-session-public-finalization-independent-review-2026-10-02-v2/review.private.json` and `detox-connection-adapter-independent-review-2026-10-02-v2/review.private.json`.

BL-018/T18 inactive session registration v2 is **Done (source, independently reviewed)**. The existing private Detox session spec is registered with `ci: false` and an explicit non-selective profile with no selective phases; the owned native pilot retains its separate backend/credential boundary. Exact edits to that spec trigger conservative full fallback. Both resolver and execution contracts pass **67 controls in each root**, including iOS/Android execution/preview rejection and unsafe `ci: true` activation rejection. The original 21 failing selective controls remain preserved. Required impact validation, complete inventory checks, qualified Expo typecheck, zero-warning lint, formatting and touched diff checks pass. Both inventories remain **393 files (330 client, 63 server)**. No workflow/trust/status/SHA or protected-matrix activation changed. Native/public/cold passing counts remain zero; actual adapter qualification, hosted proof, comparison and full T20 completion remain Pending. Evidence: `session-baseline-impact-registration-source-2026-10-02-v2/root-source-validation.private.json` and its independent v2 review. This QA-only change needs no product requirements, screens, localization or provider update.

The inactive session registration v1 is **blocked by independent review**: the named `owned-integrated-session` profile was absent from the strict fixture registry and invalidated even existing selective plans. V2 adds an explicit non-selective registry entry with no selective phases, consistent with the existing non-selective profile contract. This entry describes the owned pilot boundary; it creates no fixture/backend/credentials and supplies no generic CI execution. Selective execution, including preview, must reject this suite, and setting only `ci: true` must still fail the non-selective-profile guard. The actual owned native adapter/qualification remains Pending. Add real execution-contract controls and retain the 21 failing-before selective checks. Product behavior and auth/provider/copy stay unchanged. Evidence: `session-baseline-impact-registration-independent-review-2026-10-02-v1/review.private.json`.

BL-018/T18 impact registration is **In progress (source)**. The required impact validator reproduced an unregistered existing `e2e/detox-integrated-session-baseline.e2e.test.js` in both roots. Register it as `detox:integrated-session-baseline` with both platform metadata and `ci: false`; its private owned backend/credential inputs and native qualification remain Pending. Add that exact spec to conservative full-fallback paths so registration cannot turn its edits into a silent no-test selection. Retain all existing suites, web-only PR routing, trust/status/SHA gates and native/public counts of zero. Evidence: `detox-xml-v3-root-integration-2026-10-02-v1/primary-impact.private.log` and `qualified-impact.private.log`. This changes QA selection metadata only; no FR/UC/AC/BR/copy/provider update is needed.

Public iOS session finalization v1 is **blocked before integration**: its real adapter always returns `publicFinalization: null`, so the proposed runner branch is unreachable. A private v2 repair must construct the candidate from actual owned capture, complete original evidence, staged dependency and independent cleanup, then qualify it in the unchanged Expo graph. The strict auth predicate and source-only `0/0/false` boundary remain unchanged. Evidence: `native-session-finalization-v1-root-reachability-audit-2026-10-02-v1/audit.private.json`.

XML hierarchy bridge v3 is **Done (source)** after independent review and guarded integration into both roots. Its SAX parser uses pinned `sax@1.4.4` and `@types/sax@1.2.7`, with the Yarn-generated Node type dependency preserved. All 21 bridge/resolver controls pass in both roots; the clean qualified cohort contains 30 passing controls, and the actual Expo typecheck, candidate inclusion, zero-warning lint and formatting pass. Two review overlays were preserved outside the qualified source graph before final checks. Both inventories now contain **393 files (330 client, 63 server)**. Primary dependencies follow the existing parent workspace hoisting; the qualified install validates the standalone frozen lock. The primary deleted plan source remains preserved. Evidence: `detox-xml-v3-root-integration-2026-10-02-v1/root-source-validation.private.json`.

The XML bridge is a bounded raw conversion helper. T14-C actual Detox caller actionability/provenance, public finalization, native qualification and all platform/engine comparison gates remain **Pending**. Native/public/cold passing counts remain zero. This QA-only change requires no product FR/UC/AC/BR, screen, localization or provider update.

Android consumer v4 independent review is **blocked before canonical transfer**, despite its passing actual Expo typecheck and 17 focused controls. The transport/auth producer still writes with the 256 KiB query kind instead of its declared 1 MiB bound; an untyped query-source receipt incorrectly falls back to 16 MiB; and cleanup accepts an unobserved cache absence. V5 must repair producer and consumer together and exercise the complete six-phase validator with real-shaped original receipts and valid screenshot bytes. XML v3 repairs the generated lock dependency and is awaiting independent review; actual Detox caller actionability and public/native qualification remain Pending. Evidence: `android-public-session-dependency-independent-review-2026-10-02-v4/review.private.json` and `detox-xml-hierarchy-bridge-source-2026-10-02-v3/manifest.private.json`.

The next integration frontier remains **In progress**. Android runner/stager v1 review reproduced acceptance of an incomplete one-file manifest and found original-receipt, exact-bundle, final selection/root and cleanup-failure gaps; a coherent private v2 repair is required. XML v2 review accepted its bounded raw source but blocked transfer on the missing published `@types/sax` → `@types/node` lock dependency. It also reproduced hidden/foreign-frame control acceptance: the actual Detox caller must prove visibility, iOS hittability, stable frame and exact XML/getAttributes capture provenance. XML v3 dependency repair and the actual dedicated caller are separate pending source packets.

The source audit also confirms that the current iOS public session branch intentionally ends as `runtime-source-only`. Private loader/stager verification alone cannot create an eligible public/native receipt. The remaining implementation must add finalization against actual owned capture, complete six-assertion evidence, unchanged selection/source, target/build/API identities, real timings and independently passing cleanup, while preserving the existing auth transport predicate and pending policy decision. Android consumer v4 is frozen for actual qualified-config and independent review; its earlier NodeNext overlay errors are not the authoritative Expo project gate. Native host availability is awaiting the resource question; source preparation continues. Evidence: `session-detox-contract-frontier-audit-2026-10-02-v1/audit.private.json`.

The Android public selection has a fresh **source-only** positive control against the real qualified inventory: `SCN-session-android` with Android/Maestro/integration succeeds without an injected post-selection fixture; wrong-platform and absent-scenario controls reject. The primary deleted plan source is still preserved. This qualifies the selector only, not the pending candidate runner/consumer/stager, a device or a native/public pass. Evidence: `android-session-qualified-selection-source-proof-2026-10-02-v1/proof.private.json`.

The server route mismatch has a fresh bounded source proof: the clean `a422aadee4d568c22d7f49a6ed86c645638c4358` server checkout matches the freshly queried remote main, and both existing mobile route-contract controls pass using the explicit unit-source profile. This covers direct and helper-built route registration only. The prior full C7 unit failure remains preserved, the native C7 server baseline is unchanged, and no endpoint, provider, native or deployment result follows from this proof. Evidence: `fresh-main-route-contract-source-proof-2026-10-02-v1/proof.private.json`.

The frozen consumer v2 independent review is **blocked** before integration. The real capture exposes transport/auth paths and original frame/command records, while the candidate requires receipt envelopes the producer does not yet emit. Its charter hash, assertion-to-original-receipt bindings and parsed ownership-ledger command identity also need repair; actual producer and consumer byte bounds must agree. Nine private controls and scoped lint/format passed, but no clean full qualified TypeScript proof exists for that packet. V3 fixes only transport/auth publication and cannot complete this contract by itself. V4 coherent repair, actual public runner/stager wiring and the dedicated Detox connection caller are being prepared in separate private packets. Evidence: `android-public-session-dependency-independent-review-2026-10-02-v2/review.private.json`.

Android profile/domain checkpoint copying is **Done (source)** after independent v4 review and root integration into both source roots. The producer preserves the original bytes and receipts for all four profile/domain pairs before cleanup, revalidates API identity after its final source read, and checks cancellation after the final awaited probe. The real producer is included exactly once in both capture helper ledgers. A new regression reproduced missing producer ownership in the iOS training and save-retry declarations; the generator now binds that hashed input in all ten owner/freshness rows. Before-fix evidence is retained.

The current combined source gate contains **134 controls**; root final validation and independent declaration review are recorded in `android-checkpoint-producer-v4-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`. Both test inventories contain **392 files (329 client, 63 server)**. The qualified declaration contains 23 source views, 40 transitions, ten untested scenarios and zero runtime receipts. The primary deleted plan source and its native declaration remain preserved.

The Android consumer v2 repair remains **In progress** in private files; its original command/transport provenance, six assertions and available cleanup census must pass independent review before integration. Public Android session dispatch and runtime qualification remain **Pending**. The Detox XML bridge v1 review found real attribute-shape, dependency and duplicate-attribute gaps; private v2 repair and an actual connection caller remain Pending. No native/public/cold passing attempt is created by these source changes. Native host disk recovery, the pending auth-policy decision, platform/engine comparison, agent exploration and protected hosted acceptance remain open.

This changes QA infrastructure and traceability only. Product requirements, use cases, acceptance criteria, business rules, screen copy, localization and backend-provider behavior require no change.

Current authoritative checkpoint (2026-10-02): restart binding and Android Detox
producer are **Done (source)** with 68/68 focused controls, full isolated TypeScript,
zero-warning scoped lint and format. Public iOS session dispatch is **Done (source)**
with its separate 92-control receipt; current MCP v8 source has 40 passing controls
and fresh runtime v9 now qualifies the short protocol with clean independent sealing. Locale v4 is Done (source) with its later 90-control gate; credential diagnostic v6 is Done (source) with 125 passing controls, including actual all-five-family closure checks. Runtime remains Pending.
The broad 2,133-pass / 34-skip baseline predates these latest integrations and is
snapshot evidence. The corrected v2 frozen broad baseline has 2,196 passes, one real server-route contract failure and 34 skips, with server baseline ownership Pending. Current test inventory
contains 392 files (329 client, 63 server). Native/public/cold passing attempts remain **0**; cookie/auth
policy, actual diagnostic capture, platform/engine equivalence, exploration and
protected hosted acceptance remain open. Historical sections retain their exact
source snapshots and are not current qualification for newer helpers.

Portable iOS session dependency loading is **Done (source)** in
`scripts/testing/native-session-public-dependency.ts`, with six passing controls
in `tests/ci/native-session-public-dependency.test.ts`. Fixtures are synthetic
and disposable; historical v7/v8 captures and developer paths stay private.
The real contract accepts body-credential sign-in with no Authorization/Cookie
header while retaining coach identity and ordered request checks. Full isolated
typechecking, zero-warning lint and formatting pass; both test inventories currently contain
388 files (325 client, 63 server). The helper checks current source/helper bytes,
all six session assertions, complete UI/API/SQL evidence, stopped transport and
clean cleanup, and always returns `publicPromotionEligible: false` at this
source-only boundary. Actual capture, public adapter/staging and native
qualification remain Pending. Proof:
`ios-session-loader-portable-source-integration-2026-10-02-v1`.

Public connection dispatch is **Done (source, independently reviewed); runtime
qualification Pending**. All 25 focused controls, isolated TypeScript checking,
zero-warning scoped lint and formatting pass. Cleanup is reported as cleaned
only when both capture cleanup and independent cleanup explicitly pass;
unknown or failed capture cleanup retains the recovery ledger. The public native runner selects the existing iOS or
Android connection adapter for the matching integrated Maestro scenario and
uses the existing platform-aware connection stager/re-verifier. Seven canonical
assertions, current selection/source identities, actual phase timings and owned
cleanup remain required. Detox/fixture and mismatched-platform selections stay
unsupported. No native execution or pass is created by wiring. The historical
iOS connection v13 failure remains immutable and unexplained; do not retry it
unchanged. Session/camera dispatch and equivalent engine/platform/comparison/
exploration/hosted gates remain Pending. Private source unit:
`native-connection-public-dispatch-source-2026-10-01-v1`.

The latest instrumented iOS session v8 attempt is terminal **harness-blocked /
cleaned and sealed**. All 12 frames and four profile/domain pairs were acquired.
The actual stopped signed-out window is `(31, 32]`: request 32 is native,
forwarded `POST /analytics/events` with status 202, no Authorization header,
and a nonempty known access-token cookie. Refresh/other/malformed cookies are
absent. This establishes cookie transmission after signed-out relaunch; the
public analytics route does not establish an authenticated principal or token
validity. Do not infer the exact header class of historical v7 from this run.

Independent cleanup passed with 207 PID/start pairs absent. The immutable seal
verifies 173 originals, 767 frozen inputs and 69 unchanged helper inputs. Capture
`a535fded29337290ef9ac2d6`; private proof:
`ios-session-v8-runtime-2026-10-01-v1/sealed-terminal.private.json`.
Native/public passing cases remain zero; the existing strict predicate is
unchanged. Native cookie handling and the scope of the coarse credential gate
require an explicit contract decision before any product/auth change. Preserve
FR-270/BR-342 local native bearer clearing and the decision gate for server
revocation; do not remove a failure simply to obtain a pass. Independent work
on other families/platforms/engines and exploration continues. Source is
unfrozen after this seal; only root integrates reviewed canonical changes.

The complete iOS session v7 attempt is terminal **harness-blocked / cleaned**:
all 12 frames and four distinct profile/domain checkpoint pairs were acquired,
but the stopped transport check rejected `Signed-out request carried credentials`.
The original proxy recorded only presence of any Authorization or Cookie header;
it cannot establish which header caused the rejection or whether the request
was authenticated. Preserve the failure; diagnosis remains Pending.

Independent cleanup passed with 252 PID/start pairs absent. The immutable seal
verifies 173 original artifacts, 767 frozen source inputs and 69 unchanged helper
inputs. Native/public passing cases remain zero. Capture:
`3d0ac5acda97d7080ed06f85`; private proof:
`ios-session-v7-runtime-2026-10-01-v1/sealed-terminal.private.json`.
All commands completed and cleaned. The independent source review and final
78 focused controls, isolated typecheck, zero-warning scoped lint and format
passed before this run. The full isolated unit baseline reports 2,051 passed,
zero failed and 34 existing skips (2,085 total), using the recorded cached server
app source only for unit alignment; native server baseline remains unchanged.

The next source-only diagnostic records fixed header classifications without
values, arbitrary cookie names or token hashes, and saves the actual closed
request window before rejection. It preserves the existing rejection predicate;
no auth-policy change or cause is inferred from the old presence boolean.
Private proof: `session-credential-diagnostics-source-2026-10-01-v1`.
Independent review accepted this source unit with no findings; 40 focused and
six declaration controls, typecheck, zero-warning lint and format pass. The
isolated declaration and both 374-file inventories are refreshed. The instrumented v8 acquisition and seal are recorded above; this source unit
creates no native/public pass.

Android session adapter integration is **Done (source, independently reviewed)**.
The current-project repairs preserve bounded transport quiescence, owned abort
and diagnostics, and require session qualification only for the auth/session
lane. Thirty-five focused controls, full isolated TypeScript, zero-warning lint
and formatting pass. The capture helper closure includes both new transitive
Android helpers. Actual native/session/public dispatch remains Pending. Proof:
`android-v8-root-integration-validation-2026-10-02-v1`.

Reviewed iOS camera acquisition/submission evidence and generator integration are
**Done (source)**. Nine camera controls passed; the combined current cohort
reports 65/65 passing after real isolated declaration regeneration. Full isolated
TypeScript, zero-warning scoped lint and formatting pass. The genuine app source
owns the four ordered camera assertions (`NAT-camera-normal-entry`,
`NAT-camera-denial-guidance`, `NAT-camera-manual-submit`,
`NAT-camera-unrelated-state`) on both platform declarations. The disposable
no-HEAD generator failure and first missing-helper closure failure remain
preserved; neither fallback data nor a fabricated HEAD was promoted. Public
camera dispatch is Done (source, independently reviewed) with API-origin separation,
explicit assertion bindings including unrelated training state, and preserved/
reverified metadata and cleanup sidecars. Staged positive/tamper controls pass;
actual native/public camera qualification remains Pending and native/public passes
remain zero. Proof: `camera-reviewed-source-integration-2026-10-02-v1`.

The reviewed connection post-tap diagnostic is **Done (source)**. It observes
owned evidence immediately after the initial sign-out CTA, saves it before the
mandatory confirmation lookup, and retains it on failure. Existing selectors,
final signed-out assertion and no-retry rules remain unchanged. Three portable
helper controls and the 65-case combined source cohort pass; TypeScript,
zero-warning lint and formatting pass. This is a changed diagnostic input for
a possible next attempt; it does not explain or reclassify historical v13.
Proof: `connection-posttap-canonical-integration-2026-10-02-v1`.

The actual short Maestro MCP protocol probe v5 is **locally qualified / cleaned
and independently sealed**. Initialize, initialized notification and tools-list
produced five envelopes and nine advertised tools. No tools/call, device, ADB,
backend, cloud or exploration action was executed. Independent process/group/
socket absence passed; 285 frozen inputs and one loader link remain unchanged.
Proof: `t16-b-direct-stdio-runtime-2026-10-02-v5/root-sealed-terminal.private.json`.
The original v4 cleanup-blocked terminal remains unchanged despite later
independent absence proof. Earlier v2 topology and v3 mode preflight rejections
remain preserved. This result qualifies only the short protocol; native,
public and exploration passing cases remain zero.

Full MCP runtime qualification remains Pending. The bounded I/O v6 candidate
passed 33 controls, but independent review reproduced concurrent spool byte
undercount, expired-deadline acknowledgement, Node ESM worker startup failure
and lost late-response classification. Independent v7 review found four further blockers: malformed source hash,
actual-project TypeScript errors, canonical lint/format failures, and missing
on-disk aggregate digest verification. MCP v8 is now Done source after independent review and canonical integration;
actual full runtime remains Pending. Earlier candidates and failures remain immutable.

Detox v2 current-project integration is Done (source, independently reviewed),
using all four actual Android adapter exports with no shim and validated artifact
projection. Root combined controls report 63 passed; full isolated TypeScript,
canonical zero-warning lint and formatting pass. Actual iOS coach runtime and
Android producer/student wiring remain Pending.

The iOS locale library is Done (source, independently reviewed) with 29 controls,
full isolated TypeScript, canonical zero-warning lint and formatting passing.
Actual auth/profile/terms/domain callbacks and owned reader/fixture binding are
In progress / Pending. PublicLocale remains null until real qualification.
No private test may require historical native captures or developer-specific
paths after transfer.

The native bearer-only cookie proposal remains **Pending user contract decision;
no auth patch applied**. Preserve FR-270/BR-342 local clearing, browser cookie
behavior and separate server-revocation scope. Independent QA work continues.
Retain T00–T20, all five families on both platforms/engines, 400 cold attempts,
actual bounded exploration, controlled regressions and hosted adoption/retirement.
This QA source unit changes no product/auth/provider/copy behavior; FR/UC/AC/BR/
screen/localization updates are not needed. Preserve the primary deletion of
`features/plans/plan-source.ts`; its native inventory is not regenerated or
copied from the different isolated app source. Both test inventories now contain
381 files (318 client, 63 server). Recheck host, disk, build and current source
bytes before any changed-input native acquisition.

Shared session profile verification is **Done (source)** in
`scripts/testing/native-session-profile-checkpoints.ts`. One comparator now
validates all four owned profile and domain checkpoints for either platform,
complete fixture profile coverage, exact native sign-in/hydrate request windows,
coach UID/API/allowlist identity, actual persisted-profile UID hashes supplied
by the owned reader, narrowly permitted coach timestamps, and strict final
state. Thirty combined controls pass (26 new session controls and four retained
connection controls); full isolated typecheck, zero-warning scoped lint and
format pass. The helper consumes parsed evidence; capture acquisition, owned
file/hash loading, iOS/Android/Detox wiring and native/public qualification
remain Pending. It creates no receipt or native pass. The native declaration
now owns this helper for both session scenarios. Proof:
`session-profile-checkpoints-source-integration-2026-10-01-v1`.

Session profile coverage is **Pending**, with its complete verification
contract now explicit. `NAT-session-unrelated-state` requires owned profile
snapshots before login, after login, after restored hydration and after
signed-out relaunch. Only the bound coach profile `updatedAt` may advance in
separate verified initial sign-in (POST 201) and restoration hydrate (POST 200)
spans; every other field/actor/table is unchanged, and post-restoration through
logout is strictly unchanged. The existing plans/connections-only snapshot
cannot qualify this assertion. Android, iOS and Detox candidate adapters are
being corrected; no native/public passing case is added. This is test-contract
preparation under BL-018/D-218, not a product/auth/provider change. Proof packet:
`session-profile-snapshot-contract-preparation-2026-10-01-v1`.

T16-A source completeness is **Done (isolated mirror)**. The existing
preparation script, seven tests, playbook and five charter files were absent
from the isolated checkout despite its registered package alias. All eight
files now match the implemented primary source; seven focused controls, full
isolated typecheck, zero-warning lint and format pass. Both test inventories
now contain 372 files. The actual package command correctly exits 2 and emits
private blocked/not-run preparation when runtime context is unavailable. App
source remains `b6f5c1dd575086fb2e247712af1993e52505e53cb1144d2ffee5f1897d94c534`;
package/native/app/auth/provider behavior is unchanged. Actual exploration and
regression conversion remain Pending. Private proof:
`exploration-preparation-isolated-source-mirror-2026-10-01-v1/root-source-validation.private.json`.

Native declaration freshness is **Done (source)**: the generator fingerprints
`declaration-contract.md` for stable behavior, selectors and ownership while
`testability.md` remains the operational evidence ledger. A real status-file
edit keeps selection hashes unchanged; a same-path contract edit rejects stale
selection. All 21 focused declaration/closure/inventory/runner controls pass
without failures/skips; isolated typecheck, zero-warning lint and format pass.
Both clients retain the same source bytes. No product, backend, auth, copy,
native runtime or hosted behavior changes. Primary declaration generation
remains blocked by the preserved `features/plans/plan-source.ts` deletion; no
isolated inventory is copied over it. Private proof:
`native-declaration-contract-status-source-integration-2026-10-01-v1/root-source-validation.private.json`.

The first integrated iOS locale collector capture is terminal **observed /
cleaned and independently sealed**. Capture `7bff718eb4a81baddfa2f5bf` retained
actual `en_US` OS stdout, normalized `en-US`, matching expected/captured
source/helper/device/build bindings, and a hydrated `LocaleContext` entry tree
with effective `en-US` and absent override. All three owned commands completed;
independent cleanup passed with 36 PID/start pairs absent. The seal verifies
41 original artifacts, 764 frozen source inputs and unchanged helper inputs.
It reused qualified v12 app bytes with fresh owned resources. This validates
the preparation collector; full locale reset/relaunch qualification remains
Pending, public locale stays null and native passing cases stay zero. Private
proof: `locale-native-collector-entry-2026-10-01-v1/sealed-terminal.private.json`.
Canonical source is unfrozen after this seal.

Locale capture binding integration is **Done (source)** under D-218.
The reviewed v5 patch connects actual owned OS-locale command records and
private stdout to the existing canonical binding/parser and hierarchy-file
adapter. Expected inputs come from pre-capture source/helper/device/build
receipts; captured inputs come from final report metadata. Empty output is
distinct from missing output, unsuccessful command ownership propagates, and
locale projection errors cannot misreport resource cleanup. The result remains
preparation-only with public locale null and zero native passing cases; runtime
hydration/reset/relaunch qualification remains Pending. Product/auth/copy and
backend behavior are unchanged, so FR/UC/BR and localized-copy artifacts need
no update. Validation: 51 combined locale/lifecycle/reuse/storage controls pass with zero
failures/skips; isolated typecheck, scoped lint with zero warnings and format
pass. Private proof:
`locale-capture-binding-source-integration-2026-10-01-v1/root-source-validation.private.json`.

Latest private iOS connection v13 is terminal **harness-blocked / cleaned and
sealed; native and public qualification remain Pending**. The fresh
current-source run retained 44 runtime diagnostics: 43 completed and one child
failure at `connection-switch-3-student-signed-out`. Its callback ran once but
did not complete, and verification was not executed. Capture cleanup was
`cleaned`; external cleanup and root-independent cleanup passed, with 602
PID/start pairs absent. Three same-flow password-offer witnesses were retained.
Native and public passing cases are zero. Request
`d67732fb62492584c92dad35`, capture `9aaa98ce9e19b6cce4627d81`, backend
`2585ad8c1771f431eed3d4e2`. Private terminal packets:
`connection-native-mutation-source-2026-10-01-v1/observed-native-v13-terminal.private.json`,
`runtime-outcome-v13.private.json`, `root-independent-terminal-v13.private.json`
and `source-freeze-v13.private.json`. The seal verifies 311 original artifacts,
760 frozen source inputs and 64 unchanged helper inputs; source tree hash
`b6f5c1dd575086fb2e247712af1993e52505e53cb1144d2ffee5f1897d94c534` is
unchanged. Root's visual review saw the account page still showing the
Signout button and no confirmation visible. The sign-out tap completed, but
the retained hierarchy after the bounded lookup contained no confirmation
subtree. The private bounded diagnosis compares this with v12, where the same
exact YAML and app/source hashes completed the confirmation flow; the cause is
unknown. It does not establish a product defect or exact tap cause, so no blind
retry or product/source change is justified. Private diagnosis:
`connection-signout-v13-diagnosis-2026-10-01-v1/diagnosis.private.json`.
Source is unfrozen after the sealed run; do not rerun unchanged inputs.

The v13 entry observation retained the four closed locale IDs
`testing.locale.diagnostic`, `testing.locale.effective.en-US`,
`testing.locale.hydration.hydrated` and `testing.locale.override.absent`.
Observed OS locale, reset/relaunch qualification, hydrated runtime proof and
public locale remain **Pending**, with public locale `null` and zero native or
public passing cases.

Latest source-only full isolated unit against the complete owned server
checkout at cached SHA `a422aadee4d568c22d7f49a6ed86c645638c4358` passes:
2,005 passed, zero failed/cancelled, 34 existing skips (2,039 total). The
existing `MYCHAMPIONS_SERVER_APP_PATH` override selects that checkout; no test
expectation, auth policy or dirty server source changed. The earlier default
server run's missing-confirm-route failure remains immutable. The first
alignment run also retains 25 stale-declaration failures; regeneration after
documentation/source updates resolves those guards. This is client unit and
source-contract proof, not server runtime/deployment or native backend
alignment. The cached ref was not network-refreshed. Private proof:
`client-full-unit-cached-server-alignment-2026-10-01-v1/root-verification.private.json`.
The primary deletion of `features/plans/plan-source.ts` remains preserved.

A local source-only baseline alignment check is **Done (test-only)** against a
complete disposable server checkout at the already cached exact ref
`a422aadee4d568c22d7f49a6ed86c645638c4358`. D-215 and the ET-74 wiring entry
already define the confirm endpoint as merged. The existing
`MYCHAMPIONS_SERVER_APP_PATH` test override selects that owned checkout for
the client route/full-unit check; neither dirty server checkout, auth policy
nor test expectation changes. The cached ref is not refreshed network truth.
This does not qualify the current native backend or server runtime/deployment.

Previous private iOS connection v12 remains retained as **observed / cleaned
but verification-blocked and unqualified**. Its 49-command capture and four
strict same-flow password-offer witnesses remain immutable. Verification failed
because the evidence recipe constructed `coach-home-png` while the producer
recorded `coach-home.png`; the bounded filename correction is **Done (source)**.
Request `d0a2e9996d63d4ee97037c28`, capture `77f46f37fd4b5c1f78d4b4aa`, backend
`1b4c3a47837203eeee7ae080`. Native and public passing cases remain zero; its
original verification failure and v11 failed-recovery cleanup remain below.

A separate current T13-F qualification now validates only the retained v12
entry/build bytes: `loadReusableIosBuild` passed against current isolated
source tree `b6f5c1dd575086fb2e247712af1993e52505e53cb1144d2ffee5f1897d94c534`,
app binary hash `27650a748c8ac3b44fc70ddde9f3f6a8d6acbe02ebf0c0c5d40f42bca2644adf`,
embedded config/bootstrap/private-entry checks and independent cleanup. All
348 current and archived originals were verified unchanged before and after.
Entry receipt `entry-qualification.private.json` has SHA-256
`34231adc224800144f5c1d9109a045331e5ebd083fb907fba9862b09bda7b6f5`; the
root qualification is
`retained-v12-entry-build-reuse-qualification-2026-10-01-v1/root-qualification.private.json`.
This does not rewrite v12 verification, connection-journey status or zero
native/public passing cases. A future diagnostic may reuse these bytes only
with a fresh simulator, backend, fixtures, proxy, Metro, install and session,
plus a fresh entry receipt.

A bounded auth-account post-tap diagnostic is **Done (source)** in private
packet `ios-auth-signout-post-tap-diagnostic-2026-10-01-v2`. Its 13 focused
controls cover lifecycle, reuse and storage boundaries; they do not execute
native taps or establish a runtime/public pass. The source retains an
immediate private hierarchy and screenshot after both the initial and
post-restoration sign-out taps through the existing recorder/device-ownership
path, before the unchanged mandatory confirmation or signed-out lookup. It
adds no waits, retries or optional assertions, and diagnostic frames cannot
produce a passing outcome. Native/runtime qualification remains **Pending**;
product/auth/copy behavior is unchanged. Private proof:
`ios-auth-signout-post-tap-diagnostic-2026-10-01-v2/root-canonical-source-validation.private.json`.

That source packet now has a terminal private auth-account diagnostic: capture
`50ddeb1f3d43a32fd441b065` exited 0, was observed/cleaned, and reused the
qualified v12 build without fresh compilation. Independent cleanup passed with
191 PID/start pairs absent; the seal verifies 182 originals, 762 frozen inputs
and 64 helper inputs unchanged. Both initial and post-restoration post-tap
hierarchy/screenshot records have all four expected selector-presence booleans,
and the visual review saw the unobscured confirmation. Auth metadata was
present before and after signed-in relaunch, then absent after sign-out and
signed-out relaunch. Reuse timings were build 814 ms, install 7,031 ms, reset
36,456 ms, scenario 247,773 ms and cleanup 6,053 ms. This remains private
diagnostic evidence: native/public passing cases stay zero, and the earlier
v13 connection failure remains unchanged. Private seal:
`ios-auth-signout-diagnostic-runtime-2026-10-01-v1/sealed-terminal.private.json`.

Current T14-A/T14-D session and camera contract source integration is **Done
(source)** in both clients. The mirrored eight source/document files have
isolated declaration, schema and manifest proof for 23 views, 40 transitions
and 10 scenarios, with zero native cases; 17 full contract/inventory/runner
controls pass with zero failures/skips, and isolated typecheck, zero-warning
lint and format pass. Platform adapters and runtime qualification remain
**Pending**. Primary declaration generation remains blocked by the preserved
missing `features/plans/plan-source.ts`; the old primary declaration was not
copied or refreshed. Private proof:
`session-camera-contracts-integration-2026-10-01-v1/root-canonical-source-validation.private.json`.

Locale observer canonical source integration is **Done** with 13 rendered controls and all 60 component controls, isolated full typecheck, zero-warning scoped lint and format. The original provider fails a real delayed-read ordering control (a saved pt-BR selection reverts to en-US); the repaired provider preserves the selection and rejects stale fulfillment/rejection. The diagnostic is guarded to the existing development native variant/app IDs, carries closed values, and appears before auth without changing auth or user copy. Actual native hydration, reset/relaunch and public locale projection remain **Pending**. App-source changes require a fresh build for the next attempt; the old qualified bytes retain their original cohort. Private proof: `locale-app-seam-integration-2026-10-01-v1/root-source-validation.private.json`.

The v12 preliminary actual-entry hierarchy observation retained exactly four
closed locale IDs: `testing.locale.diagnostic`,
`testing.locale.hydration.hydrated`, `testing.locale.override.absent` and
`testing.locale.effective.en-US`. This is entry-tree observation only; OS reset,
relaunch, hydrated runtime qualification and public locale projection remain
**Pending**, with zero native/public passing cases.

A separate resource-free parser check read the retained `entry-hierarchy.json`
and observed hydration `hydrated`, effective locale `en-US` and override
`absent`. Its adapter remains **preparation-only** because the helper aggregate
and OS object are missing, binding/evidence are absent, public locale is `null`
and native passing cases are zero; full locale qualification remains
**Pending**. Private proof:
`locale-v12-file-observation-preparation-2026-10-01-v1/actual-file-check.private.json`.

T15 execution-order source guards are **Done** with 20 focused controls,
confirmed isolated repository typecheck, zero-warning lint and format. The
comparator seals alternating engine pairs, verifies within-pair and cross-trial
receipt chronology, and keeps authentic failed/cancelled attempts in the
denominator. Actual comparison execution remains **Pending**: source controls
do not qualify the 400-attempt cohort or cold reset. T18-C source integration is
**Done**: exact integration scenario/project selection and the owned server
checkout pass 89 combined controls, isolated typecheck, zero-warning lint and
format. Preview-only plans cannot execute; ignored QA scratch symlinks cannot
break the Git-scoped source scanner. Integration suites remain `ci:false` pending hosted proof.
These checks acquire no native/browser/backend resources. A private locale
validator passes ten controls after provenance/normalization/binding
corrections; device-qualified hydrated app-locale observations and canonical locale
projection remain **Pending**. The earlier 98-control focused cohort and the 100/100 YAML-repair cohort are historical source cohorts. The pre-recipe source cohort is 109 controls: YAML 100 + file-adapter 3 + web-profile 6. These source/static controls do not qualify native or public runtime evidence.

Primary full typecheck is currently blocked by the unrelated deletion of
`features/plans/plan-source.ts`. That external change is preserved; the source
checks above passed in the isolated checkout containing the original module.

T14-C private v8 is terminal **harness-blocked / cleaned**, with independent
terminal cleanup **passed**. Request `3603d71e1d6980fd5338e3db`, capture
`4894eeeea209ffb0d2991efb`, backend `98b459786d2c033b20726ad9`.
Verified native sign-in returned 201. The shared helper observed the exact Save
Password prompt, waited for animation, and tapped the exact Not Now button with
Maestro's bounded retry option. Its prompt-absence postcondition failed before
the connection callback, preserving the blocked result. All 215 frozen inputs,
the entry script, source/helper identities and four absent terminal listeners
are verified; 57 recursive original artifacts are indexed. A fresh independent
cleanup inspection passed. The dismissal source guard is implemented, but native
interaction qualification remains **Pending**. Zero connection/public passes.
Pause this repeated native branch for pinned-runner diagnosis before another
materially changed attempt; do not rerun unchanged inputs or relax the prompt
postcondition.

T14-C private v7 is terminal **harness-blocked / cleaned**, independent cleanup
**passed**. Request `1d3ae286d78d0f8341aaeff6`, capture
`a0d68fc84b0d872dbc9a0297`, backend `35aa32d3429017da00581f87`.
The verified native sign-in returned 201 and normal reads returned 200. The
password-offer dismissal tap reported completed, but the failure screenshot
still shows the system Save Password dialog over the loaded dashboard. Coach
home visibility failed before the connection callback. All 214 frozen inputs,
source/helper identities and four absent terminal listeners are verified;
original commands and failure artifacts are retained. This is an unqualified
system-dialog interaction; product failure is not established. The shared
prompt-visible, settle, exact dismissal and prompt-absent source correction is
**Done** with ten resource-free controls, repository typecheck and zero-warning
lint/format. Native qualification remains **Pending**. The helper cannot resubmit
sign-in or replace the original blocked attempt with a passing retry.
Zero connection/public passes; public dispatch remains gated.

T14-C private v6 is terminal **harness-blocked**, before backend readiness or
native callback. Request `bc4a480233736c5e9fcaef39`, capture
`79bf3cc2528bd41d29ee8db1`, backend `02ddb9965e203ccbd3b21364`.
The launch PATH omitted `/usr/local/bin`, so the server could not find Docker.
Original independent cleanup failed; the backend retained its recovery ledger.
The capture incorrectly reported cleaned after its session acquisition threw;
that propagation is now corrected with nine focused controls, repository
typecheck, zero-warning lint and format. Acquisition cleanup failures retain
`backend-acquisition` recovery status and bounded private diagnostics before
another attempt. Root archived all
four original server records and ran the existing exact-owner recovery command.
A separate current recovery proof confirms the owned process and simulator are
absent, 31 foreign device states and borrowed ADB are preserved, labelled Docker
resources and reserved listeners are absent, and 214 frozen inputs are unchanged.
Original failed receipts stay unchanged. Zero connection/public passes.

T14-C private v5 is terminal **observed / cleaned**, with independent cleanup
**passed**, but post-capture verification **failed**. Request
`a84025c3430828c16c136414`, capture `a6be0421d31c582d03261cc2`, backend
`d544a45b5666d1bc6762b4a4`. All 57 owned commands completed and the normal
invite, confirmation and active lists completed. The mapper rejected
`normalCoachBefore`: four controller references used kebab-case semantic keys.
Preserve the complete original packet and failed verification; zero public
connection passes. The controller now has a closed twelve-key camelCase contract,
canonical kebab-case filenames, and a complete-reference seal before publication.
Six resource-free journey controls pass. Fresh qualification remains **Pending**;
public connection dispatch stays gated.

SC-205 source correction is **Done**. The v5 native journey observed the active
target in the refreshed coach roster and student list; full T14-C qualification
remains **Pending** because of the separate evidence-contract failure above.
Current-UID/focus/latest-request guards reject stale roster and bulk completions.
Six rendered controls pass, and the original isolated screen fails the return
control (expected two roster reads, received one). SC-205/FR-105/FR-121/UC-002.2/
UC-002.3/AC-206/AC-214/TC-206/TC-214 and D-218 trace this correction.

T15 bounded locale and malformed-receipt guards are **Done** with 15 focused
controls. Schema-invalid bindable attempts remain in the denominator and cannot
populate typed receipt evidence. Unknown or mismatched locale cannot qualify.
Reviewed cohort/source/reset fingerprints and unique reset-slot identities are
now enforced with 16 focused controls. Actual runtime reset freshness, observed balanced
execution order and direct runtime/capture/independent-cleanup proof binding remain
**Pending**. The 400-attempt denominator
and 19/20 per-cell threshold remain unchanged. No new comparison runtime cohort
has executed. Android capture source integration is **Done** with nine resource-free controls,
repository typecheck and zero-warning lint/format. Closed account navigation,
strict sign-in/principal provenance, runtime actor validation and post-drain
evidence availability are enforced. Failed proxy shutdown leaves evidence
unavailable; computed actor allowlist and duplicate ordinal controls pass.
Actual Android journey/adapter/mapper qualification remains **Pending**.

Parallel independent preparation: T16-A `EXP-TWO-ROLE-CONSISTENCY` web/en-US
preparation exited 2 as **blocked / not-run**, with zero attempts, observations
or runtime evidence. The protected packet
`.qa/artifacts/t16-a-two-role-consistency-web-en-us-20261001-1/` records missing
target, build, connector, professional/student role, fixture and reset
qualification inputs. This preparation does not complete T16 execution.

T16-A Maestro MCP capability discovery is **Done (read-only)**. Six hosted
local tools were exposed; only `cheat_sheet` and `list_devices` were called.
No target was selected or qualified, no Android target was returned, and the
hosted MCP/server/tool version remains unavailable. A separate direct local JVM
stdio handshake observed a narrow local protocol result for its direct probe entrypoint: protocol
`2025-11-25`, server `maestro/1.0.0`, the exact nine-tool local surface, exit 0
in 0.376 seconds, and no tool call, device, backend, browser, cloud, network or
native action. Private proof:
`t16-maestro-local-stdio-handshake-2026-10-01-v1/handshake-report.private.md`.
That receipt does not version-bind the six hosted `mcp__maestro__*` declarations
or qualify a target. The post-observation identity supplement found 192 wildcard-classpath JARs:
only four match a prior sealed hash, 188 had no prior sealed hash and prior
timestamps are unknown. Full prelaunch runtime-classpath identity remains
**Pending** and requires a new future pin; no handshake was rerun. Private
supplement: `t16-maestro-local-stdio-identity-supplement-2026-10-01-v1/identity-supplement.private.json`. T16-B actual two-role exploration remains **Pending**, with
zero attempts, actions or observations. Current target/build/API/tool,
independent role sessions, hydrated locale, fixture/reset, budget and
independent cleanup proof remain required. Private packet:
`t16-maestro-mcp-qualification-2026-10-01-v1`.
The Android/en-US two-role preparation cell also exited 2 as expected
**blocked / not-run** with `PREPARATION_ONLY`, unknown connector version and
unqualified target/build/roles/fixture/reset. Attempts and observations remain
zero. Private preparation packet: `t16-maestro-mcp-qualification-2026-10-01-v2`.

Prior private v4: request `8f0377d396c8f57e534c89a2`, capture
`71bf3f8a72aa8672de89545c`, backend `7a8310596d935c5681cf8bd8`.
Terminal **harness-blocked**, native qualification **Pending**. The repaired
pending-roster containment passed. Normal student submission and coach
confirmation completed; the strict owned snapshot verified the active
relationship. Returning to the already-mounted coach roster showed only the
pre-existing active fixture student, and no new roster request followed the
confirmation. The active target-row visibility step failed. Investigate the
mount-only roster loading lifecycle against SC-205 before another execution;
retain the exact target, timeout and assertion purposes. Source and helper
identities stayed unchanged. Independent terminal cleanup passed; API, proxy,
Metro and Postgres listeners are absent. The protected terminal index retains
241 top-level originals. This attempt adds zero native passes and cannot qualify
build reuse. Public connection dispatch remains gated.

Prior private v3: request `8496c6519498a280b9a16227`, capture
`dd21c7c1c34c7b8f63338c2d`, backend `9cf8d024bb835bbc7a0048c3`.
Terminal **harness-blocked**, native qualification **Pending**. Fresh owned iOS
Debug build succeeded; normal coach navigation, student invite submission,
pending card guidance and normal student/coach authentication completed. All 37
owned commands completed with exit 0, but the roster verifier rejected the actual
iOS hierarchy: `Professional roster target row is outside the roster screen`.
This is a harness containment diagnosis, not a product defect or native pass.
Source and all 45 helper identities remained unchanged. Independent cleanup
passed for 242 PID/start pairs, with no survivors, missing foreign devices,
owned simulator/cache or Docker resources. Original 200 top-level evidence files
and binary hash are retained in the protected terminal index. The earlier ESM
entry and missing-Maestro PATH attempts remain blocked with zero acquisitions.
The roster helper now accepts only the observed leaf-screen/list-card shared
parent with exact matching host/screen bounds and contained list/row geometry.
The original frozen helper rejects the retained actual frame; the repaired helper
accepts it in a pure control. Sanitized regression and hostile controls pass;
new owned qualification remains Pending. Follow-up controls pass 52/52; isolated
typecheck and affected hierarchy/mapper/adapter controls pass. The last broad
client result remains the original frozen 1,963/1,964 with the unwaived route gap. Public connection dispatch remains gated.

Current source packet: `connection-native-mutation-source-2026-10-01-v1`
(source implementation **Done**; native runtime **Pending**). Implemented T14-C's existing
single-target, two-session normal UI journey with exact pending-row selection,
connection-ID active evidence and a dedicated owned iOS callback. Preserve the
seeded `connection-states` observer and existing public dispatch gates.

Separate normal actor-switch authentication from connection mutation spans:
only the switched actor's profile `updatedAt` may advance across a verified
native sign-in checkpoint. All other projected fields/tables stay identical;
submit and confirm spans still enforce strict profile equality. Preserve raw
checkpoint provenance and matching 201 native transport. No auth behavior or
server-revocation change. Synthetic invite/credential UI artifacts remain inside
0700/0600 private boundaries per specification Section 16; public outputs stay
redacted. Root owns docs, combined source transfer and all runtime resources;
four agents own disjoint verifier, capture seam, selector/hierarchy and opt-in
principal-observer files. Bind actual sign-in response UID to the transport
ordinal; status alone cannot prove the actor. Default proxy lanes stay unchanged.
Combined controls pass 51/51 with zero skips; typecheck, zero-warning scoped
lint, native inventory and test-impact checks pass. The private adapter and
seven-purpose evidence mapper enforce source, fixture, principal, transport,
hierarchy, snapshot, canonical proof and independent cleanup bindings. Full client
unit is 1,963/1,964; the existing `/auth/password-reset/confirm` route mismatch
remains unwaived. This packet introduces no auth behavior change. No native
pass, Detox retirement or hosted promotion is claimed.

Current packet: `connection-snapshot-source-preparation-2026-10-01-v1`
(source implementation and backend/bridge qualification **Done**; native UI
qualification **Pending**). Parallel client/server owners implemented the
separate read-only nine-table projection and strict identity/provenance checks.
Independent review tightened transition exceptions to exact observed rows and
added foreign/reused guard rejection. Generic training snapshots are unchanged.

Root serial integration `ed020c28266437a167a93414` passed all 21 files, including
normal invite lookup/submission/confirmation and unchanged other-scope state.
Independent cleanup verified 23 PID/start identities, DB/API listeners, Docker
project resources and private state absent. Actual client stdio bridge
`fe790c406f2e0fe205e4d113` passed strict unlinked/pending/active verification,
other-scope equality and unchanged generic training plans; stop and independent
cleanup passed (two identities, both listeners and owned resources absent).
Protected immutable snapshot copies and validated terminal receipts are retained.

Preserve failed original server attempt `836691a8912f552c800a89a2` (test fixture
scope registration missing) and bridge attempt `db95313f41874c8371ad280d`
(baseline captured before normal sign-in updated profile timestamps). Both were
independently cleaned. Capture the relationship baseline after normal actor
authentication; keep the strict stable-profile assertion. A passing session-close
receipt does not turn a failed semantic journey into a pass.

Current focused isolated controls: 13/13, zero skips. Client owner typecheck,
zero-warning lint and formatting pass; server typecheck/format pass. Full client
suite before the final guard-predicate repair: 1,921/1,922, with the existing
`/auth/password-reset/confirm` route mismatch still unwaived. Current scoped
regression was rerun after that repair. Earlier server unit controls: 249/249.
Native declaration remains 23 views/40 transitions/10 untested scenarios with
zero new public receipts. No native acquisition, auth/product/copy/provider or
hosted change occurred. BL-018/D-218 and full plan remain **In progress**.

Current source packet: `connection-ledger-source-preparation-2026-10-01-v1`
(source implementation, transfer and validation **Done**; runtime **Pending**).
Applied independently reviewed candidate v3
for seven canonical connection assertion purposes, exact Postgres fresh-attempt
fixture binding and immutable semantic guards. Prior owner inputs and the passed
iOS save-retry originals are archived. No native acquisition or product/auth/copy
change. Runtime invite/confirm, expanded SQL proof and both-engine/platform
qualification remain Pending. Both owners pass 27 focused controls, typecheck,
zero-warning scoped lint, format/native/test-inventory/impact/whitespace checks.
Primary full unit is 1918/1919 with the unwaived password-reset route gap.
All row requirements are scenario-declared; changed-kind controls preserve valid
unique kind lists before testing contract-hash rejection.

Current native runtime packet: `ios-save-retry-command-log-public-runtime-2026-10-01-v2`
(**terminal passed** at frozen inputs). Request `5e8af3d404644c14f0138e23`, capture
`a78118a49bbfd4a967ccb4a0`, backend `c50a3a8effe810cc6944dc6d`. Original tool
39705 exited 0; native child exited 0. All five public UI/API/SQL assertions
passed, qualifying one iOS Maestro Debug save-retry case. The capture completed
26 commands and cleaned its resources. Root independently verified 237 PID/start
identities absent, simulator/cache/Compose resources absent, all three listeners
absent, borrowed ADB and 31 foreign device states preserved. Build reuse took
about 0.66 seconds; it qualifies existing Debug bytes, not a release build.
377 originals, all 76 source references and 801 earlier immutable references
are preserved. Root reviewed the initial blank fields and error/retained/reopened
frames; human visual acceptance is not implied. Prior blocked receipts stay
blocked, including the zero-acquisition missing-`--scenario` command. Source
controls remain 20/20 per owner; full unit remains 1917/1918 with the unwaived
password-reset route gap. Wider matrix, Detox equivalence, exploration, hosted
gates and retirement remain Pending. Next is a separate connection-ledger source
packet; no native resources remain live.

Current source follow-up: `ios-credential-value-source-preparation-2026-10-01-v1`
(source implementation, transfer and validation **Done**; native **Pending**).
Actual focus metadata contradicted the failed
native screenshot. Keep bounded taps and assert the exact same-field email value
after email input and again after password input, then preserve the single-submit,
password-save prompt and native sign-in 201 gates. Prior inputs and original
failures are archived. Both owners pass 20 focused controls, typecheck,
zero-warning scoped lint and format/native/test-inventory/impact/whitespace checks.
Primary full unit remains 1917/1918 with the unwaived password-reset route gap.
Generated-flow proof does not qualify native input fidelity. No product/auth/copy
change or new native acquisition.

Previous source follow-up: `ios-credential-entry-source-preparation-2026-10-01-v1`
(source implementation, transfer and validation **Done**; native **Pending**).
Parallel implementation and independent review delivered bounded email/password
taps, focus gates, an exact escaped same-field email assertion, keyboard dismissal
and submit visibility before one submission. No secure password value is assumed.
The required password-save prompt and forwarded native sign-in 201 are unchanged.
Both owners pass 20 focused controls, typecheck, zero-warning scoped lint and
format/native/test-inventory/impact/whitespace checks. Primary full unit is
1917/1918 with the same unwaived password-reset route gap. Prior qualified inputs
and all failed original evidence remain preserved. Generated-flow proof does not
qualify actual iOS focus/input behavior; a new serial workcard remains necessary.
No product/auth/API/schema/copy change or native acquisition in this source packet.

Previous native runtime packet: `ios-credential-value-public-runtime-preparation-2026-10-01-v1`.

Status: original public attempt terminal **harness-blocked** at evidence
finalization; native capture and private verification completed, public
save-retry qualification **Pending**. Request `df35f32491c106713902b08d`,
capture `a6d4bbf45223df862fc3dc45`, backend `54e38b1b1848374cc9cd49f4`.
The original tool 45830 exited 2; native child exited 0 with null signal.
All 27 native commands completed/cleaned, callback completed once and private
save-retry verification passed. Initial entry review found blank native email and
password values; both same-field email gates and the required password-save
prompt completed. The public receipt preserves zero assertions and no pass.
Root independently verified 258 process/start identities absent, owned simulator,
cache and Compose resources absent, all three listeners absent, borrowed ADB and
31 foreign device states preserved. All 241 original files, actual application
binary hash, 76 source references and 560 earlier immutable references are
preserved. An offline disposable reproduction with the full current selection
reached the exact staging defect: the generic 8 MiB reader rejects the valid
26,247,504-byte streamed build log. No original was rewritten or replayed as a
passing public result. The first diagnostic used an incomplete compact selection;
its rejection is retained as an intermediate, not the native cause.

Current source follow-up: `ios-save-retry-command-log-source-preparation-2026-10-01-v1`
(source implementation, transfer and validation **Done**; public **Pending**). Implemented typed private command-log collection,
streamed exact copying/hashing and verification; retained generic JSON/PNG bounds,
execution bounds and ownership/census/output guards unchanged. Prior input bytes
and native originals are archived. No native acquisition or product/auth/copy
change follows source preparation. Both owners pass 20 focused controls,
typecheck, zero-warning scoped lint, format/native/test-inventory/impact and
whitespace checks. Primary full unit remains 1917/1918 with the unwaived
password-reset route gap. Large synthetic logs retain exact bytes/hash/size;
unsafe paths/modes, symlinks, mutations and oversized generic evidence reject.

Previous native runtime packet: `ios-credential-entry-public-runtime-preparation-2026-10-01-v1`.

Status: attempt terminal **harness-blocked**; native save-retry qualification
**Pending**. Request `7e6450c051d4398fc26541fb`, capture
`c52471adf56e1c597c4aa1be`, backend `731a0009cfc3feda22ababcd` used the
frozen changed source and a fresh owned Debug build with unchanged bounds.
Original tool 68277 exited 2; credential-entry child exited 1 with null signal.
The email tap completed, then the first `focused:true` assertion failed before
any input or submission. The failure hierarchy reports zero focused nodes, while
root's screenshot review shows an email caret, focus border and keyboard.
Maestro focus metadata fidelity is therefore unqualified on this target; no
sign-in, callback, save-retry assertion or native pass was established.
Root independently verified 48 process/start identities absent, owned simulator,
cache and Compose resources absent, three actual listeners absent, borrowed ADB
and 31 foreign device states preserved. Eighty-four original files, the actual
built application hash, all 76 source references and 476 prior immutable
references are preserved. Next: review value-based credential readiness while
retaining the exact entered email and normal native sign-in 201 gates. No
unchanged retry, product/auth/copy change or ownership/budget relaxation follows.

Previous native runtime packet: `ios-save-retry-public-runtime-preparation-2026-10-01-v1`.

Status: attempt terminal **harness-blocked**; native save-retry qualification
**Pending**. Request `28d6a9718f325d9737d4d4e6`, capture
`3bcbca7df345f65d8d3555a9`, backend `f64b1610995b43bd299a6807` used a
fresh owned Debug build, normal fixture/API and unchanged default bounds. Original
tool 13739 exited 2; the password-save-prompt child exited 1 with null signal.
The failure screenshot shows empty credentials and "Email is required"; sign-in
and the save-retry callback did not execute. This is a harness blocker, not a
save-retry product result; callback count, assertions and native passing cases are
zero. Root independently verified 41 process/start identities absent, owned
simulator/cache/Docker resources absent, all three actual listeners absent,
31 foreign device states and borrowed ADB preserved. Seventy-five original files,
the actual application binary hash, 76 source references and 401 prior immutable
references are preserved. Credential-entry investigation and a bounded source
repair are Pending; no unchanged native retry or guard relaxation follows.
No product/auth/schema/localized copy or Android scope change.

Current source packet: `ios-save-retry-public-source-preparation-2026-09-30-v1`
(Source implementation, transfer and validation Done; native Pending).
Eighty-three qualified isolated inputs and the preceding reader
quality freeze are preserved. Parallel agents own strict runtime frame mode,
typed iOS callback/adapter, and save-retry evidence preparation/staging; root owns
the contract, docs/declaration, runner integration and combined validation.
Native/device/backend execution is not dispatched by this packet. Source readiness
and actual native/public qualification remain separate; Android save-retry stays
unsupported. No product/auth/schema/copy change.

Both owners pass 38 focused controls, typecheck, zero-warning scoped lint and
format/inventory/whitespace checks. The final primary full unit run passes
1915/1916 with only the unwaived password-reset route mismatch. The iOS save-retry
path preserves simulator bootstatus failure facts, the exact five assertion
recipes and four unreviewed runtime frames. All 76 current source references
match across owners. Source readiness does not establish a native save-retry pass;
actual iOS execution requires a fresh serial runtime workcard and host/build
qualification. Android save-retry remains unsupported.

Current follow-up: `save-retry-reader-provenance-preparation-2026-09-30-v1`
(source implementation/transfer/validation Done; public runtime Pending). The
reader is async and independently reselects current inventory/requirements before
accepting bytes. Both-platform matching forged file/caller hashes reject without
altering evidence; disposable source drift and private path/mode/symlink controls
pass. Complete family/engine/platform/mode/ledger/identity checks precede file
reads; a current training selection rejects with an empty evidence root. Both owners pass 34 focused controls, typecheck, zero-warning touched lint,
format/inventory/whitespace checks and agree on all 73 actual source references.
Primary full unit is 1908/1909 with the same unwaived password-reset route gap.
Eight previous isolated inputs and the prior quality freeze remain immutable.

The next private iOS-only source workcard v2 has a fresh source snapshot and
explicitly preserves runtime frames as
`reviewed:false`, retains strict POST/PATCH/GET/SQL checks, and sequences lifecycle,
adapter/staging, source freeze, then runner dispatch. The earlier broader workcard
is retained with its stale source snapshot; neither is runtime launch authority.
Android save-retry stays unsupported/unwired. Its next diagnostic scope is bounded
STAT/PPID observation; retained census cannot distinguish all zombie/reparented/
absent states. No guard relaxation or unchanged Android retry follows. Public
save-retry adapters, native execution and wider T14–T20 acceptance remain Pending.
No new native/backend resources are acquired by these source packets.

Previous source preparation: `save-retry-public-binding-preparation-2026-09-30-v1`
(In progress). Local implementation of platform-aware retained-draft/snapshot
guards and the shared save-retry attempt binding/ledger is Done. Root owns
documentation, declaration, validation and transfer. Public adapters, Android
actions, both-engine equivalence and save-retry runtime remain Pending. This
packet supplies zero save-retry native passes. Eighty-two previous qualified
isolated inputs and a separate nine-file source preparation snapshot are archived
before transfer and central completion guard repairs.

Primary validation passes 32 focused controls, typecheck, touched zero-warning
lint and formatting; full unit passes 1906/1907 with the same unwaived route gap.
Canonical writer tests require current declarations and execute both EEXIST
checks; stale/missing input cannot silently bypass them. The declaration has 73
current source references and identical five-assertion save-retry purposes across
platforms/engines. Isolated transfer and validation are Done: 32 focused controls,
typecheck, touched zero-warning lint, formatting and inventories pass. The central
completion guard independently rejects fully matching retry identities; the
central ledger guard rejects omitted, renamed or reordered assertions even with
recomputed hashes/counts. All 73 actual source references match in both owners.
Primary full unit remains 1906/1907 with only the unwaived password-reset route
mismatch; no auth behavior is changed to clear this infrastructure packet.

The latest public iOS training run is terminal and passed at its frozen inputs:
request `f3154435040758102b319291`, capture `b9f77d2fba7bdac2449a14bd`, backend
`f4b19d9599edaa1af660ea7f`. All seven UI/API/SQL assertions, six SQL checkpoints,
three authenticated reads, five quantity previews and restart durability passed.
All 51 command rows completed with child 0, explicit null signal and no
census/output failure; callback ran exactly once. Original stdout and public
receipt report passed. Tool handle 24117 is terminal, but its final poll supplied
no exit-code field; the native child exit 0 is a separate retained observation.

Root independently verified 448 recorded process/start identities absent, owned
simulator/cache/Compose resources absent, foreign simulator state and borrowed ADB
preserved, all three actual listeners absent, 102 unchanged ADB observations,
56 copied proof files and nine runtime frame hashes. All 72 source references,
34 helper inputs, 61 prior original receipts and three dependency-preparation
references remained unchanged before this new source packet. The terminal
boundary freezes 337 original files. Two original quantity frames were visually
inspected; human visual/locale/physical-device/provider acceptance is not implied,
and original `reviewed:false` fields remain unchanged. Public locale remains null.

The second pre-acquisition public iOS run (`d5c354f0721ab4da390907b2`, capture
`04da84cdf946ffcde623ddab`) remains blocked by `spawn maestro ENOENT`. It actually
qualified the new zero-acquisition cleanup branch with unchanged after-state and
`cleanup:not-acquired`. The successful latest command explicitly supplied the
existing Maestro and Android SDK executable paths; no source/deadline bypass was
used. Current focused validation passed 47 controls in each checkout; full unit
passed 1897/1898 with the same unwaived password-reset route gap.

Android remains blocked by the retained unavailable-argv acquisition evidence.
A separate bounded known-child Darwin visibility control is Done privately
(v3 SHA `ca7f36e6c5aec15882ca4b420b6bf85851fb3829fa60aa56c6b50f3c55c0fe79`,
tool 44845 exit 0, diagnostic `ba17e777b671d5d92b01a1e1`). Harmless Node and
qemu-img version children had observed argv. ADB version had an initial
unavailable placeholder and disappeared on the one requery. All children exited
0 naturally, recorded process/start pairs are absent and borrowed ADB remains
unchanged. This corroborates transient visibility, while the emulator-specific
cause remains unknown. It grants no native ownership or passing cell and does
not weaken the strict guard. No unchanged Android retry is scheduled. Full T12–T20, equivalent
Detox coverage, cold comparison and hosted acceptance remain Pending.

Previous preparation snapshot: `ios-public-runtime-preparation-2026-09-30-v1`.

First public iOS run is terminal: tool 99291 exit 2, requested `afb5c760d0aaf311fd8b5c0c`, capture `02b4869a8909bc4283c3dffb`. Missing isolated `ios/Pods/Manifest.lock` stopped preflight with acquisition intents empty, before engine/build/UI/backend acquisition. The original verifier did not recognize this zero-acquisition case and retained a failed cleanup receipt; all ten new original files are frozen. Root independently corroborated the empty boundary, 34 unchanged helpers, no foreign simulator changes and original caller absence. No native/public pass was produced. Future zero-acquisition handling is being implemented with explicit after-state observations; historical receipts will not be rewritten.

Locked CocoaPods deployment ran serially through the shared host lock (tool 2918 exit 0). The installed manifest matches the existing lock, all 25 resolved modules validate, and `ExpoSecureStore`/`SecureStoreModule.self` are registered. Ten tracked configuration hashes and the native source-tree hash remain unchanged. This fixes the installed dependency prerequisite only. Final zero-acquisition source validation and a fresh frozen public run remain Pending.

First diagnostic freeze passed 39 focused controls in each owner plus 36 root lifecycle controls. Typecheck, touched zero-warning lint, formatting, impact, inventories and whitespace checks passed; all 72 source hashes matched, with all 40 original receipts unchanged. Primary full unit passed 1893/1894 with the same unwaived password-reset route failure. A final independent review found malformed phase/signal and failure-staging parity gaps. Thirteen current isolated inputs were archived before repairing those terminal guards. The first freeze and its launch-preflight record were not executed; runtime remains Pending with zero acquisitions. Refresh the declaration and bind a new freeze after the terminal guard changes.
The previous goal turn made verified progress: bounded ADB allowance repair,
84 focused controls per owner, one retained Android acquisition failure and
independent owned cleanup. No prior native/tool handle is live. Eleven qualified
isolated inputs are archived before future transfer; all 40 original receipts
(21 latest Android plus 19 earlier) are frozen and unchanged.

Current-source read-only audits confirm the public iOS training adapter is
technically executable independently of the Android argv-unavailable blocker and
the separate native session-revocation decision. Resource-free selection resolves
`SCN-training-ios` with seven canonical assertions and 24 actual callable
prerequisites. Preparation has acquired no resources and supplies no native pass.

Close the residual iOS command diagnostic propagation gap before its smoke. Root
owns documentation, public staging and combined validation; Android agent owns
shared projection plus Android compatibility; lifecycle agent owns iOS adapter
and controls. A late census failure must block passing evidence even if its
sidecar publication fails. Public staging must compare projected adapter history
against raw capture history and reject missing/malformed/failed commands. Preserve
original engine exit/signal, capture result and cleanup independently.

Source/declaration refresh, local validation, transfer, reviewed exact command,
current iOS build/target/ADB/fixture/foreign-device checks and fresh shared-lock
host census still precede any iOS acquisition. Actual runtime qualification,
locale, all broader T12–T20 gates and hosted acceptance remain Pending. No auth,
product, schema or copy changes; no unchanged Android replay or Detox retirement.

Previous dispatch: `android-startup-observer-control-2026-09-30-v1` (2026-09-30,
In progress). The previous goal turn made verified progress: diagnostic source
was frozen, locally validated and transferred. Seven qualified inputs are now
archived before the bounded ADB allowance repair; all 19 original receipt hashes
remain unchanged. Root owns shared documentation/declaration/validation and the
eventual serial runtime. Android agent prepares a separate private entry/home
parent; backlog agent repairs the listener-to-child phase allowance; lifecycle
agent reviews the controller independently. Preparation acquired no native resources.

The preparation census at 22:52:11 UTC was `no-known-job`; Docker responded and
Maestro was pinned at 2.6.1. This was a preparation observation, not launch authority.
Source freeze, local checks, transfer, independent parent review and a fresh clear
census completed before the single entry-and-login inventory command below. This control
does not reproduce the library failure or grant any public native pass. Full
BL-018/T00–T20 completion remains Pending.

Current source qualification: 84 focused tests pass in both primary and isolated
checkouts without skips/cancellations; typecheck, touched zero-warning lint,
formatting and whitespace checks pass. All 72 declared source files match their
actual hashes in both checkouts, and all 19 original receipts remain unchanged.
Primary full unit passes 1887/1888; the missing server registration for mobile
`/auth/password-reset/confirm` remains an unwaived failure. Full lint exits 0 with
0 errors and 3004 warnings. Source transfer is Done; native acquisition remains 0.

Independent parent review rejected the first unexecuted candidate at SHA
`460d3d9992f7e46d3237f4dc453f072c56c689702227b3695af98019dc61af18`:
the observer elapsed clock must be monotonic, unattached census failure markers
must be scanned, and the actual capture must bind the full 72-source declaration.
Android agent repaired only this separate unexecuted controller; review of
its next freeze and a fresh clear census completed before acquisition. Root's
resource-free check independently validates the exact isolated command, all 16
imported callables, the 72 actual source hashes and the 19 original receipts.
Evidence is in `source-quality.private.json` and
`root-callable-command-preflight.private.json` in the current packet.

The new `entry-observer-workcard.private.json` binds all 72 current source hashes
and the exact default inventory selection; the previous packet's workcard remains
immutable at its previous inputs. Effective app locale is separately Pending:
`app.language.override` can override the device language, and LocaleContext
hydrates asynchronously without a ready flag. The existing Android shared-prefs
observer reads Metro configuration only; it does not prove AsyncStorage override
state. Public locale remains null. A future locale observer must bind the actual
hydrated app context and override provenance to the current target/build, preserve
absent/invalid/read-error states, and qualify all three locales before projection.
This read-only audit introduces no app observation seam or product/copy change.

Terminal runtime dispatch: repaired parent SHA
`ac849cbad9829b898d82c440811e0202cd68554fedd916710e38555bbce106ba`
passes independent review, root resource-free qualification and a fresh clear
census. One serial private entry-and-login observer ran on tool handle94495,
which is terminal exit2: parent audit `9c1bf2c5007f36070cb0fddf`, isolated Android
capture `ed05746e6332e1998a8e3cb2`. Original capture is `harness-blocked` with
`Owned worker command census unavailable` during owned emulator acquisition,
before build or UI readiness. ADB/emulator acquisition was attempted; backend,
Expo and application actions were not dispatched. No training replay or public
native receipt was dispatched. Earlier zero-acquisition counts describe
preparation only.

Independent terminal cleanup passes: all 42 recorded process/start pairs are
absent, six owned runtime child directories are removed, borrowed ADB/AVD/iOS state and source/
build inputs are preserved, final census is `no-known-job`, ready markers are
absent and the advisory lock probe is available. All 72 actual source hashes and
19 original receipts remain unchanged. Root independently rechecks current
process absence and freezes 21 current receipt hashes in
`root-post-terminal-boundary.private.json`. Original parent child result remains
exit2/signal-null with no cancellation or outer deadline. Startup readiness,
sampler and diagnostic runtime qualification remain Pending because those phases
never ran; private/public native passing cases stay zero. Preserve this executed
controller and all original receipts. Investigate the census evidence path before
any changed control; no unchanged retry is authorized by this result.

Independent read-only lifecycle review confirms the final proof. The canonical
Android runtime root and its `owner.private.json` marker remain; cleanup removed
its six acquired child directories, not the owning root itself. Expo cache
absence is null because Expo was not acquired. The emulator ledger retains two
Darwin command-census requery events: first available, then unavailable. The
second fresh census includes a different unavailable child PID in the same owned
group. This is the strict unavailable-argv path, not evidence of `ps` timeout,
nonzero exit, max-buffer exhaustion or an application defect. Underlying argv
unavailability cause stays unknown. `census-blocker-classification.private.json`
binds the original ledger hash and retained events; no receipt reconstruction or
diagnostic repair is needed to recover this attempt.

Current dispatch (2026-09-30): T13-K Android driver diagnostic preparation is
locally validated and transferred after the first current-input public attempt
blocked. All owned tool handles are terminal. User explicitly authorizes parallel
agents (2026-09-30).

Current preparation packet: `android-driver-diagnostic-preparation-2026-09-30-v1`.
Six qualified isolated source/declaration/doc inputs were archived before future
transfer; all seven original public/parent/capture receipt hashes are preserved.
Local implementation is Done: bounded private failed-query evidence, immediate
owned-device diagnostic orchestration and a separate per-readiness host sampler.
Ten frozen files were transferred after the six previous inputs were archived;
declarations and inventories were regenerated in their owning checkouts. All 72
declared source hashes match. No native acquisition, endpoint change or readiness
deadline increase occurred in this packet. Actual runtime qualification is Pending.
The configured 30-second collection / 5-second query phase budgets are cooperative:
filesystem publication is not preemptible, and the existing ADB helper calculates
child allowance before its listener check. Actual wall-clock bounds and in-flight
read cancellation stay Pending; executed evidence cannot be called not-run.

Completed ownership: lifecycle agent owns the new driver diagnostic helper/test;
lifecycle agent also owns the separate startup sampler/test. Android agent owns
capture integration. Root owns shared declarations, QA/
discovery docs and combined validation. Exploration and comparison agents audited
dependencies/provenance read-only. T16-A preparation is eligible, but T16-B browser
execution still requires P4/T14/T15; no browser bypass is documented. Public
locale stays null: device properties do not establish the app's effective language,
which can have a stored override. T15's base 400-attempt matrix has no locale
dimension; keep later locale qualification separate rather than inventing cells.
Actual app-locale observation/projection remains Pending.

Current local validation: 82 focused tests pass in both primary and isolated
checkouts, with zero skips/cancellations; typecheck, touched zero-warning lint,
formatting, declaration validation and test-impact validation pass. Primary full
unit passes 1885/1886: the sole failure remains the missing server registration for
mobile `/auth/password-reset/confirm`; it is not waived. Primary inventory is
347 files (285 client/62 server); isolated inventory is 345 (283/62). All seven
original blocked-attempt and 12 historical receipt hashes remain unchanged.
Public native passes stay zero. Evidence: `packet-final-boundary.private.json`
in the current preparation packet.

Next observer control is prepared, not executed: the existing inventory
entry-and-login command without a charter flag. It can qualify observer lifecycle
for its own entry/home commands, but cannot reproduce the later library startup
failure. It still needs a fresh clear host census, the existing lock and a reviewed
independent cleanup audit. See `next-entry-observer-workcard.private.json`; no
unchanged full training replay is authorized by this preparation.

Previous packet: `public-android-runner-preparation-2026-09-30-v1`. A new private
parent controller invokes the public Node entry, observes its own runner ID,
and preserves the public receipt plus separate parent/cleanup audit outcomes.
It does not invoke or modify either historical private controller; the actual
isolated allowlists include restored-v4. Parent syntax checks passed before
execution; the terminal outcomes below own current runtime status. The public
receipt's nullable locale is not locale coverage.
All locale/adoption/failure/lifecycle gates stay independent.

Terminal public attempt (2026-09-30): tool handle23256 ended2, parent audit
`4f236e8b583866ec688ff274`, public requested run
`396412b11e732086b48b83a8`, Android capture
`509c81fac3173c586f21f313`. The reviewed parent is frozen at
`d5156f78e92e5dfceaf23401810bede187888d11a2624f7129c78a7bed642c90`.
The public runner acquired the existing shared host lock after fresh clear
censuses. Original public result is `harness-blocked`/exit2: build/install/launch
and sign-in/coach-home readiness completed; Maestro's Android driver failed to
start for `journey-library-readiness`, before the library action. Callback1/
incomplete, verification not-executed, external cleanup passed. This is an engine
startup failure, not a detected training application regression or whole deadline.
All seven training assertions remain unqualified; public passing cases stay zero.

Original parent audit also failed: its target projection imported from the wrong
module. Preserve the executed controller and original receipts; a new v2 candidate
must import from `native-pilot-contract.ts` and validate callable prerequisites
before acquisition. Original final host audit observed contention but discarded
the snapshot before recording it. The root's fresh census identifies foreign
Meer Xcode PID3751/start`Wed Sep 30 18:26:09 2026`, UID501, same foreign runner cwd.
Do not infer that this job caused Maestro startup failure; no signal/restart is
authorized.

Independent post-terminal audit is Done within owned-resource scope:
3014 conservative PID/start pairs absent; six directories, reserved ports,
Expo cache and owned backend Compose resources absent; borrowed ADB and foreign
AVD/iOS states preserved. Client/server identities, helper/source/APK bytes,
executed controller and all12 historical restored-v4 receipts remain unchanged.
Two current native PNGs decode and were visually inspected; this does not establish
locale/visual acceptance or the training journey. Original public/parent outcomes
remain unchanged. Receipt: `public-blocked-independent-audit.private.json` in the
previous `public-android-runner-preparation-2026-09-30-v1` packet. All owned tool handles are terminal.

Prepared parent v2 is separate/unexecuted: SHA
`f4a2b0ede64514a4c580986e5035b70d1d3ecf8f8ed245e337d39645e029a654`,
mode0600, original controller unchanged. It imports target projection from the
contract module, checks required callables before acquisition and retains final
host snapshots with contention separate from structural lock/resource cleanup.
Root's actual-load check passes all20 imported functions without acquisition.
This repairs preparation only; it does not revise the original blocked attempt.

Recorded library readiness child1/signalnull took129070ms within180000ms;
deadline/capture timeout/cancellation/output/census failures are null. The
Maestro internal driver bootstrap failure is distinct from our command deadline.
Readonly endpoint investigation is Done: owned emulator console5554/adbd5555,
ADB smart-socket31001 and Maestro driver-session62774 have different roles.
The adapter's direct adbd endpoint is correct; the earlier wrong-endpoint
hypothesis is retracted. Entry/coach-home and the failing library command selected
the same endpoint. Pinned Maestro2.6.1 source describes instrumentation startup
and probing the device-side driver port in
[AndroidDriver.kt](https://github.com/mobile-dev-inc/Maestro/blob/v2.6.1/maestro-client/src/main/java/maestro/drivers/AndroidDriver.kt),
and explicit host/port selection in
[DeviceService.kt](https://github.com/mobile-dev-inc/Maestro/blob/v2.6.1/maestro-client/src/main/java/maestro/device/DeviceService.kt).
The driver did not become reachable; existing failed logcat diagnostics supplied
no device-side cause. Do not change endpoint or increase deadlines.

Next bounded preparation packet: retain a whitelist of actual Maestro timeout/
analytics settings; reference the original combined command log and retain failed
query stdout/stderr, instrumentation inventory, owned-device logcat and driver
package/process/port state while the emulator is live. An instrumentation-start
response remains unknown unless original output proves it. Returned UTF-8 strings
are distinct from exact Buffer bytes. Retain host census across each startup
window in separate private directories. Missing query output is unknown.
Preserve the first engine failure and separate diagnostic
errors. Validate query ownership, private output, bounded execution and failure
intake locally before any native diagnostic acquisition. No unchanged full
training replay follows from this packet; require a fresh uncontended host and
an explicit diagnostic work card.

The plan's previously missing `run-native-pilot.mjs` now delegates once to the
existing shell wrapper with signal forwarding and terminal child status. Four
owned-process controls pass, including argv/cwd, SIGINT/SIGTERM, exit7 and spawn
failure. Root binds the new entry in the source declaration; final declaration,
inventory and changed-input validation follow source freeze. No app behavior,
API, auth, schema or user-facing localized copy changed.

Host baseline at20:37:57Z was contended: Xcode PID28963/start
`Wed Sep 30 17:35:43 2026`, UID501, cwd
`/Users/eduwaldo/actions-runner-meer-ios-ci-m5/_work/Meer/Meer/ios`.
The foreign Meer build was preserved. A fresh root census at21:07:13Z reports
no known native job. Acquisition still requires the controller's immediate
pre-run census and existing shared host lock; no foreign signal/restart is
authorized.

Transfer is Done:15 qualified files, including the Node entry and its four
controls, now match the isolated owner. Exact16 previous files were archived
before mutation; two transferred paths were new. Historical private controllers
were not copied or changed. That owner's declaration regenerated23views/
40transitions/10scenarios/no passes and test inventory342files (280client/62server).
Primary inventory is344files (282client/62server), retaining comparison and
exploration preparation. Independent post-transfer verification matches all70
declaration source paths, the exact original SessionCard bytes and all12 historical
restored-v4 receipts. Isolated changed-input validation passes62focused controls,
typecheck, touched zero-warning lint and formatting. Primary full unit requests
1866cases:1865pass/1known auth-route mismatch/0skipped/0cancelled. This failure
remains unwaived. Reviewed parent syntax/local checks did not detect the bad export;
the actual public attempt above is terminal-blocked. Logs/quality receipt are in
the current preparation packet. The new parent candidate and Maestro startup
investigation are preparation only; no unchanged retry is authorized by them.

- `android_public_runner`: primary public runner/tests plus Android adapter/test;
  typed blocked metadata, whole versus command deadlines and signal precedence.
- `lifecycle_review`: primary Android emulator/test and capture helper;
  configured step caps and screenshot lifecycle; explicitly owns the common
  command helper/test for exclusive binary output and terminal I/O handling.
- `parallel_backlog_audit`: new comparison collector/test/contract doc;
  requested-attempt denominator, per-cell immutable expectations and threshold.
- `exploration_preparation`: new preparation helper/test/playbook/charters;
  validated context/budgets, no fabricated observations or real exploration.
- Root: staging helper/test census-sidecar guard, integration/shared declarations/
  inventories/docs and actual runtime qualification. No snapshot copying or
  full-suite validation while sources are being edited. Native acquisitions stay
  serialized by the existing host contract.

Parallel preparation is locally verified: all four agents froze source after
cross-review. Combined focused checks pass77/77 with zero skips/cancellations;
typecheck, touched lint (zero warnings), formatting and impact12/43/62 pass.
Native declaration validates23views/40transitions/10scenarios, zero public passes.
Test inventory validates343files (281client/62server). Full unit1862requested/
1861pass/1known password-reset confirm route mismatch/0skip/0cancelled; the
suite remains failing and the mismatch is not waived. Stable comparison CLI
rejects missing arguments with exit2. Exploration package CLI with unknown
context exits2/blocked, `not-run`, zero actions/observations and pending runtime
requalification. All12 original restored-v4 receipt hashes/lengths are unchanged.
Private validation packet: `parallel-preparation-2026-09-30-v1/`.

Next: prepare and validate a new parent candidate without altering the executed
one; diagnose the recorded driver startup failure and establish one concrete
changed-condition control. Recheck actual host/device ownership before any serial
execution. The snapshot's controller allowlist differs from the primary archive;
inspect the actual owner, never copy a historical private controller as the public
runner. Require fresh current-input
success/failure/lifecycle/screenshot and independent cleanup proof. No device,
backend or snapshot acquisition/transfer occurred in this parallel packet.
T15 measurement/adoption, T16-B actual exploration, both engines/platforms and
hosted acceptance remain Pending. Preparation cannot retire Detox.

No agent may mutate the frozen restored-v4 inputs or original evidence. All
subagent work remains within the existing local authorization; no external
commit/push/dispatch/production action is implied. Do not apply the superseded archived Android runner candidate over the
current target-projection implementation. The reviewed `run-native-pilot.ts` and
`run-android-training-attempt.ts` dispatch matching platform adapters, forward
actual target metadata and reject unsupported engine/scenario/options before
acquisition. iOS-only boot/reuse options reject for Android. Retain completion,
staging, original failure/deadline/signal, diagnostic and cleanup contracts during
transfer. Meaningful dispatch/rejection and binary I/O controls pass locally;
actual public native execution remains a separate gate.

New-input restored-v4 is qualified at its recorded inputs: capture
`c6bb29e8642901ab808ef3a1`, requested `fd295c033337a1424baabfef`, backend
`4828a125c067f6872e0f1a5e`. Original parent/control0, capture0; callback1/complete,
private runtime verification/staging pass, seven canonical UI/API/SQL assertions,
six SQL checkpoints and three API reads. Normal create3x8/save/edit4x10/save/
restart/reopen completed. All command executions and releases complete/cleaned;
no inner or outer census-failure sidecar. Inner independent cleanup passes with
recorded/current foreign preservation. Original parent audit counts819pairs;
separate conservative ownership/diagnostic-pair audit proves3142pairs absent,
six owned directories/ports/cache/Compose namespace absent, borrowed ADB and
foreign AVD/iOS states preserved. These differently collected counts are not
interchangeable. Source/helpers/APK stable and exact original SessionCard hash
matches primary/snapshot after completion.

Receipts: `process-census-diagnostics-2026-09-30-v1/restored-v4-qualification.private.json`
and `quantity-restored-v4-owned-audit.private.json`, with original captures retained
in the isolated source owner.27snapshot controls pass and regenerated declaration/
inventory validate. This is one Android/Maestro/integration/en-US private control;
public execution/failure/lifecycle and all broader T00–T20 gates remain Pending.
Historical quantity-negative control keeps its earlier helper hashes; do not
rebind it or treat the new restoration alone as current public failure coverage.
Full unit remains1836requested/1835pass/1known auth-route mismatch/0skip/0cancelled.
No product/auth/API/schema/copy/localization contract changed. Affected testing/
decision/wiring docs are updated; no FR/UC/BR/AC/screen/locale change is needed.

Historical dispatch (2026-09-30): T13-K new-input restored Android qualification,
`bound-training-restored-v4`. Structured diagnostic packet is locally validated.
Live handle34464; capture `c6bb29e8642901ab808ef3a1`, requested
`fd295c033337a1424baabfef`. Inputs frozen; all preparation/quality handles
terminal. Do not change isolated helpers/controllers/component during this run.
Neither assertions nor cleanup qualify before original terminal receipts and
independent audits.
Owner: existing isolated client and paired server. Exact restored SessionCard hash
`268266d37437d344974a056628a52b777510fb2a2520297569902a2647fe5254` matches both
primary and snapshot. Five verified helper/test/testability files transferred
only after exact previous bytes were archived; controllers hash-verified against
original v3 intent and archived, then only unique v4 allowlist entries added.
Archive manifests live in `process-census-diagnostics-2026-09-30-v1/`.

Target: fresh owned Android AVD/dev build, native-entry-android integration
fixture/en-US/Maestro2.6.1, ephemeral account/proxy/API origin and real isolated
Postgres in the paired server. Borrowed default ADB and all foreign devices/files
must remain preserved. Use unchanged capture deadlines: build budget900000ms,
step600000ms, whole2400000ms/backend2700000ms; outer observation2700000ms. No
new retry, build reuse or deadline extension. Command from snapshot:
`node --import tsx .qa/artifacts/testing-modernization/android-lifecycle-extraction-2026-09-29/run-control.cjs bound-training-restored-v4`.

Wait for27 snapshot controls and regenerated declaration/inventory, recheck
host/device baseline, then freeze inputs and execute once. Require normal create
3x8/save/edit4x10/save/restart/reopen, all seven canonical UI/API/SQL bindings,
current private runtime/staging and independent inner/outer cleanup. On any
failure preserve original execution/census classification plus redacted query
cause when available, then audit every recorded PID/start pair, owned directories,
ports/cache/Compose namespace and foreign resources. Parent/capture results are
separate; no public Android dispatch/finalization is enabled. Original v3 and
known route mismatch remain unmodified. Public/native passing cases stay zero.

Historical dispatch (2026-09-30): T13-K structured process-query diagnostics
locally validated; native changed-input restoration preparation remains next. Existing process/command helpers now persist only
known status, configured query bounds and output size/hash. Missing fields are
null; killed/configured timeout is not proof of timeout expiry. No query retry,
deadline extension, ownership change or historical receipt rewrite.

27 focused controls pass, including a real one-shot failed query in a disposable
controller-only PATH. Command child0 plus cleaned release remains harness-blocked;
all recorded PID/start identities and owned group independently absent. Original
exclusive0600 sidecar and terminal publication states are preserved. This is no
native assertion, restored journey, public scenario or hosted pass. Final inputs preserve raw output bytes, including invalid UTF-8; the real
control verifies their exact fingerprints. Typecheck/scoped lint (zero warnings)/
impact pass. Full unit1836requested/1835pass/1fail/0skip/0cancelled; the sole known
password-reset confirm route mismatch remains unchanged and is not waived.
Declaration/inventory pass with23views/40transitions/10scenarios and zero public
passes; test inventory341files (279client/62server). All tool handles terminal.
Evidence packet: `.qa/artifacts/testing-modernization/process-census-diagnostics-2026-09-30-v1/`.
First lint warning and earlier validation logs remain retained separately.

Next: archive changed snapshot source inputs before copying only verified helper/
test/doc files, regenerate that snapshot declaration, hash-verify controllers and
exact restored component, then write a new unique restoration work card and
recheck host/device baseline before acquisition. No historical attempt is
rebound; new native failure must retain its own structured cause and complete
cleanup/absence audit. Full unit remains a documented blocker; no auth contract
or expected result is changed by this packet. Product/API/auth/copy/localization behavior is unchanged,
so no FR/UC/BR/AC/screen/locale update is required for this packet.

Historical dispatch (2026-09-30): T13-K native process-census diagnostic preparation.
All owned handles are terminal. Updated-verifier restored-v3 is terminal2:
capture `8e5d34143565ed3dc644b01d`, requested `18706eb14c2d314509bb22b4`.
Gradle reports BUILD SUCCESSFUL/child0, but a background ps query fails and makes
original command execution harness-blocked. Callback0, verification not-executed,
staging unqualified; no native assertion ran. Original inner cleanup and updated
independent cleanup pass, including recorded/current foreign preservation.
Separate outer+inner audit proves862 recorded pairs absent, six owned directories,
reserved ports/Expo cache/Compose namespace absent and borrowed ADB preserved.
Original engine/build result, census failure and parent blocked result remain.

Original census diagnostic records class/message/timestamp/publication but not
exit code, signal, timeout state or stdout/stderr size/hash. Do not infer those
missing values or retrofit them into v3. Before another native attempt, prepare
structured redacted query diagnostics in the existing process/command helpers.
Keep failed queries blocked; add no retry, deadline extension or ownership
authority. Verify missing attributes stay unknown, sensitive argv/stdout/stderr
are never copied into the diagnostic, and a controlled real failed query remains
harness-blocked despite engine0 and cleaned release. Current restored/private
public gates remain Pending; source component is restored and primary unchanged.

Full unit for classifier inputs:1834requested/1833pass/1fail/0skip/0cancelled.
The sole failure remains the documented password-reset confirm route mismatch;
no auth behavior or test expectation changed.18 focused controls/type/lint/impact,
declaration and snapshot controls pass. Actual current-verifier normal cleanup
is qualified only for the pre-journey blocked v3 capture, not full restoration.
All affected testing/decision/wiring docs are current; no FR/UC/BR/AC/screen/locale
update is required because product/API/schema/auth/copy behavior is unchanged.

Historical work card (2026-09-30, updated-verifier restored qualification): T13-K.
Owner: existing isolated client and paired server. New control:
`bound-training-restored-v3`; no mutation, same canonical seven training
assertions and native-entry-android integration/en-US/Maestro2.6.1 fixture.
Changed conditions: updated cleanup inspector passes focused and actual retained
failure inspections; clear host censuses at17:46/17:47/18:02 after prior contention.
Check the prior competing PID/start and host again before acquisition. Archive
current controllers against v2 intent, plus the exact old isolated files before
copying only this goal's updated helpers/tests/testability doc from primary.
Verify baseline SessionCard, regenerate declaration and run focused snapshot
controls; freeze inputs before dispatch. Execute one full normal create3x8/save/
edit4x10/save/restart/reopen UI/API/SQL journey. Require current runtime/staging,
all seven assertions and independent inner/outer cleanup/source/foreign proof.
This is new-input restoration qualification, not a repeated unchanged attempt.
Keep public dispatch disabled until this prerequisite qualifies. Full T00–T20
scope, both engines/platforms, lifecycle, comparison, exploration and hosted
acceptance remain required; no native passing case or promotion is granted here.

Cleanup classification is locally qualified:18focused/18pass/0fail/0skip;
typecheck0, scoped lint0/0warnings, impact0 and declaration valid. Actual read-only
supplemental inspections of both stopped captures pass their inspection controls
and still report failed cleanup, available census, original failure messages,
six owned directories absent, no survivors/ports/Docker namespace, preserved
borrowed ADB/foreign AVDs and recorded iOS change. Capture-owned counts78/107
are distinct from prior complete outer+inner absence counts470/1930. Original
receipts are hash-verified unchanged, current iOS state returned to baseline,
and recorded change still prevents success. Receipts/logs in
`android-assertion-failure-2026-09-30/cleanup-classification-v1/`.

Historical work card (2026-09-30, Android cleanup classification): T13-K.
Owner: primary client cleanup inspector and existing focused tests. Preserve the
original capture status/failure messages and original before/after foreign-device
snapshots while obtaining a fresh read-only process/port/device/Docker census.
Known foreign-state changes must remain a failed cleanup even if the current
device has returned to its initial state. Added foreign device IDs also fail
preservation. Missing, malformed or contradictory resource evidence stays
unavailable; no resource ownership, teardown or passing predicate is relaxed.
Implement in the existing verifier; no parallel harness or native run. Prove
status validation, retained recorded changes, current changes and malformed
snapshots, then independently reinspect stopped captures with new supplemental
receipts. Never overwrite their original external-cleanup files. No product/
auth/API/schema/copy/locale or hosted change. All previous owned tools are terminal.

Historical locally verified work card (2026-09-30, independent public-target preparation): T13-K.
Owner: primary client, native pilot contract/runner and focused contract tests.
Establish public target fields from the selected platform's original capture:
Android serial/osVersion/appId; iOS udid/runtime/bundleId; both retain actual
profile/binary hash/API origin. Reject crossed platform/malformed metadata and
leave unavailable fields null; never borrow other-platform values or invent an
OS version. Integrate the projection into the current iOS runner without enabling
Android dispatch. Existing source/deadline/selection/staging/cleanup gates remain.
Validate meaningful metadata rejection controls, actual preflight receipts,
typecheck/lint/impact and refreshed declaration/inventory. No product/auth/copy/
schema/locale or hosted change. Original source candidate is unapplied preparation.

Public-target packet is locally verified:9 focused tests pass/0fail/0skip;
typecheck0, scoped lint0/0warnings, impact0, regenerated declaration/inventory
valid (23views/40transitions/10scenarios/0passes), inventory341files (279client/
62server). Full unit1832requested/1831pass/1fail/0skip/0cancelled retains the
known mobile/server `/auth/password-reset/confirm` route mismatch. Logs and
source hashes: `android-assertion-failure-2026-09-30/target-projection-*.private.*`.
Primary and isolated SessionCard exact baseline bytes are reverified after v2.
The prepared dispatch candidate predates this projection and is explicitly
superseded; never apply it over current source. Android public dispatch remains
disabled, and projection/local quality grants no native or hosted passing case.
Next eligible packet: diagnose/classify retained full-cleanup failures while
preserving failed original outcomes, or prepare remaining public lifecycle
controls. Restoration execution requires changed stable host conditions; then
reprepare public dispatch against current source and qualify fresh public normal/
detecting/restored and lifecycle controls. Do not narrow full T00–T20 scope.

Restored v2 is terminal2: capture `6962d80647ea5142d38b5ac4`, requested
`9dbfdcee43776e8e5312e2c0`. Build and normal sign-in/library/builder/guidance
complete, then a competing Detox job blocks session-editor hierarchy. Original
callback incomplete, verification not-executed and cleanup failed-recovery-retained
with foreign-iOS state change. Separate scoped audit proves1930 recorded pairs
and owned directories/ports/backend namespace absent; borrowed ADB preserved.
Full restored qualification remains Pending. No further unchanged attempt is
scheduled. All owned handles are terminal. At17:33:48Z a foreign Detox PID19505/
start Wed Sep30 14:31:25 2026 is live; preserve it. Both interrupted attempts and
full-cleanup failures remain immutable; actual private negative proof stays qualified.

Historical work card (2026-09-30, restoration continuation): T13-K fresh
`bound-training-restored-v2` in the existing isolated client/paired server.
Owner and requirements remain SC-208 / NAT-training-local-draft; fixture is
native-entry-android coach/canonical exercise, integration, en-US, Maestro2.6.1.
Prerequisites: qualified actual negative control and exact byte restoration below;
interrupted v1 is terminal, with separate scoped owned-resource absence proof.
Current census at 17:23Z reports no known native job. Recheck before acquisition.
Archive/hash-bind current controllers against v1's original intent before adding
v2 selection. Preserve expected3x8 and all seven canonical training assertions.
Execute one fresh normal full UI/API/SQL journey, qualify original runtime and
copied staging, then independently audit cleanup and unchanged source/helper/
binary/foreign boundaries. No public receipt or comparison pass is claimed.

Actual quantity negative control is qualified: `bound-training-failure-v1`,
capture `a150dc9c443120438a32d413`, requested `d3b834517a84d07ba055c86d`,
backend `f069017422facf9803765207`. Original Maestro assertion child1 detected
expected3x8/actual4x10 at NAT-training-local-draft. Original capture2 remains
harness-blocked, while adapter classification is application-failed with full
independent cleanup and exclusive staged failure reverify. Control0 verifies
the intended detection, not a passing journey. Audit checks257 process pairs
absent, six owned directories absent and preserved foreign boundaries. Exact
SessionCard source bytes were restored; primary source never changed.

Restored v1 capture `16f1faf308bb692b6249e4d9` is terminal2. A competing native
job stopped the next command before complete assertions; callback1/incomplete,
verification not-executed. Foreign iOS state changed, so original cleanup remains
failed-recovery-retained and full external cleanup remains failed. A corrected
separate scoped audit proves470 recorded pairs absent, six owned directories/
ports clear, backend namespace absent and borrowed ADB preserved. It does not
qualify foreign-iOS preservation or the restored journey. The initial scoped
audit rejection and pre-correction script bytes are retained. Receipts:
`android-assertion-failure-2026-09-30/quantity-{restoration-v1,restored-v1-owned-audit}.private.json`
and isolated lifecycle control directories. Public finalization and full
T13–T20 remain Pending; full unit's known password-reset route failure remains.

Historical work card (2026-09-30): T13-K actual Android quantity-failure and restore
qualification. Owner: isolated client in testing-native-regression; reuse the
paired server, existing capture/adapter/classifier/stager and owned controllers.
Prerequisite: v11's terminal seven-assertion runtime/staging and independent
cleanup/preservation receipts. Requirement: SC-208 local draft preview shows the
entered quantity; NAT-training-local-draft's expected3x8 remains fixed. Fixture:
native-entry-android coach/canonical exercise, integration, en-US, Maestro2.6.1.
Archive baseline SessionCard and v11 controller bytes before edits. Temporarily
render3x8 as4x10 in the isolated component only; regenerate current declaration.
Use one fresh bound-training-failure-v1 with existing deadlines and shared host
lock. Require original quantity assertion child1, exact wrong native preview,
owned API/emulator health, callback1/incomplete, full independent cleanup and
exclusive staged failure reverify with zero passed bindings. Restore exact source
after terminal capture; regenerate and execute fresh bound-training-restored-v1.
Unknown diagnostic/staging/cleanup outcomes remain harness blocks. Update only
testing/decision/wiring docs; no intended product/auth/schema/copy/locale change.
All prior owned handles are terminal; recheck actual host before acquisition.

Current dispatch: T13-K Android required-assertion failure qualification and public
runner preparation. Fresh private Android seven-assertion runtime/staging and
both title-menu paths have local terminal evidence below; public dispatch,
application-failure/lifecycle controls and full T13–T20 remain Pending. Check
current fingerprints before reuse. Do not recreate the delivered mapper or
repeat a completed clean runtime without a changed qualification requirement.

Latest implementation packet (2026-09-30): both native capture adapters now
perform read-only configured Expo entry containment before runtime acquisition.
Android also rejects cached autolinking with foreign project/dependency roots,
malformed identities or linked output. Valid monorepo entries remain supported;
missing generated autolinking is allowed for normal generation. Entry paths/bytes
and contained cache identity are recorded in the private preflight. Focused17/
17pass/0skip, typecheck, scoped lint, impact and declaration/inventory validation
pass. Logs: android-assertion-failure-2026-09-30/metro-entry-final-*.private.log.
Full unit's separately recorded missing password-reset route failure remains
unresolved; these focused results do not supersede it. No product/auth/API/schema/
locale or hosted CI behavior changed. Updated preflight actual capture acceptance
remains Pending; the current paired snapshot has the new sources and declaration.

Original isolated v9 is terminal2 at entry readiness. Independent audit verifies
689 recorded process pairs absent, full Android cleanup and backend namespace
absence. The Expo toolchain reproduces its dependency link resolving outside the
isolated Metro root. A local copy is byte-equivalent across60,257 installed files/
links; the original link is archived outside the source repository. Versions and
journey assertions are unchanged. Fresh v10 capturebaf960c691ae65c4364d2b68 then
fails build child1/outer2 before callback0 at duplicate libworklets.so. Its inner
external cleanup passes; independent outer audit verifies1952 recorded pairs
absent and owned resources absent. Both original failed outcomes remain failed.

V10's generated autolinking still referenced original installation directories;
a fresh query resolves all roots inside the isolated copy. A read-only baseline
recheck finds44 changed recorded original dependency files, all generated Android
build-cache files; newly generated files were not enumerated. Do not claim full
original dependency byte preservation. No restoration/deletion of original
dependency artifacts was attempted. The new cache containment check rejects this
foreign build boundary before future capture acquisition. Three stale isolated
autolinking files and19 owned copied Android cache directories were archived,
with hash manifests, outside the snapshot source. Public JS distributions and
original package source/version files were not changed by this repair.

Owned build-only controlfcc15590dfe50fe12c450553 passes native-library merge,
child0/cleaned, with actual generated dependency roots all inside the isolated
node_modules. Independent terminal audit verifies its two recorded process pairs
absent; generated owned build artifacts are intentionally retained. This is build
and linking proof only, nativePassingCases0. The first terminal-audit probe rejected
a no-known-job expectation because a separate Xcode job had started; the subsequent
scoped audit retains that foreign activity and proves only owned process absence.
At last verified census, foreign Xcode PID88251/start Wed Sep30 13:24:25 2026 is
live/contended. No new native attempt was dispatched into that contention.

Next eligible native packet: recheck the actual host census, freeze updated
snapshot inputs and archive v10 controller bytes against its intent before adding
a new attempt. Obtain clean updated-adapter runtime/staging, then detect the
controlled quantity-render regression with unchanged expected assertions, qualify
original failure/staged bytes, restore exact source and prove clean behavior.
Public finalization, both-engine/platform lifecycle, other families, comparisons,
exploration and hosted/retirement gates remain open. Preserve ignored evidence
and paired worktrees. All prior owned native/build handles above are terminal.

The foreign Xcode job is absent at the fresh16:30:22UTC host census. Original
v10 controller bytes are archived and hash-bound to its original intent before
adding isolated bound-training-v11. V11/tool74394 is now terminal0, observed/
cleaned, capture73dce7470fffa36320f136b0/requested9df6120a7eac576614775539/
backendabfd628cd6051f7283bb4621. Updated Metro entry/cache containment preflight
records the local Router entry and13 contained native roots. Original child0,
callback1/complete and all seven UI/API/SQL bindings verify; runtime/staging pass.
Independent outer audit verifies623 recorded process pairs absent, six owned
directories and backend/Compose/cache/ports absent, borrowed ADB and foreign
iOS/AVDs preserved, source/helper inputs stable and workspace APK unchanged.
Separate terminal staged-evidence reverify passes. Parent audit:
isolated android-lifecycle-extraction-2026-09-29/bound-training-v11/terminal-audit.private.json;
primary preservation audit: android-assertion-failure-2026-09-30/isolated-v11-preservation.private.json.
This qualifies the updated private Android happy runtime at recorded inputs;
publicFinalization=false/nativePassingCases0. Failure/lifecycle/finalization,
other platform/engine/family, locale/comparison/hosted gates remain open.

Immediate next packet is the strict detecting/restored quantity-render control
in the paired isolated worktrees. Archive current controller bytes against v11's
original intent before extending allowed control names. Preserve exact baseline
SessionCard bytes, mutate only its quantity render, keep expected3x8 unchanged,
regenerate declaration for mutated inputs, and qualify the original failing raw
engine/target-health/full cleanup/staged bytes. Restore exact source only after
the failed capture is terminal, then obtain clean fresh restored proof. The
primary product source remains untouched. All current owned handles are terminal.

Current implementation continuation: Android required-quantity failure preparation
is implemented in the shared strict classifier and the existing Android capture/
adapter. It normalizes Android's original -readiness command label, checks native
text and exact title/session, requires successful owned boot/state logs before/
after diagnostics, verified target identity and owned API200, then full independent
cleanup. Candidate/staged bytes are exclusive and grant zero passed bindings.
Android staging rejects crossed adapter kind/fixture, child0 and fabricated passed
bindings. Existing iOS fields/health paths stay separate. Public dispatch remains
Pending until actual detecting/restored/finalization and lifecycle controls qualify.

Local checks under android-assertion-failure-2026-09-30: focused16pass/0fail/0skip,
typecheck/scoped lint0warnings and impact pass. Full unit1827/1826pass/1known missing
password-reset route failure/0skip. First lint found two import-order warnings,
corrected; all initial failures retained. No product/auth/API/schema/copy/locale
change in the primary checkout. The Android capture now creates its private output
parent recursively, matching fresh-checkout behavior rather than requiring an old
native-pilot folder. Primary sources and regenerated declaration are copied into
a separate paired detached client/server snapshot; its original file hashes and
subsequent harness-only repair are recorded. No commit/push/hosted action.

Isolated client: /Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions
(managed worktree attached here); server: sibling server detached worktree.
Snapshot metadata is native-regression-snapshot.private.json in their parent;
primary packet records snapshot-reference.private.json and source-control archives.
Retain the worktrees and ignored .qa evidence until the controls are reconciled;
never archive without preserving required private captures. Dependency links and
catalog schema links are explicitly recorded; no original repository is mutated.

Original isolated setup controls remain failed: v6 could not create requested root
before child dispatch; v7 generic pre-capture error lost its exact cause (no native
capture parent created), outer2 with seven recorded controller pairs absent. V8
capturefbf3cf64c249b0be5586596d reaches adb/emulator/backend, then backend acquisition
fails before callback0; original child/outer2, harness-blocked/cleaned and external
cleanup failed/unavailable remain unchanged. No backend manifest exists. Read-only
diagnosis reproduces directory-read errors on both untracked node_modules symlinks;
only the isolated .gitignore files are repaired to exclude those dependency links.
Independent audits verify86 recorded pairs absent (including backend child), six
recorded directories absent, five reserved ports clear, queried backend Compose
namespace absent, borrowed ADB preserved and no-known-job. This is bounded resource
absence, not repair of the missing manifest or full original cleanup qualification.

Planning reconciliation (2026-09-30): original isolated bound-training-v9
terminal snapshot records code2/signalnull; capture87abe13ee6c202a5e177c293/
requested7132d2fe41f8cad97d8bbf3c records harness-blocked/cleaned with no listed
cleanup failures, and its adapter records verification not-executed. Required
entry-readiness failed. The former live-session35313 instruction is superseded
by these original terminal records; do not poll or relaunch that old handle.
This planning check does not establish the remaining independent outer cleanup
audit. Inspect the original readiness screenshot/Metro logs and isolated
dependency layout, qualify cleanup, and change the diagnosed conditions before
another attempt. Current controller bytes were archived against v8's
original intent before adding v9. No result is inferred from elapsed time. After a
qualified clean baseline, introduce the documented SessionCard quantity-render
regression only in this owned isolated revision; leave required3x8 assertions
unchanged, qualify original failed raw engine/health/cleanup/copied failure bytes,
restore exact source and obtain clean proof. No training or public pass yet from
this new failure-handling packet, and no T13/T14/T15/hosted promotion.

Latest completed packet (2026-09-30): bound-training-v5
captureed4d7d0a660845759ca1ba78/requested5b9df6a198bafbd2e5d962ee/
backendadb529d872f29e2951f37132 completes once with original child0/outer0,
observed/cleaned. All seven canonical bindings verify: normal entry, local draft,
first save, edit draft, edited save, relaunch read and unrelated state. Six SQL
checkpoints, three authenticated API reads and normal POST/PATCH/GET transport
agree. Current SDK/JDK, APK/source/helper/reader fingerprints pass, as do runtime
frames, fresh requested/capture/backend binding, exclusive staging and reverify.
Independent terminal audit verifies1146 historical PID/start pairs absent, six
owned directories/cache/Compose absent, reserved/service ports clear, borrowed
ADB and foreign iOS/AVDs preserved, and source/workspace APK unchanged.
A separate preservation audit rechecks all60 original/copied files. Artifacts:
`android-lifecycle-extraction-2026-09-29/bound-training-v5/terminal-audit.private.json`
and `android-census-recovery-2026-09-30/bound-training-v5-preservation.private.json`.
Private runtime/staging qualified; public finalization=false/nativePassingCases0.
Visual acceptance, locales, comparisons, hosted evidence and parent T13 remain open.

Important observed branch: v5's Select all was directly visible, and the exact
raw conditional overflow command was SKIPPED. It qualifies the direct-menu path,
not overflow execution. Separate title-session-v9
captureac42ea2206d45ff61075ff6c uses clipboard text only inside its fresh owned
emulator to crowd the toolbar. Original setClipboard and exact android:id/overflow
commands are COMPLETED; exact Select all, installed-reader clear, replacement and
unchanged SQL pass. Callback's strict completed-branch guard rejects a skipped
branch. Original child0/outer0/observed/cleaned and independent terminal audit
verify531 recorded pairs absent, six directories/cache/Compose/ports absent and
borrowed/foreign inputs preserved. It never creates a session or presses Save;
zero full-training/public passing cases. Control sources were archived against
v5's original intent before adding v9. Its scope is OS title-selection only.

Final read-only native host census reports no-known-job. Post-documentation
inventory/title focused checks pass14/14/0skip; declaration remains current and
no native passing cell is generated. Touched formatting and diff checks pass.

Current checks-v5:1826 tests/1825pass/1known missing password-reset confirmation
route failure/0skip; typecheck, zero-warning scoped lint and impact pass. No product/
auth/API/schema/copy/localization change; FR/UC/BR/AC/screens/locales need no behavior
update. Original v4 menu failure and original v1/v2/v3 failures remain unchanged.
No native/backend command handle from this packet remains live; both new controls
were observed through terminal exit and independent outer cleanup.

Next work card: reuse `native-maestro-assertion-failure.ts`,
`capture-android-testability.ts`, `run-android-training-attempt.ts`,
`native-training-public-evidence.ts` and `run-native-pilot.ts`; preserve qualified
iOS behavior. Add Android platform-specific raw required-quantity failure, exact
wrong-value/title/session tree, owned target boot/identity, healthy owned API,
current immutable inputs and full independent cleanup qualification. Child1 alone
must remain a harness block. Keep private callback incomplete on assertion failure,
zero passed bindings, and copy only qualified failure bytes exclusively. First
exercise synthetic missing/crossed/stale/driver/health/cleanup rejection boundaries;
then obtain actual clean → detecting regression → exact restoration/clean evidence
before enabling public Android dispatch. Implement remaining lifecycle/deadline/
signal/finalization controls and keep all T12–T20 denominators. Native session
local logout versus revocation still requires the pending owner decision; training
work can proceed independently. No hosted dispatch or auth behavior change.

Latest terminal attempt: bound-training-v4 capturec4876ad157d0ed03905261e2,
requested6d169f3a7cef7074901f0374/backend48aa724da5178f1caae7a178, stops at
journey-edit-title-selection-menu-readiness after normal login and first save/
reopen. Original child1/outer2, harness-blocked, callback1/incomplete, zero bound
assertions, no verification/public pass remain unchanged. Original cleanup and
independent inner inspection pass; separate terminal-v4 audit verifies1724
recorded capture/controller/backend PID/start pairs absent, Docker absent and
all recorded resource boundaries. Original failed screenshot/hierarchy show
Translate/Cut/Copy and enabled android:id/overflow; Select all is in overflow.
The driver now conditionally opens that exact OS button when Select all is
hidden, then requires the unchanged exact Select all/cleared native-reader proof.
No coordinates, optional assertion, product change or deadline widening.

Final checks-v4 before that attempt:1826 unit tests,1825pass/1known missing
password-reset confirmation route failure/0skip; typecheck, scoped lint and
impact pass. Inventory341files/declaration0nativepasses. Next: format/regenerate
changed harness/docs, focused/type/lint checks, then a fresh bound-training-v5
with frozen inputs. Do not retry the original unchanged action.

Latest continuation: bound-training-v3 capture4a7f9aa18b708d4d0455df0e stopped
before build/callback during Expo's strict startup census. Original child2,
harness-blocked, callback0 and zero assertions are retained. Original inner/full
recorded-resource cleanup passes; separate terminal-controls audit verifies140
known historical pairs across that attempt and the subsequent Expo verification.
V3's generic Expo census error did not preserve the unavailable pair history,
so its current known absence does not become complete unknown-process proof.

Expo now retains all strict/background query diagnostics in its separate private
`expo-census.ownership.json`, which contributes to aggregate absence without
granting signal authority. Only the typed unavailable-argv condition delays a
startup probe inside the existing deadline; strict readiness/listener and signal
guards still apply. Post-signal absence observation carries PID/start only and
keeps unknown rows live until gone; it cannot authorize signals. Startup's first
identity check is bounded by that same deadline. Existing main protocol remains
unchanged and malformed/foreign census is not classified as transient readiness.

Actual owned Expo verifier at expo-2026-09-30T13-55-27-372Z passes real browser
sign-in/API origin, occupied foreign port preservation, cancellation after spawn,
owned group/cache release and private sidecar recording. Independent audit
verifies26 Expo historical PID/start pairs absent, all related listeners/cache
and owned Docker absent. These are Expo controls, not a native training pass.
Checks-v3 focused53/type/scoped lint pass; its full unit invocation correctly
rejects a declaration left stale by a later comment-only owner-helper change.
Retain those first failures. Final formatting/regeneration precedes checks-v4
and the fresh bound-training-v4 attempt; freeze those inputs through termination.

### T13-K command census and retained resource recovery (2026-09-30)

Implemented in the existing owner: background census retains unavailable Darwin
argv without adopting its hash or granting executable/descendant ownership.
One bounded requery remains; strict acquisition/action/signal inspection still
rejects persistent unavailable argv. Both observed user/caller boundaries are
checked before authority. A failed requery retains its first diagnostic pairs.
The shared absence collector includes diagnostic, escaped and rejected/current
censuses, validates present records, and keeps reused PID starts distinct.
Old ledgers without diagnostic fields remain supported. No deadline or natural
exit grace is widened; existing genuine executable-drift rejection is preserved.

Actual independent recovery of original capture251536411176d3e44c6e71cf verifies
56 capture/controller/backend/diagnostic PID/start pairs absent, all recorded
groups absent, seven acquired/service ports clear, no owned Docker/cache,
borrowed ADB preserved and unchanged foreign iOS/AVDs. Recorded root/nonce/UID/
dev/inode/marker and all six directory identities were verified before removing
only those owned directories. Original receipt and owner hashes remain unchanged.
`android-census-recovery-2026-09-30/retained-resource-recovery.private.json`
is recovery-only: the original harness-blocked/failed-cleanup/child2 and zero
assertions remain failed. Root ownership marker remains for audit.

Current checks-v2 records53 focused passes/no skips, zero-warning scoped lint;
typecheck and impact validation pass. Full unit run1826:1825pass/1known missing
password-reset confirmation route failure/0skip, exit1. First checks-v1 retained
an additional newly introduced test race: a timer-ended controlled child exited
before strict rejection. The corrected test uses an explicit private release
marker; it proves live strict blocking, no placeholder exec adoption, observed
pair retention, real child0 and strict cleanup afterward. Source guard failures
before declaration regeneration and initial lint warnings remain retained.
No product/auth/API/schema/copy/localization change; FR/UC/BR/AC/screen and locale
artifacts need no behavior update. Current bounded recovery/control proof does
not complete T13 or create Android/public/comparison/hosted passing cells.

Historical next control was fresh bound-training-v3 with exact new requested/capture/
backend IDs. Its controller bytes are archived against the original v2 intent;
the outer audit now also includes diagnostic-only historical pairs. Qualify all
seven UI/API/SQL proofs, exclusive copied references, unchanged captured inputs
and full independent inner/outer cleanup before assigning positive runtime scope.

Planning refresh, 2026-09-30: current source inspection confirms the Android
runtime mapper, SDK/JDK and reader freshness guards, strict full cleanup gate,
private attempt adapter, shared child outcome helper and platform-bound staging
exist. Retained `android-runtime-mapper-2026-09-30/current-checks-v1/` logs record
68 focused passes, typecheck/scoped lint success and impact validation. The full
unit run exited1 with the existing password-reset confirmation route failure;
it is not green. This refresh reran no runtime checks and promotes no native cell.

Original bound-training-v1 captured0253c91be01223dd242b770 and bound-training-v2
capture251536411176d3e44c6e71cf both failed before the training callback. V2 reached
entry-hierarchy with child0 but parent harness-blocked command census; original
cleanup is failed-recovery-retained and independent cleanup unavailable/failed.
Keep every original outcome. The owned target root remains at planning inspection;
the exact recorded emulator/entry PID query found no live rows, which does not
establish aggregate cleanup. The independent absence collector currently reads
`processes` only and misses diagnostic `commandCensusRequeries` pairs. Next packet
must account for those observations without granting signal authority, verify
retained resource recovery and diagnose census semantics before a fresh attempt.
See the entry point's Packet 0 for paths, rejection controls and exit evidence.
Full T12–T20, actual Android seven-assertion completion and public qualification
remain pending. No product/auth/API/schema/localization change in this packet.

Preceding implementation work card: extend the existing training evidence mapper with
an explicit Android runtime entry point, exact reader/tool/source/APK freshness
and full cleanup guards; add the private Android attempt adapter and platform-
bound staging. Governing behavior remains SC-208/FR-001/BR-002/TC-002 and the
canonical seven-assertion training ledger. Reuse the existing owned Android
capture, saved-journey driver, requested-attempt binding and read-only cleanup
verifier. No product/auth/API/schema/copy/localization change is proposed.
First qualify focused rejection controls and existing iOS preservation. Public
Android dispatch remains blocked until fresh actual full runtime, staging and
required lifecycle/application-failure controls qualify it. The planning turn
clarified the existing implementation entry point and checked formatting/local
links; it did not execute or promote a native cell. Full T00–T20 goal stays active.

Current cleanup packet: implemented read-only `verify-owned-android-cleanup.ts`
with private census helpers extracted from the iOS verifier. Existing iOS checks
are preserved; both captures bind the common helper. Strict Android acquisition
prefix/intent/owner/terminal-backend checks cannot turn missing manifests into
absence. Target preflight publishes its exact planned root and original failure
before any target resource is created. Target owner/cleanup binds all five ports,
including gRPC; capture records app/proxy ports before later startup. Unavailable
inspection emits one private failed receipt, never overwrites or repairs history,
and never emits a native passing case. Partial scope uses null for never-dispatched
Docker/Expo proof. Full source/build/tool freshness and outer termination are
separate requirements. No product/auth/API/schema/copy/localization change.

Fresh whole-timeout-v5 capture0af26d917938f94696d24bcf qualifies the current
adb→emulator early-acquisition cleanup path. Unchanged1000ms whole deadline
produces original child2/harness-blocked and clean inner/outer teardown. All five
reserved ports are clear, six directories absent, two capture-owned PID/start
pairs absent, and the outer audit verifies16total pairs including controller.
No backend/proxy/Expo/build was dispatched, so no Docker/cache/journey proof is
fabricated. Current default ADB is borrowed and its exact PID/start/command is
preserved. Original source/helper/workspace APK/AVD/foreign-iOS inputs are stable.
External read-only inspector and exclusive external-cleanup receipt pass. Control
source was archived against full-v3's original intent before adding only this new
name. Native passing cases0. No owned native/backend attempt remains live. Final read-only census
at2026-09-30T12:07:55Z reports no-known-job and independently reconfirms exact
borrowed ADB preservation. All quality/audit/native command handles are terminal.

Final focused35pass/0fail/0skip includes strict malformed/crossed/stale/duplicate/
missing/undispatched acquisition, live process/resource, borrowed-service/foreign
state and immutable failed-receipt controls. The real target preflight rejection
publishes exact planned-root/failure evidence while creating no target resources.
Typecheck, scoped lint0warnings and touched formatting pass. First scoped lint
found4warnings (template types/import order), corrected before final validation.
Current inventory340files (278client/62server), declaration/diff checks pass.
Full bounded unit run finishes1814pass/1known missing password-reset-confirm
route failure/0skip (1815tests across211files). Exact argv, log and terminal
result are retained under android-cleanup-verifier-2026-09-30/current-checks-v1.
No component/browser/provider suite was repeated: product inputs are unchanged.

Retained full-v3/full-v2 current inspections reject a newly started default ADB
replacement; the earlier owned release receipts remain immutable. Retained
v7 rejects its original cleanup failure; legacy emulator-first timeout protocol
rejects as stale. Retained iOS c181b63f793677014c7355c1 has691PID/start pairs absent,
owned simulator/cache/Compose absent, but one recorded foreign device state now
differs; current requalification fails and its earlier proof is not overwritten.
This does not contradict its artifact/state preservation proof below. All private
audits are under android-cleanup-verifier-2026-09-30; exact v5 lifecycle receipts
remain under android-lifecycle-extraction-2026-09-29/whole-timeout-v5.

Pending: fresh full Android backend/proxy/Expo/target/default-ADB cleanup proof,
seven-assertion mapper with current source/APK/reader-tool fingerprints, fresh
requested-attempt adapter/staging/public finalization and actual clean/regression/
restored/negative controls. Public Android selection stays blocked. Remaining
T12/T13 cells and T14–T20/full goal remain active, not complete or blocked.

Current Android saved-artifact packet (harness only): strict Android preparation
now verifies the same six SQL/three authenticated API checkpoint contracts and
normal native POST/PATCH/GET transport as iOS, with exact Android title/session/
exercise/quantity values. Separate entry points reject crossed platform/scope;
iOS paragraph selection and reviewed/runtime frame behavior remain unchanged.
The Android frame writer binds nine original PNG/tree pairs, requires native
Select all and removal-body text attributes, writes unreviewed fingerprints
exclusively, and cannot promote a failed capture or overwrite evidence.
Cleared-title preparation binds the original successful OS instrument log,
capture/step, hint discriminator and hierarchy to signed/installed reader bytes;
source freshness and independent cleanup remain separate caller requirements.

Current focused34pass/0fail/0skip, typecheck and scoped lint0warnings pass.
Full bounded client unit1808pass/1known missing password-reset-confirm route
failure/0skip (1809tests across210files), with exact argv/private log/terminal
result under android-saved-evidence-2026-09-30/current-checks-v1. First scoped
lint run found2 import-order warnings; corrected before the final check. Current
339-file inventory (277client/62server), declaration and diff checks pass.
No component/browser/provider suites repeated: product inputs are unchanged.
Four retained iOS captures (e6d9b6a3e17c4ce86c04b0f1,
c181b63f793677014c7355c1, f851f668b2db87e7f6e030b6,
06354d06bef3e7a4a541c3db) pass the current shared artifact validator at recorded
inputs. Their original receipt/checkpoint/frame/transport bytes are unchanged;
separate private audit hashes the originals and current verifier. This is
preservation proof, not new iOS runtime/cleanup/public qualification. The standalone
auditor under android-saved-evidence-2026-09-30 qualifies retained full-training-v3
artifact preparation at its recorded runtime inputs. All nine frames/six SQL/
three API checkpoints agree. Cross-platform, missing menu frame, missing POST,
original failed full-training-v2 and duplicate output controls reject. Original
capture/metadata bytes are unchanged; only derived unreviewed frame hashes are
added exclusively. No completed capture is rebound to a public request and no
current runtime or new cleanup qualification is claimed. First auditor exit2 on
Android removal-body accessibilityText mapping is retained; actual hierarchy
requires native text, and the corrected strict platform check passes.

Pending: seven-assertion Android mapper with current source/APK/reader tool
fingerprints, intent-aware external Android cleanup (including early failure),
fresh requested-attempt adapter/staging/public finalization and actual negative/
clean/regression/restored controls. Public Android selection stays blocked and
native passing cases0. Final read-only host census at2026-09-30T11:32:03Z
reports no-known-job; no native/backend resources were acquired in this packet
and all quality/audit commands are terminal. No product/auth/API/schema/copy/localization change;
FR/UC/BR/AC/screens/copy require no updates for this harness packet.

Prior binding packet checks: focused49passed/0failed/0skipped; full bounded
client unit1805passed/1known missing password-reset-confirm route failure/0skipped
(1806tests across209unit files). Terminal command/result and private log retained
under android-public-binding-2026-09-30/current-checks-v1. Typecheck passes;
full lint0errors/3004existing warnings, scoped changed-file lint0warnings, touched
formatting, current338-file inventory/declaration and diff checks pass. Impact
validation12features/43suites/62UI remains applicable to unchanged impact config.
No component/browser/provider suites repeated because product inputs are
unchanged; actual Android private UI/API/SQL qualification is recorded below.
Fresh host census at2026-09-30T11:04:27Z reports no-known-job; owned native/backend
attempts are terminal and independently absent. Full goal remains active;
private native passing cases0 and no hosted/comparison/retirement claim.

Shared requested-attempt binding is implemented and locally verified for exact
iOS/Android SCN-training/maestro/integration selection and matching fixture scope.
Crossed platform/scope/attempt/hash, stale selection, duplicate writes, wrong
mode/engine and aliasing requested/capture/backend identities reject before proof
publication. Both-platform binding, unchanged iOS staging and adapter rejection
controls5pass/0skip. First run failed4cases on stale generated declaration after
the helper edit; regenerating current fingerprints restores5pass. Typecheck and
scoped lint0warnings/format pass. Inventory refresh is current after the test
edit. Public Android selection remains blocked.
This packet changes only harness identity contracts; no product/auth/localized
copy/API/schema behavior changed, so FR/UC/BR/AC/screen/copy need no updates.

Full-training-v3 capturefa50cf16745d65398130f52d passes the complete private
Android create/save/edit/save/app+API restart/reopen journey with child0 and
original inner/outer clean teardown. Six ordered scoped SQL checkpoints and
three normal authenticated API reads agree with exact title/session/exercise and
3x8→4x10 UI values; new/edited drafts remain local, one intended plan is created,
unrelated state is unchanged and updated content survives restart on the same
plan/session identity. Actual native Select all/clear, independently bound OS
hint flag, removal dialog and session-confirm gesture succeed. Independent
terminal audit verifies1881PID/start pairs,6owned directories,Compose,Expo cache/
default ADB absent, stable source/helper/workspace APK/AVD and recorded foreign
iOS state. Timingsms build75949/install1897/reset43657/scenario402469/
verify594/cleanup4781. This private qualification emits0public native passing cases.

Next binding packet accepts only exact per-platform SCN-training/maestro/
integration selections and platform fixture scopes. Requested/capture/backend
identities must be three distinct runs; requested and backend first-attempt IDs
stay distinct. Add both-platform tampering/stale-selection/duplicate-write/
wrong-mode/wrong-engine/cross-platform rejection controls. Existing public alias
remains iOS-only until Android mapper/verifier/runtime/finalization are qualified.
No completed private capture is rebound retroactively to a public request.
No owned native/backend attempt remains live. Current/previous turns are progress;
remaining T12/T13/T14–T20 stays active and Pending.

Full-training-v2 capture6a75b541ce49c39927969188 stops at
journey-session-readiness child1 after typing Strength/hiding keyboard; default
scroll cannot reveal addSession.confirm. Original outer child2 and harness block
are retained. Actual failure screenshot and session-editor hierarchy show the
guidance above the session input, with confirmation below view. No Save or final
journey state occurred. Independent failed-attempt audit verifies626PID/start
pairs,6directories,Compose,Expo cache/default ADB absent and original clean
teardown/stable inputs. Public native passes0.

The driver now verifies the captured exact enabled guidance TextView is outside
the unique enabled session EditText, then uses the existing mandatory guidance
swipe before Confirm's bounded visibility check. iOS unchanged, no coordinates,
optional assertions, timeout increase or product/localization change. Focused
training/reader/edit/controller20pass; typecheck and scoped lint0warnings pass.
The failed-cleanup wrapper test additionally requires the exec descendant itself
alive with changed command hash and the original failed ledger retained; its
stronger real control passes. Fresh full-training-v3 is required to qualify the
corrected transition and continue the complete UI/API/SQL recipe.

Fresh title-session-v8 capture56092150dcc70d2ef9caaecd qualifies the bounded
input/gesture seam with original child0, inner/outer cleanup cleaned and normal
owned default ADB release. Independent terminal audit verifies628PID/start pairs,
6owned directories, Compose and Expo cache absent, stable source/helper/APK/AVD
and recorded foreign iOS state. Original raw logs bind initial hint=true,
cleared hint=true and exact replacement hint=false; Select all/guidance/Add
visibility and unchanged SQL pass. Timingsms build80539/install2037/reset43546/
scenario138755/verify560/cleanup4807. Public native passing cases0.

Next full-training-v2 is a fresh normal-UI create/save/edit/save/app+API restart/
reopen using the same shared driver/controller. Require six ordered scoped SQL
checkpoints, three normal authenticated API reads, exact exercise/3x8→4x10/title,
no duplicate/unrelated mutation and full independent original cleanup. Its
auditor binds the actual OS-backed cleared-title raw log and signed/installed
reader identity instead of interpreting hint text as a value. Original v8 control
scripts are archived against their intent hashes before this new accepted name.
All inputs freeze while live. Full Android public binding/mapper/finalization,
other lifecycle/platform/engine/locale cells and T14–T20 stay Pending.

T13 bounded failure-reference correction is locally verified. The real wrapper
control exits2 while its controlled unverified descendant remains live, retains
the original failed ownership ledger and PID/start identities, then releases the
fixture through its own marker. Focused ownership/reader/platform checks29pass;
after correcting one unused test variable, native-command10pass, typecheck,
scoped lint0warnings and touched source formatting pass. Declaration/inventory
refresh retains23views/40transitions/10untested,338files and0native passes.

Independent v7 recovered-input-controls audit verifies1617PID/start pairs,
6owned directories, Compose and Expo cache absent; signed/installed reader bytes,
three original raw OS input bindings, selected/cleared/replaced UI frames,
guidance/Add visibility and unchanged SQL. Recorded inputs remained stable.
The only current helper drift is the explicit bounded failure-reference fix in
owned-native-command.ts. Original child2/failed cleanup is immutable;
fullCleanupQualificationfalse and publicNativePassingCases0. Audit path:
`.qa/artifacts/testing-modernization/android-lifecycle-extraction-2026-09-29/title-session-v7/recovered-input-controls-audit.private.json`.

Original v7 control scripts are archived against intent hashes before adding
unique v8 selection. Next v8 uses the same normal UI/read-only reader recipe,
new source fingerprints and independently audited original clean teardown.
Fresh host census at2026-09-30T10:29:22Z reports no-known-job. No product,
auth/localization, deadline, grace or signal authority changed; full saved
Android/public qualification and remaining T12/T13/T14–T20 stay Pending.

T13-K title-session-v7 capture213c798fcbac1f9b03273a18 observes actual initial
hint=true, selected/cleared hint=true and replacement hint=false with exact value;
guidance swipe/Add visibility and Select all/clear/replacement pass, SQL unchanged.
Reader source/tool/signed/installed bytes and original raw logs are bound. All
command children0/cleaned. Final default ADB release rejects a separate attached
emulator5556; original cleanup remains failed. After that emulator detached,
exact identity/listener/no-devices/no-consumers recovery released only the owned
service. Outer child2 terminal. Fresh full cleanup qualification remains Pending;
these successful observations do not become a public or comparison pass.

T13 bounded failure gap: a rejected owned-child release closes logs/census but
keeps its parent alive through the ChildProcess event-loop reference. Release
only that local reference after a failed stop; retain original ownership ledger,
PID/start, error and failed cleanup, without signalling the surviving resource.
Add a real wrapper-exit control with an unverified exec descendant retained alive,
then release that controlled fixture through its own private marker. No authority,
cleanup grace or execution deadline is widened. Current task card owns proof.

Current/previous turns are progress. v7 executor/outer controller terminal;
shared service released after foreign device detached. No owned native job live.

T13-K title-session-v6 capture1c3ae8fd105ae7ca1c5a7384 reaches normal login,
coach home/library/fresh builder/guidance observations. All command children0 and
inner/outer cleanup cleaned; session-owned default ADB released normally. Signed
reader compiles/verifies but metadata parsing rejects SDK36's minSdkVersion header
before installation. Correct this observed field spelling, keeping exact minimum
26/target36/package, unique headers and no permissions. Five focused parser/input
controls pass; actual original badging bytes now pass the corrected parser. This
is not original runtime success or raw input proof. Retain v6 as failed.
Next unique title-session-v7 runs the unchanged UI recipe and corrected metadata
boundary; installation/OS flag/menu/clear/gesture/replacement remain Pending.
No product/auth/localization or deadlines change; public native passes0.

Current/previous turns are progress. v6 controller is terminal; all owned
resources absent and default ADB released. No owned native/backend process live.

T13-K title-session-v5 captureb429dc874646a343f232f700 qualifies the narrow
session-reference/entry-hierarchy seam: both entry child commands0/cleaned and
exact owned default-service identity retained. Normal sign-in/coach-home readiness
child0 completes; the next hierarchy command is blocked by a recorded competing
Gradle PID47187/startSep30 06:42:52 outside this build's acquired history. Only
SCR-sign-in is fully captured. Default-service release correctly rejects the
foreign consumer; original inner cleanup remains failed. After the competing job
ended, exact identity/listener/no-devices/no-consumers recovery released the
recorded service. Separate full absence audit is retained; no public pass.

Next: unique title-session-v6, same source/UI recipe and session ADB receipts;
retain v5 first outcome, do not exempt contention or widen deadlines. All inputs
are frozen while live. Full input/menu/gesture and public qualification Pending.

Current/previous turns are progress. v5 controller is terminal; no owned
native/backend process remains live at this update.

Default ADB reference preparation is implemented through the shared iOS helper,
with exact pre/post-command checks, adb-first acquisition, release after emulator,
bound helper fingerprints and rejection of unreturned acquisition cleanup. The
isolated Android ADB remains unchanged. Focused39passed/0failed/0skipped; typecheck
and scoped lint pass (import warnings corrected). Runtime reference/input proof
remains Pending via title-session-v5; no private diagnostic is a public pass.
After the foreign Detox job ended, supplemental exact owned default ADB recovery
verified identity/listener/no devices/no consumers before release. Separate v4
audit proves2138PID/start pairs,6directories,Compose,Expo cache absent and stable
recorded inputs; original failed cleanup is unchanged, fullCleanupQualification
false. Default ADB absent and host no-known-job at2026-09-30T09:36:45Z. Original
v4 control bytes are archived against intent; v5 additionally requires the
session-reference acquisition/cleanup receipt and correct owned/borrowed boundary.
No owned native/backend execution remains live. Full T13/T14–T20 remains Pending.

Historical v4 trigger and implementation work order:

T13-K title-session-v4 captureed1c4b162af576d31786f31e builds, installs,
configures native networking and launches successfully. Entry hierarchy child0
starts default ADB PID42620/startWed Sep30 06:26:48 under its step group; cleanup
rejects that shared resource. Original inner cleanup remains failed, outer clean.
Foreign Detox PID45707/startWed Sep30 06:27:05 is now live; preserve it and the
shared service, and do not acquire a new native run while contended.

Next implementation reuses acquireAdbServerReference already used by iOS:
acquisition order adb/emulator/backend/proxy/expo; own-or-borrow a session-wide
reference before the emulator, verify identity around captured commands, release
it after emulator teardown, preserve a borrowed service and check all consumers
before owned release. Keep the isolated Android ADB server/keys/ports unchanged.
Fingerprint the shared helper. No step may own an implicit default service.
Original v4 failures stay immutable; recover its recorded service only after
exact identity, exclusive listener, no devices and no foreign consumers are
verified. Android input/menu/gesture/full saved/public qualification stays Pending.
No product/auth/copy/deadline change. Task card owns exact current evidence.

Current/previous turns progress. The historical retained ADB recovery below
is now complete via a separate receipt; the original failed ledger remains.

T13-K title-session-v3 capturefb9fd4a788b5dc65791e27d5 stops during emulator
boot before backend/UI. Inner/outer cleanup is cleaned; independent audit proves
77PID/start pairs and6owned directories absent, no backend/proxy/Expo acquisition
and stable source/helper/APK/AVD. Log ends in Vulkan initialization; no cause is
established and no graphics flag is changed. Original boot exit/outcome was not
retained. The owner now writes original command exit/signal/census before cleanup;
publication failure still proceeds to cleanup and retains the original error.
Qualify the next unique title-session-v4 with unchanged bounded UI recipe. Raw
reader/gesture/clear and public qualification remain Pending; public passes0.

Current source checks: native-command9tests pass; typecheck and scoped lint
0warnings pass. Historical full unit1800/1801 retains known auth-route failure.
No owned attempt is live at this update; current/previous turns are progress.

T13-K title-session-v2 capture9cc132716039ba00f88e28db reaches disposable
backend and build; Gradle exits0, but the native command is harness-blocked before
installation. Original inner/outer cleanup is cleaned. Independent audit proves
478PID/start pairs absent,6owned directories/Compose/Expo cache absent and
source/helper/APK/AVD stable. No UI/reader action or public pass occurred.
Periodic non-strict census failure caused command classification, but its original
cause was not retained. Now preserve that first private cause/class/time and bind
it in the terminal command record; synthetic controlled malformed-census proof
rejects child0 despite later clean cleanup. It is not a diagnosis of v2 or native
success. Native-command9tests pass, typecheck passes; remaining runtime
qualification is Pending via unique title-session-v3. No signal authority,
expectation, deadline, product/auth/localization contract is changed.

Previous packet: T13-K Android driver qualification. title-session-v1
capture91f34cf29e83948b4521294f stopped before UI on unavailable Docker backend
acquisition; original inner cleanup failed. Supplemental exact acquired emulator/
isolated ADB leader recovery removed6birth-bound directories and stopped the
otherwise-live callback; original outer terminal143, inner blocked2 remain failed.
Separate audit proves1180PID/start pairs absent, exact Compose absent, default ADB
absent and host no-known-job at2026-09-30T08:57:47Z. Full cleanup qualification is
false; public native passes0. Docker Desktop is now running.

Current continuation adds Docker readiness before native acquisition, typed
backend-failure identity retention and first rejected strict census preservation.
Later monitor updates cannot erase that rejection; command drift still blocks
signals. The original failure cause is not inferred from source changes.
Current post-v1 preparation: typecheck and scoped lint0warnings pass; focused
37passed/0failed/0skipped including persisted strict rejection after natural exit.
Inventory/diff checks pass. Prior complete broader run1800/1801 retains its
known server-route failure; this diagnostic-only update refreshes affected
ownership/import/reader checks without rerunning unrelated product tests.

Next: title-session-v2 on current inputs, same bounded input/reveal controls and
independent cleanup audit. Full saved Android/public and remaining T13–T20 stay
Pending. No owned attempt is live at this update. Previous/current turns progress.

Current pre-native checks: typecheck0; focused37passed/0failed/0skipped; full
lint0errors/3004existing warnings; impact12features/43suites/62UI; inventory
338files (276client/62server), declaration23views/40transitions/10untested
and formatting/diff checks pass. Full unit1800passed/1known missing
`/auth/password-reset/confirm` server-route failure/0skipped; timing-budget
checks pass in this bounded-concurrency run. Logs/exit codes: private
android-native-text-2026-09-30/current-checks-v2. Product inputs remain unchanged; harness-only
changes do not require another component run. All runtime/control gates stay
Pending.

Current host refresh: earlier quality handles are missing and their processes
are absent; no terminal result is inferred. The partial unit log includes two
timing-budget failures and the known missing server route, but lacks its final
summary. Current-checks-v2 reruns applicable checks with bounded test concurrency
and durable logs/exit codes. Default ADB listener preservation now records fresh
identity or absence; old borrowed PID54370 is absent. No native job was live at
2026-09-30T08:47:43Z. These facts add no pass.

Current continuation: read-only Android input reader and the private
title-session-v1 small-control callback are implemented. SDK Java compilation
and37focused checks passed before final diagnostics/scratch/profile refinements;
refresh checks on current inputs before execution. Owner escaped-child filtering
now requires exact PID/start identity; retained latest census supports diagnosis.
Different-start PID reuse is excluded, command drift still blocks signals. This
does not identify the original release failure cause. Exact full-training-v1
control scripts are archived against their original intent before extending
accepted names. Actual reader/gesture/menu/clear/replacement/cleanup remains
Pending; no product/auth/localization/FR/UC/BR changes or public passes.

T13-K current raw-input packet (In progress): pinned Maestro cli-2.6.1 source
commit00f516729f57d48f36ded55244cfbe358ada6b00 serializes AccessibilityNodeInfo text
and hint but omits isShowingHintText. Android's public API defines that flag as
whether text represents a hint; native TextView emits it while the actual value is
empty. Archive exact primary source blobs and installed tool hash before work.
Implement a small read-only instrumentation probe on the existing fresh owned
emulator through its bounded commands; inspect only canonical training-title
EditText and emit exact text/hint/OS flag plus identity/state. It has no input,
fixture, HTTP, permission-setting, app-data or production code operation. Compile/
sign into private capture artifacts using local SDK and a disposable signer; bind
source/tool/APK/installed bytes. No separate device/backend lifecycle or modified
Maestro binary. Require unique enabled editable visible field and raw OS flag;
hint equality without that flag remains rejected. Probe/selection/clear runtime
qualification and public adoption stay Pending. Diagnose the separate original
outer release failure with retained evidence; do not widen deadlines or rewrite
ledgers. No product/FR/UC/BR/screen/copy/localization update is needed.

Earlier planning-only handoff clarification: the entry point now defines literal packet
readiness/execution/completion predicates. Specification and handoff dispatch
links follow this card instead of historical T12/T13-D “next” paragraphs. The
Android work order preserves unique immutable attempt names and requires normal
catalog access before each authenticated restart read; a clipped-control gesture
still requires observed selectors and actual qualification. These documentation
changes add no runtime pass, task completion, tooling adoption or product behavior.

### T13-K shared Android training action driver (In progress)

Prerequisite T13-J bounded lifecycle/context controls qualify at their recorded
inputs: whole-timeout-v4 capture5af1a25f25247930c01a8694 expected blocked2,
13-PID/6-directory cleanup; entry-v4 capturee40f9e0a8fade5858b381fe7 normal
sign-in/coach home,636-PID/6-directory cleanup; runtime-restart-v7 capture
a05739aa638167baf512461f normal catalog before/after owned app/API restart,
identical SQL/API plan state and2716-PID/6-directory full cleanup. Terminal
backend history includes both API identities. Source/helper/APK/AVD/foreign-iOS
and borrowed ADB checks pass. All retain0public native passing cases; full T13
aggregate deadlines/signals/platform/engine/public gates remain Pending.

Next packet owner: client. Reuse native-training-maestro-driver.ts and the shared
native-training-journey controller; add an Android entry point without copying
the lifecycle/controller. Extend only the existing Android observer to exact
ID/text assertions required by native menus, preserving ID-only inventory callers.
Keep iOS wrappers and gestures unchanged. Android title/quantity hierarchy guards
read exact native text and canonical app IDs. Use the qualified selector-anchored
session swipe and normal UI create/save/reopen/edit/save/app/API restart/reopen;
six scoped SQL and three normally authenticated API checkpoints stay mandatory.
Qualify Android Select all/clear and item-removal controls from actual trees;
no coordinates, fallback, optional checks, token injection or seeded tested action.

Read SC-208/UC-002.7/AC-208,223/BR-293,294/linked training TCs and handoff14-D.
Test wrong platform/identity, missing/ambiguous title/item/quantity/menu/dialog,
uncleared title and data/transport disagreement. Bind driver/controller helpers
in Android capture fingerprints. First execute a uniquely linked private full
journey to diagnose missing platform seams; preserve failures and audit cleanup.
Public Android binding, independent verifier, evidence mapping/finalization and
supported public selection remain Pending until their subsequent implementation.
No product/auth/localization changes; update testability/decision/wiring docs.

T13-K implementation preparation: shared factory now has strict iOS/Android entry
points and a private Android full-journey observer. Existing iOS actions remain
unchanged. Android uses exact title/quantity text, mandatory selector-anchored
session reveal, observed Select all/complete clearing and actual native removal
message/button IDs/captions/bounds. Existing Android observer accepts exact ID/text
selectors and fingerprints driver/controller/quantity/edit helpers. Six scoped SQL
and three authenticated API checkpoints and normal transport verification remain.
Focused21passed,0failed,0skipped; typecheck and scoped lint pass with0warnings;
component5suites/41tests pass; full lint0errors/3004existing warnings; impact
12features/43suites/62UI and regenerated337-file inventory/native declaration pass.
Full unit retains the known missing `/auth/password-reset/confirm` server-route
failure; no auth behavior or scanner is changed to mask it. Evidence under private
`.qa/artifacts/testing-modernization/android-training-driver-2026-09-30/`.

Next actual control: unique full-training-v1. Exact v7 control scripts are archived
and hash-checked against the original v7 intent before adding its accepted name.
The private callback runs normal full create/save/edit/save/app/API restart/reopen,
with independent state/frame/dialog/API-history/full-resource audit. It retains
zero public native passes. Fresh host no-known-job and borrowed default ADB identity
verified; freeze all source/helper/doc inputs until terminal cleanup. Public
Android binding/mapper/verifier/finalization and full T13/T14–T20 stay Pending.

Actual full-training-v1: child1 at required
journey-session-editor-readiness's Add session scroll; private capture blocked2
after normal sign-in/home/library/fresh builder. No exercised Save or final
training journey result. The retained failure screenshot shows the default
scroll intercepted by the title input and keyboard reopening. Existing fresh
hierarchy has exact documented guidance TextView bounds[32,142][288,214], outside
title[32,288][288,330]. Driver now requires that unique enabled exact-copy anchor
with non-overlapping bounds and uses mandatory swipe.from.text before the existing
Add scroll. This correction is not yet runtime-qualified. iOS actions unchanged.

Original outer capture-controller cleanup ended failed-recovery-ledger-retained
with “Owned worker group did not stop”; later strict census found no survivors.
Do not rewrite the ledger as cleaned or infer a cause. Supplemental read-only
audit includes all outer/native/startup/terminal backend identities, Compose and
6owned directories, Expo cache, borrowed ADB and source/helper/APK/AVD/foreign-iOS
checks. It passes resource absence2832pairs, but fullCleanupQualification=false.
Immutable control scripts remain bound to their original intent; evidence under
`.qa/artifacts/testing-modernization/android-lifecycle-extraction-2026-09-29/full-training-v1/`.

Separate Android title-clear gap: fresh empty title exposes identical native text
and hintText “e.g. Caloric Deficit A”. Current strict empty-text guard rejects hint
substitution. Before weakening any check, qualify an independent actual raw input
value observation through the existing owned/bounded Android command context.
Require exact canonical EditText ID, unique enabled field and truly empty value;
hint equality alone is insufficient. Add negative controls for retained partial
text, hint ambiguity, duplicate/wrong field and missing raw evidence. No product
seam or localization change is authorized by this gap. Keep actual menu/clear,
removal/save/restart and public qualification Pending. Previous and current goal
turns are progress; no repeated external impasse.

Post-failure current code checks: focused22passed/0failed/0skipped; full unit
1795passed/1known server-route failure/0skipped; typecheck and scoped lint0warnings
pass; full lint0errors/3004existing warnings; inventory337files, native declaration
23views/40transitions/10untested scenarios and impact12features/43suites/62UI pass.
Diff/format checks pass. The prior5component suites/41tests retain unchanged product
inputs; this harness-only correction does not require another component run.
Private logs: android-training-driver-2026-09-30/post-first-failure. No owned
native/backend/quality session remains live; final host census no-known-job.

Next mechanical packet order: read original failed control/ownership ledgers and
existing owner helpers; diagnose the outer release failure without adopting or
signalling unverified identities. Establish a supported independent raw-value
observation whose semantics distinguish actual input text from hint text; do not
assume another accessibility dump makes that distinction. Then qualify the small
new-session/clear UI controls with fresh owned resources and unchanged SQL before
another full saved journey. Archive exact accepted control scripts against their
intent hashes before adding a new unique diagnostic name. Require its terminal
child, original ledgers and separate full cleanup audit. Only after these gates
execute a fresh complete Android journey; public mapper/binding/verifier remains
subsequent work. Existing failed outcomes must not be overwritten or recounted as
public/comparison successes. No product/auth/localization or FR/UC/BR changes.

### T13-J reusable Android owned lifecycle work card (bounded controls qualified; remaining gates Pending)

Current dispatch after the outcomes below: server process-history retention and
its stronger bridge cleanup verifier are implemented and locally qualified.
Refresh new unique Android timeout/login/restart controls with current helper and
server fingerprints; preserve the successful v6 UI/state observations and its
failed terminal-manifest qualification. Then implement the public Android
create/save/edit/restart/assertion adapter. No owned native attempt is live.

Fresh qualification work order: uniquely named whole-timeout-v4, entry-v4 and
runtime-restart-v7 use the existing reviewed controls with the unchanged UI
recipe and current server process-history/helper fingerprints. Original v6
control bytes/hashes are archived before modifying accepted names. Require
terminal receipts and independent exact-process/resource audits in that order;
both before/after restart API identities must survive in the terminal server
manifest. Current host census no-known-job. Freeze source/helper/doc inputs
until each owned attempt is terminal and cleaned. No new pass is claimed here.

T13 Android public-runtime preparation; retain the full both-platform/engine/
lifecycle denominator. The starting capture-android-testability.ts was a CLI-only
module with top-level signal handlers and immediate main execution. The current
working tree extracts the import-inert session and validates it with focused
controls; real Android runtime qualification is still Pending. Reuse its
owned emulator slot, isolated ADB/keys/ports, disposable backend, proxy, Expo,
private Gradle output, APK/config/installed-byte checks, actual native networking,
normal login, observation helpers and cleanup. Do not duplicate these resources.

Extract an import-inert runOwnedAndroidNativeSession with validated options and
per-call linked cancellation; only the direct CLI entry installs/removes handlers.
Keep exact existing inventory charter commands compatible and reject unknown/
duplicate options before acquisition. Add shared bounded execution deadlines,
strict pre-acquisition validation, explicit Gradle build phase preserving its
existing600000ms upper bound, step limits that only shorten original limits and
whole-run abort with finally cleanup. Preserve original children, private diagnostics,
source/helper/workspace-APK/AVD/foreign-iOS checks and resource release failures.
Only literal signals yield130/143; deadline/error aborts remain blocked2.

Expose a private training callback only for a typed training-journey request,
requiring that callback; inventory CLI cannot select an empty journey. Supply the
existing fresh fixture/proxy/SQL/observed-frame operations and owned app/API restart
without reset of persisted plan state. No callback or inventory observation emits
public assertions or native passing cases. Record actual phase timings and fixture/
resolved-config identity for the future public adapter, not fabricated successes.
Training driver/API-SQL mapper/binding/independent cleanup/public finalization and
real Android journey acceptance remain Pending until their subsequent evidence.

Runtime qualification sequence: new uniquely linked whole-timeout-v1 request with
whole1000ms (expected blocked2, no literal signal or passing views), then fresh
entry-v1 existing inventory entry/login smoke, then runtime-restart-v1 private
callback smoke. The latter snapshots seeded SQL, reads the existing owned plan
with independent normal authentication, force-stops only the owned app, restarts
owned API behind the stable proxy, relaunches to coach home, and verifies unchanged
SQL/plan state. It tests the new runtime context, not training create/edit or seven
canonical assertions. Actual parent signal/public Android qualification remain
Pending. Each has exclusive intent/artifacts/terminal audit; do not edit inputs
until terminal cleanup. Acquisition intents precede emulator/backend/proxy/Expo
dispatch and are bound to the capture; unavailable evidence is never zero resources.

Controls: inert import/listeners/artifact census; invalid/unknown/duplicate/non-
function/wrong-charter/wrong-signal/deadline and already-aborted requests reject
before acquisition; existing selection/cancellation/owner/Android controls, typecheck/
scoped lint/formatting and inventory/declaration/impact. Qualify a fresh existing
Android inventory smoke using its existing wrapper after no-known-job host census;
retain every original failure and externally audit cleanup, borrowed ADB and prior
foreign state. No source/helper/doc edits during native execution. No source UI,
auth, localization, provider or production behavior change; no FR/UC/BR/copy update.
No commit/hosted/retirement action. Previous goal turn was progress (T13-I actual
clean/regression/restored native receipts). Current host no-known-job; no known
native attempt live. Owner: client maintainer; parent T13 and T14–T20 active.

Planning handoff refresh: entry point Section 0 gives the mechanical session
procedure; handoff Section 14 supplies the current Android preparation, three
separate controls, terminal backend-manifest/PID audit and subsequent public
training work order. The session recipe now explicitly keeps server revocation
behind the existing decision gate. This refresh adds no product behavior or
runtime acceptance. Current focused lifecycle/owner/Android/inventory checks:
38passed,0failed,0skipped; native declaration validation,10local document links,
named reuse paths, touched-document formatting and diff checks pass. No actual
Android capture, comparison or hosted run was launched by this planning refresh.
Real T13-J controls remain Pending. Product/FR/UC/BR/screen/copy/localization
unchanged; existing BL-018/D-218 and deferred-wiring tracking remain authoritative.

Actual T13-J controls: whole-timeout-v1 capture a46a20931f9ad54339d7ebfc
returned expected blocked2/whole-capture deadline, zero views and passing cases.
Independent16-PID/6-directory cleanup and supplemental exact acquisition-intent
binding passed; borrowed ADB/workspace APK/foreign AVD/iOS states unchanged.
Entry-v1 capture dddeb0cd94fed858c097124e built successfully (child0) but retained
a strict android-build process-identity cleanup block before install/login.
Original capture cleanup failed-recovery-retained is unchanged. Independent
post-terminal absence audit verifies all74 recorded PID-start pairs and6 owned
directories absent, owned Compose/Expo absent, inputs/foreign states unchanged.
It does not relabel the failed attempt as clean or a native pass.

Next bounded harness correction: keep the existing1000ms natural-exit grace for
ordinary commands; allow5000ms for declared build cleanup before any strict
identity-based signal. A changed/unknown descendant may exit naturally during
that bound but must never be adopted or signalled while unverified. Persistent
identity drift still blocks cleanup. Add real controlled descendant exec/exit
and persistent-drift rejection checks, plus pre-acquisition invalid-phase checks.
Record actual cleanup mode/grace in private ownership ledgers. Retain all v1
receipts and run fresh uniquely named v2 controls after current source/helper/
declaration validation. This is a cleanup observation window, not a widened
build/step execution deadline or a qualified aggregate public-attempt bound.
No product/auth/copy change. Current host no-known-job; prior controls terminal.

The build-specific natural-exit correction is implemented. Controlled natural
descendant exec exits without adoption/signalling; persistent drift retains a
failed ledger until the test child voluntarily exits. Invalid command phase
rejects before private log/process acquisition; default steps remain1000ms.
Focused41/41pass,0skips; typecheck/scoped lint0warnings, components41pass,
inventory337files, impact12features/43suites/62UI specs, formatting/diff pass.
Full unit1788/1789pass,0skip: separate password-reset route mismatch persists.
Fresh whole-timeout-v2, entry-v2 and runtime-restart-v1 are the next runtime
controls at current inputs; none yet qualifies current Android public training.
Historical v1 receipts remain immutable. Private quality logs/manifest controls
and failed-attempt absence audit are retained in the T13-J artifact directory.

Current helper controls: whole-timeout-v2 capture3b4a00ab1475e3e0606fca9a
qualified blocked2/deadline/13-PID/6-directory cleanup; entry-v2 capture
3e4b4304fa7ab761bf74bd4e observed normal sign-in/coach home with build/install,
cleaned178-PID/6-directory teardown and unchanged borrowed/foreign state. Build
cleanup records build mode/5000ms; execution still600000ms maximum. Neither is
a public training pass. Runtime-restart-v1 capture4bc8c6543a23d0892fe3dec9
returned blocked2 before restart: the independent read requires a current token
observed through successful normal native catalog access, while the initial smoke
only signed in. The guard stays unchanged. Separate independent full cleanup
audit verifies362 PID-start pairs absent and6 owned directories plus Compose/Expo
absent; original first result remains retained. All prior attempts terminal.

Next runtime-restart-v2 adds the missing precondition via normal UI: home →
library → existing seeded Upper plan → Add exercise → canonical catalog search,
before the independent plan read; repeat that normal catalog access after owned
app/API restart and current coach-home restoration. No item selection, Save or
fixture-token injection. SQL and independent before/after plan state must stay
unchanged; both API PIDs must appear in the terminal backend manifest. Preserve
the prior control script bytes/hashes before changing this local recipe. Scope
remains callback/restart qualification,0 public assertions/native passing cases.

Runtime-restart-v2 capture51cafa5551f8e30afd3d8140 built/installed/signed in,
then a foreign Detox job PID49127/start Tue Sep29 20:26:18 appeared during
runtime-before-library. The command-boundary census stopped further acquisition
before hierarchy/callback qualification. Foreign iOS state changed; original
capture remains blocked2/failed-recovery-retained. Independent owned-resource
absence audit verifies277 PID-start pairs and6 owned temporary directories absent,
Compose/Expo absent, source/helpers/borrowed ADB stable. It explicitly does not
qualify the failed foreign-state cleanup gate. No foreign process/device was
adopted, signalled or restored. A fresh identity query finds49127 gone and current
host census no-known-job. Runtime-restart-v3 uses the corrected catalog recipe
with a fresh current foreign-device baseline and unique intent; v2 remains immutable.

Runtime-restart-v3 capturea3dc0cc48e414b111e05ba9a reached normal library and
opened the seeded plan. Required Add exercise visibility failed before scrolling;
captured native hierarchy/screenshot shows the Upper card clipped at the320×640
viewport. Original child1/controller2 and blocked capture are retained. Separate
full142-PID/6-directory/Compose/Expo cleanup audit passes with source/helper/borrowed
ADB and foreign states unchanged. This is no application-defect/public-pass claim.
Runtime-restart-v4 keeps both required checks: assert the plan field first, then
scroll to and separately assert the Upper Add exercise control before catalog
access. Preserve v3 control bytes and evidence; do not make either assertion optional.

Runtime-restart-v4 capture3cc892e843d3d7aaee2054dd retained blocked2 after
the mandatory Add-control scroll failed; its plan-field check passed. Independent
full516-PID/6-directory/Compose/Expo cleanup audit passes with unchanged source,
helpers, borrowed ADB and recorded foreign states. The screen/tree shows an
app-owned Upper session card visible and Add clipped below the viewport. A
non-scrolling input at the default gesture center is a diagnosis hypothesis,
not a confirmed application defect. Runtime-restart-v5 preserves exact v4 control
bytes/hashes and adds a mandatory selector-anchored UP swipe from the observed
Upper card before the unchanged scroll/visibility assertions. No coordinates,
optional check, timeout expansion, item selection or save. Fresh host census and
actual pinned-tool execution remain prerequisites; no new native pass is claimed.

Runtime-restart-v5 capturebd7c3e28e32e3a93f4e0f3e2 built successfully but
stopped before UI on android-build cleanup identity drift. Original blocked2/
failed-recovery-retained remains immutable. Independent537-PID/6-directory/
Compose/Expo absence audit passes; it explicitly does not relabel the original
cleanup failure as qualified. No selector swipe executed. Inspection found the
build's natural-exit loop exits on the first successful strict census, so it can
signal while a single-use compiler process is still shutting down and changing
identity. Next bounded correction keeps the same5000ms build grace but observes
until the recorded processes exit or that bound expires, including successful
censuses; ordinary step behavior remains unchanged. Strict identity validation
still precedes any signal, and persistent drift remains a block. Add a controlled
stable build child proving natural exit0 without SIGTERM plus existing drift
controls, then refresh affected declarations/inventory/quality checks and qualify
new unique Android controls at frozen inputs. No product/auth/copy changes.

The successful-census build observation correction is implemented. Focused
42/42 controls pass with0skips; typecheck and scoped lint0warnings pass;
components41pass, full lint0errors/3004existing warnings, fresh337-file inventory,
23-view/40-transition/10-untested native declaration, impact12/43/62, touched
formatting and diff checks pass. Full unit retains the separate password-reset
route failure; no waiver or auth change was introduced. Private quality-v3 logs
and original v5 control bytes are retained. Next fresh controls at these inputs
are whole-timeout-v3, entry-v3 and runtime-restart-v6, with the selector-anchored
swipe still requiring runtime qualification. T13-J remains In progress.

Fresh whole-timeout-v3 capture54de331f94f6678e4b590556 qualified expected
blocked2/deadline with15-PID/6-directory independent cleanup. Entry-v3 capture
65f566b96ef6507421b4d100 qualified normal sign-in/coach home with292-PID/
6-directory independent cleanup. Runtime-restart-v6 capture7d12ce59167cae97bd1b65db
completed all UI/catalog/restart actions with child0, identical SQL and API plan
state, API PIDs91033→52757 and raw cleanupcleaned. Selector-anchored swipe is
actually qualified before/after restart with Maestro2.6.1. Its independent final
qualification failed because terminal server manifest processes contain only the
orchestrator; API stop removes its live record before persist reconstructs that
list. Do not claim full restart cleanup or public training pass from this attempt.

Next bounded packet: server-owned manifest process history. Reuse
scripts/testing/{owned-runtime,document-validation}.ts; retain every validated
PID/start/script/role identity across API restart and final release. The same PID
with changed identity blocks, never overwrites history. Existing live API records
and strict signal guards remain authoritative for stopping resources; history
alone grants no signal permission. No schema/production/auth changes. Consulted
ancestor evidence-delivery/adapter, server docs/testing.md and actual lifecycle/
cleanup code; update that service documentation and this card. Prove history
retention/conflict/malformed negatives, server unit/type checks and fresh real
restart/stop receipt with every API PID in terminal manifest and independent
absence audit. Original v6 outcome remains immutable and unqualified.

Server process-history packet is implemented and locally verified. Manifest
persistence now retains prior acquired identities, rejects conflicting/reused
PID metadata and validates the result without changing schema or signal guards.
Client bridge verifier checks terminal history and a strict PID/start census for
every record, plus exact owned containers/networks/volumes. Client OwnedManifest
type now includes the schema's existing phase field; this is no protocol change.
Server246unit tests and typecheck pass;7document/history controls pass. Client
33focused schema/ownership/binding/command checks, typecheck and scoped lint pass.
Two real bridge verifications at bridge-2026-09-30T00-20-27-159Z and
bridge-2026-09-30T00-21-58-505Z pass concurrent isolated sessions, durable write/
restart read, terminal two-API history and all historical process absence,
SIGINT/SIGTERM, duplicate fixture-scope rejection and owned Compose/private-file
cleanup. The first run exposed a TypeScript-only omitted phase declaration;
it was corrected before the second run and typecheck passes. No native restart
cleanup/public pass is inferred from backend proof. Affected server testing docs,
client testability/decision/wiring and this task card track the change; product
FR/UC/BR/screens/copy/localization are unchanged. Full modernization stays active.

Final current quality-v4: client1789/1790unit checks pass with0skips; the sole
failure is the existing mobile password-reset-confirm/server route mismatch.
Full lint passes with0errors/3004existing warnings; scoped changed-source lint
has0warnings. Typecheck, fresh inventory337files, impact12features/43suites/62UI,
server246unit/type checks and both-repository diff checks pass. Component41pass
at unchanged component inputs remains separate evidence. No native/hosted job
was left owned and live by this packet. Next: fresh uniquely named Android
qualification using the retained control recipe and current process-history fix.

### T13-I clean / application-failed / restored control locally verified

Bounded iOS/Maestro required-quantity failure packet is implemented and locally
verified. Three separate actual public requests preserve original first-attempt
outcomes; no receipt or failure was rewritten:

| Control              | Requested first attempt    | Capture                    | Public / original child      | Canonical assertions              | Native / controller PID-start pairs absent |
| -------------------- | -------------------------- | -------------------------- | ---------------------------- | --------------------------------- | ------------------------------------------ |
| Clean                | `7110e6332a9c7fc599944bac` | `06354d06bef3e7a4a541c3db` | passed0 / child0             | 7passed                           | 590 / 588                                  |
| Rendering regression | `027f594d0f3b747f773f18b2` | `553b61ec23fec11b5e1458ad` | application-failed1 / child1 | 1failed: NAT-training-local-draft | 316 / 476                                  |
| Restored             | `fdb3c8a64a479f69f846c7e5` | `f851f668b2db87e7f6e030b6` | passed0 / child0             | 7passed                           | 649 / 905                                  |

Both clean runs complete all5 required quantity previews, normal create/edit/
same-plan Save, app/API restart and durable reopen, six SQL checkpoints and three
authenticated API reads. Each independently verifies55 copied original evidence
files. The mutation used a fresh changed-source build and unchanged assertion;
actual4x10 failed required3x8 at journey-draft-preview. Explicit pinned Maestro
assertion-false child1, fresh wrong-value hierarchy/PNG, API200, booted device,
stable inputs and full cleanup qualify12 exclusively staged failure files.
The failed callback is1/incomplete, one failed assertion and no full-journey/
persistence-success claim. Diagnostic screenshot review corroborates the wrong
value; runtime frames remain unreviewed and no design/locale baseline is approved.

All three independent terminal audits pass full cleanup: no survivor/unknown query
or changed foreign device, owned simulator/cache/Compose absent, borrowed ADB
preserved, source/helpers stable. Exact original SessionCard bytes and original
app-source hash restored; no product mutation remains. Restored measured ms:
reuse909.33, install7420.70, reset35183.86, scenario631159.01, cleanup7062.26.
Reused clean builds are not cold comparison samples; the intentional application
failure is retained and never counted as a reliability pass. Qualification binds
each original input/selection identity; later doc/declaration revisions do not
rewrite these historical receipts. Private controller/intents/mutation/restoration/
PNG review/terminal audits live under
`.qa/artifacts/testing-modernization/native-application-failure-2026-09-29/`.

Code validation: focused23/23 controls with0skips; typecheck/scoped lint pass with
0scoped warnings; components41pass. Full lint0errors/3004existing warnings;
full unit1783/1784pass,0skip with the separate password-reset route mismatch.
Inventory336files, declaration23views/40transitions/10untested scenarios and
impact12features/43suites/62UI specs validate. Final post-documentation focused
23/23 controls, inventory/declaration/impact/diff and formatting checks pass.
Post-terminal host census has no-known-job; no native attempt remains live. No tests retired; no commit/hosted/provider/production action.
Product/FR/UC/BR/screen/copy/localization unchanged; no deferred product wiring.

T13-I bounded failure qualification is locally verified. Parent T13 remains
In progress: remaining setup/journey/deadline/aggregate-cleanup and Android/public
runtime cells still need proof. T12 remaining platform/state/locale and T14–T20
comparison/exploration/hosted/retirement/audit gates remain Pending; goal active.
Next eligible packet: read retained lifecycle records and implement the missing
owned Android public training adapter or an unmet T13 deadline/cleanup control
using existing capture/command/session helpers, after fresh host inspection.
Keep the full denominator, session-contract decision gate and separate auth gap.

### T13-I actual application failure verified; restored control In progress

Recorded `mutation-v1` request `027f594d0f3b747f773f18b2:first`, capture
`553b61ec23fec11b5e1458ad`, completed a fresh changed-source build, installed/
launched, normal sign-in and draft creation. Its unchanged required
`journey-draft-preview` assertion failed on actual4x10 versus expected3x8.
Pinned command parser, fresh separate hierarchy/screenshot, API200 and booted
device qualified the candidate. Public receipt is application-failed1/original
child1, exactly failed NAT-training-local-draft, callback1/incomplete, no completed
journey/persistence success. Twelve exclusive staged files verified. Diagnostic
PNG visibly corroborates4x10; this review is no visual-baseline/design/locale approval.

Independent terminal audit verifies full cleanup316 native/476 controller
PID-start pairs, no survivors/unknown queries/foreign changes, owned device/cache/
Compose absent, borrowed ADB preserved, source/helpers stable. Timings ms: fresh
build416848.41, install5490.73, reset40409.16, scenario293430.35, cleanup7366.98.
Actual failed receipt/candidate/command/diagnostic bytes remain unchanged under
private original capture/request roots; intent/mutation/terminal audit/review live
in `native-application-failure-2026-09-29/`. No failure is overwritten or counted
as a reliability pass. Qualification is at the recorded input/selection identity.

Exact original SessionCard bytes restored only after current bytes matched the
recorded mutation; exclusive restoration audit verifies original hash. Full app
source identity is again572b19323cda0d79892bba61299e10a1b75b69b394144080dc59eeddcb0391ba.
No temporary product change remains. Fresh post-terminal host census says
no-known-job. Next `restored-v1` reuses qualified original e6d bytes after normal
preflight, with fresh device/backend/fixtures/proxy/Expo, same five exact quantity
assertions and all seven canonical assertions. No input edits while live.
Restored native qualification and remaining T12/T13/T14–T20 stay Pending.
Product/auth/screen/copy/localization contracts are unchanged; no production change.

### T13-I actual clean semantic control verified; product mutation In progress

Actual `clean-v1` request `7110e6332a9c7fc599944bac:first`, capture
`06354d06bef3e7a4a541c3db`, passed0/child0 with all7 canonical assertions and
all5 exact quantity assertions. Complete normal create/edit/same-plan Save,
app/API restart and durable reopen; six SQL checkpoints/three authenticated reads.
Independent terminal audit verifies55 copied original-byte hashes, full cleanup
590 native/588 controller PID-start pairs, no survivors/unknown queries/foreign
changes, owned device/cache/Compose absent and borrowed ADB preserved. Source/
helpers stable. Qualified e6d build bytes reused; no new compilation claimed.
Timings ms: reuse1208.73, install9255.06, reset35907.30, scenario531195.37,
cleanup6667.98. Runtime frames remain unreviewed; no visual/locale/comparison gate.
Full unit is1783/1784pass,0skip; the separate password-reset route mismatch fails.
Other code-validation results in the preceding T13-I entry remain applicable.

Next documented local controlled regression changes only the rendered quantity
in `features/plans/components/SessionCard.tsx`: display4x10 when actual quantity
is3x8, preserving selector, title/session, input and persistence behavior. Read
SC-208/TC-002 quantity/draft contracts; intended production behavior stays unchanged.
Keep an exclusive private original-byte backup, patch and original/mutated hashes.
Do not change assertions. Run a new uniquely requested `mutation-v1` with fresh
build/current changed source and fresh owned resources; stale byte reuse is forbidden.
Expected exact failure is `journey-draft-preview`/NAT-training-local-draft with
actual4x10 versus expected3x8. Only explicit Maestro child1 plus fresh wrong-value
hierarchy/screenshot and all cleanup/identity gates may yield application-failed1.
After terminal cleanup audit, restore only if current bytes equal this recorded
mutation, then verify exact original bytes/source hash and run a separate fresh
`restored-v1` control. No mutation is committed/deployed. Retain any blocked/failing
attempt unchanged. Actual failure/restored qualification remains Pending until
receipts exist. Other T12/T13 and T14–T20 stay Pending; whole goal active.

### T13-I failure boundary implemented; native qualification In progress

Exact required quantity assertions, pinned explicit-failure parser, fresh owned
wrong-value diagnostics, full-cleanup qualification, exclusive evidence staging
and original-child1/application-failed1 public boundary are implemented. Generic
engine errors remain blocked2; signals/deadlines/cleanup retain precedence. Public
native failure schema requires failed assertion, child1, full target/input identity,
owned clean resources and present evidence. Canonical freshness includes all new
helpers/schema/validator. See native testability for the qualification contract.

Focused seven-file controls pass23 tests/zero skips, including source/platform/
fixture/child/cancellation/cleanup, corrupted original/copied bytes and duplicate/
symlink evidence rejection. Typecheck and scoped lint pass, zero scoped warnings.
Inventory336 files; declaration23views/40transitions/10untested scenarios and
impact12features/43suites/62UI specs validate; diff check passes. Components41pass.
Full lint passes with0errors/3004existing warnings. Full unit retains the separate
password-reset client/server route mismatch; no broad green claim. Exact log/counts
live in private `t13-i-code-validation-2026-09-29/` evidence; native evidence is
separate. Harness-only behavior: no FR/UC/BR/screen/copy/localization update needed.

Next actual `clean-v1` semantic control uses qualified e6d immutable bytes with
fresh device/backend/fixtures/proxy/Expo and unchanged assertion expectations.
Private controller and exclusive intent/audit live under
`.qa/artifacts/testing-modernization/native-application-failure-2026-09-29/`.
Refresh host before dispatch. No repository/helper/doc edits during execution.
After terminal independent cleanup and identity audit, a documented temporary
local product regression requires its own changed-source fresh build and separate
failure receipt, followed by exact byte restoration and clean control. Never use
stale reuse or an invented false assertion. Actual native application failure,
other T12/T13 gates and T14–T20 remain Pending; full goal stays active.

### T13-I explicit native application-assertion failure work card (In progress)

Owner/client T13; plan Section16 requires explicit application child failure1,
harness/selection/cleanup2, signal130/143 and original child preservation.
SC-208, TC-002 and canonical training assertions require exact rendered3x8/4x10.
Reuse the current owned Maestro command lifecycle, driver, binding/evidence readers,
independent cleanup and public receipt. Do not classify arbitrary Maestro1 as a
product failure. No product/auth/localization change; no comparison promotion.

Add exact id+text quantity assertions to the five existing draft/save/restart
preview commands, sharing a pure documented label/quantity/assertion-ID contract.
Pinned Maestro2.6.1 command records must identify exactly that non-optional failed
assertion and its explicit assertion-false error; earlier action failures, optional
conditions, absent/malformed/duplicate records and transport/driver errors stay
harness-blocked. Require actual child1/cleaned and a fresh separately owned failure
hierarchy/screenshot: the known quantity control must be unique and have a different
nonempty observed value, with the device still healthy. Record a private exclusive
candidate with exact original byte hashes, not a public result.

After full cleanup, revalidate original candidate/binding/current selection, failed
command/diagnostic, stable source/helpers, healthy bootstrap/device and incomplete
one-shot callback. Only a qualified candidate may be staged exclusively under the
requested private root and rechecked before public `application-failed`/1 with the
one failed canonical assertion and original child1. Signals/deadlines/cleanup or
finalization failures take precedence. Failed UI evidence does not claim API/SQL
values or complete the journey. Preserve every original failure.

Files: existing driver/capture/adapter/public runner and canonical generator; new
pure quantity contract and failure evidence helpers with focused negative controls.
Check malformed/missing/changed/symlink/duplicate/wrong binding/selector/sequence/
child/signal/device/source/cleanup and staged byte controls; typecheck/scoped lint,
inventory/declaration/impact checks. Runtime: fresh clean control of semantic
assertions, then one documented local product regression and restored clean control
on an uncontended owned target; no invented false assertion or provider/deploy action.
The earlier foreign Detox64570/start `Tue Sep 29 18:11:20 2026` has exited;
fresh read-only host census reports `no-known-job`. It was never stopped/adopted.
Refresh again before runtime; preserve foreign jobs and borrowed ADB.
Actual application-failure qualification and all remaining T12/T13/T14–T20 stay
Pending until real receipts exist. This packet adds no deferred product wiring.

### T13-G both journey signal controls (locally verified)

The intended SIGINT and SIGTERM controls both reached normal first Save/reopen,
created SQL and independently authenticated API checkpoints, then signalled only
the verified public runner while its exact owned edit-title Maestro child was
live. Each used qualified immutable build bytes with fresh simulator/backend/
fixture/proxy/Expo. No Xcode compilation or complete training pass is claimed.

| Control | Requested first attempt    | Capture                    | Public / retained command child | Native / controller PID-start pairs absent |
| ------- | -------------------------- | -------------------------- | ------------------------------- | ------------------------------------------ |
| SIGINT  | `e79dde8686ef061f58c3d1bd` | `822c7eeb748c45a27fab91bc` | cancelled130 / child143         | 370 / 660                                  |
| SIGTERM | `f28f13463b418ec117c380f2` | `76fa699567ebb7092387b781` | cancelled143 / child143         | 388 / 849                                  |

Both independent terminal audits pass: exact signal action/child, callback1 but
incomplete, zero assertions/native passes, six prefix byte fingerprints verified,
stable source/helpers, full cleanup passed, no survivor/unknown query, unchanged
foreign devices, owned simulator/cache/Compose absent, borrowed ADB preserved.
SIGINT also records an independent exact live-owner match after launcher exec,
verifying T13-H publication on the native path. The original stale-marker fallback
and competing-job cleanup failures remain unchanged and in reliability history.

Private original receipts/action/prefix/control/terminal audits live under
`.qa/artifacts/testing-modernization/native-journey-signals-2026-09-29/`,
`sigint-v3/` and `sigterm-v4/`. SIGTERM measured ms: reuse/build739.92,
install9293.13, reset36189.29, scenario-to-signal390613.30, cleanup6609.43.
These partial durations are not normal full scenario/comparison samples.
Post-terminal host census reports `no-known-job`. No recorded native attempts
remain live. Eight further ADB-reference/independent-cleanup/worker-boundary
controls pass, zero skips, bringing the focused packet checks to35. Final
inventory/declaration/diff checks pass; prior typecheck/scoped lint remain
applicable because no source changed after those checks. Full unit was not
rerun; the separate password-reset route mismatch is still open. Documentation
reflects this harness-only scope; FR/UC/BR/copy and
localization unchanged. T13 still requires explicit application-failure and
remaining deadline/setup/cleanup/platform proof; T12/T14–T20 and full goal remain
active. Next eligible work: preserve full scope and implement/classify actual
application failure before Android/Detox family equivalence and cold comparison.

### T13-G actual journey SIGINT (locally verified; SIGTERM Pending)

Fresh request `e79dde8686ef061f58c3d1bd:first`, capture
`822c7eeb748c45a27fab91bc`, used qualified immutable e6d bytes with fresh owned
simulator/backend/fixture/proxy/Expo. Normal UI first Save/reopen completed;
baseline/draft/created SQL and authenticated created API checkpoints existed.
The controller verified the live owner's current exact Maestro edit-title
identity and direct public-runner parent, wrote an exclusive signal action,
and delivered intended SIGINT only to that verified public runner.

Terminal public result is cancelled130, retained canceled command child143,
cleanupcleaned, callback1/incomplete, zero assertions/complete native passes.
Exact live command was `journey-edit-title-keyboard`; no Xcode build ran.
Independent full cleanup passed370 native PID/start identities and the separate
660-controller pair audit, with no survivor/unknown query, unchanged foreign
states, owned simulator/cache/Compose absent and borrowed ADB unchanged.
All six controller prefix file hashes match original terminal bytes; source/
helper inputs were stable. Separate independent live-owner observation matched
the published hierarchy child and launcher exec transition while still live.
This verifies T13-H live publication on the real native path. It is no completed
training assertion, visual/locale acceptance, fresh compilation or comparison pass.

Measured ms: reuse/build1306.59, install8186.43, reset40059.76,
scenario-to-signal377383.82, cleanup6651.96. Private actual signal, result and
terminal audits:
`.qa/artifacts/testing-modernization/native-journey-signals-2026-09-29/sigint-v3/`.
Earlier contention/stale-marker/fallback/cleanup failures remain immutable and in
reliability history. Fresh post-terminal host census returned `no-known-job`.
Next execute `sigterm-v4` as a new uniquely linked request after this passed
cleanup, with the same bounded first-Save/edit boundary and fresh resources.
Only literal signal and source link differ; no repository/helper edits while live.
Actual SIGTERM, application-failure/deadline variants, other phases/platforms,
T14–T20 and full goal remain Pending. Harness-only; product/copy unchanged.

### T13-H live ownership publisher (implemented; locally verified)

Existing owner now serializes census mutation/publication and atomically replaces
the private0600 ledger after each completed census. Directly owned launcher exec
history/current exact command become observable while live; unknown descendant/
escaped identity and shared-ADB gates remain unchanged. Failed publication rejects
the query, leaves prior complete bytes and removes temporary files; later cleanup
can independently query again. Canonical native freshness covers owner/dispatcher.

Real gated exec control checks the live ledger against an independent observer,
12 concurrent publish/read controls parse only complete JSON, mode600/no temporary
survivors, and publication denial rejects without corrupting previous bytes. Focused
owner/command/host controls18 pass, plus selection/public-entry/adapter controls9
pass, all zero skips. Typecheck/scoped lint pass with zero warnings. Impact12
features/43suites/62UI specs validates; inventory335 files checked; portable native
declaration23views/40transitions/10untested scenarios validates; diff check passes.
Initial control compared private identity-only bytes to inspection's extra argv/
UID fields and was corrected; no sensitive arguments added to the ledger. Initial
lint's untyped JSON reads were typed and corrected. No full-unit green claim.

Independent immutable terminal audit for retained `sigint-v2` now verifies all882
outer controller PID/start identities absent, borrowed ADB preserved, stable inputs
and the narrower411-native-pair/owned-resource release. Original cancelled143/
failed command-cleanup qualification is not rewritten. Private `v3` observer
declines stale command hashes and awaits an owner's published exact identity,
never adopts the mismatched identity. Fresh host census returned `no-known-job`.
Next bounded `sigint-v3` request links the retained v2 request/capture, uses fresh
fixture/device resources and the original first-Save/edit boundary. No repository/
helper input changes during native execution. Only after terminal verification and
host refresh may SIGTERM journey qualification start. T13-H runtime qualification,
T13-G actual intended signals, application-failure and the full plan remain Pending.
Harness-only; no FR/UC/BR/copy/localization change or hosted action.

### T13-H live ownership ledger publication work card (In progress)

T13-G continuation request `b6097d751d0dddb11293740a:first`, capture
`d53aeaaa3bfab331a859358e`, reached first normal Save/reopen and created SQL/API
checkpoints, then the observer rejected changed command identity before SIGINT.
Exclusive fallback action records verified public SIGTERM. Original receipt is
cancelled143 with zero assertions and failed command-cleanup qualification;
411 native PID/start pairs have no survivors/unknown queries, owned device/cache/
Docker absent, foreign states unchanged. No intended SIGINT proof. Preserve this
failure and independently audit the outer controller before further execution.

Code inspection finds the external observer reads the initial process ownership
file, while the owner's periodic census updates only its in-memory identities.
The directly spawned Maestro launcher can exec Java with the same PID/start/user/
group, but its verified updated command is not published until cleanup. The
observer must not adopt a changed identity from PID alone. This explains the stale
external marker prerequisite; the separate command-cleanup failure's cause remains
unproven and must not be silently relabeled successful.

Owner/client T13; governing plan Section16 exact ownership/cancellation and native
testability's documented direct-launcher exec contract. Change only the existing
owned-process-group publisher: serialize census mutation/publication, publish each
completed verified ownership census as a complete atomic private0600 JSON replacement,
retain the transition history, and remove temporary bytes on publication failure.
Keep descendant/escaped process, UID/PID/start/command, unknown member and shared-ADB
checks unchanged. No guessed process is adopted or signalled. Add a real gated exec
control proving the live file equals the verified current child before cleanup and
can be read by another observer; require concurrent reads never see partial JSON.
Run focused owned-group/command/host controls, typecheck and scoped lint, then
regenerate/check declaration. Full original receipts remain immutable/historical.
Only after terminal audits and a fresh host census may a new bounded journey probe
use the now-published exact owner marker; actual native qualification stays pending.
Harness-only behavior; FR/UC/BR/screen/localization unchanged. No CI/deploy/retirement.

### T13-G fresh journey signal continuation (In progress)

After the retained attempt below, exact Detox PID1289 was absent and a fresh
native census returned `no-known-job`. Launch a new `sigint-v2` controller
directory/request, with an exclusive predecessor link to
`aac6bacfad36dcaf95e65f70:first` and capture `e9715f95cbce68bd9e8a1969`.
The changed prerequisite is verified host availability, not a relaxed assertion,
timeout, ownership or cleanup contract. Reuse the T13-G work card's fresh
resources/live edit-child boundary; retain any new result independently. Only
after its terminal audit and fresh host check may a new SIGTERM control start.
No product/helper/source change is required for this continuation.

### T13-G retained competing-job attempt (journey controls Pending)

Fresh public request `aac6bacfad36dcaf95e65f70:first`, capture
`e9715f95cbce68bd9e8a1969`, reused the qualified T13-F bytes and installed/
launched on a fresh owned simulator. Maestro entry-readiness and entry-hierarchy
both completed0/cleaned. A live competing Detox job appeared before the normal
training callback, so the next native command was rejected. Callback invocations0,
completefalse, no first-Save checkpoint, no signal sent, zero assertions/passes.
The private observer terminated2 because its journey prerequisite was never met.
This attempt is not the intended SIGINT proof; do not overwrite or count it as one.

Public outcome is `harness-blocked`/2 with retained
`failed-recovery-ledger-retained` cleanup. Independent cleanup correctly remains
failed because foreign simulator `36CE87B2-3068-4855-AC8A-3FBF69EB5F55` changed
state during the attempt. Our owned simulator/cache/Compose resources are absent,
50 native PID/start identities have no survivor/unknown query, and all233 outer
controller PID/start identities are absent. Borrowed ADB PID54370/start
`Tue Sep 29 13:20:47 2026` remains unchanged. Source/helper inputs were stable.
Retain both the cleanup failure and narrower owned-release proof; unavailable
foreign-state qualification is never converted into a clean result.

Private terminal audit and original records:
`.qa/artifacts/testing-modernization/native-journey-signals-2026-09-29/sigint/`.
Its first immutable audit omitted the numeric native count because the verifier
field is a count, not an array; the separate exclusive count supplement records
50 from the original cleanup bytes. Neither original audit nor receipt is edited.
Post-terminal host inspection found Detox PID1289/start
`Tue Sep 29 17:27:40 2026`. Do not stop/adopt it or launch another native probe
while contention remains. Next eligible runtime step: refresh host state and use
a new uniquely linked request/controller directory once available; keep the same
strict live journey-child prerequisite and cleanup contract. SIGTERM journey
control has not been launched. Other T13 and whole-goal gates remain active.
No product/domain/copy change; no FR/UC/BR/localization update required.

### T13-G training journey cancellation work card (In progress)

Owner: client public iOS/Maestro `SCN-training-ios` integration lifecycle.
Prerequisites: T13-D actual normal training receipt and T13-F qualified immutable
binary reuse; refresh host contention before each attempt. Governing contracts:
plan Section16 timeout/cancellation/resource ownership, SC-208 and TC-002 saved
training behavior. Reuse the public shell entry, shared owned capture, normal
training driver and independent cleanup verifier; no product/auth/copy change.

Create two fresh disposable attempts, one SIGINT and one SIGTERM, using qualified
capture `e6d9b6a3e17c4ce86c04b0f1` bytes with fresh simulator/backend/fixtures/
proxy/Expo. The agent observes only private logs/ownership/checkpoint records.
Signal the verified public Node runner only while its directly parented owned
`journey-edit-title-keyboard` Maestro child is live, after normal first Save,
UI reopen, created SQL snapshot and independent authenticated API read. Validate
canonical private ownership file, PID/start/command/UID, exact flow path/device,
public actor census identity and direct parent again before dispatch. Write the
exclusive private signal action first. Do not signal foreign or guessed groups.

Prerequisite observation is bounded900000ms (normal full scenario previously
555095ms); public execution defaults remain unchanged. Abort an unsuccessful
controller prerequisite through the verified public actor, preserving original
classification and full cleanup; a recovered attempt is not the intended signal
proof. Wait at most60000ms for terminal cleanup after dispatch. Public expectation:
cancelled130/143, retained child result, zero complete assertions/passes, incomplete
journey callback, stable source/helpers, exact canceled command and full independent
device/DB/cache/process cleanup. Prefix SQL/API facts cannot complete the journey.
Also independently audit controller PID/start pairs and preserve borrowed ADB.

Exact execution: private bounded controller launches
`bash scripts/testing/run-native-pilot.sh --platform=ios --engine=maestro
--scenario=SCN-training-ios --mode=integration` under the existing host lock,
with `MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID` set to the qualified capture. Private
controller/artifacts live under
`.qa/artifacts/testing-modernization/native-journey-signals-2026-09-29/`.
No recorded repository or helper inputs change while a native attempt runs.
Record exact results here after terminal audits; remaining T12/T13/T14–T20,
application-failure classification, platform/engine parity and comparison stay
pending. Documentation-only packet preparation; FR/UC/BR/localized copy unchanged.

### T13-F qualified byte reuse and installed-app deadline (locally verified)

Optional `MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID` is implemented for the
supported integrated iOS/Maestro training case. Exact24-hex ID, private owned
records, reviewed entry, current app source, immutable binary/config and healthy
bootstrap are validated before acquisition and again in shared capture.
Bad/missing/unqualified/stale/altered evidence blocks2 with
`invalid-build-reuse`; no compile fallback or native acquisition. The shared
lifecycle reserves recorded endpoints anew and acquires a fresh simulator,
backend, fixtures, proxy and Expo. Actual `build.reusedFrom` records byte
origin; reused bytes are never described as fresh compilation. Supplied entry
fingerprints are checked for complete observed captures as well as partial auth
captures. Canonical iOS helper freshness includes the reuse validator.

Retained capture `e6d9b6a3e17c4ce86c04b0f1` now has a separate exclusive
`entry-qualification.private.json` after actual agent screenshot review and
matching hierarchy/source/binary/config/bootstrap/cleanup checks. The actual
sign-in controls are unobscured, with no keyboard or dependency-error overlay.
App source identity remains `572b19323cda0d79892bba61299e10a1b75b69b394144080dc59eeddcb0391ba`.
This is entry-only review, no design acceptance or new native passing case.
The original nine runtime frames remain `reviewed: false`; original public
receipt and earlier qualifications/failures are immutable.

Fresh public request `03c1ee0bc55ff46fc6eb7e91:first`, capture
`8a853bf05d5a1756eee5c551`, used that qualified binary with
`MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS=1000`. Actual install/launch completed
before owned Maestro `entry-readiness` timed out at its recorded1000ms limit.
No Xcode build command ran. The public receipt is blocked2 with
`native-command-deadline`, child exit143 retained, zero assertions; no ready
screen or training journey proof is claimed. Actual target/config/binary match
the qualified bytes, with new simulator/fixture/backend resources. Source/helper
inputs were stable. Independent full cleanup passed8 native identities plus a
separate47-controller identity audit, no survivors/unknown queries, unchanged
foreign states, absent owned simulator/cache/Compose and preserved borrowed ADB.
Private controls/audit:
`.qa/artifacts/testing-modernization/native-reuse-probes-2026-09-29/installed-step-timeout/`.

Measured ms: reuse qualification/build1229.26, install11766.87,
reset33767.89, scenario2594.63, cleanup7665.54. These are not fresh compilation
or a normal training duration. Thirteen focused reuse/preflight/selection/
adapter controls pass, zero skips; typecheck/scoped lint zero warnings,
impact12/43/62 pass. Malformed/unqualified reuse blocks before acquisition,
changed full-entry bytes reject, occupied fixed ports are never adopted.
No product/auth/localization change; FR/UC/BR/screen copy need no update.
Full unit was not rerun; separate password-reset route failure remains open.

Next: actual post-entry journey cancellation and explicit application-failure
evidence/receipts, then Android/Detox families and remaining T12/T13/T14–T20
gates. A reused-byte deadline control is zero new native journey passes.
Goal remains active; later docs/helpers do not refresh recorded executions.

### T13-F original work card (historical)

Expose optional `MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID` only for the supported
integrated iOS/Maestro training case. Require exact24-hex ID and the existing
private reviewed-entry/source/binary/config/bootstrap reuse validator before
acquisition. Failure is fixed redacted `invalid-build-reuse`/blocked2, no
resources acquired. Pass the ID to the existing shared capture; revalidate
there, reserve recorded endpoints anew and create new simulator/backend/
fixtures/proxy/Expo. Never fall back to compilation or adopt old resources
after failed reuse. Record `build.reusedFrom`; do not call it a fresh compile.

First inspect actual entry screenshot/tree and independently verified cleanup
of completed capture `e6d9b6a3e17c4ce86c04b0f1`. App source identity still
matches. Write a separate exclusive private entry qualification after actual
review and byte/source/config/cleanup checks; leave original runtime frames
unreviewed and original receipt immutable. Supplied entry fingerprints must
be verified on full observed captures too, not only partial auth observations.
Validate stale/unqualified/malformed/altered proof and occupied ports. Then
run a fresh public1000ms command-step timeout using qualified bytes, require
actual installed dev app/config, exact timed-out Maestro step, retained child
result and full independent cleanup. This is zero journey passes and no full
locale/design/device/provider acceptance. Other T13/T14–T20 gates stay pending.

### T13-E execution bounds and post-backend controls (locally verified)

The public integrated iOS/Maestro training path now accepts strict decimal
build1000–900000, command-step1000–600000 and whole-run1000–2400000
millisecond overrides. Defaults remain900000/600000/2400000; existing shorter
command bounds stay shorter. Resolved numbers are privately bound to the
requested attempt; each command records its actual limit. The whole timer
covers public preflight, execution and verification, aborts the existing owned
lifecycle and prevents success. Finally cleanup can finish after the work
deadline and remains separately bounded/verified; no active-work budget is
extended. Literal SIGINT/SIGTERM remain cancelled130/143; other abort reasons
are blocked2. Cleanup failure prevents success and takes classification
precedence. Canonical iOS freshness now includes the deadline helper.

Actual fresh public controls at their recorded inputs:

| Control       | Requested first attempt    | Capture                    | Public outcome                        | Native / controller PID-start pairs absent |
| ------------- | -------------------------- | -------------------------- | ------------------------------------- | ------------------------------------------ |
| Build1000ms   | `0704b125ba7aa97449b3ed58` | `611f2b543176d63e922f853c` | blocked2; `native-command-deadline`   | 8 / 46                                     |
| Whole55000ms  | `c326a93078f6ec679e19b64f` | `b6d10c10ee69deeaa42b63c8` | blocked2; `native-whole-run-deadline` | 8 / 115                                    |
| Build SIGINT  | `f0accde7442091eb4804ef5b` | `015f6e928d6cda957855e841` | cancelled130                          | 8 / 52                                     |
| Build SIGTERM | `e88881fb8a731f7f1a1a4e0c` | `1f7092ff863c3d6dc5b1e235` | cancelled143                          | 8 / 63                                     |

All four acquired fresh simulator/backend/proxy/Expo and reached an owned
Xcode build. No app installation, journey assertion or native pass is claimed.
Original build child signal/exit is retained (timeout/termination is not an
invented numeric application failure). Sources/helpers stayed stable. Full
independent cleanup passed absent owned simulator/cache/Compose resources,
unchanged foreign devices and zero survivors/unknown queries. Supplemental
terminal audits independently checked controller identities and preserved
borrowed ADB. Private control roots:
`.qa/artifacts/testing-modernization/native-post-backend-probes-2026-09-29/{build-timeout,whole-timeout,sigint-v3,sigterm-v3}/`.

Keep the earlier failed SIGINT controller request
`bdeaf4ef9b1804030c9c5f70:first`, capture
`ae6bbde516a5f4a48450848d`. The outer launcher census cannot establish
ownership of a separately spawned Xcode group, so its observer missed the
build and reached its prerequisite deadline. Graceful exact-owner SIGTERM
recovery produced a cancelled143 receipt with full cleanup; it is not intended
SIGINT success. The supplemental audit verifies15 native/221 controller
identities absent. A later independent intervention found the runner already
terminal and sent no signal. The corrected controller reads the capture's
canonical private build ledger, verifies its recorded PID/start/command,
derived-data path and direct public-runner parent, then signals only the
recorded runner. It does not adopt an unknown group or erase that failure.

26 focused deadline/selection/adapter/owned-command/cleanup controls pass,
zero skips; typecheck and scoped lint pass with zero warnings. Initial Node/
React Native timer typing failure was corrected using an abortable Node promise
timer with `ref: false`; no suppression or unchecked cast. Impact12/43/62,
inventory335 files (273 client/62 server), native declaration and diff checks
pass. No FR/UC/BR/screen/localization update is needed because only the testing
harness changed. Full unit was not rerun; its separate password-reset route
failure remains open. Later doc/helper edits do not refresh historical passes.

Next: qualified immutable build reuse and actual post-installation command/
journey failure/timeout/cancellation, explicit application-failure receipts
and remaining setup/cleanup bounds. Keep Android/Detox, full T12/T13/T14,
reliability, exploration and hosted gates pending; goal remains active.

### T13-E original work card (historical)

Extend existing `native-runtime-preflight.ts`, capture options/owned command
dispatch, iOS adapter, public runner and their focused tests. Optional exact
decimal variables: `MYCHAMPIONS_NATIVE_BUILD_DEADLINE_MS`1000–900000,
`MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS`1000–600000,
`MYCHAMPIONS_NATIVE_WHOLE_DEADLINE_MS`1000–2400000.
Unset keeps900000/600000/2400000. Restrict overrides to the supported integrated
iOS/Maestro training selection and reject malformed/over-cap values before
acquisition. Step overrides can only shorten an existing command deadline.
Record resolved bounds and the exact timed-out command; keep original child
exit separate. A whole-run deadline aborts the existing owned lifecycle and
prevents final success. Only actual SIGINT/SIGTERM are cancellation130/143;
deadline/error aborts stay blocked2. Cleanup failure remains authoritative.

Verify focused boundaries and actual fresh public post-backend build/whole
timeouts, followed by SIGINT/SIGTERM during an acquired build. Inspect retained
backend fixture/manifest, exact process/device identity and external full-session
cleanup, preserving every failed probe and foreign ADB/device/job. No build-reuse
waiver, source regression or product/auth/localization change. T13-E does not
close other platform, setup/teardown step configuration, application-failure
classification, T14–T20 or overall T13.

### T13-D first terminal public iOS training pass (bounded acceptance)

Public request `fbf9a540e198d8a16393ca95:first`, capture
`e6d9b6a3e17c4ce86c04b0f1`, backend fixture
`41201c09fb8dcd99530a56fe:first` is terminal exit0/passed.
Command: `MYCHAMPIONS_NATIVE_STATE_ROOT=/Users/eduwaldo/.local/state/github-actions/mychampions-native-recovery yarn test:e2e:native:pilot --platform=ios --engine=maestro --scenario=SCN-training-ios --mode=integration`.
The normal sign-in/create/save/edit/save/restart/reopen journey completed:
51 child commands exited0 and cleaned; six SQL and three authenticated API
checkpoints agree with all seven canonical assertions. Source/helper inputs
were stable. Nine runtime frames carry `reviewed: false`; no visual acceptance
or complete locale matrix is claimed (public receipt locale is null).

Independent cleanup passed 607 PID/start identities with no survivors or
unknown queries, unchanged foreign devices and absent owned simulator/cache/
Compose resources. Borrowed ADB remains foreign and preserved. Terminal
read-only audit validated the public completion contract and all55 staged
files against both copied and original hashes. Immutable receipt and separate
audit: `.qa/artifacts/native-pilot-attempts/fbf9a540e198d8a16393ca95/{receipt.json,terminal-evidence-audit.private.json}`.
Recorded client/server dirty hashes identify the executed inputs; later edits
do not make this a fresh pass. Earlier failed/cancelled attempts remain retained.

Measured milliseconds: build370491.48, install4882.92, reset37400.91,
scenario555095.19, verify428.99, cleanup6750.67. Tools: Node v24.15.0,
Maestro2.6.1. This closes the first actual T13-D positive-path qualification,
not T13/T14 or adoption. Partial cancellation/failure, application-failure
classification, Android/Detox parity, reliability, exploration and hosted
gates remain Pending. Full unit retains the separate password-reset route
failure; no product/auth/localization behavior changed.

### T13-D actual before-backend SIGINT/SIGTERM qualification

Fresh SIGINT request `10f7487957625668f1f5d19a:first`, capture
`4f66388a50d4e4014ead431e`, returned130/cancelled.
Fresh SIGTERM request `477d51a377c52b14b3529726:first`, capture
`eae19ce3dd7440c33c27a74e`, returned143/cancelled.
Both signals were delivered to an acquired Node runner after its exact
PID/start/user/command identity was rechecked while its owned simulator
bootstatus child was live. Both immutable public receipts contain zero
assertions and cleaned resources. Capture inputs remained stable; exclusive
intents prove only ADB/simulator acquisition, no backend or engine journey.
Independent before-backend cleanup passed owned-device absence, actual port
absence, unchanged foreign states and preserved borrowed ADB. Bootstrap
diagnostics record aborted bootstatus, with unknown native exit/signal null.
This qualifies early cancellation only; post-backend cancellation remains pending.

Private controllers/results/ownership ledgers:
`.qa/artifacts/testing-modernization/native-signal-probes-2026-09-29/{sigint-v2,sigterm-v2}/`.
Initial controller attempt request `b37c250098cfab3613ec1d48:first`,
capture `5059b7c5eaa2671818f6dc5e`, failed before intended SIGINT:
the selector matched both bash wrapper and Node. Its controller stop ended the
process tree before receipt finalization, leaving an owned simulator. Preserve
this failed attempt and absent public receipt; do not count it as cancellation
success. Exact private ownership and current identity were verified before
shutdown/deletion; supplemental `probe-controller-recovery.private.json`
proves owned-device absence, prior foreign states, unchanged borrowed ADB and
12 recorded controller process identities absent. No original receipt was
fabricated or overwritten. Revised controller selects only the acquired Node
executable and awaits graceful completion before group cleanup.

### T13-D configurable bootstrap timeout (locally verified)

Optional `MYCHAMPIONS_NATIVE_BOOTSTATUS_DEADLINE_MS` now accepts an exact
decimal integer1000–180000 for the integrated iOS/Maestro training adapter.
Unset retains180000; empty, malformed, fractional and over-cap values reject
before acquisition. The existing owned simulator executes the configured
abortable bound. Diagnostics distinguish deadline from cancellation, early/
external signal and bootstrap failure. Public timeout classification is
`runtime-bootstrap-deadline`/blocked2; cleanup failure still takes precedence.
Known simulator identity is retained in failed-acquisition public target and
owned-resource fields. Unknown child exit stays null; no application failure
or passing assertion is fabricated.

Actual first1000ms timeout request `0e6f29e8365586bd79dc55d1:first`,
capture `665d53b2a72f00213f4d7fcb`, was blocked2 with passing independent
partial cleanup. Its public device fields were null despite the private known
owner; preserve that receipt. After metadata correction, fresh request
`106a8c3667dff61c96a359b7:first`, capture
`2321c0c02395e7d790a9b7d5`, again timed out at actual bootstatus and
returned blocked2 with the exact owned device ID retained, zero assertions and
passing partial cleanup. Both attempts have stable source/helper inputs.
Separate terminal controller audits prove19/15/13/16 PID/start identities
absent for the two signal/two timeout controls; zero survivors and no escaped
controller signals. These are lifecycle-control passes, zero native journey
passes. Private roots:
`.qa/artifacts/testing-modernization/native-signal-probes-2026-09-29/{bootstrap-timeout,bootstrap-timeout-v2}/`.

19 focused controls pass/zero skips; typecheck, scoped lint with zero warnings,
impact12/43/62 and diff checks pass. No product/auth/localization change, so
FR/UC/BR/screen copy need no update. Full unit was not rerun for this packet;
the prior separate password-reset route failure remains open. The positive
journey receipt and early signal receipts describe their recorded inputs,
not freshness after subsequent helper/doc edits.

Next eligible bounded unit: post-backend owned failure/deadline/signal controls,
explicit proven application-failure classification and configurable whole-run/
remaining-step bounds. Build reuse requires its separate reviewed entry
qualification; do not bypass it to accelerate probes. T12 state/locale coverage,
Android/Detox parity, T14 families/regression controls, T15 reliability,
exploration, hosted gates and full T13 remain pending. Goal stays active.

### T13-D original signal work card (historical)

Use the public shell entry and shared host lock with fresh owned resources.
A private controller reuses `startOwnedNativeCommand` and its acquired process
census. After exact simulator ownership and a live owned bootstatus child are
observed, signal only the recorded runner PID after rechecking PID/start/user/
command identity. Retain the original requested receipt, capture, controller
ledger and diagnostic. SIGINT must return130; SIGTERM143; both cancelled,
zero passing assertions, independent partial cleanup passed. No later
backend/proxy/Expo/build acquisition is permitted for this early probe.
Foreign ADB/devices/jobs must remain unchanged. On any failed prerequisite
preserve the attempt and diagnose; do not label preflight as runtime proof.
These probes cannot close both-platform or post-backend cancellation gates.

### T13-D partial-acquisition cleanup and bootstrap diagnostics (In progress)

The capture now writes exclusive ordered acquisition-intent records before
ADB, simulator, backend, proxy and Expo dispatch, and records reserved ports.
The independent helper accepts a separate before-backend scope only for the
exact ADB/simulator prefix, no engine commands, absent later intent/Expo/build
evidence, stable captured source/helper inputs and matching simulator owner/
cleanup records. It checks a live PID/start census, foreign simulator states,
owned-device absence, actual reserved-port listeners and preserved borrowed
ADB (or released directly owned ADB with matching ownership). Unacquired
backend/Expo resources are explicitly out of that partial scope; they are not
fabricated as empty Docker/cache proof. Full-session manifest/process/cache/
Docker gates remain unchanged. Earlier captures without dispatch records stay
unavailable; the original d0567/8e08 failed receipt remains immutable.

Simulator acquisition now retains private bounded bootstrap phase, deadline,
elapsed time, actual error/exit/signal/kill/stdout/stderr and owned device state
before cleanup. Missing diagnostics cannot authorize a retry as a pass.
Cleanup still runs if diagnostic writing fails. A successful bootstatus also
requires actual Booted/available state before backend acquisition. The
180-second bootstatus deadline is unchanged.

15 focused native selection/ownership/cleanup/adapter controls pass, zero skips;
typecheck and scoped lint pass with zero warnings. Full unit run is1776/1777
passed, zero skips, preserving the same password-reset confirm route failure;
full lint exits0 with baseline warnings. Impact12/43/62, formatting, inventory
validation and diff checks pass. Private logs are in
`.qa/artifacts/testing-modernization/partial-ios-acquisition-2026-09-29/`.
Read-only host checks show
97.8GiB free and the declared iOS26.5 runtime available; they do not prove
bootstrap health. Fresh actual partial failure/cancellation and complete
public success remain Pending. No product/auth/localization behavior changed.

### T13-D fresh public qualification: simulator bootstrap blocked

Actual public request `d0567db744494046cbd39259:first`, capture
`8e08d5cf2bd1f02eb274914c`, is terminal exit2. The owned simulator
`1D03961C-1DA0-4625-8B70-29DA48B98C16` did not complete
`simctl bootstatus -b` within the unchanged180-second acquisition deadline.
Reset/setup measured187888ms; zero command executions, no backend, build,
UI journey or assertion mapper ran. Captured source/helper inputs stayed
unchanged. Capture teardown reported cleaned and an independent live device
query after termination found the owned device absent. This narrower device
observation does not establish the full cleanup contract.

The independent cleanup helper wrote its original failed receipt with
`censusStatus: unavailable`: it requires the complete backend manifest even
when failure occurs before backend acquisition. The public immutable receipt
therefore remains `runtime-cleanup-failed`, recovery ledger retained, zero
passing assertions/cases. Preserve both original records. No fresh success
for the staged finalization path is claimed.

Next bounded packet: record explicit acquisition phases/intents and private
bootstrap error details in existing ownership helpers, then extend independent
cleanup for a proven early partial session without weakening full-session
checks. Verify normal/failed/cancelled partial paths and exact owned/foreign
identities. Diagnose the bootstrap failure with changed instrumentation;
do not repeat the unchanged attempt or extend its deadline blindly. Overall
T13 and T14–T20 remain Pending. Goal stays active; the separate session decision
and password-reset route failure remain unchanged.

### T13-D public evidence staging and candidate finalization (In progress)

The public iOS training path now stages runtime mapper proof into the requested
attempt's private directory and validates the candidate with
`assertNativePilotCompletion`. Staging requires the exact completed adapter,
requested/capture/backend identity, all seven bindings, private capture and
passing independent cleanup. Every referenced byte is copied exclusively,
then rechecked against a copy-time manifest hash immediately before completion.
Changed/absent proof, incomplete ledger, wrong identity and failed execution/
cleanup cannot pass. Staging itself emits no public receipt or native pass.

Capture now measures reset/setup, build plus binary qualification, install/
locale/launch, scenario/readiness/actions, final input verification and teardown
with monotonic timers. The adapter adds independent cleanup and runtime mapper
durations; the public runner adds final selection/source/staging verification.
The actual fixture bytes are fingerprinted without publishing their body;
resolved native config and pinned Maestro version are recorded. Source hashes
are compared before/after execution and again after staging. An unavailable
runtime outcome retains a private recovery reference rather than claiming
no acquisition. Finalization failure remains blocked with cleanup preserved.

Validation before fresh runtime: 26 focused native controls pass, zero skips;
full unit run is 1773/1774 passed, zero skips, with only the preserved direct
mobile/server password-reset confirm route failure. All five component suites/
41 tests pass. Typecheck, scoped lint (zero warnings), full lint (exit0,
baseline warnings), impact12/43/62, formatter, native inventory and diff checks
pass. Inventory now contains335 files (273 client,62 server). Private logs:
`.qa/artifacts/testing-modernization/public-finalization-2026-09-29/`.
Fresh actual runtime qualification remains Pending. This implementation does not close application-failure
classification, actual failure/timeout/SIGINT/SIGTERM probes, Android/Detox
parity, reliability, exploration or hosted gates. No auth/product/localization
behavior changed; the existing password-reset route failure remains separate.

### Implementation-plan dispatch refresh (planning only)

The entry-point guide now supplies four concrete remaining work orders, exact
reuse paths, command order, pass/fail semantics and per-packet exit criteria.
Stale preflight-only/current-resume instructions were reconciled with the
inspected iOS runtime adapter and unfinished T13-D staging/finalization.
The handoff points to that dispatch order; this card remains the sole progress
registry. No runtime suite, native acquisition or hosted job was executed by
this refresh, no acceptance status advanced, and no source/product behavior
changed. No FR/UC/BR/screen/localization update is needed for this planning-only
clarification. Existing failures, decisions and private evidence are preserved.

### T13-D runtime frame and assertion finalization work card (In progress)

The runtime frame producer and mapper path are now implemented. Six focused
frame/view/mapper controls pass, including absent checkpoint rejection,
unchanged exclusive output, altered hash rejection and preservation of the
inventory visual-review requirement. A supplemental artifact check against
historical completed capture `c181b63f793677014c7355c1` verified nine
runtime frames (`reviewed: false`) and its six SQL/three API contracts; this
is historical artifact validation, zero fresh public passes. The owned iOS
adapter now creates these fingerprints and runs the runtime mapper only after
complete callback, exit0 and passing independent cleanup. Verification failure
remains blocked with cleanup preserved. Public evidence staging/receipt
finalization, fresh actual runtime qualification and broader T13–T20 gates
remain Pending. Native-view verifier source now participates in captured
helper and canonical training freshness.

Broader validation: full client unit run is 1772/1773 passed, zero skips.
The sole failure is the previously tracked root-server password-reset confirm
route gap: the current sibling server HEAD
`c7b5191352109f9ce2829b2b8fafcc8f554cf8a7` does not register the client-used
`POST /auth/password-reset/confirm`. Preserve the failure; do not relax the
route contract or modify auth behavior within this testing packet. All 41
rendered component tests, typecheck and scoped lint pass. This is not a full
green quality gate or current native runtime proof.

Separate per-attempt deterministic screenshot/tree fingerprints from T12
visually reviewed inventory evidence. Runtime frames carry `reviewed: false`
and must match actual captured paths, hashes, selectors, expected title/item
quantity and all nine saved-training checkpoints. Inventory observations
continue requiring explicit visual review. Public finalization must then
verify the complete shared UI/API/SQL ledger, current selection/source/build,
requested/capture/fixture identity and independent cleanup; it cannot pass
from frame fingerprints alone. Preserve every previous blocked receipt.

### T13-C actual public execution and cleanup classification correction

Public request `fa644f3349e66ca475b9de5b:first` is terminal with immutable
blocked receipt and capture `88d80dcfe884e72d7ac3b34c`. The owned Debug build,
normal training create/save/edit, backend restart and durable reopen action
ran; 50 child commands completed/cleaned. Before the final durable hierarchy
child was acquired, the host guard found a competing Gradle build (PID84379,
start Tue Sep29 14:56:43 2026). The complete scenario did not finish. Capture
inputs were stable and capture teardown was `cleaned`; the resource census
found zero survivors among 956 PID/start pairs, preserved foreign devices and
found no owned simulator/cache/Compose resources.

The original public receipt incorrectly classified that interruption as
`runtime-cleanup-failed`: the new verifier had coupled execution success to
cleanup success. It remains immutable. A separate read-only
`cleanup-semantics-audit.private.json` records the correction. The verifier
now evaluates teardown and resource absence independently from the journey
result. An interrupted journey with clean resources remains execution-blocked;
a failed teardown remains cleanup-failed even after foreign state recovers.
The adapter also preserves engine child status separately from its controller
exit: a guard that stops before the next child reports `childExitCode: null`,
while actual child failure or completed scenario status is retained. Runtime
cancellation diagnostics now identify acquired execution accurately.

The public no-lock control `8e74a21c3c9bce9c19f5b52f` is terminal blocked
with `native-host-lock-required`, no acquired resources and zero assertions.
Fresh public completion, assertion finalization, cancellation/failure probes,
Android/Detox equivalence and T13–T20 gates remain Pending. No public pass.

Validation after the correction: 19 focused native argument/receipt/binding,
adapter/cleanup and shared host-lock tests pass, zero skips; typecheck, scoped
lint, shell syntax, diff check and impact 12/43/62 pass. The inventory contains
334 tests (272 client, 62 server). No corrected fresh public execution is
claimed by these local controls.

### T13-C public iOS training execution adapter (In progress)

The public `test:e2e:native:pilot` alias now enters the shared native host
lock when `MYCHAMPIONS_NATIVE_STATE_ROOT` is configured. The existing public
runner keeps strict argument/inventory/environment/host preflight and may call
only the exact integrated `SCN-training-ios` + Maestro adapter. That adapter
reuses the owned iOS device/build/Expo/proxy/backend lifecycle, binds the
requested ID to the capture and fixture before action, executes the complete
training controller once, and invokes the checked-in external cleanup verifier
after teardown. Other selections remain blocked pending their adapters.

The public receipt is deliberately `harness-blocked` with zero passing
assertions even after a clean runtime: nine frames still require qualified
review and the runtime mapper/finalization gate is not wired into this public
command. The receipt distinguishes no acquisition, actual execution failure,
independent cleanup failure and review pending; it preserves the capture ID in
a private link. Direct invocation without the shared host lock cannot acquire
native resources. Focused cancellation/stale/wrong-platform rejection tests
pass; a fresh actual public execution and its terminal receipt are still
Pending. This adapter is not T13/T14 completion.

### T13-C checked-in independent iOS cleanup verifier (In progress)

`verify-owned-ios-cleanup.ts` now performs a read-only external census after
owned-session teardown: exact PID/start identities from command, Expo and
backend ownership records; simulator states recorded before acquisition;
owned simulator/cache absence; and Compose container/network/volume absence.
It writes one exclusive private result for a new capture and refuses to turn a
failed teardown into a pass after external state later recovers. The pure
comparison test covers PID reuse, a real survivor, foreign simulator changes,
retained owned resources and an incomplete teardown. Read-only replay against
historical capture `c181b63f793677014c7355c1` evaluated `passed` with 691
identities; replay against blocked `db7be50d44f76241ee3ca0e4` evaluated
`failed` with 266 identities even after its foreign device returned. The
original private receipts were not overwritten. This verifier is part of iOS
training source freshness and capture helper fingerprints. A fresh owned
execution using this checked-in verifier, public receipt finalization and
failure/cancellation probes remain Pending; zero public passing cases.

### T13-B full private iOS training execution (2026-09-29T17:11Z)

Fresh requested attempt `5ba428f0cedc1189bc6e2def:first` binds actual capture
`c181b63f793677014c7355c1` to owned fixture
`526995ebabde134dc248091b:first` and the current canonical iOS/Maestro
training selection. One callback completed create/save/edit/relaunch through
the normal native UI, six scoped SQL checkpoints and three authenticated API
reads. Capture exited 0 with 50 completed/cleaned child commands, stable
source/helpers and `cleaned` internal cleanup. Nine required frames were
visually reviewed and hashed; the runtime verifier prepared seven private
assertion bindings in 16 private files. Independent cleanup passed 691
PID/start checks, zero survivors/unknowns, owned simulator/cache/Compose
absence and foreign-device preservation. Borrowed ADB was preserved.

This is a **private actual iOS training packet with zero public passing
cases**, not a public T13 runner result or T14 engine/platform equivalence.
The earlier contended attempt and failed foreign-device cleanup remain failed
and immutable. The public runner still stops at preflight; public finalization,
Android, Detox, reliability and hosted gates remain Pending. Visual review
also exposed an unrelated training delete-dialog copy issue: it says “meals
and items” in a training-plan deletion prompt; track that separately from
this testing packet.

### T13-B linked runtime attempt and host contention (2026-09-29T16:56Z)

Private requested attempt `280e20cf529ac3b080c40221:first` bound the
current iOS training selection to capture `db7be50d44f76241ee3ca0e4` and
backend fixture `e134652df10dfa2e82280348:first`; all three IDs were
distinct and the binding was independently validated. The actual controller
entered the normal builder and draft exercise search, but stopped before the
next hierarchy command acquired a child: a foreign Detox job (PID 27912,
start Tue Sep 29 13:52:33 2026) took the native host. The capture result is
`harness-blocked`, with 17 completed/cleaned child commands. It did not reach
saved training checkpoints, runtime metadata, nine reviewed frames, or a
public passing assertion.

The capture cleanup retained `failed-recovery-retained` because the foreign
simulator state changed. Independent external cleanup found zero surviving
owned PID/start identities among 266 checked and no owned device/cache/Compose,
but failed foreign-device preservation for
`36CE87B2-3068-4855-AC8A-3FBF69EB5F55`; retain this failed outcome.
The borrowed ADB listener PID 54370 was preserved. A separate actual public
preflight attempt `60d3ab8f494ea63accffd5c9` returned
`native-host-contended`, zero assertions, and `not-acquired` cleanup. The
foreign job must not be signalled. Recheck a fresh host/device census before
another full attempt; public runtime, Android/Detox equivalence and T13–T20
completion remain Pending.

### T13-B requested/capture/fixture identity binding (In progress)

`native-training-attempt-binding.ts` now creates one private, exclusive
requested-run → capture-run → backend-run mapping. It binds distinct 24-hex
run IDs, each first-attempt ID, current `SCN-training-ios` selection hashes,
its seven canonical assertion purposes and `native-entry-ios` fixture scope.
The runtime evidence mapper requires this binding and a matching requested
attempt before preparing any runtime evidence. Diagnostic packets remain
separate; neither binding nor mapper emits public outcome or passing cases.
The capture helper list and canonical training freshness include the verifier.
Nine focused declaration/contract/binding/mapper tests pass; the full actual
runtime callback, reviewed frames, independent cleanup, public finalization,
Android/Detox parity and Section12 gates remain Pending. No product, auth,
localization or provider behavior changes.

### T13-A borrowed ADB lifecycle proof (2026-09-29T16:39Z)

Actual linked iOS capture `2af9a5deeac4c2025aff2161` is terminal exit0:
one callback, normal coach home → library → new builder, unchanged scoped SQL
and a normal API library read. All10 child commands completed/cleaned; captured
app/helper inputs were stable. Library/builder screenshots were reviewed. ADB
PID54370/start Tue Sep29 13:20:47 2026 was declared **borrowed**, checked
22 times across the run, and independently reobserved unchanged afterward.
The process was never signalled. Independent cleanup passed172 owned PID/start
identities, device/cache/Compose absence and foreign-device preservation. The
prior replacement-leak receipt remains failed; this new attempt succeeds only
for the explicit borrowed-service mode. `terminal-summary.private.json` and
`adb-server-cleanup.private.json` retain the distinction.

The `owned-adb-server.ts` reference is held for the whole iOS session. If no
listener exists, it can spawn a direct foreground worker, but that branch
cannot be qualified while the pre-existing listener is present and is
**Pending actual proof**. It rejects unrecognized or changed listeners and
will not infer ownership from timestamps. The new capture/helper/declaration
source fingerprints are part of freshness. 23 focused native lifecycle,
process/command and inventory tests pass, zero skips; typecheck, scoped lint
and impact12/43/62 pass. No public runner/behavior pass: this callback did
not save/edit/restart a training plan. T13 automatic owned-service branch,
T14–T20 and both-platform/engine gates remain Pending.

Next eligible independent packet: bind the public attempt ID to the capture,
fixture, canonical selection and complete training assertion ledger before
any public finalization; the public runner stays preflight-only until full
actual lifecycle/assertion proof. Do not stop borrowed PID54370 to force an
owned branch. No product/domain/localization/auth/backend behavior changed.

### T13-A session-wide ADB reference (In progress, 2026-09-29)

`owned-adb-server.ts` now records the default-port listener before any owned
iOS device session. It borrows a recognized existing process by exact
PID/start/user/group/command identity and preserves it at cleanup; if absent,
it can start a direct owned foreground server and retain that worker until the
session ends. Each Maestro command checks the session reference before and
after; borrowed references are never signalled. The read-only device query
cannot start ADB. A separate owned-service branch is coded but remains
unqualified while port5037 is occupied by pre-existing PID54370. The actual
borrowed-only diagnostic passed and preserved that process; this is not a
native journey or public pass. Private evidence is under
`.qa/artifacts/testing-modernization/adb-lifetime-borrowed-2026-09-29/`.

Canonical iOS scenario freshness now includes the capture and ADB-reference
sources; Android declaration is unchanged. The shared-helper fingerprint
also includes the new reference module. Old native receipts cannot be silently
reused as current runtime evidence. The public runner remains preflight-only.
No product, domain, localization, auth, server or provider behavior changed.
Actual linked iOS callback, owned foreground branch, cleanup/failure controls,
full behavior assertions, Android/Detox equivalence and hosted gates remain
Pending. Reuse the existing complete controller; no new service/API bypass.

### T13-A latest outcome (2026-09-29T16:24Z)

Actual callback smoke `3f10f6da17c83e57a29db3ef` is terminal exit0,
one callback, normal native home/library/new entry, unchanged SQL and normal
library API read. All10 child commands completed/cleaned, source/helper inputs
stable within the attempt. The recorded escaped ADB PID46375 was automatically
released after exact identity/listener/consumer checks; private ledger retains
the signal decision. Independent recorded-resource cleanup passes178 PID/start
identities, owned device/cache/Compose absence and foreign-device preservation.

**Automatic lifecycle qualification remains Pending.** Extended resource
audit found ADB PID54370/start Tue Sep29 13:20:47 2026, started within the
attempt window but absent from all ownership ledgers. Per-command daemon
release allowed later commands to start an untracked replacement. Preserve
that unknown server; do not signal it or claim complete no-leak evidence from
the narrower recorded-resource census. `terminal-summary.private.json` keeps
the failed extended qualification next to the passed scoped cleanup proof.
No public native passing cases; no full save/edit/restart in this callback.
Earlier failed cleanup/recovery and blocked receipts remain immutable.

`owned-process-group.ts` now handles recorded escaped descendants safely,
without adopting or signalling other members of their new group. Group and
exact-PID identity checks reject PID/start/user/hash drift; ADB consumer checks
use an exclusive listener, fresh known-job census and a bounded read-only raw
device query. Original-group members are reverified after consumer queries,
and an unchecked new server rejects before a group signal. That last timing
hardening was added after the native attempt; its15 focused tests/zero skips
pass, but do not upgrade the earlier native receipt's helper identity.

Next packet: acquire/declare ADB service once for the whole native session
before Maestro commands, preserve a verified pre-existing service, or start a
directly owned foreground service when the port is free. Dispose the owned
service at session teardown after consumers end, with independent proof.
Do not rely on unverified Maestro non-default-port/environment support or
kill PID54370 to make a clean baseline. Runtime public adapters, identity
binding, full assertions, platform/engine parity and broader gates stay Pending.
No product/localization/auth behavior changed.

### T13-A current continuation (2026-09-29T16:07Z)

The linked actual iOS callback smoke `9da8c97417b31968be4af12f` is
terminal exit 0: one callback, normal home/library/new-builder entry,
unchanged scoped SQL and normal library API read. The two journey frames
were reviewed. Ten child commands completed/cleaned; source/helpers stayed
stable within that run. It does not execute save/edit/restart and has zero
public native passes.

Independent cleanup initially **failed** on recorded descendant ADB PID
55205/start Tue Sep29 12:58:16 2026, which escaped its original process group.
The exact start/user/command hash and empty device list were verified before
signalling that one PID. Independent recovery then passed all 166 recorded
PID/start identities, device/cache/Compose absence and foreign-device checks.
Keep `external-cleanup.private.json` failed and the separate
`external-cleanup-recovery.private.json` passed; recovery does not turn the
first cleanup into a first-attempt success. The helper's cleaned status was
insufficient. T13 automatic teardown remains Pending: fix this owned
reparented-descendant case with identity controls and fresh actual proof.
Old host-blocked capture `8b55ddfdced2cc0c3800b6d1` remains immutable; its
foreign job was gone at the later fresh census.

`native-training-pilot-evidence.ts` now maps seven canonical purposes to 16
private evidence artifacts. Explicit diagnostic mode consumes reviewed saved
packets; runtime mode requires a terminal execution profile, exact selection,
current source/binary/helpers (including this mapper), independent successful
cleanup and full UI/API/SQL verification. It emits bindings only, never a
public outcome/pass. Runtime metadata and orchestrator/fixture identity wiring
remain Pending. The mapper is included in canonical training freshness and
future capture helper fingerprints; old captures are not current runtime proof.

Copied actual saved packet `aa3ae890e28cb19631472ac4` prepared all seven
bindings in diagnostic mode. Runtime promotion, missing cleared-title frame,
missing independent API read, failed cleanup and missing SQL each rejected
before output. Duplicate preparation rejected without overwrite. Original
packet unchanged; control copies removed. Proof:
`.qa/artifacts/testing-modernization/training-evidence-mapper-2026-09-29/controls.private.json`.
Thirteen focused mapper/contract/journey/lifecycle/inventory tests pass, zero skips.
Typecheck, scoped lint/format, impact12/43/62 and diff checks pass. Inventory
330 files (268 client/62 server). No T12,
T13 or T14 full completion, Android/Detox parity, reliability or hosted claim.
No product, localization, auth or backend behavior changed.

Next bounded packet: repair and prove exact owned reparented-descendant
cleanup before runtime public finalization; then bind canonical selection and
backend fixture attempt to the existing complete training controller/mapper.
Keep the public runner preflight-only until actual required runtime gates pass.

### T13-A iOS lifecycle extraction outcome

The existing iOS setup/build/install/network/entry/action/teardown path is now
`runOwnedIosNativeSession(options)` in the same capture module. It returns
`{artifactRoot, exitCode, report}` after cleanup, with per-invocation abort
handling and no import-time process handlers/exit side effects. The CLI at
its existing path delegates to it and retains its inventory contract. Only
training-journey permits the typed owned training callback; that callback
receives the actual fixtures/observation/SQL/proxy/restart interfaces.
Callback records use distinct private execution kind/integration mode and
explicit pending-public-verification scope, always zero public native passes.
Public `run-native-pilot.ts` remains fail-closed/preflight-only.

Validation: import/no-acquisition and strict CLI parser controls pass;
16 scoped lifecycle/command/driver/preflight tests pass/zero skips. Typecheck,
scoped lint/format, inventory329 files (267 client/62 server), impact12/43/62
and diff checks pass. A synthetic callback does not prove actual execution.

Actual module smoke first fails before acquisition due to diagnostic import
depth; retained first script and fixed import only. Linked actual call
`8b55ddfdced2cc0c3800b6d1` returns exit2/harness-blocked/not-acquired,
callback count0, no device/backend/build/command/ownership records. Current
host census confirms foreign Detox PID66779/start Tue Sep29 12:41:53 2026
at 15:51:17Z, 15:53:25Z and 15:54:53Z; no foreign work is touched. This is
real host-boundary rejection proof, not positive callback/lifecycle smoke.
Keep positive smoke Pending until external host state changes. Preserve
`.qa/artifacts/testing-modernization/owned-ios-lifecycle-smoke-2026-09-29/`
and the blocked capture. Do not replay while that exact job remains active.

Canonical title recipe is aligned to current driver with two added paragraph
select/clear transitions. Both native-menu edges/view stay unknown in the
inventory. Denominators40 total/iOS,38 Android;23views/10scenarios unchanged.
Seven shared assertion purposes remain intact. Twelve focused declaration,
contract, journey and import tests pass. No transition/scenario passes from
this declaration change, no product/copy/localization change. T13 public
adapter/final receipt/both-platform qualification and broader plan remain
Pending; next unit is adapter assertion/identity mapping or the eligible
linked native lifecycle smoke after a fresh host census clears.

### T13-A shared iOS lifecycle extraction (In progress)

Extract the existing iOS capture lifecycle into an importable function in
`capture-native-testability.ts`; preserve the current CLI at the same path.
No competing device/backend/port/build/Metro harness. Validate charter/reuse
arguments before acquisition; keep abort handling local to each invocation,
no process exit or signal-listener installation merely from import. Return
terminal private report/exit/artifact identity only after existing cleanup.
Add a typed explicit training-runtime callback at the current real training
execution boundary, receiving owned fixtures/observe/snapshot/proxy/restart.
Only training charter may accept that callback. Programmatic behavior-hook
records have a distinct kind/mode; neither they nor inventory receipts imply
public passing assertions. Public wrapper remains blocked until real adapter
verification/final receipt, both-platform lifecycle and required gates pass.

Acceptance: malformed/unsupported inputs reject before resources; import has
no signal/process side effect; already-cancelled call acquires nothing;
existing CLI behavior, deadlines, host boundaries, freshness and cleanup
remain. Real bounded lifecycle smoke through the extracted function must
prove owned setup/actions/terminal cleanup; no synthetic callback test can
claim native execution. Preserve existing dirty checkouts and prior evidence.
No product/localization change; T13 full completion remains Pending.

### T12-B Android recovered quantity visibility: locally verified

Fresh linked capture `936e8715f76402464f3fe33c`, backend
`c03c403c2c7b94728c99c984`, is terminal exit 0/observed/cleaned
(2026-09-29T15:34:58Z–15:40:27Z). Fresh devDebug APK build succeeds in
2m36s; installed identity, routing/config and normal sign-in pass. One scoped
503 detail GET and normal retry 200 produce the required error/recovered
states; three owned SQL snapshots remain equal. Original recovered frame
still proves the exact complete name/session/data in hierarchy.

The single UP swipe from exact visible Upper heading exposes the entire
QA Exercise/3x8/RPE 7 row above the retained warning toast. The new PNG is
reviewed as unobscured quantity evidence; its hierarchy proves one exact
Upper session containing one enabled exact 3x8 quantity. Long-name clipping
and warnings on other frames remain limits; no warning suppression or visual
baseline approval. All six screen/hierarchy pairs are reviewed.

All 20 shared command executions complete/clean; source/all 16 helpers stable.
Independent cleanup passes 88 PID/start identities, timestamp-bound build
daemon included, six owned directories/cache/Compose absent; foreign iOS
states/workspace APK preserved. This establishes the shared executor's actual
Android positive capture path, supplementing the previous negative-path
attempt `5398138c523c45555fd19d22` (18 completed, one child exit 1, all19
cleanups; independent96 identities). Original failed scrolling remains
immutable; no extra frame/final SQL claim for that first attempt.

Current Android load qualification mandates additional captured/reviewed
quantity metadata, exact artifact paths/hashes and semantic quantity guard.
Full original load-name/error/SQL/transport checks stay required. Nine
copied-actual controls pass: valid before/after; missing metadata, uncaptured
frame, unreviewed screenshot, duplicate review, altered screenshot hash,
wrong quantity and wrong session reject (semantic mutations rehash hierarchy).
Original bytes unchanged; temporary copies removed. Initial qualification
rejects external cleanup JSON mode0644; restricts to0600 without byte changes
and fixes the helper umask. Qualification then passes five view cells, zero
transition/behavior passes; requalification after validator extraction also
passes. Private receipts retain both hashes; declaration refresh changes
fingerprints, not captured behavior.

Validation: 10 load/view/inventory tests pass/zero skips, typecheck, scoped
lint/format, impact12/43/62 and diff checks pass. Earlier shared command scope
passes16 tests. This is test infrastructure only; no product/auth/localization
change. T12 other platform states/locales, T13 public lifecycle/smoke, T14 all
families/engines, cold comparison and hosted gates remain Pending. Next bounded
packet: public lifecycle adapter preparation using existing owners/command
executor, or Android saved-training binding with this normal scoped swipe;
do not repeat the resolved visibility observation unchanged.

### Native host blocker cleared; focused title diagnostic resumed

Read-only blocked audit at 2026-09-29T14:45:32Z finds no known native job: the
foreign Detox PID has ended before any blocked goal status was set. A fresh
actual command-boundary call also passes with no known job. Keep the goal active;
no prerequisite/evidence gate is waived. Audit and clear outcome are preserved
in `native-host-blocked-audit-2026-09-29T14-45-32-968Z` under ignored artifacts.

Fresh menu diagnostic `9df3accd45d7773a82219083`, backend
`b35f1759fbaba3212ae178b4`, is terminal exit 2/cleaned. Keyboard/exact title
and intermediate frame pass; long press shows a caret, then selector tap shows
partial highlighting without Select All. Do not replay unchanged. No clear or
replacement is claimed. Shared executor now has actual iOS negative-path proof:
13 immutable clear boundary receipts, 12 completed commands and one menu child
failure with original exit 1; all 13 command cleanups pass. Source/all 23 helpers
stable. Independent cleanup passes 249 PID/start identities, owned resources
absent and foreign simulator state preserved. This is not Android, a complete
positive journey, public native runtime or reliability qualification.

Next explicit diagnostic is `training-title-gesture`: triple selector tap
(`repeat: 3`, delay 100ms) on the same single-line title, capture unchanged
original title/keyboard, one backspace, require entire field empty, type the
same required replacement and require exact value; independent SQL unchanged.
The native menu branch remains unqualified/in the denominator. Apple documents
paragraph triple tap and Maestro documents repeated taps; these do not prove
behavior on the pinned iOS 26.5/Maestro 2.6.1 target. Actual proof is required
before this candidate can be used in the full saved training journey. No
optional core title/SQL assertion, coordinate, storage injection or product
change is permitted.

### D-218 title gesture qualification and full saved binding

Actual diagnostic `fda9030c4b10062a133109c0` is terminal exit 0/cleaned.
The original exact title and keyboard are captured; triple selector tap
(repeat 3, delay 100ms) followed by one backspace yields an entirely empty
native field. Replacement matches exactly; independent before/after SQL is
unchanged. Reviewed selection/empty/replacement frames and hierarchy are
retained. All 16 commands complete/clean; source/all 23 helpers stable.
Independent cleanup passes 259 PID/start identities, with owned simulator,
cache and Compose absent and foreign simulator states preserved.
This is local diagnostic proof, zero public native passing cases.

Next bounded packet: bind this same explicit paragraph gesture to the full
saved-training driver, using a new `journey-edit-title-paragraph-selection`
builder frame with unchanged exact original title/native keyboard, one
backspace and strict entire-empty guard. Keep exact replacement, all six SQL
and three API checkpoints, same-plan identity and durable restart unchanged.
Reviewed-frame qualification must require the new selection frame explicitly;
never accept optional menu/gesture alternatives or fall back at runtime.
Native Select All menu coverage remains unqualified in the inventory and
its failed diagnostic remains immutable. Full saved journey, Android,
public runtime and reliability qualification are Pending. This changes only
test infrastructure; no product, copy, localization or auth behavior changes.

### D-218 full iOS saved-training debug proof

Fresh capture `aa3ae890e28cb19631472ac4`, backend
`28bd07204bdcecd56e9c8825`, is terminal exit 0/cleaned
(2026-09-29T15:05:30Z to 15:20:09Z), within the unchanged 15-minute
observation budget. Normal app sign-in/library/create, canonical exercise
3x8, first Save/reopen, exact title paragraph-clear/replacement, normal
confirmed removal/re-add of the same exercise with 4x10, second Save/reopen,
owned app/API restart and durable library/reopen all pass. Six SQL and three
independent authenticated API checkpoints agree; plan/session identity and
unrelated rows retain their required invariants. Actual app traffic uses the
normal owned routes and refreshed API after restart.

All 50 shared command executions complete/clean; source/all 23 helpers
stable. Independent cleanup passes 774 PID/start identities; owned simulator,
cache and Compose absent, foreign simulator states preserved. Nine actual
critical frames are reviewed. Builder screenshots show the visible title
prefix due to single-line clipping; exact complete title is checked in the
native value, with API/SQL agreement. The shipped generic item-removal alert
copy remains a previously tracked limitation, not new behavior.

Formal current view qualification succeeds for two unique cells, receipt
suffix `d4cf1cf615fa`; zero transition/behavior passes. Seven copied-actual
controls pass: valid packet accepted; missing paragraph frame, leftover title,
changed original selection title, wrong durable quantity, missing API proof
and public-pass promotion rejected. Recomputed hierarchy hashes in semantic
controls do not bypass these guards. Originals unchanged; temporary copies
removed. Control setup initially rejects ESM named import and noncanonical
macOS tmp root; corrected import/canonical realpath precede actual control
results, with no validator or expectation weakening.

This closes this local iOS saved-training debug packet only. T12 remaining
platform/state coverage, T13 public lifecycle/both-platform smoke, T14 all
families/engines, T15 cold comparison and hosted/retirement gates remain
Pending. Keep the Select All menu gap and all prior failed attempts immutable.
Next ready bounded packet: continue existing T13 public lifecycle adapter
from proven shared command/controller foundations, or remaining T12 Android
quantity/gesture qualification; do not repeat the completed iOS diagnostic
unchanged. No product/localization/auth behavior or hosted actions changed.

### T13-A shared capture command execution (work card)

Scope: replace private iOS capture's duplicated spawn/deadline/group teardown
with existing `executeOwnedNativeCommand`; use the same terminal-record helper
in Android while retaining its acquired handles for the existing final cleanup.
Preserve strict boundary checks, cancellation before spawn, private exclusive
logs, PID/start ownership, first child status versus cleanup, and existing
platform/device/backend lifecycles. No new harness or public passing receipt.

The common helper's default step cap remains 10 minutes. Add explicit build
phase capped at 15 minutes to accommodate iOS's already declared 900000ms build
budget; all other steps keep the existing cap. Never extend an active run or
infer phase from a caller timeout. iOS build caller explicitly selects build;
Android build remains its existing 600000ms. Terminal private records retain
phase, exit/signal, ownership/log paths, elapsed and cleanup timings.

Acceptance: invalid phase/deadline rejects before acquisition; explicit build
accepts declared cap without sleeping through it; default steps still reject
600001ms; child failure/cancellation/deadline/cleanup failures remain distinct
and owned resources are independently absent. Reuse existing command tests,
then typecheck/lint/format/impact checks. Current status: In progress. Actual
positive capture and Android smoke remain Pending. The earlier foreign-job
blocker cleared at the fresh 14:45:32Z census; the subsequent iOS menu diagnostic
provides the scoped negative-path evidence above.

Status: both captures now use existing `executeOwnedNativeCommand`, retaining
private terminal records; iOS duplicated spawn/group implementation is removed.
Android still retains acquired handles for its existing final cleanup. Explicit
build phase accepts 900000ms while ordinary steps reject 600001ms; invalid phase,
above-build cap and cancelled requests acquire no log/process. Controlled build
child exits 0 and its PID group is independently absent. Existing failure,
deadline, signal and cleanup-rejection controls pass.

Original combined validation: 28 tests, 27 pass and one preflight cancellation
fails its unchanged 30-second watchdog under observed host load. Retain
`validation-first.private.json` in
`.qa/artifacts/testing-modernization/shared-native-command-2026-09-29T14-40-30-271Z/`.
A measured serial fingerprint takes 1040ms client/342ms server, so do not change
that algorithm based on the watchdog failure. After other validation commands
finish, focused cancellation rerun passes both signals in 5878ms, with zero
skips and unchanged watchdog. This is a recorded rerun, not an all-first-pass
suite or native reliability result. Typecheck, scoped lint after import-order
fixes, format/diff and impact checks (12/43/62) pass. Current source hashes and
final scoped validation are recorded separately. The subsequent iOS menu diagnostic provides scoped negative-path execution
proof above; no complete positive capture, Android smoke or public T13
completion is claimed.

### T13-A native command-boundary contention guard (work card)

Scope: both private iOS/Android capture executors recheck the existing strict
known-job census before each build/action/hierarchy child command. A foreign
native job starting after preflight must stop the next command before spawn;
already acquired owned resources follow existing teardown. Write immutable
redacted per-command census receipts. This is supplementary to host locks,
PID/start ownership and foreign-state cleanup; it is not a CPU threshold,
continuous monitoring, public runtime qualification or permission to signal
foreign work. Test infrastructure only; no product/localization behavior.

Evidence motivating packet: title-only run `518f648df375325f5274e328` passes
preflight, then expires while foreign native work is active and a foreign
device disappears. On 2026-09-29T14:28:14Z a read-only current census confirms
live foreign Detox PID 73967/start Tue Sep 29 11:14:42 2026. No simulator is
acquired in this packet. Keep the prior failed cleanup immutable.

Acceptance: safe unique labels and wx private receipts; known foreign job blocks
before child dispatch without signalling it; clear census proceeds; ancestry,
zombies and idle-service exclusions remain; malformed/cancelled census stops
execution; both captures use the helper and preserve cancellation checks before
spawn. Actual controlled child plus selector/census negative tests, typecheck,
scoped lint/format/impact validation.

Status: guard implemented in both capture executors. Twenty-seven targeted tests
pass with zero failures/skips; typecheck and scoped lint pass. The actual
controlled native-looking child remains alive when both preflight and the new
command boundary reject; no subsequent callback is dispatched, private receipt
is redacted/mode 0600, duplicate wx write cannot replace it, and unsafe labels
reject before census/write. Owned child cleanup is separately verified.

Read-only actual-host control at 2026-09-29T14:31:22Z blocks at the command
boundary on live foreign Detox; no native resources or engine command acquired.
Evidence: `.qa/artifacts/testing-modernization/host-boundary-2026-09-29T14-31-22-632Z/`.
A second current boundary check after validation still rejects the live foreign
job. Format/diff checks and impact validation (12 features, 43 suites, 62 UI
specs) pass. Final scoped receipt is `validation-final.private.json` in that
artifact directory. No native processes were started for either read-only host
control. A clear-host next-step success and actual simulator continuation are Pending.
The helper checks boundaries only, not foreign processes starting during an
already running command. This is scoped host-control preparation; public
T13/T14/cleanup, complete title selection and all later gates remain In progress.

### T13/T14-B actual iOS saved training controller binding (work card)

Scope: bind the ordered controller to the existing owned iOS/Maestro capture
runtime, observed removal selector and private authenticated API read. Test-only
low risk; scoped writes only in this run's disposable Postgres. Consulted SC-208,
handoff Section 13-B, controller, draft/edit observations, capture ownership and
relaunch code, proxy binding and prior actual removal hierarchy. No product,
auth, provider, locale, signing or CI behavior change.

Acceptance: normal coach sign-in/library/new builder; exact unique title,
Strength session, fixture canonical exercise and 3x8 local draft; first Save
creates one owned exact plan; reopen; local title/4x10 edit via observed
remove/confirm/re-add; second Save updates same plan/session identity; terminate
app/restart owned API/relaunch/open library/reopen restores exact final values.
Six SQL and three authenticated API checkpoints agree; drafts/unrelated rows
unchanged; UI hierarchy matches exact fields; normal app transport proves each
operation through owned API. Preserve original failure and each attempt; owned
cleanup and foreign state checked separately. Bind current helper hashes.

This is an explicit debug/runtime binding in the existing inventory harness,
not the public T13 runner, reliability attempt or engine/platform equivalence
receipt. Public native passing count stays zero. Android/Detox/public lifecycle,
regression comparison/exploration/hosted gates remain Pending. The declared
observation budget is 20 minutes for the additional ordered checkpoints, before
starting the run (15-minute build + 5-minute cleanup; protocol cap respected).
Status: In progress. First actual attempt `1cd3b51e7d9ac1ba6566206d`, backend
`e600325ab30b8237a4f05d1c`, terminal session 50554 exits 2/cleaned. Normal create,
first Save/reopen and exact SQL/API passed; removal/re-add shows 4x10, but the
edited title retained a `:first` suffix. Exact UI guard stops before second Save,
restart or any full journey claim. `eraseText: 200` backspaced from a cursor
placed mid-field and left right-side text. Capture and all first-failure files
remain immutable. External cleanup proves 49 PID/start identities gone, owned
simulator/cache/Compose absent and foreign simulator state preserved.

Correction: use supported long-press/Select All/one backspace, observe the OS
menu and verify the field is entirely empty before typing the same exact
required title. No expectation is weakened. This is normal native text editing,
not a product or credential change. Keep the original 20-minute observation
budget. Native menu is included in all platform denominators; Android remains
unobserved. Next linked fresh attempt will prove the correction and complete
save/edit/restart checkpoints if actual behavior permits.

Second debug attempt `805a82dd2115c7a905456d55` (backend
`2eda9839fd389aab4c56081e`) terminates with exit 2/cleaned. Normal first
Save/reopen SQL/API pass again. Failure screenshot and Maestro hierarchy show
unchanged title and native keyboard after the initial long press, with no
Select All menu. No title clear, second Save or restart is claimed. Source and
all 23 helper inputs remained equal. Independent cleanup confirms 40 PID/start
identities gone, owned simulator/cache/Compose absent and foreign devices
preserved. Keep both failed captures immutable and zero public passing cases.
Next correction: explicitly tap the title, capture unchanged value and native
keyboard, then long press the already active field. Menu/empty-value/exact-title
assertions remain mandatory; this focus hypothesis needs a fresh linked run.

Fresh focus control `53e5bd681cf3885c01b860c7`, backend
`16055acf3b2c1153d288ec3b`, ends exit 2/cleaned. First Save/reopen API/SQL and
explicit unchanged-title/keyboard checkpoint pass. The reviewed failure PNG
shows partial word selection after active-field long press, but no Select All
menu. Thus the focus hypothesis is insufficient; title clearing, second Save
and restart remain unproved. Source/all 23 helpers were stable. Independent
cleanup passes 45 PID/start identities and all owned resources/foreign states.
Do not repeat this full journey unchanged. Next packet is a title-only native
diagnostic: new unsaved long title, explicit keyboard checkpoint, capture the
long-press state, then tap the selected field by its existing ID and inspect
the menu. Exact menu/empty-title guards remain required, scoped SQL must stay
unchanged, and public passing count remains zero. Menu-tap hypothesis is
unproved until actual execution; no product menu suppression was found in the
shipped TextInput configuration.

Title-only diagnostic charter `training-title-selection` is implemented and
linked run `518f648df375325f5274e328` was started after 26 targeted tests, typecheck and
scoped lint pass. It uses normal sign-in/library/new builder, long run-specific
title, keyboard and intermediate long-press captures, selector tap, exact
Select All/empty/replacement guards and unchanged SQL. No Save, API restart,
public runner or full training acceptance is claimed. Its charter is not
accepted by the public artifact qualifier; it is a bounded private diagnostic.

Title-only diagnostic `518f648df375325f5274e328`, backend
`8ae3eaf0e4b12e2b1a019b7d`, terminates exit 2 at its original 15-minute
observation deadline. Keyboard/exact original title passed; intermediate
long-press hierarchy was cancelled before its complete frame. The menu-tap
hypothesis was not executed. Keep this distinct from the two actual missing
menu failures. Source/all 23 helpers stayed fixed. Host load observed at
11:19 was 283.02/256.90/151.71, with foreign Meer simulator work; this is
advisory contention evidence, not proved sole cause. Independent cleanup finds
all 31 PID/start identities and owned simulator/cache/Compose gone, but a
foreign simulator `36CE87B2-3068-4855-AC8A-3FBF69EB5F55` disappeared during
the run. Overall cleanup stays failed/recovery-retained; do not overwrite it
with a cleaned claim or recreate/touch the foreign device. No title-clear,
second Save, restart, public passing case or native gate is qualified.
Next: recheck host availability and finish only the bounded title-selection
diagnostic before another full saved journey; do not extend deadlines during
a run or replay while foreign native work is active. No native process remains
owned by this packet.

### T12/T14-B native removal confirmation and local quantity edit (work card)

Scope: qualify the shipped remove/confirm/re-add path before binding training
journey edits. Test-only low-risk observation; no product/auth/copy change.
Consulted handoff Section 13-B, SC-208, SessionCard, handleRemoveSessionItem,
locale Delete/Cancel/body copy, existing draft/load/discard captures and owned
API read binding. Retain the actual existing generic plan-delete body as an
observed copy limitation; do not revise it merely to pass the test.

Acceptance: normal sign-in/library opens exact owned seeded plan; observed
removal prompt contains shipped body and enabled Delete/Cancel; select Delete
relative to body only after actual tree confirms the unique target. Old item
is absent; add fixture canonical exercise with 4x10 through normal search/detail
controls; exact local quantity and session are observed. Independent SQL stays
unchanged and authenticated API remains original seeded quantity. Preserve all
frames, transport/helper/source hashes and first failure; verify owned cleanup
and foreign simulator state. Initial scope iOS; Android selectors/lifecycle,
full saved journey/public runner and T13/T14 gates remain Pending.

Status: actual scoped iOS action observation obtained; full T12/T13/T14 remain
Pending. Exact command: existing host-lock wrapper with private state root,
`node --import tsx scripts/testing/capture-native-testability.ts --platform=ios
--mode=inventory --charter=training-edit --reuse-build=ab15e97b3b5358a1e8cb44b7`.
Terminal session 91106 exits 0. Run `a994da90f8c73b176849fcf0` is observed/cleaned;
backend `177ef5e2aa5d0732cf536353`. App source and all capture helper inputs stayed
identical during execution. Ten screen/hierarchy pairs across eight view IDs
are retained. Six edit frames (original/prompt/removed/search/detail/re-added)
were visually reviewed; original 3x8, enabled Delete/Cancel, removal, canonical
exercise and unobscured 4x10 are visible. Long editable name is visually clipped;
no visual-baseline or full copy/layout acceptance is claimed.

Three read-only SQL checkpoints are equal; independent normal authenticated API
read retains the original seeded sessions. Normal catalog selection uses the
fixture canonical ID, not a first-result index. Separate external cleanup proves
36 recorded PID/start pairs absent, owned simulator/cache/Compose absent and
foreign simulator states preserved. Private capture/cleanup evidence lives under
`.qa/artifacts/native-pilot/a994da90f8c73b176849fcf0/`.

Six copied-actual-tree prompt controls reject missing/duplicate body, disabled/
misplaced/duplicate Delete and malformed bounds; positive before/after passes
and original hierarchy bytes stay unchanged. These pure controls use no target
and establish no new runtime pass. `prompt-controls.private.json` records them.

Three scoped lint warnings were fixed after the terminal capture by reordering
imports and changing callback type declarations. Thus the immutable runtime
capture preserves its original helper hash; it cannot newly qualify the revised
helper as a current full runtime receipt. The current pure guard passes against
its actual hierarchy. Fresh saved-journey execution and formal charter/view
qualifier support remain Pending; no evidence waiver or native behavior pass.
Canonical inventory now includes item-removal state and two transitions in all
platform denominators (22 views/36 transitions/10 scenarios); Android remains
unobserved. Next: bind the verified actions to ordered create/save/edit/relaunch
controller using existing platform lifecycle, then obtain fresh API/UI/SQL and
public cleanup receipts.

Final current-source validation: seven-file Node command passes 23 tests, zero
failures/skips; typecheck, scoped zero-warning lint, Prettier, 327-file inventory
(265 client/62 server), impact registry and whitespace checks pass. The source
declaration reports zero native behavior passes. Six reviewed edit-frame hashes
are in `reviewed-edit-frames.private.json`; aggregate evidence is in
`scoped-final.private.json` beside the capture. No product/localization update
is required for test infrastructure; the existing wording limitation is tracked.

### T13/T14-B observed-native scoped API read binding (work card)

Scope: bind independent training plan reads to the existing in-process owned
proxy and normally observed native catalog credential. Test infrastructure only;
no auth/product behavior change. Risk low. Consulted specification Section 16,
handoff Section 13-B, testing strategy native-profile controls, owned proxy and
session protocol, native training controller and existing proxy verifier.

Acceptance: exact native-entry fixture scope and training plan identity; scoped
SQL establishes account ownership; normal `/me` verifies observed account; exact
owned authenticated GET returns private plan data plus redacted process binding.
Reject missing/browser/query/failed observations, malformed/out-of-scope/foreign
plan/account, fault or concurrent control, stale upstream and restart/stop.
Bound network/body reads; restart/stop invalidate credentials. Real disposable
Postgres controls must show unchanged SQL and independent owned cleanup. This
proves an HTTP/API binding only; UI/engine/public runtime and T13/T14 completion
remain Pending. Implement in existing proxy, add explicit local verifier; update
strategy/handoff, D-218 and BL-018 wiring. No FR/BR/UC/localization update needed.

Status: locally verified API binding; native runtime remains Pending.
`readObservedNativeTrainingPlan` is implemented in the existing proxy and bound
into canonical training source freshness. It accepts fixed scope/account/plan
identity, verifies scoped SQL and normal `/me`, bounds private GET/body reads,
and returns exact plan plus redacted process metadata. Independent API reads do
not enter app/native request observations. Concurrent control and faults block;
stop aborts the read; restart requires newly observed native catalog traffic.

Exact commands and terminal evidence:

- `node --import tsx scripts/testing/verify-native-training-read.ts`: two fresh
  disposable Postgres sessions, six successful independent reads, 19 rejection/
  cancellation controls per scope, unchanged own/foreign-scope SQL, 10 owned
  PID/start identities absent and Compose containers/networks absent. Final
  receipt: `.qa/artifacts/testing-modernization/native-training-read-2026-09-29T12-53-14-039Z/receipt.private.json`.
  Earlier receipt at `native-training-read-2026-09-29T12-52-34-193Z` is preserved;
  the verifier's Node URL import type mismatch was corrected before final run.
- `node --import tsx scripts/testing/verify-owned-api-proxy.ts`: two fresh
  sessions pass the retained browser/native save/load faults, denial, unchanged
  failed-write SQL, durable retry, restart/stop, deadlines and cleanup checks.
  Receipt: `.qa/artifacts/testing-modernization/2026-09-28-p3/proxy-2026-09-29T12-53-15-036Z/receipt.json`.
- Eight initial focused controller/read tests pass, including five real-HTTP transport
  negative cases under synthetic ownership/snapshot boundaries. These cases
  prove bounds and rejection, with zero DB/native passing claims. Zero-warning
  lint required marking Node test registration as `void`; an initial `await`
  registration failed the combined command because this package transpiles to
  CJS. Corrected to `void` without changing assertions; final verification below.
- A separate terminal read-only cleanup census passed both run identities and
  all 10 PID/start records plus owned Compose resources. Receipt beside the
  final read receipt: `external-cleanup.private.json`.

Strategy/handoff/D-218/wiring updated. Existing native captures now have an old
proxy-helper fingerprint; preserved observations cannot qualify this changed
helper as current runtime proof. No native UI/engine execution or T13/T14
completion is claimed. Next: real platform lifecycle and training driver binding,
including observed removal confirmation, normal post-restart catalog navigation,
private checkpoint artifacts and final public cleanup receipts.

Final verification: combined five-file Node command passes all 18 checks with
zero skips; zero-warning scoped ESLint, Prettier check, typecheck, 326-file
inventory (264 client/62 server), impact registry (12 features/43 suites/62 UI
specs), canonical declaration validation and whitespace checks pass. The source
declaration still reports zero native behavior passes. Private aggregate
validation receipt: `native-training-read-2026-09-29T12-53-14-039Z/validation-final.private.json`
under `.qa/artifacts/testing-modernization/`.

### T13/T14-B training controller and state-verification preparation

Scope: engine-independent ordered training controller with fixed owned SQL/API
checkpoint verification. Reuse `OwnedDomainSnapshot`, schemas and canonical
ledger purposes. Docs/code consulted: handoff Section 13-B, SC-208, TC-278/
TC-303, browser training-durable, SessionCard and screen add/remove handlers.
Supported edit is remove/confirm/re-add the same canonical exercise with 4x10;
there is no inline quantity editor. No product/auth/locale changes. Test-only
risk low; no runtime/engine qualification from synthetic drivers.

Acceptance: create adds one exact owned plan; local create/edit do not persist;
second save updates the same plan; exact quantity/exercise/title/session and
independent API/SQL agree; restart snapshot retains final state; all unrelated
scoped rows unchanged. Wrong run/scope/owner, duplicates, incorrect API/state,
early writes and lost edit reject. Controller stops at a failed checkpoint
before subsequent UI actions. Runtime driver bindings, actual UI/hierarchy
evidence, lifecycle/public runner, both-engine/platform execution and all later
gates remain Pending. Update only test infrastructure docs.

Implementation: `native-training-journey.ts` orders entry → local draft → first
save/read → local remove/re-add edit → second save/read → restart/reopen/read.
It validates inputs before actions and scoped schema/identity at checkpoints;
first bad checkpoint stops later actions. Exact state/API values, plan identity,
one created plan, unchanged drafts/unrelated scoped rows and restart durability
are required. Thirteen related checks pass, including 19 state mutations per
platform, wrong catalog/attempt controls and stop-before-save/edit/restart
sequence checks using synthetic drivers. No native/API runtime is executed by
those drivers. Typecheck, zero-warning scoped lint (after replacing seven
unnecessary async mock methods), formatting, 325-file inventory, impact
(12/43/62) and diff checks pass. Controller source is bound to canonical
training-cell freshness. Runtime wiring remains Pending in the BL-018 wiring
entry; no T13/T14 completion or native behavioral result is claimed.
Final current-source receipt:
`.qa/artifacts/testing-modernization/2026-09-29-training-controller/receipt-final.private.json`.
The second-save checkpoint preserves plan creation/session identities and
rejects before restart on a bad save. All 13 related checks pass against final
source; the prior preparation receipt remains immutable. Real platform/engine
driver bindings are the next required execution work.

### T14-B shared training assertion ledger preparation (work card)

Scope: canonical training-cell assertion metadata shared by Maestro/Detox and
both platforms. Read specification Section 21/T14-B, handoff Section 13-B,
SC-208 and TC-278/TC-303. Reuse the declaration generator and public selection/
completion boundary; create no second registry. Define normal entry, local
draft, first save, local edit, second save, relaunch/read and unrelated-state
assertions with stable IDs, requirement/document links, starting state/action,
exact expected UI/API/SQL outcomes and evidence templates. No flow execution,
T13/T14 completion, auth or product behavior change is claimed.

Acceptance: generated iOS/Android ledgers identical, both engine selections
require the complete ledger, omitted/duplicate/evidence-kind controls cannot
pass; actual public preflight moves past missing-ledger and remains blocked
without qualified runtime adapters. Current source/declaration hashes and
related tests/type/lint/format/impact checked. Full native prerequisites and
the then-open Android unobscured-quantity gap remain explicit; the latest
status above now records its fresh scoped resolution. Infrastructure risk low;
no product/localization artifacts need a behavior update.

Canonical integrated training ledger now contains seven shared purposes with
the required recipes. Both platforms/engines select identical rows. A count
and SHA-256 of canonical sorted-key UTF-8 JSON bind the complete ledger;
missing/duplicate/changed rows and empty recipes reject, including a regenerated
hash around an invalid expectation. Fixture mode is explicitly ineligible for
this Postgres contract; it requires separate preparation. Generator and public
contract sources are bound in scenario freshness. Ten related checks pass,
including actual cancellation/redacted preflight receipts, with typecheck,
scoped zero-warning lint, formatting, fresh 324-file inventory, impact (12/43/62)
and diff checks. Four actual current public preflights accept the training
ledger and exit 2 at execution-adapter-pending, cleanup not-acquired, no child/
assertions/device/backend. Private receipts:
`.qa/artifacts/testing-modernization/2026-09-29-training-ledger/preflight-controls-final.private.json`.
This is T14-B metadata/T13 prerequisite preparation, not T13 execution or T14
acceptance. Next: adapt shared owned runtime lifecycle into the public runner
and implement training actions plus independent UI/API/SQL verification; no
inventory capture may be counted as that runtime adapter.

Current bucket: P4 native inventory/testability preparation. T09–T11 are locally verified in the recorded scopes; all five integrated browser journeys pass fresh combined matrices. Native comparison, exploration and hosted promotion remain pending; full plan incomplete.
Risk level: High for cross-repository test infrastructure and later CI; scoped SC-208 repair has rendered controls and one fresh iOS inventory observation, with broader native behavior gates pending.
Owner: MyChampions client/server maintainer.
Blocked by: Later native/hosted promotion requires measured receipts; not assumed available.
Human approval: User authorized implementation of the plan on 2026-09-28. No merge, deployment, production/provider mutation, auth/payment change, or evidence waiver authorized.

### T12-B Android initial-load error/retry (work card)

Scope: extend the existing load observer/validator and Android capture, with
platform-specific attributes from actual Android draft trees. Reuse the owned
emulator/ADB/Gradle/API/Metro lifecycle and exact account/path read fault;
no product/auth/API/copy changes. Docs consulted: SC-208 initial-load state,
testing specification/handoff, current iOS qualification and existing Android
testability/lifecycle. Infrastructure risk: medium within authorized scope.

Acceptance: normal coach sign-in/library; one seeded detail GET fails 503
before forwarding; form absent, error and enabled Retry/Back present; retry
forwards 200 and restores exact Android seed name/Upper/QA Exercise/3x8;
three owned SQL snapshots equal. Validate explicit platform/attribute/scope
boundaries with shared negative controls. Bind changed helper inputs and
current declaration; fresh owned Android build/target required. Review actual
screens/tree and independently verify resource absence/foreign-state
preservation before qualification. Back execution/full T12/T14/adoption/hosted
claims remain Pending. No FR/UC/BR/AC/localization behavior update needed.

Android wiring and shared platform-specific validator are implemented. Eighteen
related checks pass, including 26 negative mutations per platform plus invalid
platform and Android exact app-prefix controls. Current raw iOS UI/SQL/transport
inputs still pass the shared validator; that does not requalify a capture whose
helper hash predates this change. Typecheck, zero-warning scoped lint, formatting,
324-file inventory, impact (12/43/62) and diff checks pass. Initial TypeScript
errors (unrefined receipt platform and unknown synthetic child node) and one
lint warning were corrected without changing the asserted product contract.
Native runtime/build/cleanup qualification remains Pending until actual capture.

Actual Android capture `b20247d5c77492f07a7245d0` now returns terminal exit
0/observed/cleaned. Fresh build/install/config/reverse routing pass, normal
sign-in/library occurs, one exact scoped detail GET injects 503, retry returns
200, and three SQL snapshots are equal. Five screens and their hierarchies
are reviewed. Error replaces form, Retry/Back enabled, Android seed name/
Upper/QA Exercise/3x8 exact in hierarchy. Sixteen helpers and app source match
before/after. Independent cleanup proves 121 process/start identities absent,
including the timestamp-bound single-use Gradle daemon; six owned directories,
cache and Docker gone; foreign iOS states and workspace APK preserved.
Initial view-only qualification:
`.qa/artifacts/native-pilot/b20247d5c77492f07a7245d0/qualified-views-d57e0eb00a36.private.json`.
No transition/behavior pass. The warning toast covers the quantity in the
recovered PNG and long name clips; exact hierarchy data is separately checked.
`review-limits.private.json` records this visual gap. Next eligible work:
obtain an unobscured quantity frame through supported scrolling and continue
public native execution adapter preparation; retain full T12/T14/comparison/
exploration/hosted gates Pending. No product/localization change.
After testability documentation/declaration refresh, current view-only
qualification is `qualified-views-61d543860aff.private.json`; the first
immutable qualification remains retained. Six actual Android copied-evidence
mutations reject between positive controls, with original bytes unchanged
(platform, mounted form, disabled retry, detached quantity, SQL mutation,
wrong retry upstream). Controls:
`.qa/artifacts/testing-modernization/2026-09-29-android-load-observation/controls.private.json`.
Current iOS raw evidence still passes its platform validator, but its older
capture helper hash remains historical after this shared-observer revision;
do not silently create a new current iOS qualification from it.

### T13-C native host-contention preflight (work card)

Scope: read-only process census before native resource acquisition. Reuse
existing host lock, captures, process ownership and receipt conventions. Docs
consulted: plan Sections 9/16 (host locks/ownership), runtime preflight and
the failed foreign-state cleanup evidence above. Infrastructure risk: medium;
no application, auth, provider, CI status or device behavior change.

Add one shared bounded POSIX census/classifier for live known Detox, Maestro,
native capture, Xcode and Gradle build jobs. Ignore the caller's actual ancestor
chain and zombies; do not mistake idle Gradle daemons/MCP servers or arbitrary
command text for native execution. Persist PID/start/kind and command hash,
never raw arguments. Reject malformed/unknown census rather than declaring
an idle host. A no-known-job snapshot is advisory, not a lock or guarantee;
existing host locks and final foreign-state cleanup remain authoritative.
Wire both capture entrypoints before acquisition; public pilot checks it after
its existing selection/environment/ledger gates and before future adapters.

Acceptance: parser positive/negative and invalid-census controls; actual bounded
directly owned native-looking test child is detected and remains alive after
rejection; its strict group cleanup passes. Actual foreign live run blocks our
capture before any device/backend/Expo/engine acquisition and remains untouched.
Unknown census/file failure blocks, diagnostics redact arguments. Run related
preflight/schema/ownership checks, typecheck/lint/format/impact/inventory. Native
behavior/adoption/hosted gates remain pending. No product/copy docs update needed.

Local verification: 17 related native tests pass, including actual owned-child
detection/cleanup and 21 load-observation rejection controls. Typecheck, scoped
zero-warning lint and impact validation (12 features/43 suites/62 UI specs)
pass. Inventory now contains 324 files (262 client/62 server). All ten native
scenario cells bind the host guard in owner/source freshness; qualification
also requires the capture's guard hash to match current source.

Actual startup controls `e21cef17029920a2b23ffd45` (iOS) and
`cb962911306c1e4c6f6cd467` (Android) both exit 2/harness-blocked with cleanup
not-acquired, no native/backend/Metro resources, while the directly owned
synthetic native-looking control remains alive. All owned groups are then
absent and a fresh positive census reports no known job. Evidence:
`.qa/artifacts/testing-modernization/2026-09-29-native-host-preflight/capture-block-controls.private.json`.
Earlier actual foreign-job rejection receipts remain preserved. The former
foreign Detox/Gradle jobs subsequently ended independently; old PID notes are
historical and must be refreshed before any acquisition. Advisory census does
not guarantee exclusive host use. Fresh native load qualification remains
Pending; no native behavior/adoption or hosted pass is claimed.

### T12-B native initial-load fault seam (work card)

Fresh uncontended iOS load capture `d1ba9341ca8519dde3f1b375` is now qualified
in the view-only scope: terminal exit 0/observed/cleaned, all six screenshot/
hierarchy pairs reviewed, exact one-request 503 → normal 200 detail read and
three equal scoped SQL snapshots. Error form controls are absent; Retry/Back
enabled; recovered exact seeded name/session/exercise/quantity verified.
All 20 helper and application source inputs match before/after. Independent
cleanup proves 27 PID/start identities absent, owned simulator/cache/Docker
removed, and every foreign simulator state preserved. Private receipt:
`.qa/artifacts/native-pilot/d1ba9341ca8519dde3f1b375/qualified-views-0af9a6aea85b.private.json`.
After recording testability docs and refreshing declaration hashes, current
qualification is `qualified-views-293d0e91ff02.private.json`; the initial
immutable qualification remains retained. Eleven related checks pass against
that refreshed declaration. No capture bytes or expected behavior changed.
Actual copied-evidence controls pass before/after five deliberate host
freshness/census mutations: missing/stale helper input, contended census,
out-of-window timestamp and capture/census mismatch all reject. Original
capture/cleanup/census bytes are unchanged. The first control script expected
the wrong fixed error text; that harness failure is preserved, then the
correct message pattern passes without changing production validation.
Private controls:
`.qa/artifacts/testing-modernization/2026-09-29-native-host-qualification/controls.private.json`.
Copied bundles are labelled validator controls and supply no native execution
or qualification. Scoped host-preflight checks/actual startup controls are
bound in
`.qa/artifacts/testing-modernization/2026-09-29-native-host-preflight/receipt.private.json`.
Screens retain debug warning banners and clip the long name visually; the
native value is exact, with no bundled-release/visual acceptance claim.
Previous failed/cancelled load runs remain immutable and unqualified. Android
equivalent, Back-navigation execution, full state/locale coverage, public
runtime adapters, native comparison/exploration and hosted gates stay Pending.
Next eligible packet: Android load-error/retry observer using the same owned
fault/snapshot contracts and platform-specific hierarchy attributes.

Historical packet kickoff: reuse the verified seam in a separate `training-load`
iOS inventory charter. Read SC-208 initial-load error, BuilderLoadErrorCard,
loadPlan/screen behavior and existing capture/qualifier/fixture contracts.
Require normal sign-in/library, exact failed GET, error replacing form, enabled
Retry/Back choices, normal retry and exact seeded name/session/quantity; three
owned SQL snapshots remain equal. Qualification requires reviewed error and
recovered frames, unchanged helper/source inputs, bound transport and external
cleanup. No Back navigation execution claim in this retry packet; that branch
remains separately pending. Synthetic evidence controls establish validator
rejection only. Reuse a qualified build only when current identity matches;
acquire a new simulator/DB/API/Metro with existing ownership. Actual Android,
full T12 and T14 behavior gates remain pending. No product/copy change.

First actual load charter: `bfa788cabb4131796c5cc6e1` reached/reviewed all six
views, showed exact error/Retry/Back controls and recovered seeded content with
unchanged SQL. It remains harness-blocked and unqualified. The validator had
incorrectly required an unsupported library `GET /plans/training`; source
`getPredefinedPlansFromSource` establishes `/plans/predefined`, so remove the
invented list requirement while retaining exact failure/retry detail reads,
normal catalog, UI and SQL checks. The 21 synthetic negative controls still
pass. Do not edit the original capture or retrospectively qualify it.
Independent cleanup finds 28 PID/start pairs absent and owned device/cache/
Docker resources gone, but foreign `iPhone 17-Detox`
`36CE87B2-3068-4855-AC8A-3FBF69EB5F55` changed Shutdown → Booted. Retain the
failed cleanup receipt/recovery and preserve that device. A new run may use
its actual current state as baseline after checking for competing work; do not
reset it or claim the first cleanup gate passed.

Fresh retry `1b30bc004d9116e795b99ee0` was deliberately cancelled (143) after
the process census found live unrelated Meer Detox PID 13565/start
`Tue Sep 29 08:26:23 2026`. Only our capture PID 84061/start
`Tue Sep 29 08:34:20 2026` received SIGTERM; the foreign run/Gradle daemon and
devices were untouched. Cancellation occurred during simulator acquisition,
before backend/Expo/engine stages. Preserve capture and dedicated external
cancellation cleanup evidence. The general observed-run cleanup verifier was
inapplicable (no backend acquired), so no normal qualification receipt exists.

With the corrected documented catalog expectation, the actual first raw
capture passes the narrow UI/transport/unchanged-SQL validator before and after
six deliberate copied-evidence controls; original input bytes are unchanged.
Private controls:
`.qa/artifacts/testing-modernization/2026-09-29-native-load-observation/controls.private.json`.
This does not qualify the original failed run or waive its cleanup failure.
Nine related checks and 21 synthetic negative controls pass; corrected
typecheck and scoped zero-warning lint pass. An initial partial transport type
annotation failed typecheck and four lint warnings were fixed without changing
runtime expectations. Inventory is refreshed to 323 files. Actual qualified
native load evidence remains Pending until a fresh uncontended run passes;
next safe independent work is host-contention preflight/runner validation.

Final current checks: 12 related tests pass, including the 21 synthetic
negative cells. Typecheck, scoped zero-warning lint, formatting (after import
order formatting repair), fresh 323-file inventory and diff checks pass.
Impact validation passes 12 features/43 suites/62 UI specs. Dedicated cancelled
run cleanup independently proves capture PID and owned simulator absent and
all prior simulator states preserved; backend stage was never reached.
Scoped final receipt:
`.qa/artifacts/testing-modernization/2026-09-29-native-load-observation/receipt.private.json`.
Foreign Detox PID 13565/start remains live at final read; do not restart native
qualification while that run is contending. Full objective remains active.

Current packet: implementation of an in-process read-fault control in the
existing owned proxy; no application/auth/API behavior change. Reuse current
session, observed native credential, fixed scoped snapshots and proxy lifecycle.
Docs consulted: SC-208 initial-load error state, the testing specification
Sections 9/16, implementation handoff, parent evidence workflow/adapter and
existing save-fault contract. Test infrastructure risk: medium within the
already authorized plan; no production/provider or destructive shared data.

Acceptance: browser and existing save APIs still reject GET faults; the new
native-only control accepts one exact seeded plan-detail path/account/scope
after a successful normal catalog request. Reject foreign/missing plan,
wrong account/path, stale credential and duplicate attempts. Inject exactly
once before forwarding; retry reads normally; scoped SQL remains byte-equivalent.
Run the existing explicit real-Postgres proxy verifier with two fresh sessions,
typecheck/scoped lint/format/impact checks and independently verified cleanup.
Capture/qualifier wiring and actual iOS/Android error/retry observations remain
Pending until their separate receipts exist. No product/localization artifacts
need an update for this test-only seam.

Local transport verification passes in two fresh disposable Postgres sessions
(`6b657e03f16249db242043e9`, `bc9fb61a894773fc51a2fd2f`). Each observes one
injected load, normal retry/read, unchanged scoped SQL and all existing save,
origin, restart, deadline and teardown controls. Private receipt:
`.qa/artifacts/testing-modernization/2026-09-28-p3/proxy-2026-09-29T11-16-01-652Z/receipt.json`.
The first run (`aa97445137f963e156104c36`) failed because the unseeded-scope
negative control reached the session protocol and closed it. Rejecting scope
against the owned manifest before snapshot fixes that boundary; its original
harness-blocked/cleaned receipt and failure log are retained. Typecheck and
zero-warning scoped lint pass. Related checks initially pass 9/10: the native
preflight correctly rejects the now-stale declaration (`invalid-inventory`),
so regenerate its source hashes before rerunning, without weakening the test.

Final current-source verification repeats two fresh sessions
(`9c148ee97479c3db1d37d280` and `3a10ff2b8e28aeeab6dd55bb`), with the native-load
snapshot paths included in the verifier receipt. Final scoped receipt:
`.qa/artifacts/testing-modernization/2026-09-29-native-load-fault/receipt.private.json`.
It binds source/attempt hashes and independent cleanup: 18 known PIDs absent,
and both owned Docker container/network/volume sets absent. All 13 related
native observation/preflight/inventory checks pass after declaration refresh;
typecheck, zero-warning scoped lint, formatting, impact (12/43/62), fresh
322-file inventory and diff checks pass. Preserve prior attempts. Broad native,
provider and full-quality gates are not claimed; the known auth contract gap
and all remaining plan gates stay Pending. Next: wire and qualify the actual
iOS load-error/retry charter, then its Android equivalent.

### T18-A rendered component CI wiring (work card)

Independent earlier-lane CI preparation is allowed by the plan while native
T12 runs. Reuse the existing `fast-quality` job and Node 24 dependency install;
add `yarn test:component --ci` after impact validation and before unit checks,
so a known unit failure does not prevent component execution. Keep job/status
names, authorization dependencies, exact checkout ref, permissions, pinned
actions, unit/lint/type/diff checks and native/web routing unchanged. No new
hosted run or promotion claim; the missing password-reset confirmation route
continues to block the full quality gate.

Validate the actual CI component command on the five existing rendered suites.
Use one passing and one deliberate failing rendered fixture through the same
package script/config to prove nonzero propagation. Preserve both private JSON
reports. Extend existing universal-quality/trust contract checks; run their
actual Python authorization controls. Hosted exact-SHA acceptance remains
Pending; no push/dispatch or required-status change is authorized.
Local results: actual `yarn test:component --ci` passes 41 tests in five
rendered suites; 21 workflow/trust checks pass, including executed Python
candidate/queue controls. Rendered pass/fail probes through the same package
script/config return exactly 0/1 and leave owned groups absent. Positive and
negative private reports are retained under
`.qa/artifacts/testing-modernization/2026-09-29-component-ci/947a04fdab543169dffb7a14/`.
The first probe `dee447f0bf1c8ecc98f1e9bb` failed on duplicate CLI config before
rendered test execution; preserve it as a harness failure, not assertion proof.
Current code is locally wired, not a green full gate or hosted promotion.
Typecheck, scoped zero-warning lint, formatting, impact validation and diff
checks pass. The touched workflow test had 21 existing floating-test-promise
warnings; marking test registration with `void` preserves behavior and removes
those warnings. Workflow bytes differ from HEAD only by the two component-step
lines; trust/status/job/checkout/action/permission/gate bytes are unchanged.
Private scoped final receipt:
`.qa/artifacts/testing-modernization/2026-09-29-component-ci/receipt.private.json`.

No product/API/auth/localization behavior changes, so FR/BR/UC/AC/copy need no
update. Native app/helper/governing inputs remain frozen during live run.

### T13-B owned command terminal execution record (work card)

Previous turn: progress (public preflight, real receipt/cancellation controls,
qualified historical iOS inventory). Next unit reuses `owned-native-command.ts`
and `owned-process-group.ts`; no competing process lifecycle or shell runner.
Add typed wait outcomes and a terminal wrapper that always attempts strict
cleanup after acquisition, retains raw child code/signal and separates cleanup
failure from execution status. Invalid deadlines/pre-aborted requests must not
spawn. Acquisition failure with unknown ownership must not claim no acquisition
or successful cleanup. Exit-zero commands establish engine completion only,
never UI/API/SQL assertions or a native passing case.

Validate actual directly spawned Node processes for success, exact exit 7,
deadline, both cancellation signals and owned descendant cleanup. Independently
check process groups absent and unrelated owned test control remains alive.
Preserve immutable logs/ownership files, bounded waits and recovery on failure.
Public engine/build/reset/verification wiring and both-platform native smoke
remain Pending. This infrastructure adds no product/auth/locale behavior.
Private final scoped receipt:
`.qa/artifacts/testing-modernization/2026-09-29-owned-command-terminal/receipt.private.json`.

Local verification: six command lifecycle tests pass. Real signal subprocesses
preserve wrapper exits 130/143 and report cancelled execution, terminated engine
and cleaned owned groups; external `ps` census finds both engine/wrapper groups
absent. Related ownership/preflight suite passes 18 tests; typecheck and scoped
lint (zero warnings) pass. The first signal fixture failed at module import
before READY/acquisition (5/6); the corrected CJS wrapper passes. Failed fixture
is retained in private temporary storage. A synthetic stop-rejection control
preserves child exit 7 and records failed cleanup; it does not certify an actual
Gradle daemon or ownership-mismatch recovery. Native engine adapters are unwired.

Fresh next T12 packet: iOS `training-discard` after the earlier failed navigation
and the now-reviewed SC-208 save navigation repair. Fresh build (no failed or
stale binary reuse), normal draft preparation, actual discard/cancel/confirm UI
and unchanged scoped SQL. Before starting, inspect native competitors and use
the existing host lock. Bound `owned-native-command.ts` in the capture helper
identity (18 helpers rather than 17) to cover its runtime dependency. Run
`ab15e97b3b5358a1e8cb44b7`, exec session `8074`, terminated exit 0: fresh
build, draft, discard prompt, Keep editing, repeated prompt, confirmed library
and fresh empty builder. App/source and all 18 helper hashes stayed unchanged;
Foreign Gradle daemon PID 14235 was observed and neither adopted nor altered.
App/build/package/helpers/governing native inputs were frozen until terminal.
External cleanup passes all 43 PID/start pairs, simulator/cache/Docker absence
and prior-device states. Reviewed nine unique views and four auxiliary frames
qualified under suffix `cde9e1daca0c`; zero transition/behavior passes. The first
builder frame contains an OS keyboard tutorial and is excluded from selected
normal views; the later draft and empty-builder frames are unobstructed.
Real evidence controls reject altered review/cleanup, foreign seeded identity,
lost quantity, extra POST, changed SQL and unreviewed copied auxiliary frames;
positive checks before/after and original bytes remain unchanged. Private
controls: `.qa/artifacts/testing-modernization/2026-09-29-discard-qualified/controls.private.json`.
Governing evidence notes may now refresh and original evidence may requalify
against current doc revisions without changing observed bytes. The refreshed
current-doc qualification has suffix `3f97d20af46d`; the earlier `cde9e1daca0c`
receipt remains historical and unchanged. Runtime inventory qualification remains separate from T14/T15 behavior/comparison.

### Fresh iOS save/retry observation and qualification repair

Run `936d19c5d4fc1d6f0d18bfee` terminated exit 0 with unchanged app/source
and 17 helper hashes. Reviewed error, retained draft, retry library and reopened
frames show the requested behavior. Independent cleanup verified 41 PID/start
pairs absent, owned simulator/cache/Docker absent and prior device states
preserved. This remains raw inventory evidence, zero behavior passes.

Qualification rejected `build.reusedFrom=null`: the validator wrongly routed a
fresh build through a prior-run-only identifier. Resolve null to this capture's
owned run ID, preserving all existing binary/config/bootstrap/source/private
entry-review and cleanup checks. Do not accept malformed non-null IDs. Review
and write the private entry qualification before importing the nine views.
The next rejection exposed a pre-existing transport expectation error:
`plans-store.ts:saveTrainingPlanWithSessionsAction` normally creates via POST,
then calls `updateTrainingPlanWithSessions` (PATCH created detail), then GET.
Require exactly one native forwarded PATCH 200 to that created ID, after the
successful POST and before the first created-detail GET; all prior-plan detail
mutations, extra patches/deletes/posts and wrong target/status/order remain
rejected. Four SQL snapshots must still prove one exact plan and unchanged
prior records. This changes test qualification, not product behavior.
T12 full scope and T14/T15 behavior/comparison remain Pending.

### T13-A public wrapper preflight/blocked receipts work card

- Fresh iOS control `936d19c5d4fc1d6f0d18bfee` terminated before package
  or governing-doc mutation. Nine unique views qualified under private suffix
  `f1ebcebf9b35`, zero behavior/transition passes. Real-evidence controls passed
  before/after eight negative variants without changing original capture bytes.
  Later alias/docs changes invalidate current-source acceptance; preserve the
  exact historical receipt and fresh-build fingerprints.
- Substitute `run-native-pilot.ts` for the plan's proposed `.mjs` path, using
  the existing tsx runtime. Reuse `native-pilot-contract.ts`, native inventory
  and public-receipt V1. Extract the existing browser repository identity into
  a shared module; preserve its behavior and do not duplicate DB ownership.
- Scope: strict real argv/selection, no-acquisition prerequisite rejection,
  redacted schema-valid immutable receipt, exact dirty client/server identity,
  unknown fingerprints represented as null, exit 2 and zero native passes.
  No public action runner, engine adapter or behavior verification is implied.
- Missing canonical assertion ledger or engine/build execution adapter blocks
  before native/backend acquisition. Invalid input is not echoed or saved in
  a public receipt. Receipt writes are exclusive under a fresh private root.
  Test actual subprocess exit and output receipt, both engines/platforms,
  invalid/secret-bearing argv and canonical missing-ledger rejection. Test
  shared repository identity against actual disposable Git fixtures.
- Public alias `yarn test:e2e:native:pilot` now exists with preflight-only
  behavior. Actual alias run `ab96c53f41f833a4dc4e005a` exits 2 with
  `missing-assertion-ledger`, valid receipt and no resources acquired.
  SIGINT/SIGTERM subprocess controls pass at exits 130/143; each test has a
  30-second watchdog that may kill only its own child. Repository identity
  extraction preserves browser behavior; the browser invalid-selection probe
  `fe6e00e8ee28f0d165498864` retained its blocked/no-acquisition contract.
- T13 owned runtime lifecycle and real smoke, T14 shared ledgers/engine flows,
  T15 comparison remain Pending. Full native deadline/signal/Gradle-descendant
  proof is not supplied by preflight cancellation. Product/auth/localization
  contracts are unchanged; FR/BR/UC/AC/copy require no new behavior update.
  Canonical ledgers must be added under T14, with existing selection tests
  checking missing-ledger rejection through a cloned declaration.
- Focused/related checks pass 22 tests; typecheck and touched lint pass.
  Current inventory contains 322 test files. Impact validation passes 12 features,
  43 suites and 62 UI specs; canonical native declaration/schema validation
  passes with zero behavioral passes. Inventory freshness and diff checks pass.
  No full unit or native matrix claim: known auth baseline remains unresolved.
  Private final scope receipt:
  `.qa/artifacts/testing-modernization/2026-09-29-native-preflight/receipt.private.json`.

### T13-A argument/selection/completion contracts: locally verified preparation

- Prerequisite: the handoff dispatch table permits independent argument,
  selection and receipt preparation while native runtime is unavailable.
  Current foreign iPhone 17-Detox remains Booted; do not acquire/alter it.
  Reuse canonical `docs/qa/native-pilot/inventory.json`, its vendored validator,
  `schema-validation.ts` and public-receipt V1. No second scenario registry.
- Implemented `scripts/testing/native-pilot-contract.ts` plus a focused CI test.
  This is a shared contract module for the later public wrapper, not a package
  alias or executable native runner. Its contract preparation predates the preflight alias above; runtime execution remains unwired.
- Required parser: exactly platform/engine/scenario/mode, strict enums,
  no unknown, empty, duplicate, extra or malformed arguments. Selection must
  match one canonical platform scenario and its complete declared flow.
- Canonical scenario metadata may supply `pilotAssertions`: unique required
  assertion IDs, requirement references and evidence kinds ui/api/sql. Missing
  or empty ledgers block completion; T14 must populate the actual shared ledger
  before implementing either engine. Inventory states never imply execution.
- Completion contract: exact run/attempt/platform/engine/scenario/data mode,
  exact requested/executed attempt, all core assertions passed with matching
  requirement references and nonempty existing artifact files, matching runtime
  fingerprints/target, engine child exit 0 and successful owned cleanup. Reuse
  public schema/private-data/path guards. Synthetic validator proof cannot
  establish actual native UI/API/SQL truth or resource absence.
- Validate rejected selections, missing/duplicate/skipped assertions, foreign
  identities/fingerprints, malformed or escaped evidence and failed cleanup.
  Record positive synthetic control separately; T13 real smoke/lifecycle and
  T14 ledgers/engines remain Pending. Product FR/BR/UC/copy unchanged.

- Focused three tests pass with 40 canonical selection cells and eight synthetic
  completion controls across platform/engine/mode. Related schema/inventory
  contracts passed 11 tests in the preceding revision; final focused checks,
  typecheck and touched lint (zero warnings) pass after expanded controls.
  Negative cases include missing/skipped/duplicate proof, false child/cleanup
  success, stale sources, wrong fingerprints/identity and empty/noncanonical
  artifacts. Existing public-receipt V1 is reused without weakening its schema.
- Private final receipt:
  `.qa/artifacts/testing-modernization/2026-09-29-native-runner-contract/receipt-v2.private.json`.
  The prior contract receipt remains unchanged. Neither receipt contains a
  native behavioral pass. The real shared assertion ledgers and runtime
  action/API/SQL/cleanup verifiers are still required before the wrapper can
  publish a pass; this module alone checks identity/completeness.
- Live foreign Detox process PID 53420, start Tue Sep 29 06:56:03 2026, was
  independently rechecked with the same start identity and `detox test`
  command. Booted device state alone was not used as proof of ongoing work.
  Next: revalidate host availability for the fresh revised T12 save/retry
  control; continue T13 public receipt producer/preflight adapter preparation
  independently. No foreign resource adoption or termination.

### T12 save/retry fresh control: native failure retained, delayed-commit repair

- Fresh source-pinned capture `62b4fa091ff16a2bafa66208` is terminal exit 2.
  Build succeeded and normal sign-in/catalog/draft preparation completed.
  One injected native POST returned 503; the failed-save SQL equals baseline.
  The retained draft remains editable with exact name, Strength session and
  exercise quantity 3x8. Normal retry POST returned 201, but the library
  assertion failed with an actual Discard changes dialog. The first guard
  repair is insufficient; its nine-case component suite missed delayed
  router delivery across a committed intermediate dirty state.
- The new on-failure SQL snapshot records exactly one created predefined
  plan with the expected exercise/quantity; previous plans and connections
  remain unchanged. It supplies durable save evidence, not successful
  navigation or reopen. Source and all 17 helpers stayed unchanged; owned
  simulator was Booted and available at failure. No partial qualification.
- The thirty-five-minute lifecycle budget prevented the earlier ten-minute
  backend expiry: server `e3ddc83b195d4fd6394df552` exited 0, cleaned, after
  13m35s. This does not turn the failed UI packet into a passing capture.
- Capture cleanup retains `foreign-ios-state-changed`. Independent external
  proof finds all 38 known process/start pairs absent, owned simulator/cache/
  Docker absent, but prior device `36CE87B2-3068-4855-AC8A-3FBF69EB5F55` is
  missing. Its cause is unknown; cleanup fails. Do not restore or delete a
  foreign target, waive the difference or claim whole-run cleanup success.
- Read actual save/store reconciliation: the successful server response
  assigns canonical session/item IDs. The screen previously reconciled
  those snapshots after the form success callback requested navigation;
  intervening commits could re-arm the guard for the saved draft. Now adopt
  both canonical snapshots before success navigation, and hold the guard
  clean until its queued clean state commits. Subsequent edits still re-arm.
  SC-208 and TC-002 describe the delayed-delivery regression; existing domain
  rules, server routes, localization and auth contracts remain unchanged.
- Added a rendered delayed-removal regression in all three locales. Against
  the previous guard it fails 3 cases while 9 existing cases pass. Full updated
  component suite passes 41/41 in five suites; plan logic/ownership/source
  checks pass 41/41. Typecheck and touched helper/test lint pass with zero
  warnings. The screen has zero errors and 32 existing warnings (HEAD 50);
  broad lint/unit baselines are not represented as green. Controlled mutation
  receipt `.qa/artifacts/testing-modernization/2026-09-29-save-navigation/deferred-control/receipt.private.json`
  preserves previous guard hash, 3 failed/9 passed, exact restoration and
  revised 12/12 pass. Inventory completeness is 320 files; impact, formatting,
  declaration/manifest and whitespace checks pass. T12–T20 remain incomplete.
- The current foreign `iPhone 17-Detox` is Booted, so do not start a competing
  native control now. Leave it untouched; once the host is free, run exactly
  one fresh source-pinned save/retry control with the revised guard/snapshot
  ordering, then independently verify cleanup and inspect all actual frames.
  A failed-build reuse shortcut or dismissing the discard dialog is forbidden.
- Save/retry qualification guards are implemented independently: exact
  capture identity, four scoped SQL snapshots, actual OS error/draft/library/
  reopen trees, individually reviewed hashed frames and native request order.
  Synthetic altered evidence is rejected; these tests supply no device pass.
  Never qualify either failed native packet or reuse its failed build.

### SC-208 successful-save navigation regression: locally verified, native control blocked

- Previous goal turn made progress: actual native failure/retained-draft
  evidence exposes successful-save navigation blocked by the discard guard.
  Read SC-208, UC-002.7, TC-278/TC-303/TC-304 in TC-002, AC-208/AC-223,
  BR-293/BR-294, the current form hook and native beforeRemove path.
- Scope: extract the training builder's removal guard into a rendered-testable
  hook, preserve localized dialog behavior, and synchronously mark clean only
  after successful save or confirmed discard before navigation dispatch.
  Failure keeps the draft/guard; subsequent edits re-arm it. No auth, provider,
  backend or new copy. Update SC-208, TC-002 and this card for this bug repair;
  existing FR/BR/UC/AC meanings are preserved, with no new business rule.
- Required evidence: rendered synchronous removal regression (detecting the
  old behavior), failed save/Keep editing/confirmed discard/new edit controls,
  unsubscribe cleanup, component suite, type/lint and fresh native retry.
  Native runtime inputs change; do not reuse a stale binary receipt as proof.
  T12 qualification, T14 behavior and full plan remain separate gates.
- Implemented `usePlanExitGuard` in the actual SC-208 builder. Successful Save
  signals clean synchronously before navigation; confirmed discard does so
  before dispatch; each committed render restores current edit protection.
  The existing localized dialog is unchanged.
- Rendered controlled old-closure regression fails 6 cases and passes 3; exact
  source restoration then passes all 9. Receipt:
  `.qa/artifacts/testing-modernization/2026-09-29-save-navigation/092414/receipt.private.json`.
  Full component suite passes 38/38 in five suites. Typecheck passes; new hook
  and tests pass lint with zero warnings. Screen lint has 36 existing warnings versus
  HEAD's 50, with no added rule/message counts; these are not waived as a full
  lint pass. Native control requires a fresh build because app source changed.

- Fresh rebuilt control `ae8b7a6125734812c59f1b7e` compiles successfully, reaches
  normal native sign-in/library/builder/session/search, then is terminal exit 2
  before Save. Catalog POSTs fail upstream ownership with 503. The failed frame
  shows search error/retry. Simulator is Booted/available; source and all 17
  helpers stay unchanged. Native confirmation of the repair remains pending.
- Backend `c7eb47a526f18f451b725ee0/session-receipt.json` records timeout,
  cleaned, exit 2: started 09:26:09.727Z and ended 09:36:10.418Z. The capture
  inherited its ten-minute default despite a fifteen-minute build step plus
  UI steps. Capture retains backend-stop failure; external cleanup proves all
  31 process/start pairs and owned simulator/cache/Docker absent, prior states
  preserved. No partial packet or failed binary is promoted/reused.
- Added a recorded iOS budget: fifteen minutes build, fifteen observations,
  five cleanup reserve, thirty-five overall. Backend receives the explicit
  total; capture has whole-run/observation deadlines and timeout-stage records.
  Build/per-command/API bounds and assertions are unchanged. Budget validation
  rejects invalid values or totals beyond the backend protocol cap. This is
  based on the actual timeout receipt, not an unexplained retry extension.
  Fresh proof of this budget and repaired native save navigation is pending.
- Existing plan logic/ownership/server-source checks pass 41/41. Eight focused
  observer/ownership/preflight/budget checks pass without skips. Next: one
  fresh source-pinned native control with the corrected lifecycle budget, then
  strict review/qualification. Preserve both native failures and the rendered
  negative/control pair. T12–T20 and the full plan remain incomplete.

### T12 iOS native save/retry observation: implemented, runtime failed

- Reuse normal coach/catalog draft preparation, the verified in-process fault
  adapter and owned iOS capture/health checks. Read SC-208, TC-278 in TC-002,
  BR-293/BR-294 and the plan's save-retry contract. Native save errors use the
  existing OS alert, then retain the editable draft; normal retry creates one
  exact plan. No product/copy/auth/provider behavior change.
- Acceptance: one injected POST before forwarding; unchanged scoped SQL after
  failure; actual error and retained name/session/quantity with enabled Save;
  normal retry and exact one new owned plan; reopen normal saved row and verify
  values; preserve prior plans/connections and original failures/cleanup.
  Raw observations supply zero qualified behavioral passes until independent
  review and strict qualification. Run one bounded fresh iOS control with the
  newly added device health diagnostics; no unchanged failed-flow replay.
- Correction after reading TC-002 fully: TC-303/TC-304 there are valid training
  local-draft/discard cases; other documents reuse those IDs for billing,
  privacy and support. The earlier claim that training metadata was invalid
  was incorrect. Qualify references by authoritative document path before
  final traceability acceptance; do not invalidate actual observations solely
  because a different document reused the same ID.
- Fresh capture `5e55dbe5ec63a53884562845` is terminal exit 2. Normal draft
  preparation and the actual error/retained-draft frames pass their capture
  assertions. Exact one injected native POST returns 503; SQL after failure
  equals before; the retained name/session/quantity and enabled Save checks
  pass. Normal retry forwards and returns 201, but the library assertion fails.
  Its screenshot shows the existing Discard changes dialog over the builder.
  Do not dismiss it, weaken navigation acceptance or qualify a partial packet.
- Owned simulator is Booted/available at failure. Source and all 17 helpers
  match before/after. Independent `external-cleanup.private.json` passes:
  40 process/start pairs absent; owned simulator/cache/Docker absent; prior
  device states preserved. Unlike the earlier shutdown failure, this failure
  has actual save-success transport and a live target with blocked navigation.
- Source inspection: `usePlanForm` and SC-208's `onSuccess` enqueue dirty and
  session snapshot updates, then immediately call `router.replace`; the native
  beforeRemove listener closes over the prior `hasUnsavedChanges`. This is the
  next suspected cause to reproduce with a rendered regression and control;
  one run does not satisfy T16's two fresh reproductions/control requirement.
  Retry SQL after success and reopen remain unproved because the observation
  failed before those snapshots. HTTP 201 alone is not durable retry acceptance.
- Added bounded best-effort failure SQL capture before teardown for future
  runs, preserving the original error. This addition is not exercised by the
  preserved failed packet. Seven focused observer/ownership/preflight tests,
  typecheck, touched lint and inventory/impact checks pass. No product/auth/copy
  change; T12 qualification and T13–T20 remain pending. Next: reproduce and
  repair the documented successful-save dirty-state navigation path, then run
  a fresh detecting native control and strict evidence qualification.

### T12 native save-fault adapter: locally verified preparation

- Scope: test-only `owned-api-proxy.ts` and its explicit disposable-backend
  verifier. Read the specification's private fault/resource contracts,
  handoff Section 0, existing proxy controls and ancestor evidence rules.
  Reuse normal native-profile bearer traffic; no application/server auth,
  provider, product copy or locale changes. Existing session decision remains
  outside this packet.
- Acceptance: reject browser profile, absent/unsuccessful/wrong-origin catalog
  observation, wrong account and unsupported path; bind to current owned API
  identity; inject one exact matching save before forwarding; unrelated
  requests do not consume it; real retry succeeds. Clear in-memory observation
  on API restart and stop. No tokens in public observations/receipts.
- Verification planned: existing actual disposable Postgres/API verifier,
  focused proxy boundary checks, typecheck and touched lint/formatting.
  Adapter proof is not native-device, draft-retention or retry-view acceptance.
  Revert only this method/capture seam if rejected; retain existing browser
  fault semantics.
- Implemented `armObservedNativeSaveFault` using only successful forwarded
  no-Origin catalog traffic. Observed credentials remain private in memory,
  bound to upstream origin/PID, and are cleared on restart/stop. Account and
  current API ownership are verified before arming; no auth behavior changed.
- `node --import tsx scripts/testing/verify-owned-api-proxy.ts` passes two fresh
  disposable-backend runs in each of two verification batches. Final batch:
  `.qa/artifacts/testing-modernization/2026-09-28-p3/proxy-2026-09-29T09-03-17-310Z/receipt.json`.
  Both attempts reject absent, browser-origin, query-variant and unsuccessful
  catalog preparation, browser profile, wrong account, unsupported path,
  duplicate attempt, stopped proxy and stale externally restarted API. A
  normal catalog request after an owned restart permits fresh arming.
- Each final attempt injects exactly one matching save. An unrelated account
  is still denied without consuming it. Retained private SQL before/after the
  failed save is equal; the real retry updates the exact saved plan without
  adding a plan. Existing browser proxy fault/restart/deadline controls pass.
- Independent `external-cleanup.private.json` verifies both final Docker
  projects have no containers/networks/volumes and all 16 recorded API PIDs
  are absent. Snapshot JSON is mode 0600. First batch also independently
  verifies its resources and 12 API PIDs absent. All verifier handles terminal.
- Typecheck and touched lint pass with zero warnings; nine existing worker,
  integration and native preflight tests pass without skips. Test inventory
  checks 317 files; impact validation passes. This packet changes only test
  infrastructure and strategy documentation; FR/BR/UC/product copy/localization
  need no update. The existing full-unit auth-route mismatch is not resolved
  or waived by these focused checks.
- Remaining: wire the adapter into an actual declared native failure/retry
  charter, qualify visible retained draft/retry states on both platforms and
  recheck affected capture helper fingerprints. This adapter adds zero native
  behavior passes. T12 and all T13–T20 completion gates remain pending.

### T12 iOS discard preparation and simulator diagnostic gap

- Added `training-discard`, reusing normal training-draft preparation and a
  separate discard observer. Intended observations: actual discard dialog,
  Keep editing with the editable name and exact exercise quantity inside the
  expected Strength session, reopen/confirm discard, expected library and a
  fresh empty builder with Save disabled. All domain SQL must stay unchanged;
  no plan write is permitted. This changes test infrastructure only.
- Strict qualification keeps unique view counts. Four additional reviewed
  frames use explicit path/view tuples, screenshot/tree hashes and auxiliary
  receipt indexing; they cannot add duplicate coverage or behavioral passes.
  Missing choices/reviews, foreign or changed SQL, lost/uneditable draft data,
  quantity moved outside the expected session, stale fresh-builder edits,
  wrong library or attempted writes are rejected by synthetic boundary controls.
- Fresh observation `4367d924b280342273035eff` is terminal exit 2, unqualified.
  It reaches the actual exercise-search view, then `exercise-detail` cannot
  find the search input. Its failed frame is the simulator home screen.
  The retained host log, scoped only to owned UDID
  `6EA7AF32-25D1-44C5-9F84-D49B5BA78302`, records domain teardown and a
  not-booted process-spawn failure. No matching app crash report is found;
  cause remains unknown. Do not call this a selector or product regression.
- Source and all 16 capture-helper identities match before/after. External
  cleanup proves 33 recorded process/start pairs absent and owned simulator,
  cache and Docker absent, but does not pass: command-group cleanup retains
  `exercise-detail` failure and prior `BB9CCBAD-28E2-47D7-AB36-5F39E87EB649`
  (`ET-233-AdMob`) changes Booted to Shutdown. No foreign device is restored,
  adopted or signalled. Discard views are not reached or qualified.
- Capture now checks exact owned identity plus Booted/available state before
  and after actions and before screenshots. It records health events and
  failure state before teardown, preserving the original command error.
  Unavailable system diagnostics retain a bounded private error receipt.
  Cleanup ownership still accepts an owned Shutdown device so it can remove
  its own resource safely. These new runtime diagnostics are not yet qualified
  by a successful fresh capture; the failed bundle remains immutable.
- Fifteen focused evidence/inventory/hierarchy/simulator checks pass without
  skips. Typecheck and touched lint pass with no warnings. Runtime discard
  qualification, load/save failure/retry, Android coverage and all T13–T20 gates
  remain pending. No product/FR/BR/UC/copy/localization change is required.
- Next: diagnose host interference using the new owned-device health evidence
  on an explicitly bounded changed-instrumentation control, or advance the
  independent owned proxy fault adapter/public-runner selection contracts.
  Do not replay the unchanged failed flow or qualify its partial observations.

### T12 iOS camera inventory work

- Added a bounded `camera-denied` inventory charter: normal unlinked-student
  sign-in, normal scanner CTA, actual OS denial and manual code entry without
  submission. Read-only app-scoped TCC records and unchanged owned domain SQL
  are required. No product code, auth contract, user copy or localization changes.
- First observation `67951a84d68013203771c761` is terminal exit 2 and remains
  unqualified. It reaches and visually captures the real OS camera prompt with
  no prior app camera decision. The original harness title expectation differs
  from the actual iOS 26.5 title's case and punctuation; corrected to the exact
  observed title for a fresh bounded control, not a relaxed generic Allow check.
- Independent cleanup proves 32 process/start pairs absent, owned simulator,
  cache and Docker resources absent. It fails preservation because pre-existing
  `36CE87B2-3068-4855-AC8A-3FBF69EB5F55` changed Booted to Shutdown. Cause/owner
  remains unknown; no foreign simulator is restored, adopted or signalled.
- Evidence qualification rejects wrong app/device permission records, preexisting
  grants/denials, granted or ambiguous final state, unavailable-camera copy in
  place of denial, guidance bound to a different node, disabled/wrong manual
  input, disabled Connect, open scanner, changed/foreign/linked SQL and missing
  native reads or invite mutation. Synthetic controls supply no native passes.
- Fresh title-corrected control `c18950c7bd6cfc7e81c9172d` is terminal exit 0,
  observed and cleaned. Seven actual frames are visually reviewed. Read-only
  camera permission changes from no decision to user-set denial; exact guidance
  appears, and the actual input contains `QA-MANUAL-ONLY` with Connect enabled.
  No code is submitted. Scoped SQL is unchanged and normal native reads/sign-in
  succeed. Source and all 15 helper identities match before/after.
- Independent cleanup passes: all 29 process/start pairs absent, owned
  simulator/cache/Docker absent, all prior iOS states preserved. Qualification
  supplies six iOS views, zero transitions and zero behavior passes. The earlier
  failed packet is preserved; Android permission, other locales and the full
  native behavioral journey remain pending. T12 and T13–T20 remain incomplete.
- Twelve focused camera/connection/view/inventory/hierarchy checks pass without
  skips. Typecheck, touched lint (zero warnings), touched formatting, whitespace,
  test inventory (316 files: 254 client/62 server) and impact validation pass.
  No product behavior or FR/BR/UC/localization update is needed. The full unit
  gate's existing password-reset-confirm route mismatch remains unresolved.
- Initial qualification selection includes two relationship frames and is
  correctly rejected by the existing unique-view rule. The full seven-frame
  review is preserved as `reviewed-all-frames.private.json`; the selected
  receipt indexes six unique IDs using the populated manual frame. The raw
  capture and all original screenshots/trees remain unchanged.
- Ten actual-record rejection controls pass with positive validation before
  and after and exact original bytes restored. The private control script and
  `camera-rejection-controls.private.json` remain in the successful bundle.
  These controls exercise the evidence boundary and are not native attempts.
- Final source-reference refresh qualifies the successful camera packet with
  suffix `6b54e66e3159`; initial `cb3fac8e06b3` is historical. Refreshed earlier
  successful packets: iOS connection `03c0d404fc65`, iOS training `7367a72051c0`,
  Android training `6456f4fd7b40`, iOS auth/account `d3c1e3026c25`. Each suffix
  names the new immutable qualified-views, observed-inventory and view-metrics
  files within its original capture directory. Earlier receipts remain retained.
- Next eligible independent packets: iOS training discard/error/retry views and
  Android camera permission profile/observation. Android Account-tab diagnosis
  stays open; do not repeat its unchanged failed action or hide the warning
  overlay. The native logout/revocation decision remains pending. All later
  public-runner, both-engine journey, adoption, exploration and hosted gates
  remain required; no Detox retirement or CI promotion is authorized by these
  view observations.

## Goal and non-goals

Implement [the full testing plan](../plans/2026-09-28-testing-structure-and-maestro-plan.md), preserving its phase gates. No production APIs, schema migrations, providers, signing, React/Expo upgrade, schedules, or bulk test deletion.

## Affected surfaces and kickoff

| Surface                    | Owner/files                                                  | Contract                                                  |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- |
| Client tests               | scripts/testing, tests/component, Playwright, .maestro       | Behavior/fixture/native proof separated                   |
| Server tests/data          | server/tests, scripts/testing, infra/docker-compose.test.yml | Owned disposable Postgres only                            |
| CI                         | Both owners' workflows/selection                             | After prerequisite phase evidence; stable gates preserved |
| Docs                       | testing strategy/inventory, discovery, specs, QA adapter     | Current/proposed/pending distinguished                    |
| Product/external providers | Existing app/server routes                                   | No behavior changes or external mutations                 |

Consulted: client/ancestor AGENTS; evidence-delivery workflow/template/project adapter; plan; backlog, decisions, open questions, wiring, backend migration; selective execution, browser batches, QA registry/playbook/gap sweep; tech-stack; QA adapter; server README/config/schema/migrations/Postgres tests. Domain references remain authoritative; individual journey docs will be reread before each assertion implementation.

Contradiction resolved: checked-in trusted CI is web-only, without a schedule; protected Detox additionally runs release/hotfix pushes. Earlier broad-native/scheduled prose is corrected without declaring D-195 promotion. The evidence adapter's retired provider prose does not supersede the server baseline.

Dirty checkout: preserve existing client changes and server untracked docs. Additive test infrastructure is implemented in the current owner checkouts, with no resets, branch changes, commits, or pushes. Phase reports record exact SHAs and dirty state; isolate runtime resources independently of checkout.

## Acceptance matrix

| ID  | Expected behavior                                                                 | Evidence required                                                   | Status                                                 |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| P0  | Every client/server test has assertion purposes, disposition, traceability status | Regenerated AST inventory and completeness check                    | Locally verified inventory; baseline failures recorded |
| P1A | All DB test entrypoints reject defaults/unowned targets before SQL mutation       | Guard negatives, direct invocation rejection, real isolated DB runs | Locally verified                                       |
| P1B | Durable ownership/connection/persistence outcomes through real server             | DB/API assertions, restart/reset/concurrency receipts               | Locally verified; P0/P1 report                         |
| P2  | Rendered support/role/search/theme interactions                                   | Component runs and deliberate regression failure                    | Locally verified; baseline route gap and CI pending    |
| P3  | Equivalent browser profiles and real DB journeys                                  | Alias/profile and integration receipts                              | Locally verified; two complete 45-case matrices pass   |
| P4  | Both native engines compared per scenario/platform/mode                           | 20 cold attempts per cell, regression and cleanup evidence          | Pending                                                |
| P5  | Bounded observed exploration and regression conversion                            | Actions, two reproductions/control, deterministic regression        | Pending                                                |
| P6  | Applicable exact-head hosted gates and safe scenario migration                    | Protected receipts, selection tests, migration ledger               | Pending                                                |

## Edge cases and review

Missing URL/manifest, shared/remote DB, marker mismatch, stale ownership, concurrent runs, child failure, SIGINT/SIGTERM, cleanup failure, bypass flags, wrong origin, missing requested scenario, expired auth, localized selectors and retry semantics require explicit tests/evidence in their phases. Do not introduce implicit retries. Keep diagnostics and ownership on failed cleanup. Rollback retains existing runners/aliases/Detox and never alters auth/persistence expectations to pass tests.

## Evidence report

### 2026-09-29 T12-B iOS connection observation and strict qualification

Second attempt `8e7d11ccd547acf586275cf4` is terminal exit 0, `observed`,
with cleaned capture teardown. Independent cleanup passes for all 50 owned
process/start pairs; owned simulator, cache and Docker are absent and all
prior iOS states are preserved. App and 14 capture-helper identities match
before/after. Ten selected actual frames have been visually reviewed, including
pending queue, both roster identities, student home/relationship entry and
separate pending guidance/active end-action views. Scoped SQL is unchanged.

The strict validator now rejects wrong platform/run/seed identity/status,
mixed coach/student identities, malformed UUIDs, changed SQL, pending guidance
on a different node, premature end action, active views containing pending
state, missing normal native multi-account reads and incomplete reviewed
state frames. Connection receipts link the existing session/connection scenario
IDs without creating transition or behavior passes. Focused synthetic evidence,
hierarchy/inventory tests pass 11/11; typecheck and touched-file lint pass.
Actual receipt qualification passes for 10/21 iOS views, 0/34 transitions
and 0/5 iOS journey scenarios. Ten actual-receipt rejection controls pass,
with positive qualification before/after and every original byte restored.
Private receipt bundle: `.qa/artifacts/native-pilot/8e7d11ccd547acf586275cf4/`;
the `connection-qualification-rejection-control.private.json` record distinguishes
validator controls from native behavior passes. Preserve the first failed
cleanup attempt and its evidence. Retained iOS training, Android training and
iOS auth/account packets also requalify under the updated guard; retain all
historical receipts and use the latest current fingerprints.

Fresh full client unit gate runs 1,721 tests: 1,720 pass, one fails because
`features/auth/account-auth-source.ts` calls `/auth/password-reset/confirm`
but the server does not register that route. This is the already recorded
contract gap, not a newly accepted baseline or a green full gate. Preserve
`client-unit.private.log`; no undocumented auth route or skip is added.

No product/API/schema/auth/provider/signing/copy changes. Native local sign-out
is used only for normal account switching; server revocation remains unresolved.
Android connection observation, permission/error/retry/discard/locales, T13
public runner, T14 journey proof and later comparison/CI gates remain pending.

### 2026-09-29 T12-B Android connection-state kickoff

Reuse the same governing connection documents, shared seeded-state observer,
normal sign-in/account/sign-out routes and read-only SQL contract on a fresh
owned Android target. Extend the existing Android capture charter and helper
identity list; keep emulator/ADB/port/Gradle/Expo ownership and cleanup guards.
Inspect the actual confirmation button (`signOutConfirmCta`) separately from
the confirmation container. Required core assertions remain mandatory.
Fourteen focused evidence/build/hierarchy/ownership tests pass, and typecheck
plus touched-file lint pass before capture. Never infer Android state attributes
from the iOS receipt or use coordinates/index action fallbacks.

This packet can qualify inventory views only after actual frame review,
matching input/SQL evidence and independent cleanup. No invite approval,
end-connection, server revocation or locale variant is under test. Preserve
each failure as a separate attempt and stop a repeated unchanged branch.

First Android attempt `fedc5bf8c1748dd86d68df8b` exits 2 with clean teardown:
the pending page root is visible, but the compact viewport shows only the top
of its request card and the actual tree lacks the exact connection UUID.
Capture inputs match. Independent cleanup passes for 50 process/start pairs,
including the captured single-use Gradle daemon identity bound to its log's
start timestamp; all six directories, cache and owned Docker are gone, prior
iOS states and the workspace APK are preserved. No views are qualified.
Preserve the failure and actual screenshot. The narrow Android-only observer
change scrolls normally to the exact seeded UUID before taking the queue
frame; it retains the exact-identity assertion, deadlines and all ownership
guards. A new fresh attempt tests that diagnosis; no coordinate/index fallback
or product layout change is introduced.

One iOS requalification overlapped a private negative-control snapshot mutation
and correctly rejected the changed scope. The controls restore every byte and
pass positive before/after; sequential requalification then passes. Do not run
receipt writers concurrently with controls that intentionally mutate their
inputs. This is validator orchestration evidence, not a new native attempt.

Second Android attempt `f159d1558b1d8da8bf95eb6f` exposes the exact pending
UUID after the normal scroll, but exits 2 before roster actions: Maestro 2.6.1
reports Android driver startup timeout. Capture source/helpers match and
independent cleanup passes for 61 process/start pairs, including the recorded
single-use Gradle daemon; all owned directories/cache/Docker are gone and
foreign iOS states/workspace APK are preserved. No views qualify. Keep the
native-readiness failure log and final frame. The system diagnostics filtered
to app errors are empty; they do not establish the driver failure's cause.

The queue frame also shows extremely narrow specialty text columns on this
compact target. Record it as a possible layout defect requiring a dedicated
fresh reproduction/control and authoritative responsive expectation in T16/T17;
the exact tree identity is not a visual layout pass. No product layout fix.
Add bounded private system/instrumentation diagnostics only on failed owned
Android captures. One linked fresh attempt may reproduce the driver-start
condition; stop this branch if that unchanged failure repeats. Do not increase
startup deadlines, upgrade the CLI, weaken assertions or silently retry.

Linked diagnostic reproduction `989f9a5f150eaa18a63a75a5` is terminal exit 2
and does not repeat the driver startup failure. Actual queue and roster frames
contain the exact seeded pending UUID and both roster identities. The normal
Account tab tap reports completed, but the required `settings.account.screen`
wait fails and the actual hierarchy stays on the roster. Independent cleanup
passes for 59 process/start pairs, including the captured Gradle daemon; owned
directories/cache/Docker are absent, prior iOS states and the workspace APK
are preserved, and app/helper inputs match. No views qualify.

The failed-command hierarchy records Account tab bounds `[240,592][320,640]`
and a development-warning notification at `[10,568][310,615]`, with an
unlabelled dismiss control. Bootstrap records the existing New Architecture
no-op layout-animation warning. These facts suggest interference but do not
prove it caused the missing navigation. Do not add coordinate/index taps,
suppress warnings, remove the account assertion, rewrite product navigation,
or rerun unchanged. Diagnose a supported normal control or an independently
qualified build before another Android account-switch attempt. Bounded private
system/instrumentation diagnostics are retained; CLI cleanup has removed its
driver packages by diagnostic collection time, so the empty instrumentation
list does not prove their earlier startup state.

Latest scoped typecheck/lint and eight focused evidence/hierarchy tests pass
after the observer changes. The original UI/driver/selection failures remain
separate records. Next eligible independent T12 work: actual iOS permission
prompt/denial/fallback observations; Android account navigation remains open.

### 2026-09-29 Native receipt fingerprint boundary correction

Requalification after a native-report edit exposed an immutable-name collision:
the receipt validator checks every declaration source, but its fingerprint
included only sources of captured views. Android training therefore attempted
to write its already-existing `bc9d4eb5f1f3` output after a checked source changed;
exclusive creation correctly rejected it. No evidence file was overwritten.

The fingerprint now binds every source checked by the validator and the stable
view-to-source mapping. New tests reject unchanged fingerprints when an
uncaptured but checked source revision or that mapping changes. Reinstating the
old subset algorithm temporarily makes the focused regression fail (exit 1);
restoring the exact original source bytes makes the clean control pass (exit 0).
The private `fingerprint-regression-control.private.json` record/logs prove this
validator correction only. Eleven focused tests, typecheck and touched-file
lint pass; regenerate declarations and qualify under the new fingerprints.
This changes no app behavior, scope, native pass count or migration gate.

Final current qualifications after regeneration: iOS connection
`8e7d11ccd547acf586275cf4` → `90921754068a` (10/21 views); iOS training
`9bd10fc1a5245721c89cbbbe` → `14dec3a5d7b8` (8/21); Android training
`490f6fa2de860a638a30b7a2` → `1d90c81f4048` (7/20); iOS account
`0abd8f86290bc99a91d703b1` → `875ec4205e4e` (5/21). Each packet remains
zero transition/behavior passes. Final connection rejection-control receipt
`connection-qualification-rejection-control-90921754068a.private.json`
binds the current fingerprint, rejects ten actual-receipt corruptions, passes
positive before/after and proves every original byte restored. Portable
declaration validation passes with 21 views, 34 transitions, 10 scenarios and
no imported runtime receipts. The regenerated test inventory passes freshness
for 315 files (253 client, 62 server). T12 and the full plan remain incomplete.

### 2026-09-29 T12-B iOS seeded connection-state kickoff

First attempt `6433d627e44811aeeb20d5a3` finishes the UI observations and
matching scoped SQL, but exits 2 because a pre-existing foreign simulator
(`36CE87B2-3068-4855-AC8A-3FBF69EB5F55`, iPhone 17-Detox) changed from Booted
to Shutdown during the run. Capture is `harness-blocked`; no view is qualified.
Independent cleanup confirms all 48 owned process/start pairs, owned simulator,
cache and Docker are gone, but retains the same foreign-state mismatch.
App/helper hashes match; actual screenshots show normal pending queue, both
roster states, student pending guidance and active end action. Preserve those
raw frames and the failed cleanup receipt; they cannot substitute for passing
qualification. The owner/cause of the foreign change is unknown. Never
restore/adopt that device or weaken the prior-state guard to turn this green.

Inspect current host/device state read-only, then allow one fresh attempt after
the overlap has ended. If the same foreign-state block recurs, stop this
unchanged branch and continue independent eligible work. No implicit retry,
deadline increase, process termination or foreign simulator mutation.

Scope: actual normal coach pending queue/roster and separate pending/active
student relationship views on a fresh owned iOS target. Read SC-211,
UC-002.3, FR-120/121, AC-213/214, BR-213 and TC-213/214; inspect normal
home/pending/roster/relationship navigation and the existing server-owned
fixture states. Reuse capture, immutable build guards, backend/proxy/Expo,
simulator/command ownership and normal sign-in/local sign-out controls.

The new private `connection-states` charter uses the existing seeded
pending-student and active-student identities, never submits/confirms/ends a
connection, and requires exact pending ID, both roster identities, real
relationship views and matching read-only SQL before/after. Normal
account switches observe the existing FR-270/BR-342 local clearing scope;
they prove no server revocation. Capture/helper/app inputs must match
before/after, and independent cleanup must preserve prior device states.

Success establishes reviewed inventory views only. Keep all transition and
behavior pass counts at zero; the two-person UI invite/confirmation path
remains T14 work. Qualifier changes require successful actual evidence first.
No product/auth/schema/copy/provider/signing/CI change. Reuse the shared
observation helper for Android later without assuming iOS selectors apply.

### 2026-09-29 T12-B qualified iOS training draft preparation

`9bd10fc1a5245721c89cbbbe` exits 0 after the narrow iOS keyboard interaction
change. Actual reviewed screens include normal sign-in, password-save offer,
coach dashboard, seeded library, session form, search, exact Exercise 1 detail
and populated builder. The final builder frame shows `en QA Exercise 1` and
`3x8`. Normal native sign-in returns 201; catalog POST search and post-confirm
GET detail return 200. Scoped read-only SQL before/after local draft editing
is identical; Save is never tapped. App source and 13 capture-helper identities
match before/after. This establishes inventory preparation, not persistence,
session revocation, transition or journey acceptance.

Independent teardown passes for 31 process/start pairs; owned simulator,
Expo cache and Docker resources are absent, and prior iOS states are preserved.
Strict platform-aware qualification requires the iOS snapshot scope and exact
quantity node's `accessibilityText`, with Android retaining `text`. Both
platforms require normal auth/catalog metadata, unchanged helpers, reviewed
core views/draft and indexed/hash-bound SQL/transport evidence. Historical iOS
account captures retain their original narrower qualification contract.

`node --import tsx scripts/testing/qualify-native-views.ts --run-id=9bd10fc1a5245721c89cbbbe`
passes with suffix `d53c2bd6ec1c`: **iOS 8/21 views**, **0/34 transitions**,
**0/5 behavior cases**. Eight actual-receipt rejection controls pass between
valid positive controls: foreign platform scope, premature SQL, wrong quantity
field, missing detail GET, unproved preparation, changed helpers, failed cleanup
and missing core view. Original bytes are restored; control receipt is
`training-qualification-rejection-control.private.json`. These are validator
controls, not native scenario passes.

Regenerated portable declaration, diagrams, empty Maestro manifest and 314-file
test inventory. Revalidation of retained Android training passes with suffix
`3b1b7d549b14` (**7/20 views**, **0/32 transitions**, **0/5 behavior**); retained
iOS auth/account passes with suffix `7fbfafcd804c` (**5/21 views**, zero
transition/behavior). These are new validations of old evidence, not new native
runs or combined coverage claims. All original failed native attempts remain.

Validation: focused native tests pass 11/11; touched-file lint/format and
typecheck pass; full lint has zero errors and 3043 existing warnings; test-impact
validates 12 features/43 suites/62 UI specs; inventory freshness and
`git diff --check` pass. First full unit run: 1695/1697, including the existing
password-reset route gap and an unexplained auth-file failure with no useful
diagnostic. Focused auth repeat passes 23/23. One full repeat passes 1718/1719,
failing only the known `/auth/password-reset/confirm` registration mismatch.
Both full logs are retained under this run; the first failure is not erased or
given an invented cause. The full unit gate remains failing.

No product behavior, schema, localization, auth, provider, signing or CI change
requires domain-document updates. Testability and handoff report current scope.
T12 remains incomplete: other families, permission/error/retry/discard and locale
observations still need evidence. Continue an eligible remaining T12 packet;
T13–T20 and the owner session-revocation decision remain pending.

### 2026-09-29 T12-B iOS training draft kickoff

Second attempt `34505160fd7826ca797bec23` is terminal with exit 2. It reaches
normal sign-in, password offer, coach home, library, builder, session form and
search. The exercise-result wait fails after query input and `hideKeyboard`.
Actual failure screenshot/tree shows `en QA Exercise 2` already selected,
before the charter's exact Exercise 1 tap. Both normal catalog search requests
return 200. This differs from the first attempt's entry AX failure; its cause
is not established as a product defect. Independent cleanup passes for 29
process/start pairs, owned simulator/cache/Docker and previous iOS states.

Narrow test-interaction change: use `pressKey: enter` on iOS after search and
quantity input, invoking their existing `onSubmitEditing` keyboard-dismissal
handlers. Android keeps its previously executed back-based keyboard dismissal.
[Maestro hideKeyboard](https://docs.maestro.dev/reference/commands-available/hidekeyboard)
documents iOS swipe gestures; the retained failure supports testing this
replacement without proving the gesture's internal cause. Preserve exact
exercise/quantity assertions, deadlines, normal API/SQL checks and all failed
receipts. No app behavior, copy, auth or signing change. A new owned attempt
must validate the replacement; code/static checks alone do not qualify views.

First attempt `35350b8e6755718a4185a578` fails before entry qualification:
Maestro's hierarchy request returns HTTP 500 with
`Error getting element frame kAXErrorInvalidUIElement`. The Java process
remains live until the existing 300-second entry-command deadline; it is
polled through that same handle, then exits 2 after owned cleanup. The verified
owned simulator's diagnostic screenshot shows normal sign-in, but no app view
is formally captured by this attempt. Source and helper inputs are unchanged.
Independent teardown passes for 17 process/start pairs, owned simulator,
Expo cache, Docker resources and previous iOS device states. Preserve original
capture, entry log and diagnostic screenshots; no retry is reported as a
first-attempt pass. [Upstream issue 2570](https://github.com/mobile-dev-inc/Maestro/issues/2570)
reports the same error string; it does not establish this run's cause.

Fix only the three import-order warnings after terminal cleanup, then allow
one further clean attempt with the pinned CLI/build/charter. If the same
entry-driver failure repeats, stop this branch and continue independent
eligible work. No timeout increase, arbitrary sleep, app shortcut, skipped
assertion, driver upgrade or foreign simulator mutation is introduced.

Scope: actual iOS SC-208 library/builder/session/search/detail and populated
local draft on a fresh owned simulator, normal seeded coach sign-in and the
known system password-save offer. Reuse qualified immutable iOS dev binary
`b3dafc28dbcd7f4e873d0d92`, fresh owned backend/Metro/target and shared training
actions extracted from the executed Android charter. Read SC-208/TC-303,
BR-293/BR-294, UC-002.7, existing native requirements and capture/ownership,
builder/SessionCard/modal/catalog code. Preserve all unrelated dirty work.

Acceptance: actual reviewed iOS trees/screens, exact exercise/quantity, both
normal catalog reads, matching scoped SQL before/after without Save, native
source/helper/build identity, independent process/cache/Docker/target cleanup
and all previous iOS device states preserved. Canonicalize actual Maestro
hierarchies through the existing parser; do not use substring matches as
selector proof. Android actions keep their tested assertion sequence; only
snapshot scope/quantity attribute differ by platform. Capture-helper hashes
must match before/after. This is T12 preparation with zero behavior/transition
passes; no product/auth/provider/copy/signing/CI change, no session-revocation
decision or durable-save claim. Extend iOS qualification only after actual
observations are reviewed.

### 2026-09-29 T12-B qualified Android training draft preparation

`490f6fa2de860a638a30b7a2` completes the private `training-draft` capture with
exit 0. Fresh devDebug APK build succeeds (398 executed tasks); APK hash
`4c78a43fe0022d7e39a0a003cdd95a9c7c6914c0d786b6d3d06b96440574e56f`.
Actual build/installed/config/network checks and normal native sign-in pass;
source/helper identities are equal before/after. Normal dashboard Training
plans CTA reaches the seeded library; new builder, session form, search,
exact exercise detail and populated draft are captured. Reviewed draft shows
`en QA Exercise 1` and `3x8`. Normal authenticated search POST and post-confirm
detail GET return 200. Schema-valid scoped owned SQL snapshots are identical
before/after edits without Save, satisfying the inventory preparation contract
under SC-208/TC-303/BR-293/BR-294/UC-002.7, not durable-save acceptance.

External teardown passes for 91 process/start identities, six owned Android
directories, Expo cache and Docker resources; prior iOS states and workspace
APK remain unchanged. Private capture/external cleanup, reviewed-view hashes,
catalog metadata and both SQL snapshots remain under that run root.

Extended the existing view qualifier with five actually observed training
selectors and the exact `training-draft` boundary. It requires seven reviewed
views including the populated builder, exact item quantity, real normal
catalog metadata and both matching schema-valid owned SQL snapshots. Those
snapshots are indexed and hashed in the receipt. Failed cleanup, premature
SQL, wrong run/scope, missing reads or unproved preparation cannot qualify.
No transition/behavior validation guard was removed. Qualification command:
`node --import tsx scripts/testing/qualify-native-views.ts --run-id=490f6fa2de860a638a30b7a2`
passes with suffix `483406642862`: **Android 7/20 views**, **0/32 transitions**,
**0/5 behavior cases**. Six actual-receipt rejection controls pass between
valid positive controls; original private bytes are restored. Receipt:
`training-qualification-rejection-control.private.json` (six controls,
positive-before/after; not native scenario passes).

Refreshed declaration/diagrams/empty Maestro manifest and the 314-file test
inventory (252 client, 62 server), preserving every denominator and untested
cell. Requalified the retained iOS auth/account capture
`0abd8f86290bc99a91d703b1` against current validator/declaration, suffix
`902354398b44`: **iOS 5/21 views**, **0/34 transitions**, **0/5 behavior cases**.
This is new validation of existing immutable evidence, not a new iOS run.

Focused native evidence/inventory/APK/hierarchy checks pass 11/11; the new
synthetic boundary test exercises snapshot identity/schema/equality, exact
quantity and both normal reads without claiming device execution. Touched
Prettier/ESLint, typecheck, inventory completeness, test-impact validation and
`git diff --check` pass. Existing full-unit/auth-route and TC-304.1 gaps are
not waived or retested by these scoped checks. Testability docs record the
actual preparation; product FR/UC/AC/copy/API/auth/signing/provider behavior
is unchanged, so no behavior/localization update is required.

Next eligible unit: iOS training observation and remaining T12 connection,
permission and error/retry states on both targets. T13 public behavior runner,
T14/T15 equivalent native scenarios/comparison, exploration, hosted adoption
and native session-revocation decision remain pending. Preserve every failed
training receipt, including foreign-state cleanup failure, and the unresolved
original training-tab entry. No live capture remains; full plan incomplete.

### 2026-09-29 T12-B actual exercise sheet and detail observations

Attempt `6eea0c50f5a16adbbc9d0126` establishes the search input before explicit
focus/keyboard dismissal, then captures the initial search sheet and exact
seeded exercise's details. Reviewed PNGs and actual trees agree. Search returns
200 through the owned normal server POST. The run stops before draft-preview
because the capture expected GET detail before it occurs: the modal selects
the full search result directly; `SessionCard`'s `useExerciseThumbnail` requests
GET detail only after the item is confirmed into the draft. Move the same GET
transport requirement after draft confirmation, preserving both actual API
assertions. The normal seeded English title is `en QA Exercise 1`, as shown in
the screenshot and canonical seed; use its corresponding `en_QA_Exercise_1`
item selector instead of the incorrect `en_US` segment. No product contract is
changed. Pre-Save SQL equality remains unexecuted in this attempt.

All 86 recorded process/start identities and owned Android directories, Expo
cache and Docker resources are absent; workspace APK is preserved. Cleanup
still fails because existing foreign simulator
`36CE87B2-3068-4855-AC8A-3FBF69EB5F55` (`iPhone 17-Detox`) changed Booted →
Shutdown during the capture. The Android capture invokes only read-only
`simctl list`; no foreign state is restored/adopted. Preserve
`capture.private.json` and `external-cleanup.private.json` as failed and do
not qualify this attempt. A subsequent attempt uses a fresh before-state
snapshot and must independently prove preservation. Zero scenario/transition
passes; seven raw observed views are preparation, not qualified coverage.

### 2026-09-29 T12-B retained training navigation failure and next entry path

Attempt `643219c12700fa18d9134271` confirms the relocated session Confirm
assertion after bounded scrolling and observes the session form. Session
creation produces the visible Strength card. It ends with exit 2 at exercise
search readiness: after Add item and Hide keyboard, the failed assertion's
tree/screenshot contains the builder and no search sheet. Whether keyboard
dismissal closed the sheet or its opening failed remains unproved. The next
capture must wait for the actual search input and explicitly focus it before
keyboard dismissal, retaining both search input and initial-state assertions.
No sleep, coordinate fallback or optional assertion is added. External teardown
passes for 69 process/start identities and all owned resources; existing iOS
states and workspace APK remain unchanged. Capture and external cleanup
receipts are retained under that run ID. Catalog reads and pre-Save SQL
comparison remain pending; zero scenario/transition passes.

Validation for the capture changes: touched-file Prettier and ESLint pass,
`yarn typecheck` passes, and the focused native hierarchy/command/emulator/port
checks pass 10/10 with no skipped tests. `git diff --check` passes. The final
search-input wait/focus change is implemented and statically checked; its
fresh native attempt is the next action, not a claimed passing observation.
All captures in this packet are terminal and their independent teardown
receipts pass. No live native handle is left running by this packet.

Fresh attempt `5d70b57f4e8d4fa419cb1937` verifies the normal dashboard CTA
reaches the seeded library and Create reaches the new builder; both raw
hierarchy/screenshot pairs were captured. It stops with exit 2 at session-form
readiness: the name field is visible while Confirm lies below the 320×640
viewport. The reviewed failure screenshot/tree supports a scroll prerequisite,
not a missing control. Move the explicit Confirm visibility assertion after
the normal bounded scroll and before its tap in the next step; do not drop
the assertion or change the viewport/timeout. No exercise/draft SQL completion
claim is made. External cleanup passes for 68 process/start identities, owned
directories/cache/Docker, unchanged existing iOS states and workspace APK.
The private capture and cleanup receipts remain under that run ID.

Attempt `01f9ecf458b96db24cfd9dbf` ended with exit 2 after the actual app build
and normal coach sign-in. Maestro reported the `tabs.training` tap completed,
but the failed subsequent library wait's hierarchy still contained
`pro.home.screen` with Dashboard selected and Training unselected. No training
view was captured; the cause of the unchanged navigation is not established.
Retain command JSON, hierarchy and screenshot; do not classify the tab as a
confirmed product defect or suppress the development warning toast.

Independent teardown now passes: 52 process/start identities absent, six owned
directories absent, owned Expo cache and Docker resources absent, previous iOS
device states preserved, workspace APK unchanged. Receipt:
`.qa/artifacts/native-pilot/01f9ecf458b96db24cfd9dbf/external-cleanup.private.json`
(mode 0600).

The next training inventory attempt uses the existing dashboard Training plans
CTA (`pro.home.trainingCta`, normal `/professional/training` navigation), whose
actual failed-state hierarchy and source agree. Capture requires the library
destination and records this entry path plus the unresolved tab alternative.
No coordinates, optional core assertions, timeout increase, product/auth/copy
change or new API is introduced. This remains T12 observation with zero
transition/behavior passes. BR-303's catalog wording was corrected to the
existing authenticated server routes under the SC-208 exercise integration
decision headed D-157; no runtime catalog contract changed.

### 2026-09-29 T12-B Android training draft observation kickoff

Scope: SC-208 library/new builder/session form/exercise search/detail and local
draft preparation on an owned Android en-US target. Read SC-208, TC-278/TC-303,
BR-293/BR-294, AC-208/AC-223, UC-002.7 and exercise-catalog flow; inspect normal
tab/library/builder/SessionCard/search controls and the real-DB browser journey.
Reuse the private Android capture and ownership/fixture pipeline. Add one
explicit `training-draft` charter; no public runner, app shortcut or new reset API.

Acceptance: actual trees/screenshots for each reached state; stable source-derived
IDs verified against runtime; bounded visible-state waits/scroll and keyboard
handling; catalog search/detail through the owned normal API; local quantity
visible; scoped read-only SQL snapshots equal before/after edits without Save;
source/build/config identity and independent teardown. Retain failures and
source-only/unreachable states. Count zero transition/behavior passes. Extend
view qualification only after reviewing actual evidence. No product behavior,
user-facing copy, localization, auth, provider, signing or CI changes; existing
domain documents remain authoritative. Native sign-out decision is independent.

### 2026-09-29 T12-B Android app build/entry kickoff

Scope: normal devDebug APK, owned API/Postgres and Metro, dedicated emulator,
actual sign-in entry observation. No authentication contract, native signing,
provider or CI change. Read Android Gradle/manifest/Application/Detox setup,
installed React Native PackagerConnectionSettings, integrated environment
guards, owned backend/proxy/Expo and target helpers, native plan/testability and
mobile stack docs. Reuse these owners; leave existing dirty/generated APKs and
unrelated devices intact.

Acceptance: Android-specific source identity; fresh private app build output;
real APK dev/debug package/signature/config checks before install; loopback
API and Metro reverse mappings verified on the owned target; configure the
existing `debug_http_host` preference without instrumentation or product
changes; actual normal entry hierarchy/screenshot and healthy bootstrap;
source/build/config/network identity and cleanup receipts. Integrated bypasses
and provider inputs remain disabled. Entry capture reports zero behavior
passes; app family coverage and server revocation remain pending. Add focused
build metadata/network/preference rejection checks; run typecheck/lint and
actual build/launch before qualification. Product docs/locales need no behavior
update for these test-only helpers.

### 2026-09-29 T12-B Android app build and retained first failures

- Added Android-specific source/build metadata guards and a private app capture
  using the existing owned backend, proxy, Expo and target helpers. Redirect
  only the app Gradle build output; preserve the existing workspace APK. Verify
  actual package/debug/launcher/signature/embedded configuration before install,
  then compare the pulled installed APK's bytes. Configure the established
  React Native debug preference through dev-only `run-as`; no instrumentation,
  auth, signing configuration or provider change.
- `9aeb306e95403ac7c6086402`: build succeeded (398 executed Gradle tasks,
  2m13s), real APK/installed/config guards passed, then capture returned 2
  because the initial reverse-list parser incorrectly expected the emulator
  serial. Actual SDK output labels its selected transport `host-19`. Preserve
  that failure, raw mapping and build identity. Corrected parsing retains the
  verified `adb -s` target boundary and exact owned endpoints, and rejects
  unexpected labels, duplicate/extra mappings and mixed transport labels.
  External teardown passed for 27 recorded PID/start pairs including the
  single-use Gradle daemon, six owned directories, Metro cache and owned Docker
  container/network/volume absence. Prior iOS states and workspace APK preserved.
- `012a8d13ecf4fee968127652`: fresh build succeeded (398 tasks, 1m25s),
  package/config/install and both reverse mappings passed. Real normal Android
  sign-in PNG/tree captured with the three required selectors. Screenshot
  review found normal English app UI with a development warning toast, not an
  error overlay; ReactNativeJS/AndroidRuntime error log empty. Coach setup then
  returned 2 before submission because the visible keyboard covered the submit
  button. Only normal analytics requests were forwarded, no sign-in request.
  Preserve that attempt and final keyboard screenshot. Next capture explicitly
  dismisses the keyboard and asserts the visible submit button before tapping.
  External teardown passed for 39 PID/start pairs, owned directories/cache/Docker
  absence, prior iOS states and unchanged workspace APK.
- Private receipts live under `.qa/artifacts/native-pilot/<capture-id>/`:
  `capture.private.json`, build/command ownership logs, APK identity, installed
  bytes, actual screenshots/trees, bootstrap/transport logs and
  `external-cleanup.private.json`. These failed attempts qualify no passing
  journey, transition or imported view. Both report zero native behavior passes.
- Focused APK/hierarchy checks pass 5/5; touched lint passes with zero warnings
  after import-order repair; typecheck passes. Native locale capture now records
  both persisted and product-default properties instead of treating an empty
  persisted property as a locale. Actual app observation and import qualification
  remain separate gates. Full P4/T12–T15 and hosted adoption remain incomplete.
- Gradle's single-use daemon uses a separate process group. Normal termination
  was observed independently; automatic descendant ownership/cancellation proof
  for that build path remains required before the public T13 runner can claim
  complete lifecycle coverage. Do not infer it from the normal teardown receipts.

### 2026-09-29 T12-B Android app observation and view qualification

- Corrected capture `a59097c2e185fe192056c3da` exits 0, `result=observed`,
  `cleanup=cleaned`, with two actual reviewed normal views: SCR-sign-in and
  SCR-pro-home. Native coach sign-in forwards through the owned server and
  returns 201. Effective default locale is en-US. Build is Metro-attached
  devDebug arm64 without instrumentation; binary hash
  `b0fe5e794ace026b6aa2f82114b5346a49519753bb0ed05ac6aed38fd3234788`.
  Signature, embedded API configuration, installed-copy bytes, both reverse
  ports and persisted debug preference pass. Source and helper inputs remain
  unchanged throughout execution. No app/auth/provider/signing/CI behavior changes.
- External teardown passes for 54 recorded PID/start identities including the
  single-use build daemon and API process, all six owned slot directories,
  Metro cache and owned Docker container/network/volume absence. Prior iOS
  device states and the existing workspace APK are preserved. Record remains
  private; parent cleanup does not substitute for this independent check.
- Extended the existing view qualifier for Android instead of adding a second
  inventory/receipt pipeline. Read-only APK reinspection repeats the existing
  metadata/signature/config guard and verifies the installed-copy hash. Capture
  and independent cleanup, reviewed PNG/tree bytes and fixture/target identities
  remain required. Auxiliary hashes bind bootstrap, native transport, reverse
  mapping and original APK identity records. iOS bootstrap is now bound too.
- Qualification initially rejected the external control's 0644 record and
  stale declaration source revisions. Restricted only the owned record to 0600
  without changing bytes; refreshed the governing-doc declaration/manifest.
  Rejection rules were retained. Runtime captures and original failure receipts
  were not rewritten. Current Android qualification suffix `18cefabd4cf7`
  accepts 2/20 Android views and zero transitions/behavior. Requalified unchanged
  iOS observation `0abd8f86290bc99a91d703b1` under suffix `83338da3c8b0`,
  accepting 5/21 iOS views and zero transitions/behavior. These are separate
  platform-specific private inventories, not one combined passing matrix.
- Actual-receipt rejection control checks a valid receipt before and after
  nine mutations. Wrong platform/device/fixture/build, changed capture/screenshot,
  missing review and missing/changed auxiliary evidence reject for their expected
  reasons. Original evidence files remain unchanged. See the capture directory's
  `qualification-rejection-control-v2.private.json`.
- Validation: focused capture/ownership suite 13/13; focused inventory/view/APK
  suite 8/8; touched lint zero warnings; typecheck passes; impact validates
  12 features, 43 suites and 62 UI specs. Inventory regenerated to 314 files
  (252 client, 62 server). Full unit run 1716/1717: sole retained baseline
  failure is the mobile `/auth/password-reset/confirm` route missing from the
  server registration. It is not waived or repaired by this test-only packet.
  Log: `.qa/artifacts/native-pilot/a59097c2e185fe192056c3da/full-unit.private.log`.
- Next eligible native work: observe training, connection, permission denial
  and retry states with their documented fixtures and actual trees; qualify
  build descendant/cancellation ownership and portable host selection before
  the T13 public runner. Camera-disabled acquisition proves no permission-denial
  flow. Native session revocation remains decision-needed. T12–T15, exploration,
  CI/adoption and the full goal remain incomplete; retain Detox.

### 2026-09-29 T12-B Android connectivity packet kickoff

Scope: test-only local macOS owned AVD/ADB/emulator acquisition and pinned
Maestro connectivity; no app journey, CI host-policy change or auth behavior.
Reuse the runner-slot parser/environment and process-group ownership helpers.
Read ancestor/client AGENTS, evidence workflow/adapter, plan/handoff, native
inventory/testability and current Android slot code. Preserve existing AVDs,
devices, default ADB server and iOS targets. The native session contract remains
decision-needed; it is independent of this connectivity packet.

Acceptance: reject unsafe/private-path and target-identity mismatches; use
distinct run-owned ports and directories; qualify the exact owned Android
target with actual Maestro hierarchy; enforce bounded commands and
cancellation; cleanup only owned process groups and directories, retaining
recovery evidence on mismatch. A connectivity pass records zero app views,
transitions and native behavior passes. Require actual external cleanup checks
before marking locally verified. Planned files: owned native-command helper,
owned Android target helper, connectivity CLI and focused tests under existing
scripts/testing and tests/ci. No product documentation or locale updates are
needed because no product contract/copy changes.

### 2026-09-29 T12-B Android connectivity evidence

- Added `owned-native-command.ts`, `owned-android-port.ts`,
  `owned-android-emulator.ts` and `probe-android-connectivity.ts` under
  scripts/testing, plus three focused CI test files. Reused the slot
  parser/environment and existing process-group ownership. Local HVF helpers
  do not loosen the CI Linux/KVM guard or alter the public native behavior
  interface planned for T13.
- Failure history retained: `2f82a430fd8b64a7157f658e` exited 2 before emulator
  launch because SDK ADB rejected a numeric hostname in its listen socket.
  `91f7c4d4ee3b897c2c153d2d` deadlocked releasing a reservation accepted by ADB's
  scan; SIGTERM could not drain it and verified PID/start/UID/command recovery
  escalated the owned probe to SIGKILL (exit 137). The original controls and
  external cleanup are preserved, not reported as normal cleanup success.
- `dadb7ee3b3f7825e0a414572` and `c2400ad13b5a963434a5e21f` reached the real owned
  Android target but Maestro's one 120-second deadline expired. SDK/Dadb key
  paths differed. The latter includes a reviewed screenshot of the actual
  "Allow USB debugging?" prompt plus metadata proving different public keys.
  Correct local emulator/user-home paths align the newly generated run keys;
  no host key, USB device or authentication bypass is used.
- `df0573c01872886d315d623f` connected, exited 0 and cleaned normally. The next
  control, `bddd7ca30b26a8dfd774846b`, returned a system hierarchy but remained
  non-passing because strict live census latched an exec descendant's changed
  command. Census now gathers identities without treating that transient
  observation as a permanent error; cleanup still verifies every live member
  before signalling. A real descendant-exec regression fails with the old
  census (exit 1) and passes with the corrected implementation. Log:
  P4 `android-census-regression-control.log`.
- Fresh current normal control `642a69edfd8746d9622f2f45` is terminal exit 0:
  actual Android 17/API 37.0 Play Store hierarchy, exact owned target, unchanged
  before/after helper fingerprints and clean teardown. External receipt checks
  every recorded PID/start identity, all six deleted runtime directories and
  preservation of prior iOS devices/states. Existing default AVDs remain
  `Pixel_10` and `Small_Phone`; no default ADB server-control command was used.
- Current cancellation control `ab2dd1a0a00e950495558466` has a verified
  parent/child PID/UID/cwd signal receipt. SIGTERM during real emulator
  acquisition returns 143, records cancellation and cleans normally;
  independent receipt checks three PID/start pairs, runtime directory removal
  and prior iOS preservation. No guessed process or foreign target was stopped.
- All native controls live under `.qa/artifacts/native-pilot/<run-id>/`, with
  private connectivity/target/ownership/cleanup logs and independent
  `external-cleanup.private.json`. Failed results remain immutable. This work
  qualifies **connectivity only**, with zero app views/transitions/behavior
  passes; portable inventory denominators and P4 completion remain unchanged.
- Focused ownership/slot/command/port tests: 15/15 pass. Typecheck and touched
  lint pass with zero warnings. Full client unit suite: 1711/1712 pass; the sole
  existing `/auth/password-reset/confirm` route mismatch remains unresolved.
  Logs: P4 `android-connectivity-focused.log` and
  `android-connectivity-full-unit.log`. Test inventory now has 312 files
  (250 client, 62 server); regenerate/check after this test addition. Product
  behavior, copy, schemas, signing, providers and CI activation are unchanged.
- Next: qualify the actual Android MyChampions binary and owned API/Metro
  routing, then observe remaining T12 families on both platforms and implement
  T13. Native session revocation still requires the recorded owner decision;
  T14–T20 and full-plan completion remain pending.

Commands/results and acceptance updates live in ignored `.qa/artifacts/testing-modernization/` and phase summaries here. No hosted/native/provider/deployment claim derives from generated inventories or local unit results. Product FR/BR/UC/copy updates are unnecessary until a phase actually changes a product contract; localization has no new UI copy in P0/P1A.

### 2026-09-28 P0/P1 evidence

- Inventory currently includes 284 test files (225 client, 59 server), assertion labels/expressions and ten platform-specific pilot scenarios. Regenerate/check before relying on counts. No tests retired. Source/requirement-review gaps are explicit in each row.
- Server pinned Bun non-DB and real disposable Postgres runs pass; API journey receipt proves restart, assignment copy and deny/no-mutation outcomes. Parallel DB runs use distinct ports with the same catalog hash. Lifecycle checks pass test-execution SIGINT/SIGTERM and cancellation while an API child is live, with no owned container/network survivors. Final receipts/command results are in `.qa/artifacts/testing-modernization/2026-09-28-p0-p1/phase-report.json`.
- Client baseline: 1,667/1,669 unit cases passed. Failures: existing `<100ms` display-name benchmark under parallel load, and a client password-reset-confirm request absent from the current sibling server branch. Client typecheck has seven existing fetch mock/preconnect type errors; package/runtime dependencies and these mocks were not changed. Lint and test-impact checks pass. These failures remain visible and are not waived.
- Read-only hosted history shows the latest trusted selective run failed on `e5dbace3c8...`; it does not cover this dirty checkout. No hosted/native/provider promotion is claimed.
- No product code, app schema, public seed/reset endpoint, localization copy, commit, merge or deployment changed. Additive docs and exact DB-test guard replacements preserve pre-existing work. P2 onward remain pending; D-195/BL-016 remain open.

### 2026-09-28 P2 evidence

- Four rendered families pass 29 cases: support and exercise search use real hooks/state with transport mocked; role selection uses the real screen with persistence/router boundaries mocked; TaskCard checks real theme styles in light/dark. Locale-sensitive cases run en-US/pt-BR/es-ES. A named TaskCard export is the only app source change; its rendering/styles remain unchanged.
- Each family detects a temporary controlled regression (pending dismissal, unselected role enabling, untrimmed confirmed quantity, wrong icon foreground). Original source bytes restored and 29-case clean rerun passed. Receipts/logs: `.qa/artifacts/testing-modernization/2026-09-28-p2/`; assertion-level retirement links: `docs/qa/component-replacement-ledger-v1.json`.
- Removed two SupportModal source test cases and one role-preselection source test case; replaced exact theme JSX/background assertions while retaining the hardcoded-color prohibition. Web Escape/DOM semantics, navigation/shared-pill/Detox lifecycle and decorative accessibility checks remain.
- Component matching is limited to `tests/component`; Node and Detox discovery commands remain unchanged. `test:all` now runs unit then component; fast-quality wiring/hosted promotion is deferred to P6. AST inventory now recognizes rendered-component files and alias imports/parameterized test purposes; regenerate/check before using current counts.
- Typecheck passes with client ambient React/React Native/Node/Jest types explicitly scoped, excluding inherited sibling Bun globals. Runtime React/Expo versions and fetch mocks remain unchanged. Unit run: 1,665/1,666 pass; the existing password-reset-confirm route mismatch remains. The earlier timing failure passed this run; no threshold was relaxed. Lint and impact checks pass (warnings reported in phase receipt).
- TC-304.1 expects simultaneous errors but runtime validates the first field only; this remains an explicit unresolved contract gap. Sequential component validation does not claim TC-304.1. No FR/BR/UC/screen/localization behavior update is required; TC evidence scope, strategy/specs/README/wiring and this task card are updated. No native/browser persistence/hosted proof is claimed. Next: P3 profile equivalence and real DB browser journeys.

### P3 preparation (before T09)

- Captured all 17 resolved Playwright configurations under local and CI environment settings before profile consolidation. These are configuration receipts, not executed browser journeys.
- Initial `yarn playwright --list` attempts were blocked by duplicate module instances: Yarn chose the parent binary while specs resolved the client installation (both version 1.61.1). The client-owned `playwright` package script now resolves/imports its CLI from the same package boundary as specs; hoisted installs remain supported. Initial failures are preserved under the P3 artifact directory.
- Profile consolidation and integrated browser execution remain pending. The P3 configuration/discovery baseline lives in `.qa/artifacts/testing-modernization/2026-09-28-p3/`; validate its successful selection receipt before migrating aliases. Do not count discovery as a browser pass.

### P3 browser profile consolidation

- All 17 root configs delegate to `e2e/web/support/create-web-test-config.ts` and the explicit profile registry. Shared artifacts/report setup is centralized; fixtures, memory-backed server, negative-profile omissions, locales/devices, ports, retries, reuse policy, report names and subscription capability servers retain their original values.
- All 34 resolved local/CI configurations compare exactly equal; all 17 aliases preserve discovered file/title/project/test IDs. Twelve focused resolved-config/port/fixture tests pass. The three old config-source checks now inspect actual resolved settings, retaining their original policy expectations. Both shared helper paths force conservative full selection.
- Training fixture browser runtime: four exercise-search cases pass first attempt on Chromium/Pixel 5 with an isolated allocated port and retries zero. The two observed web-server child PIDs are terminated. This is browser fixture evidence, not native or persistence proof. Professional-home locale runtime is recorded separately when terminal.
- Professional-home responsive browser cases pass first attempt in en-US/pt-BR/es-ES. Cleanup verified no listener and no observed server children; a plain post-run bind initially failed due to TCP TIME_WAIT, while the reusable bind succeeded. Twelve resolved-config tests and three detecting controlled regressions pass after source restoration. The in-place assertion ledger is `docs/qa/browser-config-replacement-ledger-v1.json`.
- Final broader checks: 1,670/1,671 Node cases pass (same missing server route); typecheck, lint (existing warnings), impact, formatting, inventory and shared-helper full-fallback checks pass. Evidence: `.qa/artifacts/testing-modernization/2026-09-28-p3/phase-report.json`. T09 is locally verified; no integrated journey or hosted result is implied.
- P6 auth-atlas project selection is **Done (source)**: impact and nonblocking observation workflow match the resolved `mobile`, `tablet`, `web` profile. A fail-before/pass-after parity regression passes in canonical source. The former `mobile-auth*` declarations were stale; no three-locale runtime coverage is claimed. Profile settings and `ci:false` are preserved; browser/hosted execution and promotion remain Pending, with D-195 gates unchanged.
- T10/T11 guarded backend harness reuse and integrated browser journeys remain pending. Current bucket stays P3; no native/hosted/provider claims or product behavior changes.

### P3/T10 shared harness and preflight preparation

- Extracted server resource acquisition into `scripts/testing/owned-runtime.ts`;
  the existing integration CLI reuses it with the same test selection, serial
  execution, classifications and receipt contract. Explicit cwd makes acquisition
  and cleanup independent of the client caller. Release is idempotent; resource
  ownership failures retain recovery records.
- Added a private pinned-Bun stdio session for fixture references, API restart and
  stop. Exact loopback origins are validated before acquisition. API children
  receive the generated provider-free environment, run-owned signing/storage and
  all three DB URLs. Request/scope/API attempt duplication blocks; there is no
  public seed/reset route. Shutdown attempts both API stop and DB release.
- Backend handoff verification passes direct single-start/idempotent release,
  concurrent sessions from the client cwd, distinct DB/API ports and accounts,
  equal catalog seed hash, excluded inherited provider credentials, real sign-in
  and durable write/read across a new API PID, normal stop, SIGINT/SIGTERM, parent
  EOF, duplicate request and deadline handling. Owned resources and observed API
  PIDs are gone. Internal session receipts are separate from the still-pending
  full public receipt schema. Existing P1 parallel/cancellation suite passes after
  extraction as well.
- Handoff development found multi-line migration notices contaminating protocol
  stdout and an incorrect verifier expectation of sign-in 200 (current contract
  is 201). Diagnostics now use stderr; the verifier matches existing auth tests.
  Initial failed runs remain in private evidence and cleaned their resources.
- Client preflight rejects inherited auth/domain fixtures, accepted-terms
  overrides, unknown bypass flags, nonlocal/mismatched API origins and production
  variants before sanitization. Its minimal Expo environment disables dotenv and
  external providers. Four focused cases exercise the real resolved app config.
  The helper forces full impact selection, but is not yet wired to a browser run.
- Validation and receipt paths are in the P3 handoff phase report. Server unit:
  233/233. Client unit: 1674/1675, retaining the same missing password-reset-confirm
  server route. Client/server typechecks, client lint (3041 existing warnings),
  impact checks and focused preflight tests pass. No app/source behavior or
  localized copy changed; no FR/BR/UC/screen update is required.
- Next at that checkpoint: checked-in resource/public receipt schemas, validated client bridge,
  integrated Playwright config/batch/owned proxy lifecycle, then T11 five real
  browser journeys. T10 stays In progress until that wiring passes. Native
  comparison, exploration, hosted gates and D-195 remain pending.

### P3/T10 strict schemas and validated client bridge

- Six strict server-owned JSON schemas now validate resource manifests, API
  process records, private fixtures, requests, events and internal session
  receipts before consumption. Resource manifests bind canonical roots, fixture
  scopes and PID/start/script identities. The client vendors these schemas with
  content-hash provenance; `node scripts/testing/sync-server-schemas.mjs --check`
  rejects drift. AJV 8.18.0 is an exact test-only dependency in both owners.
- The full public receipt V1 schema and client validator reject false passes,
  missing fingerprints, dirty revisions without worktree hashes, secret values,
  invalid classifications, duplicate identities and unsafe/missing artifact paths.
  Integrated attempt producers are still pending; an aggregate harness summary
  is not a browser attempt or a public receipt V1.
- The Node client bridge validates every protocol/private document, canonical
  ownership and protected file modes/symlinks, then checks API ledger identity and
  health. Its live verifier passes two concurrent sessions with distinct DB/API
  ports and accounts, fixture manifest refresh, durable write/read after restart,
  idempotent stop, both signals and duplicate-scope rejection with cleanup.
- Runtime release stops an owned tracked child before DB cleanup. Pinned Bun's
  signal termination leaves `exitCode` null; `exited` and `signalCode` establish
  termination. The verifier and API helper use that actual contract. Schema
  validation also exposed the existing `training_plan_<UUID>` identifier shape;
  schemas match the canonical model rather than altering product behavior.
- Final checks: server unit 236/236, client focused preflight/schema 9/9,
  rendered component 29/29, both typechecks, impact, schema sync and inventory
  checks pass. Client unit 1679/1680 retains the existing password-reset-confirm
  route gap. Lint has zero errors and 3041 pre-existing warnings; touched schema/
  bridge files have zero warnings. Inventory: 293 files (232 client, 61 server).
- Repeated shared-runtime and legacy lifecycle verifiers pass; two parallel
  20-file DB runs and cancellation cases clean their owned Docker/API resources.
  Direct DB invocation without ownership remains rejected before SQL. Initial
  schema/type/verifier failures are retained alongside the successful reruns.
- Evidence: `.qa/artifacts/testing-modernization/2026-09-28-p3/schema-bridge-phase-report.json`.
  Next: owned stable proxy/app lifecycle, integrated config/batch and full public
  attempt receipt producer, then five real browser journeys. T10 remains In
  progress. TC-304.1, the route mismatch, auth-atlas/P6 matrix, native comparison,
  exploration and hosted gates remain pending. No app behavior, FR/BR/UC/screen
  contract or localized copy changed in this infrastructure increment.

### P3/T10 stable owned API proxy

- Added `scripts/testing/owned-api-proxy.ts` with in-process control only. It
  preserves the public HTTP/auth/cookie/CORS boundary and keeps one loopback
  address when the validated session restarts its API. Each forward verifies the
  actual PID/start/script identity. Stale upstream changes and dead APIs fail
  closed; the proxy cannot select an arbitrary upstream or expose an HTTP seed,
  restart or fault-control endpoint.
- A declared attempt may fail one exact POST-create or PATCH-update training save
  for its authenticated account. Account identity is read from the real owned
  `/me` route before arming; fault injection consumes the designated request
  before creating an upstream request. Other identities, reads and OPTIONS keep
  their normal route behavior. Clearing removes the private token, and duplicate
  attempt IDs cannot be reused. The 503 error shape is understood as a network
  failure by the current plan-builder source.
- Transport observations contain methods, path hashes, known origins, status,
  timings and fault IDs; headers, cookies, credentials and bodies are absent.
  Whole session limits remain enforced by the backend; proxy requests have an
  explicit bounded deadline and stop closes only its own sockets/requests.
- Explicit verifier: `yarn tsx scripts/testing/verify-owned-api-proxy.ts`. It runs
  two fresh owned databases and proves failure/no-change/read, fault-clear/retry,
  durable read after API restart, stable proxy origin, cookie/CORS forwarding,
  foreign account denial, invalid/duplicate fault rejection, target rejection,
  stalled-write deadline, stale upstream and dead-PID rejection, idempotent stop
  and no surviving owned containers/networks. This is backend transport evidence;
  it does not claim UI draft retention, one durable UI mutation or T11 completion.
- Initial verifier failure used an incorrect fixture account key; cleanup still
  completed. A later stalled-body probe exposed Node's fallback 408 racing the
  proxy deadline response. The proxy's body deadline now precedes that fallback,
  while headers retain their separate bound. The key is corrected and the client fixture DTO now enumerates the
  seven schema-owned account names. Failed evidence remains alongside reruns.
- Both proxy/helper paths force conservative full impact selection. Infrastructure
  only: no app, public API, database schema, FR/BR/UC/screen/localized copy change.
  Next: owned Expo lifecycle, integrated config/batch, validated full public
  attempt receipts and the five browser journeys. T10 remains In progress.

- Final proxy evidence: `.qa/artifacts/testing-modernization/2026-09-28-p3/proxy-phase-report.json`.
  Both fresh runs passed with one injected save each, four observed API PIDs gone
  per run, closed proxy listener and zero owned container/network survivors.
  Client typecheck, touched-file lint (zero warnings), impact validation, explicit
  full-fallback selection, nine schema/preflight cases and inventory checks pass.
  Existing complete-unit/server/component results are recorded above; no new
  full-suite pass or hosted claim is inferred from this transport increment.

### P3/T10 owned Expo and observed browser transport

- `reserveOwnedAppPort()` holds an isolated loopback reservation while the runner
  acquires its API/proxy. `startOwnedExpo()` validates inherited bypass/origin
  inputs, the actual CLI-resolved public Expo config and listener prerequisites
  before spawning a direct client-owned Expo CLI in its own POSIX process group.
  The same minimal environment supplies the owned API/proxy origin before bundle
  compilation; dotenv/providers and automatic unrelated-server reuse are disabled.
- Readiness requires an HTML response and an actual listener in the owned process
  group, not merely a successful port response. PID/start/command hashes guard
  shutdown. Normal stop is idempotent; abort/startup failure stops only verified
  group members. Unknown ownership retains a private recovery ledger. Acquire,
  config, process/listener probes and TERM/KILL waits have explicit bounds.
- Prerequisites: POSIX host, client Expo installation and `lsof`. The caller owns
  the initial port reservation and must release it in its `finally`, including
  preflight failures; the caller also stops the API/proxy independently. Private
  `expo-process-v1` validates generated ownership ledgers. This ledger is internal
  lifecycle evidence, not a public attempt receipt.
- `yarn tsx scripts/testing/verify-owned-expo.ts` passes a real Chromium login from
  the rendered sign-in screen through the run-owned proxy and Postgres API, then
  checks the student home and HttpOnly refresh cookie. CLI-resolved API origin and
  observed auth/domain request origins equal the proxy; no auth/domain fixtures
  are enabled. Screenshot supports the smoke but does not close visual acceptance.
- The verifier also rejects an occupied foreign HTML server while preserving it,
  aborts after owned Expo spawn with cleanup, and proves idempotent stop and the
  closed listener. It is startup/transport smoke evidence, not the full T11
  create/onboard/reload/sign-out/revocation scenario or its browser-engine matrix.
- Client typecheck, nine schema/preflight cases, touched-file lint, impact/schema
  synchronization and inventory checks are recorded in the Expo phase report.
  Both helper paths force full impact fallback. No app/public API/schema/screen
  behavior or localized copy changed; product requirement updates are unnecessary.
  Next: integrated config/batch, full validated public attempt receipts and T11
  journeys. T10 stays In progress; native/exploration/hosted gates remain pending.

- Evidence: `.qa/artifacts/testing-modernization/2026-09-28-p3/expo-phase-report.json`.
  Fresh startup/login and repeated lifecycle verifier runs pass; final receipt
  includes occupied-port preservation and cancellation cleanup. Typecheck,
  touched-file lint (zero warnings), nine schema/preflight cases, impact,
  full-fallback selection, six copied-schema checks and the 293-file inventory
  pass. Full-unit/server/component results remain separately scoped above.

### P3/T10 integrated batch and T11 auth matrix

- Added the integration config/batch/package command and exact scenario/project
  registry. Default selection remains five scenarios across nine projects.
  Four entries are explicit temporary placeholders (`implemented: false`):
  training-durable, connection-approval, save-retry and unrelated-denial. Their
  empty requirement/assertion arrays must be populated before enabling specs.
  Default execution currently emits 45 blocked receipts without resources.
- Private context binds canonical roots, parent PID/start, owned proxy listener,
  protected fixture files/hashes and attempt identities. Fingerprints include
  actual resolved Expo environment/config. Discovery and execution are separate;
  exact requested IDs, actual browser version and all declared assertions are
  checked. Strict public V1 receipts preserve child status, cleanup, input/source
  identities and evidence paths; private fixture bodies/credentials stay excluded.
- Playwright owns a detached process group. Shared process census also serves
  Expo and compares real UID (Darwin ps is setuid-root). PID/start/command checks
  precede signals; TERM/KILL and close waits are bounded. A fast orphaned compiler
  gets a bounded natural-exit wait; unknown members cannot be signalled. Lifecycle
  tests prove TERM-ignoring descendant cleanup and preservation of another group.
- Auth executes real signup, terms/student-role persistence, HttpOnly cookie and
  storage checks, reload/refresh rotation, UI sign-out/revoked-cookie replay,
  normal UI login/reload and observed owned origin. Compatible signup 201 or 202
  is verified against SC-218. Canonical DTO email is `emailNormalized`; disabled
  terms button uses its actual `.disabled` testID. Failed development attempts
  remain retained; no auth behavior or security expectation changed.
- Nine auth cells pass all seven assertions with retries zero: en-US desktop
  Chromium/Firefox/WebKit, plus Pixel 5/iPad Mini Chromium browser emulation in
  en-US/pt-BR/es-ES. First matrix root:
  `.qa/artifacts/web-integration/44619fc901c0b25fa233bb7b/`; earlier fresh Chromium
  root `63f7c25afcdf3b7138515f72/`. These are browser, not native results. Later
  runner bookkeeping changes require the final fresh matrix repeat recorded in
  the integration phase report before relying on current-input proof.
- `yarn tsx scripts/testing/verify-web-integration.ts` passes six rejection probes,
  observed live scenario-worker SIGINT/SIGTERM forwarding and a whole-run deadline.
  Exit 130/143 preserves worker exit 143 separately; requested cells are cancelled,
  never silently omitted. Deadline blocks. Acquired resources are cleaned.
  Evidence: `.qa/artifacts/testing-modernization/2026-09-28-p3/integration-verifier-2026-09-28T23-32-32-020Z/receipt.json`.
- `web:integration-auth` deliberately remains `ci: false`, runner
  `playwright-integration`. T18 must implement/validate its selective-executor
  adapter and exact client/server checkout before enabling it. Shared helper
  paths force full selection; registration does not prove CI support.
- T10 acquisition now distinguishes validated cleanup, preflight not-acquired and
  unknown recovery. Early acquired/closed events bind root PID/start/script, run,
  owner digest and the final private receipt. Unknown identity remains recovery.
  T11 still needs four UI journeys, private worker
  restart/fault/read-only SQL control and fresh repetition. Native comparison,
  observed exploration, hosted gates and D-195 remain pending.
- No product, public API, schema or user-facing copy changed; FR/BR/UC/screen/
  localization behavior updates are unnecessary. Checks, failures, current hashes
  and cleanup are reconciled in `integration-phase-report.json` under the P3
  evidence root; no full-plan completion is implied.
- Broader checks for this increment: typecheck and touched-file lint pass with
  zero touched warnings; 12 features/39 suites/58 UI specs validate; all 29
  component cases pass. Node runs 1686 cases, 1685 passing: the unchanged missing
  `/auth/password-reset/confirm` route remains the sole failure. No assertion is
  skipped or weakened. Inventory regenerates/checks 296 files (235 client,
  61 server); six canonical schema copies and whitespace checks pass. Native and
  hosted evidence remains pending. Final auth repeat/negative verifier results
  live in the ignored integration phase report, keeping execution inputs frozen.

### P3/T10 startup acquisition and bootstrap recovery

- The private bridge emits `acquired` only after persisting its ownership ledger
  and installing signal handlers. Bootstrap port 0 is accepted only for this
  stage; readiness still requires a bound port and healthy owned API. An early
  close must validate the same run/owner/PID/start/script and receipt. Missing or
  mismatched close evidence retains unknown cleanup.
- Client acquisition errors preserve actual child status, validated ownership
  metadata and cleanup classification. An already aborted call or failed pinned
  Bun preflight acquires nothing. Cancellation after acquisition forwards to the
  owned session, and the outer wrapper records nonzero cancelled/blocked receipts.
- Test Compose containers/networks carry run and owner-digest labels. Cleanup can
  recover an unrecorded container ID or a network created before any container
  only after exact project/service-or-network/run/owner checks. A network with a
  wrong owner is rejected and preserved. Project names alone never authorize
  deletion; production Compose is unchanged.
- First checks: acquisition verifier 5/5, Docker bootstrap recovery 3/3 and
  integrated wrapper verifier 11/11 (six rejection probes, worker and acquisition
  SIGINT/SIGTERM, deadline). Actual guarded Postgres integration passes all 20
  selected files, cleanup cleaned. Server units pass 239/239; client/server type
  checks and touched lint pass. Private logs/receipts are under the P3 evidence
  root. Freshness/repeats after documentation reconciliation are recorded in
  `acquisition-phase-report.json`; earlier integration reports remain historical.
- A concurrent bridge run failed before API readiness because `ps` supplied an
  empty process start time (`api-process-v1 /started:minLength`). Cleanup was
  validated as cleaned. A 500-sample direct probe did not reproduce it; a separate
  bridge repeat passed. Retain the original failure and track its cause as unknown;
  the repeat does not replace first-attempt evidence or satisfy a reliability gate.
- Remaining scope: four T11 UI journeys and their private worker control, native
  Maestro/Detox comparison, observed agent exploration, selective CI adapter and
  protected hosted gates. No product/public API/schema/copy change; FR/BR/UC,
  screen and localization updates are unnecessary for this infrastructure.

### P3/T10 process-query hardening

- Review found a separate cleanup ambiguity: successful but empty `ps` output
  was treated as a dead API process. Startup now uses the same bounded async
  process-query helper as cleanup. Only explicit exit 1 with empty stdout/stderr
  establishes absence; empty success, errors and deadlines retain recovery.
  Exact start/script/run/attempt matching remains required before any signal.
- Test-child identity registration is awaited before the manifest is persisted.
  No process start value, identity guard or schema is relaxed. Unit negatives and
  live-child checks are added; current execution evidence will be recorded in
  `process-query-phase-report.json` under the P3 evidence root. Original failed
  bridge evidence remains retained; its root cause is not claimed established.
- Product, public routes, application schema and localized copy are unchanged.
  Scope remains testing infrastructure; four T11 journeys and later gates remain
  unfinished. The controlled empty-query cleanup test passes without any Docker
  invocation and preserves the live PID and ledger. Server units pass 244/244;
  both owner typechecks and touched client lint pass. Concurrent handoff/guarded
  integration and a separate fresh bridge run pass; the original failure remains
  retained without a claim that its root cause has been established.

### T11 private snapshot preparation

- Adds a named, fixture-scoped stdio snapshot operation with fixed read-only
  training/connection queries and strict private result schemas. No arbitrary
  query, caller-selected DB/UID, public admin route or app behavior is introduced.
- Client consumption must validate run/scope/protected file/schema before returning
  the result. Integration proof must include original fixture state, actual public
  API mutation reflected in a fresh read, unchanged state after API restart and
  cleanup; an unseeded scope must block. This preparation does not enable any
  placeholder browser scenario or complete T11. Two fresh scoped API-write/restart
  checks and one unseeded-scope rejection pass, with all snapshot/fixture files and
  Docker resources removed. Seven canonical schema copies match provenance.
  Worker/parent restart/fault/snapshot control and the four UI journeys remain
  next. Evidence goes in `process-query-phase-report.json` under the P3 root.

### T11 worker control and durable training kickoff

- Governing behavior: plan Section 8/16/19, SC-208, UC-002.22, AC-223 and
  BR-294/BR-282. Reuse private session snapshots, owned stable proxy and seeded
  coach/catalog. Parent control is private IPC; no application/admin route changes.
- Training must authenticate through UI, create a local named session and exact
  catalog exercise/quantity, prove no draft write, save through normal UI, inspect
  authenticated API plus owned SQL, then edit and verify final values after an API
  PID restart and browser reload. Existing seeded template stays unchanged.
- Populate assertion/requirement links before enabling the training spec. Fault,
  two-context approval and unrelated denial remain declared placeholders until
  their own full behavior is implemented. No FR/BR/UC/screen/localization change
  is needed because the infrastructure asserts existing documented behavior.
- Focused Chromium training run `07598369af5613bcc78b7dcb` passes eight assertions
  with owned cleanup. Earlier attempts retain an unsupported post-create button
  expectation, an idle-guard harness rejection and a builder-after-reload location
  assumption. Reload now opens the saved library and reopens the exact plan row;
  no product navigation change or deep-link qualification is claimed.
- Next verification: fresh nine-project matrix/repeat and an explicit capability
  rejection through the public wrapper receipt. The negative verifier may mutate
  only the directly spawned run's private context after verifying parent and live
  discovery child identities. It must retain original child exit 1, classify
  harness-blocked exit 2, prove no control dispatch and finish owned cleanup.
- Concurrent training matrix `186a0eecd3d02593ae4f6753` observed the negative
  run's proxy origin in its actual bundle, differing from its owned context. The
  verified parent received SIGTERM and cleaned up; original assertion failures
  and cancelled receipts remain retained. Installed Expo Metro configuration uses
  `os.tmpdir()/metro-cache`. Next change isolates each Expo process's temporary
  cache beneath its own artifact root, with ownership-checked post-stop removal.
  No product API/auth/navigation behavior changes are authorized by this finding.

- Isolated-cache matrix `2825357d90f3f474f3ac1218` passes all nine projects and
  72 assertions, cleanup cleaned, concurrently with capability rejection probe
  `ca73fb7df51cb3e3fe6e741d`. The probe preserves worker exit 1, emits blocked
  exit 2, dispatches no control operation and removes its socket/cache/resources.
- Real private IPC verifier and all 11 wrapper rejection/cancellation/deadline
  probes pass after cache isolation. Fresh training/auth matrices and explicit
  Expo cache/occupied-port/startup-abort verification are next. Runtime findings
  remain in `worker-control-phase-report.json` under the P3 evidence root.

- Fresh training matrix `9937dbe3f58578e8c42d0c4d` passes 9/9 cells and 72/72
  assertions; fresh auth matrix `17e97daf81baedfc65d58711` passes 9/9 and 63/63.
  Both run concurrently with the successful Expo occupied-port/startup-abort/cache
  verifier and finish cleaned. Two training matrices pass after cache isolation;
  their governing plan differs only in progress wording between runs.
- Final client typecheck, touched lint, formatting, schema provenance, inventory
  and whitespace checks pass. Units: 1688/1689; the sole failure remains the known
  missing server password-reset confirmation route, with no weakened assertion.
- External read-only verification checks 224 retained Compose projects and 782
  PID/start pairs: no owned containers/networks/volumes, matching processes, worker
  sockets or Expo caches survive. Missing/empty/error process queries are not
  interpreted as clean; this check reports no unknown process queries.
- Status: worker control and training are locally verified in the recorded scope.
  T11 remains In progress with connection approval, save retry and unrelated
  denial pending. Native comparison, actual exploration, selective runner adapter
  and protected hosted gates remain unfinished. Next eligible work is two-context
  connection approval using SC-211, UC-002.3 and BR-230/BR-230A.
- This increment changes only testing infrastructure and coverage declarations.
  No app behavior, public server route, data schema or localized copy changed;
  FR/BR/UC/screen/localization edits are unnecessary. Evidence is in
  `worker-control-phase-report.json`; the complete plan is not marked done.

### T11 connection approval kickoff

- Scope: integration coverage only, governing SC-211, UC-002.3, AC-213/214,
  BR-230/230A and plan Sections 8/19. Reuse fixture coach/student, scoped snapshots
  and two isolated browser contexts using the selected project's locale/device.
- Professional exposes its actual invite code in home UI; student submits it in
  SC-211. API plus SQL must show pending, never active before confirmation. The
  professional's rendered pending row performs acceptance; both rendered lists
  and authenticated API reads must agree with the new SQL active row. Seeded
  pending/active connections and training template must remain unchanged.
- Assertions and governing document links must be registered before enabling.
  Focused Chromium proof precedes nine-project fresh-run matrix/repeats. No seed
  performs the action, no shared cookies/tokens and no app/public API change.

- Focused Chromium attempt `d15b60d5fe69bb0de88a30ec` passes 8/8 assertions,
  cleanup cleaned. The roster intentionally includes pending students; localized
  pending and active labels are checked against authenticated roster/API/SQL.
- Development attempts `3cbad49fe7fe92029c727320` and
  `3be6bc9934bb9869de76f80b` retain selector failures (two mounted home screens;
  Accept prefix also matching its `.label` child). Selectors now scope the current
  home and match the Accept button's numeric ID exactly. No app change is made.
- Status: implemented, focused locally verified; nine-project matrix/repeat proof
  remains pending. Save retry and unrelated denial remain disabled placeholders.

- Matrices `69ce54c472eebb5bfa1d8659` and `a61f61dc206e580b6e050544`
  pass 18/18 cases and 144/144 assertions with independent fixtures/backends and
  cleaned teardown. Scenario and governing requirement hashes match across the
  two runs. Status: connection approval locally verified; T11 remains In progress
  with save retry and unrelated denial still disabled.
- Typecheck, touched lint, formatting, 12 focused harness contracts, 300-file
  inventory and seven-schema provenance pass. Units remain 1688/1689 with only
  the established password-reset route mismatch. No product/public API/schema/
  localized-copy change; governing requirements already describe the tested flow.
- Evidence: `connection-phase-report.json` under the P3 evidence root. Next:
  save-retry using private account-scoped pre-forward fault control and actual
  draft/error/API/SQL observations; preserve exactly one durable final change.

### T11 save retry kickoff

- Scope: integration coverage only. Governing plan Sections 8/16/19, SC-208,
  UC-002.22, AC-223 and BR-293/294. Use the seeded coach and local catalog through
  actual login/search/save UI; private control arms one POST `/plans/training`
  fault before forwarding. The control binds the selected attempt and coach token.
- Enter a new named session, exact exercise/quantity/notes and prove no draft
  writes. Failed save must retain all draft values, expose existing error feedback
  and leave API/SQL unchanged. Clear the fault (exactly one injection), retry via
  UI and prove one new complete plan and unchanged original domain rows. Restart
  the owned API and reload/reopen from the library; no second plan may appear.
- Source review: mutation errors retain ready state with `backgroundError`;
  initial load errors are a separate full-screen state. Assert the rendered error
  banner using existing localized generic copy, without mocking `Alert.alert`.
  Nine-project matrix and fresh repeats follow focused Chromium proof.
- No product/auth/public API/data schema/localized-copy change is proposed.

- Focused Chromium run `af02dabb4feb0f165764ef80` passes all eight assertions
  and cleanup. Original failed attempt `9670900e2d2b29c29c8c194b` retains the test
  token-capture failure; baseline helper now uses the normal UI sign-in response.
  The private arm step waits for catalog reads to settle, matching its idle guard.
- Status at kickoff: implemented with focused proof; later matrix results are recorded below.
  Unrelated denial was the sole disabled registry scenario at that point. No product/API/
  schema/localization changes were needed.
- Existing SC-208 error-banner suffix `Background update failed` is a user-facing
  English literal. The test records its actual text in private evidence and checks
  the localized generic error prefix; retry proof does not qualify all error copy
  as localized. The existing wiring checklist tracks the copy gap as Pending.

### T11 unrelated denial kickoff

- Scope: test coverage for the existing private SC-208 professional library and
  plan Sections 8/16/20. Reuse the seeded owner plan, independent unrelated coach,
  real UI sign-in, owned proxy and read-only scoped SQL control. Both accounts
  are professionals with completed onboarding; validate their `/me` identities.
- Establish successful owner read and exact existing SQL state before probing
  the same ID from the other context. Its real builder read/retry must return the
  existing non-disclosing 404 `not_found` contract and localized load-error state.
  Normal PATCH and DELETE routes must deny valid requests and preserve complete
  scoped training/connection state. Restart/reload must preserve denial and owner
  state; actual observed request origins remain the owned proxy.
- Eight assertion IDs are declared before enabling the scenario. Focused proof,
  nine-project matrix and a fresh repeat are pending. Default selection now
  requests all five implemented cases; implementation is not a passing result.
- Governing source reviewed: server route error mapping, read/mutation ownership
  guard, server README plan contract, SC-208 private-library/error behavior and
  client error-card/render branch. No app/auth/security/public API/schema/copy
  behavior changes are made, so no FR/BR/UC/locale changes are needed.

### T11 save-retry completion and denial focused proof

- Save-retry runs `e735cee7615af87f861ae706` and
  `22c12447c9f1638a0f8bf9cb` pass 18/18 cases and 144/144 assertions.
  Per-project scenario/requirement hashes match across the frozen runs. Subsequent
  planning-only rubric/status edits change the current requirement fingerprint;
  preserve historical receipts and refresh the combined matrix before promotion.
- Twenty strict public receipts (including retained focused development failure)
  and every referenced proof path validate. External cleanup checks all four
  run projects and 89 recorded PID/start pairs: no surviving identity, unknown
  process query, container/network/volume, private Expo cache or control socket.
  Report: P3 `save-retry-phase-report.json`. The existing English error suffix
  remains a separately tracked localization gap.
- Unrelated denial focused run `321c0ffca77e0bbdd1799acd` passes all eight
  assertions and cleaned teardown: independent same-role login identities, known
  owner read/SQL baseline, UI read/retry denial, normal PATCH/DELETE denial,
  unchanged complete scoped domain state, restart/reload and owned request origin.
  No product authorization or error-copy behavior changes.
- Current next action: freeze final source/docs/inventory, execute all five cases
  in all nine projects and a fresh repeat; reconcile requested/started/assertion
  counts and owned cleanup before declaring T11 locally verified. Native/hosted
  promotion remains Pending.

### T11 complete combined matrices and runner reconciliation

- Full default runs `4075bdeb8ed20066aa07bd3f` and
  `b8cb223353d8b7182af96b78` each request/start/pass all 45 cases across five
  scenarios and nine projects. Total: 90/90 cases, 702/702 assertions, retries
  zero, no application failure/block/cancellation or cleanup failure. Per-attempt
  scenario and requirement hashes match across both frozen runs.
- The denial focused receipt and 90 full-matrix receipts validate against the
  public schema with every proof path present. External cleanup checks three
  projects, 96 PID/start pairs, three initial API PIDs, Docker containers/networks/
  volumes and private cache/socket paths: zero survivors or unknown queries.
- The first impact check exposed four missing suite registrations. Registered
  every integration spec with `ci: false`, correct scenario grep and nine projects,
  linked to affected features. Impact validation now passes (12 features, 43
  suites, 62 UI specs). The selective executor adapter remains deferred to T18.
- The initial focused harness check retained an outdated default-placeholder
  assumption (11/12). It now accepts all implemented scenarios and still rejects
  an independent copied unfinished selection; final focused contracts pass 12/12.
  The live full-selection rejection probe now uses a forbidden inherited bypass
  and verifies all 45 blocked receipts before acquisition. This preserves the
  negative contract without depending on an unimplemented product journey.
- Updated actual runner verification passes all 11 rejection, worker/acquisition
  SIGINT/SIGTERM and deadline probes. Receipt:
  `.qa/artifacts/testing-modernization/2026-09-28-p3/integration-verifier-2026-09-29T01-42-28-251Z/receipt.json`.
- Typecheck, touched/full lint (existing warnings), impact, schema provenance,
  formatting and 302-file inventory pass. Final units: 1688/1689; sole failure
  remains the established password-reset confirmation route mismatch. No skip or
  relaxed assertion was introduced. No app/auth/API/schema/localized-copy change.
- Evidence: P3 `combined-phase-report.json` and `save-retry-phase-report.json`.
  Later reporting/status and inactive suite/test-verifier edits do not alter
  scenario execution behavior; per-attempt fingerprints remain authoritative.
  Refresh source/requirement/build inputs before later CI/native promotion.
- Status: T11 locally verified; full plan incomplete. Next: T12 native inventory,
  runtime testability and dedicated target/build ownership. Maestro 2.6.1 exists;
  both native binaries exist but their current source/environment qualification
  is unknown. Android has no connected device; the booted iOS ET-233 simulator
  belongs to other work and was preserved. No native run or selector-tree proof
  occurred. Observation: P4 `native-preflight.private.json`. P4–P6 remain Pending.

### T12 native inventory/testability kickoff

- Scope: five integrated pilot families on both platforms, with en-US/pt-BR/es-ES
  variants explicit. Source graph declaration, portable schema/helpers, actual
  native selector observations and narrowly scoped runner reuse; no app behavior
  changes or fixture-based replacement for required Postgres proof.
- Governing docs: plan P4/T12–T15, SC-217/SC-213/SC-208/SC-211/SC-204/SC-205,
  UC-002.3/9/22, AC-214/223, BR-230/293/294 and scoped TC-296/278/303.
  TC-295 unlocked onboarding, TC-270 assigned-copy native validation, QR success
  and camera-less fallback are distinct branches; do not claim them from the
  baseline families. TC-304 is unsaved-back behavior, not save retry.
- Declaration: 20 source views, 32 transitions, five families and ten platform
  scenarios, all untested/unknown. Vendored inventory schema, manifest/freshness
  helpers have hash provenance. No local skill directory is needed on CI.
- Existing infrastructure to reuse: host-lock shell wrapper, owned session/proxy,
  process-group guard and isolated Expo cache lifecycle. Native startup must use
  a distinct health contract, qualified current build and explicit target.
- Next: validate declaration/negative contracts; create a dedicated owned iOS
  simulator under the host lock, build into its private artifact directory,
  establish current Metro/API configuration and capture its real entry tree.
  Foreign ET-233 simulator stays untouched. Android qualification is separate.
- No FR/BR/UC/screen/localization behavior changes are proposed. These artifacts
  clarify testing scope and pending native evidence only; no native pass claimed.

### T12 entry capture implementation and first native observation

- Implemented the source declaration validator and owned iOS target/capture
  helpers. Four focused contracts pass: unknown evidence stays in denominators,
  missing cells/graph/path escapes are rejected, fabricated target claims fail,
  and foreign simulator identities cannot pass the cleanup guard. The portable
  inventory remains 20 unobserved views, 32 transitions and ten untested cells.
- Current inventory enumerates 304 test files (242 client, 62 server). Native
  helpers, vendored tooling, declaration paths and future `.maestro/**` changes
  now trigger conservative test-impact fallback; no CI lane was activated.
- Native observation `abb4965c343070fc0fe556f5` built the current Debug app
  successfully on a newly owned iPhone 17/iOS 26.5 simulator, using isolated
  Metro and Postgres/API resources. The hierarchy contained the app's startup
  download screen rather than sign-in selectors. Result: harness-blocked,
  zero native passing cases; original hierarchy/build/ownership receipts retained.
- External cleanup verifies all 15 recorded PID/start pairs absent, the owned
  simulator deleted, every pre-existing simulator preserved, no owned Docker
  container/network/volume and no private Metro cache. Report: P4
  `native-entry-first-cleanup.json`. Existing shared CI recovery state was read
  but not modified or adopted.
- Corrected capture teardown and bounded child deadlines. Added a single
  90-second visible-state readiness wait, three required selectors and private
  startup/debug screenshots before hierarchy qualification. This addresses the
  observed startup race; it is not a retry of a failed journey or a passing flow.
  Final source identity is checked even on capture failure; backend ownership
  IDs are recorded for external recovery checks.
- Browser compatibility verification passed real HTTP login, configured and
  observed owned origin, occupied foreign-port preservation, cancellation and
  cache lifecycle. Receipt: P3 `expo-2026-09-29T02-13-40-197Z/receipt.json`.
  P4 `web-compat-cleanup.json` independently checks 23 PID/start pairs and all
  owned Docker/cache resources absent. This is shared-helper compatibility
  evidence, not a fresh full five-journey browser matrix.
- No app/API/auth/schema/copy behavior changed. T12 remains in progress:
  rerun the changed capture, observe sign-in and remaining journey selectors,
  qualify Android separately, then build T13 execution contracts. T14–T20 and
  all native adoption/hosted gates remain pending.

### T12 selector false-positive rejection and native dependency remediation

- Capture `661f261159a241a8e258226a` completes the bounded readiness probe and
  records sign-in IDs, identical before/after source fingerprints and a new
  Debug binary. Its original observation exit/result is retained. Screenshot
  review shows a development error overlay: `ExpoSecureStore` cannot be found.
  Qualification is **rejected**, with zero passing native cases/readiness cells.
  Report: P4 `native-entry-readiness-qualification.json`.
- Installed Podfile/Pods manifests and generated native provider omit the
  existing `expo-secure-store` 15.0.8 dependency. Current autolinking resolves
  `ExpoSecureStore` and `SecureStoreModule`; this is build dependency drift,
  not permission to change the documented auth/storage contract.
- Added pre-build registration/manifest guards and fatal bootstrap diagnostic
  rejection. Six focused contracts pass, including missing module/provider,
  mismatched manifest and fatal overlay cases. The actual current missing-pod
  preflight rejects before target acquisition. No test hides the overlay.
- External cleanup checks 16 PID/start pairs, owned device absence, all
  previous simulator identities, private cache and Docker resources: clean.
  Report: P4 `native-entry-readiness-cleanup.json`.
- Next: normal CocoaPods reconciliation for already declared dependencies;
  validate registration before a fresh build/capture. Add an explicit native
  no-Origin request profile to the private proxy before real native sign-in;
  keep browser Origin rejection unchanged. Android SDK/images are available,
  but a dedicated owned target and native qualification remain pending.
- No app/API/auth policy, token-storage implementation or localized copy
  changed. T12 and every native adoption/hosted gate remain in progress/pending.

### T12 installed native dependency alignment and explicit transport profile

- Normal `pod install --no-repo-update` succeeds; current Expo autolinking,
  Podfile.lock, installed Pods manifest and provider registration pass. The
  resulting lock adds ExpoSecureStore 15.0.8 and aligns native Expo/RevenueCat/
  Reanimated dependencies and local paths with the existing client Yarn install.
  JavaScript Expo remains 54.0.33, React Native 0.81.5, purchases/paywalls 9.10.5;
  no JS dependency upgrade or provider operation was performed. Earlier native
  locks referenced different versions and the parent dependency directory.
- Podfile.lock changes are retained as dependency alignment, not labelled a
  SecureStore-only diff. A fresh native build and screenshot/runtime health
  evidence remain required; provider/store/payment qualification is separate.
- The private proxy has an explicit native profile for normal no-Origin bearer
  requests. Browser remains the default; supplied foreign Origins and invalid
  host/upstream/path identities remain rejected. The actual transport verifier
  now checks native bearer sign-in/read, missing auth rejection, foreign Origin
  denial, private observation redaction and teardown alongside existing browser
  fault/restart/deadline guards. Execution evidence is still pending here.
- Added preflight receipts before resource acquisition and private bootstrap
  logs. Native module/runtime preflight contracts pass 2/2 (six focused native
  tests including inventory/device ownership). Product storage/auth policy and
  app code are unchanged; no requirement or localized-copy rewrite is needed.

### T12 transport proof and graph reconciliation

- Native/browser proxy verification completes two fresh owned API/DB runs.
  Native requests without Origin return sign-in 201 and authenticated read 200;
  no-auth read returns 401 and a supplied foreign Origin returns 403. Default
  browser no-Origin rejection, scoped fault/retry, restart, deadline and secret
  redaction guards pass. Receipt: P3
  `proxy-2026-09-29T02-42-13-024Z/receipt.json`; P4
  `native-profile-proxy-cleanup.json` verifies both projects/processes absent.
  This proves transport only, not native storage/session restoration.
- Added generated source-only overview/family flowcharts and path-continuity
  validation. The training path now includes the second save after edit before
  relaunch/read; disconnected sequences reject. All 20 views/32 transitions/ten
  native scenarios remain unqualified; empty Maestro index remains non-passing.
- Six focused native contracts, typecheck, formatting, touched helper lint,
  impact validation and the 305-file test inventory pass. No app/auth behavior
  or user-facing copy changed. Fresh native bootstrap/build/runtime evidence is
  next; the prior false-positive observation remains rejected and retained.

### T12 first qualified iOS entry and build-reuse preparation

- Capture `d2d7c3b6086e6970bac5bdfd` observes the normal sign-in screen after
  native dependency alignment. All three selectors are present, screenshot
  review shows no error overlay, fatal bootstrap checks pass and before/after
  source fingerprints match. Embedded server origin matches the declared owned
  proxy. Scope: one iOS entry view; Android and the other views remain unknown.
- External cleanup checks 16 PID/start pairs, owned simulator absence, every
  previous simulator identity, private cache and Docker resources. Report: P4
  `native-entry-registered-cleanup.json`; private run qualification records
  screenshot/cleanup review and binds source/binary identities. Zero native
  journey passes and zero ready replacement cells are claimed.
- Added immutable Debug byte reuse with current source/hash/profile/runtime
  checks, native embedded-config validation and fresh fixed-endpoint reservation.
  Never reuse the prior simulator, server/session or Metro process. Actual auth
  source and embedded app.config prefer the compiled extra.server URL, so
  endpoints cannot silently change when reusing the binary.
- Eight focused native contracts pass, including stale/rejected/modified build
  rejection and occupied-port refusal. An initial cache-contract fixture used
  macOS's noncanonical temporary alias and was rejected by the guard; the test
  now uses the canonical temporary root without relaxing production guards.
- The private auth/account charter is implemented for runtime selector and
  transport observation. Next: fresh source/format/impact checks, actual cached
  capture on newly owned resources and screenshot/cleanup review. Full public
  T13 runner, Android qualification, T14/T15 comparison and later gates remain
  pending. No app/API/storage policy or localized-copy behavior changed.

### T12 auth/account observation and precise implementation handoff

- Cached-byte capture `9ddebe32b987b987d136cd85` ran on a fresh owned iOS
  target/API/DB/Metro. Sign-in reached coach home, account, sign-out confirmation
  and cancellation. Terminate/relaunch then displayed sign-in instead of the
  expected coach home. The original result remains `harness-blocked`, exit 2,
  with zero native journey passes. Cause remains unresolved; do not infer a
  product defect or weaken the restoration expectation from this observation.
- Private failure screenshot and command tree live under the run's
  `restored-home-artifacts/2026-09-29_000821/`; screenshot review confirms the
  visible sign-in state. Source fingerprints match before/after. The capture's
  partial observations do not qualify the complete session family or Android.
- External cleanup verifies 25 PID/start pairs absent, the owned simulator
  deleted, all previous simulator identities retained, and Docker/cache absent:
  P4 `native-auth-account-first-cleanup.json`. Browser compatibility smoke
  `expo-2026-09-29T03-06-35-970Z/receipt.json` passes its declared scope; P4
  `web-compat-build-reuse-cleanup.json` verifies 22 PID/start pairs and owned
  Docker/cache cleanup. Neither result completes the native adoption matrix.
- Plan Section 21 now supplies small packets for observation validation,
  platform-specific selector evidence, public wrapper contracts, each of the
  five equivalent native families and measured comparison. It explicitly
  preserves this restoration failure and prohibits signing in again to hide it.
  Existing T00–T20 dependencies, adoption thresholds and delivery boundaries are
  unchanged. Official Maestro selector/AI documentation was rechecked.
- This handoff revision changes only the plan/status documentation. No product
  contract, FR/BR/UC, screen copy, locale, API/storage policy or CI change is
  needed. Next: classify the relaunch observation and strengthen imports before
  promoting partial native observations; complete remaining platform inventory.

### T12 restoration diagnosis kickoff

- Task/owner: T12-A, client internal inventory capture. Prerequisites: retained
  first auth/account failure and externally verified cleanup; qualified immutable
  entry bytes `d2d7c3b6086e6970bac5bdfd`; no live owned run remains.
- Governing behavior: TC-296 locked-role relaunch, native bearer runtime and
  `restoreServerAuthSession`. The source restores an unexpired session locally
  and refreshes only expired tokens. The charter's unconditional refresh check
  is corrected to require post-relaunch `/me/hydrate` through the owned proxy;
  correct identity and home remain required. This does not waive the first
  visible sign-in failure or claim it fixed.
- Added read-only AsyncStorage presence/shape observations with value redaction,
  owned-device private system diagnostics and transport retention on failed
  attempts. Five focused storage/build/bootstrap contracts and typecheck pass.
  Source signing inspection shows a linker/ad-hoc signature without application
  entitlements; secure-storage impact remains a hypothesis. No product signing,
  auth, copy or storage change is made.
- Next command: existing host-lock capture, `--platform=ios --mode=inventory
--reuse-build=d2d7c3b6086e6970bac5bdfd --charter=auth-account`, using fresh owned
  target/data/Metro and unchanged qualified bytes. Expected evidence: original
  result, metadata before/after, post-relaunch transport, screenshots/tree and
  cleanup. This diagnostic attempt cannot qualify T14/T15 behavior coverage.

### T12 diagnosed missing simulator keychain identity and control preparation

- Diagnostic capture `d62df5f8f1f5f5d6dc92af10` remains blocked with the original
  restored-home child failure. Before and after relaunch, no AsyncStorage
  manifest/session metadata is present. The owned-device security log records
  OSStatus `-34018`: client has neither application-identifier nor
  keychain-access-groups entitlements. This establishes a packaging failure
  for the linker-signed test binary; it does not prove a product storage defect.
- External cleanup: P4 `native-auth-account-diagnostics-cleanup.json` verifies
  24 PID/start pairs absent, owned device removed, previous devices retained,
  and Docker/cache absent. Failure transport is retained and no native journey
  pass is claimed.
- Implemented a separate run-owned simulator install copy with local ad-hoc
  application/keychain entitlements, actual metadata/signature verification and
  original-byte immutability. Device/production app metadata and public artifact
  roots reject. Installed path/hash/profile is separate from source build identity.
  Seven focused guards/storage/build/bootstrap tests pass. This modifies only
  disposable testing artifacts; no product auth/storage, developer credentials,
  production signing/configuration or localized copy changes.
- Next: actual signing preflight and fresh-target auth/account control capture;
  review restoration screenshots/transport/metadata and externally verify cleanup
  before recording even a limited observed result. Full native matrix remains pending.

### T12 host-signature rejection and Xcode simulator embedding

- Direct-sign control `089736875393233afec606dc` installs but fails at launch;
  original exit 2/blocked receipt is retained. Its owned-UDID host log records
  AMFI error `-424`, restricted entitlements in an ad-hoc host signature. Static
  codesign verification passed but did not establish launchability. External
  cleanup checks seven PID/start pairs, owned/previous simulator identities and
  Docker/cache: P4 `native-auth-account-signed-control-cleanup.json` passes.
- Inspected existing Xcode simulator outputs: host `.xcent` is separate from
  `-Simulated.xcent`, and simulated entitlements occupy Mach-O
  `__TEXT,__entitlements`. Replaced direct signing/copy code with private Xcode
  simulator entitlement input, ad-hoc build arguments and verification of the
  actual Mach-O simulator platform/embedded identity and signature. No runtime
  security bypass, original binary mutation, developer credential or production
  signing configuration change is made. Failed artifacts remain intact.
- Eight focused guards/storage/build/bootstrap tests pass. Reuse now rejects an
  old binary lacking embedded simulated entitlement identity before target/data
  acquisition. Runtime/system diagnostics are retained before target cleanup on
  launch failure as well as restoration failure.
- Next eligible command: host-lock capture `--platform=ios --mode=inventory
--charter=auth-account` with a fresh Xcode build/resources. Do not reuse the
  previous unsigned entry binary for the restoration control. Required result
  remains actual persisted/restored identity plus cleanup; no native pass/adoption
  claim is supplied by these harness changes.

### T12 Xcode build/runtime and iOS credential-save branch

- Fresh Xcode capture `b3dafc28dbcd7f4e873d0d92` builds successfully, verifies
  embedded simulator identity/signature, launches and signs in with a real 201.
  The app guard reaches the professional home route. The next actual hierarchy
  is covered by iOS `Save Password?`/`Not Now`, so the original capture remains
  blocked at coach-home observation. It does not prove restoration.
- The host `.xcent` is empty; simulated `.xcent` has the declared local
  application/keychain identity. No actual `Code=-424` or `-34018` security
  error is found in the owned runtime log. Substring matches inside request UUIDs
  are not OSStatus evidence. Entry screenshot review shows normal sign-in with
  no error overlay. Source before/after matches and build bytes are retained.
- P4 `native-auth-account-xcode-control-cleanup.json` verifies 17 PID/start pairs
  absent, owned simulator deleted, previous devices retained, Docker/cache absent.
  Original failure and hierarchy stay private and unchanged.
- Added explicit fresh-English-simulator credential-save observation/decline and
  screenshot retention before hierarchy rejection. Declared iOS-only setup state
  and two edges; metrics now separate iOS 21 views/34 transitions from Android
  20/32. Ten core scenarios stay untested and no portable runtime pass is imported.
- Reuse of blocked-charter bytes now requires a separately reviewed `entry-only`
  qualification, exact entry evidence hashes/files/selectors and all prior
  cleanup/source/binary/config guards. It cannot convert the blocked charter into
  a pass. Missing entry proof and modified observations reject in focused tests.
- Read-only Android preflight: installed Maestro 2.6.1 does not consume the usual
  non-default ADB server environment variables. Hidden `--host`/`--port` flags are
  recognized and installed bytecode routes a supplied port to direct device
  Dadb connection; actual owned-emulator qualification is still required. P4
  `android-maestro-connectivity-preflight.json` records jar hashes and upstream
  issue 3461. No Android resource or passing observation is claimed.
- Next: fresh resources using separately qualified entry bytes, observe/decline
  the real OS prompt, then prove account/relaunch/sign-out observation and cleanup.
  Product behavior, signing configuration and localized app copy remain unchanged.

### T12 launcher-exec cleanup correction

- Capture `cc806c8317a6ffef5bafefd0` is terminal exit 2. Initial Maestro
  accessibility querying returned `kAXErrorInvalidUIElement`; no sign-in,
  credential-save, restoration or native journey pass was established. Its
  original blocked/failed-cleanup receipt is preserved. Reviewed initial image
  shows the launch splash; it is not an entry qualification.
- The recorded directly spawned PID/start matched the remaining Java leader,
  but the installed Maestro launcher uses POSIX `exec`, changing command hash.
  Verified same UID/group, installed classpath and exact owned target/input;
  stopped only that leader. Private `launcher-exec-recovery.private.json` records
  the recovery. P4 `native-auth-account-password-prompt-control-cleanup.json`
  verifies 13 PID/start pairs absent, owned device deleted, prior devices retained,
  and Docker/cache absent. Original cleanup failure remains part of history.
- `owned-process-group.ts` now records exec transitions only for the same live
  directly spawned leader with unchanged start/user/group. Reused identities,
  foreign users and unknown orphan members remain rejected. Capture cleanup
  preserves the initial command failure when cleanup also fails.
- Three focused process-group tests pass, including gated real launcher exec,
  TERM-ignoring descendant escalation and separate-group preservation. Typecheck,
  impact (12 features/43 suites/62 UI specs), formatting and whitespace checks
  pass. Initial touched lint had two unnecessary-assertion warnings; removed
  those assertions; touched lint and all three focused tests now pass again with
  zero touched lint warnings. Inventory remains
  308 files. No product contract/copy/localization/FR/BR/UC update is required.
- Next: a new bounded fresh-resource auth/account observation with the same
  separately qualified build bytes and the corrected ownership helper. This is
  a diagnostic control, not an implicit retry or measured adoption attempt.
  T12 observation qualification, both-platform work and T13–T20 remain pending.

### T12 restoration observation and native sign-out contract reconciliation

- Fresh control `910fb05ccbb13556e4ffe957` is terminal exit 2/blocked. It observed
  entry, iOS credential-save prompt/decline, home/account, sign-out confirmation
  and cancellation, restored home and exact identity, then signed-out UI. It
  does not prove signed-out relaunch yet. Native passing-case count stays zero.
- Persisted session metadata is present before/after relaunch with profile and
  expiry, without plaintext access/refresh fields. Post-relaunch `/me/hydrate`
  returns 200 through the owned server. Screens/trees/private diagnostics remain
  in the original bundle, with original failure unchanged.
- The last probe wrongly required native `/auth/session/sign-out` transport.
  Current `FR-270`, `BR-342`, and `clearPersistedServerAuthSession` explicitly
  retain local native clearing; credentialed server logout is the browser-cookie
  contract. The inventory charter now checks metadata absence after normal UI
  sign-out and signed-out process relaunch. It does not qualify server revocation.
- P4 `native-auth-account-exec-control-cleanup.json` externally verifies 34
  PID/start pairs absent, owned device deleted, all previous devices retained,
  and Docker/cache absent. This run has normal cleanup without manual recovery.
- The plan's T14/T15 native session server-revocation requirement conflicts with
  the current local-clear baseline and no-auth-change scope. Keep that requirement
  pending with owner client/server maintainer: resolve intended auth scope before
  claiming session-family completion; no test-only API or weakened expectation.
  Other native inventory/families remain independently eligible.
- Next: validate the corrected bounded inventory charter, then qualify its actual
  limited observations through strict artifact validation. Product auth/storage,
  documentation contracts and copy are unchanged; FR/BR/UC/locales need no behavior
  update. Full P4–P6 remains incomplete.
- Corrected-charter validation: eight focused storage/build/bootstrap/process
  contracts pass. Typecheck passes after using typed metadata locals; touched
  lint has no errors/warnings. Formatting, regenerated declaration/manifest,
  inventory completeness and whitespace checks pass. Reviewed restored-home and
  restored-identity screenshots show normal app surfaces without an error overlay;
  exact identity comparison remains the private Maestro/tree assertion.

### T12 limited iOS view qualification and signed-out relaunch

- Local-clear control `0abd8f86290bc99a91d703b1` is terminal exit 0 as an
  inventory observation, with normal cleanup and zero native journey passes.
  Persisted metadata is absent after UI sign-out and after signed-out relaunch;
  authenticated restoration and exact identity observations remain in the bundle.
  The server-revocation contract question is still pending; user clarification
  was requested while independent native work continued.
- External P4 `native-auth-account-local-clear-control-cleanup.json` verifies 35
  PID/start pairs absent, owned simulator removed, prior devices retained and
  Docker/cache absent. No original failure receipt is changed or excluded.
- Added `native-view-evidence.ts` and `qualify-native-views.ts`; the existing
  inventory validator now awaits actual artifact qualification. Screenshots were
  reviewed individually; canonical private files, exact hashes/tree attributes,
  source/build/environment/fixture/device identity, bootstrap and external cleanup
  are checked. New private receipts/clones leave portable inventory unchanged.
- Limited runtime map: SCR-sign-in, STATE-password-save, SCR-pro-home, SCR-account
  and STATE-signout-confirm captured on iOS: 5/21 views. Android is 0/20; transitions
  are 0/34 and 0/32; behavior remains 0/5 per platform. This is neither full T12 nor
  a T14/T15 session-family pass. Other families/platforms/locales remain pending.
- Five focused inventory/file/fingerprint tests pass; actual-artifact validation
  accepts all five views and rejects seven wrong identity/hash/missing/unmapped
  cases. Invalid qualifier argv exits 2. Typecheck, touched lint (zero warnings),
  impact (12 features/43 suites/62 UI specs), formatting and whitespace pass in
  their recorded scope. Inventory JSON typing follows schema validation rather
  than unchecked JSON use. Product contracts, auth code and locale copy unchanged.
- Next: T12-B training/connection/camera/retry actual trees and owned Android
  connectivity, then T13 public runner and remaining gates. Qualifier receipt
  paths are versioned by input fingerprint; after this documentation refresh,
  regenerate the declaration and requalify with current source-reference hashes.
- Final source-reference refresh qualified the same five views with private suffix
  `516d1bf26258`; earlier qualification `ccbe252bace7` remains historical. The latest
  private inventory/metrics are under the original capture directory. Inventory
  now contains 309 files (247 client/62 server). Full client unit execution still
  fails on the existing password-reset-confirm route mismatch. Full lint exits 0
  with zero errors/3,043 suite-wide warnings; the five files touched for this
  qualification pass focused lint with zero warnings. Typecheck, inventory,
  impact, touched formatting and whitespace pass. Broad logs: P4
  `native-view-full-unit.log` and `native-view-full-lint.log`. No full-suite green,
  native family pass, CI promotion or auth change is claimed.

### T12-B Android recovered quantity visibility packet (In progress)

Scope: extend existing `observeNativeTrainingLoad` with an Android-only
`load-recovered-quantity` observation. After exact recovery, scroll normally
to the lower `pro.training_plan.saveButton` without tapping it, then capture
quantity/session and require the same full recovered-content/SQL/transport
contract on that tree. Preserve original recovered/error frames. A new
reviewed auxiliary quantity frame is mandatory for current Android load
qualification; preserve iOS behavior and every prior receipt. No warning
suppression, coordinates, product changes, Save or storage injection.

Acceptance: actual quantity unobscured in the fresh PNG; exact seeded quantity
in its session; all three SQL snapshots equal; normal single injected read and
retry read; fresh Android build/install/config/network; terminal and external
cleanup including foreign state preserved. This also proves the shared capture
executor's Android positive path only when actual commands finish/clean.
Qualification remains view-only with zero transition/behavior passing cases.
If supported scrolling fails to expose quantity, preserve that failure and
classify before any changed attempt. Do not mark T12/T13 complete.
Changed paths: existing load observer, current view validator and docs;
no FR/UC/BR/localization update because product behavior is unchanged.

Fresh linked Android `training-load` capture `5398138c523c45555fd19d22`
is live through the host-lock wrapper. Scoped 16 tests/zero skips, typecheck,
lint/format, impact (12/43/62) and diff checks pass. Actual fresh build,
quantity visibility and terminal cleanup remain Pending. Do not edit its
captured helper/app inputs while live. No transition/behavior pass is claimed.

First Android visibility attempt `5398138c523c45555fd19d22` is terminal
exit 2/cleaned. Fresh APK build/install/config/routing/sign-in and original
load error/retry/recovered frames complete. `scrollUntilVisible` to Save fails
its unchanged 20-second visible-element check; screenshot stays at the top
of the form with toast-covered quantity. No extra frame/final SQL snapshot
or full qualification. Shared executor has actual Android negative-path
proof: 18 completed commands, one original child exit 1, all 19 command
cleanups pass. Source/helpers stable; independent cleanup passes 96 owned
PID/start identities, six directories/cache/Compose absent, foreign iOS and
workspace APK preserved. Preserve failure; do not repeat unchanged.

Changed hypothesis: one `swipe` UP from exact fixture text `^Upper$`, a
visible session heading above the toast, avoiding the editable name at the
screen center. Maestro documents selector-based swipe; current native tree
proves the heading and scrollable screen, not successful scrolling. Require
actual fresh proof. The original recovered frame keeps full exact name,
error absence, SQL/transport contract. The extra reviewed frame requires
unique exact Upper session and its exact enabled 3x8 quantity; the name may
scroll out of view. Do not make full-name or data assertions optional in the
original recovery frame, suppress the warning, inject storage, or tap Save.

Fresh linked session-heading-swipe capture `936e8715f76402464f3fe33c` is
live. New quantity guard rejects missing/duplicate session, missing/duplicate
or detached quantity, wrong value, disabled content and retained error. Ten
focused load/view/inventory tests pass/zero skips; typecheck/lint, impact
(12/43/62) and diff checks pass. Native inputs frozen while live. Actual
visibility, full original recovery and cleanup remain Pending.

### D-218 canonical training title recipe alignment (In progress)

Current FLW-training still lists the old menu-open/menu-clear transitions,
while actual iOS saved debug proof aa3ae890e28cb19631472ac4 executes the
qualified paragraph gesture. Add two builder-to-builder transitions for
paragraph select and complete clear; use them in the shared training flow.
Retain original native-menu view and both menu transitions as unresolved
inventory coverage, plus all failed receipts. Denominators increase by two
(40 total/iOS transitions, 38 Android); no coverage cell is removed. All
transition/scenario execution statuses stay unknown/zero passing. Android
and Detox gestures remain unqualified. Seven canonical UI/API/SQL assertion
purposes and empty/exact title guards are unchanged. This records the current
normal test interaction, not product change or an adoption/evidence waiver.

### T13-A training assertion evidence mapping (In progress)

Add only the missing mapper in `native-training-pilot-evidence.ts`, reusing
canonical selection/ledger and existing saved-training UI/API/SQL verifier.
Map seven ledger purposes to exact captured native frames, six SQL snapshots,
three independent reads and normal app traffic. Emit one bounded private
artifact for each declared evidence kind using the existing path templates.
Validate the entire packet before any output; preserve duplicate/failure
records rather than overwrite. Returned evidence is preparation, never a
public receipt/outcome or native passing counter.

Explicit diagnostic mode may consume retained reviewed debug evidence,
labelled zero public passes. Runtime mode must reject inventory/preflight
records and require distinct terminal execution profile, exact selection
binding and independently verified cleanup. No automatic diagnostic fallback.
Public runner remains disabled until actual lifecycle, identity/selection,
assertion/freshness/finalization and both-platform prerequisites pass.
Current linked lifecycle smoke9da8c97417b31968be4af12f is live after fresh
host clearance; do not edit captured helpers/app inputs during that run.
No product/localization/auth or hosted effects are authorized by this packet.

### T13-A escaped-descendant cleanup implementation (In progress, 2026-09-29T16:17Z)

`owned-process-group.ts` now retains recorded escaped descendants in its
census and cleanup wait. Reused PID/start/user/command identity rejects;
original group signals and exact escaped PID signals are separate. Unknown
members of a new group remain foreign. Escaped signal decisions are retained
in private ownership ledgers. ADB release requires recorded exact command,
exclusive port5037 listener, no foreign known native job (rechecked after
query) and empty raw read-only device query; it cannot start a replacement
ADB server. Never signal its new group or a pre-existing untracked server.

Actual POSIX helper controls release an escaped recorded child and preserve
its subsequently created unknown group member; identity and ADB consumer
negative controls pass. Existing exec, timeout/cancellation, child failure,
TERM escalation and cleanup rejection controls pass:13 tests/zero skips.
Initial lint rejected seven warnings; typed ledger/import-order fixes retain
strict zero-warning validation. Fresh actual iOS callback and independent
cleanup without manual recovery remain Pending; do not claim T13 completion.
No product/localization behavior changes. Next linked smoke uses the same
unchanged callback script and qualified build, with fresh device/backend.

Fresh linked callback smoke `3f10f6da17c83e57a29db3ef` is live. Fifteen
focused process/command/lifecycle tests, typecheck, zero-warning lint/format
and impact12/43/62 pass. Captured helper/app inputs are frozen while live.
Automatic owned-descendant teardown and independent terminal cleanup are
Pending; no public native pass or complete training execution is claimed.

### Planning clarification: implementation entry point (2026-09-30)

Updated `docs/plans/2026-09-29-testing-modernization-start-here.md` with six
ordered delivery outcomes and a mandatory packet handoff. Removed its duplicated
current-dispatch claim; the top work card remains the sole dispatch authority.
Specification T00–T20, acceptance thresholds, BL-018/D-218 status and original
receipts are unchanged. Existing dirty implementation work is preserved.

Consulted applicable AGENTS, parent evidence-delivery/project-adapter, the
specification, entry point, task-card status, QA adapter, package scripts and
BL-018/D-218 discovery references. Official Maestro React Native/MCP docs were
refreshed. No product, API, schema, localization or CI behavior changed; no
FR/UC/BR/AC/screen/copy update is required for this planning clarification.

Validation: touched entry-point Prettier formatting passed; all five local
Markdown links resolve; threshold/dispatch consistency checks and
`git diff --check` passed. The first documentation check failed because it
searched for “100 UI actions” where the text says “100 actions”; the check was
corrected without changing the exploration budget. Runtime suites were not
rerun for prose-only changes. This is plan validation, not a native or hosted
acceptance receipt; full implementation remains in progress.

## Shared native connection source integration — 2026-10-01

**Done (source)** under BL-018/D-218/T14-C: one shared seven-purpose journey/evidence core with thin iOS/Android adapters. Actual capture, adapter and shared-journey imports are included in both helper ledgers and scenario freshness, including CI runner-slot and Java/XML reader inputs. Initial native coach auth must match the fixture UID allowlist, verified principal, API process/origin and one forwarded 201 within its exact transport window. The iOS setup requires four same-flow private prompt screenshot/command witnesses and actual post-dismissal home trees; the separate inventory prompt tree is not a connection assertion frame. Original failed attempts remain immutable. Canonical transfer, 92 focused controls, full isolated typecheck, zero-warning scoped lint and format pass. The corrected generator derives unique connection/training owner inputs from actual imports, and all three closure regressions plus 16 inventory/receipt controls pass. The exact validator .mjs mapper boundary correction is integrated; the earlier 98-control focused cohort is historical, and all 98 focused controls passed with the then-current declarations. The 100/100 YAML-repair cohort is also historical. The pre-recipe source cohort is 109 controls: YAML 100 + file-adapter 3 + web-profile 6. These source/static controls do not qualify native or public runtime evidence.

The later frame-path source correction is **Done (source)**: 64/64 current
focused connection controls, isolated typecheck, zero-warning lint and format,
and one private v12 replay read 48 real frame files and all seven UI/API/SQL
assertion recipes with iOS/Android projection parity. The initial 62/63 stale
native-declaration failure is retained historically; final 64/64 passed after
regeneration. This is a separate post-recipe source cohort, not an additive
110-control total; v12 verification remains failed unchanged and native/public
qualification remains **Pending**. Private proof:
`connection-frame-path-source-preparation-2026-10-01-v1/root-canonical-source-validation.private.json`.
Canonical source: `scripts/testing/native-connection-public-evidence-core.ts`;
portable regression: `tests/ci/native-connection-public-evidence-portable-frame-path.test.ts`.
Full isolated unit validation reports 1983 passing, one known unwaived password-reset route failure, and 34 skipped controls (2018 total); runtime/public qualification stays **Pending** with zero new passes. No product/auth/copy/provider behavior changes in this harness packet; FR/BR/UC/AC/screen/localized-copy rules stay unchanged.

### BL-018 v9 YAML failure source repair — 2026-10-01

Status: **Done (source)**; actual native qualification **Pending**. The exact shared iOS/Android connection-submit builder JSON-serializes the unchanged pending-card regex. A real YAML parser rejects the former invalid escape and accepts the corrected actions; selector semantics, command order and 90-second assertion bound are unchanged. The historical YAML-repair cohort passed 100/100 without skips; isolated full typecheck, zero-warning scoped lint, supported-file format, regenerated native declaration/schema, both test inventories, impact and whitespace checks pass. YAML 2.9.0 is a direct development test dependency at the already locked version. The unsupported Prettier yarn.lock check is retained; it is not a source-format failure. Private proof: `shared-native-connection-integration-2026-10-01-v1/root-yaml-source-validation.private.json`. No FR/UC/BR/AC/copy/auth/backend behavior changes. Original v9 remains harness-blocked/cleaned with zero passes.

### BL-018 independent source integrations — 2026-10-01

**Done (source)**: auth flow-atlas impact/workflow project selection matches the actual `mobile`, `tablet`, `web` profile, with a retained fail-before/pass-after parity control and 6 canonical checks. Nonblocking workflow behavior and `ci:false` remain unchanged; hosted/browser execution is **Pending**. Private proof: `web-flow-atlas-project-parity-2026-10-01-v1/root-canonical-source-validation.private.json`.

**Done (source)**: the bounded locale hierarchy-file adapter and its existing parser/validator controls pass 25/25, full isolated typecheck, zero-warning lint and format. Exact hierarchy bytes are privately read/hashed; hostile runtime metadata and read/parse failures cannot project locale. Capture binding/wiring, actual OS/hydration/reset/relaunch/cleanup and public locale qualification remain **Pending**. Private proof: `locale-native-file-observation-preparation-2026-10-01-v2/root-canonical-source-validation.private.json`. The transparent locale seam passes its original 13 rendered controls; v12 retained four preliminary entry locale IDs, but OS reset, relaunch, hydrated runtime qualification and public locale remain Pending, with zero native/public passing cases. No product/copy/auth/backend-provider changes.

### 2026-10-02 connection diagnostic integration worksheet

BL-018 / D-218, T13/T14 source integration is Done (source); runtime Pending. Integrate the independently
reviewed connection post-tap diagnostic delta onto the reviewed camera capture
source, preserving the current helper closure. The initial sign-out CTA and mandatory
confirmation CTA retain their existing selectors and final signed-out assertion.
Store owned diagnostic evidence immediately after the initial tap and retain it
when confirmation lookup fails. This is a changed diagnostic control for the
unexplained v13 failure; it creates no native or public pass and does not establish
the cause. Validate three portable helper controls, lifecycle/closure controls,
full isolated TypeScript, zero-warning scoped lint and formatting before recording
source completion. Validation passed: 65/65 combined controls, full isolated
TypeScript, zero-warning lint and formatting. Initial stale declaration and lint
registration warnings remain in private logs; the final declaration and explicit
ignored test registration repair pass. Product/auth/copy/provider behavior is unchanged.

### 2026-10-02 changed-input native preflight

The next private connection diagnostic attempt is **blocked before resource
acquisition**. Fresh read-only preflight confirms no known native job and the
retained app source/build bytes still match, but available disk is 14,990,352,384
bytes, below the unchanged 21,474,836,480-byte guard. No device/backend/port was
acquired, no retry ran and no receipt was reclassified. Inspect only clearly
disposable owned compiler caches for safe recovery; preserve app binaries and
all original evidence. Independent source work continues. Proof:
`ios-connection-v14-owned-diagnostic-runtime-2026-10-02-v1/preflight.private.json`.

### 2026-10-02 connection v14 terminal and next source repair

**Native diagnostic attempt terminal: harness-blocked / cleaned / sealed.**
The current app build and 777 frozen inputs matched; 72 helper inputs stayed
unchanged. The attempt completed five owned commands, then `probeApiLifetime`
looked for nonexistent `api-first.json`. The actual server initial API ledger is
`api-session-start.json`; no account-switch callback or post-tap diagnostic ran.
This is a concrete owned producer/consumer filename mismatch, separate from the
unexplained historical v13 confirmation failure. Independent cleanup passed
with 116 PID/start pairs absent; 61 original artifacts are sealed. Native/public
passing cases remain zero. Proof:
`ios-connection-v14-owned-diagnostic-runtime-2026-10-02-v1/observed-native-v14-terminal.private.json`.

Next source unit: reconcile the logical native first-attempt ID (`runId:first`)
with the real initial API ledger (`session-start`) in the existing owned lifetime
probe. Verify run/owner/process/start/script/origin and current manifest before
returning logical first identity; a restarted/different process must reject
rather than reuse first provenance. Keep actual ledger receipt and manifest
binding, abort checks and schema/privacy guards. Add a portable actual-file
regression and wrong-identity/restart negatives, then full isolated TypeScript,
zero-warning lint and formatting. No product/auth/provider/copy changes; no
FR/UC/AC/BR/screen/localization updates are needed. Do not retry unchanged.
Source is unfrozen after the terminal seal; root remains the integration owner.

Disk recovery removed only compiler caches from three completed independently
cleanup-verified owned captures. All three app hashes and 3,144 protected files
remain unchanged; no historical result was reclassified. Fresh preflight passed
with 24,931,008,512 bytes available and no known native job. The original failed
disk preflight remains immutable. Retained build reuse is explicit; v14 is a
diagnostic attempt and does not count as a cold comparison attempt.

### 2026-10-02 iOS locale library source transfer

BL-018 / D-218 locale library integration is **In progress (source)**. Transfer
only the independently accepted v7 runtime/storage/quiescence helpers and 29
portable controls using the current isolated v2 packet. Root independently
verified the current c8ab66f capture, 72-helper closure and portable transfer
without captured artifact/credential paths. Full isolated overlay TypeScript,
zero-warning lint and formatting pass. Preserve the original primary deletion
typecheck failure as unrelated baseline and reject the historical v7 freeze as
stale. Auth/profile/terms/domain callbacks, actual reader/fixture binding and
production capture wiring remain explicitly Pending; native/public locale
qualification is Pending and publicLocale remains null. This source unit changes
no app/auth/provider/copy behavior; existing localization artifacts need no update.
Proof: `locale-runtime-ios-adapter-v7-current-integration-2026-10-02-v2`.

### 2026-10-02 reviewed camera dispatch and Detox session source transfer

BL-018 / D-218 source integration is **In progress**. The independently reviewed
camera v2 dispatch requires the actual iOS/Maestro/integration selection, separate
API/app/Metro origins, four explicit assertion evidence bindings (including
training isolation), and byte-preserved runtime/adapter/independent cleanup
sidecars. Copy its four source/test files; regenerate the genuine isolated native
declaration after integration rather than copying a stale private inventory.
Primary native inventory remains untouched because its original plan-source
deletion is preserved.

The independently reviewed Detox v2 baseline transfers eight source/test files
against the actual current Android adapter exports, without a shim. Projection
uses validated artifacts and rejects post-validation mutation. iOS coach baseline
source and strict cleanup/terminal readback are covered; Android producer/runtime
and student callbacks remain **Pending**. No native pass follows from transfer.
Run full isolated TypeScript, canonical zero-warning scoped lint, formatting and
all affected controls. Current API-lifetime filename repair review, actual native
qualification, public outcomes, comparison, exploration and hosted gates remain
Pending. No app/auth/provider/copy behavior changes: FR/UC/AC/BR/screens and
localization updates are unnecessary. Proof:
`camera-detox-reviewed-canonical-integration-2026-10-02-v1`.

### 2026-10-02 camera dispatch and Detox canonical source verification

Reviewed camera dispatch and the Detox session baseline are **Done (source)** in
both canonical checkouts. Root verifies all twelve transferred file hashes; full
isolated TypeScript, canonical zero-warning lint and formatting pass. The combined
camera, public-runner, Detox, session-loader, Android-session and declaration
controls report **63 passed, zero failed or skipped**. The genuine isolated native
declaration was regenerated (23 source views, 40 transitions, 10 scenarios); the
primary native inventory remains unchanged with its original plan-source deletion.

Camera native/public qualification and the Detox iOS coach runtime remain
**Pending**. Android Detox's actual producer and student callbacks remain
**Pending**; no source test creates a native pass. Current owned API lifetime
repair is under independent review before further native acquisition. Auth cookie
proposal remains Pending user decision. This QA source work changes no product
behavior, provider contract or localized copy. Proof:
`camera-detox-reviewed-canonical-integration-2026-10-02-v1/root-source-validation.private.json`.

### 2026-10-02 iOS locale library source verification

The portable iOS locale runtime/storage/quiescence library and controls are
**Done (source, independently reviewed)** in both canonical checkouts. Root
resolved the canonical ESLint warnings missed by the preparation configuration;
full isolated TypeScript, canonical zero-warning lint and formatting pass. All
29 controls pass, including three forged hash-object negatives and retained
awaited cleanup failure behavior. The four final file hashes match in both roots;
the original warning logs remain preserved.

Actual auth/profile/terms/domain callbacks, reader/fixture binding and capture
wiring remain **In progress / Pending**. The library alone creates no native
result; publicLocale stays null. This QA source change introduces no localized
product copy or auth/provider behavior. Proof:
`locale-reviewed-source-integration-2026-10-02-v1/root-final-source-validation.private.json`.

### 2026-10-02 initial API lifetime producer/consumer repair

BL-018 / D-218 source integration is **In progress** for the independently
reviewed initial API-lifetime repair. Read the actual protected
`api-session-start.json` ledger, validate run/owner/PID/start/script/origin and
current manifest, then return logical `runId:first` while preserving the physical
`session-start` identity. Do not request nonexistent `api-first.json`. Abort,
schema, private file and symlink guards remain required.

A restarted API cannot reuse initial provenance. Existing post-restart snapshot
callers in `verify-domain-snapshot.ts` and `verify-native-training-read.ts` remain
**Pending** a separate restart-attempt binding; do not relabel a restarted ledger
as first. Portable actual-file and wrong-identity/restart negatives passed peer
review. Root current-project checks and declaration regeneration follow. This
is QA harness behavior; no product/auth/provider/copy contract changes. Historical
v14 stays blocked, cleaned and sealed; no pass is created by repair. Proof:
`api-lifetime-reviewed-canonical-integration-2026-10-02-v1`.

### 2026-10-02 initial API lifetime source verification and camera runtime gate

The initial API physical/logical ledger repair is **Done (source, independently
reviewed)** in both canonical roots. Root full isolated TypeScript, canonical
zero-warning lint and formatting pass; **46 affected controls pass**, with no
failures or skips. The actual session-start ledger and current manifest are
bound before returning first provenance; a restarted process remains rejected.
Post-restart snapshot binding is **Pending** separately. The historical v14
terminal is unchanged. Proof:
`api-lifetime-reviewed-canonical-integration-2026-10-02-v1/root-source-validation.private.json`.

The next iOS camera public-runner runtime remains **Pending** fresh source freeze,
tool/host/build/disk preflight and actual execution. Initial read-only preflight
found insufficient disk (19,565,129,728 bytes under the unchanged 20 GiB guard),
so no resources were acquired. Guarded recovery removed only compiler caches
from one completed independently cleanup-verified capture; its app bytes and
973 protected files stayed unchanged. Available disk became 22,881,030,144 bytes;
fresh prelaunch must recheck it. Retained app build reuse is explicit and is not
a cold comparison attempt. No auth/provider/copy change or native/public pass.
Proof: `ios-camera-public-runtime-2026-10-02-v1`.

### 2026-10-02 parallel source isolation and native prelaunch

The camera v1 prelaunch is terminal **input-drift-blocked; no resources acquired**.
The freeze guard caught unreviewed restart preparation modifying the shared
owned API helper and test. Root interrupted that work, preserved the candidate
bytes privately, restored the exact independently qualified two-file snapshot
and verified all 787 original frozen inputs again. No native/public request or
pass was produced. Continue preparation in regular private candidate files,
with canonical hashes checked before/after; root alone integrates source.

The broad frozen overlay baseline reports 2,131 passed and 34 existing skips on
its second full unit run, plus 60/60 components. The first run's intermittent
Detox sign-in-window failure remains preserved and under independent source
investigation; targeted 19/19 controls passed. The overlay source stayed unchanged;
its cached server alignment is unit-only, separate from the actual native server.
Actual API repair is additionally verified by the current 46-control/full-project
gate. No product/native outcome follows from unit checks.

Fresh camera v2 freeze/preflight/execution is **Pending**. Actual post-restart
contract, public session dispatch and full MCP acceptance remain Pending their
separate reviewed source/runtime gates. Historical failures remain immutable.
Proof: `ios-camera-public-runtime-2026-10-02-v1/prelaunch-terminal.private.json`
and `client-broad-test-baseline-2026-10-02-v1`.

### 2026-10-02 Detox event-window determinism and camera terminal

The source repair for the broad test sign-in-window failure is **In progress**.
The event monitor previously captured its request fence after asynchronous
`onEvent` evidence work, allowing a later hydrate request into the login window
in the synthetic fixture. Capture request fence and observation IDs before that
work; retain the strict initial sign-in predicate. Replace the timing-dependent
fixture interval with a bounded observation handshake. The deterministic control
fails before (18/19) and passes after (19/19); original broad failures remain
immutable. Root current-project checks follow. This is QA observer behavior,
with no product/auth/provider/copy change. Actual native Detox remains Pending.
Proof: `detox-event-window-reviewed-source-integration-2026-10-02-v1`.

The actual canonical camera public CLI attempt is terminal **harness-blocked /
cleaned / sealed**: public run `3441cf3111b8eb7638708915`, capture
`550e8ffd94581b282d035c67`. The password-save-prompt command returned child1
before the camera callback (zero invocations); verification was not executed.
No camera defect or password-prompt cause is established. Independent cleanup
and root audit passed with 48 PID/start pairs absent; 57 original artifacts,
787 frozen inputs and 72 unchanged helpers are sealed. The retained app build
is explicit and this is not a cold comparison attempt. Native/public passes
stay zero. Diagnose immutable evidence; do not retry unchanged. Source is
unfrozen after seal and root remains the canonical integration owner. Proof:
`ios-camera-public-runtime-2026-10-02-v2/sealed-terminal.private.json`.

Independent review accepted the event-window repair and required the synthetic
progress writer to mirror the real atomic temp-file/rename producer. Root added
that test-only repair before qualification; current-project checks are in progress.
The deterministic before-source test uses the same new fixture for both sides;
only the observer source changes in the before/after comparison. No product docs
change is required because this changes only QA evidence and its fixture.

### 2026-10-02 reviewed Detox observer source qualification

The event-window repair is **Done (source, independently reviewed)**. Full isolated
TypeScript, canonical zero-warning lint, formatting and 36 focused controls pass.
The reviewed atomic regression fixture produces the exact sign-in-window failure
with the before source (18 pass / 1 fail), and passes with repaired source (19/19).
Both 382-file inventories are refreshed. Actual native Detox remains Pending;
these source checks produce zero native/public passes. Proof:
`detox-event-window-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`.

Read-only diagnosis of camera public run `3441cf3111b8eb7638708915` establishes
that the email input was empty after `inputText`; its exact same-field assertion
failed before the password-save prompt. No dialog or camera callback was reached.
The selectors match documented semantic IDs; a mapper defect is not established.
Cause remains unknown input persistence/focus or simulator behavior. Preserve
the sealed terminal and no-unchanged-retry rule; no product/auth/copy change.

### 2026-10-02 broader observer-repair baseline

The frozen current isolated source suite passes: **2,133 passed, zero failed,
34 existing skips (2,167 total)**. All 2,385 copied source entries remain unchanged.
The initial copied-overlay setup lacked Git provenance and produced five failures;
that log is preserved. The corrected run reads the actual managed worktree HEAD,
with no synthetic commit, and uses copied dependencies inside the disposable
overlay. Cached server app alignment is unit-only; no native/backend/provider
runtime or public qualification is claimed. Source proof:
`client-broad-observer-repair-baseline-2026-10-02-v1/root-source-validation.private.json`.

Post-restart API candidate v1 is **blocked for integration** by independent review:
a restart or teardown during asynchronous manifest/ledger reads can return stale
evidence, and the candidate lacked a deterministic orchestration race control.
A new v2 source repair is In progress; canonical initial-start helper `0fa47090`
and its reviewed 46-control source qualification remain unchanged.

### 2026-10-02 Maestro MCP v8 canonical source integration

MCP v8 is independently clear at the source boundary. Root integration is
**In progress**: retain exact reviewed stdio source in
`scripts/testing/owned-maestro-mcp-stdio.ts` and discover its generic Node controls
in `tests/ci/owned-maestro-mcp-stdio.test.ts`. Only the test import and ESM fixture
source location change for canonical paths. Current-project checks follow.
The four v7 blockers are fixed, including post-close on-disk SHA verification
and same-length mutation rejection. Worker I/O/cancellation/deadline/cap/late
response authority stays strict. This starts no Maestro/device/ADB/backend/cloud
resource and produces no native/public/exploration qualification. No product,
auth, provider or localized copy changes are needed. Full runtime/T16 remains
Pending a separate owned preflight and actual receipts. Proof:
`mcp-v8-reviewed-source-integration-2026-10-02-v1`.

### 2026-10-02 Maestro MCP v8 source qualification

Canonical integration is **Done (source, independently reviewed)**. Exact reviewed
source bytes and the two canonical test path rewrites pass full isolated TypeScript,
canonical zero-warning lint, formatting and 40/40 controls. Both test inventories
now contain 383 files (320 client, 63 server). Actual pinned Maestro server
qualification is Pending a fresh owned protocol preflight; tools/call, device
flows, native/public qualification, cold comparison and exploration stay Pending.
No source check creates a runtime pass. Proof:
`mcp-v8-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`.

### 2026-10-02 reviewed public iOS session source integration

Root integration is **In progress**. Independent v4 review cleared the adapter,
strict capture tuple and verification-phase diagnostics, but transfer lacked two
reviewed staging prerequisite files. Root transfers exactly the five v4 files plus
those two hash-verified v1 staging files; no private generated inventory or
`Info.plist` is copied. Regenerate the actual isolated native declaration, validate
full source and retain camera dispatch/current API/Detox inputs. The source-only
staging boundary stays non-promotable with zero native/public passing cases.
Actual session runtime and auth contract decision remain Pending; no product,
auth, provider or localized copy changes are introduced. Proof:
`public-session-v4-reviewed-source-integration-2026-10-02-v1`.

Current public-session validation retained one failing stale test expectation: the
public iOS runner was previously absent. Root updates that expectation to require
the real adapter plus capture, verifies adapter/dependency/staging imports and
freshness owners, and includes those three source inputs in the iOS capture helper
identity (75 total). Android still has no public session runner. The original
91/92 control result is preserved; no assertion is removed or native pass inferred.

### 2026-10-02 public iOS session source qualification

The reviewed seven-file transfer and two current closure corrections are
**Done (source)**. Full isolated TypeScript, canonical zero-warning lint, formatting
and all 92 combined controls pass. The actual isolated declaration regenerates
23 source views, 40 transitions and 10 untested scenarios with zero runtime passes.
The iOS producer now binds 75 unique helper inputs, including its real public
session adapter/dependency/staging sources. Both test inventories contain 385
files (322 client, 63 server). The original 91/92 failure is preserved and resolved
by requiring the real current closure rather than a nonexistent-runner assumption.
Source-only session staging remains non-promotable; actual session runtime and
auth contract decision remain Pending. Proof:
`public-session-v4-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`.

### 2026-10-02 reviewed restart binding and Android Detox source integration

Integration is **Done (source)** for API restart v2 and the accepted Android producer
v3 rebased v4 transfer. The API reader now validates complete identity/liveness/
closure before and after protected receipt reads; snapshot windows bind the
pre-request identity. Initial `session-start`/`runId:first` remains strict. The
producer validates four phases/domain state, command/tool/target/run/API/backend
provenance, proxy quiescence and separate query/cleanup failure authority. Root
transfers five exact source/test files and preserves the event fence before
`await onEvent`, current atomic fixture, and public session/camera dispatch.
The API packet workcard says 17 checks, but its authoritative producer report
and manifest record 18; root records 18 without rewriting historical evidence.
Current-project checks pass: full isolated TypeScript, canonical zero-warning scoped lint, formatting, and 68/68 combined controls. Actual restart, Android runtime/student callbacks,
public/cold/exploration and auth-revocation gates remain Pending. No product,
auth, provider or localized copy changes are introduced. Proof:
`api-restart-android-producer-reviewed-source-integration-2026-10-02-v1`.

The initial current API/Android gate passed TypeScript, zero-warning lint and
68/68 controls, but canonical formatting rejected three Android files. Root
preserves that result and the before bytes, formats only those files, retains
the event-window ordering, and reruns the current gate. No runtime is credited.

Current restart/Android final gate passes all 68 controls, full isolated TypeScript, canonical zero-warning scoped lint and format after the preserved formatting correction. Both test inventories now contain 386 files (323 client, 63 server). The source proof is `api-restart-android-producer-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`. Actual restart, Android storage callbacks and native/public qualification remain Pending. This QA-only change requires no FR/UC/AC/BR/screens/localization update because product behavior, backend provider and user copy are unchanged.

### 2026-10-02 current MCP v8 source / v9 short protocol receipt

T16-B current canonical MCP v8 source (`e8a887c8…`) has a fresh v9 **locally
qualified short protocol / cleaned / independently root-sealed** receipt. The
actual owner run uses the genuine shared host-lock wrapper, JDK 17.0.19 and
192 pinned jars. Exactly initialize, initialized notification and tools-list
produce five envelopes and nine tools; no tools/call, device, ADB, backend,
flow or exploration is invoked. Final close/drain has exit 0, null signal,
no protocol/rejected/dropped/late failure, absent owned process group and sockets.
Root verifies 25 original artifacts, 289 frozen inputs and one PID/start pair,
then reopens the actual 10,416-byte spool and transcript for exact SHA-256/bytes.
This is protocol qualification only; native/public/exploration passing cases stay
zero. Device/tool-call/flow qualification, cold comparison and protected hosted
adoption remain Pending. The historical v5 receipt remains immutable for its
older source. The initial root seal rejected an unresolved packet-relative
projected spool path; resolving it beneath the owned packet completed read-only
verification without rerunning the resource. Proof:
`t16-b-direct-stdio-runtime-2026-10-02-v9/root-sealed-terminal.private.json`.
No product, provider, auth or localized copy changed; FR/UC/AC/BR/screens need no
update for this QA protocol receipt.

### 2026-10-02 parallel frozen broad baseline and native host gate

The fresh qualified-client frozen snapshot ran 2,231 unit controls: **2,195
passed, two failed, 34 existing skips** (exit 1). The failed actual preflight
controls reported exit 2 instead of cancellation 130 and an unavailable final
receipt. Root's source inspection identifies a possible missing sibling server
view in the disposable layout (`run-native-pilot.ts` requires its real path).
This is a setup hypothesis pending the corrected declared-layout control, not a
confirmed application defect or a passing baseline. Preserve the original
failed log and frozen identities. Five documentation files changed after the
freeze, so this is snapshot evidence. The owned disposable overlay was removed
only after source/terminal guards; cached server app input was unit-only and no
native/backend resources ran. Proof:
`client-broad-qualified-native-root-baseline-2026-10-02-v1`.

The actual host has about 2.5 GiB free against the existing 20 GiB native gate.
Native execution remains stopped without acquiring resources. Completed task-
owned disposable copies are under ownership review; unknown directories,
original evidence and qualified app binaries are preserved. Source-only work
continues. Proof: `native-host-disk-observation-2026-10-02-v1`.

### 2026-10-02 reviewed iOS locale callback wiring and shared closure

Integration is **Done (source)** for the reviewed locale v4 QA source. The owned
iOS capture admits only `locale-selection-persistence` and
`locale-os-fallback-reset` charters with a closed supported locale. It wires the
existing runtime/storage/quiescence helper into the actual capture callback,
retains outer cleanup ownership and cancellation fences, and rejects forged
observed/blocked cleanup states including a non-null cleanup error. Source-only
results keep public locale null and zero native/public passing cases. Android's
shared connection imports require the same four transitive helper files, so
root updates their helper ledger and current declaration source ownership.
Private stale inventory is not copied; only the qualified root regenerates its
real declaration. Native locale execution and host disk recovery remain Pending.
No product/provider/auth/copy behavior changes; FR/UC/AC/BR/screens/localization
need no update. Proof: `locale-v4-reviewed-source-integration-2026-10-02-v1`.

The reviewed locale transfer and four transitive Android/declaration additions pass all 90 current combined controls, full isolated TypeScript, zero-warning scoped lint and format. Actual generator/schema validates 23 source views, 40 transitions and 10 untested scenarios with no runtime receipts. All four new source revisions and actual closure/freshness paths are bound; the earlier private closure and stale runner-slot ownership failures remain preserved and are resolved by genuine current regeneration. Both test inventories contain 388 files (325 client, 63 server). Primary native inventory remains untouched because the original plan-source deletion is preserved. Native/public/locale qualification stays Pending/zero/null. Proof: `locale-v4-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`.

### 2026-10-02 corrected broad layout: real server contract remains red

The v2 frozen client/server workspace closes the two preflight setup failures:
its two targeted actual runner controls pass with a real sibling server. The
broad unit snapshot reports **2,196 passed, one failed, 34 existing skips**
(2,231 total; exit 1). The remaining source-contract test finds the mobile
`POST /auth/password-reset/confirm` call missing from the actual server
`c7b519…` app source. The cached `a422…` unit-contract source contains that
route; a cached-source green baseline does not prove the current paired server
contract. Owner/branch-intent diagnosis is Pending. Do not relax or remove the
test, copy cached runtime success, or infer that this caused native session/
camera failures. Native cookie-policy approval remains a separate open question.
The v2 copy preserves 126 preflight receipts and exact frozen sources; guarded
cleanup removes only its disposable workspace. The prior v1 failure remains
immutable (its disposable attempt receipts were not separately retained).
Locale integration changed source after v2 freeze, so v2 remains snapshot
evidence, distinct from the later 90-control locale integration gate. Proof:
`client-broad-qualified-native-root-baseline-2026-10-02-v2/broad-baseline-v2.private.json`.

### 2026-10-02 parallel source repairs and server baseline ownership

The credential diagnostic v4 independent review remains blocked: missing post-assertion execution, in-memory invalidation on failed sidecar writes, actual capture callback wiring controls, and ambiguous/tampered ledger controls require repair. Its private v5 repair is In progress; no diagnostic source is integrated and no native retry is authorized by that preparation. Android v3 remains rejected after independent source review: its final API lifetime check precedes final source reads, the test imports a non-exported type, the strict formatter reports unformatted bytes, and no current loader consumes the copied bundle. Producer v4 repair and a separate actual Android copied-bundle consumer are In progress; canonical/public integration remains Pending. Review: `android-public-session-dispatch-independent-review-2026-10-02-v3/review.private.json`. Parallel owners prepare regular private files while root alone integrates reviewed canonical changes and owns runtime resources.

The paired server route audit confirms a source/branch alignment mismatch: the client uses the documented ET-74 confirmation endpoint, while actual server c7b519 lacks it and cached a422 contains it. D-215 already records the completed contract. The server owner must supply an authorized exact baseline containing the endpoint or explicitly choose the missing baseline and implement the documented backend contract. Preserve the 2,196-pass / one-failure / 34-skip paired snapshot; do not weaken its test, overwrite the dirty server, substitute cached success, or change native cookie policy. Proof: `paired-server-route-owner-alignment-2026-10-02-v1/alignment.private.json`.

Native/public/cold passing attempts remain zero. Host disk recovery, the separate auth-policy decision, native diagnostic capture, engine/platform comparison, exploration, and protected hosted qualification remain Pending. This checkpoint changes only QA source status; FR/UC/AC/BR/screens/localization and product/provider/auth behavior need no update.

### 2026-10-02 credential v6 source integration and all-five-family closure

Credential entry diagnostic v6 is **Done (source), runtime Pending**. It retains distinct owned pre/post frames and command/ledger identity, rejects non-completed commands relabeled as completed actions/assertions, invalidates the in-memory projection before sidecar publication, preserves raw/failure evidence, and executes the actual capture-used wiring with password-only continuation after a valid diagnostic. The two new command-tamper controls fail before the repair and pass afterward; truthful failed assertions remain failed. Both independent reviews clear the semantic transfer and the later source-closure correction. Current canonical gates pass **125/125 combined controls**, full qualified-root TypeScript, zero-warning scoped lint, actual formatting and generator/schema validation.

The final source check found a real gap beyond the earlier three-family tests: the iOS camera adapter was absent from its capture helper ledger, and save-retry omitted transitive declaration inputs. All five actual families now have closure controls; only existing iOS camera/save adapters and the actual Android capture entrypoints are used. No Android camera/save adapter is invented. The real qualified declaration has 23 source views, 40 transitions, ten untested scenarios and zero receipts. Both test inventories have **391 files (328 client, 63 server)**. The primary plan-source deletion and native declaration are preserved; primary native declaration controls remain separately blocked by that deleted/stale input. Proof: `ios-credential-v6-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`.

Android producer v4 is independently source-reviewed with eight passing controls and awaits root integration. The copied-bundle consumer v1 is rejected: its source existed only as four unreviewed primary writes, and its loader did not bind original command/transport receipts or require available cleanup census. Root preserves those exact bytes and restores the previously absent untracked paths; a standalone private v2 repair is In progress. No consumer/public qualification follows from its earlier synthetic controls. Proofs: `android-consumer-unreviewed-primary-write-recovery-2026-10-02-v1/recovery.private.json` and `android-public-session-dependency-independent-review-2026-10-02-v1/review.private.json`.

A fresh read-only server main query confirms a422 matches the clean cached checkout and contains the documented password-reset confirmation endpoint. The native server remains c7b519; no baseline switch, runtime, deployment or cookie-policy change occurred. The paired full-unit failure remains preserved. Native/public/cold passing attempts remain zero; disk recovery, auth decision, actual diagnostic/native/engine comparison, exploration and hosted qualification remain Pending. FR/UC/AC/BR/screens/localization need no update because this changes QA diagnostics/provenance only.

2026-10-02 public dispatch integration checkpoint: the independently reviewed
`native-detox-connection-public-dispatch.ts` source (SHA-256
`fe42c69ef1230a440c7ee93ddb8a2655d1186b952607b7fd3e0ede77861c95f3`)
is integrated in both roots using exclusive absent-file guards. Proof:
`detox-public-dispatch-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`
(SHA-256 `80a3a7cd6a3c4156f81186ebccc61f2059b7f427d5a6fa8406415f538f772908`).
Status remains **In progress**: current runner dispatch wiring, consolidated DXA
IPC integration, runtime helper freshness binding, and canonical validation are
pending. This source addition produces zero native/public/cold passing cases.
Product behavior, localization, and backend-provider contracts are unchanged;
no functional requirement, use case, business rule, or screen-copy update is
needed for this internal testing integration.

2026-10-02 execution checkpoint for BL-018 / D-218: reviewed cache cleanup is
**Done** for the exact 15 cleaned task runs / 55 compiler-cache targets. Executor
exit is 0, partial/unknown states are false, all 15 post-apply binary hashes
match, and actual free space increased from 2,409,064 KiB to 25,991,064 KiB
(above the 20 GiB native gate). Proof:
`disk-recovery-reviewed-cache-cleanup-execution-2026-10-02-v1/execution-summary.private.json`;
original executor result SHA-256
`9d4ece7460cd439dfd24b73ce4ce2198eb0be07b7afd4cdf6d7ace056921134f`.
This satisfies the observed disk prerequisite only; recheck free space before
each native acquisition.

Primary Android camera source integration is **Done (source)**: 14 reviewed
files integrated; 12 canonical camera/auth-order controls pass, scoped lint and
format pass after retained formatting/type-assertion repairs. Proof:
`android-camera-v12-reviewed-primary-source-integration-2026-10-02-v1/post-apply-validation.private.json`
(SHA-256 `bbcdf198cdd572559bbc83d39733e49ae0fe028b8a873bcf4ff4bb1af55e5972`).
The qualified proxy also receives the exact auth-order assignment, preserving
its other bytes and metadata; its actual unchanged regression fails before and
passes after. Both current roots pass the 12 camera/auth-order controls and
contain 417 inventoried tests (354 client / 63 server).

BL-018 remains **In progress**: Android manual-code/submission/SQL producer
wiring, DXA V3 integration, runner identity/terminal recovery, real Detox
dispatch/freshness, iOS command diagnostics, and native/comparison/exploration
gates remain pending. Primary full types and declaration regeneration retain
the missing plan-source constraint; qualified full types still require IPC and
runner integration. Native/public/cold passing counts remain zero. No product,
provider, authentication-policy or localization behavior changed; functional
requirements and screen-copy updates are unnecessary for these QA changes.

### Reviewed Detox source integration checkpoint — 2026-10-02

The independently accepted DXA V3 seventeen-file source closure is now integrated
in both primary and qualified roots. Seven support copies were excluded; their
current bytes were guarded. The actual transfer receipt is
`detox-dxa-v3-reviewed-current-root-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`
(SHA-256 `3e8d3fd93a22ffef220d8c6df9c8d404d10e26fbc7dabcb89d3a4f3272198c22`).
This closes the reviewed source findings for PNG evidence, cancellation actor
binding, and recovery replacement identity. It establishes no native pass.

Current canonical training, bridge, actionability and DXA controls pass; fourteen
staging controls still fail during fixture construction because source identity
metadata is incomplete. Their expectations remain intact and fixture repair is
In progress. Current qualified full TypeScript exits 2 for the missing runner
invocation helper and resulting argument diagnostics; the prior missing IPC PNG
export diagnostic is resolved. Runner identity reconciliation, public dispatch,
actual native producer qualification and T15-T20 acceptance remain Pending.
Product behavior, provider baseline and localized copy are unchanged.

### iOS command-output diagnostic propagation — 2026-10-02

The reviewed adapter now propagates `outputFailures` alongside command and census
diagnostics in both roots. The producer remains unchanged. The actual transfer
receipt is `ios-command-diagnostic-propagation-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`
(SHA-256 `9701ac5b452b41cb7ed2c484496bc7e194e71272c3c3e5d88788ce3b6436689f`).
Qualified declaration regeneration and validation pass; all eight current adapter
checks pass and scoped lint has zero warnings. The earlier stale-declaration
failure is retained as before evidence. Primary declaration regeneration remains
constrained by the preserved missing plan source. Public staging equality with raw
command diagnostics is In progress. Native execution and runtime qualification
remain Pending; no product, backend-provider or localization behavior changed.

### Fresh native host and source readiness checks — 2026-10-02

Read-only host checks confirm Node 24.15.0, tsx 4.21.0, Maestro 2.6.1,
Xcode 26.6 (17F113), Docker CLI 29.4.1 and available iOS 26.5 runtime
with iPhone 17 support. The owned state root remains a regular 0700 directory;
44,150,480 KiB free exceeds the 20 GiB floor at this checkpoint. Fourteen current
native contract, declaration and runtime-preflight controls pass. Proof:
`native-host-readiness-refresh-2026-10-02-v1/readiness.private.json` and
`source-gates-summary.private.json`. No native resources were acquired.
Runner identity, dispatcher closure and producer runtime qualification remain
Pending. Recheck contention and disk immediately before acquisition.

### Android camera producer review hold — 2026-10-02

The eight-file Maestro camera producer candidate has reviewed submission/body,
manual-code provenance and six-phase SQL receipt bindings, but its retained
journey-core dependency is older than the integrated DXA V3 source. V2 uses the current journey core and passes all eighteen controls in a root
replay, including the auth-order regression. Transfer remains Pending for
independent semantic review. Replay proof:
`android-camera-maestro-producer-v2-root-replay-2026-10-02-v1/replay.private.json`. No candidate support copy may replace the current
journey core. The root review verified all 27 manifest-listed source/evidence
file identities; proof is
`android-camera-maestro-producer-v1-root-review-2026-10-02-v1/review.private.json`.
This is a source validation gap; native and public qualification remain Pending.

### Adjacent Detox fixture compatibility gate — 2026-10-02

The actual post-DXA V3 adjacent cohort has 26/31 passing controls. Five older
Detox V4 controls fail at private immutable-file metadata, valid PNG evidence,
and the new runner helper closure. An asynchronous recovery rejection is also
retained in the failing log. Fixture repair is In progress; it must preserve the
negative-case semantics, await cleanup activities and leave production validators
intact. Camera production, auth-order and native connection journey controls in
this cohort pass. Proof:
`detox-dxa-v3-reviewed-current-root-source-integration-2026-10-02-v1/adjacent-regressions-summary.private.json`.
This is incomplete source validation and establishes no native/runtime pass.

### Shared training output-diagnostic staging gate — 2026-10-02

Both training producers now retain `outputFailures`. Shared public staging
requires that projection and compares it with original normalized capture
command records before the existing success checks. Missing, mismatched and
failed projections cannot qualify success. The reviewed staging source/test and
minimal Android producer repair are integrated in both roots. Thirteen current
combined adapter/staging controls pass; scoped lint has zero warnings and the
qualified declaration is refreshed. Proof:
`native-training-output-diagnostic-reviewed-staging-integration-2026-10-02-v1/accepted-source-transfer.private.json`
(SHA-256 `2569ed331c007e37bcb8ab1987b6d19bb065c8082954697ac18c2898b47899db`)
and `post-apply-validation.private.json`. This closes the diagnostic propagation
source gap. Actual public/native runtime qualification remains Pending. Product,
provider and localization behavior are unchanged; primary missing plan source is
preserved.

### Runner V2 unknown-runtime cancellation review — 2026-10-02

The identity helper's seventeen controls pass independently, but the current
runner patch remains blocked: after an adapter aborts before returning its
result, `runtime-failure.private.json` publication uses the already-aborted
controller outside the runtime catch. A test executing the exact source branch confirms that it rejects
before terminal receipt preparation. Proof:
`t15-identity-v2-unknown-runtime-root-review-2026-10-02-v1/review.private.json`.
This resource-free branch control does not execute a native adapter. The author
must retain bounded, identity-verified terminal/recovery evidence for this
outcome before integration. Runner reconciliation remains In progress; no native
or public passing case is established.

### Detox save/retry source review — 2026-10-02

T14-E's first private Detox candidate passes its eight focused controls, but
independent review blocks canonical transfer. Reproduced gaps include command /
runtime platform mismatch, non-PNG screenshot acceptance without producer
identity, forged selector lists, incomplete request/origin/credential and
forwarded PATCH-200 binding, canonical proxy arm API mismatch, and incomplete
in-flight cancellation/deadline fencing. Canonical caller wiring is also Pending.
Repair is In progress with regression controls for those findings. The passing
focused checks do not establish complete source or runtime qualification. Proof:
`detox-save-retry-independent-review-2026-10-02-v1/REVIEW.private.json`.
No product/provider/localization behavior or native/public passing count changed.

### Reviewed Android camera producer integration — 2026-10-02

The accepted eight-file producer update is integrated in both roots, excluding
all support copies. Actual manual-code hierarchy provenance, protected submission
body/descriptor rereads and six SQL receipt phases are bound to the owned attempt.
Both canonical eighteen-control cohorts pass; qualified scoped lint has zero
warnings. Full qualified TypeScript still reports only the pending invocation
module and derived argument diagnostics. The qualified declaration is refreshed;
both test inventories now contain 423 files (360 client, 63 server). Proof:
`android-camera-producer-v2-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json`
(SHA-256 `531c6e079f5f2d412446e79583df1b3c9fe792f7f12bd5a728346d344d2d28c0`)
and `post-apply-validation.private.json`. Android public adapter/staging and
actual runtime qualification remain Pending. Primary missing plan source is
preserved; product, provider and localization behavior are unchanged.

### iOS Detox dispatcher V3 review (2026-10-02)

The sealed V3 source packet includes all 97 currently enumerated runtime files, separately from the 44-file reusable build helper baseline. Root review holds transfer: closure/build preflight consumes the absolute deadline but the bridge receives the original duration, and the post-read identity check compares size without inode or mutation metadata. V4 must use the remaining deadline budget, retain returned bridge cleanup/failure facts on post-read failure, and reject same-sized source replacement with concrete controls. The four V3 source tests do not prove these lifecycle paths.

Evidence: primary private `ios-detox-dispatch-v3-root-review-2026-10-02-v1/review.private.json` (SHA-256 `bc39b4b05e3f5af151700807d320fcb1e9f7baab7673e81271d8395b0e352b8e`). No dispatcher candidate was transferred; native/public/cold passing counts remain zero. This is QA infrastructure work with no product, provider, screen, or localization behavior change.

### Required command diagnostic fields (2026-10-02)

The shared success gate now requires own `censusFailure` and `outputFailure` keys, both explicitly `null`. Missing either field cannot support a successful command or public staging. Added controls reject either or both absent keys at the shared gate and both platform staging boundaries. The actual qualified before-fix run failed three controls; after the minimal shared gate repair and scenario declaration refresh, the combined training/staging cohort passes 13/13 and scoped lint passes. Primary source received the same three-path repair; its declaration remains pending because the preserved plan-source baseline is missing. Evidence: primary private `native-command-required-fields-root-repair-2026-10-02-v1/validation.private.json`. Native/public/cold counts are unchanged. No product, provider, screen, or localization behavior changed.

### Detox fixture V2 integration (2026-10-02)

Root independently reviewed and transferred the exact six-file fixture/publication repair to both source roots with all twelve current preimage guards passing. Actual qualified canonical staging/DXA/V4 controls now pass 42/42, including owned publication-window retry and foreign-hardlink rejection. Evidence: primary private `detox-fixture-v2-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json` and `canonical-validation.private.json`. This closes the earlier fourteen staging fixture failures and five V4 fixture failures at the source-test boundary. Current declaration and broader graph freshness remain to be refreshed; native/public qualification remains Pending. No product, provider, screen, or localization behavior changed.

### Command producer explicit failure fields (2026-10-02)

The strict diagnostic gate remains unchanged. Independent review found that clean raw command results omitted its required failure fields, so the existing command producer now initializes both fields explicitly to `null` in both roots. A real owned Node child regression fails before the repair and passes afterward; clean streaming, output-limit, and late-flush controls pass 3/3. No native device or backend is acquired by these controls. Evidence: primary private `native-command-producer-explicit-null-repair-2026-10-02-v1/validation.private.json`. Peer review and declaration refresh remain pending; no product, provider, screen, or localization behavior changed.

### Shared helper boundary test repair (2026-10-02)

The one-file test repair now consumes the actual iOS shared helper ledger and checks that the producer calls its reader; Android retains the current producer list. Exact guarded transfer is complete in both roots, and the qualified adjacent cohort passes 20/20, closing the earlier three stale test failures. Actual canonical full TypeScript still has five known runner diagnostics: the absent invocation module and four derived argument errors. Evidence: primary private `helper-boundary-reviewed-source-integration-2026-10-02-v1/validation.private.json`. No native/public pass or product behavior change is claimed.

### Detox save/retry V3 source integration (2026-10-02)

Under BL-018/D-218/T14-E, the independently reviewed six-file source seam is integrated in both roots after absence and current proxy guards. Actual qualified canonical controls pass 15/15, including cancellation after fault arming and PNG provenance/CRC/image-data checks. Evidence: primary private `detox-save-retry-v3-reviewed-source-integration-2026-10-02-v1/accepted-source-transfer.private.json` and `canonical-validation.private.json`.

Status: source seam **Done**; real owned caller, child termination/reaping, fresh iOS/Android Detox receipts, independent cleanup and public promotion **Pending**. The existing integrated Detox owner must supply the authenticated child and current proxy/API/SQL readers; no second process or cleanup owner is authorized. Native/public/cold counts are unchanged. No product, provider, screen, or localization behavior changed.

### Native runner and cold reset ownership reviews (2026-10-02)

BL-018/D-218/T13–T15 remain **In progress**. Independent runner review accepts the V5 fixture correction and its 26/26 source controls in each root, but blocks the V4 helper and runner transfer: replacing an ancestor before path-based output-root creation creates a directory outside the owned namespace before the later identity rejection. Repair must create the child relative to an anchored parent and prove the interleaving creates no outside directory or bytes. Evidence: primary private `t15-public-runner-identity-pq-independent-review-2026-10-02-v2/REVIEW.private.json`.

Independent cold CLI review also reproduces `EEXIST` with the actual helpers: the reset producer precreates the public output directory that the runner must create exclusively. Repair is In progress through protected reset staging and an explicit handoff after exclusive runner directory creation; accepting arbitrary existing output roots is not an equivalent fix. Evidence: primary private `t15-cold-dispatcher-cli-output-root-compatibility-review-2026-10-02-v1/REVIEW.private.md` and `validation/reproduction.json`. Neither candidate has been transferred. Native/public qualifying passes remain zero, and real cold comparison remains Pending. No product, backend-provider, screen, or localization behavior changed.

### Training staging lifecycle review (2026-10-02)

BL-018/D-218/T13–T14 staging lifecycle is **In progress**. Root review blocks the private V1 candidate: an actual extracted directory-creation branch with a replacement injected immediately before filesystem mutation creates a directory under an outside symlink target. Parent inspection followed by path-based creation does not prevent that mutation. Require anchored directory creation and review file publication/rollback for the same race; cancellation controls alone do not establish ownership safety. Evidence: primary private `native-training-staging-root-review-2026-10-02-v1/review.private.json` and `ancestor-race.mjs`. The owned temporary test tree was removed. No candidate was transferred; no native/backend resources were acquired; native/public counts remain zero. No product, provider or localization behavior changed.

### Qualified source drift audit (2026-10-02)

BL-018/D-218 source reconciliation is **In progress**. Root census confirms the qualified runner differs from its prior `03993d` preimage and is now `26691b040d53c1549d2dc2d70c595d5b076a61f3c113065699ed3dedee127b4b`; its delta adds Android camera public acquisition/finalization. Mutation ownership remains unconfirmed. The camera author separately reports that an initial validation overlay followed a symlink while copying the declaration generator. Root confirms the qualified generator is now `51f5bbc757ae16629bd89e2ed89011139c4f47bd8ae3962688acbcdd979686b5`, while the primary retains `033e4eeadaf53de4489148ac7c3490a2741ea2a9ad2a2bc14bacac9abb3af70b`. The exact generator difference is three Android public owner-path registrations. These changes are preserved as current state, not accepted integration or freshness proof.

Private regular-file backups, current inode/mode/hash census and generator delta are retained under primary `current-generator-and-runner-drift-audit-2026-10-02-v1`. Rebase minimal reviewed patches against current bytes and requalify the complete closure; never overwrite the current runner with a historical snapshot. No native/backend execution or product/provider/localization change is claimed.

### Caller and staging follow-up reviews (2026-10-02)

BL-018/D-218/T14-E owned Detox save/retry caller remains **In progress**, with source transfer held. Independent review confirms the preceding connection journey ends as the student while Save/retry binds the coach without a proven account transition. It also requires current canonical selection comparison, structured terminal Save failure retention, bounded IPC draining before aggregate cleanup, shared fault identity, and protected screenshot publication. Four IPC controls do not prove actual caller composition. Evidence: primary private `detox-save-retry-owned-caller-independent-review-2026-10-02-v1/REVIEW.private.json` (SHA-256 `9ece5a6f7c69818d41498fd67818d7b0425d02c7f110ba13657581d13e28086c`).

Training staging V2 closes the tested ancestor replacement during directory creation; its two synthetic platform controls pass. Transfer remains held because post-create writer failures can leave untracked files, rollback has a replacement race, and cancellation during mutation-lock waiting lacks a final fence. V3 repair is In progress with actual write/rollback controls and minimal current P/Q runner deltas. Evidence: primary private `native-training-staging-lifecycle-v2-independent-review-2026-10-02-v1/REVIEW.private.json`. No source-only pass qualifies native/public execution; no product, provider or localization behavior changed.

### Shared publication and runner V6 reviews (2026-10-02)

BL-018/D-218/T13–T15 source repair remains **In progress**. Independent runner V6 review reproduces unsafe default-parent segment creation, restoration through a replaced cwd path, and cancellation after directory creation losing truthful recovery ownership. Its 27/27 overlay controls and focused typecheck do not cover those failures. V7 repair is assigned; no helper or runner integration is accepted. Proof: primary private `t15-public-runner-identity-pq-repair-2026-10-02-v6-independent-review-2026-10-02-v1/REVIEW.private.json`.

iOS dispatcher V6 preserves partial bridge facts and passes nine lifecycle controls; ten shared evidence controls also pass. Independent review nevertheless reproduces an outside temporary file when the checked output ancestor is replaced immediately before shared writer publication. Descriptor reread detects the replacement afterward but does not prevent the outside mutation. Transfer is held while the shared writer receives an ancestor-safe publication/recovery repair. Proof: primary private `ios-detox-dispatch-v6-independent-review-2026-10-02-v1/REVIEW.private.json` (SHA-256 `b371559017b6d01f7e12182276267660b2ba4d2bea64d73912e167c8c156b1f9`). Current inventory/format/dependency drift must also be reconciled before whole-graph qualification. Source tests create zero native/public/cold passing attempts. No product/provider/localization behavior changed.

### Cold-runner handoff V6 independent replay (2026-10-03)

Status: **In progress; canonical transfer and native execution Pending**.
Root independently replayed the frozen V6 process-binding, CLI and runner-helper
controls: 15/15 passed, with no skips or cancellations (output `e120fd`). These
controls exercise the invocation helper and inspect the real runner call site;
they do not execute the full public runner main or qualify a native/cold attempt.
The review holds transfer while checking cancellation propagation: the injected
handoff receives neither the active signal nor deadline, and its private receipt
writer calls omit the optional signal. Preserve the sealed V6 packet and rebase
any repair against the current independently reviewed identity helper.
Evidence: `t15-cold-v6-root-review-2026-10-03-v1/REVIEW.private.json`.
Native/public/cold passing counts remain zero. This QA-only review changes no
product behavior, provider contract, localized copy or domain requirements.

### Current native source review gates (2026-10-03)

Status: **In progress; transfer blocked pending specific repairs**.

- Runner identity V7: independent review reproduces an unbounded synchronous
  helper (20 ms recovery returned after 253 ms), create-cancellation ownership
  loss, unsafe saved-cwd restoration, and concurrent test isolation failure
  (28/29 concurrent; 29/29 serial). Preserve current P/Q runner changes while
  preparing the next minimal patch. Evidence:
  `t15-public-runner-identity-v7-independent-review-2026-10-02-v1/REVIEW.private.json`.
- Android camera public V4: 18/18 included controls pass, but independent
  boundary controls reproduce deadline overrun and deletion of a replacement
  inode. Bound the helper lifecycle and preserve replacements or record truthful
  recovery retention. Evidence:
  `android-camera-public-dispatch-independent-review-2026-10-02-v1/REVIEW.private.json`.
- Cold handoff V6: the root cancellation control aborts before actual handoff;
  the helper nevertheless publishes the final reset receipt and returns success
  (output `126991`). Thread the active signal/deadline through the handoff and
  writer. Evidence: `t15-cold-v6-root-review-2026-10-03-v1/REVIEW.private.json`.
- Save/retry caller V3: root replay passes 12/12 with the explicit source-root
  environment. The tests cover helper, child-action and cleanup boundaries;
  they do not call the full owned Save dispatcher. Add that composition control
  before claiming the new caller wiring is validated. Evidence:
  `detox-save-retry-v3-root-review-2026-10-03-v1/REVIEW.private.json`.

These are source repair gates, not adoption decisions. Native/public/cold
passing counts remain zero; T14–T20 acceptance remains Pending. No product,
provider, domain requirement or localized copy change is introduced.

### Native publication and selection frontier (2026-10-03)

BL-018/D-218/T13–T15 remain **In progress**. Root independently reproduces
foreign replacement deletion in shared writer V8: replacement immediately inside
the final `unlinkat` call is deleted while the helper reports `removed`
(output `12335a`). Preserve the sealed V8 candidate and prepare atomic
no-replace normal publication plus truthful retained recovery where conditional
removal cannot be guaranteed. The local Darwin primitive was actually tested:
`renameatx_np` with SDK-defined `RENAME_EXCL` preserves an existing destination
(`EEXIST`) and publishes a single-link final inode without temporary unlink
(output `89113a`). This primitive control is source evidence only. Proof:
`detox-evidence-v8-root-review-2026-10-03-v1/REVIEW.private.json` and
`final-unlink-control.py`.

Current inventory validation is insufficient for native acquisition. The primary
inventory validator exits 2 on a missing/escaped/symlink owner path (`d1f1a3`);
the qualified validator exits 0 with zero passing scenarios (`c7c540`), but actual
qualified iOS Detox Save selection exits 2 on stale governing inputs (`b62055`).
Refresh the current complete declaration after accepted source integration;
do not substitute synthetic hashes or treat inventory schema success as fresh
selection proof. No product/provider/localization behavior changed, and no
native/public/cold passing attempt is added.

### Training staging V6 reviewed source integration (2026-10-03)

Status: reviewed staging source **Done**; runner wiring and native qualification
**Pending**. Root reviewed the final author freeze, verified overlay source/test
bytes against the frozen candidate, and replayed the actual rollback control:
file and directory recovery are retained without a foreign deletion. The two
exact files are guarded into both roots, preserving existing modes and current
runner bytes. Normal synthetic staging passes 2/2 in each canonical root;
scoped lint and formatting pass. Test inventories are refreshed and current at
424 files (361 client, 63 server).

The adjacent actual training adapter controls pass 9/11 in each root: primary
failures remain the preserved owner-path gap; qualified failures remain stale
canonical governing inputs. Full qualified TypeScript still reports seven
existing runner errors and no error in the integrated files. These failures are
retained and are not relabeled as passes. No runner patch or native attempt was
transferred/executed. Evidence:
`native-training-staging-v6-reviewed-source-integration-2026-10-03-v1/accepted-source-transfer.private.json`
and `canonical-validation.private.json`. This QA-only change introduces no
product/provider/localization behavior change.

### Cold cancellation V7 and caller ownership (2026-10-03)

BL-018/D-218/T15 cold handoff remains **In progress**. Root replay confirms the
narrow cancellation repair: 3/3 new controls and 15/15 retained patched controls
pass (`d69cfb`, `6abe99`). Abort before actual handoff publishes no final receipt,
and abort after the awaited handoff prevents successful preflight return.

Integration is held on ownership propagation. The helper allocates the output
root before handoff; the actual runner assigns `preparedInvocation` only after
that helper returns. A source-matching caller control with the actual helper and
handoff confirms that cancellation leaves the allocated directory present while
the caller assignment is undefined (`0b930f`). Preserve the validated namespace
identity in the actual caller before handoff can fail, and bind blocked/recovery
publication to it. This control does not execute full public main or a native
attempt. Evidence: `t15-cold-v7-root-review-2026-10-03-v1/REVIEW.private.json`
and `caller-ownership-control.test.ts`. No product/provider/localization behavior
changed; native/public/cold passing counts remain zero.

### Parallel source review frontier (2026-10-03)

BL-018/D-218/T13–T15 remain **In progress**. Root replayed the frozen Android
camera public-dispatch V5 candidate: all four candidate files match the regular
validation overlay, and 21/21 focused controls pass (`6f74f8`). The last
identity check followed by conditional file/directory removal still requires
independent review at the final syscall boundary; the earlier replacement hook
does not establish atomic removal. No camera candidate is integrated by this
review. Evidence: `android-camera-v5-root-review-2026-10-03-v1/REVIEW.private.json`.

Root replayed Save/retry owned-caller V5: all eleven candidate files match the
regular validation overlay and 19/19 controls pass (`d1cd74`), including saved
success followed by failed cleanup and retained coach transition on outer
failure. Independent review and integration remain Pending. Evidence:
`detox-save-retry-v5-root-review-2026-10-03-v1/REVIEW.private.json`.

The evidence-writer V9 formatting-only transfer candidate has equal TypeScript
syntax trees to its frozen author source, passes 10/10 controls and an explicit
nonignored formatting check. Its actual spawn-failure and retained-recovery
controls remain source evidence; independent review and auxiliary Python source
closure are Pending. Evidence:
`detox-evidence-v9-root-review-2026-10-03-v1/format-transform.private.json`.
No native/public/cold passing count changes; all remain zero. This records QA
implementation state only, with no product, provider, or localization change.

### Final cleanup boundary review (2026-10-03)

BL-018/D-218/T13–T15 remain **In progress**. Cold handoff V8 is independently
accepted for source integration: the actual caller receives the prepared owned
invocation before handoff failure. Its review is
`t15-cold-dispatcher-cli-subprocess-runner-v8-independent-review-2026-10-03-v1`;
runner identity repair and current graph composition are still Pending.

Camera public-dispatch V5 is held despite 21/21 focused passes. Root executed
the actual anchored child script with a replacement at the final unlink call,
after its second identity observation. The operation deleted the replacement
and returned `removed:true` (`146833`). Evidence:
`android-camera-v5-root-review-2026-10-03-v1/final-delete-control.private.json`.
Camera V6 repair is In progress; no V5 transfer is authorized by those tests.

Evidence-writer V9 independent review holds transfer on artifact-root creation
through replaceable ancestors and the exported conditional unlink helper.
Review: `detox-connection-evidence-v9-independent-review-2026-10-03-v1`.
The writer's 10/10 controls remain narrow source evidence. V10 repairs are
In progress. No native/public/cold pass or product behavior change is claimed.

### Save/retry V5 independent cleanup review (2026-10-03)

BL-018/D-218/T14-E remains **In progress**. Independent review retains 19/19
focused source passes and confirms V5's complete terminal and transition source
repairs. Transfer is held because a not-verified Save drain becomes an ordinary
cleanup failure while aggregate recovery can remain `verified`, allowing later
cleanup despite pending child work. V6 repair must lower the actual aggregate
recovery gate, retain pending identities and exercise the real owner fallback
branch. Its new immutable packet must also satisfy the declared private
directory modes. Review:
`detox-save-retry-owned-caller-independent-review-2026-10-02-v3/REVIEW.private.json`.
No V5 source transfer or native/public qualification is claimed.

### Runner identity V9 helper integration (2026-10-03)

BL-018/D-218/T13–T15 remain **In progress**. The independently accepted V9
invocation helper is integrated into both roots. Current React Native ambient
types required a bounded integration repair: runtime narrowing for optional
Node timer `unref` and the filtered worker environment's explicit `NODE_ENV`.
The final helper passes 21/21 selected functional controls, zero-warning scoped
lint and formatting. The four full-runner/CLI cases remain outside this cohort;
the initial broad filter's three missing-input failures are preserved.

Full qualified TypeScript now reports only two runner diagnostics: the absent
Android camera public module and the unknown finalizer value. The helper has
no diagnostic. Runner, preflight and test composition, declaration freshness,
and runtime qualification remain Pending. Evidence:
`t15-identity-v9-helper-reviewed-source-integration-2026-10-03-v1/accepted-source-transfer.private.json`
and `current-type-integration.private.json`. The final helper hash is
`390d41250b54a487bb49c89387dc3665636cb98e9ab72cf2defc68419c0803f6`.
No native/public/cold pass is claimed. This is QA infrastructure only; no
product, authentication, provider or localization behavior changed.

### Current combined runner integration (2026-10-03)

The reviewed five-file runner composition is integrated into both roots with guarded minimal runner patches, preserving camera branches and existing modes. Identity, cold handoff cancellation, early namespace ownership and training lifecycle changes now compose in the current runner. Both canonical identity suites pass 25/25; scoped formatting passes in both roots and scoped primary lint passes without warnings. Qualified full TypeScript reports one missing Android camera public-attempt module; qualified scoped lint retains that error and 199 derived unsafe-type warnings. Camera source integration and a fresh complete graph check remain Pending.

Both current test inventories pass freshness at 425 files (362 client, 63 server); both impact checks validate 12 features, 45 suites and 64 UI specs. Proof: `t15-runner-v9-current-composition-source-integration-2026-10-03-v1/accepted-source-transfer.private.json` and `canonical-validation.private.json`. These source controls create zero native/public/cold passing attempts. The primary deleted plan source is preserved. No product, provider, localization or authentication behavior changed.

### Detox evidence writer V12 guarded source transfer — 2026-10-03

BL-018/D-218/T14-C evidence-writer source integration is **Done (source)** in both current roots. The guarded transfer installed exactly five frozen V12 files: the TypeScript writer, Python ancestor-safe sidecar, IPC schema/validator, V10 focused regression, and adjacent connection regression. Private P/Q preimages, symlink checks, source hashes, and installed hashes are retained in `detox-connection-evidence-v12-source-integration-2026-10-03-v1/transfer.private.json`; the immutable V12 source freeze is `detox-connection-evidence-v12-validation-repair-2026-10-03-v1/FREEZE.private.json` (SHA-256 `a0d82e9fef959d4ee92a27e37c0b475fe13776f4c90af1bc1bec1fb8c741a1d1`).

The actual source cohorts pass 23/23 in each root (13 V10 controls and 10 adjacent controls). Changed TypeScript inputs pass no-ignore zero-warning ESLint and Prettier; the Python sidecar compiles. Qualified full TypeScript remains blocked by existing current-runner diagnostics in `scripts/testing/run-native-pilot.ts` (camera staging argument shape and nullable capture-run identity); none points to the transferred writer files. Inventory freshness is intentionally left for the root-owned refresh: both checks report 427 discovered test files versus the stored 425. Caller-owned artifact-root precreation remains **Pending**, and no native, device, backend, hosted, public, or cold passing attempt is claimed. No product, provider, authentication, localization, or screen-copy behavior changed.

### 2026-10-03 — Actual iOS Maestro training pilot, retained harness failure

The documented `yarn test:e2e:native:pilot --platform=ios --engine=maestro --scenario=SCN-training-ios --mode=integration` command ran in the qualified native worktree. Requested run `62e19824831750068079a6a9` linked capture `dd133cabd89a894e451c0f80`; the original first attempt is retained. Fresh build, native UI creation, first save/read, edit, second save/read and relaunch capture completed. Child exit was 0, capture result `observed`, but public exit was 2 / `harness-blocked` / `runtime-verification-failed`: the assertion mapper rejected a declared shared helper path with `Runtime helper path is unsupported`. This is a harness failure, not a passing native case or an established product failure. Seven required NAT-training assertions remain unqualified.

Measured build/install/reset/scenario/verify/cleanup milliseconds were respectively 651513 / 9596 / 65662 / 801806 / 387 / 7519. These are this retained attempt's timings, not a full cold-comparison estimate or successful cell result. The build was Metro-attached Debug; bundled release qualification remains pending.

Root independently reran the read-only owned iOS cleanup inspection after terminal exit: passed, 483 PID/start pairs, no survivors or unknown process queries, no missing foreign devices, owned simulator/cache absent, and no owned Docker container/network/volume. Separate root inspection records are in private packet `native-training-ios-public-pilot-live-2026-10-03-v1`; original public receipt/capture/cleanup records remain unchanged. No device session remains live. The source/documentation hold is lifted for coordinated integration.

Next: repair exact declaration-bound shared helper validation with a failing-before/passing-after control using the actual captured helper list, preserve arbitrary-path rejection, then qualify immutable build reuse separately before a fresh attempt. Do not republish this failed receipt as passing. Cold production composition additionally lacks a real same-attempt ownership-record publisher and reset-to-device/backend binding; its unit controls do not establish production execution. T14/T15, all 400 cold attempts, hosted adoption, retirement and final completion remain pending. No product behavior, localization or backend-provider change was made by this checkpoint.

### 2026-10-03 — Immutable iOS Debug build reuse qualification

Root visually reviewed the retained native sign-in screenshot and then ran the existing `validateReusableIosBuild` and `loadReusableIosBuild` contracts against fresh current source identity, original binary bytes, embedded integrated Expo configuration, bootstrap health, bounded screenshot/hierarchy hashes and the independently rechecked cleanup. Both passed for capture `dd133cabd89a894e451c0f80`, binary SHA-256 `f76da9079a25b1a608e72c148c953f0c3f7f516cbfd4ade98432a5a54ef16ee8`, source tree `b15844b46ab57ff14792d15a7a3264c847b4f0ce85c1f97a5e7cdb5f5f14427b`. New entry qualification was created exclusively; original failed behavioral receipt was unchanged. Root result is retained separately as `root-build-reuse-qualified.private.json` in the live-pilot inspection packet.

This qualifies immutable Metro-attached Debug build bytes only. It does not qualify the training assertions, bundled release, old simulator/backend/session reuse, or a cold-comparison pass. Any next run must reserve fresh endpoints/owned resources and revalidate current build inputs; changed uncompiled test helpers require fresh runtime evidence, while changed app build inputs invalidate this qualification. Native passing cases remain zero.

### 2026-10-03 — Measured training-cell cost before cold comparison

The retained iOS/Maestro/integration training attempt measured 651.51 seconds of build time and 884.97 seconds across install, reset, scenario, verification and cleanup. If twenty fresh same-cell attempts matched that nonbuild duration and kept one qualified build, planning cost would be 294.99 minutes with the existing build, or 305.85 minutes including one compile. This is a cost estimate from a harness-blocked pilot, not successful smoke, cold-attempt, reliability or adoption evidence. The other nineteen required cells are unmeasured and must not be pooled or extrapolated from this one. Exact inputs and assumptions are retained in private `training-ios-maestro-measured-cost.private.json`. No comparison was scheduled or executed; balanced ordering, all 400 retained first attempts, same-attempt reset ownership and per-cell regression/decision evidence remain pending.

### 2026-10-03 — Current iOS Detox prerequisites integrated

Root integrated six minimal patches from reviewed `ios-detox-dispatch-current-generator-integration-2026-10-03-v2` into both current worktrees after all recorded source hashes and permissions matched and both combined dry runs passed. Dispatcher is now `85d03aeb6557cc43fc5f8102ce4d912b5b50f90febc1dbc209e69217d095d088`; generator is `edb5c13e72f3b5bf9dee6cfb7675943dbe583ad1942d07a394538d23bc7da536`; shared helper ledger is `c024c1b75a02e62394e2c0e04ba60261fea7796a2dd4ce45718a67fc0073ed5a`. Existing modes were preserved, new tests are regular `0644`, current camera registrations remain, and unchanged V12 Python writer bytes were not rewritten. The helper ledger now binds the reviewed transitive inputs; subsequent verifier repairs must use that current declaration.

Actual qualified-worktree validation: 17/17 lifecycle and closure controls; full TypeScript, no-ignore ESLint with zero warnings, and explicit Prettier all exit 0. Regenerated native declaration validates with 23 views, 40 transitions, 10 scenarios and zero receipts (SHA-256 `901a05936e182ed1cf0cd0a16dd9f8911036742f86e17a1888230d133ebf9ab1`). Training scenario selection accepts the current sources/requirements and binds all seven required assertions. Primary declaration generation remains blocked by the preserved user deletion of `features/plans/plan-source.ts`; no primary runtime qualification is inferred. Evidence: private `ios-detox-current-base-source-integration-2026-10-03-v1` transfer and validation records.

The separate post-bridge hash reread remains unintegrated: independent review requires cancellation/deadline fences and same-byte replacement rejection. Artifact-root recovery, training helper validation and cold same-attempt producer wiring are still in repair. Source preparation is not native evidence; T14/T15 and native passing cases remain pending/zero. No product behavior, copy, localization or backend-provider baseline changed.

### 2026-10-03 — Test inventory after iOS prerequisite integration

Both current roots now inventory 428 test files (365 client, 63 server), including the integrated iOS dispatcher lifecycle regression. Generation and independent freshness checks pass in both roots. Both test-impact validators pass with 12 features, 45 suites and 64 UI specs. This updates the earlier dated inventory counts; it does not imply native execution or additional passing native cases. The primary generator used the qualified worktree's existing TypeScript and Prettier packages through a bounded module-resolution hook; no dependencies, source trees or symlinks were copied or installed. The preserved primary plan-source deletion remains unchanged. No product, provider, authentication, localization or screen-copy behavior changed.

### 2026-10-03 — Training helper declaration repair integrated

The reviewed V1 mapper/selection-contract hunks and V2 corrected generator/durable regression are integrated in both roots. The stale V1 generator hunk was excluded; the explicit iOS Python writer registration and auxiliary closure are preserved. Exact producer helper lists, ordered capture rows, owner membership and current bytes are now checked; selection rejects missing owners before resource acquisition. All six iOS/Android controls pass in each root. Qualified combined lifecycle/closure/helper controls pass 23/23; full TypeScript, no-ignore zero-warning lint and canonical formatting checks pass. Canonical formatting corrected two warnings in the source candidates. Regenerated native declaration contains 23 views, 40 transitions and ten scenarios, with zero runtime passes; fresh training selection binds all seven required assertions. Original failed attempt is unchanged. Evidence: `native-training-helper-current-integration-2026-10-03-v1`. A fresh native run remains Pending; this is QA infrastructure only, with no product, provider, authentication or localization behavior change.

### 2026-10-03 — First verified native training smoke pass

The fresh documented iOS/Maestro/integration command passed with public exit 0: requested run `a256828870ad10ced9b77f37`, capture `996c6bd1e30ab4324943fe76`. All seven required assertions passed: normal entry, local draft, first save, edit draft, edited save, relaunch/read, and unchanged unrelated state. Evidence includes normal UI entry and independent owned API/SQL checks. The original failed attempt `62e19824831750068079a6a9` remains unchanged.

Reported cleanup is clean, and root independently verified it after terminal exit: 511 PID/start pairs, no survivors or unknown queries, no missing foreign devices, owned simulator/cache absent, and no owned Docker containers/networks/volumes. The qualified-worktree source hold is released for root integration. Private `native-training-ios-repaired-public-pilot-live-2026-10-03-v1` retains terminal, entry visual review and independent cleanup records.

This qualifies one iOS/Maestro/integration training smoke case using immutable previously qualified Metro-attached Debug build bytes. It is not a fresh compile, bundled release, physical-device acceptance, other engine/platform/family qualification, cold comparison or full T14 completion. Portable source declarations intentionally retain no runtime receipts; operational results live here and in the private receipt. Build-reuse validation/install/reset/scenario/verify/cleanup measured 1479.51 / 13205.68 / 51891.76 / 867727.64 / 1242.42 / 7612.19 ms. Nonbuild elapsed time was 941.68 seconds; other cells are unmeasured. No migration/retirement recommendation or cold pass is inferred.

The current unit inventory is 429 test files (366 client, 63 server), following the durable helper regression. No product, provider, authentication, localization or screen-copy behavior changed.

### 2026-10-03 — Runtime closure fences integrated and inventories refreshed

Reviewed MCP V4 runtime closure fences are integrated in both roots. The dispatcher now retains source identities across the bridge, rejects same-byte inode replacement, and rechecks cancellation/deadline while preserving cleanup facts. The combined closure/lifecycle/helper cohort passes 28/28; qualified full TypeScript, no-ignore zero-warning lint and explicit formatting pass. Existing source modes were preserved. Private evidence: `ios-detox-runtime-fence-v4-current-integration-2026-10-03-v1/VALIDATION.private.json`.

Both inventories and freshness checks pass at 430 test files (367 client, 63 server); both impact checks validate 12 features, 45 suites and 64 UI specs. The qualified native declaration validates 23 views, 40 transitions and ten source scenarios; portable runtime receipts remain zero by design. The earlier actual seven-assertion iOS Maestro training pass belongs to its recorded source checkpoint and is not execution proof for these newer harness changes. Public Detox wiring, artifact-root composition, same-attempt cold reset, further native cells and hosted qualification remain Pending. No product, authentication, localization or backend-provider behavior changed.

### 2026-10-03 — Broader public runner controls expose early receipt gap

Expanded qualified adapter/contract/invocation/build-reuse/session-finalization controls ran 54 cases: 51 passed, three stale runner expectations failed. The root corrected Android camera eligibility in the qualified test only (primary retains its absent branch), and both tests now validate the attempt-identity sidecar, default run-to-attempt binding, output paths and private modes. Both formatting checks and qualified zero-warning lint pass. The resulting runner cohort is **8/9 in each root**, not a passing gate. Qualified execution reveals an actual early invalid-CLI receipt with `repositories: []`, violating public receipt schema `minItems: 1`; repair must preserve truthful identity and normal/passing evidence requirements. Primary execution is additionally blocked earlier by the preserved stale native declaration. Private proof: `native-runner-current-expectation-repair-2026-10-03-v1/VALIDATION.private.json`; original receipts and failures remain retained.

The primary combined runtime/closure/helper cohort is 22/28, with six failures in its stale declaration; its deleted plan source remains untouched. Qualified 28/28 evidence is still valid for its explicitly scoped cohort, but it does not prove the broader runner contract. No new native/backend/device run occurred. No product, provider, authentication, localization or screen-copy behavior changed.

### 2026-10-03 — Actual iOS Maestro connection attempt retained as blocked

Public attempt `93371072a35fd7eaf52fe578`, capture `85b071dc75bd6260662478c0`, is terminal with exit 2 / `harness-blocked` / `runtime-execution-failed`. The coach-home setup failed its exact email-value assertion after tap/inputText; the retained screenshot still shows the initial sign-in placeholder. The connection callback ran zero times. This is a harness setup failure, not an established product failure or passing connection case. Original public receipt, capture and Maestro failure evidence remain unchanged.

Root independently inspected cleanup after terminal exit: passed, 61 PID/start pairs, no survivors or unknown process queries, no missing foreign devices, owned simulator/cache absent, and no owned Docker containers/networks/volumes. Timings in ms: build-reuse validation 1832.52, install 15629.28, reset 52748.17, scenario 131567.35, adapter verify 0.67, adapter cleanup 11096.93. Private inspection: `native-connection-ios-public-pilot-live-2026-10-03-v1`. Qualified source/documentation hold is lifted for root integration. Next repair must diagnose the actual credential-entry seam and preserve exact-value verification; do not suppress the assertion or reuse this failed receipt as passing. The earlier training smoke remains the only qualified operational case. No product, provider, authentication, localization or screen-copy behavior changed.

### 2026-10-03 — Explicit credential diagnostic route integrated

The prior owned `entry` command completed with exit 0, but capture `c4c5406ff9e8f8856b3846d1` contains only `SCR-sign-in`, zero diagnostic stages and zero native pilot passes. Root independently inspected cleanup: passed, 39 PID/start pairs, no survivors/unknown queries/missing foreign devices, owned simulator/cache absent and no owned Docker resources. Source inspection establishes the old nested `entry` diagnostic condition was unreachable under the outer authenticated charter allowlist. This corrects earlier source-only claims of capture-used reachability; original packets and receipts remain unchanged.

After updating the stable declaration contract and D-218/pending-wiring entries, root minimally added `credential-entry-diagnostic` to the CLI grammar and actual authenticated prelude route in both roots, leaving default `entry` snapshot-only. The existing no-retry staged diagnostic and password-only continuation are retained. The existing all-charter control now supplies required locale args for its locale charters; its first 43/44 failure and initial formatting/lint warnings are retained. Final diagnostic/lifecycle cohorts pass 44/44 in each root; qualified full TypeScript, zero-warning lint, formatting and native validator pass. Qualified declaration regeneration retains 23 views, 40 transitions, ten pilot scenarios and zero portable runtime receipts. Both unit inventories retain 430 files. Proof: `ios-credential-diagnostic-route-integration-2026-10-03-v1/VALIDATION.private.json`. Independent source review and fresh native diagnostic remain Pending. No product, provider, authentication-policy, localization or screen-copy behavior changed.

### 2026-10-03 — Explicit credential diagnostic blocked before entry

Capture `844b73bde8e51bd71cf59b00` / exec session 10239 is terminal with exit 2, `harness-blocked`, reported clean cleanup and no view/credential-stage observations. Initial `simctl launch --terminate-running-process` failed before entry. The simulator remained Booted/available at the failure observation and Metro reported ready; neither establishes a launch cause. The original initial launch uses an unledgered `execFile`, so child exit/signal/timeout evidence is missing. It must use the existing owned native command path with the same deadline and no retry before the next diagnostic.

Independent cleanup passed after terminal exit: 18 PID/start pairs, no survivors/unknown queries/missing foreign devices, owned simulator/cache absent and no owned Docker resources. Original capture/logs remain unchanged; private terminal/cleanup records are in `ios-explicit-credential-diagnostic-live-2026-10-03-v1`. The route's source controls remain 44/44, but this attempt does not qualify the diagnostic or establish a product/credential failure. Qualified source/documentation hold is lifted for root integration. No new native pilot pass is claimed.

Root launch evidence follow-up (2026-10-03): initial iOS simctl launch now uses the existing owned command executor at the same requested 30-second deadline, without retries. Fifteen focused controls, qualified full TypeScript and zero-warning lint passed. No fresh native pass is claimed. Independent explicit credential-route review found D218-WITNESS-001: password-offer and post-dismissal home evidence must be bound to the current diagnostic continuation; that route remains source-blocked pending repair.

Camera V4 common source integration (2026-10-03): both roots now contain the reviewed staging, attempt finalizer seam and common controls. Qualified controls pass 24/24 after declaration regeneration; full qualified TypeScript, zero-warning lint and format pass. Original 20/24 stale-declaration result is retained. Primary full controls remain blocked by its preserved declaration gap. The runner propagation change remains pending a canonical path fence for symlink ancestors; no native/public passing attempt is added. Evidence: `android-camera-v4-common-source-integration-2026-10-03-v1/VALIDATION.private.json`.

Credential diagnostic frame namespace repair (2026-10-03): actual capture `0c56be752488c9d3d8174d7b` reached sign-in and its owned launch/hierarchy commands exited zero, but the diagnostic entry frame collided with the existing startup `entry-hierarchy.json` exclusive write. Diagnostic frame files now use a `credential-` prefix; startup evidence remains preserved. This changes only harness artifact naming, with native qualification Pending. Independent cleanup passed 51 PID/start pairs with no survivors, unknown queries, missing foreign devices, owned simulator/cache or Docker resources. No product, auth, provider or copy behavior changed. Evidence: `ios-owned-launch-credential-diagnostic-live-2026-10-03-v3/TERMINAL.private.json`.

Dispatcher fixture repair (2026-10-03): tests now create actual private artifact parents and clean them in `finally`, replacing invalid `.qa/attempts` and nonexistent `/qualified` roots. Production ownership, inode, post-bridge, deadline and cancellation requirements are preserved. Private overlay controls pass 14/14; canonical validation is in progress. No product behavior changes or new native pass. The latest namespace-repaired diagnostic capture `7b109ec0e2caccc05aef6ff8` stopped at the owned 30-second app-launch deadline, before entry; independent cleanup passed 19 PID/start pairs without residue.

Current integration reconciliation (2026-10-03): the credential diagnostic witness behavior is source-accepted following 39/39 controls and independent review. The historical write provenance of the prior `a4110d2a` source remains unattributed and retained; root did not reconstruct it. The subsequent root-owned namespace repair is documented separately. Runtime qualification remains Pending after the retained hierarchy filename collision and launch-deadline attempts; no new native pass is claimed.

The guarded root/MCP/Save/retry/deadline composition is installed in both checkouts. Actual qualified TypeScript and scoped lint pass. Independent broader controls passed 143/147 before follow-up repairs; publication-pending tracking, runner-path fixtures, Android query provenance fixtures and early blocked-receipt finalization remain owned repairs. The dispatcher fixture subset is now repaired and passes 14/14 in both checkouts without production assertion changes. Current unit inventories contain 434 files (371 client, 63 server). Primary native declaration remains unqualified because its preserved deleted plan source is not restored. All five families, both platforms/engines, cold comparison, actual exploration, hosted adoption and final audit remain required; installed source is not their completion evidence. No FR/UC/AC/BR/screen/copy/provider contract changed, so those artifacts require no update for these harness repairs.

DXR publication and fixture repair (2026-10-03): the owned evidence writer records in-flight publication stages through sidecar finalization and revalidates the recorded inode before pending classification. Ordinary final files remain non-pending. Runner fixtures now include required Save/retry action/protocol files; Android query fixtures declare their existing query provenance. Three original failures are retained; integrated validation is in progress. This changes harness behavior only. Native/public qualification remains Pending; no product/auth/provider/localization contract changed.

Cold-reset helper integration (2026-10-03): root verified V8 payload hashes, private modes, minimal patches and actual Q TypeScript composition (753 roots, 1861 source files, zero diagnostics). Q capture and protected reset producer/consumer/handoff helpers are being integrated with durable controls. Public cold-runner dispatch remains Pending while its overlapping receipt and Detox changes are composed. Independent behavioral review and native cold-reset evidence remain Pending; no cold comparison or passing native result is claimed. Primary unknown cold-handoff source is preserved. This changes test-harness behavior only; product requirements, localization and provider contracts are unchanged.

Cold-reset helper validation (2026-10-03): guarded Q integration is complete for capture/producer/consumer/handoff/runtime-link and three durable controls. Canonical tests pass 15/15, helper closure passes 8/8, full Q TypeScript, scoped zero-warning lint and formatting pass. Regenerated declaration validates 23 views, 40 transitions, ten scenarios and zero runtime receipts; Q unit inventory is 438 files (375 client, 63 server). Public runner composition, independent behavioral review, fresh native reset evidence and the 400-attempt comparison remain Pending. Primary unknown cold-handoff bytes remain preserved. Evidence: `t15-cold-v8-root-full-graph-review-2026-10-03-v1/CANONICAL-VALIDATION.private.json`.

Android query-provenance contract repair (2026-10-03): DXR003 V2 aligns the actual storage producer and both consumers on required `querySource.kind: query`; missing or wrong roles fail closed. Root is applying the guarded source and producer-to-both-consumer controls in both roots. Canonical validation is in progress; native/public qualification remains Pending. This repairs a harness receipt mismatch without changing product behavior or provider/localization contracts.

Android query-provenance canonical validation (2026-10-03): the original 37-control group and two producer-to-both-consumer role controls now pass 39/39 in both roots. Q full TypeScript, scoped zero-warning lint, formatting and regenerated native declaration pass. Current inventories differ intentionally: P 436 files (373 client, 63 server), Q 439 (376 client, 63 server) after Q-only cold controls. DXR003 is resolved at the source contract boundary; native/public qualification remains Pending. Evidence: `dxr003-v2-canonical-integration-2026-10-03-v1/VALIDATION.private.json`.

Credential diagnostic runtime verification (2026-10-03): owned attempt `5b798fd95ecaa1f912654bc1` exited zero with observed sign-in and coach home. All three diagnostic frame pairs were retained under the repaired `credential-` namespace; the exact same-field email assertion passed. The sidecar is valid/observed and the continuation reached coach home. Independent cleanup passed 127 PID/start pairs with no survivors, unknown process queries, missing foreign devices, owned simulator/cache or Docker resources. Original failed attempts remain unchanged and their causes remain unproved; this diagnostic adds zero passing journey cases. Source/documentation hold is released. Evidence: `ios-launch-service-credential-diagnostic-live-2026-10-03-v1/TERMINAL.private.json`.

Cold public wiring independent review (2026-10-03): V8 namespace and closure repairs are accepted as source preparation only. Public cold dispatch remains Pending because four iOS adapters do not forward reset options, additional handoff type dependencies are omitted from freshness, and acquired identity, signal/deadline bounds, publication descriptors and final filename binding need repair. V9 owns these gaps; the installed Q helper controls do not waive them. The iOS Detox runtime-verifier V1 is also blocked before transfer because its required runtime envelopes lack actual producer emitters and its build/runtime facts are caller-supplied. Both candidates must be repaired through their actual producer-to-terminal chains before native promotion. No product, provider, auth-policy, screen-copy or localization behavior changed.

Combined Q public runner integration (2026-10-03): root validated the composed receipt/repository-observation, iOS Detox and Android camera dispatch changes against the actual current Q TypeScript graph (754 roots, 1862 source files, zero diagnostics). Guarded minimal patches are being integrated; canonical behavioral validation remains in progress. Cold binding and deterministic runtime-verifier gaps remain Pending, so route registration does not establish native passing eligibility. Primary runner/source variants remain preserved. No product, provider, auth-policy, localization or screen-copy behavior changes.

Combined runner canonical controls (2026-10-03): five guarded Q patches are installed. The full runner/invocation/schema/original identity cohort passes 50/50 after two explicit fixture repairs: force the non-private directory mode under umask 077, and expect missing-build rejection for the newly wired iOS Detox route. Q full TypeScript, scoped zero-warning lint, formatting and declaration validation pass; P invocation controls pass 25/25 with its runner variant preserved. Original 48/50 failure and the disposable 44/45 result remain retained. Independent review still blocks qualification: cold input is admitted before adapters carry its binding, and non-abort identity read errors can bypass opaque terminal receipt finalization. Those paths are owned repairs, not waived by passing tests. Current inventories are Q 439/P 436. No native journey passes are added. Evidence: `native-pilot-composed-root-integration-2026-10-03-v1/CANONICAL-VALIDATION.private.json`.

Runtime freshness closure repair (2026-10-03): root integrated the independently reviewed cold dispatcher/comparison and iOS Detox declaration ownership rows in Q, with mirrored Android helper inputs and the actual repository-identity dependency. Canonical helper/declaration controls pass 9/9; full Q typecheck, scoped zero-warning lint, formatting and native inventory validation pass. The regenerated declaration contains 23 source views, 40 transitions and 10 untested scenarios with zero runtime passes. Before-repair helper controls already passed 8/8; this repair follows independently identified omitted source fingerprints and is not a failing-before regression claim. Independent closure review remains Pending. Existing cold adapter/provenance and repository failure-receipt blockers remain Pending. Proof: `native-runtime-freshness-closure-integration-2026-10-03-v1/CANONICAL-VALIDATION.private.json`. Product/provider/localization contracts are unchanged.

Cold dispatcher fixture reconciliation (2026-10-03): the current canonical dispatcher controls pass 8/22 and fail 14 because older reset fixtures omit descriptor identity and acquired target/backend rows required by the production boundary. A bounded private fixture repair passes 22/22 and a full Q CompilerHost overlay has zero diagnostics (754 roots, 1862 sources, one override). Independent review and canonical integration remain Pending. Production ownership, tampering and denominator checks are retained; this is source-control evidence, not 400 actual cold attempts or native qualification. Proof: `t15-current-dispatcher-fixture-failure-2026-10-03-v1/RESULT.private.json`. Product requirements, provider behavior and localized screen copy are unchanged.

Detox dispatch freshness reconciliation (2026-10-03): root repaired the Q generator to include all 102 explicit dispatch runtime paths in the iOS connection owner/freshness lists. Sixteen omitted paths are now present, including the generated inventory path under the explicit non-recursive source-revision policy. Three new regression controls fail 2/3 before repair and pass 3/3 after; the combined helper/declaration cohort passes 12/12, full Q CompilerHost reports zero diagnostics (754 roots, 1862 sources, one override), scoped zero-warning lint and inventory validation pass. Declaration remains 23 source views, 40 transitions, 10 untested scenarios and zero runtime passes. Primary source/deleted plan source/localization symlink remain preserved. Other cold adapter/provenance and runtime-verifier gates remain Pending. Product/provider/localization requirements did not change.

Repository failure terminal repair (2026-10-03): root integrated the bounded REPO-001 V2 runner/test patch in Q against verified preimages. Observed branded client/server rows are retained independently; unavailable rows become explicit partial/unknown evidence and cannot qualify a passing or product-failure receipt. The stable canonical cohort passes 55/55; actual full Q CompilerHost overlay has zero diagnostics (754 roots, 1862 sources, two overrides) and scoped zero-warning lint passes. The first cohort passed 54/55 with invalid-inventory during overlapping declaration regeneration; its failure is retained and the cause is not claimed as proven. Independent replay of the original failing-git CLI path remains Pending. Native/backend resources were not acquired; primary source is preserved. Proof: `repo001-v2-root-integration-2026-10-03-v1/CANONICAL-VALIDATION.private.json`. Product/provider/auth/localization behavior is unchanged.

REPO-001 independent acceptance (2026-10-03): Done for the Q source/terminal failure contract. Independent actual CLI replay against runner `f4009f40` now publishes a schema-valid blocked receipt with explicit unknown client/server evidence and zero stderr for the original failing-git case. Private real-client/missing-server replay preserves only the observed client identity; SIGTERM replay publishes a cancelled preflight receipt. All cases retain not-acquired cleanup, null target fields and zero passing assertions. Canonical 55/55, full graph, lint and format pass. Evidence: `repo001-v2-root-integration-2026-10-03-v1/INDEPENDENT-REPLAY-ACCEPTANCE.private.json`. This closes REPO-001 only; cold/runtime/native/public qualification remains Pending. No product/provider/auth/localization behavior changed.

Cold dispatcher fixture repair acceptance (2026-10-03): Done for the Q source controls. Independent review accepted the bounded target/backend/descriptor fixture repair with no assertion weakening. Root integrated it and corrected only import order after a canonical lint warning; production validation is unchanged. The canonical comparison/cold cohort now passes 65/65; independent fixture replay passes 22/22, full Q CompilerHost has zero diagnostics, and canonical scoped lint/format pass. Original 8/22 failure and private reviewed candidate are preserved. Evidence: `t15-current-dispatcher-fixture-failure-2026-10-03-v1/CANONICAL-VALIDATION.private.json`. These are source controls, not 400 actual cold attempts; native/runtime/adoption gates remain Pending. No product/provider/localization changes were made.

2026-10-03 — Cold-run wiring and connection runtime checkpoint: root integrated the independently reviewed V9 cold lifecycle patches in Q. All four iOS adapters forward reset/run identity; handoff checks protected descriptor and independently observed target/backend/source identities; proxy quiescence is bounded by cancellation/deadline; final reset receipt naming is immutable. Canonical cold/comparison controls pass 73/73, full Q TypeScript and scoped zero-warning lint/format pass. Regenerated declaration retains 23 views, 40 transitions, 10 scenarios and zero portable runtime passes. Cold Detox is temporarily rejected before native acquisition until its real reset producer is wired; this is an explicit Pending implementation gap, not a completed comparison. T15's 400 actual cold attempts remain Pending. Evidence: private `t15-cold-v9-root-integration-2026-10-03-v1/CANONICAL-VALIDATION.private.json`.

The separately executed iOS/Maestro connection attempt `4da7fd7e61dfb07f96b70b85`, capture `c871449884ff73f9186e038e`, is terminal harness-blocked with `notVisibleSelectors.map is not a function`, zero public assertions/passes, and independent cleaned proof covering 429 PID/start pairs. No survivors/unknown queries/missing foreign devices remained; owned simulator/cache/Docker resources were absent. The existing foreign simulator and all five foreign containers were preserved. This run used actual capture source `6de600ca`; the sealed V2 provenance audit confirms earlier overlay symlink write-through into that file. The bytes were not backdated to V8, and historical packets were not rewritten. Source/documentation hold is released after cleanup. The selector-shape repair, 18 static dependency content-revision preflight repair, runtime verifier qualification and remaining T14–T20 gates stay In progress/Pending. Evidence: private `ios-connection-qualified-reuse-public-live-2026-10-03-v1/TERMINAL.private.json` and `t15-cold-v9-capture-drift-audit-2026-10-03-v2`. No product/auth-policy/provider/localization behavior changed.

2026-10-03 — Connection observer and static dispatch preflight repair: the common iOS Maestro adapter now separates the shared sixth-argument Detox action from hidden selectors. Focused connection controls pass 13/13 in each root; Q full TypeScript, lint and formatting pass. Actual failing-before proof is retained capture `c871449884ff73f9186e038e`; its failure is not relabeled as a passing run. Root excluded a redundant toy legacy-map test and retained a real adapter callback control that preserves the YAML hidden-text assertion. Evidence: private `native-connection-observe-shape-root-integration-2026-10-03-v1`. No product/provider/auth-policy/localization behavior changed.

Q static dispatch freshness now declares the 18 formerly unrevisioned runtime dependencies and enforces owner/freshness/source-ID membership before runtime acquisition. Root reproduced acceptance of all 18 unbound owners before repair; after repair, the canonical freshness/helper/declaration cohort passes 20/20, including actual dependency-byte mutation in an isolated regular-file source tree. The generated inventory remains the sole self-revision exception. Full current graph and final documentation-bound declaration validation are being finalized before a new native run. P's divergent generator/runner remains deferred and preserved; do not infer P qualification from Q source validation. Evidence: private `native-dispatch-freshness-root-integration-2026-10-03-v1`. Native/public qualification and all remaining plan gates stay Pending/In progress.

2026-10-03 — Final static freshness composition passed: Q canonical runner/invocation/identity/schema/helper/declaration/freshness controls pass 75/75 after the contract/documentation-bound declaration was regenerated. Full Q TypeScript and scoped zero-warning lint pass. The sole unrevisioned owner is the generated inventory; all 18 previously unbound static inputs are revisioned and linked before native/backend acquisition. Current unit inventory is Q 444 (381 client, 63 server). Private acceptance: `native-dispatch-freshness-root-integration-2026-10-03-v1/CANONICAL-VALIDATION.private.json`. Native/public/cold qualification remains Pending.

A fresh owned iOS/Maestro connection execution is prepared using the repaired engine adapter and strictly requalified existing Debug build, without a requested cold binding or retry. Its private dispatch state is `ios-connection-observe-adapter-repair-public-live-2026-10-03-v1/LIVE.private.json`. Source/documentation hold begins at dispatch and continues until terminal cleanup is independently verified. Preparation does not establish a running or passing journey.

2026-10-03 — Repaired iOS connection runtime terminal: public attempt `0f10f0f321117a45e871cd51`, capture `d16c11de2f617d5ba7c18f8a`, completed its native child with exit zero and an observed capture. Public post-capture verification remains **harness-blocked**: `Native connection command log must be a non-empty owned private regular file`. Assertions are empty and passing cases remain zero; observed journey completion does not qualify the public cell. The previous selector `.map` failure did not recur. Original capture/commands/receipt remain retained; inspect the actual log predicate and producer before another attempt.

Independent terminal cleanup passed 594 PID/start pairs with no survivors or unknown process queries, no missing foreign devices, and absent owned device/cache/Docker resources. All five preexisting Docker containers remain present. All 171 frozen source paths match dispatch hashes. Source/documentation hold is released. Immutable root proof: `ios-connection-observe-adapter-repair-public-live-2026-10-03-v1/TERMINAL.private.json` and `root-independent-cleanup.private.json`. This was a Debug Maestro integration run without a requested cold reset, not a T15 cold attempt. T14–T20 and public qualification remain In progress/Pending. No product, auth-policy, provider or localization behavior changed.

Comparison planning now uses the actual exported public route matrix: 20 required cells (five families, two platforms, two engines), 20 attempts per cell, 400 actual cold attempts minimum. Eleven routes are registered and nine are absent; registration is not runtime qualification. Historical iOS Maestro training took 944.407 seconds (15.7401 minutes), implying 5.2467 hours for 20 repetitions of that historical cell only. Current helper changes require fresh qualification; other cell timing is unavailable and aggregate duration is unknown. Evidence: `native-comparison-cost-and-route-audit-2026-10-03-v1`. The read-only cold audit also identified incoming binding replacement, missing current-byte comparisons, listener/origin identity gaps and absence of an actual production cohort CLI. Those repairs are In progress; source controls do not supply any of the 400 runtime attempts.

2026-10-03 — Private runtime adapter review checkpoint: root independently validated iOS Detox verifier V3 against the full current Q graph (765 roots, 1873 source files, nine overrides, zero diagnostics) and reran all 18 focused controls. Its actual runner handoff now reaches protected producer originals and the verifier once; source control progress is accepted. Transfer/runtime qualification remains Pending while original-reader cancellation/deadline propagation, the verified immutable build path/configuration and the actual outer public terminal are repaired. Its hardcoded source-only terminal cannot complete T14. Evidence: `detox-ios-runtime-v3-root-review-2026-10-03-v1`.

Android camera V5 transfer is blocked by independent review: the actual producer stores API identity in `backend.apiProcess`, while the collector expects absent top-level PID/start fields; the real exported producer projection rejects. Full current Q composition has three missing required runtime-field diagnostics that the private candidate-only project omitted. The collector also renews the whole deadline after capture, and the canonical public terminal still does not consume its native-private result. A fresh V6 must fix these actual call paths without weakening evidence requirements. Evidence: `android-camera-runtime-v5-root-review-2026-10-03-v1`. Both packets remain source preparation with zero native/public qualification; original sealed author packets are unchanged. No product/auth/provider/localization changes follow.

2026-10-03 — Empty diagnostic-log repair is Done (source) in both roots. The controller now records successful bounded zero-diagnostic completion in its existing owned private log, including split stdout commands, while preserving exact stdout and all failure/cancellation/census/output/cleanup gates. The strict connection verifier is unchanged. Root reproduced the V1 split-locale failure (six stdout bytes, empty log) and V2 passing control (same six stdout bytes, 36-byte diagnostic record). Canonical existing/new controller controls pass 23/23 in each root; final Q command/freshness/contract controls pass 20/20, full Q TypeScript and scoped zero-warning lint/format pass. Inventories are P 438 and Q 445. Root removed two redundant test-only non-null assertions; sealed author packets are unchanged. Evidence: `native-command-empty-log-v2-root-integration-2026-10-03-v1/CANONICAL-VALIDATION.private.json`.

A fresh iOS/Maestro connection public attempt is prepared with this repair and freshly requalified immutable Debug build `dd133cabd89a894e451c0f80`. It uses the same 20-minute whole budget, no requested cold reset and no automatic retry. Dispatch state: `ios-connection-command-log-repair-public-live-2026-10-03-v1/LIVE.private.json`. Source/documentation hold begins at actual dispatch and lasts through independently verified terminal cleanup. Preparation is not a running/passing claim; T14/public/cold qualification and the full remaining plan stay Pending/In progress. No product/auth/provider/localization behavior changed.

2026-10-03 — Fresh command-log repair execution is terminal: public attempt `4ea918dbaad2a56678d2f276`, capture `0bcb5692ba12f2d1927d2255`, child exit 1, public `harness-blocked/runtime-execution-failed`, empty assertions and zero passing cases. Installation, locale read, sign-in, invitation, pending list and roster commands completed. The first actor switch tapped `tabs.account`, then failed visibility of `settings.account.screen`; the retained failure screenshot still shows the student roster. This is an unresolved runtime failure, not proof of its cause or public verification of the log repair. No post-capture verifier ran.

Root independent cleanup passed 124 PID/start pairs with no survivors or unknown queries and absent owned simulator/cache/Docker resources. The foreign simulator remains Booted and all five preexisting containers remain present. All 171 frozen source paths match; the source hold is released. Original capture and failed receipt are retained. Immutable evidence: `ios-connection-command-log-repair-public-live-2026-10-03-v1/TERMINAL.private.json` and `root-independent-cleanup.private.json`. This Debug integration run had no requested cold reset and contributes zero T15 attempts. Full-plan qualification remains In progress/Pending.

Root resource-free review of qualified Detox build reuse V1 passes the full current Q graph (762 roots, 1870 sources, six overrides, zero diagnostics). The actual exported candidate loader against build `dd133cabd89a894e451c0f80` gets beyond the prior profile-path error, then rejects the actual allocated Metro port as outside its permitted range. The candidate remains unintegrated pending allocator/provenance correction and review; fixture controls do not establish native qualification. Evidence: `detox-qualified-build-v1-root-review-2026-10-03-v1`. No product, auth-policy, provider or localization behavior changed in this checkpoint.

2026-10-03 — Root combined iOS Detox runtime V4 source review passes full Q composition (768 roots, 1876 sources, 13 overrides, zero diagnostics) and all 20 focused controls. The controls execute protected producer/verifier/staging with synthetic originals and injected terminal callbacks; they establish no native passing cell. Evidence: `detox-runtime-v4-root-review-2026-10-03-v1/REVIEW.private.json`. Integration remains pending the real Metro-port prerequisite repair and actual public-terminal/native validation.

Root iOS Detox session V2 review is blocked before transfer: its successful bound private route permanently selects `runtime-source-only`; its projected phase timings, flags and tool versions are placeholders. These are explicit incomplete implementation state, not an acceptable final T14 route. Fresh V3 must preserve actual provenance and stage original session assertion evidence into the existing single public terminal, with the original lifecycle and current-input/cleanup gates. Evidence: `ios-detox-session-v2-root-review-2026-10-03-v1/REVIEW.private.json`. The account-tab failure remains unresolved; no assertion is weakened and no product diagnosis is claimed. No product/auth/provider/localization changes occurred.

2026-10-03 — Qualified Detox build reuse is Done (source) in Q only. Six guarded source/test paths integrate V1 plus the V3 platform-specific port correction; P source remains unchanged. The actual exported Q loader now accepts build `dd133cabd89a894e451c0f80`, its original hash and Metro port 51339 after the prior profile-path and range failures. Full Q TypeScript passes and existing/new focused controls pass 32/32, including Android 51339 rejection. No native/device/backend run was performed by this validation. Evidence: `detox-qualified-build-v3-root-integration-2026-10-03-v1/TRANSFER.private.json` and `actual-loader-passing-after.private.json`. Runtime V4 integration remains pending its older positive fixture composition and source revisions; public qualification and the full plan remain In progress/Pending. No product/auth/provider/localization behavior changed.

Post-integration Q freshness controls pass 8/8 after declaration regeneration; scoped lint has zero warnings and changed-file/contract formatting passes. The regenerated Q unit inventory contains 461 source test files (398 client, 63 server); this is an inventory count, not executed or passing cases. Canonical source validation: `detox-qualified-build-v3-root-integration-2026-10-03-v1/CANONICAL-VALIDATION.private.json`.

Android Detox V2 current-Q review is sealed: 148 private content files verified, but the eight-file composition now has two type diagnostics after the qualified-build repair because its old driver omits the new build environment export. The actual public runner route also remains absent. Fresh V3 must preserve the repaired driver and complete the original evidence-to-single-terminal path; private zero-pass metadata remains correctly distinct from public qualification. Evidence: `android-detox-v2-root-review-2026-10-03-v1/REVIEW.private.json`.

2026-10-03 — Native LogBox testability wiring is Done (source) in Q only. The owned native Expo environment enables the app's existing development-only suppression switch; warnings remain captured in runner diagnostics. Eight retained evidence files confirm a warning overlay overlapped the account tab before the failed tap, while a prior same-action comparison reached Account without that overlay. Touch interception remains an inference; navigation and required assertions are unchanged. Full Q typecheck, zero-warning scoped lint, formatting and eight freshness controls pass. P source remains unchanged. Evidence: `ios-account-logbox-v1-root-integration-2026-10-03-v1/CANONICAL-VALIDATION.private.json`.

A fresh actual iOS/Maestro connection run is prepared under `ios-connection-logbox-repair-public-live-2026-10-03-v1/LIVE.private.json`, with the same 20-minute budget and no requested cold reset or automatic retry. Its existing Metro-attached Debug source/binary was requalified after the helper change; this is not a bundled-release/device qualification. Source hold begins only at actual dispatch and ends after terminal independent cleanup. Preparation supplies no runtime pass. T14–T20/full public qualification remain In progress/Pending.

2026-10-03 — BL-018 / D-218 latest iOS Maestro connection attempt is terminal: `952f47b3f6a401ccb4e93e29`, capture `324a61f4fb04b78074f61683`, child exit 2, public `harness-blocked/runtime-cleanup-failed`, no app commands or assertions and zero passing cases. Backend acquisition emitted `EISDIR` before publishing a manifest. Two untracked scratch dependency-directory symlinks are a candidate cause because the backend fingerprints untracked paths with `readFile`; this remains under source review. The LogBox repair was not exercised.

The original cleanup failure and partial-acquisition inspector rejection are retained unchanged. A separate root audit observed every recorded owned process and backend PID absent, no remaining runtime process or test Compose resource, the owned simulator absent, all six preexisting containers and the foreign Booted simulator preserved, and all 171 frozen paths unchanged. The backend start identity/run ID were never published; the empty bootstrap namespace is inferred from creation time/source ordering, not an original manifest. No PID-only termination or global cleanup was performed. The source hold is released. Evidence: `ios-connection-logbox-repair-public-live-2026-10-03-v1/ROOT-PARTIAL-CLEANUP.private.json` and `TERMINAL.private.json`. Bootstrap diagnostics and the unsupported partial-acquisition cleanup path remain In progress. This Debug integration failure contributes zero T15 cold attempts; T14–T20/full-plan qualification remain In progress/Pending. No product, auth-policy, provider or localization behavior changed.

2026-10-03 — BL-018 / D-218 scratch-isolated iOS Maestro attempt is terminal: `5a14040ecad12985dc2b8a4a`, capture `dbe854c3ef25c8e2550c9719`, child exit 2, public `harness-blocked/runtime-execution-failed`, empty assertions and zero passing cases. Backend acquisition, install, launch, locale read and entry readiness completed. The first coach-home flow completed the email tap and text command but failed the exact email-value assertion. The retained screenshot shows the empty email placeholder and no keyboard; the failure hierarchy reports the input unfocused. The account-tab step was not reached, and no cause or product defect is established.

Independent cleanup passed 55 PID/start pairs with no survivors or unknown queries and absent owned device/cache/Docker resources. All six preexisting containers and the foreign Booted simulator remain present; all 171 frozen source paths match. The source hold is released. Immutable evidence: `ios-connection-scratch-isolation-public-live-2026-10-03-v1/TERMINAL.private.json` and captured `root-independent-cleanup.private.json`. This Debug integration run requested no cold reset and contributes zero T15 attempts.

Android camera V6 remains unintegrated: full current Q composition (772 roots, 1880 sources, 14 overrides) has zero type diagnostics, and full private-graph scoped lint has zero warnings. Correctly prepared controls pass 39/44: four reject missing generator source-owner declarations and one observes a published target after cancellation. A separate controlled regression also fails before the fix: an original positive native finalization succeeds, a staged sidecar receives a newline, and finalization still permits promotion instead of rejecting changed bytes. Evidence: `android-camera-runtime-v6-root-review-2026-10-03-v1/REVIEW.private.json` and `android-camera-v6-late-stage-root-reproduction-2026-10-03-v1/REPRODUCTION.private.json`. These are protected synthetic controls, not native passing cells. Fresh camera V7 and full iOS Detox save/retry terminal/provenance wiring remain In progress; a permanently source-only success route cannot fulfill T14. T14–T20/full-plan qualification remain In progress/Pending. No product, auth-policy, backend-provider or localization behavior changed; product requirement/copy artifacts need no update for this checkpoint.

2026-10-03 — Repository fingerprint preflight is Done (source) in the isolated Q sibling server only. The three guarded server source/test paths reject non-regular untracked entries explicitly and validate both repository fingerprints before creating the runtime namespace. Regular-file fingerprint parity is preserved. Root full candidate composition passes (133 roots, 1093 sources, three overrides, zero diagnostics); canonical relevant tests pass 13/13 with 52 expectations, full server TypeScript and four-file formatting pass. A private complete source/dependency fixture invokes the actual exported runtime and proves directory-symlink rejection with no namespace creation or backend acquisition. Evidence: `server-fingerprint-preflight-v1-root-review-2026-10-03-v1/TRANSFER.private.json` and `CANONICAL-VALIDATION.private.json`. The primary server source is unchanged. Server ESLint is not configured, so no lint pass is claimed.

The proposed client partial-acquisition startup identity protocol remains Pending: a missing acquired manifest or matching closed receipt is still unknown/recovery-retained. This source repair is not a native or backend runtime qualification. Current Q unit inventory is 447 files (383 client, 64 server), with inventory check passing. The prior 461 included 15 private scratch test copies inside the checkout; scratch relocation removes those rows and the new server regression adds one. No production regression test was deleted. Counts are source inventory, not passing cases. Full T14–T20 qualification remains In progress/Pending; product/auth/provider/localization behavior is unchanged.

### 2026-10-03 — T14-B training adapter V4 independent review

Root verified all seven frozen candidate hashes and current worktree preimages. The full current client TypeScript graph passes with 762 roots, 1,870 source files, seven overrides and zero diagnostics. No candidate source was transferred. The actual terminal route remains permanently source-only: the adapter returns zero native passing cases and disables public promotion, and the runner forces `harness-blocked` / `runtime-source-only`. T14-B remains Pending; a fresh V5 must connect verified original training evidence to the actual public terminal route and original flag/tool-version provenance. The private root review is `t14-training-v4-root-review-2026-10-03-v1` (freeze SHA-256 `10d937a43698c5639f73b46e0b9c3ee99519ad7ab51cd235e94b57f8f8331edd`). No native resources or public passing receipts were produced by this review. Product behavior and localization are unchanged.

### 2026-10-03 — Credential diagnostic invalidated by source mutation

Owned diagnostic `0a8e727c955fc2b15fdc06da` completed the exact same-field email assertion with child exit zero, and the after-tap frame shows a caret and keyboard. The original capture correctly returned `harness-blocked` because helper inputs changed after the final frame; it contributes zero native passing cases and zero T15 cold attempts. Independent cleanup passed 109 PID/start pairs with no survivors, unknown queries, missing foreign devices, owned simulator/cache or test Docker resources. Root restored all 171 frozen source hashes while preserving unreviewed bytes. Evidence: `ios-credential-diagnostic-current-source-live-2026-10-03-v2/TERMINAL.private.json` and `ROOT-CLEANUP.private.json`.

The training agent identified the mutation: copying its prior overlay with `cp -R` preserved a source symlink, and applying the V5 patch to that private-looking path modified canonical `native-training-public-evidence.ts` during the explicit source hold. V5 preparation must restart with regular source copies and checks of every source ancestor before mutation. The original invalidated capture and prior candidate remain retained. Earlier missing-screen and Android-baseline mutation provenance remain under investigation. Product behavior, auth policy, backend provider and localization are unchanged; no product requirement or copy update is needed. T14–T20 and full-plan qualification remain In progress/Pending.

### 2026-10-03 — Camera late-staged-byte regression detects the V7 fix

Root created a separate regular-file snapshot of the in-progress camera V7 candidate and regenerated the native declaration (23 views, 40 transitions, ten scenarios; no runtime passes). The original V6 failing-before attack now rejects a newline added to staged original sidecar bytes. The initial combined test then failed because that first attack remained in the fixture while the subsequent independent manifest attack expected a different rejection. Root preserved the initial log and original control; the adapted private control restores the first attack bytes only after its rejection assertion, before running the distinct manifest attack. Both rejection assertions are unchanged. The resulting two protected synthetic controls pass. Evidence: `android-camera-v7-draft-root-regression-2026-10-03-v1/REVIEW.private.json` and `independent-attacks-after.private.log`, freeze SHA-256 `cb0a5aa867c0558e38a0bd03e77504e84d53bb1b4f6076dccd36124022ea786f`. This is controlled before/after proof in a private snapshot, not canonical integration or native qualification. Full closure, deadline/abort, current-worktree composition and real target evidence remain Pending. Product behavior and localization are unchanged.

### 2026-10-03 — Camera V7 full-worktree composition and controls

Root's immutable V7 draft snapshot passes the full current-worktree TypeScript graph (772 roots, 1,880 sources, 15 overrides, zero diagnostics) and all 46 focused camera controls, including cancellation, protected staging, ancestor replacement and original receipt graph verification. The separately recorded late-staged-byte regression remains passing. Evidence: `android-camera-v7-draft-full-graph-root-review-2026-10-03-v1`, freeze SHA-256 `4e8cd430fa0562b00d983044608862174051e2db21e6020f0bb458f23e8fd516`. The Android Maestro version literal is backed by an actual bounded pre-acquisition `--version` check that rejects versions other than 2.6.1; the APK environment hash is checked against resolved configuration. Original metadata bindings remain part of integration/native review. Final author transfer guards and style checks are pending; no canonical camera source transfer or native passing receipt is claimed. Product behavior and localization remain unchanged.

### 2026-10-03 — iOS Detox session V4 canonical-path review

Root verified the four frozen source/test files and two exact worktree patch preimages, applied patches only to private copies, and performed the packet-required sibling-import normalization. The resulting actual runner/baseline composition fails the full current-worktree compiler check with nine diagnostics (765 roots, 1,873 sources, six overrides): adapter value inference, nullable build fingerprint, and readonly nested assertions/bindings at existing mutable runner boundaries. The initial unnormalized import diagnostics are retained separately. Evidence: `ios-detox-session-v4-root-review-2026-10-03-v1/REVIEW.private.json`, freeze SHA-256 `04b2c375ad0e1eec1854ec60b81c23534bfb293e744e014660e393c315730a6c`. The V4 flag hash also uses a whole build fingerprint rather than the original environment/profile identity used by Maestro and the sealed cohort. Fresh V5 corrections are assigned. No canonical session transfer or native pass is claimed; T14-A remains Pending. Product behavior and localization are unchanged.

### 2026-10-03 — Camera V7 guarded source integration in progress

Root prepared the final 16-file camera packet in regular private copies, preserved every existing worktree preimage, normalized formatting and two import-order warnings to repository conventions, and regenerated the declaration. The final source composition passes the full current-worktree TypeScript check with zero diagnostics. The source adds declared runtime helper ownership, one caller-owned absolute deadline, bounded cancellation before publication, and final rereads of staged original bytes, current source/helper identity and original cleanup evidence. Application and canonical validation are In progress; no new native passing receipt is claimed. Original author bytes and initial style/project-service failures remain preserved in `android-camera-v7-final-root-integration-2026-10-03-v1`. Product behavior, auth policy, backend provider and localization are unchanged; product requirement and copy artifacts need no update for this harness-only change. T14-D runtime qualification and T15–T20 remain Pending/In progress.

### 2026-10-03 — Camera V7 canonical static validation

The sixteen-path camera V7 source transfer is applied in Q only. Canonical full TypeScript, changed-file ESLint and Prettier, and native inventory validation pass. The regenerated unit inventory contains 454 files (390 client, 64 server). Canonical runtime control execution is still running; source integration remains In progress until its result is reviewed. The private combined control run passed 47/48: the additional older root regression omitted the newly required repositoryRoot finalizer input. That original failure is retained and its fixture correction is under independent review; neither a fixture repair nor static checks establish native qualification. Evidence: android-camera-v7-final-root-integration-2026-10-03-v1/CANONICAL-STATIC-VALIDATION.private.json. Actual native/public qualification, T14-D and T15–T20 remain Pending/In progress. Product behavior, auth policy, providers and localization are unchanged.

### 2026-10-03 — Camera V7 canonical controls passed

All sixteen transferred camera V7 source/test hashes remain equal to their guarded transfer records. The actual canonical Q camera suites pass 46/46 with zero failures, cancellations or skips; full TypeScript, changed-file lint/formatting, native inventory validation and the 451-file unit inventory check pass. Evidence: android-camera-v7-final-root-integration-2026-10-03-v1/CANONICAL-CONTROLS.private.json. The older supplemental root regression remains separately pending its required repositoryRoot input correction; its original 47/48 combined failure is preserved. These checks establish source validation only. No native attempt was executed here, and T14-D native acceptance and T15–T20 remain Pending/In progress. Product behavior, auth policy, providers and localization are unchanged.

### 2026-10-03 — Camera V7 source integration complete; session V5 pending

Camera V7 source validation is Done in Q only: sixteen transfer hashes remain unchanged, canonical controls pass 46/46, and the repaired supplemental root regression passes 2/2 against the integrated source. The supplemental full canonical-path graph contains 773 roots and 1881 sources with zero diagnostics; the two assertions independently reject original staged-byte mutation and finalizer-manifest tampering. The older missing-repositoryRoot failure is retained. Evidence: android-camera-v7-final-root-integration-2026-10-03-v1/SOURCE-INTEGRATION-RESULT.private.json and android-camera-v7-late-stage-repair-root-review-2026-10-03-v1. No native qualification is established.

Session V5 remains Pending integration: composing its eight candidate/patch paths with actual Q produces twelve type diagnostics, including readonly arrays crossing mutable staging/verification contracts and existing lifecycle fixtures missing newly required tool metadata. Its default patch dry-run also allowed fuzz where the runner patch omitted the current camera deadline line; root retained the rejection and preserved that deadline in a private semantic composition. A fresh V6 correction is assigned. Evidence: ios-detox-session-v5-root-review-2026-10-03-v1. No canonical session source change was applied. Actual native acceptance, the full T15 comparison and T16–T20 remain Pending/In progress; product behavior, auth policy, providers and localization are unchanged.

### 2026-10-03 — Credential V3 launch deadline and clean terminal

Fresh owned diagnostic capture 3136240db717a62e5f63ae90 reused the original qualified Debug build after the actual current-source loader accepted it. Source isolation was independently checked before dispatch, and all 183 frozen file hashes remained unchanged through terminal cleanup. The owned simctl app-launch command reached its 30000 ms deadline before credential UI observation; no view was captured and no native passing case or T15 cold attempt is claimed. The original command/ownership/Expo records remain retained. Device state was Booted and available, but the cause of the launch stall is not established.

Independent cleanup passed for 18 PID/start pairs with no survivors, unknown queries, missing foreign devices, owned simulator/cache or test Docker resources. The canonical source hold is released. Evidence: ios-credential-diagnostic-current-source-live-2026-10-03-v3/TERMINAL.private.json and ROOT-CLEANUP.private.json. A bounded launch investigation is assigned; no product fix, increased timeout, assertion change or automatic retry has been applied. Native qualification and the full plan remain In progress/Pending.

### 2026-10-03 current-source public iOS/Maestro training qualification

T14-B iOS/Maestro integration is **Done for this recorded Debug snapshot**. Public attempt `6a42cdbf40621bc87a29b7f0`, original capture `41722f4c2052b378414a1f0b`, completed with exit 0 and a public `passed` receipt containing all seven canonical training assertions. The actual UI created and saved a `3x8` plan, edited and saved `4x10`, then relaunched and reopened the durable values; independent API/SQL evidence and unrelated-state checks passed. The receipt binds client `9d0c3f4862e6c8b8004fd3378f9d6897ae46493e` and server `c7b5191352109f9ce2829b2b8fafcc8f554cf8a7`, both with recorded dirty fingerprints, actual Maestro 2.6.1/Node v24.15.0, and the owned target. This is Metro-attached Debug evidence, not bundled-release or hosted qualification.

Independent cleanup passed over 516 original PID/start pairs: no survivors, unknown process queries or missing foreign devices; owned simulator/cache and Docker resources were absent. All 183 frozen source hashes remained unchanged, and the source hold was released only after terminal and cleanup verification. Root evidence: `ios-training-current-source-public-live-2026-10-03-v1/TERMINAL.private.json` and `ROOT-CLEANUP.private.json`; original public receipt remains in the qualified worktree's `native-pilot-attempts/6a42cdbf40621bc87a29b7f0/receipt.json`. This adds one actual native passing case and zero T15 cold attempts. The earlier launch-deadline diagnostic remains unchanged; this success does not establish its cause.

Full T14 equivalence, 400 T15 cold attempts, T16 exploration, T18 hosted wiring/adoption evidence, T19 retirement and T20 reconciliation remain **Pending**. Runtime V7, Android V5 and Session V6 composition is **In progress**; Session V6 root full-graph validation passed with zero diagnostics, but combined integration/native qualification remains Pending. Training V5, SaveRetry V2 and Cold V3 were rejected for integration on concrete ownership/metadata/deadline or runtime/reset wiring gaps; repaired private revisions are **In progress**, with client/server maintainer ownership and independent review as the next action. The client partial-startup identity candidate also requires rebasing onto qualified source and full-graph validation before integration. No auth-policy, product requirement, provider or localized-copy behavior changed; those artifacts need no update for this QA evidence checkpoint.

### 2026-10-03 current-source public iOS/Maestro session attempt

T14-A remains **Pending**. Public attempt `d3578c617c2f5eb89ae17619`, capture `e63856dd5b8037c207b5d91d`, ended with exit 2 and `harness-blocked` at `signout-confirm`; the public receipt contains no passing assertions. Login and restored fixture identity were observed, but those intermediate steps do not qualify the complete session contract. Independent cleanup passed over 163 PID/start pairs, with no survivors, unknown queries or missing foreign devices, and owned simulator/cache/Docker absence. All 183 frozen source hashes matched; the source hold was released only after terminal and independent cleanup verification. Root evidence: `ios-session-current-source-public-live-2026-10-03-v1/TERMINAL.private.json` and `ROOT-CLEANUP.private.json`; original receipts and screenshots remain private and unchanged.

The failed command reports the sign-out tap completed, then confirmation visibility failed. Its screenshot shows the sign-out button and legal/privacy content with no confirmation card. A below-fold-only cause is therefore unproven; the prepared scroll-only candidate is **not ready for integration**. Client/server maintainer diagnosis must inspect original command/hierarchy and an isolated post-tap observation before selecting a repair or fresh attempt. This run adds zero native passing cases and zero cold attempts. The previously qualified iOS/Maestro training snapshot remains a separate receipt. No auth-policy, provider, user-facing copy or product behavior changed; product and localization artifacts need no update for this QA checkpoint.

### 2026-10-03 partial backend startup identity protocol source integration

T10 partial backend startup identity is **Done (source)** in the qualified worktree; actual recovery qualification remains **Pending**, owned by the client/server maintainer. The reviewed seven-file transfer distinguishes a pre-spawn rejected start from a spawned child, preserves observed PID/start/script identity through acquisition failure and capture, validates the three original acquisition intents, and records an unavailable process census as unknown recovery. A spawned child without a matching close receipt still cannot produce a cleaned result. Existing zero-acquisition and normal cleanup paths remain covered.

Canonical validation passed: full TypeScript, zero-warning repository lint, 26/26 focused controls with no skips, declaration generation and native-inventory validation, and unit-inventory regeneration/check. The qualified inventory contains **452 files (388 client, 64 server)**. The declaration retains 23 source views, 40 transitions and ten scenarios without synthesizing runtime receipts. Evidence: `partial-startup-v3-recovered-root-review-2026-10-03-v1/CANONICAL-RESULT.private.json`; original author and root lint failures remain retained. This integration creates zero native passing cases and zero cold attempts. Earlier native receipts remain immutable and scoped to their original helper fingerprints; fresh qualification is required for this source revision.

A separate Git metadata incident was recovered without working-tree writes: a shared `core.worktree` setting redirected repository reads to a private overlay, and a synthetic fixture commit affected the qualified detached HEAD/index. Root retained the altered metadata, restored both checkout identities, verified the primary staged entries and preserved user changes, and checked all 183 frozen source hashes. The creating process remains unattributed; no source-file deletion was observed. Private test batches now clear inherited Git metadata variables and check canonical identity before and after execution. Evidence: `shared-git-fixture-metadata-incident-2026-10-03-v1/RECOVERY.private.json`.

No product behavior, auth policy, provider baseline or user-facing copy changed; FR/UC/AC/BR, screen and localization artifacts need no update. Combined runner wiring, native equivalence, cold comparison, exploration, protected hosted evidence and full-plan completion remain **Pending**.

### 2026-10-03 independent Training V6 and protected manual workflow review

BL-018 / D-218 remains **In progress**. Training V6 passes the independent current-qualified-worktree full TypeScript graph (778 roots, 1886 source files, 12 overrides, zero diagnostics) and strict full-context ESLint (zero warnings). Its private source controls pass five of six tests after using the candidate generated inventory: public selection rejects the omitted `partial-backend-boundary.ts` producer ownership entry. The client maintainer is repairing declaration closure against the current startup helper ledger; no V6 transfer or native promotion has occurred. Evidence: `t14-training-v6-independent-root-review-2026-10-03-v1/REVIEW.private.json`.

T18 remains **Pending**. Independent review of the private protected manual workflow found that the server checkout escapes the Actions workspace; checkout must use sibling `client/` and `server/` directories within the workspace and execute from `client/`. Its receipt reader also needs descriptor-backed bounded identity checks, and the required qualified Debug build must be made available after clean exact-source checkout through a supported producer or private restoration path. Supplying a historical build run ID alone does not establish availability. The CI maintainer owns these repairs. Evidence: `t18-independent-root-review-2026-10-03-v1/REVIEW.private.json` and `BUILD-AVAILABILITY.private.json`. No workflow was installed or dispatched.

The session helper differential remains diagnostic evidence. The sealed initial report reversed the direction of the LogBox change: the retained failed-run helper adds native suppression compared with the prior helper. The corrected immutable V2 report confirms all three added helper blocks belong to the failed-run revision; it is sealed at `/private/tmp/ios-signout-helper-diff-e63856dd5b8037c207b5d91d-d16c11de2f617d5ba7c18f8a-20261003-v2` (manifest `262c5a42981095566ca8b53ba4f371081d8c5bfbd069bb98c3610e084791cc9b`). Neither capture contains an explicit observation of the effective flag; source configuration alone does not establish Metro bundle behavior or the sign-out failure cause. Evidence: `ios-signout-helper-direction-root-review-2026-10-03-v1/REVIEW.private.json`. No product fix or automatic retry follows from this comparison.

These reviews add zero native passing cases, zero cold attempts and zero hosted runs. Full T14–T20 acceptance remains Pending. Product requirements, auth policy, provider baseline and localized copy are unchanged; FR/UC/AC/BR, screens and locale artifacts need no update for this internal QA review checkpoint.

### 2026-10-03 synthetic session declaration fixture repair

The qualified source-only session dependency fixture now declares the current authoritative helper ownership and source hashes, including a parseable synthetic helper ledger. Six canonical controls previously failed before reaching their intended validation because the fixture omitted owner paths. The private repaired suite passes 10/10; full current-worktree TypeScript and strict zero-warning lint pass. Canonical rerun passes 10/10 with no skips. Production validation is unchanged, and synthetic evidence cannot qualify a native pass. Evidence: `session-synthetic-owner-declaration-root-repair-2026-10-03-v1/TRANSFER.private.json`. Full BL-018 acceptance remains Pending. This test-only repair changes no product contract, provider, auth policy or localized copy; product documentation needs no update.

### 2026-10-03 public iOS/Maestro connection attempt

T14-C remains **Pending**. Public attempt `c4f744b4043b7c50215c0413`, capture `3b4da098b2a0097545f9c680`, ended with child exit 2 and a `harness-blocked` public receipt containing zero passing assertions. Entry readiness, coach login and the coach-pending phase ran; the first coach-to-student switch reported the Account-tab tap completed, then failed visibility of `settings.account.screen`. The retained screenshot remains on the coach's students view. Sign-out was not reached, so this attempt does not reproduce the earlier confirmation failure or establish its cause. The tap had `retryIfNoChange:false`; no fallback or retry was added.

Independent cleanup passed over 137 PID/start pairs with no survivors, unknown queries or missing foreign devices. Owned simulator/cache and Docker resources were absent. All 184 frozen source hashes matched at terminal, and the source hold was released after independent cleanup. Evidence: `ios-connection-current-source-public-live-2026-10-03-v1/TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. Original command, screenshot and public receipts remain private and unchanged. This adds zero native passing cases and zero cold attempts. The client maintainer must diagnose actual tab-event delivery before selecting a repair; command completion is not navigation-handler proof.

No product behavior, auth/provider policy or localized copy changed; product artifacts need no update for this QA evidence checkpoint. Full native equivalence, cold comparison, agentic exploration, hosted adoption and full-plan completion remain Pending.

### 2026-10-03 current cold-reset closure review

T15 remains **Pending**. Root verified the private V5 source hashes against the current qualified worktree and ran the full current project TypeScript graph with all 15 candidate overrides: 775 roots, 1883 source files, zero diagnostics. The broader six-suite cold-reset control cohort passes **44/44**, with zero failures, skips or cancellations, against the actual qualified worktree. Its earlier private snapshot result of 37/44 remains retained; the current result establishes that those seven failures do not reproduce with the current canonical closure. No repair or retry was needed for this current control run.

Evidence: `cold-v5-current-graph-root-review-2026-10-03-v1/REVIEW.private.json`, `full-graph.log` and `current-cold-controls.log`. No source transfer, native resource acquisition or cold attempt occurred. The 400 actual cold attempts, native equivalence and hosted evidence remain Pending. This internal QA validation changes no product behavior, auth/provider contract or localized copy; product artifacts need no update.

### 2026-10-03 combined runner source review

Root verified all 37 sealed combined V3 candidate hashes and current qualified-worktree preimages. The independent full project TypeScript graph passes with 796 roots, 1904 source files, 30 overrides and zero diagnostics. The nine changed test suites pass 52/52 controls with no failures, skips or cancellations. Evidence: `combined-v3-current-graph-root-review-2026-10-03-v1/REVIEW.private.json`. Independent semantic review remains pending; no source transfer or native acquisition occurred.

The connection runner still unconditionally returns source-only even when producer-owned runtime facts exist. A subsequent wiring packet must consume, stage and independently verify those original runtime facts before any public native pass. The composer owns this gap; no comparison or adoption gate is closed by this source checkpoint. Product behavior, auth/provider contracts and localized copy remain unchanged; product documentation needs no update.

### 2026-10-03 Training V7 broader IPC review and private repair

Independent full-project review found five existing IPC fixtures omitted from the V7 transfer still using the retired relative deadline argument. Updating these private fixtures to the caller-owned absolute deadline clears all five TypeScript diagnostics (778 roots, 1886 source files, 17 overrides). The broader existing IPC contract suite then exposed a cancellation receipt-drain failure: 14/15 passed; the aborted parent signal prevented reading the child's cancelled response.

A private root repair permits only descriptor-bound response evidence reads after cancellation under the same original deadline, and handles cancellation observed during that read. Completed and foreign-child response rejection remains enforced. The existing IPC suite now passes 15/15, strict project lint passes with zero warnings, and actual project formatting passes. Evidence: `training-v7-current-graph-root-review-2026-10-03-v1/REVIEW.private.json`; both failing-before logs remain retained. The final full project graph with both root repairs passes (778 roots, 1886 sources, 17 overrides, zero diagnostics); independent semantic review remains pending. No canonical source transfer or native attempt occurred. The training maintainer owns fresh composition and declaration updates. Product/auth/provider/localization behavior is unchanged; product artifacts need no update for this private QA repair checkpoint.

### 2026-10-03 protected manual native workflow source integration

Root integrated the sealed T18 V4 source candidate into the qualified worktree after checking all source preimages and final candidate hashes. The manual protected iOS/Maestro training workflow checks out exact client/server revisions within the Actions workspace and uses an explicit runner-provisioned private build cache. The production loader validates original cache receipts and copied build/config/bootstrap/entry bytes, preserves the original receipts, and returns the validated destination build path. All direct loader callers and iOS adapters forward the explicit source root; helper ownership tracks those callers.

Before transfer, the final actual project graph passed (777 roots, 1885 source files, 17 overrides, zero diagnostics), all 12 loader/workflow controls passed, and strict project lint and formatting passed. Canonical post-transfer validation is complete: all 12 loader/workflow controls pass, full project TypeScript passes, strict project lint has zero warnings, formatting passes, and both native and unit inventories validate. The broader shared closure check initially passed 19/21: Android omitted three shared iOS ledger paths (partial startup boundary, public Detox dispatcher and outer runner). Adding those exact freshness inputs preserves the runtime path and makes the existing closure/dependency suite pass 21/21; the failing-before log is retained. Evidence: `t18-v4-final-root-integration-2026-10-03-v1/TRANSFER.private.json`. No hosted job or native run was dispatched. T18 remains **Pending** for protected runner cache availability, current native qualification and exact-head hosted evidence; T19 retirement remains Pending. This changes internal QA tooling only, with no product, auth/provider or localized-copy change; product documentation needs no update.

### 2026-10-03 public iOS/Maestro camera execution in progress

Root dispatched one actual `SCN-camera-denied-ios` integrated public attempt `4ec7ad29687c4e52febb9124`, capture `ab30ddf9ad2c26cf75f12bc1`, after source selection and qualified Debug-build reuse preflight passed. The run owns its simulator/backend through the existing public runner and has a 20-minute whole-run deadline. All 184 governing source hashes are held through actual terminal and independent cleanup. Evidence: `ios-camera-current-source-public-live-2026-10-03-v1/EXEC-HANDLE.private.json` and `LIVE.private.json` (exec session 90489).

Execution is **In progress**; permission denial, manual-code fallback, API/SQL assertions, terminal classification and cleanup are not yet proven. This adds zero passing native cases and zero cold attempts until terminal evidence is verified. No retry or fallback action was introduced. This QA execution changes no product behavior, auth/provider contract or localized copy; product artifacts need no update.

### 2026-10-03 camera attempt terminal and source hold released

Public iOS/Maestro camera attempt `4ec7ad29687c4e52febb9124` (capture `ab30ddf9ad2c26cf75f12bc1`) ended with exit 2, `harness-blocked`, before the camera callback: `Camera frame source identity is unavailable`. No camera permission/fallback qualification or passing native case is claimed. Independent cleanup passed for 68 PID/start pairs, with no survivors or unknown queries; owned simulator and cache were absent. All 184 frozen source hashes matched before release of the source hold. Cold attempts and automatic retries remain zero. The authenticated camera provenance/prelude separation requires a private repair and fresh qualification. Evidence: `.qa/artifacts/testing-modernization/ios-camera-current-source-public-live-2026-10-03-v1/TERMINAL.private.json`.

### 2026-10-03 combined V4 and diagnostic V4 independent review

The combined runner V4 passes the independent current-project TypeScript graph (799 roots, 1907 source files, 38 overrides, zero diagnostics) and 45 source-only session/connection controls. No source transfer or native qualification occurred. The canonical outer runtime wiring still needs the saved terminal receipt bytes to be independently read and bound; the composer owns that repair. Evidence: `combined-v4-current-graph-root-review-2026-10-03-v1/REVIEW.private.json`.

Diagnostic V4 preserves absent-confirmation observations before the unchanged 90-second assertion. Its independent current-project graph passes (779 roots, 1887 sources, ten overrides). A complete private source/Git context exposes nine existing publication fixture failures (43/52 controls pass): seven finalization fixtures omit the required diagnostic object, and two staging fixtures omit its three evidence paths. V5 must repair those fixtures without relaxing production validation. Earlier root context preparation failures remain retained and are distinguished from these nine actual fixture failures. Evidence: `session-diagnostic-v4-current-root-review-2026-10-03-v1/REVIEW.private.json`.

A qualified-worktree training screen disappeared after the camera source-hold verification. Root exclusively recreated the absent file from identical verified primary bytes (`97d57463e93c0e344d97b20ed94f3f81058bc3664cacfb40a5564bf9651f0a93`), preserving the incident evidence. The creating process remains unattributed; primary source, both HEADs and common Git config remain unchanged. Evidence: `qualified-training-source-disappearance-2026-10-03-v1/RECOVERY.private.json`. Full BL-018 acceptance, native equivalence, cold comparison, exploration and hosted adoption remain Pending. This QA checkpoint changes no product/auth/provider/localization contract.

### 2026-10-03 camera provenance V2 source integration

Root integrated two reviewed source/test paths in the qualified worktree. Generic login and account-switch observations no longer request authenticated camera provenance before a verified sign-in boundary. Capture-only camera observations remain generic; integrated camera observations still require the verified current actor/auth request and original frame bytes. The actual prior `password-save-prompt` failure is retained under attempt `4ec7ad29687c4e52febb9124` / capture `ab30ddf9ad2c26cf75f12bc1`. This repair does not establish permission/fallback qualification.

Canonical validation passes 14/14 focused controls, full TypeScript, zero-warning lint, formatting, declaration generation and both inventory checks. The unit inventory contains 455 files (391 client, 64 server); native declaration remains 23 views, 40 transitions and ten scenarios with no generated runtime passes. Evidence: `ios-camera-provenance-v2-root-integration-2026-10-03-v1/CANONICAL-RESULT.private.json`. Fresh native qualification is the next action, owned by the client/server maintainer. No product behavior, auth policy, provider baseline or localized copy changed; product artifacts need no update. Native/cold/hosted counts are unchanged, and full-plan completion remains Pending.

### 2026-10-03 repaired-camera fresh attempt terminal

Fresh public iOS/Maestro camera attempt `7ef23a63e46fd52748571677`, capture `c7d1c3810f6e27bd8babcc7c`, ended with outer exit 2, original Maestro child exit 1 and `harness-blocked`. All three sign-in readiness assertions passed. During the `password-save-prompt` login prelude, email tap and input reported completion, then the exact fixture-email visibility assertion failed; the screenshot retains the original email placeholder. No completed sign-in, authenticated camera frame or camera callback was observed, so native validation of the provenance repair remains Pending. This failure does not establish its cause; no selector weakening, coordinate fallback, product change or automatic retry follows.

Independent cleanup passed over 50 PID/start pairs: no survivors, unknown queries, missing foreign devices or remaining owned simulator/cache/Docker resources. All 185 frozen source hashes matched before release of the hold. Evidence: `ios-camera-provenance-v2-public-live-2026-10-03-v1/TERMINAL.private.json`, `READINESS-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. Native passing cases and cold attempts are unchanged; full T14–T20 acceptance remains Pending. The client/server maintainer must investigate actual native input delivery against the retained target, hierarchy and command evidence. This QA checkpoint changes no product/auth/provider/localization contract.

### Detox iOS Metro contract integration (2026-10-03)

Root integrated the reviewed Metro configuration repair in Q: explicitly iOS-marked qualified connection/baseline callers accept owned Metro ports through 65535; Android and unmarked shared callers retain the 49151 ceiling. The explicit `DETOX_IOS_METRO_PORT` override affects iOS launch/build only. Canonical review retained the original URL type error and four lint warnings, then repaired the Node URL import and explicit test-promise handling. Full Q TypeScript, strict zero-warning changed-file lint and formatting pass. The original focused controls passed 13/13; repaired controls are recorded in `detox-metro-contract-root-integration-2026-10-03-v1`. This is source integration, not native or hosted qualification. T14–T20 remain incomplete; actual cold attempts remain zero. No product behavior, auth policy, provider or localization contract changed, so product documentation needs no update.

### Protected hosted readiness observation (2026-10-03)

Read-only GitHub observation found the matching macOS ARM64/iOS runner online and idle, and the Linux Android runner online and idle. The protected manual Maestro workflow is absent from GitHub's registered workflow list; its local source has not been published. Runner availability therefore does not establish build-cache provisioning, exact-head execution or hosted adoption. No workflow dispatch, commit, push or runner mutation was performed. Evidence: `t18-hosted-readiness-observation-2026-10-03-v1/OBSERVATION.private.json`. T18 hosted evidence and T19's three protected successes across two app revisions remain Pending.

### Combined runtime V5 canonical source integration (2026-10-03)

Root verified all 33 exact current-Q preimages and integrated the bounded connection/runtime/session route composition. Independent full current-Q overlay TypeScript passes (801 roots, 1909 sources, 32 overrides, zero diagnostics); independent and post-transfer runtime controls each pass 17/17. Actual canonical full TypeScript and native declaration validation pass. Protected terminal bytes are reread and compared with the publisher object under the original lifecycle; cancellation fences precede source-only, verified-private and publication returns. Current camera provenance, shared readers and Metro repair remain preserved. The author's 117/118 aggregate cancellation-envelope timing failure remains retained, with a separate 15/15 isolated result; it is not a full aggregate pass. Canonical strict lint passes with zero warnings and formatting passes. The refreshed unit inventory contains 464 files (400 client, 64 server). Source integration does not qualify native, cold, exploration or hosted behavior. Evidence: `combined-v5-current-graph-root-review-2026-10-03-v1`. Training V9 and operational runtime producer review must rebase their narrow deltas on this source. T14–T20 remain incomplete; no product/auth/provider/localization behavior changed.

### Session post-tap diagnostic canonical integration (2026-10-03)

Root applied twelve narrow diagnostic source/test patches to current Q, preserving camera provenance, Metro configuration and combined runtime V5. After refreshing a complete private source context with actual isolated Git identity and current iOS source inputs, all 52 session controls pass, including seven real-path finalization fixtures. Canonical post-transfer controls also pass 52/52 and full TypeScript passes. Root preparation's `.git` file/directory copy error and the prematurely executed old-context failures remain retained; the corrected complete-context result supersedes those setup outcomes without deleting them. The diagnostic records bounded flow, structured hierarchy and PNG evidence after the unchanged sign-out scroll/tap, including absent confirmation selectors, before running the unchanged authoritative confirmation assertion. It adds no retry or passing claim. Helper/declaration closure includes the new producer. Evidence: `session-diagnostic-v5-current-root-review-2026-10-03-v1/TRANSFER.private.json`. Fresh native diagnosis and T14–T20 remain Pending; product/auth/provider/localization contracts are unchanged.

Canonical diagnostic validation retained 18 warnings in the new test mocks, then replaced unawaited test declarations and await-free async mocks with explicit promise contracts. The repaired diagnostic controls pass 8/8, full TypeScript passes, and strict source lint has zero warnings. The refreshed unit inventory contains 465 files (401 client, 64 server); this count is not an execution result. No native run occurred during this integration.

### Bounded session checkpoint terminal (2026-10-03)

Fresh iOS/Maestro session attempt `43898ed303e91d90880756a9`, capture `ec81c00a75b97809163cfef8`, is terminal with original exit 2 and public `harness-blocked/runtime-execution-failed`. Reuse of the older build was rejected after the Metro configuration changed source identity; no stale-build bypass was used. The new Xcode log reports BUILD SUCCEEDED, but a bounded owned process-census query timed out at 5000 ms, so the harness rejected the command before install or app interaction. No requested assertion executed, no binary qualification was published, and the tap/input and post-tap diagnostics were not exercised. This is a host/harness dependency block, not a proven app regression.

Independent cleanup passed 15 PID/start pairs, with no survivors, unknown queries, missing foreign devices, owned simulator/cache, or owned Docker resources. All 196 held source hashes matched before release. Original outcomes and diagnostics are retained in `ios-session-post-tap-diagnostic-public-live-2026-10-03-v1/TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. The representative-journey checkpoint remains incomplete. No retry is queued; another attempt requires diagnosed repair or changed conditions. Broader tooling, rebase/composition and fixture expansion are deferred, recoverable private work is preserved, and the 400-attempt comparison remains gated. The native logout decision remains Pending per handoff Section 10; the owner was asked whether to preserve documented local clearing or separately authorize server bearer revocation. No auth behavior or acceptance criterion was changed.

### Camera input diagnostic source checkpoint (2026-10-03)

BL-018 / D-218 remains **In progress**. Root integrated the independently reviewed V6 diagnostic into the qualified worktree only, with all thirteen source preimages and final hashes guarded. The public `--credential-interaction-diagnostic` flag is restricted to iOS/Maestro/`SCN-camera-denied-ios`/integration. The diagnostic retains the student fixture/home/auth boundary, explicitly disables the email tap retry, preserves the exact email assertion and all four camera assertion IDs, and binds the original monotonic deadline and cancellation to capture. Capture and public output retain distinct owned namespaces; directory/ID/deadline bindings are reread before cleanup-gated staging.

The consolidated five-contract readiness gate passes, including the actual adapter orchestration with resource-free injected dependencies and positive, tampered-binding, tampered-deadline, missing-binding and cancellation outcomes. Canonical controls pass 76/76 focused, 8/8 dispatch and 14/14 closure/cleanup; full TypeScript, strict lint with zero warnings and formatting pass. The current-project overlay graph has 803 roots, 1902 source files, thirteen overrides and zero diagnostics. These are source controls, not native passing cases. Evidence: `camera-input-v6-root-integration-2026-10-03-v1/TRANSFER.private.json`; its root addendum corrects the review metadata's truncated manifest hash while preserving the immutable original review and all thirteen independently matched source hashes.

Diagnostic source wiring is **Done**; actual camera execution and UI/API/SQL/independent-cleanup qualification remain **Pending**. A fresh build and declaration/source binding are required before the one representative journey. Native assertions executed/passed at this source checkpoint are 0/0; actual cold attempts remain zero and the 400-attempt comparison remains gated. The native logout owner decision is unchanged. No product, auth/provider, API, business rule or localized-copy behavior changed, so FR/UC/AC/BR/screen/localization artifacts need no update. All T14-T20 acceptance gates remain in scope.

### Camera diagnostic runtime checkpoint (2026-10-03)

Representative public attempt `ed04add4a4973aa25814bb5b`, capture
`d680d07fbe4d107eefe3ca5d`: fresh iOS build and installation completed.
The explicit no-retry email interaction and unchanged exact email assertion
passed. The subsequent credential sign-in/home command failed with original
child exit 1; the public invocation terminated with exit 2 and
`harness-blocked`. Camera assertions were not reached; this is not a passing
scenario or cold attempt. Independent cleanup passed for 106 PID/start pairs,
with no survivors, unknown queries, missing foreign devices, owned device,
cache, or owned Docker resources. All 197 frozen source hashes remained
unchanged through terminal cleanup; the source hold was released.

Evidence: primary private artifact directory
`.qa/artifacts/testing-modernization/camera-input-representative-public-live-2026-10-03-v1`,
including `ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`.
Sign-in/home diagnosis remains Pending; T14–T20 and the pending logout policy
decision remain open. No product, auth, provider, or localized-copy behavior
changed.

### Diagnostic password-focus source change (2026-10-03)

Following representative capture `d680d07fbe4d107eefe3ca5d`, retained protocol
and hierarchy evidence show password input appended to the still-focused email
field, causing the unchanged post-password email assertion to fail before
submit. The visible iOS keyboard setup panel supports a focus-obstruction
hypothesis; its causal role is unproven. The reviewed diagnostic continuation
now dismisses the keyboard semantically immediately before selecting the
password field. It preserves the existing post-password dismissal, exact email
assertion, effective retries disabled, student auth/home identity, and all four
camera assertions. Non-diagnostic credential helpers are unchanged.

Source wiring: **Done in the qualified worktree**. Native repair, camera
UI/API/SQL qualification, and T14–T20: **Pending** until controlled runtime
evidence. This adds no coordinates, email re-entry, retries, auth behavior,
provider change, or user-facing copy. FR/UC/AC/BR/screens/localization remain
accurate and require no behavior update. Private integration evidence:
`.qa/artifacts/testing-modernization/camera-password-keyboard-root-integration-2026-10-03-v1`.

### Camera generated-flow parsing checkpoint (2026-10-03)

Public attempt `550bd6203285d60273fba536`, capture
`b3af53f7570409ccd14a0773`: fresh build/install and the credential continuation
completed after the diagnostic keyboard dismissal. Student home, camera
relationships, permission prompt, denial guidance, and manual-code preparation
produced retained runtime evidence. The scenario remained **harness-blocked**:
Maestro rejected `connection-switch-1-coach-account.yaml` before any Account UI
action, because the semantic navigation token `student-professionals-back` was
emitted as a bare YAML action body. This is a generation defect, not evidence
of an Account-screen defect. Public assertions remain empty; no scenario pass
or T15 cold attempt is credited.

Independent cleanup passed 181 PID/start pairs with no survivors, unknown
queries, missing foreign devices, owned simulator/cache, or owned Docker
resources. All 197 frozen source hashes matched through cleanup; source hold
released. Private terminal evidence:
`.qa/artifacts/testing-modernization/camera-password-keyboard-public-live-2026-10-03-v1`.

Navigation lowering repair and resource-free parsing of every reachable flow
for this exact camera checkpoint are **In progress**. Before the next build,
render safe fixture placeholders through existing helpers/parser and verify
command-list structure, including student-back navigation and the
student-to-coach switch. Retain the original malformed YAML/log and a detecting
control; compare repaired bytes and report checked/reachable flow counts. This
supplements source readiness and never substitutes for native UI/API/SQL
qualification. All four camera assertions, build/source guards, deadlines,
cleanup, logout-policy decision, T14–T20, and the 400-attempt gate remain intact.
Product/auth/provider/copy requirements are unchanged.

### Camera generated-flow source checkpoint passed (2026-10-03)

The navigation lowering repair is **Done for source readiness; native qualification remains Pending**. The canonical production helper lowers student-back navigation into structured Maestro actions before opening Account. The actual 243-byte malformed flow is retained as a regression fixture. Resource-free controls parse all **21/21 reachable complete production documents** for this diagnostic camera path and separately check two shared builders, preserving four camera assertion IDs and the 90-second waits.

The four new controls passed; the 13 existing affected controls passed in the initial batch. The initial aggregate 16/17 failure and subsequent adaptation failures remain retained alongside the final passing preflight, zero-warning lint, full-project typecheck, and formatting receipts in `.qa/artifacts/testing-modernization/camera-generated-flow-root-integration-2026-10-03-v1`. Source checks do not count as native passes or cold attempts.

Existing build-reuse qualification excludes the prior camera harness-blocked capture, so the next controlled replay requires a fresh build. Native UI/API/SQL, independent cleanup, exact source identities, original deadlines, logout-policy decision, T14–T20, and the 400 actual cold-attempt gate remain required. No product behavior, provider terminology, requirements, screen copy, or localization changed; those artifacts require no update for this harness repair.

### Camera generated-flow native replay terminal (2026-10-03)

Public attempt `8723184abde92777c3aad4fc`, capture `447a56427f4e0659212d7abd`, ended **harness-blocked** with original child exit 2. The fresh build succeeded; diagnostic sign-in, camera permission denial, guidance, and manual-code preparation completed. Repaired Account-switch YAML parsed. Its student-back tap completed, but the following `tabs.account` tap failed because the selector was absent. A partial log containing completed actions did not prove the whole switch completed; the retained terminal log owns the outcome.

The manual-entry screenshot shows an open keyboard. The failure screenshot shows the same invite-entry screen with the keyboard dismissed. Keyboard interception is a diagnosis to investigate against screen behavior, not a confirmed platform cause. No unchanged rerun is authorized by this checkpoint; establish and review a specific repair first. Four camera assertion IDs and native UI/API/SQL requirements remain intact; public assertions are empty and no scenario pass or cold attempt is credited.

Independent cleanup passed 186 PID/start pairs with no survivors, unknown queries, missing foreign devices, owned simulator/cache, or Docker resources. All 199 frozen source hashes matched before release. Terminal evidence is sealed in `.qa/artifacts/testing-modernization/camera-generated-flow-public-live-2026-10-03-v1`. The final-source provenance addendum explicitly supersedes the earlier pre-adaptation transfer test hash while preserving the historical receipt. T14–T20 and the 400-attempt comparison remain Pending; product/auth/provider/localization behavior is unchanged.

### Camera Back keyboard source repair (2026-10-03)

The reviewed semantic student-back path now emits `hideKeyboard`, one Back tap, a bounded 90-second `student.home.screen` witness, then Account; the original 90-second Account-screen wait remains. The existing whole/step deadlines still bound execution. The installed React Native ScrollView source confirms default keyboard tap consumption, consistent with the retained before/after hierarchy and screenshots; successful native replay is still required. No repeated Back taps, coordinates, fallback retries, product navigation, auth policy, or camera assertions were introduced.

Source repair is **Done; native qualification is Pending**. Canonical controls passed 11/11, including all 21 reachable complete production flow documents, unchanged `none`/legacy paths, and the original malformed-YAML fixture. Full-project typecheck, zero-warning lint, and formatting passed. The detecting-before missing-dismissal control and exact preimages are retained in `.qa/artifacts/testing-modernization/camera-back-keyboard-root-integration-2026-10-03-v1`. No native pass or cold attempt is credited. All T14–T20 gates, independent cleanup, UI/API/SQL evidence, four assertion IDs, and 400 actual cold attempts remain required. No product/provider/copy change occurred, so FR/UC/AC/BR/screens/localization need no update.

### Camera keyboard repair native replay terminal (2026-10-03)

Attempt `aba9a3c2da99139b612e2f25`, capture `ee26d04023ee52821d88c28b`, ended **harness-blocked**, original child exit 2. The fresh build succeeded. All five repaired Back/Account commands completed, including the home and Account destination witnesses. Both role switches, invitation creation, live manual submission, and pending-card observation reached their command checkpoints. These partial results do not qualify the full camera scenario.

The observer then rejected `trainingAfter` versus `trainingBefore` as unrelated training state. The retained diff includes the expected newly submitted connection inside the broad domain snapshot. Diagnose the snapshot scope and consumer verification before repair; preserve strict expected-connection transition and unrelated connection isolation, and require mutation-detecting training checks. No assertion may be dropped to make the replay pass. Public assertions remain empty; native scenario passes and cold attempts are unchanged.

Independent cleanup passed **402 PID/start pairs**, with no survivors, unknown queries, missing foreign devices, owned simulator/cache, or Docker resources. All 199 frozen paths matched; source hold released. Evidence is sealed in `.qa/artifacts/testing-modernization/camera-back-keyboard-public-live-2026-10-03-v1`. The generic iOS connection adapter's raw-navigation versus Detox enum mismatch is a separate reviewed-source candidate, not an integrated or runtime-qualified fix yet. All T14–T20 and 400 actual cold attempts remain in scope. Product/auth/provider/copy behavior is unchanged.

### Generic iOS connection navigation source integration (2026-10-03)

The shared iOS connection adapter now forwards `none` and `student-professionals-back` unchanged. Maestro lowers those values at the existing capture boundary; Detox validates/transports the semantic enum at its existing IPC boundary. This fixes the former raw-YAML conversion, which bypassed the repaired Maestro semantic branch and violated the Detox navigation contract. Source integration is **Done; native/runtime qualification remains Pending**.

Canonical adapter/camera controls passed 6/6, including all 21 generated camera documents and real Detox command validation with a rejecting raw-YAML input. After three test-style lint warnings were repaired, the adapter controls passed 2/2 again; full-project typecheck, zero-warning lint, and formatting pass. The original warning receipt remains retained in `.qa/artifacts/testing-modernization/ios-connection-enum-root-integration-2026-10-03-v1`. Source checks do not qualify native Detox, cold resets, or the complete connection journey. The camera domain-snapshot comparison repair remains separate and Pending. No product/auth/provider/copy behavior changed, so product requirements and localization need no update; T14–T20 and 400 actual cold attempts remain required.

### Camera domain preservation repair contract (2026-10-03)

Status: **In progress**, owner: client/server maintainer. Preserve complete raw before/after `domain-snapshot-v1` bytes and their source references. Compare every non-connection field exactly, including schema/run/scope/read-only identity and all training plan/session/owner fields. The expected connection transition must remain independently strict, and unrelated connection isolation must remain exact. Bind embedded domain connection rows to the corresponding before/pending connection snapshots using every shared field. The domain-only `sourceInviteCodeValue` is retained: preexisting values must remain unchanged and the new target value must match the observed coach invite code. The retained baseline confirms the two shared rows match; no after-domain bytes exist for the historical failed run.

Required source controls: a realistic expected 2-to-3 connection delta passes through the actual producer and consumer; training/session/ownership/row/identity changes and mismatched embedded connections reject. Existing empty-connection domain fixtures masked the failure and must be corrected. Save after-snapshot bytes before preservation checks so future failures retain diagnostics. Preserve four camera assertions, full raw schema validation, API/SQL evidence, deadlines, and cleanup. Source readiness and a fresh native replay are separate pending gates; do not rerun unchanged code or credit historical training preservation. No product behavior, provider, auth policy, or localized copy changes are in scope.

### Camera domain preservation source acceptance (2026-10-03)

The four-file repair is integrated and accepted by independent preservation and provenance/staging reviewers. Source readiness is **Done; native qualification remains Pending**. Full raw snapshots are persisted before semantic checks; complete non-connection identity/training equality, embedded SQL-row binding, preexisting invite-value preservation, observed target invite-value binding, strict connection transition, and isolation checks are enforced in both producer and consumer.

The corrected actual-producer fixture models two preserved connections becoming three, one preserved plan/session, eight mutation/identity rejections, and complete raw-after retention. The consumer fixture covers the same connection delta and mutation/source-value failures. Canonical batch passed 56/57; the only failure was the stale inventory guard expectation. After refreshing inventory and fixing one test-only type annotation, affected controls passed 30/30; full-project typecheck, zero-warning lint, and formatting pass. The original failures remain retained. The final inventory-dependent closure check is required before dispatch. Evidence: `.qa/artifacts/testing-modernization/camera-domain-oracle-root-integration-2026-10-03-v1`.

Review scopes were preservation/producer-consumer and provenance/staging/lifecycle, with one complete findings list per reviewer. Final preflight hash `c2fdba22360956f8818fa1d6e245bc6a0d2e0ae9f6a82bbf79959ee16deac984` supersedes the historical transfer preflight hash; the change adds only an erased TypeScript annotation. Existing four assertions, UI/API/SQL evidence, source identity, deadlines, cleanup, T14–T20, and 400 actual cold attempts remain unchanged. The failed camera capture does not qualify for build reuse; exactly one fresh representative replay follows the final source checkpoint. No native pass, cold attempt, product/auth/provider/copy change, or performance saving is claimed.

### Camera domain preservation terminal replay (2026-10-03)

The accepted source checkpoint was replayed once through the public iOS/Maestro integrated camera command with a fresh successful build. Public attempt `331f7489538121d7b38f348c`, capture `0c8298b88b625cbef9130da1`, is terminal with child exit 2: capture **observed**, callback completed, public **harness-blocked** at verification. No camera scenario pass or cold attempt is claimed.

The actual denial/manual fallback, two-role journey, authenticated coach invite, native submit (201), pending UI/API/SQL and raw after-state persistence completed. Independent readback confirms the two-to-three embedded connection transition, exact complete non-connection domain preservation and identical isolation snapshot bytes. The public verifier rejected `Camera denial transport window contains an undeclared mutation`: producer metadata starts at request zero and includes pre-sign-in analytics requests 1 and 2 (`POST /analytics/events`, 202) before sign-in request 3. This is the next diagnosed harness boundary, not proof that the public assertion contract passed. The next correction must distinguish the authenticated prelude from the actual camera action interval with producer-backed boundaries, retain complete raw transport and normal sign-in/read evidence, and reject undeclared business mutations. Do not blanket-allow telemetry or change authentication/logout behavior. Boundary repair is **In progress (diagnosis)**; public native qualification remains **Pending**.

Independent cleanup passed; all 200 held source paths remained unchanged before hold release. Original terminal receipts and after snapshots are retained. Private proof: `camera-domain-oracle-public-live-2026-10-03-v1/ROOT-TERMINAL.private.json` and `camera-domain-oracle-terminal-readback-2026-10-03-v1/READBACK.private.json`. No retry or build-reuse eligibility is inferred from this blocked public receipt. T14 equivalence, T15 all 400 actual cold attempts, T16-T20 and the separate pending logout policy decision remain unchanged. This checkpoint changes only QA delivery status: product requirements, business rules, use cases, screens, provider behavior and localized copy are unchanged, so those artifacts need no update.

### Camera transport boundary repair contract (2026-10-03)

**In progress (source); native Pending.** The diagnosed public camera failure is addressed by capturing the actual `owned-api-proxy.requestIdFence` immediately before the camera observer begins. Persist a producer-bound marker; the denial interval is `(preludeFence, denialEnd]`, selected request IDs must match complete raw sidecar rows exactly, and the fence must follow the initial authenticated student boundary. Preserve the full raw stream and separately verify the initial sign-in and normal camera-window relationship read. The consumer must reject missing/forged boundaries, reordered/omitted/hash-mismatched observations, analytics or business mutations after the marker, and any caller/source mismatch. No blanket telemetry exception is authorized by this QA repair.

The actual replay also omitted `cameraInitialAuth.beforeRequestId` while the existing consumer requires it. Retain the actual captured pre-sign-in fence in the producer; do not invent zero or weaken identity validation. Keep all four assertion IDs, exact UI/API/SQL/domain checks, source-byte staging, deadlines, cancellation and independent cleanup. Resource-free positive/negative controls precede a fresh native replay; source controls are not native qualification. No product/auth/logout/provider/localization change is planned, and the separate logout policy decision remains pending.

Before another native build, this source packet also requires one resource-free completed-report integration gate: invoke the real owned capture producer seam used by the production call-site, serialize its completed report, stage protected evidence, and consume it through the complete camera/public verifier including later initial-auth validation. Use the retained replay topology (pre-sign-in analytics, actual auth fences, normal reads, denial interval, one live-submit-shaped 201 and pending UI/API/SQL, complete two-to-three domain transition). The producer must emit the initial `beforeRequestId` and bound camera prelude marker; fixture code may not manually supply those missing fields in place of production emission. Reject missing/forged markers, prefix mismatch, undeclared in-window mutations and late metadata gaps. Reuse the current fixture/staging infrastructure, retain original receipts, and label this gate source evidence only. This gate is **Pending** until its actual receipt passes; it does not replace native assertions, cleanup, source/build binding or independent review.

The completed-report trace also requires correcting publication order. The private camera adapter currently calls the complete stager before its own terminal sidecar exists, while the final public consumer calls the exclusive stager again. The adapter must validate the completed raw report, retain its cleanup/caller/deadline checks, and publish the immutable terminal sidecar with zero native passes. Its `stagedManifestPath` remains null because it has not staged. The complete public consumer then performs protected staging exactly once after all sidecars exist, revalidates the staged evidence and runtime/cleanup identities, and only then may expose the original four passed assertion outcomes. This ordering correction is **In progress** within the same source packet; offline positive and failure controls plus native replay remain required.

Publication ordering is now **Done (source in the qualified worktree); packet acceptance and native qualification remain Pending**. The adapter validates the raw completed report and publishes its terminal sidecar without calling the protected stager; `stagedManifestPath` is null and native passing cases remain zero. The unchanged complete public staging body is exported solely so the offline integration control can execute the same function used by production. The affected actual adapter-chain control failed before this change and passes afterward, including its caller-binding, deadline, missing-binding and cancellation subcases. Full qualified TypeScript, scoped zero-warning lint and formatting pass. Proof: `camera-denial-boundary-controls-preparation-2026-10-03-v1/PUBLICATION-ORDER.private.json`. This is not the completed-report integration receipt: the producer boundary candidate, real-validator/stager/public-consumer gate, consolidated independent review and fresh native replay remain Pending.

## Native logout owner decision (2026-10-03, 18:58 UTC)

The owner instructed: “Only clear on device ! Now go ahead with the next steps,
you’re owning that now! Go ahead”. D-218 / BL-018 therefore selects the existing
FR-270 / BR-342 device-local native logout contract. AC-539 and TC-333 require
persisted credential/session and authenticated identity clearing, signed-out
relaunch, inaccessible protected UI and no authenticated hydrate after relaunch.
A still-valid server bearer token is not failed native logout. Native server
revocation is outside this acceptance scope; browser sign-out serialization and
revocation remain unchanged.

Policy decision: **Done**. T14-A execution and T15 comparison: **Pending**.
Retain all five families, both platforms, both engines and the required 400
actual balanced cold attempts. NAT-session-signout and
NAT-session-signed-out-relaunch retain their IDs and gain the explicit
FR-270 / BR-342 / AC-539 / TC-333 requirement links. Existing isolation,
local-storage, UI, transport, cleanup and threshold checks remain required.
Historical decision-needed reports retain their original outcomes and are
superseded only as current policy gates. No product authentication, browser
use case, user-facing copy or localization implementation changes are needed.

### Local logout declaration validation (2026-10-03)

Focused declaration/session dependency/staging/real-finalization controls first
reported 18/25 passing: the new logout assertion requirement IDs were missing
from their parent scenario. The generator now includes FR-270, BR-342, AC-539
and TC-333 in both parent scenario and logout assertion rows. The same batch
then passed 25/25, including real disposable staging, abort/deadline and byte
replacement controls. Native inventory validation, refreshed 466-file unit
inventory check, formatting and diff whitespace checks passed. Original
before/after logs and hashes are retained in
`.qa/artifacts/testing-modernization/native-local-logout-policy-2026-10-03-v1/POLICY.private.json`.
This source checkpoint qualifies zero native passes and zero cold attempts.

### Camera prefix review and Detox V3 root controls (2026-10-03)

The frozen camera boundary candidate remains **blocked before transfer**:
independent review found that its consumer checks the prefix count/digest but
not complete unique request IDs `1..requestIdFence`. Add sorted-copy coverage
and missing/duplicate-ID negatives without reordering the raw digest. The
actual completed-report producer/serialization/protected-stage/public-consumer
gate remains required. Finding retained in
`camera-denial-boundary-controls-preparation-2026-10-03-v1/PREFIX-REVIEW.private.json`.

Root independently verified the five Detox V3 preimages and ran the two focused
candidate suites: 25/25 passed, including late cancellation/deadline rejection.
Independent re-review is Pending; no transfer is performed. Receipt:
`detox-terminal-publication-v3-root-controls-2026-10-03-v1/ROOT-CONTROLS.private.json`.
Neither checkpoint qualifies native passes or cold attempts.

### Terminal-publication durable result review (2026-10-03)

Detox V3 remains **blocked before transfer**. Independent review confirms the
post-await cancellation/deadline fences are repaired, but a late failure can
leave `receipt.json` with a passed result. The direct comparison collector
currently trusts those bytes without durable terminal-publication status; the
cold dispatcher's in-memory status guard is insufficient for direct intake.
The next private revision must make failed publication bytes ineligible through
existing protected publication/intake infrastructure and exercise actual late
publication followed by actual collector rejection. No source control, exit
code alone or absent invalidation record may qualify those bytes as a pass.
The V3 review and original 25/25 source controls remain retained in
`detox-terminal-publication-v3-root-controls-2026-10-03-v1/REVIEW-HOLD.private.json`.
Native/public qualification and cold attempts are unchanged.

The camera prefix revision must also reject a missing tail: a self-consistent
prefix `[1,2]` with fence `3` is incomplete despite contiguous sorted IDs.
Require unique coverage of every ID `1..fence`, retain the original raw-order
digest, and include missing-tail/interior-gap/duplicate negatives. The original
frozen consumer is preserved under
`camera-denial-boundary-controls-preparation-2026-10-03-v1/consumer-first-frozen-review.before.ts`;
mutable revised candidate bytes require a new matching manifest/freeze.

### Native session process-census revalidation (2026-10-03)

The retained session post-tap diagnostic public attempt was blocked before
assertions/build qualification by the owned worker process-census query's
5,000 ms timeout. The owner-approved local-only logout policy does not alter
that historical failure. One read-only execution of the exact current census
query now completes in approximately 29 ms; output is retained only as size
and hash, never foreign command arguments. Current ownership/census controls
pass 15/15, including identity drift, foreign ownership and query failure
rejection. No timeout, ownership rule or production behavior was changed.
Proof: `native-local-logout-policy-2026-10-03-v1/PROCESS-CENSUS-READBACK.private.json`.
A new session attempt still requires a fresh qualified build/target and the
normal dispatch gates; no old capture becomes reusable or passing.

### Completed camera report V2 root execution (2026-10-03)

Root independently ran the exact frozen V2 completed-report control: 15/15
passed (14 imported fixture controls and one complete production capture
statement/observer/serialized report/terminal adapter/protected public staging
control). All five candidate and overlay source hashes match the manifest.
Original source and results are retained in
`camera-completed-report-v2-root-controls-2026-10-03-v1/ROOT-CONTROLS.private.json`.
The author's combined 29 executions repeat the same 14 fixture controls;
there are 15 distinct registered controls, not 29 distinct full-path controls.

Acceptance remains blocked by the concrete denial end-window gap: the producer
records maximum completed request ID without draining and binding the actual
request-start end fence. A late request can fall outside the checked window.
The next revision must bind a quiesced end fence and complete interval, and
reject a delayed mutation through the full report consumer. No canonical
transfer, native pass, cold attempt or product behavior change is credited.

### Camera complete-run gate checkpoint (2026-10-03, current source controls)

The next complete iOS Maestro camera run remains Pending until the exact camera source snapshot receives independent acceptance and guarded integration. Current coherent candidate controls passed 21/21, and the full qualified TypeScript graph passed with zero diagnostics. These are source controls, not native passing cases. The repaired consumer validates the completed full Maestro invocation before normalizing missing hierarchy visibility, requires unique contained coach/invite nodes, and rejects overlapping primary/isolation fixture identities and missing submission or isolation evidence.

A production-validator check against original capture `a53a13539b29f762cd09b5db` rejected the missing independent isolation fixture proof; all 297 original file hashes remained unchanged. Retain that blocked original without synthesizing sidecars. Root evidence: `camera-v4-root-early-graph-2026-10-03-v1/ROOT-CURRENT-CONTROLS.private.json` and `retained-original-rejection.cjs`. After acceptance, run one fresh evidence-producing diagnostic with a fresh build, then require actual terminal publication, protected staging, all four UI/API/SQL assertions and independent cleanup. No new native or cold qualification is claimed by this checkpoint. Product behavior, provider terminology and localized copy are unchanged; no product-documentation or localization update is needed.

### Camera acquisition and credential checkpoint (2026-10-03)

Camera V4 was independently accepted and guarded into the qualified worktree. Canonical completed-report plus generated/producer-binding entries passed 28 distinct controls; full TypeScript, strict zero-warning lint, formatting, inventories, impact and diff checks passed. Root made mechanical repository-lint corrections only after transfer. Current test inventory is 471 files (407 client, 64 server). Source proof is retained in `camera-v4-root-canonical-integration-2026-10-03-v1/ACCEPTED-SOURCE.private.json`.

The first fresh attempt `fc8b7cffd24e6f5595e22bbb` stopped before build because backend fingerprinting found an untracked `scripts/ci/ci` symlink to an old private candidate. Preserve that link outside the qualified source tree; both repository fingerprint checks then passed. The original cleanup contract failed for lack of a closed backend receipt, despite independent census finding no process survivors, missing foreign devices or occupied reserved ports. Retain that failure without relabeling it as passed.

The subsequent fresh attempt `a6e3b18e50438005cb6325b0`, capture `db9bd1e8992315737b459197`, acquired both independent fixtures and built iOS successfully. It stopped before camera execution at the diagnostic exact email-value assertion. Actual captured email state remained empty/not-focused after the separate tap and input commands; investigate the driver/stage boundary before another full camera run. Independent cleanup passed and all 204 held hashes were unchanged before hold release. Proof: `camera-acquisition-symlink-repaired-public-live-2026-10-03-v1/ROOT-TERMINAL.private.json`. No new camera/native public pass or cold attempt is claimed. Product behavior and localized copy remain unchanged.

### Complete iOS Maestro camera run passed (2026-10-03)

The credential input stage now acquires the exact semantic email field and types within one owned Maestro invocation, with automatic tap retries disabled. The separate diagnostic tap observation, original exact-value assertion, ownership receipts and negative gates remain intact. Two independent source reviews accepted this narrow repair; canonical credential/camera controls passed 62/62, and full TypeScript, strict lint, formatting, inventory and impact checks passed.

Fresh public attempt `632b5909535b079dcb403416`, capture `8e5cfbcc06415524a955782b`, exited 0 with result `passed`. All four original assertions passed: `NAT-camera-normal-entry`, `NAT-camera-denial-guidance`, `NAT-camera-manual-submit`, and `NAT-camera-unrelated-state`. The run acquired both independent fixture sets, built a fresh iOS binary, passed the credential exact-value diagnostic, completed camera permission denial/manual submission, and verified original UI/API/SQL and preserved-state evidence through protected staging. Independent cleanup passed; all 205 held hashes were unchanged before source-hold release.

Root terminal proof: `camera-credential-focus-repaired-public-live-2026-10-03-v1/ROOT-TERMINAL.private.json`. Actual public receipt: qualified worktree `.qa/artifacts/native-pilot-attempts/632b5909535b079dcb403416/receipt.json`, SHA256 `9d724878c0c4b1300f57888400d8f6a1f43ba6a7eb75521cf06772ca65d92bfa`. Preserve earlier blocked captures and their original failures. This qualifies the iOS Maestro camera integration cell only; the paired T14 matrix, all 400 T15 cold attempts, T16-T20 and hosted adoption remain incomplete. No cold attempt was added. Product behavior, requirements and localized copy are unchanged; no product-documentation or localization change is required.

### T15 owned cold lifecycle V12 canonical source accepted (2026-10-04)

Guarded integration transferred the reviewed 18-file V12 closure into the qualified worktree, including the actual default iOS family bridge, caller output/deadline forwarding, bounded staging and blocked receipts, helper ledger, and declaration ownership. All nine existing preimages matched; new paths were absent before transfer. The authoritative immutable binding is `FREEZE.private.json`; the stale non-JSON V11 marker was not used or transferred.

Canonical validation passed 36 distinct T15 controls and 46 adjacent producer/public-evidence controls, full TypeScript, strict touched lint, formatting, native/unit inventories, impact and diff checks. Current inventory is 476 test files (412 client, 64 server). Root proof: `t15-v12-root-canonical-integration-2026-10-04-v1/ACCEPTED-SOURCE.private.json`. This source path covers four iOS Maestro integration families only. Native reset/target/build/fixture execution and protected cold receipts remain unqualified; zero cold attempts were added. Full 20-cell T14 equivalence, 400 balanced T15 attempts and subsequent plan phases remain incomplete. The earlier camera native receipt remains evidence for its exact executed source snapshot; do not infer current-source native freshness after this integration. Product behavior, provider baseline and localized copy are unchanged.

### Next camera run and T16 composition guard (2026-10-04)

The actual iOS Maestro camera receipt `632b5909535b079dcb403416` remains passed with four passing assertions and cleaned ownership. The next Detox camera cell still requires its actual producer/public route and a build qualified against the final current source; the earlier Maestro build does not establish current-source freshness after T15 integration.

Root comparison of the frozen T16 V3 packet found stale candidate removals: `run-ios-training-attempt.ts` would remove accepted T15 caller output-root and absolute-deadline forwarding, and `native-camera-submission-evidence.ts` would remove accepted camera staging lifecycle fences. Matching preimages alone do not authorize these regressions. No V3 source was transferred. Prepare and independently review a three-way composition preserving current accepted source before canonical validation and fresh native build. This is a QA integration correction; product behavior, requirements and localized copy are unchanged. No native or cold attempt is credited by this checkpoint.

### Fresh iOS build qualified; Detox bridge deadline blocker (2026-10-04)

Owned entry capture `f94fc22bf57d4c63b35b222d` exited 0 with `observed` and `cleaned`. Root reviewed the actual entry screenshot and exact sign-in hierarchy selectors, independently verified cleanup, and executed both reusable-iOS and Detox qualified-build loaders successfully. All 214 held source hashes were unchanged before release. This is entry/build qualification only, with zero T14 assertions or cold attempts credited. Root proof: `ios-current-entry-build-public-live-2026-10-04-v1/ROOT-TERMINAL.private.json`. The wrapper initially labeled its caller-requested ID as the capture ID; the independently allocated production capture ID is bound in `PRODUCER-IDENTITY.private.json`, and original wrapper output is preserved.

Actual iOS Detox connection attempt `d1605c3e7fd82d1dbbea3d1d` reused the qualified build but stopped at `runtime-execution-failed`, with zero assertions and no target identity. The original cleanup failure remains `failed-recovery-ledger-retained`; it is not relabeled as an independently cleaned run. A resource-free replay through the real dispatcher and bridge reproduced the rejection before driver invocation: the 600,000 ms step budget was replaced by roughly 2,400,000 ms remaining whole-run budget, exceeding the bridge's 600,000 ms maximum. Repair the handoff while preserving the nonrenewing caller absolute deadline, then validate and perform a fresh actual attempt. All 214 source hashes remained unchanged before this hold was released. Proof: `ios-detox-connection-qualified-build-public-live-2026-10-04-v2/ABSOLUTE-DEADLINE-BRIDGE-REPRO.private.json`.

The full T15 specification is independently accepted as source declaration: 20 cells, 400 unique mapped identities and 10 alternating engine pairs. Runtime build/reset/target proof and every actual cold attempt remain pending. Its actual source-only production preflight also exposed a blocked-reset cohort fingerprint mismatch; keep the 400-row failure and fix the runner contract rather than reducing scope. Product behavior, provider terminology and localized copy are unchanged.

### T15 blocked-reset cohort contract repaired (2026-10-04)

Canonical owned lifecycle now places the declared cohort fixture/reset fingerprint on blocked reset rows, preserving their actual attempt/fixture IDs, pending receipt binding, not-acquired cleanup and original blocker. Root executed both private full-400-row production/dispatcher controls without native acquisition. The new canonical regression uses distinct attempt/cohort fingerprints: it fails against the retained original source and passes after repair. All 48 canonical owned-lifecycle/dispatcher/production-runner controls, full TypeScript, strict touched-file lint and formatting pass. Evidence: `t15-reset-contract-root-integration-2026-10-04-v1/ACCEPTED-SOURCE.private.json`. Actual cold attempts and native/public passes added: zero. Product behavior, localization and provider baseline are unchanged; no product-documentation update is needed.

## Camera continuation checkpoint (2026-10-04)

The shared iOS Detox dispatcher now bounds each bridge step by the requested step budget, remaining absolute deadline and 600000 ms. Existing canonical lifecycle/runtime-closure controls pass 14/14; full TypeScript, touched-file zero-warning lint and formatting pass. The original failed native attempt remains unchanged. A candidate regression helper was rejected before canonical execution because it recursively removed the shared receipt parent; only production source was transferred and a safe regression correction is in progress. Evidence: `ios-detox-deadline-root-integration-2026-10-04-v1/TRANSFER.private.json`.

Independent iOS Detox camera V1 review blocks transfer: the current dispatcher has no reachable Detox camera mapping, the staged assertions do not meet current UI/API/SQL bindings, original screenshot/event descriptor provenance is missing, source/declaration metadata is not established, transport metadata is synthesized, partial-acquisition cleanup is incomplete, and in-flight operations are not all deadline bounded. Synthetic IPC/image tests do not qualify a native camera cell. Correct iOS V2 and Android camera ownership paths before native dispatch. Review: `/private/tmp/detox-ios-camera-route-independent-review-20261004-v1/REVIEW.private.json`. The prior actual iOS Maestro camera pass remains historical proof; no new native or cold attempt is credited. No product behavior/localization changes were needed for this harness correction.

The corrected deadline regression helper is canonically integrated, with a unique owned temporary repository and randomized exclusive-create sentinel. The final lifecycle/runtime closure suite passes 16/16, full TypeScript passes, and actual reusable build `f94fc22bf57d4c63b35b222d` revalidates through the real bridge to an injected resource-free driver. Both 600000 ms and shortened whole-run budgets preserve the absolute deadline. Android Maestro camera preflight controls pass 53/53; a fresh four-assertion Android camera attempt is prepared, with zero native or cold passes credited before its actual terminal. Evidence: `ios-detox-deadline-root-integration-2026-10-04-v1/REAL-BRIDGE-REPRO.private.json` and `android-maestro-camera-public-live-2026-10-04-v1/PREFLIGHT.private.json`.

## Actual Android camera request blocker (2026-10-04)

Attempt `7edf33129cbe13803778f9cd`, capture `71d829318963a65e5d44a4f5`, terminated with exit 2 and zero assertions. The actual producer sent `native-connection-isolation-android` (35 characters) to the owned backend session fixture request, whose `session-request-v1` schema permits at most 32. Acquisition had reached ADB, owned emulator, backend and proxy; app build and engine acquisition had not started. The original capture cleanup is `failed-recovery-retained` and public cleanup is `failed-recovery-ledger-retained`. Root read-only inspection identifies a separate validator failure: the completed owned `final-state` diagnostic is rejected as engine execution before Expo acquisition. Reported backend/target cleanup does not substitute for successful independent absence proof. Preserve all originals, shorten the Android isolation scope consistently, and narrowly classify the owned final-state cleanup observation before any fresh retry. All 262 held source paths stayed unchanged and the native wrapper is terminal; source hold is released. Evidence: `android-maestro-camera-public-live-2026-10-04-v1/ROOT-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. No native or cold pass is credited.

## T16 V4 canonical source integration (2026-10-04)

Root verified every current preimage and candidate hash, transferred all 25 reviewed source/test/package paths, and left the two identical formatter-support files untouched. Accepted T15 forwarding, camera staging fences and the iOS Detox deadline clamp are preserved. Canonical exploration runtime/stdio/controller/outer-cleanup controls pass 80/80; full TypeScript, touched 23-file zero-warning lint and 24-file formatting pass. The package script `qa:explore` now calls the existing owned exploration entrypoint. No native observation, product regression conversion, cold attempt or public pass is added by these controls. Actual bounded observation, cleanup, findings and T17 conversion remain pending. The actual iOS loader reports `Native build source identity is stale or unknown` for `f94fc22bf57d4c63b35b222d`; requalify through a fresh build before native reuse. Evidence: `t16-v4-root-canonical-integration-2026-10-04-v1/TRANSFER.private.json`, `canonical-controls.private.log` and `BUILD-REUSE-REVALIDATION.private.json`. This updates QA delivery state only; product requirements, screens, copy, locales and backend provider baseline are unchanged.

### iOS camera build-cache handoff (2026-10-06)

Status: **In progress**. The previous current-source entry build reached its original 900000 ms deadline before an app could be observed and was cleaned; its compiler cache was intentionally unavailable afterward, so it cannot be recovered or reused. The iOS camera harness now records an incremental-cache receipt only for a newly owned, cleaned failed build whose source, toolchain, SDK, architecture, signing inputs, command, and cache-tree hashes all match. A successor may copy only compiler intermediates into a fresh DerivedData root, then must execute a fresh `xcodebuild` under the same 900000 ms cap. It cannot copy an app product, terminal receipt, or log.

Focused receipt, stale-input, binding, deadline, and production-wiring controls pass with the current entry-evidence repair. This is preparation for a new cache-producing build, not a native camera result; entry observation, all camera assertions, protected staging, and independent cleanup remain Pending. No product behavior, provider, or localized copy changed.

### Current iOS Maestro camera run completed (2026-10-06)

Fresh owned attempt `e750a3812f73b0e3d0e1cf50`, capture `8abc43acdc6efc702cc13f87`, passed with exit 0. The harness built a new Metro-attached Debug app in 347 seconds, observed entry, denied camera permission, showed the manual-code guidance, submitted the live invite, and observed the pending connection. All four assertions passed: `NAT-camera-normal-entry`, `NAT-camera-denial-guidance`, `NAT-camera-manual-submit`, and `NAT-camera-unrelated-state`; each has its required UI/API/SQL evidence binding. The receipt is `.qa/artifacts/native-pilot-attempts/e750a3812f73b0e3d0e1cf50/receipt.json` (SHA-256 `0a7c010de91dff9326503a470214f473b92ba4be88791403bd5c1b34c740b942`).

Capture cleanup and public cleanup are `cleaned`; the owned simulator is absent afterward. Source and helper identities matched from acquisition through cleanup. The incremental cache was not used or produced because the fresh build completed inside the fixed 900000 ms cap. This qualifies this exact current iOS Maestro camera scenario only; Android parity, cold matrix, exploration, hosted adoption, and broader plan gates remain Pending. No product behavior, provider, or localized copy changed.
