# Native Social Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace unsupported Google browser OAuth capture with native iOS/Android token capture and make Apple release signing prove the required entitlement.

**Architecture:** Keep the existing provider-neutral mobile-to-server authentication boundary. A small Google SDK adapter resolves public client IDs, configures the native SDK, captures one ID token, and forwards it to the existing server source; Apple keeps its current native adapter while Xcode and CI gain the missing capability contract.

**Tech Stack:** Expo 54, React Native 0.81, `@react-native-google-signin/google-signin` 16.1.2, `expo-apple-authentication`, Node test runner, TypeScript, Xcode entitlements, GitHub Actions.

---

### Task 1: Native Google adapter contract

**Files:**
- Modify: `features/auth/google-social-auth-source.test.ts`
- Modify: `features/auth/google-social-auth-source.ts`

- [x] **Step 1: Write failing tests** for native SDK configuration, Android Play Services, successful ID-token forwarding, cancellation response/error, missing token, and network/configuration failures.
- [x] **Step 2: Run** `yarn tsx --test features/auth/google-social-auth-source.test.ts` and confirm failures reference the removed browser dependency contract.
- [x] **Step 3: Implement** a dependency-injected adapter with `configure`, `ensurePlayServices`, `getClientIds`, `getPlatform`, and `signIn` boundaries. Runtime dependencies load `GoogleSignin` from `@react-native-google-signin/google-signin` and call the existing server source with `{ provider: 'google', idToken }`.
- [x] **Step 4: Re-run** the focused test and confirm all native-adapter cases pass.

### Task 2: Dependency and static contract

**Files:**
- Modify: `package.json`
- Modify: `yarn.lock`
- Modify: `features/auth/firebase-config-removal-scan.test.ts`
- Modify: `app.config.ts`

- [x] **Step 1: Change the static guard first** so it requires the native Google package, rejects `expo-auth-session` in the Google adapter, and requires web plus platform client configuration.
- [x] **Step 2: Run** `yarn tsx --test features/auth/firebase-config-removal-scan.test.ts` and confirm it fails on the current package/source contract.
- [x] **Step 3: Install** `@react-native-google-signin/google-signin@16.1.2`, remove unused `expo-auth-session`, and expose only public OAuth IDs through existing Expo extra configuration.
- [x] **Step 4: Re-run** the focused guard and Google adapter tests.

### Task 3: Apple native capability and release guard

**Files:**
- Modify: `ios/mychampions/mychampions.entitlements`
- Modify: `.github/workflows/ios-release.yml`
- Modify: `features/auth/firebase-config-removal-scan.test.ts`

- [x] **Step 1: Add failing static assertions** for `com.apple.developer.applesignin`, `Default`, and release-profile validation.
- [x] **Step 2: Run** the Firebase/provider guard and confirm the new assertions fail.
- [x] **Step 3: Add** the entitlement array to the Xcode entitlement plist and extend the existing decoded-profile validation with `PlistBuddy` checks for `Entitlements:com.apple.developer.applesignin:0 == Default`.
- [x] **Step 4: Validate** the plist, workflow YAML, focused guard, and TypeScript.

### Task 4: Provider clients and iOS callback registration

**Files:**
- Modify: `ios/mychampions/Info.plist`
- Modify: `.env.example`
- Modify: provider/deploy environment outside Git

- [x] **Step 1: Inspect** the Play App Signing SHA-1 and current Apple/Google provider registrations without mutation.
- [x] **Step 2: Create** the missing production Android OAuth client in project `mychampions-fb928` after action-time confirmation; retain the existing production/dev iOS and web clients.
- [x] **Step 3: Register** the production and dev iOS reverse-client schemes in `CFBundleURLSchemes`; configure local, GitHub release, and VM audience envs without storing secrets in source.
- [x] **Step 4: Verify** Google provider configuration with release guards, native Android/iOS builds, published external OAuth status, live VM audience checks, and fail-closed public token probes.

### Task 5: Regression and evidence

**Files:**
- Modify: `docs/discovery/pending-wiring-checklist-v1.md`
- Modify: `docs/screens/v2/SC-217-auth-sign-in.md`
- Modify: `docs/screens/v2/SC-218-auth-create-account.md`
- Modify: root task card `../docs/superpowers/plans/2026-07-11-self-managed-auth-storage-task-card.md`

- [x] **Step 1: Run** focused auth/provider tests and inspect failures.
- [x] **Step 2: Run** `yarn test:unit`, `yarn tsc --noEmit`, `yarn lint`, plist/YAML validation, and `git diff --check`.
- [x] **Step 3: Perform** native Google and Apple device/build smoke checks with production-like public configuration. Android production compilation and an iOS device Release build passed; the signed iOS app and embedded profile carry `com.apple.developer.applesignin = Default`.
- [x] **Step 4: Update** docs and task-card acceptance/evidence rows with exact commands, results, provider identifiers (never secrets), and residual release risks.

The Apple Developer Program License Agreement is now accepted. After restoring the certificate trust policy to system defaults, a clean iOS device archive and automatic App Store export both passed. A separate non-cloud-managed Apple Distribution certificate was created from a local CSR, packaged with Apple WWDR G3 in a chain-inclusive P12, and paired with the App Store profile `MyChampions App Store CI 2026-07`. The exact manual archive and App Store export path used by GitHub Actions also passed locally; the resulting profile carries `aps-environment = production` plus `com.apple.developer.applesignin = Default`, and `get-task-allow` is false.
