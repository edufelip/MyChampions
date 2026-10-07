# Native pilot cases

The platform IDs are `SCN-<family>-ios` and `SCN-<family>-android`; flow IDs are
`FLW-<family>`. These are plan-local scenarios, not replacement product TC IDs.
Read the linked screen/UC/rule before assertions. Every case uses a fresh
owned attempt fixture, normal app actions, declared locale and disabled
operation-under-test bypasses. Maestro and Detox must prove the same assertions.

For the fresh English iOS inventory target, observe the native credential-save
offer after sign-in and decline `Not Now` before asserting the app's home state.
The required system-prompt setup is mapped separately and cannot hide a failed
login, bypass restoration or count as a core family pass. Other OS locales/target
settings require their own established prompt selectors and reset conditions.

Connection setup sequencing correction is **In progress**. Its iOS sign-in
boundary must observe the exact system prompt, retain a real private screenshot,
decline the exact enabled Not Now control and require prompt absence plus the
expected role home within one Maestro flow. Preserve bound completed command
evidence for that order, normal native sign-in identity and a real post-dismissal
home hierarchy/screenshot. A screenshot/command setup witness has no invented
pre-dismissal hierarchy and cannot qualify the inventory's accessibility-tree
coverage. The inventory charter retains its separate actual prompt-tree capture.

The system setup witness is a mandatory private precondition for every iOS
connection sign-in boundary. It does not become an eighth assertion or replace
any of the seven connection UI/API/SQL purposes. Android has no iOS modal
requirement. Missing, failed, stale or mismatched setup evidence blocks staging;
old failed attempts cannot acquire a new witness retroactively. No production
authentication, UI copy, fixture bypass, selector fallback or retry-until-green
change is part of this correction. Fresh native qualification remains Pending.

## Session and camera source contracts (2026-10-01)

The source-only T14-A/T14-D packet now declares identical ordered ledgers for
both platforms and both engines. Session IDs are
`NAT-session-login`, `NAT-session-restore`, `NAT-session-account`,
`NAT-session-signout`, `NAT-session-signed-out-relaunch` and
`NAT-session-unrelated-state`. Camera-denial IDs are
`NAT-camera-normal-entry`, `NAT-camera-denial-guidance`,
`NAT-camera-manual-submit` and `NAT-camera-unrelated-state`.

### Session profile and domain verification

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

The session contract proves local native restoration and clearing under
`FR-270`/`BR-342`; it does not claim server revocation. The camera contract
requires actual platform denial, usable manual entry, and one integrated
manual submission with UI/API/SQL evidence. Contracts and inventory controls
are **Done (source)**. iOS/Android adapters, public dispatch, Maestro/Detox
execution, target qualification and runtime evidence remain **Pending**.

| Family        | Requirement scope                                      | Steps and required observations                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session       | SC-217, SC-213, TC-296, plan P4 session                | Normal coach login reaches the correct role; terminate/relaunch restores it; open Account, open and cancel the sign-out confirmation, reopen it and confirm sign out; relaunch remains signed out. Record actual auth/session outcomes. This does not claim TC-295's unlocked onboarding branch.                                                                                  |
| Training      | SC-208, TC-278, TC-303, plan P4 training               | Create a named session; choose the exact local catalog exercise; enter exact quantity/notes; draft produces no write; save and independently verify API/SQL; edit and verify exact final values after relaunch. TC-270 assigned-copy independence remains a separate native branch; server coverage is retained.                                                                  |
| Connection    | SC-211, UC-002.3, AC-214, BR-230                       | Coach exposes a live specialty code; student submits through UI; both states remain pending; coach logs in and confirms the exact student; student logs back in and sees active status. API and SQL agree and one durable row exists. Seeding cannot perform the approval.                                                                                                        |
| Camera denied | SC-211, UC-002.9 alternate flow, plan P4 camera denial | Reset camera permission on the owned target; trigger the OS request; deny using the platform control; verify permission and inline guidance; submit the coach code manually and prove pending connection through API/SQL. QR success and camera-less fallback are distinct branches.                                                                                              |
| Save retry    | SC-208, TC-303, plan P4 save retry                     | Enter session/exercise/quantity/notes; arm one private account-specific pre-forward write failure after setup; save and observe existing error feedback with all fields retained and no SQL mutation; clear exactly one injection; retry normally; verify one final complete change and relaunch persistence. TC-304 describes unsaved-back behavior, not save-retry correctness. |

This declaration supplies no runtime pass evidence. The task card records
qualified attempts, original failures and remaining platform/engine gates.
Testability/selector remediation precedes Maestro YAML.
Run 20 cold attempts per promoted engine/platform/scenario/mode cell after
smoke/debug qualification; preserve first failures and both engine receipts.
Five families × two platforms × two engines × 20 attempts is at least 400
attempts before extra branches/locales. The 19/20 threshold, controlled
regressions, zero unexplained failures/leaks and later protected hosted gates
remain mandatory. No Detox deletion is authorized by a local pilot pass.

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
