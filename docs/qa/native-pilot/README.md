# Native pilot declaration (BL-018 / T12–T15)

This directory declares five pilot families on iOS and Android. It contains no
portable passing evidence. The [task card](../testing-modernization-task-card.md)
owns progress; the [plan](../../plans/2026-09-28-testing-structure-and-maestro-plan.md)
owns acceptance and promotion thresholds.

The declaration has 23 candidate views, 40 transitions and ten
platform scenarios, including the iOS credential-save setup prompt. Portable
view rows remain source-discovered or unverified; all ten scenarios are
untested with unknown freshness and need runtime testability qualification.
View capture is 0/23; transition capture is 0/40; all-scenario disposition is
0/10 passing. Testable behavioral coverage is n/a because no native cell is
qualified as ready. Report platform-specific capture and scenario results;
one iOS observation cannot qualify Android. Platform denominators are 23 views
and 40 transitions on iOS, 22 views and 38 transitions on Android.

Training and save-retry declare shared assertion purposes across platforms.
Save-retry's five assertions have public Maestro adapters on iOS and Android,
and the task card records local passing save-retry runs on both platforms
(its 2026-10-07 section). Equivalent Detox evidence is no longer required:
Detox was retired on 2026-10-09. This portable source graph imports no runtime
passes.

`generate-native-declaration.py` regenerates this portable declaration from the
named source graph. It deliberately produces no runtime receipts or tested
status. It also generates [source flowcharts](flowcharts.md), including recovery
candidates and the five core paths. Never point it at a runtime observation bundle. Run
`node scripts/testing/validate-native-inventory.mjs` to check the schema, graph,
paths, required cells and evidence constraints. The copied upstream schema,
manifest generator and freshness helper are under
`scripts/testing/vendor/app-flow-maestro/`, with SHA-256 provenance. They need
no local skill installation. Do not format copied upstream files independently
of their provenance.

Generate the execution index with:

```sh
python3 scripts/testing/vendor/app-flow-maestro/generate_maestro_manifest.py docs/qa/native-pilot/inventory.json
```

The checked-in `maestro-manifest.json` is regenerated from `inventory.json`
with that command. It contains the checked-in Android camera route only as a
selectable declaration. The owned Android camera callback loads that exact
`.maestro/flows/camera-denied-android.yaml` source, binds its hash and
`owned-postgres:SCN-camera-denied-android:fresh-attempt` fixture to the selected
scenario, records the actual fixture reference/run/scope in the private capture
report after acquisition, substitutes the concrete PermissionController resource
IDs discovered from the live hierarchy, and injects the live invite only into
the owned Maestro child environment. The route still remains `behaviorStatus=untested`
and `freshness=unknown` until a fresh public runner receipt proves the same
source, target, fixture, assertions and cleanup. The protected V39 receipt is
private runtime evidence and is not copied into this portable index. Regenerate
the manifest instead of editing it by hand.

Before any native acquisition, the callback reads the selected route through a
bounded no-follow descriptor reader. It preserves the caller's absolute
monotonic deadline, rejects expired or cancelled reads, caps route bytes,
requires a user-owned single-link regular file and canonical user-owned
ancestors, and compares descriptor/path/ancestor identities before and after
the read. The selected scenario carries the declared route SHA-256; bytes that
do not match that revision fail before YAML parsing or native work.

Runtime inventories, screenshots, accessibility trees, build identities and
attempt receipts belong in ignored private `.qa/artifacts/native-pilot/` bundles.
Refresh their fingerprints with the vendored freshness helper before reuse.
Do not store passwords, tokens or sensitive hierarchy values here.

Native runs use dev/test binaries and owned Postgres. Fixture-only runs remain
separately labelled. Detox was retired on 2026-10-09 under the 2026-10-07
owner bar (a real passing Maestro run on each platform plus a planted bug the
flow catches; the task card records the runs and which platforms the planted
bugs ran on); the Detox comparison was dropped. This declaration and
entry-screen captures still grant no runtime pass.

The Android pilot entry points run the pinned Maestro 2.6.1 binary from
`MAESTRO_PILOT_BIN` (default `~/.maestro/bin/maestro`). Keep the file name
`maestro`: driver-readiness sampling and retry only apply to a command with that
name. They read the Android SDK from `ANDROID_SDK_ROOT`, then `ANDROID_HOME`,
then `~/Library/Android/sdk`, and Gradle home from `GRADLE_USER_HOME` (default
`~/.gradle`).

The task card links a historical private qualified auth/account observation: five iOS
views have validated screenshots/actual trees and clean resource receipts. This
is 5/21 iOS view capture at that bundle's recorded declaration edition, with 0/20 Android views, zero
captured transitions and zero behavioral passes. This portable declaration
intentionally remains 0/23 and untested; private target evidence is not imported
as universally current coverage. See [testability](testability.md) for qualification
inputs and the `node --import tsx scripts/testing/qualify-native-views.ts` command.
