# CI Secrets Matrix V1

## Purpose
Define all GitHub Actions secrets required by `.github/workflows/` so CI/CD setup is reproducible and auditable.

## Scope
- Android PR checks
- Android release pipeline
- Firebase App Distribution (Android/iOS)
- iOS PR checks
- iOS release/TestFlight pipeline

## Global Notes
- Store all values in **GitHub repository secrets** (or environment-level secrets for stricter release controls).
- `ENV_FILE` must contain **all** variables listed in `.env.example`: Firebase JS config (`FIREBASE_DEV_*`, `FIREBASE_PROD_*`), Data Connect vars (`EXPO_PUBLIC_DATA_CONNECT_*`), and `APP_VARIANT`. Firebase config is no longer hardcoded in `app.config.ts` — it is read from env vars at build time.
- Firebase config files (`google-services.json`, `GoogleService-Info*.plist`) are injected in CI from base64 secrets and must not be committed. These are the native Firebase configs; `ENV_FILE` carries the JS/Expo layer config separately.
- `.env.example` in the repository root lists all required variable names with empty values. Copy to `.env` locally and populate. `.env` is gitignored.
- Use issue template `.github/ISSUE_TEMPLATE/ci-cd-setup-checklist.md` to track repository bootstrap and validation runs.

## Secret Inventory
| Secret | Required In | Purpose | Expected Format | Required |
|---|---|---|---|---|
| `ENV_FILE` | `android-pr`, `android-release`, `firebase-distribution-android`, `firebase-distribution-ios`, `ios-pr`, `ios-release` | Writes root `.env` used to export `EXPO_PUBLIC_*` vars | Raw multiline `.env` content | Yes |
| `GOOGLE_SERVICES_JSON_BASE64_DEV` | `android-pr`, `firebase-distribution-android` | Android dev Firebase config injection | Base64 of valid `google-services.json` (dev app/package) | Yes |
| `GOOGLE_SERVICES_JSON_BASE64` | `android-release` | Android production Firebase config injection | Base64 of valid `google-services.json` (prod app/package) | Yes |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64_DEV` | `ios-pr`, `firebase-distribution-ios` | iOS dev Firebase config injection | Base64 of valid `GoogleService-Info.plist` (dev bundle id) | Yes |
| `GOOGLE_SERVICE_INFO_PLIST_BASE64` | `ios-release` | iOS production Firebase config injection | Base64 of valid `GoogleService-Info.plist` (prod bundle id) | Yes |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | `android-pr`, `firebase-distribution-android`, `firebase-distribution-ios` | Auth for Firebase App Distribution operations | Raw JSON string for Firebase service account | Yes |
| `FIREBASE_APP_ID_ANDROID_DEV` | `android-pr`, `firebase-distribution-android` | Target Firebase Android app for dev distribution | Firebase App ID string | Yes |
| `FIREBASE_APP_ID_IOS_DEV` | `firebase-distribution-ios` | Target Firebase iOS app for dev distribution | Firebase App ID string | Yes |
| `ANDROID_KEYSTORE_BASE64` | `android-release` | Release keystore injection | Base64 of `.jks` file | Yes |
| `ANDROID_KEYSTORE_PASSWORD` | `android-release` | Keystore password | Plain string | Yes |
| `ANDROID_KEY_ALIAS` | `android-release` | Keystore key alias | Plain string | Yes |
| `ANDROID_KEY_ALIAS_PASSWORD` | `android-release` | Key alias password | Plain string | Yes |
| `ANDROID_PLAY_SIGNING_SHA1` | `android-release` | Optional Play App Signing SHA-1 used in Google Sign-In preflight output | SHA-1 fingerprint string | Optional |
| `PLAY_SERVICE_ACCOUNT_JSON` | `android-release` | Play Console API upload auth (`r0adkll/upload-google-play`) | Raw JSON string for Google Play service account | Yes |
| `IOS_ADHOC_KEYCHAIN_PASSWORD` | `firebase-distribution-ios` | Temporary keychain password in CI for iOS dev distribution signing | Plain string | Yes |
| `IOS_ADHOC_PROFILE_NAME` | `firebase-distribution-ios` | Provisioning profile specifier for iOS dev archive/export | Plain string | Yes |
| `IOS_ADHOC_CERT_P12_BASE64` | `firebase-distribution-ios` | Dev signing certificate import | Base64 `.p12` | Yes |
| `IOS_ADHOC_CERT_PASSWORD` | `firebase-distribution-ios` | Dev certificate password | Plain string | Yes |
| `IOS_ADHOC_PROFILE_BASE64` | `firebase-distribution-ios` | Dev provisioning profile install | Base64 `.mobileprovision` | Yes |
| `IOS_TEAM_ID` | `firebase-distribution-ios`, `ios-release` | Apple Developer Team ID for xcodebuild signing | Apple Team ID string | Yes |
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
| `android-pr.yml` | `ENV_FILE`, `GOOGLE_SERVICES_JSON_BASE64_DEV`, `FIREBASE_APP_ID_ANDROID_DEV`, `FIREBASE_SERVICE_ACCOUNT_JSON` |
| `android-release.yml` | `ENV_FILE`, `GOOGLE_SERVICES_JSON_BASE64`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_ALIAS_PASSWORD`, `ANDROID_PLAY_SIGNING_SHA1` (optional), `PLAY_SERVICE_ACCOUNT_JSON` |
| `firebase-distribution-android.yml` | `ENV_FILE`, `GOOGLE_SERVICES_JSON_BASE64_DEV`, `FIREBASE_APP_ID_ANDROID_DEV`, `FIREBASE_SERVICE_ACCOUNT_JSON` |
| `ios-pr.yml` | `ENV_FILE`, `GOOGLE_SERVICE_INFO_PLIST_BASE64_DEV` |
| `firebase-distribution-ios.yml` | `ENV_FILE`, `GOOGLE_SERVICE_INFO_PLIST_BASE64_DEV`, `FIREBASE_APP_ID_IOS_DEV`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `IOS_ADHOC_KEYCHAIN_PASSWORD`, `IOS_ADHOC_PROFILE_NAME`, `IOS_ADHOC_CERT_P12_BASE64`, `IOS_ADHOC_CERT_PASSWORD`, `IOS_ADHOC_PROFILE_BASE64`, `IOS_TEAM_ID` |
| `ios-release.yml` | `ENV_FILE`, `GOOGLE_SERVICE_INFO_PLIST_BASE64`, `IOS_KEYCHAIN_PASSWORD`, `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROFILE_BASE64`, `IOS_PROFILE_NAME`, `IOS_TEAM_ID`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_KEY_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_CONTENT` |

## Setup Checklist
1. Add all required secrets in GitHub repository settings.
2. Trigger each workflow once via `workflow_dispatch` to validate secret resolution.
3. Confirm Firebase config file decode steps succeed in logs.
4. Confirm iOS signing/import steps succeed with current certificates/profiles.
5. Rotate secrets on certificate/profile renewal and update this matrix if names change.
