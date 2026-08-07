import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const signInSource = readFileSync(
  join(process.cwd(), 'app/auth/sign-in.tsx'),
  'utf8'
);

function pressableOpeningTag(source: string, testId: string): string {
  const testIdIndex = source.indexOf(`testID="${testId}"`);
  assert.notEqual(testIdIndex, -1);
  const pressableIndex = source.lastIndexOf('<Pressable', testIdIndex);
  assert.notEqual(pressableIndex, -1);
  return source.slice(pressableIndex, testIdIndex);
}

test('sign-in submission snapshots the latest credential values', () => {
  assert.match(
    signInSource,
    /emailRef\.current = value;[\s\S]+setEmail\(value\);/
  );
  assert.match(
    signInSource,
    /passwordRef\.current = value;[\s\S]+setPassword\(value\);/
  );
  assert.match(signInSource, /email: emailRef\.current/);
  assert.match(
    signInSource,
    /submittedPassword \?\? passwordRef\.current/
  );
  assert.match(signInSource, /validateSignInInput\(submissionInput\)/);
  assert.match(
    signInSource,
    /signInWithEmailPasswordFromSource\(submissionInput\)/
  );
});

test('sign-in Return and CTA submissions use immutable credential snapshots', () => {
  assert.match(
    signInSource,
    /onSubmitEditing=\{\(\{ nativeEvent \}\) => \{[\s\S]+onEmailPasswordSignIn\(nativeEvent\.text\);/
  );
  assert.match(
    pressableOpeningTag(signInSource, 'auth.signIn.submitButton'),
    /onPress=\{\(\) => \{\s+void onEmailPasswordSignIn\(\);\s+\}\}/
  );
});
