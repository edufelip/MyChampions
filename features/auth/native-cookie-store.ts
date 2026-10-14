/**
 * Clears React Native's native HTTP cookie store (NSHTTPCookieStorage on iOS,
 * the OkHttp cookie jar on Android). Native auth is bearer-only, but server
 * responses can still set cookies that the native networking layer would keep
 * sending after sign-out and relaunch (FR-270 / BR-342).
 */
export async function clearNativeCookies(): Promise<void> {
  // Lazily required: the networking module is react-native's Flow-typed
  // platform entry point, which a plain Node/tsx unit-test process cannot load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const networking = require('react-native/Libraries/Network/RCTNetworking') as {
    default: { clearCookies: (callback: (result: boolean) => void) => void };
  };
  await new Promise<void>((resolve) => networking.default.clearCookies(() => resolve()));
}
