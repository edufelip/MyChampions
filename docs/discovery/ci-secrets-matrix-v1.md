# CI Secrets Matrix V1

## Purpose
Define the GitHub Actions secrets, repository variables, runner capabilities,
and storage boundaries required by `.github/workflows/` so CI/CD setup is
reproducible and auditable.

## Current CI Contract
- `.github/workflows/pr-selective-tests.yml` is the authoritative pull-request
  gate. It resolves the merge-base-to-exact-head change set, always runs the
  universal fast checks, and dispatches affected web, iOS, and Android suites.
- `.github/workflows/android-pr.yml`, `ios-pr.yml`, and `web-pr.yml` are
  legacy/manual validation workflows. They run only through
  `workflow_dispatch`; they are not automatic or required PR gates.
- `.github/workflows/android-release.yml` and `ios-release.yml` remain the
  credentialed distribution workflows for release/hotfix branches or an
  explicitly approved manual dispatch.
- The repository-scoped self-hosted runners and the host-wide locks shared with
  Meer are configured. Their labels, service posture, hook installation, and
  recovery checks are recorded below. A promotion is still incomplete until
  GitHub Actions proves the complete matrix on that pull request's exact head.

## Global Notes
- Store credentials in GitHub repository secrets, or in protected environment
  secrets for stricter release controls.
- `ENV_FILE` must contain the applicable variables listed in `.env.example`,
  including the MyChampions server URL and public RevenueCat keys used by the
  requested native build. E2E fixture flags are included only when the selected
  deterministic profile requires them.
- Native builds no longer require Firebase config files
  (`google-services.json`, `GoogleService-Info*.plist`), Firebase project files,
  or Firebase service accounts after the local-server migration.
- Workflows set `APP_VARIANT` explicitly (`dev` for selected/manual validation,
  `prod` for release) to prevent accidental cross-environment routing.
- Selected self-hosted jobs run only for branches in this repository. A fork PR
  that selects one of those jobs leaves it skipped and therefore fails the
  stable gate instead of running untrusted code on a private runner.
- GitHub Actions-backed dependency caches are disabled, including setup-node
  caching and Gradle cache actions. Host-local caches may exist on a
  self-hosted runner, but they must never be uploaded through the Actions cache
  service.
- A successful selective run uploads no impact report, web export, app, APK, or
  test artifact. Only bounded failure diagnostics may be uploaded, with
  `retention-days: 1`. Necessary release AAB/IPA artifacts also retain for one
  day.
- `.env.example` lists variable names with empty values. Copy it to `.env` for
  local work; `.env` remains gitignored.
- Use `.github/ISSUE_TEMPLATE/ci-cd-setup-checklist.md` to track bootstrap and
  remote evidence without exposing registration tokens or credentials.

## Secret Inventory
| Secret | Required In | Purpose | Expected Format | Required |
|---|---|---|---|---|
| `ENV_FILE` | `pr-selective-tests` native lanes; manual `android-pr`/`ios-pr`; Android/iOS release | Writes the root `.env` consumed by native builds | Raw multiline `.env` content | Yes for native/full-matrix and release execution |
| `ANDROID_KEYSTORE_BASE64` | `android-release` | Release keystore injection | Base64 of `.jks` file | Yes |
| `ANDROID_KEYSTORE_PASSWORD` | `android-release` | Keystore password | Plain string | Yes |
| `ANDROID_KEY_ALIAS` | `android-release` | Keystore key alias | Plain string | Yes |
| `ANDROID_KEY_ALIAS_PASSWORD` | `android-release` | Key alias password | Plain string | Yes |
| `PLAY_SERVICE_ACCOUNT_JSON` | `android-release` | Play Console API upload auth (`r0adkll/upload-google-play`) | Raw JSON string for Google Play service account | Yes |
| `IOS_TEAM_ID` | `ios-release` | Apple Developer Team ID for xcodebuild signing | Apple Team ID string | Yes |
| `IOS_KEYCHAIN_PASSWORD` | `ios-release` | Temporary keychain password in CI for release signing | Plain string | Yes |
| `IOS_DIST_CERT_P12_BASE64` | `ios-release` | Distribution signing certificate import | Base64 `.p12` | Yes |
| `IOS_DIST_CERT_PASSWORD` | `ios-release` | Distribution certificate password | Plain string | Yes |
| `IOS_PROFILE_BASE64` | `ios-release` | Release provisioning profile install | Base64 `.mobileprovision` | Yes |
| `IOS_PROFILE_NAME` | `ios-release` | Provisioning profile specifier for release archive/export | Plain string | Yes |
| `APP_STORE_CONNECT_API_KEY_ID` | `ios-release` | TestFlight upload auth | ASC API Key ID | Yes |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | `ios-release` | TestFlight upload auth | ASC Issuer ID (UUID) | Yes |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | `ios-release` | TestFlight upload auth | Base64 of `.p8` key content | Yes |

## Non-Secret Repository Controls
| Control | Scope | Contract |
|---|---|---|
| `CI_FORCE_FULL` repository variable | `pr-selective-tests` | Optional broaden-only rollback switch. `true` selects the complete registered matrix; it must never narrow coverage. |
| `ci:full` pull-request label | `pr-selective-tests` | Optional broaden-only request for the complete registered matrix. |
| `force_full` manual input | `pr-selective-tests` | Optional manual request for the complete registered matrix. A run with no usable base also fails closed to full selection. |

## Workflow Mapping
| Workflow | Role | Secrets |
|---|---|---|
| `pr-selective-tests.yml` | Authoritative exact-head PR gate plus scheduled/merge-queue/manual safety matrix | `ENV_FILE` only in selected iOS/Android jobs; impact, fast-quality, and web jobs use no repository secret |
| `android-pr.yml` | Manual-only legacy Android validation | `ENV_FILE` |
| `ios-pr.yml` | Manual-only legacy iOS validation | `ENV_FILE` |
| `web-pr.yml` | Manual-only legacy web validation | None |
| `android-release.yml` | Android signing and Play upload | `ENV_FILE`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_ALIAS_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON` |
| `ios-release.yml` | iOS signing and TestFlight upload | `ENV_FILE`, `IOS_KEYCHAIN_PASSWORD`, `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROFILE_BASE64`, `IOS_PROFILE_NAME`, `IOS_TEAM_ID`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_KEY_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_CONTENT` |

## Configured Self-Hosted Runner Boundaries
| Selected lane | Exact labels | Required host capabilities | Current evidence status |
|---|---|---|---|
| Web | `self-hosted, Linux, X64, mychampions-ci, mychampions-web` | Repository-scoped Linux/WSL runner; Git and outbound access; Playwright browser/system dependencies; `unzip` for pinned Bun bootstrap; capacity for Expo and the optional in-memory backend | `mychampions-ci-ubuntu` is registered and online; Bun extraction and a service-context WebKit launch probe pass; the promotion PR supplies exact-head browser-suite proof |
| Android | `self-hosted, Linux, X64, mychampions-ci, mychampions-android` | Repository-scoped Linux/WSL runner; Android SDK/platform tools; hardware acceleration; `Pixel_10` AVD; Gradle wrapper support | The same `mychampions-ci-ubuntu` service is registered and online; its listener has effective `kvm` membership and the service context reports KVM usable; the lane rejects stale state and preboots the AVD at health-checked `emulator-5554`; the promotion PR supplies exact-head emulator-suite proof |
| iOS | `self-hosted, macOS, ARM64, mychampions-ci, mychampions-ios` | Repository-scoped Apple Silicon runner; Xcode 26 with iOS SDK 26+; `iPhone 17` simulator; CocoaPods; Homebrew path | `mychampions-ios-ci-m5` is registered and online; the promotion PR supplies exact-head simulator proof |

## WSL Browser And Emulator Prerequisite Record

The unprivileged Ubuntu 24.04 runner keeps Playwright `1.61.1` / WebKit `2311`
runtime libraries under
`/home/eduardo/.local/playwright-libs-1.61.1-ubuntu24.04`. They were extracted
from official Ubuntu packages with `apt-get download` and `dpkg-deb -x`, without
altering system packages. A curated soname directory at
`/home/eduardo/.local/playwright-runtime-libs-1.61.1-ubuntu24.04` is first in
the runner `LD_LIBRARY_PATH`. `web-selected` uses the MyChampions-only browser
cache `/home/eduardo/.cache/ms-playwright-mychampions`; it does not mutate the
default cache used by Meer. After each browser install, the workflow makes the
isolated WPE and GTK MiniBrowser wrappers append a nonempty inherited path after
their bundled paths instead of replacing it.

Playwright validates `dlopen` dependencies only through the system `ldconfig`
inventory, which cannot discover these user-local libraries. After the complete
user-library closure was proved by launching headless WebKit from the same
systemd service environment, creating a page, and reading
`WEBKIT_SERVICE_PROBE=webkit-ready`, only the selected web job sets
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`. The runner service does not set
that variable globally. Actual selected Playwright suites remain the runtime
proof, and the scheduled complete matrix regularly launches every configured
browser. Re-run the service-context probe and rebuild the user-library closure
whenever Playwright, WebKit, or Ubuntu changes. The pre-change files remain
recoverable as:

- `/home/eduardo/actions-runner-mychampions-ci/.env.before-playwright-libs-20260729`

The earlier default-cache probe was fully reverted: its temporary WebKit marker
and MyChampions `.links` entry were removed, and both shared WPE/GTK launchers
were restored byte-for-byte from their
`MiniBrowser.before-user-libs-20260729` backups. The final MyChampions runtime
uses only its isolated browser cache.

The Ubuntu login user belongs to `kvm`, but the previously long-lived user
manager predated that membership. An idle user-manager restart refreshed the
persistent MyChampions service; both the manager and
`mychampions-ci-ubuntu` listener now include group ID `993`. A transient probe
started from that same service manager completed `emulator -accel-check` with
`KVM (version 12) is installed and usable`. This proves acceleration
availability, while the promotion PR remains the required exact-head Detox
proof.

The installed Android Emulator `36.6.11` booted `Pixel_10` successfully at
console port `5554`, and pinned Detox `20.47.0` reused that running AVD across
sequential specs. The selected workflow therefore restarts ADB only under the
existing job-hook lease, fails closed on stale emulator/QEMU or `5554/5555`
state, preboots the exact AVD with snapshots disabled and read-only state, and
bounds readiness to 120 seconds. Teardown targets `emulator-5554` and only a
saved PID whose runner UID, Linux start time, and command line still match the
captured owner and expected AVD/port, verifies all QEMU processes, emulator
devices, and owned ports disappear, and stops ADB; the workflow does not create
a second shell-level host lock.

## Shared Host Lock Operational Record

The Mac iOS lane and the WSL web/Android lanes share their physical hosts with
Meer runner services. Both pairs use GitHub runner job-started and job-completed
hooks to acquire and release one POSIX file lock per physical host. The start
hook waits at most 10,800 seconds and fails closed if ownership cannot be
established. A tokenized owner/holder fence binds the lease to the exact
`Runner.Worker` boot ID, start identity, and command identity so a killed worker
is recoverable without allowing an overlapping successor.

The host-owned hook files are installed at:

- macOS: `/Users/eduwaldo/.local/libexec/github-actions/`
- WSL: `/home/eduardo/.local/libexec/github-actions/`

The installed production hashes on both hosts are:

```text
69fd3be3dcca9c1a3bac5b64f36eca5ac910bff1a91f2237fe33b36b6badbf69  mobile-host-lock.py
343dafbca37a3a72d2ed7c4850d971dba09831b1e0cecee9e2832199275ceba3  mobile-host-lock-start.sh
e45740b98d4e0e6f7fbeeaed57b0533ed7a46f4dc70134c6a16a659e46b885d8  mobile-host-lock-completed.sh
```

The final implementation passed 12 complete Darwin and 12 complete WSL stress
suites: 96 behavioral scenarios and 384 contending jobs with zero overlap,
correct bounded-wait failure, crash fencing/recovery, and no live lease, holder,
owner, or prototype process afterward. Runner `.env` backups with the suffix
`.before-mobile-host-lock-20260728` preserve the pre-hook configuration.

`mychampions-ios-ci-m5` and the Meer Mac service run as launchd services.
`mychampions-ci-ubuntu` runs as an enabled and active user systemd service. The
WSL user has `Linger=no`, so reboot-survival is not claimed until a login starts
the user manager. The existing Meer WSL root service remains enabled but
inactive; its listener was restarted manually and must be checked as online
before relying on that peer. This known service-manager difference does not
weaken the shared hook lock while either listener is running.

The WSL runner path includes a user-local Ubuntu `unzip` 6.00 installation at
`/home/eduardo/.local/bin/unzip`. It is required by `oven-sh/setup-bun` and was
validated by extracting and executing Bun 1.3.10 without elevated privileges.

Runner registration tokens are ephemeral bootstrap credentials and must not be
stored in repository secrets, issue comments, screenshots, or logs.

## Setup And Evidence Checklist
1. Add only the secrets required by the workflow being validated.
2. Verify the registered runner names, exact labels, service state, installed
   hook hashes, and empty lock state before an authoritative run.
3. Use the manual-only Android, iOS, and web workflows for isolated validation
   when useful; do not treat them as the pull-request gate.
4. Run the authoritative workflow against the exact promotion head with full
   selection and record every selected lane result before making the gate
   required.
5. Confirm a green selective run has zero Actions artifacts and zero Actions
   caches. If failure diagnostics exist, verify their path is bounded and their
   retention is one day.
6. Validate Android/iOS release workflows only through an explicitly approved
   release test because they sign and upload store binaries.
7. Rotate secrets on certificate/profile renewal and update this matrix if
   names, scopes, runner labels, or workflow responsibilities change.
