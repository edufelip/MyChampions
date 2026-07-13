# CI Secrets Matrix V1

## Purpose
Define all GitHub Actions secrets required by `.github/workflows/` so CI/CD setup is reproducible and auditable.

## Scope
- Android PR checks
- Android release pipeline
- iOS PR checks
- iOS release/TestFlight pipeline

## Global Notes
- Store all values in **GitHub repository secrets** (or environment-level secrets for stricter release controls).
- `ENV_FILE` must contain **all** variables listed in `.env.example`: `APP_VARIANT`, MyChampions server URL, terms config, E2E fixture flags when needed, and RevenueCat keys used by the app.
- Native builds no longer require Firebase config files (`google-services.json`, `GoogleService-Info*.plist`), Firebase project files, or Firebase service accounts after the local-server migration.
- Workflows set `APP_VARIANT` explicitly (`dev` for PR, `prod` for release) to prevent accidental cross-environment native/release routing.
- `.env.example` in the repository root lists all required variable names with empty values. Copy to `.env` locally and populate. `.env` is gitignored.
- Use issue template `.github/ISSUE_TEMPLATE/ci-cd-setup-checklist.md` to track repository bootstrap and validation runs.

## Secret Inventory
| Secret | Required In | Purpose | Expected Format | Required |
|---|---|---|---|---|
| `ENV_FILE` | `android-pr`, `android-release`, `ios-pr`, `ios-release` | Writes root `.env` used to export `EXPO_PUBLIC_*` vars | Raw multiline `.env` content | Yes |
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

## Workflow Mapping
| Workflow | Secrets |
|---|---|
| `android-pr.yml` | `ENV_FILE` |
| `android-release.yml` | `ENV_FILE`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_ALIAS_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON` |
| `ios-pr.yml` | `ENV_FILE` |
| `ios-release.yml` | `ENV_FILE`, `IOS_KEYCHAIN_PASSWORD`, `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROFILE_BASE64`, `IOS_PROFILE_NAME`, `IOS_TEAM_ID`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_KEY_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_CONTENT` |

## Setup Checklist
1. Add all required secrets in GitHub repository settings.
2. Trigger each workflow once via `workflow_dispatch` to validate secret resolution.
3. Confirm iOS signing/import steps succeed with current certificates/profiles.
4. Rotate secrets on certificate/profile renewal and update this matrix if names change.
