# Mobile NFR And Tech Stack Spec (Draft)

## Purpose
Define non-functional architecture constraints and technology options for the mobile app stack.

## Scope
- Mobile framework/runtime strategy.
- Build/release strategy without EAS dependency.
- Backend-as-a-service and storage foundation.
- Crash and reliability tooling.
- UI stack choices for a Tailwind-style developer experience.
- CI/CD orchestration options.

## Confirmed Decisions
- Mobile app uses React Native with Expo.
- Project must not rely on EAS services as a hard dependency for build/release.
- Android and iOS native packages/pipelines are managed independently.
- Native directories (`ios/`, `android/`) are committed from day 1.
- Native directory generation policy is one-time `expo prebuild`; ongoing native work is edited directly in committed native projects.
- Backend platform is Supabase (Postgres, Auth, Storage).
- Social auth is implemented through Supabase Auth.
- Crash reporting is mandatory with Firebase Crashlytics.
- Non-crash monitoring tooling (for example Sentry) is out of MVP scope.
- User media (for example recipe images) is stored in Supabase Storage.
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

## Constraints From Platform Docs
- Expo local builds support CI and local machine execution and work with managed and bare workflows.
- React Native Firebase requires native code integration, so Expo Go is not enough for this setup.
- Supabase React Native setup requires explicit storage configuration (for example AsyncStorage) and lock manager setup.
- Supabase social auth flow uses OAuth + PKCE, with deep-link redirect handling.
- Supabase Storage in React Native commonly uses `arrayBuffer` upload flow from local files.

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
- Option A: Supabase cache + SQLite (`expo-sqlite`) snapshot tables.
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
2. Supabase Auth manages email/password and social identity.
3. Supabase Postgres + RLS enforces domain rules.
4. Supabase Storage stores recipe and profile images.
5. fatsecret API serves nutrition lookup dataset.
6. RevenueCat orchestrates professional subscription entitlements.
7. Firebase Crashlytics captures runtime crashes and non-fatal exceptions.

Diagram: `docs/diagrams/mobile-stack-high-level-v1.md`.

## Suggested Default NFR Targets For MVP
- App cold start: <= 2.5s median on modern mid-tier devices.
- Crash-free sessions: >= 99.5%.
- API p95 latency (critical endpoints): <= 800ms (region-adjusted).
- Auth/session reliability: silent refresh success >= 99%.
- Image upload success rate: >= 99% with retry for transient failures.
- Observability: structured logs with no sensitive token/link leakage.

## Traceability Links
- Functional requirements: `FR-192`, `FR-193`, `FR-194`, `FR-195`, `FR-196`, `FR-197`, `FR-198`, `FR-199`, `FR-200`, `FR-201`, `FR-202`, `FR-217`, `FR-227`.
- Business rules: `BR-253`, `BR-254`, `BR-255`, `BR-256`, `BR-257`, `BR-258`, `BR-259`, `BR-260`, `BR-261`, `BR-275`, `BR-284`.
- Acceptance criteria: `AC-501`, `AC-502`, `AC-503`, `AC-504`, `AC-505`, `AC-506`, `AC-507`, `AC-508`, `AC-509`, `AC-510`, `AC-511`, `AC-512`, `AC-513`.
- Test cases: `TC-501`, `TC-502`, `TC-503`, `TC-504`, `TC-505`, `TC-506`, `TC-507`, `TC-508`, `TC-509`, `TC-510`, `TC-511`, `TC-512`, `TC-513`.
- Diagram: `docs/diagrams/mobile-stack-high-level-v1.md`.

## Open Questions
- None currently.

## References
- Expo local app builds: https://docs.expo.dev/build-reference/local-builds/
- Expo Firebase guide: https://docs.expo.dev/guides/using-firebase
- React Native Firebase (Expo support): https://rnfirebase.io/
- React Native Firebase Crashlytics: https://rnfirebase.io/crashlytics/usage
- Supabase Auth social login (React Native): https://supabase.com/docs/guides/auth/native-mobile-deep-linking
- Supabase React Native quickstart: https://supabase.com/docs/guides/getting-started/quickstarts/react-native
- Supabase JavaScript auth reference: https://supabase.com/docs/reference/javascript/auth-signinwithoauth
- Supabase Storage upload reference: https://supabase.com/docs/reference/javascript/storage-from-upload
- Fastlane docs: https://docs.fastlane.tools/
- GitHub Actions docs: https://docs.github.com/actions
