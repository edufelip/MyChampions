# TC-005 Mobile Platform And Delivery NFR (Proposed)

## Test Cases

| ID | Area | Preconditions | Steps | Expected Result |
|---|---|---|---|---|
| TC-501 | Native Source Baseline | Fresh clone of repository | Inspect root project folders | `ios/` and `android/` folders are present and buildable |
| TC-502 | Build Independence From EAS | CI credentials and toolchains configured | Run Android and iOS pipelines | Pipelines complete with native tools and no EAS service dependency |
| TC-503 | NativeWind Baseline | App initialized with UI stack | Render sample utility-class screen | NativeWind classes render expected styles |
| TC-504 | Release Branch TestFlight Distribution | Release branch exists and CI secrets are valid | Run iOS release workflow | Signed iOS build is uploaded to TestFlight |
| TC-505 | PR-to-Develop Firebase Distribution | PR targets `develop` and CI secrets are valid | Run QA workflow | Build is uploaded to Firebase App Distribution |
| TC-506 | Mandatory Upload Compression | User selects large image for upload | Execute client upload flow | File is compressed client-side before upload and upload succeeds |
| TC-507 | Crash/ANR Monitoring | Crashlytics configured in release build | Trigger test crash/ANR in staging build | Event appears in Firebase Crashlytics |
| TC-508 | Non-Crash Monitoring Scope | MVP instrumentation is configured | Inspect runtime monitoring dependencies/config | No additional non-crash monitoring SDK is required |
| TC-509 | Store-Only Update Strategy | MVP release build config available | Inspect release/update pipeline settings | OTA channel is disabled and production updates are store-binary only |
| TC-510 | Platform-Native Signing Secrets | CI/CD signing workflow configured | Inspect signing steps and secret sources | Certificates/profiles/keys are sourced from platform-native CI secret management |
| TC-511 | Post-Compression Upload Limits | User selects oversized image | Run compression and pre-upload validation | Upload blocked if file remains > 1.5 MB or longest side > 1600 px; valid compressed media uploads successfully |
| TC-512 | Accessibility Baseline Validation | Core screens implemented with baseline a11y support | Run contrast/text-scaling/screen-reader/focus-order checks on core screens | Core screens pass baseline accessibility checks without blocking issues |
| TC-513 | Localization Baseline Completeness | Localization resources prepared for release-candidate build | Validate user-facing string keys across locale bundles | Every key has populated values in en-US, pt-BR, and es-ES |
| TC-514 | Detox Auth Smoke Suite | Detox config, native projects, and simulator/emulator tooling available | Build app with Detox profile and run `auth-sign-in` E2E spec | Empty submit surfaces required-field errors; valid sign-in navigates to role-selection; suite passes on configured device profile |

## Notes
- Add Android Play-track distribution tests if Android store automation is added before MVP freeze.
