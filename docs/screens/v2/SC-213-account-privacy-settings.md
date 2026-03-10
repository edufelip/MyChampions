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
- Shared screen uses role-aware visual treatment: professional users see the SC-204-inspired hero summary styling while student users retain profile-oriented framing.
- Hero summary card includes contextual account icon, concise helper copy, and role context pill for faster orientation.
- Grouped `<View>` rows styled as iOS-native settings groups (rounded, bordered).
- Offline communication uses `DsOfflineBanner` while preserving BL-008 write-lock restrictions.
- Section headers use compact uppercase DS caption pattern.
- Spacing between profile card and the first section header is reduced to half for a tighter layout.
- Top safe-area spacing is role-aware: Student Profile tab uses full top inset; Professional Account tab uses half inset.
- Interactive settings rows use icon chevrons and refined row height/spacing while preserving existing behavior contracts.

## Screen Sections (top → bottom)

### 1. Profile Header Card
- Avatar: initials circle (first char of `displayName`, fallback to email prefix, fallback `?`).
- Display name: `currentUser.displayName` → email prefix → `—`.
- Email: `currentUser.email`.
- Role badge pill: "Student" / "Professional" based on `lockedRole`.

### 2. Account Section
- **Email** — display-only row showing the signed-in email.
- **Change password** — email/password accounts: triggers `sendPasswordResetEmail` with confirmation alert → inline success/error feedback. OAuth accounts (Google/Apple): informational alert noting password is managed by the provider.
- **Language** — in-app language switcher. Tapping navigates to `/settings/language-select` (SC-222). The active locale is read from `LocaleContext`; the language label on this row updates immediately after returning from SC-222. Language override is persisted to `AsyncStorage` and takes effect in the current session — no app restart required.

### 3. Legal & Privacy Section
- **Privacy Policy** — opens `PRIVACY_POLICY_URL` in an internal WebView screen (`/shared/webview`).
- **Terms of Service** — opens `TERMS_URL` in an internal WebView screen (`/shared/webview`).

### 4. Support Section
- **Contact support** — opens a custom dialog for messaging support.
- **Support Dialog**:
  - **Disclaimer**: Explains this is for messaging the support team.
  - **Subject**: One-line input (max 50 chars).
  - **Message**: Multi-line input (max 500 chars).
  - **Submit Button**: Saves message to Firestore `supportMessages` collection.
  - **Success/Error states**: Inline feedback within the dialog.

### 5. Sign Out
- Outlined warning-color button.
- Confirmation alert before signing out.
- Calls `clearSession()` + `signOut(getFirebaseAuth())`.

### 6. Danger Zone
- Danger-tinted background group.
- Body copy explaining data retention policy.
- **Request account deletion** — destructive button; confirmation alert → `deleteAccountAndDataFromSource()` → `signOut()`; inline success/error feedback; disabled when offline.

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
  - `useLocale()`: `activeLocale` (current effective locale for the language row label).
- Outputs:
  - `deleteAccountAndDataFromSource()` + `signOut()`: account deletion.
  - `sendPasswordResetEmail()`: password reset email.
  - `router.push('/settings/language-select')`: navigates to SC-222 for language selection.
  - `Linking.openURL()`: external URLs and mailto.

## Edge Cases
- `currentUser.displayName` is null for some accounts → fall back to email prefix.
- OAuth users tapping "Change password" → informational alert, no email sent.
- Offline → deletion CTA is disabled; all read-only rows remain accessible.
- Repeated deletion request → `already_requested` error state.
- Language change takes effect immediately in the current session via `LocaleContext`; no app restart required.

## New Files Introduced
- `features/auth/language-storage.ts` — AsyncStorage read/write for language override key `app.language.override`.
- `localization/locale-context.tsx` — `LocaleProvider` + `useLocale()` hook for in-session locale switching (introduced with SC-222).
- `localization/use-translation.ts` — context-aware `useTranslation()` hook (introduced with SC-222).
- `app/settings/language-select.tsx` — dedicated Language Select screen SC-222 (navigated to from this screen's Language row).

## Links
- Functional requirement: FR-133, FR-157, FR-250, FR-251, FR-252, FR-253
- Use case: UC-002.5
- Acceptance criteria: AC-305, AC-306, AC-307, AC-308, AC-310, AC-520, AC-521, AC-522, AC-523, AC-524
- Business rules: BR-225, BR-231, BR-299, BR-300, BR-301, BR-302
- Test cases: TC-304, TC-305, TC-306, TC-307, TC-309, TC-310, TC-311, TC-312, TC-313, TC-314
- Decisions: D-045, D-103, D-025, D-014
