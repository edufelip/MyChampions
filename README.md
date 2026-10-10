# MyChampions App

Expo application for MyChampions on Android, iOS, and responsive browsers.

## Get started

1. Install dependencies

   ```bash
   yarn install
   ```

2. Start the local backend from the workspace root

   ```bash
   cd ..
   bun run local:db:up
   bun dev
   ```

3. Start the app from the Metro window

   `bun dev` now opens a `metro(app)` tmux window for local RN serving.
   In that window, press `i` for iOS or `a` for Android.

   If you need Metro only, you can still run it separately with:

   ```bash
   yarn start
   ```

## Browser development

```bash
yarn web:dev
yarn web:export
yarn test:e2e:web:smoke
yarn test:e2e:web:evidence
yarn test:e2e:web
```

`web:export` creates a single-page artifact in `dist/web`. It does not deploy, publish, or modify infrastructure. Browser platform/auth/subscription contracts and the deferred deployment checklist are documented in `docs/specs/web-platform-support-spec.md`.

Web E2E commands create timestamped, gitignored evidence packages under `.artifacts/web-e2e`, including an HTML report, JSON/JUnit results, screenshots, run metadata, and a generated manual-validation checklist. Batch definitions and the manual review procedure are documented in `docs/test-cases/web-playwright-batches-and-manual-validation.md`; pending release work is tracked in `docs/discovery/web-pending-items-and-future-improvements.md`.

The BL-018 integration lane owns disposable Postgres, the real sibling server and
isolated Expo/proxy ports. Run one auth case with
`yarn test:e2e:web:integration --scenario=auth-session --project=chromium`.
Private artifacts and validated attempt receipts live in
`.qa/artifacts/web-integration/<run-id>/`. Default selection requests all five
scenarios. Both complete 45-case matrices pass locally; current proof and
freshness are tracked in the task card. Native/hosted promotion remains pending.
`yarn tsx scripts/testing/verify-web-integration.ts` checks input rejection,
live-worker cancellation and deadline cleanup. Local proof, remaining journeys
and pending selective CI/native adoption are tracked in
`docs/qa/testing-modernization-task-card.md`.

The public native pilot executes one integrated iOS/Maestro training case:
`yarn test:e2e:native:pilot --platform=ios --engine=maestro --scenario=SCN-training-ios --mode=integration`.
Set `MYCHAMPIONS_NATIVE_STATE_ROOT` to an existing canonical owned directory
with mode0700 for the shared host lock. Each attempt writes an immutable receipt
under `.qa/artifacts/native-pilot-attempts/`. It returns0 only after the complete
UI/API/SQL ledger, current inputs and independent cleanup pass; unsupported
selections remain blocked2. SIGINT/SIGTERM return130/143 with retained receipts.
Optional `MYCHAMPIONS_NATIVE_BOOTSTATUS_DEADLINE_MS` accepts integer1000–180000
for this case; unset keeps180000. Bootstrap timeout returns blocked2. Optional build, command-step and whole-run
bounds use `MYCHAMPIONS_NATIVE_BUILD_DEADLINE_MS`1000–900000,
`MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS`1000–600000 and
`MYCHAMPIONS_NATIVE_WHOLE_DEADLINE_MS`1000–2400000. Defaults are the upper
bounds; an override cannot widen a shorter declared command. Timeout aborts
owned work and returns blocked2 after independently checked teardown.
Optional `MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID` reuses only qualified immutable
bytes from a private retained24-hex capture. It validates current app source,
binary/config/bootstrap and reviewed entry before acquisition; new device,
fixture/backend, ports and processes are still required. Invalid reuse blocks
without a compile fallback. The task card records bounded local proof and pending lifecycle/platform/
engine/reliability/hosted gates.

For native development builds, use:

```bash
yarn ios:dev
yarn android:dev
```

## Local server config

The mobile app uses the root-level MyChampions server for local auth and app-domain data flows. Mobile runtime code does not require mobile-owned provider project keys, document rules, callable backend functions, or native provider config files.

Copy `.env.example` to `.env` and set:

```bash
EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://localhost:3400
```

iOS Simulator can use `localhost`. Physical devices need this Mac's LAN IP.

Production release workflows require the `ENV_FILE` secret to set:

```bash
EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=https://api.mychampions.eduwaldo.com
```

Both iOS and Android release workflows fail before building when this value is
missing or different, preventing a production bundle from shipping with the
local development endpoint.

Development Firebase distribution workflows run after each `develop` push (so a
merged pull request triggers them) and can also be started manually. They build
only `MyChampions Dev` and reject a missing or production API URL; configure the
non-production `ENV_FILE` target, Firebase App IDs/service account, `base-group`
tester group, and iOS Ad Hoc signing assets before their first live run.

## Testing

1. Unit tests

   ```bash
   yarn test:unit
   ```

   Rendered component checks use `yarn test:component`; `yarn test:all` runs both
   unit and component suites. Component checks exercise real UI state/handlers
   with native adapters and external transport mocked. They do not replace
   browser, native-device or database integration evidence. See
   [testing strategy](docs/qa/testing-strategy-v1.md) for the phased rollout and
   recorded baseline gaps.

2. Native E2E (Maestro)

   The native suite lives in `.maestro/suite/<spec>/`; each flow is tagged with
   the fixture phase it runs under (`scripts/ci/native-fixture-profiles.ts`).
   The runner builds the Debug app once (the Metro port is compiled in),
   installs it, then starts a fresh Metro per fixture phase and runs the flows
   tagged for it. The scripts install their pinned [Maestro CLI](https://maestro.dev)
   (2.10.0, `scripts/testing/install-maestro.sh`) into
   `~/.cache/mychampions/maestro/` on first use, separate from the native
   pilot's `~/.maestro` (2.6.1). iOS runs on a dedicated English simulator
   (created on first run as `MyChampions Maestro` from an `iPhone 17`,
   overridable with `MAESTRO_IOS_SIMULATOR` / `MAESTRO_IOS_DEVICE_TYPE`; device
   prep also turns off password AutoFill, which clears typed passwords); Android
   on one device (`ANDROID_SERIAL` when several are attached).

   ```bash
   yarn test:e2e:ios                 # every CI Maestro suite on iOS
   yarn test:e2e:android             # every CI Maestro suite on Android
   yarn test:e2e:ios:smoke           # auth + connection suites (the iOS PR smoke)
   bash scripts/testing/run-maestro-suite.sh --platform ios maestro:nutrition
   ```

   `NATIVE_SKIP_BUILD=true` reuses an existing build; `NATIVE_METRO_PORT` picks
   the Metro port for both the build and the run. A failing phase is retried
   once and the retry is reported. Diagnostics land under
   `.artifacts/ci-diagnostics/<platform>/`.

   The five integrated journeys (session, training, connection, camera denial,
   save/retry against the real server) run through the native pilot:
   `yarn test:e2e:native:pilot --platform=<ios|android> --engine=maestro --scenario=SCN-<journey>-<platform> --mode=integration`.

3. RevenueCat Test Store lifecycle (explicit live-provider run only)

   This command is intentionally separate from the fixture suite. It accepts only a
   RevenueCat `test_*` public SDK key, forces the dev app variant, clears every
   deterministic entitlement override, and generates an isolated App User ID.
   Never use a Test Store key in a release build. Provider/catalog changes and
   live subscription transactions require the project approval gate.

   ```bash
   REVENUECAT_LIVE_E2E=true \
   EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE=... \
   yarn test:e2e:ios:revenuecat-live
   ```

   Set `REVENUECAT_TEST_APP_USER_ID` to a safe explicit ID when the run must be
   allowlisted or correlated with dashboard/webhook evidence. Set
   `REVENUECAT_LIVE_MONITOR_EXPIRATION=true` only for the additional
   approximately 30-minute Test Store renewal/expiration observation.
   RevenueCat Test Store does not perform a real platform restore; that step
   validates retained customer state and a non-destructive restore call. A true
   restore must still be evidenced separately with App Store or Google Play
   sandbox credentials.

   After the canonical reconciler and server-only key are deployed, set
   `REVENUECAT_VERIFY_SERVER_EVIDENCE=true` to make the runner also verify both
   isolated customers against RevenueCat's canonical subscriber API and the
   production `subscription_entitlement_snapshots` row over the read-only
   `digiocean` evidence boundary. Because production rejects client-authored
   snapshots, convergence for a unique run UID proves the webhook reconciliation
   path persisted the provider state.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
