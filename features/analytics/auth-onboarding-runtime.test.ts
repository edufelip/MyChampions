import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const projectRoot = process.cwd();

function readProjectFile(path: string): string {
  return readFileSync(join(projectRoot, path), 'utf8');
}

test('auth screens emit validation failures through runtime analytics before returning', () => {
  const signInSource = readProjectFile('app/auth/sign-in.tsx');
  const createAccountSource = readProjectFile('app/auth/create-account.tsx');

  assert.match(signInSource, /resolveSignInValidationAnalyticsReason/);
  assert.match(
    signInSource,
    /emitEvent\(buildSignInFailed\('email_password', validationReason\)\);[\s\S]+return;/
  );

  assert.match(createAccountSource, /resolveCreateAccountValidationAnalyticsReason/);
  assert.match(
    createAccountSource,
    /emitEvent\(buildSignUpFailed\('email_password', validationReason\)\);[\s\S]+return;/
  );
});

test('email/password auth screens do not fall back to local dev-session after server email auth', () => {
  const signInSource = readProjectFile('app/auth/sign-in.tsx');
  const createAccountSource = readProjectFile('app/auth/create-account.tsx');

  const signInSourceCall = signInSource.indexOf(
    'await signInWithEmailPasswordFromSource(submissionInput)'
  );
  assert.notEqual(signInSourceCall, -1);
  assert.equal(signInSource.includes('signInWithServerEmailPassword'), false);

  const createAccountSourceCall = createAccountSource.indexOf(
    'await createAccountWithEmailPasswordFromSource(submissionInput)'
  );
  assert.notEqual(createAccountSourceCall, -1);
  assert.equal(createAccountSource.includes('createAccountWithServerEmailPassword'), false);
});

test('apple auth screens attempt native provider token capture before local dev-session fallback', () => {
  const signInSource = readProjectFile('app/auth/sign-in.tsx');
  const createAccountSource = readProjectFile('app/auth/create-account.tsx');

  assert.match(signInSource, /signInWithAppleProviderTokenFromSource/);
  const signInAppleSourceCall = signInSource.indexOf('await signInWithAppleProviderTokenFromSource()');
  const signInDevSessionCall = signInSource.indexOf("await signInWithServerSocialAuth('apple')");
  assert.notEqual(signInAppleSourceCall, -1);
  assert.notEqual(signInDevSessionCall, -1);
  assert.ok(signInAppleSourceCall < signInDevSessionCall);

  assert.match(createAccountSource, /signInWithAppleProviderTokenFromSource/);
  const createAccountAppleSourceCall = createAccountSource.indexOf('await signInWithAppleProviderTokenFromSource()');
  const createAccountDevSessionCall = createAccountSource.indexOf("await signInWithServerSocialAuth('apple')");
  assert.notEqual(createAccountAppleSourceCall, -1);
  assert.notEqual(createAccountDevSessionCall, -1);
  assert.ok(createAccountAppleSourceCall < createAccountDevSessionCall);
});

test('google auth screens attempt native provider token capture before local dev-session fallback', () => {
  const signInSource = readProjectFile('app/auth/sign-in.tsx');
  const createAccountSource = readProjectFile('app/auth/create-account.tsx');

  assert.match(signInSource, /signInWithGoogleProviderTokenFromSource/);
  const signInGoogleSourceCall = signInSource.indexOf('await signInWithGoogleProviderTokenFromSource()');
  const signInDevSessionCall = signInSource.indexOf("await signInWithServerSocialAuth('google')");
  assert.notEqual(signInGoogleSourceCall, -1);
  assert.notEqual(signInDevSessionCall, -1);
  assert.ok(signInGoogleSourceCall < signInDevSessionCall);

  assert.match(createAccountSource, /signInWithGoogleProviderTokenFromSource/);
  const createAccountGoogleSourceCall = createAccountSource.indexOf('await signInWithGoogleProviderTokenFromSource()');
  const createAccountDevSessionCall = createAccountSource.indexOf("await signInWithServerSocialAuth('google')");
  assert.notEqual(createAccountGoogleSourceCall, -1);
  assert.notEqual(createAccountDevSessionCall, -1);
  assert.ok(createAccountGoogleSourceCall < createAccountDevSessionCall);
});

test('role selection emits documented onboarding analytics events in runtime screen code', () => {
  const roleSelectionSource = readProjectFile('app/auth/role-selection.tsx');

  assert.match(roleSelectionSource, /emitEvent\(buildAuthEntryViewed\('role_selection'\)\)/);
  assert.match(roleSelectionSource, /emitEvent\(buildRoleSelected\(role\)\)/);
  assert.match(roleSelectionSource, /emitEvent\(buildSelfGuidedStartClicked\(\)\)/);
});
