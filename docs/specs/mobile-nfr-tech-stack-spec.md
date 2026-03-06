# Mobile NFR And Tech Stack Spec (Draft)

## Purpose
Define non-functional architecture constraints and technology options for the mobile app stack.

## Scope
- Mobile framework/runtime strategy.
- Build/release strategy without EAS dependency.
- Backend-as-a-service and storage foundation.
- Crash and reliability tooling.
- UI stack choices for a Tailwind-style developer experience.
- E2E automation baseline for test-oriented development.
- CI/CD orchestration options.

## Confirmed Decisions
- Mobile app uses React Native with Expo.
- Project must not rely on EAS services as a hard dependency for build/release.
- Android and iOS native packages/pipelines are managed independently.
- Native directories (`ios/`, `android/`) are committed from day 1.
- Native directory generation policy is one-time `expo prebuild`; ongoing native work is edited directly in committed native projects.
- Backend platform is Firebase (Auth, Firestore, Cloud Storage).
- Social auth is implemented through Firebase Auth.
- Crash reporting is mandatory with Firebase Crashlytics.
- Non-crash monitoring tooling (for example Sentry) is out of MVP scope.
- User media (for example recipe images) is stored in Firebase Cloud Storage.
- UI styling stack for MVP is NativeWind.
- Client-side media compression is mandatory before upload.
- OTA strategy is store-only for MVP (no remote JS bundle delivery channel).
- CI signing strategy uses platform-native secret management in pipelines.
- Core MVP screens must meet accessibility baseline (contrast, dynamic text scaling, focus order, screen-reader labels).
- QA distribution policy:
  - Release branch builds are distributed through TestFlight.
  - Pull requests targeting `develop` publish QA builds to Firebase App Distribution.
- Post-compression media constraints:
  - max upload size: `1.5 MB`.
  - max image dimension: `1600 px` on longest side.
- Localization baseline requires all user-facing strings to ship in `en-US`, `pt-BR`, and `es-ES`.
- E2E automation baseline uses Detox with Jest runner for mobile smoke coverage.

## Constraints From Platform Docs
- Expo local builds support CI and local machine execution and work with managed and bare workflows.
- React Native Firebase requires native code integration, so Expo Go is not enough for this setup.
- Firebase Auth in React Native requires provider configuration for Apple/Google and deep-link handling where applicable.
- Firebase Firestore collection schema, indexing, and security-rule authorization strategy must be defined before production traffic.
- Firebase Cloud Storage upload flows must enforce client compression and storage rule constraints.

## Technology Options

### 1) Tailwind-Style UI
- Option A: NativeWind.
  - Pros: Tailwind-compatible API, strong Expo/React Native adoption, utility-first workflow.
  - Cons: Build/runtime considerations for dynamic class composition.
- Option B: `twrnc` (tailwind-react-native-classnames).
  - Pros: Lightweight, straightforward class-to-style mapping.
  - Cons: Smaller ecosystem and fewer first-party patterns than NativeWind.
- Option C: `tailwind-rn`.
  - Pros: Simple mental model.
  - Cons: Historically less feature-complete for modern RN use cases.
- Selected for MVP: NativeWind.

### 2) Navigation
- Option A: Expo Router.
  - Pros: File-based routes, good fit with existing Expo baseline.
  - Cons: Requires strict route conventions.
- Option B: React Navigation (manual config only).
  - Pros: Maximum explicit control.
  - Cons: More boilerplate for route structure.
- Recommended starting point: Keep Expo Router.

### 3) Server-State And Caching
- Option A: TanStack Query + lightweight local state (Zustand).
  - Pros: Excellent async cache primitives, retries, invalidation, optimistic updates.
  - Cons: More moving parts if overused for simple local state.
- Option B: Redux Toolkit + RTK Query.
  - Pros: Centralized state model with integrated data fetching.
  - Cons: Higher upfront structure for smaller feature slices.
- Recommended starting point: TanStack Query + Zustand.

### 4) Forms And Validation
- Option A: React Hook Form + Zod.
  - Pros: Strong performance, type-safe schemas, good RN ergonomics.
  - Cons: Schema duplication risk if backend schemas diverge.
- Option B: Formik + Yup.
  - Pros: Mature ecosystem and familiar API.
  - Cons: Usually heavier re-render profile.
- Recommended starting point: React Hook Form + Zod.

### 5) Local Persistence For Offline Read-Only
- Option A: Firestore query snapshots + SQLite (`expo-sqlite`) tables.
  - Pros: Reliable structured offline reads, explicit TTL policies.
  - Cons: Additional sync layer complexity.
- Option B: MMKV/AsyncStorage cache only.
  - Pros: Fast setup and low complexity.
  - Cons: Harder queryability and consistency for complex views.
- Recommended starting point: SQLite snapshots for core lists + MMKV/AsyncStorage for session/preferences.

### 6) CI/CD Without EAS
- Option A: GitHub Actions + Fastlane + native toolchains (`gradlew`, `xcodebuild`).
  - Pros: Maximum control, transparent pipelines, no EAS lock-in.
  - Cons: More initial setup for signing and caching.
- Option B: Codemagic + Fastlane/native scripts.
  - Pros: Faster mobile-first bootstrap.
  - Cons: Additional vendor dependency.
- Option C: Bitrise + Fastlane/native scripts.
  - Pros: Mature mobile CI features.
  - Cons: Additional vendor dependency.
- Recommended starting point: GitHub Actions + Fastlane.

## High-Level Architecture (Target)
1. Expo/React Native client handles UI, routing, and offline read models.
2. Firebase Auth manages email/password and social identity.
3. Firebase Firestore enforces domain rules through collection structure and security rules.
4. Firebase Cloud Storage stores recipe and profile images.
5. fatsecret API serves nutrition lookup dataset.
6. RevenueCat orchestrates professional subscription entitlements.
7. Firebase Crashlytics captures runtime crashes and non-fatal exceptions.

Diagram: `docs/diagrams/mobile-stack-high-level-v1.md`.
Data model and collection/security contract: `docs/specs/firebase-firestore-integration-spec.md`.

## Suggested Default NFR Targets For MVP
- App cold start: <= 2.5s median on modern mid-tier devices.
- Crash-free sessions: >= 99.5%.
- API p95 latency (critical endpoints): <= 800ms (region-adjusted).
- Auth/session reliability: silent refresh success >= 99%.
- Image upload success rate: >= 99% with retry for transient failures.
- Observability: structured logs with no sensitive token/link leakage.

## Traceability Links
- Functional requirements: `FR-192`, `FR-193`, `FR-194`, `FR-195`, `FR-196`, `FR-197`, `FR-198`, `FR-199`, `FR-200`, `FR-201`, `FR-202`, `FR-217`, `FR-227`, `FR-228`.
- Business rules: `BR-253`, `BR-254`, `BR-255`, `BR-256`, `BR-257`, `BR-258`, `BR-259`, `BR-260`, `BR-261`, `BR-275`, `BR-284`, `BR-285`.
- Acceptance criteria: `AC-501`, `AC-502`, `AC-503`, `AC-504`, `AC-505`, `AC-506`, `AC-507`, `AC-508`, `AC-509`, `AC-510`, `AC-511`, `AC-512`, `AC-513`, `AC-514`.
- Test cases: `TC-501`, `TC-502`, `TC-503`, `TC-504`, `TC-505`, `TC-506`, `TC-507`, `TC-508`, `TC-509`, `TC-510`, `TC-511`, `TC-512`, `TC-513`, `TC-514`.
- Diagram: `docs/diagrams/mobile-stack-high-level-v1.md`.

## Open Questions
- None currently.

## References
- Expo local app builds: https://docs.expo.dev/build-reference/local-builds/
- Expo Firebase guide: https://docs.expo.dev/guides/using-firebase
- React Native Firebase (Expo support): https://rnfirebase.io/
- React Native Firebase Crashlytics: https://rnfirebase.io/crashlytics/usage
- Firebase Auth for Apple (iOS): https://firebase.google.com/docs/auth/ios/apple
- Firebase Auth for Google (React Native via SDK/provider): https://firebase.google.com/docs/auth
- Firebase Firestore: https://firebase.google.com/docs/firestore
- Firebase Cloud Storage: https://firebase.google.com/docs/storage
- Fastlane docs: https://docs.fastlane.tools/
- GitHub Actions docs: https://docs.github.com/actions
- Detox docs: https://wix.github.io/Detox/docs/introduction/project-setup/
