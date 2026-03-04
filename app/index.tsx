import { Redirect } from 'expo-router';

/**
 * Root path always resolves through auth guard flow.
 * Public entry target stays the sign-in route.
 */
export default function IndexRedirect() {
  return <Redirect href="/auth/sign-in" />;
}
