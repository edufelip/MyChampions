const booleanBypasses = new Set([
  'EXPO_PUBLIC_E2E_AUTH_SESSION',
  'EXPO_PUBLIC_E2E_CREATE_ACCOUNT',
  'EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN',
  'EXPO_PUBLIC_E2E_SOCIAL_AUTH',
]);

export function requireIntegratedLoopbackOrigin(origin: string): string {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('Integration requires an explicit loopback HTTP origin');
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.origin !== origin ||
    !url.port ||
    Number(url.port) < 1024 ||
    Number(url.port) > 65535
  )
    throw new Error('Integration requires an explicit loopback HTTP origin');
  return origin;
}

export function assertNoIntegratedBypasses(env: Readonly<Record<string, string | undefined>>) {
  for (const [key, raw] of Object.entries(env)) {
    if (!key.startsWith('EXPO_PUBLIC_E2E_')) continue;
    const value = raw?.trim() ?? '';
    if (value && !(booleanBypasses.has(key) && value.toLowerCase() === 'false'))
      throw new Error(`Integrated testing forbids bypass or fixture flag ${key}`);
  }
}

/** Validate inherited inputs before constructing a minimal, provider-free Expo environment. */
export function createIntegratedAppEnvironment(
  parent: Readonly<Record<string, string | undefined>>,
  target: { apiOrigin: string; appOrigin: string },
): NodeJS.ProcessEnv {
  requireIntegratedLoopbackOrigin(target.apiOrigin);
  requireIntegratedLoopbackOrigin(target.appOrigin);
  if (target.apiOrigin === target.appOrigin)
    throw new Error('Integration API must be distinct from Expo');
  assertNoIntegratedBypasses(parent);
  if (parent.APP_VARIANT && parent.APP_VARIANT !== 'dev')
    throw new Error('Integration requires the dev app variant');
  if (
    parent.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL &&
    parent.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL.trim() !== target.apiOrigin
  )
    throw new Error('Inherited API origin differs from the owned integration API');
  const env: Record<string, string | undefined> = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'SystemRoot']) {
    if (parent[key] !== undefined) env[key] = parent[key];
  }
  return {
    ...env,
    CI: '1',
    EXPO_OFFLINE: '1',
    EXPO_NO_DOTENV: '1',
    APP_VARIANT: 'dev',
    NODE_ENV: 'development',
    EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL: target.apiOrigin,
    EXPO_PUBLIC_TERMS_REQUIRED_VERSION: 'v1',
  };
}

/** Check the resolved Expo output as well as inputs before app startup. */
export function assertResolvedIntegratedExpoConfig(
  extra: Record<string, unknown>,
  apiOrigin: string,
) {
  requireIntegratedLoopbackOrigin(apiOrigin);
  const server = extra.server as { baseUrl?: unknown } | undefined;
  if (extra.appVariant !== 'dev' || server?.baseUrl !== apiOrigin)
    throw new Error('Resolved app variant or API origin does not match the integration target');
  const e2e = extra.e2e;
  if (!e2e || typeof e2e !== 'object' || Array.isArray(e2e))
    throw new Error('Missing resolved E2E configuration');
  if (
    Object.keys(e2e).sort().join(',') !==
    'acceptedTermsVersion,authSession,createAccount,emailPasswordSignIn,socialAuth'
  )
    throw new Error('Unexpected or incomplete resolved E2E configuration');
  for (const [key, raw] of Object.entries(e2e)) {
    if (typeof raw !== 'string') throw new Error('Invalid resolved E2E configuration');
    const value = raw.trim().toLowerCase();
    if (
      value &&
      !(
        key !== 'acceptedTermsVersion' &&
        ['authSession', 'createAccount', 'emailPasswordSignIn', 'socialAuth'].includes(key) &&
        value === 'false'
      )
    )
      throw new Error(`Resolved integration configuration enables ${key}`);
  }
  if (
    extra.revenueCatApiKeyIos ||
    extra.revenueCatApiKeyAndroid ||
    extra.revenueCatTestStoreEnabled
  )
    throw new Error('Provider-backed subscription configuration is outside this integration lane');
  for (const key of ['googleAuth', 'appleWebAuth']) {
    const config = extra[key];
    if (
      config &&
      (typeof config !== 'object' || Array.isArray(config) || Object.values(config).some(Boolean))
    )
      throw new Error('Provider-backed social configuration is outside this integration lane');
  }
}
