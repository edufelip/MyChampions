---
name: CI/CD Setup Checklist
about: Configure and validate selective CI runners, secrets, and signing assets.
title: "chore(ci): configure runners, secrets, and exact-head CI evidence"
labels: ["ci", "infra"]
assignees: []
---

## Goal
Configure the repository-scoped CI prerequisites and collect remote evidence for
the authoritative feature-selective gate and the separately approved release
workflows. Leave every item unchecked until its evidence is attached.

## References
- Secrets and runner source of truth:
  `docs/discovery/ci-secrets-matrix-v1.md`
- Selective execution contract:
  `docs/test-cases/selective-feature-test-execution.md`
- Authoritative gate:
  `.github/workflows/pr-selective-tests.yml`
- Manual-only legacy validation:
  `.github/workflows/android-pr.yml`,
  `.github/workflows/ios-pr.yml`, and
  `.github/workflows/web-pr.yml`
- Release workflows:
  `.github/workflows/android-release.yml` and
  `.github/workflows/ios-release.yml`

## Workflow Responsibilities
- [ ] Confirm `pr-selective-tests.yml` is the required exact-head PR gate for
      `main` after its full promotion matrix is green.
- [ ] Confirm the Android, iOS, and web legacy PR-named workflows expose only
      `workflow_dispatch` and remain optional/manual validation paths.
- [ ] Keep release signing/distribution separate from PR validation and require
      explicit approval before any store-upload run.

## Runner Setup

### Mac iOS lane
- [ ] Register a repository-scoped runner with exact labels
      `self-hosted,macOS,ARM64,mychampions-ci,mychampions-ios`.
- [ ] Verify Xcode 26 and iOS SDK 26+, an `iPhone 17` simulator, CocoaPods, and
      the expected Homebrew path.
- [ ] Install the runner as a persistent service and record service-status
      evidence without exposing its registration token.
- [ ] Configure and prove the Mac host-wide lock shared with the Meer iOS
      runner service.

### WSL web and Android lanes
- [ ] Register one repository-scoped runner with the combined labels
      `self-hosted,Linux,X64,mychampions-ci,mychampions-web,mychampions-android`;
      the web and Android jobs intentionally select capability subsets of this
      same runner.
- [ ] Verify Playwright browser/system dependencies and `unzip` for the pinned
      Bun bootstrap used by server-backed web suites.
- [ ] On an unprivileged Ubuntu/WSL host, verify the pinned Playwright `1.61.1`
      WebKit `2311` user-library directory, MyChampions-only browser cache,
      inherited `LD_LIBRARY_PATH`, and patched MiniBrowser launchers with a
      service-context WebKit launch probe.
      Scope `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1` to the selected web
      job because Playwright's `ldconfig` check cannot see user-local
      `LD_LIBRARY_PATH` libraries; do not disable host validation globally, and
      require the selected browser suites themselves to prove runtime launch.
- [ ] Verify Android SDK/platform tools, hardware acceleration, and the
      `Pixel_10` AVD for Android. Confirm the persistent runner listener itself
      has the effective `kvm` group and that a service-context
      `emulator -accel-check` reports KVM usable.
- [ ] Install the runner as a persistent service and record service-status
      evidence without exposing registration tokens.
- [ ] Configure and prove the host-wide lock shared with Meer so only one runner
      service can consume the WSL emulator host at a time.

## Secret Setup

### Selective and manual native validation
- [ ] `ENV_FILE` contains the approved dev values needed by selected iOS and
      Android fixture profiles.

### Android release
- [ ] `ANDROID_KEYSTORE_BASE64`
- [ ] `ANDROID_KEYSTORE_PASSWORD`
- [ ] `ANDROID_KEY_ALIAS`
- [ ] `ANDROID_KEY_ALIAS_PASSWORD`
- [ ] `PLAY_SERVICE_ACCOUNT_JSON`

### iOS release/TestFlight
- [ ] `IOS_KEYCHAIN_PASSWORD`
- [ ] `IOS_DIST_CERT_P12_BASE64`
- [ ] `IOS_DIST_CERT_PASSWORD`
- [ ] `IOS_PROFILE_BASE64`
- [ ] `IOS_PROFILE_NAME`
- [ ] `IOS_TEAM_ID`
- [ ] `APP_STORE_CONNECT_API_KEY_ID`
- [ ] `APP_STORE_CONNECT_API_KEY_ISSUER_ID`
- [ ] `APP_STORE_CONNECT_API_KEY_CONTENT`

## Selective Gate Validation
- [ ] Run the promotion head with complete selection and record the exact head
      SHA.
- [ ] Confirm impact resolution, unit tests, lint, typecheck, and diff check
      pass on that exact head.
- [ ] Confirm every selected web, iOS, and Android lane runs on its intended
      labels and passes; a selected skipped lane must fail the stable gate.
- [ ] Confirm shared, native, workflow/tooling, unknown, invalid, scheduled,
      merge-queue, release/hotfix, `ci:full`, and `CI_FORCE_FULL=true` inputs
      broaden to the complete applicable matrix.
- [ ] Confirm a successful selective run has no uploaded impact report, web
      export, app, APK, or test artifact.
- [ ] Confirm the repository has no GitHub Actions cache created by the run.
- [ ] If a real failure produced diagnostics, confirm only the bounded
      `.artifacts/ci-diagnostics/<platform>` path was uploaded and
      `retention-days` is `1`.

## Manual Legacy Validation
- [ ] `android-pr.yml` starts and reaches its Android validation commands when
      manually dispatched.
- [ ] `ios-pr.yml` starts and reaches its iOS validation commands when manually
      dispatched.
- [ ] `web-pr.yml` starts and reaches its web validation commands when manually
      dispatched.
- [ ] Any Android manual failure report is failure-only and retained for one
      day; successful manual validation uploads no APK.

## Release Validation
- [ ] Android release validation is explicitly approved before execution.
- [ ] `android-release.yml` builds the signed AAB and reaches the approved Play
      upload step.
- [ ] The uploaded AAB Actions artifact has one-day retention.
- [ ] iOS release validation is explicitly approved before execution.
- [ ] `ios-release.yml` archives/exports the IPA and reaches the approved
      TestFlight upload step.
- [ ] The uploaded IPA Actions artifact has one-day retention.

## Evidence
- [ ] Attach the authoritative run URL, exact head SHA, and per-lane results.
- [ ] Attach runner label/capability and persistent-service evidence without
      tokens, credentials, environment values, or personal data.
- [ ] Attach the successful-run Actions artifact and cache inventory showing
      zero storage entries for the selective run.
- [ ] Attach approved signing/distribution run links separately from PR evidence.

## Follow-ups
- [ ] Open issues for failures, unavailable runners, missing host locks,
      permissions, or rotated credentials.
- [ ] Update `docs/discovery/ci-secrets-matrix-v1.md` if secret names, scopes,
      runner labels, capabilities, or workflow responsibilities change.
