import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const createAccountSource = readFileSync(
  join(process.cwd(), 'app/auth/create-account.tsx'),
  'utf8',
);
const signInSource = readFileSync(join(process.cwd(), 'app/auth/sign-in.tsx'), 'utf8');
const authSignInE2ESource = readFileSync(
  join(process.cwd(), 'e2e/auth-sign-in.e2e.test.js'),
  'utf8',
);

function pressableOpeningTag(source: string, testId: string): string {
  const testIdIndex = source.indexOf(`testID="${testId}"`);
  assert.notEqual(testIdIndex, -1);
  const pressableIndex = source.lastIndexOf('<Pressable', testIdIndex);
  assert.notEqual(pressableIndex, -1);
  return source.slice(pressableIndex, testIdIndex);
}

function providerHandlerBody(source: string, handler: string, nextHandler: string): string {
  const start = source.indexOf(`const ${handler} = async () => {`);
  assert.notEqual(start, -1);
  const endMarker = nextHandler === 'return (' ? '\n\n  return (' : `\n\n  const ${nextHandler}`;
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

test('social auth handlers acquire and release the shared submitting lock', () => {
  const handlers = [
    [signInSource, 'onGoogleSignIn', 'onAppleSignIn'],
    [signInSource, 'onAppleSignIn', 'return ('],
    [createAccountSource, 'onGoogleCreateAccount', 'onAppleCreateAccount'],
    [createAccountSource, 'onAppleCreateAccount', 'return ('],
  ] as const;

  for (const [source, handler, nextHandler] of handlers) {
    const body = providerHandlerBody(source, handler, nextHandler);
    assert.match(body, /if \(submitting\) return;/);
    assert.match(body, /setSubmitting\(true\);/);
    assert.match(body, /finally \{[\s\S]*setSubmitting\(false\);/);
  }
});

test('create-account submission snapshots the latest confirmation value', () => {
  assert.match(
    createAccountSource,
    /passwordConfirmationRef\.current = value;[\s\S]+setPasswordConfirmation\(value\);/,
  );
  assert.match(
    createAccountSource,
    /submittedPasswordConfirmation \?\? passwordConfirmationRef\.current/,
  );
  assert.match(createAccountSource, /validateCreateAccountInput\(submissionInput\)/);
  assert.match(createAccountSource, /createAccountWithEmailPasswordFromSource\(submissionInput\)/);
});

test('create-account Return submission uses the native confirmation snapshot', () => {
  assert.match(
    createAccountSource,
    /onSubmitEditing=\{\(\{ nativeEvent \}\) => \{[\s\S]+onCreateAccount\(nativeEvent\.text\);/,
  );
  assert.match(
    pressableOpeningTag(createAccountSource, 'auth.createAccount.submitButton'),
    /onPress=\{\(\) => \{\s+void onCreateAccount\(\);\s+\}\}/,
  );
});

test('create-account E2E dispatches a platform-safe confirmation editor action', () => {
  assert.match(
    authSignInE2ESource,
    /device\.getPlatform\(\) === 'android'[\s\S]+device\.getUiDevice\(\)\.pressEnter\(\)[\s\S]+tapReturnKey\(\)/,
  );
});

test('create-account E2E taps the confirmation editor only where focus requires it', () => {
  // iOS dtx_replaceText() already leaves the field first responder, and tap()
  // asserts hittability, which the software keyboard defeats. Pin the tap inside
  // the Android guard so the iOS-fatal unconditional tap cannot come back.
  assert.equal(authSignInE2ESource.match(/passwordConfirmationInput'\)\)\.tap\(\);/g)?.length, 1);
  assert.match(
    authSignInE2ESource,
    /if \(device\.getPlatform\(\) === 'android'\) \{[\s\S]*?element\(by\.id\('auth\.createAccount\.passwordConfirmationInput'\)\)\.tap\(\);\s*\}\s*await waitFor\(element\(by\.id\('auth\.createAccount\.passwordConfirmationInput'\)\)\)\s*\.toBeFocused\(\)/,
  );
});
