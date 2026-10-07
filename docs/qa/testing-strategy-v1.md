## 2026-10-06 — Android camera impact registration

Status: **In progress** for testing modernization (D-218 / BL-018). Register the existing Android Detox camera spec as `detox:integrated-camera-android`, with `owned-integrated-camera` fixtures and `ci:false`, matching the existing iOS integration entry. This resolves the fast-quality manifest omission without enabling a selective native runner. Actual native qualification, protected hosted receipt and CI promotion remain **Pending**. No product/provider/localization behavior changes.

# Testing strategy V1

Status: implementation in progress (BL-018 / D-218). The [plan](../plans/2026-09-28-testing-structure-and-maestro-plan.md) defines acceptance gates; the [task card](testing-modernization-task-card.md) records progress.

## Current execution

SC-205 focused-return freshness has six passing rendered controls, including
stale request/identity and bulk-completion rejection. Restoring the original
screen in the isolated owner makes the return control fail (one request instead
of two). The actual iOS v4 attempt confirmed the connection durably but failed
the stale active roster; native qualification remains Pending. These component
controls mock the roster adapter and do not prove transport or persistence.

Implemented P0/P1: AST inventory, separate server non-DB/integration commands, owned disposable primary/catalog Postgres, canonical fixtures, real API restart/ownership tests and cancellation/cleanup verification. P2 adds 29 rendered component tests across support, role selection, exercise search and home task themes; each family detects a restored controlled regression. P3/T09 profiles and the real Postgres auth browser matrix are locally verified in their recorded scope. Training is locally verified in all nine browser/locale cells with fresh repeats. See the task card for freshness/receipts and known gaps. Connection approval is locally verified in all nine cells with fresh repeats. Save retry passes two fresh nine-project matrices (144 assertions). All five journeys pass two fresh complete 45-case matrices (90 cases, 702 assertions). Maestro comparison, agent exploration and hosted migration remain pending.

Client Node/tsx checks combine domain logic, architecture policy and source-shape assertions. `yarn test:component` runs Jest/Expo/RNTL only under `tests/component/`; `test:all` runs unit then component suites. Pinned component dependencies are RNTL 14.0.1, test-renderer 1.1.0 and jest-expo 54.0.18; runtime React 19.1/Expo 54 remain unchanged. Client ambient types explicitly include React/React Native/Node/Jest so the sibling Bun workspace's globals do not change fetch mock contracts. Playwright has fixture UI batches and a memory-backed HTTP/session lane (`test:e2e:web:server`); that lane does not prove durable Postgres writes. Detox remains the native engine. Real providers have separate credential-gated lanes.

Checked-in `trusted-selective-tests.yml` handles authorized workflow-run candidates, main pushes, and explicit dispatch, uses web-only selection and universal unit/lint/type checks. It has no schedule. `detox-protected-full.yml` handles manual, published-release, and release/hotfix push validation. This is configuration evidence only. Hosted history/promotion is unverified; D-195 remains open.

## Inventory and curation

`yarn playwright` resolves `@playwright/test/cli` from the client package through
`scripts/testing/playwright-cli.mjs`. This prevents duplicate runner instances
when Yarn chooses a hoisted parent binary but client configs/specs resolve a
local installation; it also works when dependencies are hoisted on CI. Initial
P3 discovery found that mismatch and retained its failing receipts. Successful
discovery is selection evidence only, never browser execution evidence.

`node scripts/testing/inventory-tests.mjs` enumerates client/server test files, AST test labels and assertion expressions/lines, imports/source owners, requirement references, data/platform categories and known reliability hazards. `--check` rejects stale files, additions, deletions, assertion changes or metadata. Stable IDs derive from owner/path; content hashes invalidate review state on change. Source reference absence is an explicit review gap, not fabricated traceability.

Review mixed assertions individually. Keep retired-provider, localization, secret/build and CI-trust prohibitions. Mark UI source-shape assertions for replacement only after a rendered/native/browser assertion fails on a controlled regression and passes cleanly. No test is removed by inventory generation. Counts are static inventory, never pass/behavior coverage.

`docs/qa/component-replacement-ledger-v1.json` records the retired assertion purposes, prior file hashes, replacement IDs and regression receipt location. Web Escape/DOM semantics, shared-pill enforcement, navigation/Detox lifecycle and decorative accessibility checks remain. TC-304.1 simultaneously showing both empty-field errors is an unresolved docs/runtime contradiction; sequential field tests do not claim that case. Component transport is mocked and supplies no durable support-message/native permission/browser-focus proof.

## Target layers and rollout

P3/T09 centralizes artifacts/reports through the shared browser config factory,
with all 17 compatibility aliases and distinct profiles retained. Deep local/CI
config equality and test-selection equality pass; seven fixture browser cases
pass across training and the three-locale professional dashboard. The resolved
config assertion ledger records three detecting controlled regressions. T10/T11
real Postgres browser work remains In progress. T10 has a locally verified
server-owned acquire/release module and private stdio session with isolated
fixtures, API restart and cleanup; the client origin/bypass preflight also passes.
Strict server resource/protocol schemas, the validated Node client bridge and
public receipt V1 validation are also locally verified. Server schemas are
vendored with hash provenance; `node scripts/testing/sync-server-schemas.mjs
--check` detects drift. AJV 8.18.0 is test-only. Integrated config/batch and
strict public attempt receipt producers now execute locally. Owned Expo startup is
also locally verified: isolated reservation, CLI-resolved config, process/listener
ownership, real browser login through the proxy, cancellation and occupied-port
rejection. This smoke is separate from the full T11 auth matrix below. The
owned stable proxy is implemented for account-scoped once-only save faults and
API restart with PID/start identity checks; its explicit local verifier uses two
fresh DB sessions. Aggregate handoff/proxy summaries do not establish browser
behavior.

`yarn test:e2e:web:integration --scenario=auth-session --project=chromium` runs
one requested real Postgres auth case; default selection requests all five
scenarios/nine projects. All five specs are implemented; requested selection and assertions must execute before a combined passing claim.
Auth has seven assertions per cell across desktop Chromium/Firefox/WebKit and
mobile/tablet Chromium browser emulation in all three locales. Freshness and
results live in the task card; no native claim derives from emulation. Private
context/fixtures, resolved Expo config and observed owned proxy requests establish
origin/bypass proof. Worker groups have PID/start/command ownership and bounded
stop. The runner verifier checks rejection, live-worker and acquisition SIGINT/SIGTERM,
and deadline cleanup. Startup acquisition distinguishes not-acquired, validated
cleaned and unknown recovery. Run/owner labels guard bootstrap container/network
recovery; missing or mismatched identity retains its ledger. The task card records
the locally verified scope and fresh receipts.
The inactive `playwright-integration` impact runner needs its selective CI adapter
in T18. T11 private fixed SQL snapshots are locally exercised for scoped plan/connection
state, read-only mode, real mutation observation and persistence after API restart.
Their stdio interface accepts a seeded scope, never arbitrary SQL or caller-selected
DB/UID. Worker/parent controls are wired and explicitly locally verified. Training,
two-context approval and draft-preserving retry have fresh nine-project repeats.
Unrelated denial and every required scenario now pass two combined 45-case
matrices with matching per-attempt input hashes; lifecycle probes also pass.
The inactive auth-atlas project's
registry/profile mismatch is explicitly tracked for P6 reconciliation.

Retain Node logic, Bun server, Playwright browser and provider lanes; add rendered component tests, owned disposable Postgres integration and an explicit Maestro/Detox pilot. All new wrapper receipts distinguish application failure, harness block, cancellation, cleanup and first-attempt result. Fixtures, memory HTTP, Postgres, native and provider results cannot substitute for each other.

P3 complete local matrix evidence and lifecycle receipts are recorded in the
task card; native, exploration and hosted gates remain pending. Execute P0,
P1A/P1B, P2, P3, P4A/P4B, P5, P6/P6B in dependency order. Native migration requires equivalent assertions, at least 19/20 first passes per integrated platform/scenario cell, no leaks/unexplained failures and three protected hosted passes across two revisions. Until those receipts exist, retain Detox. Agent exploration is bounded, observed and advisory; convert confirmed defects to deterministic regressions.

Ignored private `.qa/artifacts/testing-modernization/<run-id>/` stores receipts. Never store tokens/passwords in public JSON/logs. Record exact owner SHAs/dirty state; pending hosted/native/provider acceptance remains pending. No new product behavior or localized strings are introduced by inventory and DB guards.

## Private browser-worker control (T11)

The integration parent owns a Unix socket inside a fresh mode-0700 temporary
directory. The mode-0600 socket and owner record are bound to run, parent PID/start
and selected attempts; per-attempt capabilities live only in the protected context.
Workers may request fixed scoped snapshots or an owned API restart. Save-fault
arming/clearing is limited to the selected save-retry case, its coach identity and
one declared training write. Arbitrary SQL, arbitrary URLs and public HTTP control
endpoints remain forbidden. Strict framing, unique request IDs, request/response
size limits and deadlines apply; no application failure becomes a passing control
response. The parent drains/stops control before proxy/backend cleanup and verifies
its owned socket directory before removal. Missing or changed ownership retains
recovery. Control evidence is separate from UI and persistence assertions.

The training journey reloads the saved library and reopens the plan through its
normal row before comparing exact exercise values and API/SQL state. Traffic must
settle before requesting restart; the proxy's idle guard remains authoritative.
Each owned Expo process uses a fresh private temporary directory beneath its
artifact root. The installed Metro cache uses `os.tmpdir()`; sharing it across
concurrent bundles can substitute another run's inlined API origin. Record its
canonical directory/inode/owner and remove only that cache after owned processes
stop. Changed ownership retains recovery; the browser must still prove its actual
request origin, independently of resolved Expo configuration.
The explicit worker-control receipt verifier changes only its own protected
context capability while its discovery child is live. It must observe one started,
harness-blocked attempt (exit 2, original worker exit 1) and cleaned resources;
the invalid capability must not dispatch a snapshot or become application failure.

## Native-profile save failure control (T12 preparation)

The same owned API proxy exposes `armObservedNativeSaveFault` only to its
in-process caller. It requires native request profile and a completed successful
no-Origin `GET /plans/predefined` through the owned upstream. The observed bearer
stays in memory with its upstream origin/PID; no token getter, secure-storage
read, session injection or public control endpoint exists. Fault setup verifies
the declared account through the owned `/me` route and rechecks API ownership.
It retains the existing exact training POST/PATCH allowlist and single-injection
counter. API restart or proxy stop clears the observation; an external upstream
identity change blocks it. Browser controls retain their existing interface.

The explicit proxy verifier uses real disposable Postgres and normal bearer
sign-in to prove rejection boundaries, unchanged SQL after the injected save,
durable real retry and teardown. These are transport/adapter receipts, not
native-device, draft-retention, error/retry-view or Maestro adoption evidence.
Actual native charters must use this seam and produce their own UI/API/SQL and
cleanup receipts before those gates pass. Changes to this helper require the
affected native capture inputs and evidence freshness to be reassessed.

## Native pilot execution and receipt boundary

### Native initial-load control preparation

The same proxy has a separate in-process `armObservedNativeLoadFault` control.
It requires the current successful native catalog credential, an exact owned
plan in the declared fixed SQL snapshot scope, authenticated account matching,
and the existing idle/upstream ownership checks. It injects one pre-forward
503 only for that exact detail GET and bearer. Query variants and other accounts
cannot consume it; subsequent reads forward normally. Credential invalidation
on API restart/stop remains shared. Browser and save APIs still reject GET
faults. No public fault/reset endpoint or token accessor is introduced.

This is infrastructure preparation for SC-208 initial-load error/retry views.
Real proxy/API/SQL validation is distinct from actual iOS/Android observations,
which remain Pending until their capture and qualification receipts exist.

`yarn test:e2e:native:pilot --platform=ios --engine=maestro --scenario=SCN-save-retry-ios --mode=integration`
uses `run-native-pilot.ts` (recorded substitute for the planned `.mjs`). Strict
canonical selection and prerequisite checks produce an immutable public V1
receipt with real client/server identities. Missing ledger/adapter exits 2
before acquisition; SIGINT/SIGTERM during preflight write cancelled receipts
with 130/143 and no resources acquired. Only the exact integrated iOS/Maestro training selection has an owned action
adapter today. It runs through the shared host lock and requires the complete
runtime UI/API/SQL ledger plus independent cleanup. Candidate success copies
private proof into the requested attempt root, validates hashes/identities/
source freshness and final completion, and records actual input fingerprints
and phase timings. Save-retry and other unsupported selections remain blocked.
The task card records one actual public training pass at its recorded inputs,
early runtime SIGINT/SIGTERM controls and configured bootstrap timeout proof.
Optional `MYCHAMPIONS_NATIVE_BOOTSTATUS_DEADLINE_MS` accepts integer1000–180000
for the supported case, with default180000. Invalid values reject before
acquisition; actual timeout is blocked2 with the exact owned simulator identity
and independently checked partial cleanup. Post-backend lifecycle, explicit
application-failure classification, both-platform/engine equivalence, T15
comparison and CI promotion remain pending. Consult immutable task-card
executions and their input fingerprints before assigning freshness.

## Rendered component CI wiring

Trusted `fast-quality` runs `yarn test:component --ci` after impact validation
and before unit checks. Existing job/status identity, trusted candidate and
exact checkout SHA, permissions, pinned actions and unit/lint/type/diff checks
are preserved. The default command runs all component suites without filtering
or failure suppression. Local execution passes 41 tests; separately controlled
rendered pass/failure probes prove exits 0/1. This is local wiring evidence.
Protected hosted exact-SHA acceptance remains pending; the full quality gate
still fails on the known password-reset confirmation contract gap. No native
CI lane is enabled by this change.

## Independent observed-native training read (T13/T14 binding)

`owned-api-proxy.ts` exposes `readObservedNativeTrainingPlan` to its in-process
caller. Bind the journey controller's `readPlan` callback using its exact
`native-entry-ios` or `native-entry-android` fixture scope, coach UID and saved
plan ID. It accepts no credential or arbitrary URL. The existing successful
no-Origin catalog observation provides an in-memory bearer; scoped read-only
SQL establishes plan/account ownership, `/me` verifies the observed account,
and the fixed authenticated plan GET must return that exact ID. Recheck owned
API origin/PID throughout. Independent reads are kept out of native transport
observations so they cannot stand in for the app's requests.

Only idle, unfaulted controls may read. Concurrent read/restart/fault setup is
rejected; stop aborts an in-flight read. Restart clears the observation, so normal
catalog traffic is required again. Network/body work uses the bounded request
deadline, a 1 MiB body limit and no redirects; scoped snapshots retain the owned
session protocol's separate 30-second deadline. No public control route, secure
storage extraction, injected session or production auth change is introduced.

`node --import tsx scripts/testing/verify-native-training-read.ts` explicitly
acquires two fresh disposable Postgres sessions, one per fixture scope. It
verifies authenticated reads and restart durability, unchanged scoped SQL,
19 rejection/cancellation controls per scope and independent PID/start-time and
Compose cleanup. These HTTP clients are synthetic native-profile traffic, not
Maestro/Detox or native device behavior. Body-limit/invalid-JSON/denial/wrong-ID/
slow-body checks use real HTTP with a synthetic ownership boundary. Actual
engine/platform journey and public runtime bindings remain Pending.

## Public native execution limits

The supported integrated iOS/Maestro training adapter resolves optional strict
build/command/whole bounds before acquisition: 1000–900000, 1000–600000 and
1000–2400000ms, defaulting to their upper limits. Overrides cannot widen existing
shorter command deadlines. Resolved bounds and the timed-out step are private,
attempt-bound evidence; unknown or invalid limits block. The public whole timer
aborts owned work and prevents final success, while bounded finally cleanup
completes independently. Only actual SIGINT/SIGTERM use cancellation130/143;
deadline aborts are blocked2. Cleanup failure takes precedence.

Task-card receipts now prove actual post-backend build and whole deadlines,
SIGINT/SIGTERM and complete owned resource cleanup at recorded inputs. A failed
observer of Xcode's separate group and its graceful SIGTERM recovery remain
retained. Build-boundary controls do not prove active journey cancellation,
application-failure classification, other phases/platforms or hosted gates.

## Public native byte reuse

The supported iOS/Maestro training path may explicitly reuse a retained24-hex
capture through `MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID`. Existing private
entry/source/binary/config/bootstrap qualification must pass before acquisition
and in shared capture. Supplied entry screenshot/tree hashes are enforced even
for full observed captures. Invalid reuse blocks without compilation fallback;
new devices, fixtures, backend, ports and processes remain mandatory.
Record `build.reusedFrom` and actual qualification time, not a fresh build.
Task-card proof reaches actual install/launch and a bounded Maestro entry
deadline with complete cleanup. It proves no ready-screen/journey assertions
or general visual acceptance, and preserves original unreviewed runtime frames.

## Live native ownership and saved-journey cancellation

The existing process owner publishes serialized, complete private0600 atomic
snapshots while commands are live. External observers accept only the owner's
current exact identity and verified parent; a stale command is ineligible.
Keep direct-launcher exec history and unknown/escaped/shared-ADB checks. Failed
publication rejects the query rather than presenting old bytes as fresh evidence.

Separate actual SIGINT/SIGTERM controls now reach normal first Save/reopen and
created SQL/API checkpoints, cancel the verified public runner during its owned
edit-title child, retain130/143 and original child143, and independently prove
full cleanup. They have zero complete journey assertions. Preserve original
blocked/fallback/cleanup failures and source fingerprints; do not treat partial
duration or cancellation as a reliability pass. Task card owns exact evidence.
Application failure, other deadline phases/platforms/engines and adoption gates
remain pending. No Detox retirement follows from these controls.

## Required native assertion failures

The iOS/Maestro training pilot now carries exact required quantity assertions
inside all five existing preview flows. An explicit assertion-false command plus
fresh wrong-value UI evidence is a private candidate. After stable identity and
full independent cleanup, the runner exclusively stages the bytes and may emit
application-failed1 with original child1 and one failed canonical NAT assertion.
Arbitrary engine1, absent controls, transport/device/selection issues, timeouts,
signals and cleanup/finalization failures cannot be promoted to that classification.
See native testability for the precise qualification contract and the task card
for current runtime proof. Clean/mutated/restored controls are separate attempts;
synthetic parser/schema/staging controls are no native result. This adds no provider
coverage, native reliability promotion or Detox retirement.

Actual clean, detecting local rendering regression and exact-source restored
native controls now qualify at their separate task-card identities. Both clean
runs complete the seven UI/API/SQL assertions; failure retains one failed draft
assertion/original child1 and an incomplete journey. All independent cleanups pass.
Keep these lifecycle controls distinct from cold reliability samples, visual/
locale acceptance and cross-platform/engine migration proof. No temporary product
change remains and no Detox scenario is removed.

## Connection persistence readback preparation (2026-10-01)

The connection mutation lane implements an explicit private stdio
`connection-snapshot` request with a separate `connection-snapshot-v1` document.
The existing `snapshot` operation and `domain-snapshot-v1` training contract
remain compatible. Fixed read-only queries observe nine table classes, scoped
by either relationship endpoint to the fixture accounts, and reject more than
200 rows per table. No caller-supplied query, URL, UID or table is permitted.
Profile, specialty and invite projections are fixture-owner-only. Relationship
rows also include selected-connection references, so a foreign endpoint remains
visible as an anomaly for rejection, rather than a valid foreign relation.
Invite values and credential tables are excluded from this projection. Counts
are derived from observed arrays, independently of assertion-ledger counts.

The initially unlinked coach/student pair must submit and confirm through normal
authenticated actions. Pending proof includes the guard, pending specialty field
and occupied slot. Active proof includes the same connection, removed guard,
retained pending row with cleared specialty field, released slot with null
student, and active tracking/specialty grants. Compare non-target projected rows
exactly and preserve other fixture scopes. These snapshots are DB readback;
native UI actions, API evidence and both-engine/platform qualification are
separate pending gates. The seeded-state observer is not a mutation observer.

The relationship baseline is captured after both actors authenticate normally:
sign-in updates profile timestamps and belongs to setup. Keep profile equality
strict during submit/confirm. Transition allowances require exact observed row
IDs and their connection/endpoints/specialty; a reused guard ID with foreign
provenance is rejected. Scoped server integration and the real client stdio
bridge passed on disposable Postgres (see the task card for retained receipts).
This qualifies persistence and transport, with zero new native UI passes.
Failed setup attempts remain immutable and independently cleaned.

## Native connection actor-switch checkpoints (T14-C)

The required single-target native journey uses normal local sign-out/sign-in
between two fixture identities. Server sign-in updates the existing actor's
profile timestamp, so capture explicit pending-after-coach-auth and
active-after-student-auth checkpoints. Compare submit and confirm spans with
strict unchanged profiles and non-target rows. Across a matched forwarded native
`POST /auth/email/sign-in` 201 only that declared fixture actor's `updatedAt`
may advance; every other field/profile and all eight other tables remain equal.
Retain each original snapshot and transport ordinal. Missing or ambiguous
checkpoint evidence blocks the journey. Do not remove timestamp fields, ignore
all profile differences or change the existing three-snapshot verifier's contract.

Reuse the owned iOS capture, protected synthetic fixture flows/screenshots and
hierarchies, normal account-switch and dynamic IDs. Existing index selectors
remain available; an additive connection-ID marker on the existing active End
text makes its ancestry verifiable. Never infer identity from row zero or display
name. Public receipts exclude credentials, invite values and private fixture
bodies. No production/localization behavior change is required.

A 201 sign-in response alone does not prove actor identity. The connection lane
opts into a bounded private principal observer on the existing owned proxy:
extract only `profile.authUid` from the successful sign-in response in memory,
check the fixed fixture UID allowlist and bind it to the transport request ID and
owned upstream identity. Malformed, oversized, foreign or missing identity blocks
checkpoint acceptance. No raw response, token or credential is retained. Other
proxy lanes remain unchanged. This observes existing test traffic; it changes no
production authentication behavior.

Connection assertion qualification also requires native read checkpoints, not
only stdio SQL snapshots: the normal coach invite/home/pending/roster entry, the
initial student relationships read, student pending read, coach pending queue
and roster reads, and final active relationships/roster reads. The pending
student card must show the localized guidance without its End/active marker;
the coach pending roster must contain the exact UID with pending fitness status
and omit it from the active filter before confirmation. Recompute proof bodies
and secret-frame redaction from the frozen ledger before staging any bytes.
Retain immutable fixture provenance privately and compare its hash to the
capture fixture hash; never reconstruct fixture identity from report claims.
Source checks and private proof generation continue to count zero native passes.
