---
name: CI/CD Setup Checklist
about: Configure and validate all required CI/CD secrets and signing assets.
title: "chore(ci): setup secrets and signing for workflows"
labels: ["ci", "infra"]
assignees: []
---

## Goal
Set up repository secrets and validate all GitHub Actions workflows for Android/iOS CI and release.

## References
- Secrets source-of-truth: `docs/discovery/ci-secrets-matrix-v1.md`
- Workflows: `.github/workflows/`

## Scope
- [ ] Add required GitHub secrets.
- [ ] Validate workflow execution paths.
- [ ] Confirm signing and distribution steps.
- [ ] Record follow-ups for any failing checks.

## Secret Setup

### Common
- [ ] `ENV_FILE`

### Android (Dev/PR)
- [ ] `ENV_FILE` includes the local MyChampions server URL for dev builds.

### Android (Release)
- [ ] `ANDROID_KEYSTORE_BASE64`
- [ ] `ANDROID_KEYSTORE_PASSWORD`
- [ ] `ANDROID_KEY_ALIAS`
- [ ] `ANDROID_KEY_ALIAS_PASSWORD`
- [ ] `PLAY_SERVICE_ACCOUNT_JSON`
- [ ] `ANDROID_PLAY_SIGNING_SHA1` (optional)

### iOS (Dev/PR)
- [ ] `ENV_FILE` includes the local MyChampions server URL for dev builds.
- [ ] `IOS_ADHOC_KEYCHAIN_PASSWORD`
- [ ] `IOS_ADHOC_PROFILE_NAME`
- [ ] `IOS_ADHOC_CERT_P12_BASE64`
- [ ] `IOS_ADHOC_CERT_PASSWORD`
- [ ] `IOS_ADHOC_PROFILE_BASE64`
- [ ] `IOS_TEAM_ID`

### iOS (Release/TestFlight)
- [ ] `IOS_KEYCHAIN_PASSWORD`
- [ ] `IOS_DIST_CERT_P12_BASE64`
- [ ] `IOS_DIST_CERT_PASSWORD`
- [ ] `IOS_PROFILE_BASE64`
- [ ] `IOS_PROFILE_NAME`
- [ ] `APP_STORE_CONNECT_API_KEY_ID`
- [ ] `APP_STORE_CONNECT_API_KEY_ISSUER_ID`
- [ ] `APP_STORE_CONNECT_API_KEY_CONTENT`

## Validation Runs
- [ ] `android-pr.yml` passes.
- [ ] `ios-pr.yml` passes.
- [ ] `android-release.yml` builds signed AAB and reaches Play upload step.
- [ ] `ios-release.yml` archives/exports IPA and reaches TestFlight upload step.

## Evidence
- [ ] Attach links to successful workflow runs.
- [ ] Attach logs/screenshots for signing/distribution confirmations.

## Follow-ups
- [ ] Open issues for failures, missing permissions, or rotated credentials.
- [ ] Update `docs/discovery/ci-secrets-matrix-v1.md` if secret names/scope changed.
