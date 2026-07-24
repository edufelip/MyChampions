import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const parentWorkspaceContractPaths = [
  '../package.json',
  '../server/package.json',
  '../server/bun.lock',
  '../server/README.md',
  '../docs/superpowers/project-adapter.md',
  '../docs/superpowers/plans/2026-06-21-mobile-backend-postgres-source-task-card.md',
  '../docs/superpowers/plans/2026-06-22-feature-inventory-user-story-testing-task-card.md',
  '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md',
  '../docs/superpowers/specs/2026-06-21-mobile-backend-postgres-catalog-source-design.md',
];
const parentWorkspaceContractsAvailable = parentWorkspaceContractPaths.every((relativePath) =>
  existsSync(join(root, relativePath))
);
const parentWorkspaceTest = parentWorkspaceContractsAvailable ? test : test.skip;

const collectSourceFiles = (relativeDir: string): string[] => {
  const absoluteDir = join(root, relativeDir);

  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir).flatMap((entry) => {
    const relativePath = `${relativeDir}/${entry}`;
    const absolutePath = join(root, relativePath);
    const stat = statSync(absolutePath);

    if (stat.isDirectory()) {
      return collectSourceFiles(relativePath);
    }

    if (!/\.[cm]?[jt]sx?$/.test(relativePath)) {
      return [];
    }

    if (
      relativePath.endsWith('.test.ts') ||
      relativePath.endsWith('.test.tsx') ||
      relativePath.endsWith('.e2e.test.js')
    ) {
      return [];
    }

    return [relativePath];
  });
};

const collectTestFiles = (relativeDir: string): string[] => {
  const absoluteDir = join(root, relativeDir);

  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir).flatMap((entry) => {
    const relativePath = `${relativeDir}/${entry}`;
    const absolutePath = join(root, relativePath);
    const stat = statSync(absolutePath);

    if (stat.isDirectory()) {
      return collectTestFiles(relativePath);
    }

    if (
      relativePath.endsWith('.test.ts') ||
      relativePath.endsWith('.test.tsx') ||
      relativePath.endsWith('.e2e.test.js')
    ) {
      return [relativePath];
    }

    return [];
  });
};

const collectMatchingPaths = (relativeDir: string, predicate: (relativePath: string) => boolean): string[] => {
  const absoluteDir = join(root, relativeDir);

  if (!existsSync(absoluteDir)) {
    return [];
  }

  return readdirSync(absoluteDir).flatMap((entry) => {
    const relativePath = `${relativeDir}/${entry}`;
    const absolutePath = join(root, relativePath);
    const ignoredGeneratedTree =
      relativePath === 'ios/Pods' ||
      relativePath.startsWith('ios/Pods/') ||
      relativePath === 'ios/build' ||
      relativePath.startsWith('ios/build/') ||
      relativePath === 'android/.gradle' ||
      relativePath.startsWith('android/.gradle/');

    if (ignoredGeneratedTree) {
      return [];
    }

    let stat;
    try {
      stat = statSync(absolutePath);
    } catch {
      return [];
    }

    if (stat.isDirectory()) {
      return collectMatchingPaths(relativePath, predicate);
    }

    return predicate(relativePath) ? [relativePath] : [];
  });
};

test('mobile auth no longer keeps Firebase auth config modules', () => {
  const removedModules = [
    'features/auth/firebase.ts',
    'features/auth/firebase-social-auth.ts',
  ];

  for (const relativePath of removedModules) {
    assert.equal(
      existsSync(join(root, relativePath)),
      false,
      `${relativePath} should not exist after local server auth migration`
    );
  }
});

test('social auth source posts provider tokens to the MyChampions server without Firebase credentials', () => {
  const source = readFileSync(join(root, 'features/auth/social-auth-source.ts'), 'utf8');
  const forbiddenTokens = [
    'firebase/auth',
    'GoogleAuthProvider',
    'OAuthProvider',
    'signInWithCredential',
    'linkWithCredential',
    'getFirebaseAuth',
  ];

  for (const token of forbiddenTokens) {
    assert.equal(source.includes(token), false, `social-auth-source.ts should not contain ${token}`);
  }

  assert.equal(source.includes('/auth/social/sign-in'), true);
  assert.equal(source.includes('persistServerAuthSessionFromPayload'), true);
});

test('Apple social auth source captures native identity tokens without Firebase credentials', () => {
  const source = readFileSync(join(root, 'features/auth/apple-social-auth-source.ts'), 'utf8');
  const signInScreen = readFileSync(join(root, 'app/auth/sign-in.tsx'), 'utf8');
  const createAccountScreen = readFileSync(join(root, 'app/auth/create-account.tsx'), 'utf8');
  const forbiddenTokens = [
    'firebase/auth',
    'GoogleAuthProvider',
    'OAuthProvider',
    'signInWithCredential',
    'linkWithCredential',
    'getFirebaseAuth',
  ];

  for (const token of forbiddenTokens) {
    assert.equal(source.includes(token), false, `apple-social-auth-source.ts should not contain ${token}`);
  }

  assert.equal(source.includes("require('expo-apple-authentication')"), true);
  assert.equal(source.includes('signInWithSocialProviderTokenFromSource'), true);
  assert.equal(source.includes("provider: 'apple'"), true);
  assert.ok(
    signInScreen.indexOf('await signInWithAppleProviderTokenFromSource()') <
      signInScreen.indexOf("await signInWithServerSocialAuth('apple')")
  );
  assert.ok(
    createAccountScreen.indexOf('await signInWithAppleProviderTokenFromSource()') <
    createAccountScreen.indexOf("await signInWithServerSocialAuth('apple')")
  );
});

test('Google social auth source captures native provider tokens without Firebase credentials', () => {
  const source = readFileSync(join(root, 'features/auth/google-social-auth-source.ts'), 'utf8');
  const signInScreen = readFileSync(join(root, 'app/auth/sign-in.tsx'), 'utf8');
  const createAccountScreen = readFileSync(join(root, 'app/auth/create-account.tsx'), 'utf8');
  const forbiddenTokens = [
    'firebase/auth',
    'GoogleAuthProvider',
    'OAuthProvider',
    'signInWithCredential',
    'linkWithCredential',
    'getFirebaseAuth',
  ];

  for (const token of forbiddenTokens) {
    assert.equal(source.includes(token), false, `google-social-auth-source.ts should not contain ${token}`);
  }

  assert.equal(source.includes("require('@react-native-google-signin/google-signin')"), true);
  assert.equal(source.includes("require('expo-auth-session')"), false);
  assert.equal(source.includes('signInWithSocialProviderTokenFromSource'), true);
  assert.equal(source.includes("provider: 'google'"), true);
  assert.ok(
    signInScreen.indexOf('await signInWithGoogleProviderTokenFromSource()') <
      signInScreen.indexOf("await signInWithServerSocialAuth('google')")
  );
  assert.ok(
    createAccountScreen.indexOf('await signInWithGoogleProviderTokenFromSource()') <
      createAccountScreen.indexOf("await signInWithServerSocialAuth('google')")
  );
});

test('Google OAuth client ids are environment-driven and never hard-coded', () => {
  const source = readFileSync(join(root, 'features/auth/google-social-auth-source.ts'), 'utf8');
  const appConfig = readFileSync(join(root, 'app.config.ts'), 'utf8');
  const envExample = readFileSync(join(root, '.env.example'), 'utf8');
  const expectedConfigKeys = [
    'EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID',
  ];

  for (const key of expectedConfigKeys) {
    assert.equal(appConfig.includes(key), true, `app.config.ts should expose ${key}`);
    assert.equal(envExample.includes(key), true, `.env.example should document ${key}`);
  }

  for (const key of [
    'EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID',
    'EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID',
  ]) {
    assert.equal(source.includes(key), true, `google-social-auth-source.ts should read ${key}`);
  }

  assert.equal(appConfig.includes('googleAuth'), true);
  assert.equal(envExample.includes('client IDs are public OAuth client IDs'), true);
});

test('app config no longer requires Firebase env or exposes extra.firebase', () => {
  const appConfig = readFileSync(join(root, 'app.config.ts'), 'utf8');
  const appJson = readFileSync(join(root, 'app.json'), 'utf8');
  const envExample = readFileSync(join(root, '.env.example'), 'utf8');
  const localEnvPath = join(root, '.env');
  const localEnv = existsSync(localEnvPath) ? readFileSync(localEnvPath, 'utf8') : '';
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };

  for (const token of [
    'FirebaseConfig',
    'resolveFirebaseConfig',
    'FIREBASE_DEV',
    'FIREBASE_PROD',
    'extra: { firebase',
    'firebase,',
  ]) {
    assert.equal(appConfig.includes(token), false, `unexpected app.config Firebase token: ${token}`);
  }

  assert.equal(envExample.includes('FIREBASE_DEV_'), false);
  assert.equal(envExample.includes('FIREBASE_PROD_'), false);

  for (const token of [
    'FIREBASE_DEV_',
    'FIREBASE_PROD_',
    'Firebase Data Connect',
    'EXPO_PUBLIC_DATA_CONNECT_',
    'EXPO_PUBLIC_FOOD_SEARCH_FUNCTION_URL',
    'EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL',
  ]) {
    assert.equal(localEnv.includes(token), false, `.env still contains retired Firebase env token: ${token}`);
  }

  assert.equal(packageJson.dependencies?.firebase, undefined);
  assert.equal(packageJson.dependencies?.['@react-native-google-signin/google-signin'], '16.1.2');
  assert.equal(packageJson.dependencies?.['expo-auth-session'], undefined);
  assert.equal(packageJson.devDependencies?.['@firebase/rules-unit-testing'], undefined);
  assert.equal(packageJson.devDependencies?.['firebase-tools'], undefined);
  assert.equal(packageJson.scripts?.['test:rules'], undefined);
  assert.equal(packageJson.scripts?.['validate:firestore:smoke'], undefined);
  assert.equal(appJson.includes('"firebase"'), false, 'app.json should not expose extra.firebase');
  assert.equal(appJson.includes('dataConnect'), false, 'app.json should not keep legacy Data Connect placeholders');

  assert.equal(
    existsSync(join(root, 'package-lock.json')),
    false,
    'mobile package uses yarn; stale npm lockfiles can preserve removed Firebase packages'
  );

  const yarnLock = readFileSync(join(root, 'yarn.lock'), 'utf8');
  for (const token of [
    'firebase@',
    '@firebase/',
    'firebase-tools@',
    '@firebase/rules-unit-testing',
  ]) {
    assert.equal(yarnLock.includes(token), false, `yarn.lock still contains Firebase package token: ${token}`);
  }
});

parentWorkspaceTest('workspace package manifests and locks stay free of Firebase runtime packages', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const packageSurfaces: Record<string, string> = {
    'mychampions/package.json': readFileSync(join(root, 'package.json'), 'utf8'),
    'mychampions/yarn.lock': readFileSync(join(root, 'yarn.lock'), 'utf8'),
    'package.json': readFileSync(join(root, '../package.json'), 'utf8'),
    'server/package.json': readFileSync(join(root, '../server/package.json'), 'utf8'),
    'server/bun.lock': readFileSync(join(root, '../server/bun.lock'), 'utf8'),
  };

  for (const [label, source] of Object.entries(packageSurfaces)) {
    assert.equal(
      /"?(@react-native-firebase|@firebase\/rules-unit-testing|firebase-tools|firebase|dataconnect)[^"\s]*"?/i.test(source),
      false,
      `${label} still contains a Firebase/Data Connect package reference`
    );
  }

  assert.equal(taskCard.includes('A293 | Mobile package and lockfile Firebase dependency guard'), true);
});

parentWorkspaceTest('current task card records the active runtime Firebase-free audit', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A294 | Active mobile runtime Firebase-free audit'), true);
  assert.equal(
    taskCard.includes(
      'Active runtime source, native config, CI workflow, package/lock, and generated artifact scans returned no Firebase/Firestore/Data Connect matches outside test guard files'
    ),
    true
  );
});

test('active mobile backend sources stay routed through the MyChampions server', () => {
  const activeSourceFiles = [
    ...collectSourceFiles('app'),
    ...collectSourceFiles('features'),
    ...collectSourceFiles('components'),
    ...collectSourceFiles('hooks'),
    ...collectSourceFiles('constants'),
    'app.config.ts',
    'app.json',
    'package.json',
  ].filter((relativePath) => existsSync(join(root, relativePath)));
  const forbiddenBackendTokens = [
    { pattern: /foodservice\.eduwaldo\.com/i, label: 'legacy food service host' },
    { pattern: /exerciseservice\.eduwaldo\.com/i, label: 'legacy exercise service host' },
    { pattern: /cloudfunctions\.net/i, label: 'Firebase Cloud Functions host' },
    { pattern: /functions\.firebase/i, label: 'Firebase functions host' },
    { pattern: /firebaseio\.com/i, label: 'Firebase realtime/database host' },
    { pattern: /EXPO_PUBLIC_FOOD_SEARCH_FUNCTION_URL/, label: 'legacy food function env' },
    { pattern: /EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL/, label: 'legacy meal analysis function env' },
    { pattern: /EXPO_PUBLIC_EXERCISE_SEARCH_FUNCTION_URL/, label: 'legacy exercise function env' },
    { pattern: /EXPO_PUBLIC_FOOD_API_URL/, label: 'legacy food API env' },
    { pattern: /EXPO_PUBLIC_EXERCISE_API_URL/, label: 'legacy exercise API env' },
    { pattern: /EXPO_PUBLIC_DATA_CONNECT_/i, label: 'Data Connect env route' },
    { pattern: /\bdataConnect\b/i, label: 'Data Connect runtime route' },
  ];

  for (const relativePath of activeSourceFiles) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const { pattern, label } of forbiddenBackendTokens) {
      assert.equal(
        pattern.test(source),
        false,
        `${relativePath} still contains ${label}; active mobile backend calls must route through the root MyChampions server`
      );
    }
  }
});

parentWorkspaceTest('current task card records the active mobile backend boundary audit', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A295 | Active mobile backend boundary audit'), true);
  assert.equal(
    taskCard.includes(
      'Active mobile server-boundary source scan returned no legacy food/exercise service URLs, Firebase function URLs, or Data Connect env routes outside explicit test guard files'
    ),
    true
  );
});

parentWorkspaceTest('current task card records server-owned custom meal image upload path ownership', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A296 | Server-owned custom meal image upload path'), true);
  assert.equal(
    taskCard.includes(
      'Mobile image upload now sends only `meals/{mealId}/{filename}` to the MyChampions server; owner identity stays server-owned through the bearer token'
    ),
    true
  );
});

parentWorkspaceTest('current task card records Google provider-token network normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A297 | Google provider-token network error normalization'), true);
  assert.equal(
    taskCard.includes(
      'Google OAuth token exchange failures now map to the provider-neutral `network` social-auth source error'
    ),
    true
  );
});

parentWorkspaceTest('current task card records Apple provider-token network normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A298 | Apple provider-token network error normalization'), true);
  assert.equal(
    taskCard.includes(
      'Native Apple sign-in failures now map to the provider-neutral `network` social-auth source error while cancellation remains cancelable'
    ),
    true
  );
});

parentWorkspaceTest('current task card records Apple availability-check network normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A299 | Apple availability-check network error normalization'), true);
  assert.equal(
    taskCard.includes(
      'Thrown native Apple availability-check failures now map to `network` while unavailable Apple auth still maps to `configuration`'
    ),
    true
  );
});

parentWorkspaceTest('current task card records Google auth-request network normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A300 | Google auth-request network error normalization'), true);
  assert.equal(
    taskCard.includes(
      'Thrown Google auth-request failures now map to `network` while cancellation remains cancelable'
    ),
    true
  );
});

parentWorkspaceTest('current task card records Google redirect URI configuration normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A301 | Google redirect URI configuration error normalization'), true);
  assert.equal(
    taskCard.includes(
      'Thrown Google redirect URI construction failures now map to `configuration` before OAuth prompt startup'
    ),
    true
  );
});

parentWorkspaceTest('current task card records Google client-id configuration normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A302 | Google client-id configuration error normalization'), true);
  assert.equal(
    taskCard.includes(
      'Thrown Google OAuth client-id resolution failures now map to `configuration` before nonce creation or OAuth prompt startup'
    ),
    true
  );
});

parentWorkspaceTest('current task card records social-auth server URL configuration normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A303 | Social-auth server URL configuration error normalization'), true);
  assert.equal(
    taskCard.includes(
      'Thrown MyChampions server URL resolution failures now map to `configuration` before social-auth fetch startup'
    ),
    true
  );
});

parentWorkspaceTest('current task card records server-auth restore cleanup storage normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A304 | Server-auth restore cleanup storage normalization'), true);
  assert.equal(
    taskCard.includes(
      'Corrupted persisted server-auth sessions now fail closed even when storage cleanup removal fails'
    ),
    true
  );
});

parentWorkspaceTest('current task card records server-auth persisted refresh failure normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A305 | Server-auth persisted refresh failure normalization'), true);
  assert.equal(
    taskCard.includes(
      'Expired persisted server-auth sessions now fail closed when local refresh URL resolution or transport fails'
    ),
    true
  );
});

parentWorkspaceTest('current task card records server-auth refresh payload failure normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A306 | Server-auth refresh payload failure normalization'), true);
  assert.equal(
    taskCard.includes('Malformed local refresh payloads now fail closed during persisted server-auth restoration'),
    true
  );
});

parentWorkspaceTest('current task card records email-auth URL resolution failure normalization', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A307 | Email-auth URL resolution failure normalization'), true);
  assert.equal(
    taskCard.includes('Thrown email-auth server URL resolution failures now map to configuration errors'),
    true
  );
});

parentWorkspaceTest('current task card records the local Firebase-removal completion audit', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(taskCard.includes('A308 | Local Firebase-removal completion audit'), true);
  assert.equal(
    taskCard.includes(
      'Active mobile runtime, native config, CI/workflow, package/lock, and source-boundary scans are Firebase-free outside explicit retired-document and test-guard references'
    ),
    true
  );
});

test('legacy Firestore rules harness is retired from the mobile package', () => {
  assert.equal(existsSync(join(root, 'tests/firestore')), false);
  assert.equal(existsSync(join(root, 'scripts/validate-firestore-smoke.mjs')), false);
  assert.equal(
    existsSync(join(root, 'features/plans/training-plan-rules.contract.test.ts')),
    false,
    'Firestore rules contract tests should not remain after the rules file is retired'
  );
});

test('Firebase backend project files are retired from the mobile package', () => {
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');

  for (const relativePath of [
    '.firebaserc',
    'firebase.json',
    'firestore.indexes.json',
    'firestore.rules',
    'functions',
  ]) {
    assert.equal(
      existsSync(join(root, relativePath)),
      false,
      `${relativePath} should not remain after local server migration`
    );
  }

  for (const token of [
    'firebase-debug.log',
    'firestore-debug.log',
    'features/dataconnect-generated/',
    'firebase dataconnect:sdk:generate',
    'test-dc*.ts',
    'test-dc*.js',
  ]) {
    assert.equal(gitignore.includes(token), false, `.gitignore should not keep retired Firebase/Data Connect pattern: ${token}`);
  }

  const tsconfig = readFileSync(join(root, 'tsconfig.json'), 'utf8');
  assert.equal(tsconfig.includes('"functions"'), false);
  assert.equal(tsconfig.includes('functions/**/*'), false);
});

test('native app builds no longer require Firebase config files', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const androidRootGradle = readFileSync(join(root, 'android/build.gradle'), 'utf8');
  const androidAppGradle = readFileSync(join(root, 'android/app/build.gradle'), 'utf8');
  const iosProject = readFileSync(join(root, 'ios/mychampions.xcodeproj/project.pbxproj'), 'utf8');
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');

  assert.equal(packageJson.scripts?.['check:ios-firebase'], undefined);

  for (const scriptName of ['ios', 'ios:dev', 'ios:prod', 'ios:release']) {
    const script = packageJson.scripts?.[scriptName] ?? '';
    assert.equal(script.includes('check:ios-firebase'), false, `${scriptName} still runs Firebase config checks`);
  }

  assert.equal(existsSync(join(root, 'scripts/check-ios-firebase-config.mjs')), false);

  for (const relativePath of [
    'ios/mychampions/GoogleService-Info-Dev.plist',
    'ios/mychampions/GoogleService-Info-Prod.plist',
    'android/app/google-services.json',
  ]) {
    assert.equal(existsSync(join(root, relativePath)), false, `${relativePath} should not remain in the mobile tree`);
  }

  for (const [relativePath, source] of [
    ['android/build.gradle', androidRootGradle],
    ['android/app/build.gradle', androidAppGradle],
    ['ios/mychampions.xcodeproj/project.pbxproj', iosProject],
  ] as const) {
    for (const token of [
      'com.google.gms:google-services',
      'com.google.gms.google-services',
      'GoogleService-Info',
      'google-services.json',
      '[Firebase] Select GoogleService plist',
    ]) {
      assert.equal(source.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }

  const generatedFirebaseConfigArtifacts = [
    ...collectMatchingPaths('ios', (relativePath) => relativePath.endsWith('GoogleService-Info.plist')),
    ...collectMatchingPaths('android', (relativePath) => relativePath.endsWith('google-services.json')),
  ];
  assert.deepEqual(
    generatedFirebaseConfigArtifacts,
    [],
    `generated native Firebase config artifacts should not remain: ${generatedFirebaseConfigArtifacts.join(', ')}`
  );

  for (const token of [
    'GoogleService-Info.plist',
    'GoogleService-Info-Dev.plist',
    'GoogleService-Info-Prod.plist',
    'google-services.json',
    'google-services-dev.json',
  ]) {
    assert.equal(gitignore.includes(token), false, `.gitignore should not keep retired Firebase config pattern: ${token}`);
  }

  const issueTemplate = readFileSync(join(root, '.github/ISSUE_TEMPLATE/ci-cd-setup-checklist.md'), 'utf8');
  for (const token of [
    'Firebase',
    'firebase',
    'FIREBASE',
    'GOOGLE_SERVICE_INFO_PLIST',
    'GOOGLE_SERVICES_JSON',
    'GoogleService-Info',
    'google-services.json',
  ]) {
    assert.equal(
      issueTemplate.includes(token),
      false,
      `.github/ISSUE_TEMPLATE/ci-cd-setup-checklist.md still contains ${token}`
    );
  }
});

test('generated native build output does not preserve retired Firebase config', () => {
  const generatedLogPath = join(root, '.expo/xcodebuild.log');
  const generatedLog = existsSync(generatedLogPath) ? readFileSync(generatedLogPath, 'utf8') : '';

  for (const token of [
    '[Firebase] Select GoogleService plist',
    'GoogleService-Info',
    'mychampions-fb928',
    'extra.firebase',
  ]) {
    assert.equal(generatedLog.includes(token), false, `.expo/xcodebuild.log still contains ${token}`);
  }

  const generatedFirebaseArtifacts = [
    'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app/GoogleService-Info.plist',
    'ios/build/Build/Products/Debug-iphonesimulator/mychampions.app/EXConstants.bundle/app.config',
  ];

  for (const relativePath of generatedFirebaseArtifacts) {
    const artifactPath = join(root, relativePath);

    if (!existsSync(artifactPath)) {
      continue;
    }

    const artifactSource = readFileSync(artifactPath, 'utf8');
    for (const token of [
      'GoogleService-Info',
      '"firebase"',
      'mychampions-fb928',
      'firebasestorage.app',
    ]) {
      assert.equal(artifactSource.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }
});

test('CI workflows no longer target Firebase release or config surfaces', () => {
  const forbiddenWorkflowFiles = [
    '.github/workflows/firebase-distribution-android.yml',
    '.github/workflows/firebase-distribution-ios.yml',
  ];

  for (const relativePath of forbiddenWorkflowFiles) {
    assert.equal(existsSync(join(root, relativePath)), false, `${relativePath} should be retired`);
  }

  for (const relativePath of [
    '.github/workflows/android-pr.yml',
    '.github/workflows/android-release.yml',
    '.github/workflows/ios-pr.yml',
    '.github/workflows/ios-release.yml',
  ]) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const token of [
      'Firebase',
      'firebase',
      'FIREBASE',
      'GoogleService-Info',
      'google-services.json',
      'GOOGLE_SERVICE_INFO_PLIST',
      'GOOGLE_SERVICES_JSON',
      'com.googleusercontent.apps.',
    ]) {
      assert.equal(source.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }
});

test('auth localization no longer tells users to set Firebase keys', () => {
  for (const relativePath of [
    'localization/en-US.ts',
    'localization/es-ES.ts',
    'localization/pt-BR.ts',
  ]) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    const forbidden = ['Firebase keys', 'claves de Firebase', 'chaves do Firebase'];

    for (const token of forbidden) {
      assert.equal(source.includes(token), false, `${relativePath} still mentions ${token}`);
    }
  }
});

test('current auth docs and active screen comments no longer describe Firebase as the backend', () => {
  const filesToCheck = [
    '.env.example',
    'README.md',
    'GEMINI.md',
    'docs/screens/v2/SC-217-auth-sign-in.md',
    'docs/screens/v2/SC-218-auth-create-account.md',
    'docs/screens/v2/SC-202-professional-specialty-setup.md',
    'docs/screens/v2/SC-207-nutrition-plan-builder.md',
    'docs/screens/v2/SC-208-training-plan-builder.md',
    'docs/screens/v2/SC-213-account-privacy-settings.md',
    'docs/screens/v2/SC-214-custom-meal-builder.md',
    'docs/screens/v2/SC-215-custom-meal-library-and-quick-log.md',
    'docs/screens/v2/localized-copy-table-v2.md',
    'app/(tabs)/nutrition/custom-meals/[mealId].tsx',
    'app/(tabs)/nutrition/custom-meals/index.tsx',
    'app/shared/recipes/[shareToken].tsx',
    'app/professional/nutrition.tsx',
    'app/professional/training.tsx',
    'app/professional/student-profile.tsx',
    'app/professional/students.tsx',
    'features/connections/use-connections.ts',
    'features/analytics/use-analytics.ts',
    'features/debug/logging.ts',
    'features/plans/use-exercise-thumbnail.ts',
    'features/plans/plan-builder.logic.ts',
    'features/nutrition/meal-photo-analysis.logic.ts',
    'features/nutrition/use-meal-photo-analysis.ts',
    'features/nutrition/image-upload.logic.ts',
    'features/nutrition/image-upload-source.ts',
  ];
  const staleBackendClaims = [
    'Firebase Auth',
    'Firebase keys',
    'Firebase project keys',
    'claves de Firebase',
    'chaves do Firebase',
    'Firestore rules',
    'Firebase Functions',
    'native Firebase config files',
    'Firestore-backed',
    'Firestore profile write failure',
    'Firebase Cloud Storage',
    'Cloud Function response',
    'Cloud Function proxy',
    'uploadBytesResumable',
    'getDownloadURL',
    'Firebase Auth UID',
    'Current backend baseline is Firebase',
    'Firebase baseline',
    'EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL',
    'EXPO_PUBLIC_SUBMIT_INVITE_FUNCTION_URL',
    'EXPO_PUBLIC_REMOVE_SPECIALTY_FUNCTION_URL',
    'EXPO_PUBLIC_FOOD_SEARCH_SERVICE_URL',
    'Firestore connection records',
    'Authorization: Bearer <Firebase ID token>',
    'Saves message to Firestore',
    'writes the current local draft to Firestore',
    'persisted to Firestore',
    'stored in Firestore',
    'Firestore is not called',
    'Firebase Storage fallback',
    'Firebase Analytics',
    'Firebase source modules',
    'Cloud Storage quota',
    'otherwise fail closed until the local/Supabase bridge is implemented',
    'Social auth is pending the MyChampions server/Supabase bridge',
    'local development fails closed outside explicit E2E fixtures',
    'fails closed until the server/Supabase bridge is implemented',
    'Data Connect endpoint stub',
    'Share link generation is deferred',
    'source layer is stubbed',
    'Data Connect meal source wiring is complete',
    'logPortion SDK operation',
    'being migrated off Firebase runtime services',
  ];

  for (const relativePath of filesToCheck) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const token of staleBackendClaims) {
      assert.equal(source.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }
});

test('production mobile source files no longer mention Firebase provider boundaries', () => {
  const sourceFiles = [
    ...collectSourceFiles('app'),
    ...collectSourceFiles('components'),
    ...collectSourceFiles('constants'),
    ...collectSourceFiles('features'),
    ...collectSourceFiles('hooks'),
    ...collectSourceFiles('localization'),
  ];
  const providerTerms = ['Firebase', 'firebase', 'Firestore', 'firestore', 'Data Connect'];

  for (const relativePath of sourceFiles) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const term of providerTerms) {
      assert.equal(source.includes(term), false, `${relativePath} still contains ${term}`);
    }
  }
});

test('server auth source is documented as the active local boundary, not temporary provider scaffolding', () => {
  const source = readFileSync(join(root, 'features/auth/server-auth-source.ts'), 'utf8');

  assert.equal(source.includes('local-only scaffolding'), false);
  assert.equal(source.includes('remote auth provider is not set up'), false);
  assert.equal(source.includes('external provider tokens'), false);
  assert.equal(source.includes('Local MyChampions server auth source.'), true);
  assert.equal(source.includes('current local auth boundary'), true);
});

test('mobile tests no longer describe server-backed paths as Firestore precedence', () => {
  const testFiles = collectTestFiles('features').filter(
    (relativePath) => relativePath !== 'features/auth/firebase-config-removal-scan.test.ts'
  );
  const staleTestPhrases = [
    'before Firestore',
    'without Firestore',
    'Firebase / Expo dependencies',
  ];

  for (const relativePath of testFiles) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const phrase of staleTestPhrases) {
      assert.equal(source.includes(phrase), false, `${relativePath} still contains ${phrase}`);
    }
  }
});

test('current product requirements no longer require Firebase provider surfaces', () => {
  const currentDocs = [
    'docs/functional-requirements/FR-001-domain-role-and-care-plans.md',
    'docs/acceptance-criteria/AC-005-mobile-platform-and-delivery-nfr.md',
    'docs/test-cases/TC-005-mobile-platform-and-delivery-nfr.md',
    'docs/acceptance-criteria/AC-002-role-journeys-and-plan-ownership.md',
    'docs/test-cases/TC-002-role-and-assignment-controls.md',
    'docs/use-cases/UC-002-role-onboarding-and-care-management.md',
    'docs/business-rules/BR-002-role-assignment-and-plan-governance.md',
    'docs/discovery/open-questions-v1.md',
    'docs/specs/README.md',
    'docs/specs/mobile-nfr-tech-stack-spec.md',
  ];
  const staleRequirementClaims = [
    'Firebase App Distribution',
    'Firebase Cloud Storage',
    'Firebase Crashlytics',
    'Crashlytics-only',
    'Firebase Cloud Function',
    'Firebase Auth ID token',
    'Firebase ID token authorization',
    'Authorization: Bearer <Firebase ID token>',
    'Firebase Auth session',
    'Firebase Auth `providerData`',
    'Active Firebase UID',
    'legacy Firebase Auth path',
    'legacy Firestore/Cloud Function',
    'direct client Firestore',
    'Firebase SDK current user',
    'Firebase-currentUser',
    'Firestore is updated',
    'transient Firestore',
    'existing Firestore profile',
    'Firestore profile',
    'retired-app-domain-persistence-contract-v1.md',
    'falling back to the legacy',
    'falling back to Firestore',
    'Firestore path',
    'Cloud Function call',
    'Cloud Function returns',
    'Cloud Function proxy',
    'Social auth is pending the MyChampions server/Supabase bridge',
    'local development fails closed outside explicit E2E fixtures',
  ];

  for (const relativePath of currentDocs) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const token of staleRequirementClaims) {
      assert.equal(source.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }
});

test('current architecture docs no longer present Firebase as the active backend', () => {
  const docsToCheck = [
    'docs/specs/retired-app-domain-persistence-contract-v1.md',
    'docs/discovery/D-114-retired-starter-template-persistence.md',
    'docs/diagrams/mobile-stack-high-level-v1.md',
    'docs/superpowers/specs/2026-06-02-ai-provider-abstraction-design.md',
  ];
  const staleCurrentArchitectureClaims = [
    'Define the implementation contract for app-domain persistence in Firebase Cloud Firestore',
    'App-domain persistence now uses Firebase Cloud Firestore via Firebase JS SDK',
    'Source modules use Firestore collections/documents directly behind source-layer boundaries',
    'Firebase Auth manages identity',
    'Firestore stores domain entities in collections/documents',
    'Firebase Cloud Storage remains media store',
    'App variant still selects Firebase project credentials',
    'npm run validate:firestore:smoke',
    'A --> B[Firebase Auth]',
    'A --> C[Firebase Cloud Firestore]',
    'A --> D[Firebase Cloud Storage]',
    'A --> H[Firebase Crashlytics]',
    'Firebase Functions meal-photo analyzer provider boundary',
    'Create a provider-neutral analyzer contract in Firebase Functions',
    'Update Cloud Function wiring:',
    'Firebase Secret Manager secret',
    'provider-neutral Cloud Function analyzer',
  ];

  for (const relativePath of docsToCheck) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const token of staleCurrentArchitectureClaims) {
      assert.equal(source.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }
});

test('retired provider docs use server-owned archival filenames', () => {
  const providerNamedDocs = collectMatchingPaths('docs', (relativePath) =>
    relativePath.endsWith('.md') && /firebase|firestore|data-connect|dataconnect/i.test(relativePath)
  );

  assert.deepEqual(
    providerNamedDocs,
    [],
    `retired provider docs should not keep Firebase/Data Connect branded filenames: ${providerNamedDocs.join(', ')}`
  );
});

test('Firebase-era superpower plans are explicitly marked superseded', () => {
  const historicalPlanFiles = [
    'docs/superpowers/plans/2026-06-01-nutritionist-experience-governance.md',
    'docs/superpowers/plans/2026-06-02-ai-provider-abstraction.md',
  ];
  const requiredBannerLines = [
    '**Status:** Historical / superseded by the local MyChampions server migration.',
    'Do not execute this plan as current Firebase implementation guidance.',
  ];

  for (const relativePath of historicalPlanFiles) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const line of requiredBannerLines) {
      assert.equal(source.includes(line), true, `${relativePath} is missing superseded banner line: ${line}`);
    }
  }
});

test('Firebase-era superpower specs are explicitly marked superseded', () => {
  const historicalSpecFiles = [
    'docs/superpowers/specs/2026-06-02-ai-provider-abstraction-design.md',
  ];
  const requiredBannerLines = [
    '**Status:** Historical / superseded by the local MyChampions server migration.',
    'Do not execute this design as current Firebase implementation guidance.',
    'Current meal-photo analyzer work belongs in the root MyChampions server analyzer boundary and focused mobile source tests.',
  ];

  for (const relativePath of historicalSpecFiles) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const line of requiredBannerLines) {
      assert.equal(source.includes(line), true, `${relativePath} is missing superseded banner line: ${line}`);
    }
  }
});

test('older Firebase-era implementation docs are explicitly marked superseded', () => {
  const historicalImplementationDocs = [
    'docs/plans/2026-05-31-plan-customization-and-student-tracking-plan.md',
    'docs/specs/2026-05-31-plan-customization-and-student-tracking-design.md',
  ];
  const requiredBannerLines = [
    '**Status:** Historical / superseded by the local MyChampions server migration.',
    'Do not execute this document as current Firebase implementation guidance.',
  ];

  for (const relativePath of historicalImplementationDocs) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const line of requiredBannerLines) {
      assert.equal(source.includes(line), true, `${relativePath} is missing superseded banner line: ${line}`);
    }
  }
});

test('retired plan customization doc no longer carries executable Firestore implementation steps', () => {
  const source = readFileSync(
    join(root, 'docs/plans/2026-05-31-plan-customization-and-student-tracking-plan.md'),
    'utf8'
  );
  const retiredInstructionTokens = [
    'REQUIRED SUB-SKILL',
    '- [ ] **Step',
    'firestore.rules',
    'scripts/validate-firestore-smoke.mjs',
    "firebase/firestore",
    'getFirestoreInstance',
    'npm run validate:firestore:smoke',
    'firebase emulators',
    'git commit -m',
  ];

  for (const token of retiredInstructionTokens) {
    assert.equal(source.includes(token), false, `retired plan customization doc still contains ${token}`);
  }
});

test('retired plan customization spec no longer carries executable Firestore design sections', () => {
  const source = readFileSync(
    join(root, 'docs/specs/2026-05-31-plan-customization-and-student-tracking-design.md'),
    'utf8'
  );
  const retiredDesignTokens = [
    'participant FS as Firestore',
    'Pro->>FS',
    'Firestore Schema & Rules Changes',
    'firestore.rules',
    'workoutLogs` collection',
    'creates a Firestore plan copy',
    'creates a new document in the `portionLogs` collection',
    'creates a document in `workoutLogs`',
  ];

  for (const token of retiredDesignTokens) {
    assert.equal(source.includes(token), false, `retired plan customization spec still contains ${token}`);
  }
});

test('retired nutritionist governance superpower plan no longer carries executable Firestore tasks', () => {
  const source = readFileSync(
    join(root, 'docs/superpowers/plans/2026-06-01-nutritionist-experience-governance.md'),
    'utf8'
  );
  const retiredPlanTokens = [
    'REQUIRED SUB-SKILL',
    '- [ ] **Step',
    'Firebase Auth/Firestore/Storage',
    '@firebase/rules-unit-testing',
    'firebase-tools',
    'firebase emulators:exec',
    'tests/firestore/nutrition-governance.rules.test.ts',
    'firestore.rules',
    'yarn test:rules',
    'git commit -m',
  ];

  for (const token of retiredPlanTokens) {
    assert.equal(source.includes(token), false, `retired nutritionist governance plan still contains ${token}`);
  }
});

test('retired AI provider superpower plan no longer carries executable Firebase Functions tasks', () => {
  const source = readFileSync(
    join(root, 'docs/superpowers/plans/2026-06-02-ai-provider-abstraction.md'),
    'utf8'
  );
  const retiredPlanTokens = [
    'REQUIRED SUB-SKILL',
    '- [ ] **Step',
    'Firebase Functions Gen 2',
    'Firebase Secret Manager',
    'functions/src/index.ts',
    'functions/src/openai-helpers.ts',
    'OPENAI_API_KEY',
    'EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL',
    'yarn --cwd functions',
    'git commit -m',
  ];

  for (const token of retiredPlanTokens) {
    assert.equal(source.includes(token), false, `retired AI provider plan still contains ${token}`);
  }
});

parentWorkspaceTest('parent evidence adapter no longer recommends retired Firebase mobile checks', () => {
  const adapter = readFileSync(join(root, '..', 'docs/superpowers/project-adapter.md'), 'utf8');
  const retiredEvidenceCommands = [
    'yarn test:rules',
    'yarn check:ios-firebase',
    'node scripts/validate-firestore-smoke.mjs',
    'yarn validate:firestore:smoke',
    'Firebase emulator output is valid rules evidence',
  ];

  for (const token of retiredEvidenceCommands) {
    assert.equal(adapter.includes(token), false, `project adapter still recommends retired Firebase evidence: ${token}`);
  }
});

parentWorkspaceTest('parent catalog-source docs no longer preserve Firebase-authenticated mobile food search', () => {
  const parentCatalogDocs = [
    '../docs/superpowers/specs/2026-06-21-mobile-backend-postgres-catalog-source-design.md',
    '../docs/superpowers/plans/2026-06-21-mobile-backend-postgres-source-task-card.md',
  ];
  const staleCatalogAuthClaims = [
    'Do not change Firebase/RevenueCat/auth behavior except for required mobile service URL config.',
    'Food remains Firebase-authenticated',
    'Food auth stays enforced',
  ];

  for (const relativePath of parentCatalogDocs) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const token of staleCatalogAuthClaims) {
      assert.equal(source.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }
});

parentWorkspaceTest('current Firebase-removal task card no longer treats full mobile Firebase removal as out of scope', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  const staleScopeClaims = [
    'Do not remove all Firebase mobile usage in this slice.',
    'Do not remove all Firebase mobile usage',
    'Firebase mobile usage in this slice',
  ];

  for (const claim of staleScopeClaims) {
    assert.equal(taskCard.includes(claim), false, `current Firebase-removal task card still says: ${claim}`);
  }
});

parentWorkspaceTest('current Firebase-removal task card affected surfaces reflect migrated CI and provider scope', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  const staleSurfaceClaims = [
    '| CI/deploy | Not changed |',
    '| External providers | Supabase dependency only |',
    'No live Supabase/Firebase mutation.',
  ];

  for (const claim of staleSurfaceClaims) {
    assert.equal(taskCard.includes(claim), false, `current task-card surface map still says: ${claim}`);
  }

  assert.equal(taskCard.includes('Firebase App Distribution workflows'), true);
  assert.equal(taskCard.includes('RevenueCat'), true);
  assert.equal(taskCard.includes('self-managed auth/storage'), true);
});

parentWorkspaceTest('current Firebase-removal task card no longer frames local migration as scaffold-only', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const staleScaffoldClaims = [
    'not required for local-only scaffold',
    'Endpoint documented as local scaffolding.',
    'Documented as local scaffold',
    'Required: No for this local-only scaffold.',
  ];

  for (const claim of staleScaffoldClaims) {
    assert.equal(taskCard.includes(claim), false, `current task card still frames migration as scaffold-only: ${claim}`);
  }

  assert.equal(taskCard.includes('local migration bridge'), true);
  assert.equal(taskCard.includes('local-only migration work'), true);
});

parentWorkspaceTest('current Firebase-removal task card no longer tells workers to defer or roll back migrated mobile sources', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const staleMigrationGuidance = [
    'deploy ordering: local server contract first, mobile source rewiring later.',
    'rollback behavior: restore the previous `profile-source` provider implementation and remove/ignore `server/`.',
    'Keep as local server foundation plus profile/support source rewiring; do not deploy until auth/storage and remaining mobile sources are designed and tested.',
  ];

  for (const claim of staleMigrationGuidance) {
    assert.equal(taskCard.includes(claim), false, `current task card still has stale migration guidance: ${claim}`);
  }

  assert.equal(taskCard.includes('deploy ordering: keep local server and migrated mobile source boundaries together'), true);
  assert.equal(taskCard.includes('rollback behavior: revert only the specific failing migration slice'), true);
  assert.equal(taskCard.includes('Keep as local Firebase-removal migration evidence'), true);
});

parentWorkspaceTest('current Firebase-removal acceptance matrix no longer treats Firestore fallbacks as pending current behavior', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const acceptanceMatrix = taskCard.slice(
    taskCard.indexOf('## Acceptance Matrix'),
    taskCard.indexOf('## Open Questions')
  );
  const staleFallbackClaims = [
    'Firestore fallback removal is tracked',
    'falling back to Firestore for unmigrated sessions',
    'full Firestore fallback removal is tracked',
    'Full Firestore fallback removal is tracked',
    'Firestore helpers load only inside the no-server legacy fallback',
    'legacy Firebase session subscription and current-user reads are lazy fallback behavior',
  ];

  for (const claim of staleFallbackClaims) {
    assert.equal(
      acceptanceMatrix.includes(claim),
      false,
      `acceptance matrix still preserves stale Firebase fallback claim: ${claim}`
    );
  }

  assert.equal(acceptanceMatrix.includes('fails closed without Firestore fallback'), true);
});

parentWorkspaceTest('current Firebase-removal acceptance matrix no longer preserves Firebase-shaped auth token contracts', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const acceptanceMatrix = taskCard.slice(
    taskCard.indexOf('## Acceptance Matrix'),
    taskCard.indexOf('## Open Questions')
  );
  const staleAuthContractClaims = [
    'expose a user-shaped object with `getIdToken`',
    'Profile hydration prefers a provider-neutral `getAccessToken()`',
  ];

  for (const claim of staleAuthContractClaims) {
    assert.equal(
      acceptanceMatrix.includes(claim),
      false,
      `acceptance matrix still preserves stale auth token contract: ${claim}`
    );
  }

  assert.equal(
    acceptanceMatrix.includes('Profile hydration resolves access through the central MyChampions server token source'),
    true
  );
});

parentWorkspaceTest('current Firebase-removal task card final evidence table describes the latest A308 continuation', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const finalEvidence = taskCard.slice(
    taskCard.indexOf('## Final Evidence Report'),
    taskCard.indexOf('## Human Approval')
  );
  const staleLatestEvidenceLabels = [
    'latest auth-screen ordering cleanup',
    'latest mobile source cleanup',
    'latest provider-user bridge cleanup',
  ];

  for (const label of staleLatestEvidenceLabels) {
    assert.equal(taskCard.includes(label), false, `final evidence table still points latest evidence at old slice: ${label}`);
  }

  assert.equal(taskCard.includes('Latest continuation updated this task card with A228'), false);
  assert.equal(taskCard.includes('No integration route was rerun in this A228 docs/evidence continuation'), false);
  assert.equal(taskCard.includes('No E2E run was needed for this A228 docs/evidence continuation'), false);
  assert.equal(taskCard.includes('No build command was needed for this A228 docs/evidence continuation'), false);
  assert.equal(taskCard.includes('No deploy/config command was needed for this A228 docs/evidence continuation'), false);
  assert.equal(
    finalEvidence.includes('Latest continuation: `cd mychampions && yarn test:unit` passed 1,216 tests across 72 suites'),
    true
  );
  assert.equal(
    finalEvidence.includes('`cd server && ../.local-bun/bin/bun test` passed 191 tests across 40 files under Bun `1.3.10`'),
    true
  );
  assert.equal(
    finalEvidence.includes('Active mobile runtime, native config, CI/workflow, package/lock, and source-boundary scans are Firebase-free outside explicit retired-document and test-guard references'),
    true
  );
  assert.equal(finalEvidence.includes('No E2E run was needed for this A308 local Firebase-removal completion audit continuation'), true);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A307 focused email-auth URL resolution failure normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A306 focused server-auth refresh payload failure normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A305 focused server-auth persisted refresh failure normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A304 focused server-auth restore cleanup normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A303 focused social-auth server URL configuration normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A302 focused Google client-id configuration normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A301 focused Google redirect URI configuration normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A300 focused Google auth-request network normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A299 focused Apple availability-check network normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A298 focused Apple provider-token network normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A297 focused Google provider-token network normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A296 server-owned custom meal image upload path continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A295 active mobile backend boundary audit continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A294 active runtime Firebase-free audit continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A293 focused package/lockfile dependency guard continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A292 focused local subscription snapshot read continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A291 focused meal-photo auth-error normalization continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A290 focused meal-photo provider-request contract continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A289 focused meal-photo blank-image guard continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A288 focused meal-photo prompt ownership continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A287 focused local meal-photo analysis size-cap continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A286 focused server-auth source local-boundary wording cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A285 focused mobile README local-server wording cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A284 focused server README active-auth wording cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A283 focused server README invite-submission wording cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A282 focused task-card local-dev bridge wording cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A281 focused server README contract continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A278 focused local dev-session variant-gate continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A277 focused subscription server-boundary wording continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A276 focused server README social-auth contract continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A275 focused server README contract continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A274 focused server-owned email verification session-state continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A273 focused language-switcher decision-log cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A272 focused support wording cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A271 focused legal URL decision-log cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A270 focused D-097 role-lock wording cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A269 focused D-104 professional tab decision-log cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A268 focused pending-tracker professional plan-library cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A267 focused plan-change notification decision-log cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A266 focused offline freshness decision-log cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A265 focused plan-builder localization stub-key cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A264 focused meal-photo analysis docs cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A263 focused auth terms provider-placeholder cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A262 focused auth-session API cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A261 focused mobile email-auth fallback removal continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A260 focused social-auth acceptance wording cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A259 focused auth-contract documentation cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A258 focused profile-token cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A257 focused acceptance-matrix cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A256 focused root server-script pinning continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A255 focused health runtime continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A254 focused workspace-local Bun continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A253 focused local doctor continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A252 focused Bun runtime enforcement continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A251 focused parent Bun runtime pin continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A250 focused Bun-first local setup docs continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A249 focused auth-screen social fallback cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A248 focused task-card social fallback cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A247 focused social-auth docs fallback cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A246 focused decision-log social fallback cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A245 focused pending-tracker top-level social fallback cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A244 focused pending-tracker auth status cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A243 focused pending-tracker social fallback wording cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A242 focused pending-tracker top-level email cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A241 focused auth-docs local credential cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A240 focused pending-tracker cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A239 focused local email credential continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A238 focused retired-design cleanup continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A237 focused compliance-evidence continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A236 focused local account deletion repository continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A235 focused RevenueCat webhook boundary continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A234 focused password-reset delivery gateway continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A233 focused local password-reset outbox continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A232 focused native Google token-capture continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A231 focused native Apple token-capture continuation'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A230 focused mobile social-auth source continuation'), false);
  assert.equal(finalEvidence.includes('Latest continuation: `cd mychampions && yarn tsx --test features/auth/google-social-auth-source.test.ts` passed 4 tests'), false);
  assert.equal(finalEvidence.includes('Latest continuation: `cd server && bun test tests/auth-account.test.ts tests/password-reset.test.ts tests/postgres-password-reset-service.test.ts` passed 7 tests / 22 expects'), false);
  assert.equal(finalEvidence.includes('`cd mychampions && yarn tsx --test features/analytics/auth-onboarding-runtime.test.ts` passed 5 tests'), false);
  assert.equal(finalEvidence.includes('passed 43 tests after adding the source-boundary guard and A230 evidence'), false);
  assert.equal(finalEvidence.includes('passed 42 tests after adding A229'), false);
  assert.equal(finalEvidence.includes('No E2E run was needed for this A229 focused route/source continuation'), false);
  assert.equal(finalEvidence.includes('passed 38 tests after adding A226'), false);
  assert.equal(
    finalEvidence.includes('| Unit tests | Latest continuation: `cd mychampions && yarn tsx --test features/auth/firebase-config-removal-scan.test.ts` passed 39 tests'),
    false
  );
  assert.equal(
    finalEvidence.includes('| Unit tests | Latest continuation: `cd mychampions && yarn tsx --test features/auth/firebase-config-removal-scan.test.ts` passed 40 tests'),
    false
  );
  assert.equal(finalEvidence.includes('passed 41 tests after adding A228'), false);
});

parentWorkspaceTest('current auth docs reserve deterministic local dev sessions for explicit local dev variants', () => {
  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');
  const pendingChecklist = readFileSync(join(root, 'docs/discovery/pending-wiring-checklist-v1.md'), 'utf8');
  const businessRules = readFileSync(join(root, 'docs/business-rules/BR-002-role-assignment-and-plan-governance.md'), 'utf8');
  const requirements = readFileSync(join(root, 'docs/functional-requirements/FR-001-domain-role-and-care-plans.md'), 'utf8');
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const docs = [
    ['decisions log', decisionsLog],
    ['pending tracker', pendingChecklist],
    ['business rules', businessRules],
    ['functional requirements', requirements],
    ['task card', taskCard],
  ] as const;
  const broadClaims = [
    'non-production local dev-session',
    'non-production development uses deterministic local',
    'non-production sign-in/create-account could use the local server dev-session endpoint',
    'deterministic non-production/E2E sessions',
    'deterministic dev sessions remain a non-production/E2E bridge',
    'production variants must not use the deterministic local dev-session',
    'production must not use the deterministic local dev-session',
    'must not be used for production app variants',
  ];

  for (const [label, source] of docs) {
    for (const claim of broadClaims) {
      assert.equal(source.includes(claim), false, `${label} still scopes deterministic local dev sessions too broadly: ${claim}`);
    }
  }

  assert.equal(
    decisionsLog.includes('Deterministic local sessions are reserved for explicit local/dev provider-token configuration gaps outside E2E fixtures.'),
    true
  );
  assert.equal(
    pendingChecklist.includes('deterministic local dev-session fallback is available only in explicit local/dev app variants for explicit provider-token configuration gaps'),
    true
  );
  assert.equal(
    businessRules.includes('non-dev app variants must not use the deterministic local dev-session endpoint'),
    true
  );
  assert.equal(
    requirements.includes('the deterministic local dev-session endpoint must not be used for non-dev app variants'),
    true
  );
  assert.equal(
    taskCard.includes('Deterministic local dev-session endpoints are allowed only when the app variant is unset, blank, or `dev`'),
    true
  );
});

parentWorkspaceTest('current Firebase-removal task card no longer says mobile auth is waiting on legacy provider rewiring', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const staleAuthProviderEdgeCases = [
    'skipped flow: mobile auth issuance still uses the existing auth provider until Supabase/server auth is migrated.',
    'old app/client version: mobile still uses the existing auth provider until later rewiring.',
  ];

  for (const claim of staleAuthProviderEdgeCases) {
    assert.equal(taskCard.includes(claim), false, `current task card still has stale auth-provider edge-case: ${claim}`);
  }

  assert.equal(taskCard.includes('skipped flow: remote provider auth exchange remains future work'), true);
  assert.equal(taskCard.includes('old app/client version: local mobile clients use MyChampions server auth/data boundaries'), true);
});

test('pending tracker describes local Postgres email credentials instead of dev-session email auth', () => {
  const pendingChecklist = readFileSync(
    join(root, 'docs/discovery/pending-wiring-checklist-v1.md'),
    'utf8'
  );

  assert.equal(
    pendingChecklist.includes(
      'Non-production email/password sign-in and account creation can establish an in-memory local server bearer session through `/auth/dev/session` only after the server email-auth route reports a provider configuration failure'
    ),
    false
  );
  assert.equal(
    pendingChecklist.includes('before using any local dev-session fallback'),
    false
  );
  assert.equal(
    pendingChecklist.includes('server/provider boundary is unavailable outside the explicit non-production configuration fallback'),
    false
  );
  assert.equal(
    pendingChecklist.includes('only falls back to the non-production local dev-session route for explicit configuration failures'),
    false
  );
  assert.equal(pendingChecklist.includes('local Postgres `local_email_auth_credentials`'), true);
  assert.equal(
    pendingChecklist.includes('Local Postgres is the only credential store.'),
    true
  );
  assert.equal(
    pendingChecklist.includes('without using the deterministic dev-session bridge for normal local email/password auth'),
    true
  );
});

test('pending tracker limits social auth deterministic fallback to provider-token configuration gaps', () => {
  const pendingChecklist = readFileSync(
    join(root, 'docs/discovery/pending-wiring-checklist-v1.md'),
    'utf8'
  );
  const staleSocialFallbackClaims = [
    'falls back to a deterministic local MyChampions server social session with provider-neutral `google` IDs only for configuration gaps.',
    'falls back to a deterministic local MyChampions server social session with provider-neutral `apple` IDs only for configuration gaps.',
    'captures native Apple identity tokens with a nonce through `expo-apple-authentication`, forwards them to the social-auth source, and is wired into sign-in/create-account before the local dev-session fallback.',
    'captures native Google authorization codes through `expo-auth-session`, exchanges them for Google tokens, forwards the provider `idToken` to the social-auth source, and is wired into sign-in/create-account before the local dev-session fallback.',
    'Google actions now try native `expo-auth-session` provider-token capture before deterministic local dev-session fallback',
    'Apple actions now try native identity-token capture before deterministic local dev-session fallback',
  ];

  for (const claim of staleSocialFallbackClaims) {
    assert.equal(
      pendingChecklist.includes(claim),
      false,
      `pending tracker still presents social auth deterministic fallback too broadly: ${claim}`
    );
  }

  assert.equal(
    pendingChecklist.includes('only using deterministic local dev-session fallback in unset, blank, or `dev` app variants for explicit provider-token configuration gaps'),
    true
  );
  assert.equal(
    pendingChecklist.includes('provider-neutral `google` IDs only when the app variant is unset, blank, or `dev`, and only for explicit provider-token configuration gaps'),
    true
  );
  assert.equal(
    pendingChecklist.includes('provider-neutral `apple` IDs only when the app variant is unset, blank, or `dev`, and only for explicit provider-token configuration gaps'),
    true
  );
});

parentWorkspaceTest('current decisions and task card limit local social fallback to provider-token configuration gaps', () => {
  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');
  const mobileNfr = readFileSync(join(root, 'docs/specs/mobile-nfr-tech-stack-spec.md'), 'utf8');
  const signInSpec = readFileSync(join(root, 'docs/screens/v2/SC-217-auth-sign-in.md'), 'utf8');
  const createAccountSpec = readFileSync(join(root, 'docs/screens/v2/SC-218-auth-create-account.md'), 'utf8');
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const staleDecisionClaims = [
    'Google and Apple can still establish deterministic local MyChampions server sessions for configuration gaps outside explicit E2E fixtures.',
    'Real production provider token exchange remains future server/Supabase provider work.',
    'non-production development uses deterministic local MyChampions server social sessions, and production Supabase/provider token exchange remains future provider work.',
  ];
  const staleMobileNfrClaims = [
    'Social auth uses explicit E2E fixtures first and deterministic local MyChampions server social sessions for non-production development; production Supabase/provider token exchange remains future provider work.',
  ];
  const staleAuthScreenClaims = [
    'Configuration gaps fall back to deterministic local MyChampions server sessions with provider-neutral `google` IDs in non-production.',
    'Configuration gaps fall back to deterministic local MyChampions server sessions with provider-neutral `apple` IDs in non-production.',
  ];
  const staleTaskCardClaims = [
    'local dev social buttons can now start deterministic MyChampions server sessions with provider-neutral `google`/`apple` IDs.',
    'Non-production Google/Apple social buttons keep explicit E2E overrides first, then start deterministic local MyChampions server sessions with provider-neutral `authProviderIds` instead of failing closed or using Firebase credentials.',
    'They now describe E2E-first local server social sessions and plan-store server/E2E/fail-closed auth ownership.',
    'before falling back to deterministic local MyChampions server sessions in non-production configuration gaps.',
    'D-090 now matches the current local behavior: email/password, Google, and Apple can establish deterministic local MyChampions server sessions in non-production, while real production provider token exchange remains future server/Supabase provider work.',
    'They now describe explicit E2E social fixtures first, deterministic local MyChampions server social sessions for non-production development, and production Supabase/provider token exchange as future provider work.',
    'Configuration failures fall back to `AuthSessionProvider#signInWithServerSocialAuth(...)` for deterministic local dev sessions.',
    'External auth-provider token issuance is still present as an incremental bridge; full provider removal remains a later slice.',
    'outside those fixtures, social provider auth fails closed with a configuration error until the local/Supabase bridge exists.',
    'until the local/Supabase bridge exists.',
  ];

  for (const claim of staleDecisionClaims) {
    assert.equal(decisionsLog.includes(claim), false, `decisions log still scopes social fallback too broadly: ${claim}`);
  }

  for (const claim of staleMobileNfrClaims) {
    assert.equal(mobileNfr.includes(claim), false, `mobile NFR still scopes social fallback too broadly: ${claim}`);
  }

  for (const claim of staleAuthScreenClaims) {
    assert.equal(signInSpec.includes(claim), false, `sign-in spec still scopes social fallback too broadly: ${claim}`);
    assert.equal(createAccountSpec.includes(claim), false, `create-account spec still scopes social fallback too broadly: ${claim}`);
  }

  for (const claim of staleTaskCardClaims) {
    assert.equal(taskCard.includes(claim), false, `task card still scopes social fallback too broadly: ${claim}`);
  }

  assert.equal(
    decisionsLog.includes('Deterministic local sessions are reserved for explicit local/dev provider-token configuration gaps outside E2E fixtures.'),
    true
  );
  assert.equal(
    decisionsLog.includes('Google and Apple ID tokens are verified directly by the server against configured issuer/audience claims.'),
    true
  );
  assert.equal(
    taskCard.includes('before using deterministic local MyChampions server sessions only when the app variant is unset, blank, or `dev`, and only for explicit provider-token configuration gaps.'),
    true
  );
  assert.equal(
    mobileNfr.includes('Social auth uses explicit E2E fixtures first, then native provider-token capture plus the MyChampions server `POST /auth/social/sign-in` boundary; deterministic local MyChampions server social sessions are reserved only for explicit provider-token configuration gaps.'),
    true
  );
  assert.equal(
    taskCard.includes('Explicit provider-token configuration failures fall back to `AuthSessionProvider#signInWithServerSocialAuth(...)` for deterministic local dev sessions only when the app variant is unset, blank, or `dev`.'),
    true
  );
  assert.equal(
    taskCard.includes('Google/Apple social buttons keep explicit E2E overrides first, then try native provider-token capture plus the MyChampions server social-auth boundary before using deterministic local sessions only when the app variant is unset, blank, or `dev`, and only for explicit provider-token configuration gaps.'),
    true
  );
  assert.equal(
    signInSpec.includes('provider-token configuration gaps fall back to deterministic local MyChampions server sessions with provider-neutral `google` IDs only when the app variant is unset, blank, or `dev`.'),
    true
  );
  assert.equal(
    signInSpec.includes('provider-token configuration gaps fall back to deterministic local MyChampions server sessions with provider-neutral `apple` IDs only when the app variant is unset, blank, or `dev`.'),
    true
  );
  assert.equal(
    createAccountSpec.includes('provider-token configuration gaps fall back to deterministic local MyChampions server sessions with provider-neutral `google` IDs only when the app variant is unset, blank, or `dev`.'),
    true
  );
  assert.equal(
    createAccountSpec.includes('provider-token configuration gaps fall back to deterministic local MyChampions server sessions with provider-neutral `apple` IDs only when the app variant is unset, blank, or `dev`.'),
    true
  );
});

test('pending tracker scopes remaining auth work to Apple profile proof', () => {
  const pendingChecklist = readFileSync(
    join(root, 'docs/discovery/pending-wiring-checklist-v1.md'),
    'utf8'
  );
  const staleAuthStatusClaims = [
    '`In progress`: Replace legacy provider-backed auth session/profile behavior with MyChampions server/Supabase-backed auth.',
    'Pending: Add durable remote/Supabase-backed auth session persistence after the remote server/database are ready.',
  ];

  for (const claim of staleAuthStatusClaims) {
    assert.equal(
      pendingChecklist.includes(claim),
      false,
      `pending tracker still scopes auth status too broadly: ${claim}`
    );
  }

  assert.equal(
    pendingChecklist.includes('`In progress`: Complete durable self-managed auth session persistence and approved production provider configuration after the remote server/database are ready.'),
    true
  );
  assert.equal(
    pendingChecklist.includes('Done: Durable self-managed server auth sessions are persisted in PostgreSQL with rotating refresh-token digests and stable configured JWT key material; local mobile auth/profile behavior is server-owned.'),
    true
  );
  assert.equal(
    pendingChecklist.includes('Apple blocks profile creation until the account holder accepts the latest Program License Agreement'),
    true
  );
});

parentWorkspaceTest('current auth requirements and decisions describe local Postgres email credentials', () => {
  const files = [
    '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md',
    'docs/discovery/decisions-log-v1.md',
    'docs/discovery/backend-provider-migration-v1.md',
    'docs/business-rules/BR-002-role-assignment-and-plan-governance.md',
    'docs/functional-requirements/FR-001-domain-role-and-care-plans.md',
  ];
  const staleClaims = [
    'non-production email/password auth can use the local MyChampions server dev session',
    'email/password sign-up now routes through the local MyChampions server dev-session bridge',
    'Email/password, Google, and Apple can establish deterministic local MyChampions server sessions',
    'Current auth wiring notes point to the local server dev-session bridge and future server/Supabase provider bridge.',
    'non-production email/password sign-in and account creation may establish a local MyChampions server bearer session; production must not use the local dev-session endpoint.',
    'email/password sign-in and account creation may use the MyChampions server dev-session endpoint',
    'Configuration is the only email-auth source failure reason that can reach the dev-session path.',
    'before trying the non-production `/auth/dev/session` fallback',
    'The fallback is only reached when the email-auth source maps the server response to `configuration`',
  ];

  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8');
    for (const claim of staleClaims) {
      assert.equal(source.includes(claim), false, `${file} still contains stale local email auth claim: ${claim}`);
    }
  }

  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');
  assert.equal(decisionsLog.includes('local Postgres `local_email_auth_credentials`'), true);

  const businessRules = readFileSync(join(root, 'docs/business-rules/BR-002-role-assignment-and-plan-governance.md'), 'utf8');
  assert.equal(businessRules.includes('local Postgres `local_email_auth_credentials`'), true);

  const requirements = readFileSync(join(root, 'docs/functional-requirements/FR-001-domain-role-and-care-plans.md'), 'utf8');
  assert.equal(requirements.includes('local Postgres `local_email_auth_credentials`'), true);
});

parentWorkspaceTest('current Firebase-removal task card no longer says local plan-change notification delivery is future work', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const stalePlanChangeNotificationClaim =
    'professional notification delivery after a student submits a plan-change request remains future work.';

  assert.equal(
    taskCard.includes(stalePlanChangeNotificationClaim),
    false,
    'current task card still hides the completed local in-app plan-change notification surface behind future-work wording'
  );
  assert.equal(taskCard.includes('local in-app professional plan-change notification surface is server-backed'), true);
});

parentWorkspaceTest('current Firebase-removal task card no longer says professional tracking review receives hydration goal from mobile caller', () => {
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );
  const staleTrackingReviewGoalClaim =
    'hydration goal context is server-backed for the student-facing source, while professional review still receives the goal value from its current mobile caller contract.';

  assert.equal(
    taskCard.includes(staleTrackingReviewGoalClaim),
    false,
    'current task card still says professional tracking review receives hydration goal context from the mobile caller'
  );
  assert.equal(
    taskCard.includes('tracking-review scope: professional student tracking review reads and hydration goal context are server-backed'),
    true
  );
});

test('deprecated food API evaluation no longer states Firebase-token food search as current', () => {
  const source = readFileSync(join(root, 'docs/discovery/food-api-evaluation-2026-02-26.md'), 'utf8');
  const staleCurrentClaims = [
    '## Current Decision',
    'Active provider contract is the VPS food-search microservice endpoint:',
    'Authorization: Bearer <Firebase ID token>',
    'migration to the VPS microservice',
  ];

  for (const token of staleCurrentClaims) {
    assert.equal(source.includes(token), false, `food API evaluation still presents stale current claim: ${token}`);
  }
});

test('current nutrition docs no longer route mobile food search directly to the VPS microservice', () => {
  const currentNutritionDocs = [
    'docs/discovery/decisions-log-v1.md',
    'docs/functional-requirements/FR-001-domain-role-and-care-plans.md',
    'docs/discovery/open-questions-v1.md',
    'docs/screens/v2/SC-207-nutrition-plan-builder.md',
    'docs/specs/student-professional-network-spec.md',
  ];
  const staleDirectFoodServiceClaims = [
    'VPS food-search microservice',
    'https://foodservice.eduwaldo.com/searchFoods',
    'VPS food-search service integration',
  ];

  for (const relativePath of currentNutritionDocs) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const token of staleDirectFoodServiceClaims) {
      assert.equal(source.includes(token), false, `${relativePath} still routes food search directly to ${token}`);
    }
  }
});

test('current ADRs no longer encode Firestore rules as the enforcement layer', () => {
  const currentAdrFiles = [
    'docs/adr/0001-scoped-invite-codes-per-specialty.md',
    'docs/adr/0003-specialty-scoped-log-read-access.md',
    'docs/adr/0005-nutrition-governance-and-custom-meal-snapshots.md',
  ];
  const staleAdrClaims = [
    'Firestore security rules',
    'firestore.rules',
    'legacy Firestore shapes',
    'professionals/{professionalUid}/inviteCodes/{specialty}',
    'Current rules likely perform',
  ];

  for (const relativePath of currentAdrFiles) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const token of staleAdrClaims) {
      assert.equal(source.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }
});

test('decision log no longer records retired Firebase services as active architecture', () => {
  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');
  const staleActiveDecisions = [
    'Backend platform baseline is Firebase (Auth, Firestore, Cloud Storage).',
    'Social authentication is implemented through Firebase Auth providers.',
    'Firebase Crashlytics is mandatory for production crash monitoring.',
    'User-uploaded media (including recipe images) is stored in Firebase Cloud Storage.',
    'Pull requests into `develop` distribute builds via Firebase App Distribution.',
    'Client-side media compression is mandatory before upload to Firebase Cloud Storage.',
    'email/password sign-up is wired through Firebase Auth.',
    'Route-guard enforcement is implemented with Firebase Auth session state',
    'Auth entry providers (email/password, Google, Apple) are wired to Firebase Auth',
    'React/Firebase deps',
    'getFunctionUrl',
    'getIdToken',
    'Google and Apple currently fail closed outside E2E fixtures until the real provider bridge exists',
    'Primary database model is Firebase Cloud Firestore',
    'Firestore integration contract source-of-truth is `docs/specs/retired-app-domain-persistence-contract-v1.md`',
    'Live Firestore operation compatibility is validated through `npm run validate:firestore:smoke`',
    'AI meal photo analysis uses a provider-neutral Firebase Cloud Function analyzer',
    'SC-207 food search now uses the VPS food-search microservice with Firebase ID token authorization.',
    'Firebase Cloud Storage paths for meal images follow the convention',
    'Environment model is variant-driven Firebase config selection via `APP_VARIANT`',
    'Firestore cutover baseline (2026-03-06):',
    'Firebase Auth initialization for React Native uses',
    'Firestore project mapping is explicitly environment-bound',
    'Contact support (SC-213) migrated from mailto link to custom Firestore-backed dialog.',
    'GitHub Actions workflows no longer run legacy Firebase Data Connect runtime validation',
    'Professional read access to student tracking logs is materialized through Firestore',
    'submitInviteCode` Cloud Function',
    'removeProfessionalSpecialty` Cloud Function',
    'Native Firebase config selection follows environment-aware wiring',
    'Firebase App Distribution for `develop`',
    'Auth role-lock persistence uses Firestore profile-source abstraction',
    'using `firebase/firestore` queries/updates/transactions',
    'implemented with stub data for Firestore',
    'stub data for Firestore, Cloud Storage',
    'Firestore CRUD operations',
    'later Firestore wiring',
    'Firestore stubs in `plan-source.ts`',
    'Firestore endpoints for connections/plans/water are required',
    'pending Firestore cache-layer implementation',
    'Persistence is Firestore-backed via',
    'baseline smoke check for Firestore read/write invariants',
    'Recovery path is direct Firestore document inspection',
    'fully Firestore-backed',
    'live Firestore counts',
    'Firestore-backed across both domains',
    'live assignment validation in Firestore',
    'Firestore smoke validation now includes',
    'FIRESTORE_ID_TOKEN',
    'Firestore rules validate',
    'Firestore rules use',
    'Role-lock save failure in SC-201 was traced to Firestore key-type mismatch',
    'Dev service `mychampions-fb928-2-service` was migrated',
    'relaunch persistence is pending the real server/Supabase auth bridge',
    'fails closed until the server/Supabase bridge is implemented',
  ];

  for (const token of staleActiveDecisions) {
    assert.equal(decisionsLog.includes(token), false, `decisions-log still contains active Firebase claim: ${token}`);
  }
});

test('current discovery trackers no longer route active backend work to Firebase', () => {
  const trackerFiles = [
    'docs/discovery/backend-provider-migration-v1.md',
    'docs/discovery/prioritized-backlog-v1.md',
    'docs/discovery/pending-wiring-checklist-v1.md',
  ];
  const staleTrackerClaims = [
    'backend provider replacement to Firebase',
    'Backend baseline is Firebase',
    'switched to Firebase Firestore terminology',
    'FR-197 switched to Firebase Cloud Storage',
    'BR-257 switched to Firebase Cloud Storage',
    'AC-506 switched to Firebase Cloud Storage',
    'switched to Firebase backend services',
    'Backend auth wiring note switched to Firebase Auth',
    'Session/profile source note switched to Firebase Firestore-backed integration wording',
    'Any newly added backend planning text must use Firebase terminology',
    'Firestore endpoint wiring deferred',
    'Firestore schema + connectors',
    'custom Firestore-backed modal',
    'Firestore + VPS food-service wiring completed',
    'Cloud Function/camera/compression all wired',
    'photo Cloud Storage attachment',
    'before falling back to Firestore/legacy governed paths',
    'Deferred until Firestore cache layer is implemented',
    'Replace Firebase-backed auth session/profile behavior',
    'instead of subscribing to Firebase Auth',
    'remaining legacy auth/data fallbacks',
    'reads both `nutritionPlans` and `trainingPlans` predefined records',
    'clones independent per-student assigned copies into the matching collection',
    'validates active nutrition assignment against live `connections`',
    'real social provider auth is pending the local/Supabase bridge',
    'currently fails closed outside E2E fixtures',
    'until the local/Supabase social-auth bridge is implemented',
    'fails closed with the existing configuration error',
    'fails closed until the server/Supabase bridge is implemented',
    '`In progress`: Migrate mobile auth and server-backed source modules from Firebase to the local MyChampions server',
    'touch Firebase auth for no-server legacy sessions',
    'Firestore profile-delete wiring deferred',
    'Firestore share endpoint wiring deferred',
    'Wire Firestore custom-meal CRUD operations',
    'Wire Firestore share-link generation',
    'Persist uploaded SC-214 recipe image download URL to Firestore custom-meal records',
    'Firebase Analytics, Amplitude, or equivalent',
    'SC-204/SC-205 Firestore wiring is complete',
    'Current OpenAI API key stored as Firebase Secret Manager secret',
    'Firestore infrastructure baseline is provisioned',
    'Firestore API enabled.',
    'Default Firestore database created in `us-east4`.',
    'Headers: Authorization: Bearer <Firebase Auth ID token>',
    'Firebase Auth ID token verified via `admin.auth().verifyIdToken()`',
    '`analyzeMealPhoto` remains active',
    'POST /analyzeMealPhoto',
    'https://us-central1-mychampions-fb928.cloudfunctions.net/analyzeMealPhoto',
    'uploadBytesResumable',
    'state_changed events',
  ];

  for (const relativePath of trackerFiles) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const token of staleTrackerClaims) {
      assert.equal(source.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }
});

test('backend authority docs keep the MyChampions server baseline and Firebase retirement aligned', () => {
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  const migration = readFileSync(
    join(root, 'docs/discovery/backend-provider-migration-v1.md'),
    'utf8'
  );
  const socialAuth = readFileSync(
    join(root, 'docs/specs/2026-07-13-native-social-auth-design.md'),
    'utf8'
  );
  const webSupport = readFileSync(
    join(root, 'docs/specs/web-platform-support-spec.md'),
    'utf8'
  );
  const currentDocs = [agents, migration, socialAuth, webSupport];

  for (const source of currentDocs) {
    assert.equal(
      source.includes('Current backend baseline is Firebase'),
      false,
      'current documentation must not restore Firebase as the backend baseline'
    );
  }

  assert.equal(
    agents.includes('Current app-domain backend baseline is the root-level MyChampions server'),
    true
  );
  assert.equal(
    agents.includes('Firebase Auth, Cloud Firestore, and Firebase Cloud Storage are retired'),
    true
  );
  assert.equal(
    migration.includes('Identity, sessions, profiles, and app-domain records are authoritative'),
    true
  );
  assert.match(migration, /RevenueCat SDK or signed webhook\s+observations/);
  assert.match(socialAuth, /does not restore\s+Firebase Auth as an application runtime/);
  assert.match(webSupport, /server's\s+Postgres snapshot rows/);
  assert.match(webSupport, /does not read a Firebase persistence or\s+billing runtime/);
});

test('pending tracker no longer lists completed cap-sensitive write locks as remaining work', () => {
  const source = readFileSync(join(root, 'docs/discovery/pending-wiring-checklist-v1.md'), 'utf8');

  assert.equal(source.includes('Wire RevenueCat entitlement checks to professional cap-sensitive actions'), true);
  assert.equal(
    source.includes('Server-side pending connection confirmation now blocks activation of a new 11th unique active student'),
    true
  );
  assert.equal(source.includes('subscription_entitlement_snapshots'), true);
  assert.equal(
    source.includes('remaining cap-sensitive write locks'),
    false,
    'cap-sensitive write locks are already covered by server activation and assigned-plan write lock enforcement'
  );
});

test('pending tracker no longer describes implemented professional plan libraries as placeholders', () => {
  const source = readFileSync(join(root, 'docs/discovery/pending-wiring-checklist-v1.md'), 'utf8');

  assert.equal(
    source.includes('Professional nutrition placeholder (`app/professional/nutrition.tsx`) and training placeholder (`app/professional/training.tsx`) created for SC-207/SC-208 (not yet implemented).'),
    false,
    'SC-207/SC-208 professional library screens are implemented server-backed surfaces, not current placeholders'
  );
  assert.equal(
    source.includes('SC-207 Nutrition Plan Builder implemented at `app/professional/nutrition/plans/[planId].tsx`; `app/professional/nutrition.tsx` converted to predefined plan library list screen.'),
    true
  );
  assert.equal(
    source.includes('SC-208 Training Plan Builder implemented at `app/professional/training/plans/[planId].tsx`; `app/professional/training.tsx` converted to predefined plan library list screen.'),
    true
  );
});

test('decision log no longer claims offline sync timestamps are pending', () => {
  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');
  const staleOfflineSyncClaims = [
    '`lastSyncedAtIso` remains `null` pending the server-backed cache/sync timestamp path',
    'lastSyncedAtIso remains `null` pending the server-backed cache/sync timestamp path',
    'lastSyncedAtIso` remains `null`',
  ];

  for (const claim of staleOfflineSyncClaims) {
    assert.equal(decisionsLog.includes(claim), false, `decisions log still contains stale offline sync claim: ${claim}`);
  }

  assert.equal(
    decisionsLog.includes('derive `lastSyncedAtIso` from server-backed source load timestamps'),
    true
  );
});

test('decision log records local in-app plan-change notification surface as server-backed', () => {
  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');

  assert.equal(
    decisionsLog.includes('Professional notification on submission is deferred until push notification infrastructure is provisioned.'),
    false,
    'D-116 should distinguish the completed local in-app surface from future push/provider delivery'
  );
  assert.equal(
    decisionsLog.includes('local in-app professional notification surface is server-backed'),
    true,
    'D-116 should record the server-backed local in-app notification surface'
  );
  assert.equal(
    decisionsLog.includes('push/provider notification delivery remains future work'),
    true,
    'D-116 should keep only push/provider notification delivery as future work'
  );
});

test('decision log no longer describes implemented professional plan tabs as coming soon placeholders', () => {
  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');

  assert.equal(
    decisionsLog.includes('Professional SC-207 (nutrition plan builder) and SC-208 (training plan builder) tabs show "coming soon" placeholders until those screens are implemented.'),
    false,
    'D-104 should describe the current server-backed plan-library tabs instead of retired coming-soon placeholders'
  );
  assert.equal(
    decisionsLog.includes('Professional SC-207 and SC-208 tabs now route to server-backed plan-library screens'),
    true,
    'D-104 should record the implemented server-backed plan-library tab routes'
  );
});

test('decision log describes role-lock persistence as local server-owned, not remote-only', () => {
  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');

  assert.equal(
    decisionsLog.includes('remote-only reads/writes'),
    false,
    'D-097 should not describe local role-lock persistence as remote-only'
  );
  assert.equal(
    decisionsLog.includes('server-only profile reads/writes through the local bearer session'),
    true,
    'D-097 should describe the local MyChampions server profile persistence boundary'
  );
  assert.equal(
    decisionsLog.includes('no client/provider role-lock fallback path remains'),
    true,
    'D-097 should keep the no-fallback invariant without implying remote-only storage'
  );
});

parentWorkspaceTest('retired feature-inventory evidence no longer recommends Firebase provider-live follow-up', () => {
  const source = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-22-feature-inventory-user-story-testing-task-card.md'),
    'utf8'
  );
  const staleFeatureInventoryClaims = [
    'stable non-production Firebase account',
    'stable Firebase fixtures',
    'Firebase Storage upload/download',
    'Cloud Function/provider analysis',
    'Firestore lifecycle writes',
    'Firestore rows end to end',
    'Firestore bulk assignment',
    'Firestore plan item writes',
    'Firestore share-link fixtures',
    'Firestore rules integration-style checks via `yarn test:rules`',
    '`yarn check:ios-firebase` passed',
    'Provider-live Firebase auth',
    'stable Firebase currentUser',
    'stable non-production Firebase',
    'real Firestore',
    'Firestore writes',
    'Firestore path',
    'Firestore active-student count',
    'Firebase mutations',
    'Firebase auth and provider tokens',
    'Firebase config',
    'Firebase plist/json',
    'backend/Firebase rules/function changes',
    'Provider/API/Firebase behavior',
    '`yarn test:rules` in `mychampions`',
    '`yarn check:ios-firebase` in `mychampions`',
    'Firestore rules tests',
    'GoogleService-Info-Dev.plist',
    'without Firebase mutation',
    'without mutating Firebase',
    'Firebase initialization',
    'Firebase SDK auth/data state',
    'Cloud Function, provider, or RevenueCat mutation',
    'Firestore roster path',
    'Firestore training session/item writes',
    'shared-token Firestore preview/import',
    'support-message Firestore write',
    'failed Firebase auth',
    'Firebase-backed helper',
    'Firebase unauthenticated state',
    'escaping to Firebase',
    'escaping to Firestore',
    'firebase.initializeApp',
    'npx firebase emulators:exec',
    'Firebase Tools emitted',
    'live Firestore Listen',
    'without Firestore',
    'Firebase storage-path construction',
    'Cloud Function URL/token/fetch behavior',
    'provider-live',
    'Provider-live',
    'provider-auth',
  ];

  for (const claim of staleFeatureInventoryClaims) {
    assert.equal(source.includes(claim), false, `feature-inventory task card still contains ${claim}`);
  }
});

test('current auth logic and tests no longer encode Firebase-specific error semantics', () => {
  const filesToCheck = [
    'features/auth/sign-in.logic.ts',
    'features/auth/sign-in.logic.test.ts',
    'features/auth/create-account.logic.ts',
    'features/auth/create-account.logic.test.ts',
    'features/auth/self-guided-flow.test.ts',
    'features/auth/account-settings-auth-flow-scan.test.ts',
    'features/auth/server-auth-source.ts',
    'features/auth/e2e-auth-session.test.ts',
  ];
  const staleAuthTokens = [
    'wrong-password',
    'user-not-found',
    'invalid-api-key',
    'account-exists-with-different-credential',
    'Firebase config',
    'Firebase ID token',
    'Firebase sign-out',
    'Firebase reauthentication',
    'Firestore did not confirm',
  ];

  for (const relativePath of filesToCheck) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const token of staleAuthTokens) {
      assert.equal(source.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }
});

test('auth session user contract no longer exposes Firebase-shaped token methods', () => {
  const filesToCheck = [
    'features/auth/auth-user.ts',
    'features/auth/auth-session.tsx',
    'features/auth/server-auth-source.ts',
    'features/auth/server-auth-source.test.ts',
    'features/auth/profile-source.ts',
  ];
  const staleTokenMethods = ['getIdToken', 'getIdTokenResult'];

  for (const relativePath of filesToCheck) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const token of staleTokenMethods) {
      assert.equal(source.includes(token), false, `${relativePath} still contains ${token}`);
    }
  }
});

parentWorkspaceTest('profile hydration resolves access through the central server token source', () => {
  const profileSource = readFileSync(join(root, 'features/auth/profile-source.ts'), 'utf8');
  const taskCard = readFileSync(
    join(root, '../docs/superpowers/plans/2026-06-28-mobile-firebase-removal-server-foundation-task-card.md'),
    'utf8'
  );

  assert.equal(profileSource.includes('user.getAccessToken'), false);
  assert.equal(profileSource.includes('tokenFromUser'), false);
  assert.equal(taskCard.includes('caller-provided token'), false);
  assert.equal(taskCard.includes('legacy auth-session bridge'), false);
  assert.equal(
    taskCard.includes('Profile hydration resolves access through the central MyChampions server token source'),
    true
  );
});

test('auth session user contract no longer exposes Firebase providerData shape', () => {
  const filesToCheck = [
    'features/auth/auth-user.ts',
    'features/auth/auth-session.tsx',
    'features/auth/server-auth-source.ts',
    'app/settings/account.tsx',
  ];

  for (const relativePath of filesToCheck) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    assert.equal(source.includes('providerData'), false, `${relativePath} still contains providerData`);
    assert.equal(source.includes('google.com'), false, `${relativePath} still contains google.com`);
    assert.equal(source.includes('apple.com'), false, `${relativePath} still contains apple.com`);
  }
});

test('terms configuration no longer carries the old google.com legal placeholder', () => {
  const filesToCheck = [
    'features/auth/terms.logic.ts',
    'features/auth/terms.logic.test.ts',
    'docs/screens/v2/SC-221-auth-accept-terms.md',
    'docs/discovery/pending-wiring-checklist-v1.md',
    'docs/discovery/decisions-log-v1.md',
  ];

  for (const relativePath of filesToCheck) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    assert.equal(source.includes('https://google.com'), false, `${relativePath} still contains google.com`);
    assert.equal(source.includes('LEGACY_PLACEHOLDER_LEGAL_URL'), false, `${relativePath} still keeps legacy legal placeholder handling`);
  }

  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');
  assert.equal(decisionsLog.includes('example.com'), false, 'decision log should not describe legal URLs as placeholders');
  assert.equal(decisionsLog.includes('portfolio.eduwaldo.com/projects/my-champions/terms_of_use'), true);
  assert.equal(decisionsLog.includes('portfolio.eduwaldo.com/projects/my-champions/privacy_policy'), true);
});

test('current account support docs no longer describe contact support as mailto-only', () => {
  const filesToCheck = [
    'app/settings/account.tsx',
    'docs/discovery/decisions-log-v1.md',
    'docs/screens/v2/SC-213-account-privacy-settings.md',
  ];
  const staleSupportClaims = [
    'contact support (mailto)',
    '`mailto:support@mychampions.app` opened via `Linking.openURL`',
    'Zero infrastructure required for MVP',
  ];

  for (const relativePath of filesToCheck) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const claim of staleSupportClaims) {
      assert.equal(source.includes(claim), false, `${relativePath} still describes support as mailto-only: ${claim}`);
    }
  }

  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');
  const accountScreen = readFileSync(join(root, 'app/settings/account.tsx'), 'utf8');
  assert.equal(decisionsLog.includes('POST /support/messages'), true);
  assert.equal(decisionsLog.includes('server-backed support dialog'), true);
  assert.equal(accountScreen.includes('server-backed support dialog'), true);
});

test('current account language docs match the dedicated language-select screen behavior', () => {
  const decisionsLog = readFileSync(join(root, 'docs/discovery/decisions-log-v1.md'), 'utf8');
  const accountScreen = readFileSync(join(root, 'app/settings/account.tsx'), 'utf8');
  const accountDocs = readFileSync(join(root, 'docs/screens/v2/SC-213-account-privacy-settings.md'), 'utf8');
  const staleLanguageClaims = [
    'Takes effect on next app launch; no server sync required.',
    'iOS uses `ActionSheetIOS`; Android uses `Alert` with locale options.',
  ];

  for (const claim of staleLanguageClaims) {
    assert.equal(decisionsLog.includes(claim), false, `D-144 still describes retired language behavior: ${claim}`);
  }

  assert.equal(decisionsLog.includes('Tapping pushes to `/settings/language-select`'), true);
  assert.equal(decisionsLog.includes('takes effect immediately in-session via `LocaleContext`'), true);
  assert.equal(accountScreen.includes('Pushes to /settings/language-select'), true);
  assert.equal(accountScreen.includes('Takes effect immediately in-session via LocaleContext'), true);
  assert.equal(accountDocs.includes('no app restart required'), true);
});

test('current meal-photo analysis docs no longer describe the capture pipeline as stubbed', () => {
  const filesToCheck = [
    'docs/screens/v2/SC-219-ai-meal-photo-analysis.md',
    'docs/discovery/pending-wiring-checklist-v1.md',
    'docs/discovery/decisions-log-v1.md',
  ];
  const stalePhrases = [
    'image upload stub',
    'startCapture` (stub)',
    'startCapture (stub)',
    'S2 stub passes empty string',
    'A1 max_tokens',
    'A2 image detail level',
    'A3 no server-side size cap',
    'A4 auth error swallowing',
  ];

  for (const relativePath of filesToCheck) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    for (const phrase of stalePhrases) {
      assert.equal(source.includes(phrase), false, `${relativePath} still describes current meal-photo analysis as stubbed: ${phrase}`);
    }
  }
});

test('current plan-builder copy no longer carries obsolete food-search stub_notice keys', () => {
  const filesToCheck = [
    'localization/en-US.ts',
    'localization/pt-BR.ts',
    'localization/es-ES.ts',
    'docs/screens/v2/SC-207-nutrition-plan-builder.md',
    'docs/screens/v2/localized-copy-table-v2.md',
  ];
  const obsoleteKeys = [
    'pro.plan.food_search.stub_notice',
    'student.plan.food_search.stub_notice',
  ];

  for (const relativePath of filesToCheck) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    for (const key of obsoleteKeys) {
      assert.equal(source.includes(key), false, `${relativePath} still carries obsolete food-search stub key: ${key}`);
    }
  }
});

test('server-backed feature error semantics no longer mention legacy provider paths', () => {
  const filesToCheck = [
    'features/nutrition/food-search-source.ts',
    'features/nutrition/meal-photo-analysis.logic.ts',
    'features/nutrition/meal-photo-analysis.logic.test.ts',
    'features/connections/connection.logic.test.ts',
  ];
  const staleErrorPhrases = [
    'Auth ID token',
    'id token',
    'Cloud Function',
    'Firestore is not configured',
  ];

  for (const relativePath of filesToCheck) {
    const source = readFileSync(join(root, relativePath), 'utf8');

    for (const phrase of staleErrorPhrases) {
      assert.equal(source.includes(phrase), false, `${relativePath} still contains ${phrase}`);
    }
  }
});

parentWorkspaceTest('root server README no longer describes migrated mobile paths as falling back to Firebase', () => {
  const source = readFileSync(join(root, '../server/README.md'), 'utf8');
  const staleReadmeClaims = [
    'falls back to Firestore',
    'fall back to Firestore',
    'Firestore remains the fallback',
    'falling back to Firebase Auth',
    'legacy Firestore',
    'legacy governed function',
    'legacy governed removal function',
    'legacy Cloud Function',
    'Firebase-backed app logic',
    'Firebase code is migrated',
    'moving away from Firebase-backed app logic',
    'Firebase Auth',
  ];

  for (const claim of staleReadmeClaims) {
    assert.equal(source.includes(claim), false, `server README still contains stale fallback claim: ${claim}`);
  }
});

test('production mobile release workflows require the public MyChampions server URL', () => {
  const expectedServerUrl = 'https://api.mychampions.eduwaldo.com';
  const releaseWorkflows = [
    '.github/workflows/ios-release.yml',
    '.github/workflows/android-release.yml',
  ];

  for (const relativePath of releaseWorkflows) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    assert.equal(
      source.includes(expectedServerUrl),
      true,
      `${relativePath} must require the public production MyChampions server URL`
    );
    assert.equal(
      source.includes('EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL'),
      true,
      `${relativePath} must validate EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL`
    );
  }
});

test('production mobile release workflows require platform OAuth and RevenueCat public keys', () => {
  const iosRelease = readFileSync(join(root, '.github/workflows/ios-release.yml'), 'utf8');
  const androidRelease = readFileSync(join(root, '.github/workflows/android-release.yml'), 'utf8');
  const googleOAuthProduction = readFileSync(
    join(root, 'config/google-oauth-production.json'),
    'utf8'
  );

  assert.equal(
    iosRelease.includes('EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID'),
    true,
    'iOS release must require its platform Google OAuth client ID'
  );
  assert.equal(
    iosRelease.includes('EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID'),
    true,
    'iOS release must require the Google web OAuth audience used by the native SDK'
  );
  assert.equal(
    iosRelease.includes('config/google-oauth-production.json'),
    true,
    'iOS release must validate the configured client against committed provider metadata'
  );
  assert.equal(
    iosRelease.includes('CFBundleURLSchemes'),
    true,
    'iOS release must validate the configured client callback scheme'
  );
  assert.equal(
    iosRelease.includes('EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_PROD'),
    true,
    'iOS release must require its production RevenueCat public key'
  );
  assert.equal(
    iosRelease.includes('appl_*'),
    true,
    'iOS release must reject an invalid RevenueCat key prefix'
  );
  assert.equal(
    androidRelease.includes('EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID'),
    true,
    'Android release must require its platform Google OAuth client ID'
  );
  assert.equal(
    androidRelease.includes('EXPO_PUBLIC_GOOGLE_OAUTH_WEB_CLIENT_ID'),
    true,
    'Android release must require the Google web OAuth audience used by the native SDK'
  );
  assert.equal(
    androidRelease.includes('config/google-oauth-production.json'),
    true,
    'Android release must validate the configured client against committed provider metadata'
  );
  assert.equal(
    androidRelease.includes('playSigningSha1'),
    true,
    'Android release must pin the Google client to the recorded Play signing certificate'
  );
  assert.equal(
    androidRelease.includes('applicationId'),
    true,
    'Android release must validate the production application ID'
  );
  assert.equal(
    androidRelease.includes('EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_PROD'),
    true,
    'Android release must require its production RevenueCat public key'
  );
  assert.equal(
    androidRelease.includes('goog_*'),
    true,
    'Android release must reject an invalid RevenueCat key prefix'
  );
  assert.equal(
    googleOAuthProduction.includes(
      '942354515358-6pqkvvhajja4uon9igq3rtcp2q3k9qvo.apps.googleusercontent.com'
    ),
    true,
    'provider metadata must pin the production iOS client ID'
  );
  assert.equal(
    googleOAuthProduction.includes(
      '942354515358-1r5l73l9vjlngq7i2l0i4j4p41p65d2o.apps.googleusercontent.com'
    ),
    true,
    'provider metadata must pin the production Android client ID'
  );
  assert.equal(googleOAuthProduction.includes('com.edufelip.mychampions'), true);
  assert.equal(
    googleOAuthProduction.includes('85:E5:17:D8:91:E0:55:55:E4:26:A0:9F:CD:1D:97:C9:A8:8E:A9:AD'),
    true,
    'provider metadata must pin the Play app-signing SHA-1'
  );
});

test('Apple native entitlement is present and validated against the release profile', () => {
  const entitlements = readFileSync(
    join(root, 'ios/mychampions/mychampions.entitlements'),
    'utf8'
  );
  const iosRelease = readFileSync(join(root, '.github/workflows/ios-release.yml'), 'utf8');

  assert.equal(entitlements.includes('com.apple.developer.applesignin'), true);
  assert.equal(entitlements.includes('<string>Default</string>'), true);
  assert.equal(iosRelease.includes('Entitlements:com.apple.developer.applesignin:0'), true);
  assert.equal(
    iosRelease.includes('Provisioning profile missing Sign in with Apple entitlement'),
    true
  );
});

test('iOS registers the production and dev native Google callback schemes', () => {
  const infoPlist = readFileSync(join(root, 'ios/mychampions/Info.plist'), 'utf8');

  for (const reversedClientId of [
    'com.googleusercontent.apps.942354515358-6pqkvvhajja4uon9igq3rtcp2q3k9qvo',
    'com.googleusercontent.apps.942354515358-fursf2upkr1ggp1tfhojo1uhiqmtsc2t',
  ]) {
    assert.equal(infoPlist.includes(reversedClientId), true, `missing ${reversedClientId}`);
  }
});
