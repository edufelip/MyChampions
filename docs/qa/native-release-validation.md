# Protected native release validation

`detox-protected-full.yml` is the explicit full iOS/Android native validation
lane. It runs only from `main` on manual dispatch or from a published GitHub
release; it does not run on pull requests and it has no nightly schedule.

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
`DETOX_SKIP_BUILD=true`. The provider-live RevenueCat suite is intentionally
excluded; it has its own credential-gated lane.

Failure diagnostics are uploaded only on failure and retained for one day.
There is no unattended nightly claim until runner cleanup, duration, and
reliability evidence establishes a service-level objective.
