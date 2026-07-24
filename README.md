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

## Testing

1. Unit tests

   ```bash
   yarn test:unit
   ```

2. E2E (Detox) iOS

   ```bash
   yarn test:e2e:build:ios
   yarn test:e2e:ios
   ```

3. E2E (Detox) Android

   ```bash
   yarn test:e2e:build:android
   yarn test:e2e:android
   ```

4. E2E debug variants (optional)

   The iOS Debug test commands start Metro on port `8081` when it is not already running, and leave a pre-existing Metro process alone.
   The `test:e2e:ios:debug:smoke` command runs unauthenticated auth-entry and authenticated role/connection checks in separate Debug builds so their fixture states cannot conflict. The authenticated connection mode uses deterministic invite, QR, and active-nutrition fixtures without backend mutation.

   ```bash
   yarn test:e2e:build:ios:debug
   yarn test:e2e:ios:debug
   yarn test:e2e:build:android:debug
   yarn test:e2e:android:debug
   ```

5. RevenueCat Test Store lifecycle (explicit live-provider run only)

   This command is intentionally separate from fixture Detox. It accepts only a
   RevenueCat `test_*` public SDK key, forces the dev app variant, clears every
   deterministic entitlement override, and generates an isolated App User ID.
   Never use a Test Store key in a release build. Provider/catalog changes and
   live subscription transactions require the project approval gate.

   ```bash
   REVENUECAT_LIVE_E2E=true \
   EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE=... \
   yarn test:e2e:ios:debug:revenuecat-live
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
