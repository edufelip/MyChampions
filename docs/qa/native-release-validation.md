# Protected native release validation

`native-protected-full.yml` is the explicit full iOS/Android native validation
lane (Maestro). It runs on manual dispatch from `main`, on a published GitHub
release, and on pushes to `release/**` and `hotfix/**` branches; it does not run
on pull requests and it has no nightly schedule.

Configure `MYCHAMPIONS_ENABLE_IOS_TESTS` under **Settings → Secrets and
variables → Actions → Variables**. Its exact value `false` skips new iOS
validation in this test-only workflow, including the published-release and
`release/**` / `hotfix/**` push triggers, while Android remains enabled. Unset
or `true` keeps iOS enabled, and changing the variable does not cancel a run
already in progress. The credentialed
`ios-release.yml` distribution workflow is not controlled by this toggle.

The lane uses the existing self-hosted labels and runner-side host-lock/cleanup
hooks, separate iOS and Android Metro ports, the checked-in fixture profiles,
and exact `github.sha` checkout. Each platform requires an existing,
non-symlink `MYCHAMPIONS_NATIVE_STATE_ROOT` with mode `0700`, creates a mode
`0600` `mychampions-native-host.lock`, and holds an exclusive `fcntl` lock for
the build and test process. This workflow-local lock is an explicit recovery
preflight; it is not evidence that every other runner or legacy hook already
uses the same ledger.

Each platform builds its Debug app once, then executes the deterministic suite
set supplied through `SELECTED_SUITES_JSON` with
`NATIVE_SKIP_BUILD=true`. Both lanes install the suite's pinned Maestro CLI
(2.10.0, `scripts/testing/install-maestro.sh`, kept apart from the native
pilot's 2.6.1); the Android lane targets the runner's
kept-alive `emulator-5554` through `ANDROID_SERIAL`. The provider-live RevenueCat suite is intentionally
excluded; it has its own credential-gated lane.

The suite's text assertions are English, so both lanes run in en-US. iOS device
prep pins its dedicated simulator to `en_US`. Android device prep
(`scripts/testing/maestro-device.sh`) fails before installing unless the
emulator (the runner's `Pixel_10` AVD) is API 33+ and its system language
(`persist.sys.locale`, else `ro.product.locale`) is `en-US`. After installing, it
pins `com.edufelip.mychampions.dev` to en-US with
`cmd locale set-app-locales … --user current --locales en-US` and fails unless
`cmd locale get-app-locales` reports `[en-US]`. That per-app pin does not replace
the system-language requirement: every flow starts with `launchApp: clearState`,
which runs `pm clear` on Android, and clearing app data also deletes the
per-app language. The app then follows the system language again.
Keep the runner's AVD in English (United States).

Failure diagnostics are uploaded only on failure and retained for one day.
There is no unattended nightly claim until runner cleanup, duration, and
reliability evidence establishes a service-level objective.
