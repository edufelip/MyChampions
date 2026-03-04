import { Redirect } from 'expo-router';

/**
 * Root path enters the tab shell; auth/session routing is enforced globally
 * in app/_layout.tsx by resolveAuthGuardRedirect.
 */
export default function IndexRedirect() {
  return <Redirect href="/(tabs)" />;
}
