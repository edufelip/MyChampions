import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  parseIosNativeCaptureArguments,
  iosNativeCharterUsesAuthPrelude,
  buildIosCredentialEntryDiagnosticAssertionActions,
  buildIosCredentialEntryDiagnosticTapActions,
  buildIosCredentialEntryDiagnosticInputActions,
  buildIosCredentialEntryPasswordContinuationActions,
  buildIosCredentialEntryPasswordContinuationWithOriginalEmailAssertionActions,
} from '../../scripts/testing/capture-native-testability';
import { runIosCredentialEntryOwnedBranch } from '../../scripts/testing/ios-credential-entry-owned-seam';

void test('diagnostic input and exact assertion are separate generated flows', () => {
  const input = buildIosCredentialEntryDiagnosticInputActions('coach@example.invalid');
  const assertion = buildIosCredentialEntryDiagnosticAssertionActions('coach@example.invalid');
  assert.deepEqual(input.split('\n'), [
    '- tapOn:',
    '    id: auth.signIn.emailInput',
    '    retryTapIfNoChange: false',
    '- inputText: "coach@example.invalid"',
  ]);
  assert.equal(input.includes('point:'), false);
  assert.equal(input.includes('optional:'), false);
  assert.equal(input.includes('assertVisible'), false);
  assert.equal(assertion.includes('inputText'), false);
  assert.match(assertion, /auth\.signIn\.emailInput/);
  assert.equal(
    buildIosCredentialEntryDiagnosticTapActions(),
    '- tapOn:\n    id: auth.signIn.emailInput\n    retryTapIfNoChange: false',
  );
});

void test('credential continuation starts at password and cannot repeat email entry', () => {
  const actions = buildIosCredentialEntryPasswordContinuationActions('private-password');
  assert.match(actions, /auth\.signIn\.passwordInput/);
  assert.match(actions, /auth\.signIn\.submitButton/);
  assert.equal(actions.includes('auth.signIn.emailInput'), false);
  assert.equal(actions.includes('retryTapIfNoChange'), false);
  assert.equal(actions.includes('private-password'), true);
});

void test('camera diagnostic continuation dismisses keyboard before password and preserves one exact email assertion', () => {
  const lines = buildIosCredentialEntryPasswordContinuationWithOriginalEmailAssertionActions(
    'private-password',
    'coach@example.invalid',
  ).split('\n');
  assert.equal(lines[0], '- hideKeyboard');
  assert.equal(lines[1], '- tapOn:');
  assert.equal(lines[2], '    id: auth.signIn.passwordInput');
  assert.equal(lines[3], '- inputText: "private-password"');
  assert.equal(lines[5], '    id: auth.signIn.emailInput');
  assert.equal(lines[6], `    text: ${JSON.stringify('^coach@example\\.invalid$')}`);
  assert.equal(lines.filter((line) => line === '- tapOn:').length, 2);
  assert.equal(
    lines.some((line) => line.includes('retryTapIfNoChange')),
    false,
  );
});

void test('the owner branch publishes the diagnostic before one password continuation and never retries email', async () => {
  const events: string[] = [];
  await runIosCredentialEntryOwnedBranch({
    captureDiagnostic: () => {
      events.push('capture-diagnostic');
      return Promise.resolve({
        result: { status: 'observed' } as never,
        receipts: [],
      });
    },
    onDiagnostic: () => {
      events.push('publish-diagnostic');
    },
    continueAfterDiagnostic: () => {
      events.push('password-continuation');
      return Promise.resolve(undefined);
    },
  });
  assert.deepEqual(events, ['capture-diagnostic', 'publish-diagnostic', 'password-continuation']);
  assert.equal(events.filter((event) => event === 'capture-diagnostic').length, 1);
  assert.equal(events.includes('email-retry'), false);
});

void test('a failed owner diagnostic reaches the outer failure hook and cannot continue', async () => {
  const events: string[] = [];
  await assert.rejects(
    runIosCredentialEntryOwnedBranch({
      captureDiagnostic: () =>
        Promise.resolve({
          result: { status: 'failed' } as never,
          receipts: [],
        }),
      continueAfterDiagnostic: () => {
        events.push('password-continuation');
        return Promise.resolve(undefined);
      },
      onOuterFailure: () => {
        events.push('outer-failure');
      },
    }),
    /did not observe all stages: failed/,
  );
  assert.deepEqual(events, ['outer-failure']);
});

void test('explicit credential diagnostic is selectable and reaches the authenticated prelude', async () => {
  const selected = parseIosNativeCaptureArguments([
    '--platform=ios',
    '--mode=inventory',
    '--charter=credential-entry-diagnostic',
  ]);
  assert.equal(selected.charter, 'credential-entry-diagnostic');
  assert.equal(iosNativeCharterUsesAuthPrelude(selected.charter), true);
  assert.equal(iosNativeCharterUsesAuthPrelude('entry'), false);
  assert.equal(iosNativeCharterUsesAuthPrelude('connection-journey'), true);
  assert.equal(iosNativeCharterUsesAuthPrelude('locale-selection-persistence'), false);
  const source = await readFile(
    path.resolve(__dirname, '../../scripts/testing/capture-native-testability.ts'),
    'utf8',
  );
  assert.ok(source.includes('if (iosNativeCharterUsesAuthPrelude(charter)) {'));
  assert.ok(
    source.includes(
      "if (charter === 'credential-entry-diagnostic' || cameraCredentialDiagnostic) {",
    ),
  );
  assert.equal(source.includes("if (charter === 'entry') {"), false);
  assert.ok(
    source.includes("report.credentialEntryDiagnosticContinuation = 'coach-home-observed';"),
  );
  const branchStart = source.indexOf(
    "if (charter === 'credential-entry-diagnostic' || cameraCredentialDiagnostic) {",
  );
  const genericBranch = source.indexOf('      } else {\n          await observe(', branchStart);
  assert.ok(branchStart >= 0 && genericBranch > branchStart);
  const explicitBranch = source.slice(branchStart, genericBranch);
  assert.match(explicitBranch, /observeConnectionPasswordOffer\(/);
  assert.match(explicitBranch, /const beforeRequestId = proxy\.requestIdFence/);
  assert.match(explicitBranch, /buildIosCredentialEntryPasswordContinuationActions/);
  assert.match(explicitBranch, /resolveIosCredentialDiagnosticPostLogin/);
  assert.match(explicitBranch, /diagnosticPostLogin\.actor/);
  assert.match(source, /selector: 'student\.home\.screen'/);
  assert.doesNotMatch(explicitBranch, /password-save-prompt/);
  assert.doesNotMatch(explicitBranch, /buildIosPasswordOfferDismissalActions/);
});
