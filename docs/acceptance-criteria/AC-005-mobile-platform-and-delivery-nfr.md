# AC-005 Mobile Platform And Delivery NFR (Proposed)

## Feature
Mobile platform constraints and delivery workflow without EAS dependency.

## Acceptance Criteria
- `AC-501`: Native project folders (`ios/`, `android/`) exist in repository and are treated as first-class source artifacts.
- `AC-502`: Build/release pipeline runs without requiring EAS Build or EAS Submit.
- `AC-503`: Mobile UI utility-class styling is implemented with NativeWind in MVP.
- `AC-504`: Release branch iOS builds are distributed through TestFlight.
- `AC-505`: Pull requests targeting `develop` trigger QA distribution to Firebase App Distribution.
- `AC-506`: Image/media uploads are client-compressed before upload to Firebase Cloud Storage.
- `AC-507`: Runtime monitoring in MVP uses Crashlytics for crashes/ANRs.
- `AC-508`: Additional non-crash monitoring tooling is not required for MVP.
- `AC-509`: OTA updates are disabled in MVP and production updates are shipped only through App Store/Play binaries.
- `AC-510`: CI signing workflow uses platform-native secret management for signing materials.
- `AC-511`: Post-compression uploads enforce `<= 1.5 MB` file size and `<= 1600 px` longest-side dimension.
- `AC-512`: Core screens meet accessibility baseline for contrast, dynamic text scaling, focus order, and screen-reader labels.
- `AC-513`: User-facing strings use localization keys with populated values for `en-US`, `pt-BR`, and `es-ES` in release-candidate builds.
- `AC-514`: Detox E2E suite is configured for iOS simulator and Android emulator builds, and includes auth sign-in smoke scenarios (empty-submit validation + success route to role-selection).
- `AC-515`: Android and iOS launcher icon assets are generated from the same source logo file (`assets/images/logo.svg`) and updated together.

## Gherkin Scenarios
```gherkin
Feature: Mobile platform and delivery constraints

  Scenario: Native projects are source-controlled
    Given the repository is freshly cloned
    Then ios and android native project folders are present

  Scenario: Pipeline does not rely on EAS
    Given CI pipeline configuration
    When Android and iOS jobs run
    Then builds execute with native toolchains without EAS Build/Submit dependency

  Scenario: PR QA distribution path
    Given a pull request targets develop
    When CI completes a QA build
    Then build artifacts are distributed via Firebase App Distribution

  Scenario: Release branch iOS distribution path
    Given a release branch is built
    When iOS distribution job completes
    Then build is uploaded to TestFlight

  Scenario: Store-only update strategy
    Given MVP release configuration
    When production updates are shipped
    Then delivery happens through App Store/Play binaries only
    And no OTA update channel is active

  Scenario: Platform-native signing in CI
    Given mobile CI signing jobs are configured
    When signing materials are loaded
    Then they are sourced from platform-native CI secret management

  Scenario: Post-compression upload limits
    Given a user selects media for upload
    When compression and validation run
    Then upload proceeds only if file size is at most 1.5 MB
    And upload proceeds only if longest side is at most 1600 px

  Scenario: Core screen accessibility baseline
    Given a user enables larger text and screen reader
    When user navigates onboarding, relationship, and tracking core screens
    Then content remains readable and operable
    And interactive controls expose meaningful labels in logical focus order

  Scenario: Localization baseline completeness
    Given release-candidate build strings are prepared
    When localization table and runtime resource bundles are validated
    Then all user-facing keys have populated values for en-US, pt-BR, and es-ES

  Scenario: Detox auth smoke coverage
    Given Detox config and native build profiles are available for iOS and Android
    When the auth smoke suite runs
    Then empty sign-in submission shows required-field validation errors
    And valid credential submission routes the user to role-selection screen

  Scenario: Cross-platform icon source consistency
    Given the source logo file at assets/images/logo.svg
    When icon generation runs
    Then iOS app icon and Android launcher icons are regenerated from that same source
```
