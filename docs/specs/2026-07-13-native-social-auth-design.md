# Native Social Auth Design

## Decision

Replace Google browser OAuth token capture with `@react-native-google-signin/google-signin` while preserving the existing `SocialAuthSourceInput` and `POST /auth/social/sign-in` server contract. Keep Apple token capture on `expo-apple-authentication`, add the missing Sign in with Apple entitlement to the manually maintained Xcode project, and fail release builds when the provisioning profile does not carry the same entitlement.

The MyChampions server and its Postgres repositories remain authoritative for
identity, profiles, and sessions. Google and Apple act only as external
credential issuers whose tokens the server verifies; this flow does not restore
Firebase Auth as an application runtime or backend baseline.

## Scope

- Google native token capture on iOS and Android.
- Google public client IDs supplied through Expo public env configuration; no client secret ships in the app.
- Existing server-side issuer, audience, signature, expiry, and identity checks remain authoritative.
- Apple native entitlement and release-profile validation.
- iOS Google callback URL registration derived from the actual iOS OAuth client ID once that provider client exists.

## Runtime Flow

1. Resolve the Google web client ID and, on iOS, the iOS client ID from `Constants.expoConfig.extra.googleAuth` with env fallback.
2. Configure `GoogleSignin` with `webClientId`, `iosClientId`, and `offlineAccess: false`.
3. On Android, verify Google Play Services before presenting sign-in.
4. Treat the SDK's `cancelled` response and `SIGN_IN_CANCELLED` error as the existing screen-level cancellation contract.
5. Require a nonblank `idToken` and send it to `signInWithSocialProviderTokenFromSource({ provider: 'google', idToken })`.
6. Do not exchange authorization codes in the app and do not send an access token the server does not need.

## Configuration Rules

- `EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID` is required for native Google sign-in.
- `EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID` is additionally required on iOS.
- `EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID` records the Android package/SHA registration and remains a production release gate even though the SDK does not accept an Android client ID at runtime.
- The server accepts configured Android, iOS, and web client IDs as Google token audiences.
- `ios/mychampions/Info.plist` registers the reversed production and development iOS client IDs; release CI derives and validates the production callback from the configured client ID.
- `config/google-oauth-production.json` pins the reviewed production Google clients, Android package, and Play app-signing SHA-1 used by release CI.
- `ios/mychampions/mychampions.entitlements` must contain `com.apple.developer.applesignin = [Default]`.
- The iOS release workflow must reject a provisioning profile without `com.apple.developer.applesignin` containing `Default`.

## Failure Behavior

- Missing client configuration: `SocialAuthSourceError('configuration')` before opening provider UI.
- Missing Google Play Services or SDK/network failure: provider-neutral `SocialAuthSourceError('network')`.
- User cancellation: preserve an error code containing `ERR_REQUEST_CANCELED` for existing screen handling.
- Missing ID token: `SocialAuthSourceError('invalid_credentials')` and no server request.
- Server rejection: preserve the existing `SocialAuthSourceError` returned by the server adapter.

## Verification

- Unit tests cover configuration, Android Play Services, successful token forwarding, cancellation response/error, missing token, and provider failure mapping.
- Static guards reject `expo-auth-session` in the Google adapter and require the native package, Apple entitlement, and provisioning-profile check.
- TypeScript, the full mobile unit suite, lint, Pod installation/native build checks, and production provider smoke complete before release enablement.
