# Native pilot declaration contract

This is the stable contract input for the portable native-pilot declaration.
It describes the native states and testability rules that determine the
declared views, transitions, selectors, and ownership boundaries. It contains
no execution result, receipt, timestamp, runtime diagnosis, or promotion
status.

The operational ledger in `testability.md` records source progress, native
attempts, cleanup, failures, and historical evidence. Changes to that ledger
alone must not invalidate this declaration. A change to this contract, a
governing requirement, a selector or assertion implementation, a fixture or
reset rule, a runner, an ownership helper, or a cleanup boundary must change
the declaration inputs and require regeneration before a selection or receipt
can be accepted.

## Declaration boundary

The declaration covers the five BL-018 pilot families (`session`, `training`,
`connection`, `camera-denied`, and `save-retry`) on iOS and Android with the
declared Maestro engine cells and `fixture`/`integration` modes (Detox cells were retired on 2026-10-09). The
portable inventory is a source and requirement graph. It does not import
runtime passing evidence, convert a blocked attempt into a pass, or remove an
unavailable cell from a denominator.

Every selected cell binds its platform, engine, scenario, data mode, fixture
reference, requirement references, owner paths, source revisions, and exact
assertion ledger. The selected target must be the owned device/emulator and
current build/API identity recorded by the attempt. Platform, engine, fixture,
reset, network, process, and cleanup ownership remain explicit inputs.

Use semantic accessibility or test-ID selectors observed on the current
hierarchy. Do not use coordinates, positional indexes, arbitrary sleeps,
optional core assertions, broad skips, or retry-until-green behavior to make a
cell pass. OS permission and credential prompts use their documented native
controls and require an explicit postcondition before the app assertions
continue.

## iOS credential-save prompt

`STATE-password-save` and its offer/decline transitions are iOS-only. The
branch starts after a normal seeded-coach sign-in on a fresh simulator where
the system credential-save prompt is expected. The declaration requires the
actual prompt hierarchy, one enabled semantic Not Now control, a bounded
animation-settling command, the exact dismissal action, and a prompt-absent
postcondition before the existing professional-home assertions.

Any bounded retry is limited to the prompt dismissal action when the pinned
runner contract permits it. It cannot resubmit sign-in, rerun the scenario,
skip the absence assertion, or replace the system control with a coordinate or
index fallback. Prompt screenshots, hierarchy values, command output, and
credentials remain private evidence and never alter the portable declaration.

## Native title text selection

The title-edit branch remains platform-specific while sharing the same exact
empty-title and replacement assertions.

- iOS uses the current native text hierarchy and the documented paragraph
  selection gesture to select the complete editable title, sends one backspace,
  requires the entire field to be empty, and then requires the exact
  replacement value. The native menu alternative remains a separate branch and
  cannot be silently substituted.
- Android long-presses the actual title field. If `Select all` is hidden and
  the OS `android:id/overflow` button is visible, the flow opens that exact
  semantic button before checking visibility again. It then requires one unique
  enabled native `Select all` action, the original cleared-title instrument log,
  and the exact replacement value. The cleared-title proof must retain the
  matching capture step/raw hierarchy and signed installed auxiliary-reader
  bytes; hint equality or a generated observation is insufficient.

Neither platform may use a success toast, partial visual clipping, storage
injection, coordinate/index fallback, optional title assertion, or a longer
fallback deadline in place of the required observations. A failed menu capture
remains a failed or unqualified branch.

## Session domain snapshots

`NAT-session-unrelated-state` must observe profile rows as well as plans,
connections and every table in the declared owned connection/profile SQL
projection. A plans/connections-only snapshot cannot satisfy this assertion.
Retain owned snapshots before initial sign-in, after sign-in, after restored
hydration, and after signed-out relaunch, with their run/scope, actual private
bytes and file hashes.

The server's normal `POST /auth/email/sign-in` and restored
`POST /me/hydrate` call `upsertFromSession`. Only the same verified fixture
coach's profile `updatedAt` may advance within those two separately bounded
request spans. Require successful native forwarding (201 for sign-in, 200 for
hydration), matching backend/API identity and fixture coach identity. The
value may remain identical or advance; it cannot regress or change encoding
without advancing. Every other field of that coach, every other profile and
all other projected rows must remain identical. From the post-restoration
snapshot through cancel, confirmed local sign-out and signed-out relaunch,
the entire declared projection, including all profile timestamps, must remain
identical. Auth-session records remain outside this domain projection.

This exception describes existing server behavior; it does not authorize
changes to auth, profile persistence, domain rows or server revocation. Missing
profile observations, missing intermediate snapshots or unbound auth/hydrate
spans block qualification.

## Session sign-out transport

The stopped proxy stream is checked in two adjoining windows once the session
ends. The sign-out window runs from a fence taken just before the sign-out
confirmation tap to the fence taken before the signed-out relaunch; the
signed-out relaunch window runs from there to the end of the stream. On Android
the sign-out window starts exactly where the last signed-in relaunch window
ends, so no request goes unchecked. In both windows every request must be a
forwarded native request to the owned API with no credentials:
`requestCredentialPresent` is `false` and, when the proxy recorded the header
shape, there is no Authorization or Cookie header at all (so
`knownAccessCookie` and `knownRefreshCookie` are `absent`). Neither window may
contain a sign-in or a hydrate. The one exception is a single server sign-out
request (`POST /auth/session/sign-out`) in the sign-out window, which may still
carry the session it ends; native sign-out is local, so native runs normally
send none. Captures record the window (`androidSessionSignOutTransport`; iOS
`signOutTransport` and `signOutTransportRange`), and the public dependency
check re-derives it from the stopped stream. Android also binds it into the
last charter assertion's source receipts.

## Freshness and ownership

`generate-native-declaration.py` hashes this contract together with the named
requirement files, app/source modules, runner/adapter files, and owned
fixture/device/API/cleanup helpers. Its platform closure must include every
local helper imported by the native capture and journey entry points. The
selection contract re-reads those canonical paths and rejects a stale
declaration before any runtime acquisition or evidence read.

The finished `docs/qa/native-pilot/inventory.json` never receives a source revision row containing its own byte hash; that would make the generated revision recursive.

Operational status, attempt chronology, cleanup receipts, failure diagnoses,
and native/public qualification remain in `testability.md` and private
`.qa/artifacts/` packets. They are evidence records, not declaration inputs.

## Explicit credential-entry diagnostic charter (2026-10-03)

The private iOS capture CLI adds `--charter=credential-entry-diagnostic` for the existing owned three-stage email diagnostic and password-only continuation. It must enter the authenticated prelude, preserve separate entry/after-tap/after-input evidence, prohibit diagnostic retries/coordinates/optional assertions, and continue only after exact captured email verification. A failed or unavailable diagnostic blocks continuation. The default `entry` charter remains a sign-in snapshot and must not enter credentials. This QA charter is not one of the five public pilot families and creates no pilot assertion pass by itself. Root verified that the previous nested `entry` diagnostic condition was unreachable under the outer authenticated charter allowlist; the old source controls did not prove that route. Runtime qualification of this explicit route remains Pending until a fresh owned attempt and independent cleanup.

The explicit credential diagnostic stops after verified normal sign-in and the coach-home observation. Account navigation, sign-out and relaunch belong to their own charters; successful diagnostic routing must not fall through into the generic account journey.

Initial iOS simulator app launch uses the owned command executor with the existing 30-second requested deadline. Its private command record retains exit, signal, timeout and process cleanup evidence before capture can advance to entry. Launch failure blocks the diagnostic; this change adds no retry and does not establish the cause of earlier launch failures. Other startup operations retain their existing execution paths.

Android camera staging registers each published file before any later assertion or cancellation can fail. Failed staging retains output-root-relative recovery references. Rollback and recovery-ledger rereads each have an independent five-second cancellation budget. These source repairs do not qualify a native result; final runner recovery paths must also resolve canonically within the current output directory.

## Early blocked receipt repository evidence

Preflight failure or cancellation must still produce a schema-valid receipt when publication is possible. Repository evidence is `observed` when actual identities were read, `partial` when actual identities exist but named repositories remain unavailable, or `unknown` when no identities were obtained. Partial and unknown evidence are permitted only for blocked or cancelled results and require explicit missing names and a reason. Ordinary and passing results retain their repository-identity requirement. Identity collection must respect current cancellation and the remaining publication budget; it must not invent identities or leave an unobserved hashing task behind. Source implementation is In progress pending composed runner validation.

Schema v1 preserves valid historical receipts that omit `repositoryEvidence` and already contain repository identities. New preflight writers must always publish the explicit evidence status, missing names and reason, using actual bounded producer results. This compatibility rule does not allow missing repository rows in ordinary or passing results, and does not repair invalid historical receipts. Caller-supplied fabricated identity rows cannot establish observed evidence.

## Successful commands without diagnostic output

An owned command may finish successfully without emitting diagnostic bytes. After its bounded wait succeeds with exit zero and no signal, output/census failure or cleanup failure, the command controller writes `owned-command: no diagnostic output` into an otherwise empty private diagnostic log. With split stdout capture, the separate stdout bytes remain unchanged, including binary output and the OS-locale result. Combined stdout/stderr logs retain all original emitted bytes. Failed, cancelled, deadline and unverified-cleanup command logs do not gain this success record. The connection verifier continues to require canonical owned regular single-link `0600` non-empty command logs and bound ownership records; a marker alone establishes no journey assertion or public pass.

Owned native Expo sessions enable the existing development-only `EXPO_PUBLIC_E2E_SUPPRESS_LOGBOX` switch so warning overlays do not intercept normal Maestro actions. Raw runner diagnostics remain captured; this does not alter the semantic selectors, navigation, expected screen visibility or production logging policy. Web session environment behavior is unchanged. A passing Debug test does not establish bundled-release or device qualification.

## Native logout owner decision (2026-10-03, 18:58 UTC)

The owner instructed: “Only clear on device ! Now go ahead with the next steps,
you’re owning that now! Go ahead”. D-219 / BL-018 therefore selects the existing
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
