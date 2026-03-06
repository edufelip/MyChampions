# SC-213 Account & Privacy Settings (V2)

## Route
- `/settings/account`
- Re-exported from `app/(tabs)/account.tsx` for both student and professional roles.
- Tab label: "Profile" (student) / "Account" (professional) — see D-045.

## Objective
Provide a production-ready account management screen covering identity, preferences,
compliance-critical controls (privacy policy, terms, account deletion), sign-out, and
in-app support access.

## Design Structure
- `ScrollView` root with DS theme tokens and shared spacing rhythm.
- Grouped `<View>` rows styled as iOS-native settings groups (rounded, bordered).
- Offline communication uses `DsOfflineBanner` while preserving BL-008 write-lock restrictions.
- Section headers use uppercase label pattern.
- Top safe-area spacing is role-aware: Student Profile tab uses full top inset; Professional Account tab uses half inset.

## Screen Sections (top → bottom)

### 1. Profile Header Card
- Avatar: initials circle (first char of `displayName`, fallback to email prefix, fallback `?`).
- Display name: `currentUser.displayName` → email prefix → `—`.
- Email: `currentUser.email`.
- Role badge pill: "Student" / "Professional" based on `lockedRole`.

### 2. Account Section
- **Email** — display-only row showing the signed-in email.
- **Change password** — email/password accounts: triggers `sendPasswordResetEmail` with confirmation alert → inline success/error feedback. OAuth accounts (Google/Apple): informational alert noting password is managed by the provider.
- **Language** — in-app language switcher. iOS: `ActionSheetIOS`. Android: `Alert` with options. Persisted to `AsyncStorage` via `features/auth/language-storage.ts`. Takes effect on next app launch.

### 3. Legal & Privacy Section
- **Privacy Policy** — opens `PRIVACY_POLICY_URL` via `Linking.openURL`. URL is a placeholder (D-103); replace before release.
- **Terms of Service** — opens `TERMS_URL` via `Linking.openURL`. URL is a placeholder; replace before release.

### 4. Support Section
- **Contact support** — opens `mailto:support@mychampions.app` via `Linking.openURL`.

### 5. Sign Out
- Outlined warning-color button.
- Confirmation alert before signing out.
- Calls `clearSession()` + `signOut(getFirebaseAuth())`.

### 6. Danger Zone
- Danger-tinted background group.
- Body copy explaining data retention policy.
- **Request account deletion** — destructive button; confirmation alert → `deleteProfileFromSource()` → `signOut()`; inline success/error feedback; disabled when offline.

### 7. App Version Footer
- Subtle centered text: "Version {app version}" from `Constants.expoConfig.version`.

## States
- Idle: all sections visible.
- Offline: `DsOfflineBanner` shown; account deletion CTA disabled.
- Password reset pending: row shows loading state.
- Password reset success: inline success banner replaces the row.
- Password reset error: inline error text below the row.
- Delete pending: CTA disabled.
- Delete success: inline success banner replaces the CTA.
- Delete error: inline error text above the CTA.

## Validation Rules
- Privacy policy URL and terms URL must be replaced with production URLs before release (D-103).
- Account deletion must be available for accounts created in-app (AC-306).
- Deletion flow communicates retention timeline (BR-231, AC-310).
- Change-password flow is only triggered for `password` provider accounts; OAuth accounts receive an informational message.
- Language override is stored device-local; no server sync required.

## Data Contract
- Inputs:
  - `useAuthSession()`: `currentUser`, `lockedRole`, `clearSession`, `termsUrl`.
  - `useNetworkStatus()`: connectivity state.
  - `getLanguageOverride()`: persisted locale preference.
- Outputs:
  - `deleteProfileFromSource()` + `signOut()`: account deletion.
  - `sendPasswordResetEmail()`: password reset email.
  - `setLanguageOverride()`: persisted locale preference.
  - `Linking.openURL()`: external URLs and mailto.

## Edge Cases
- `currentUser.displayName` is null for some accounts → fall back to email prefix.
- OAuth users tapping "Change password" → informational alert, no email sent.
- Offline → deletion CTA is disabled; all read-only rows remain accessible.
- Repeated deletion request → `already_requested` error state.
- Language change takes effect on next app launch; current session locale is unchanged.

## New Files Introduced
- `features/auth/language-storage.ts` — AsyncStorage read/write for language override key `app.language.override`.

## Links
- Functional requirement: FR-133, FR-157
- Use case: UC-002.5
- Acceptance criteria: AC-305, AC-306, AC-307, AC-308, AC-310
- Business rules: BR-225, BR-231
- Test cases: TC-304, TC-305, TC-306, TC-307, TC-309
- Decisions: D-045, D-103, D-025, D-014
