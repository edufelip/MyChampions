import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  observeIosConnectionSignOutWithDiagnostic,
  type IosTrainingRuntimeContext,
} from '../../scripts/testing/capture-native-testability';

const candidatePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/testing/capture-native-testability.ts',
);

const initialActions =
  '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutCta';
const confirmationActions =
  '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutConfirmCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutConfirmCta';

async function sourceText(): Promise<string> {
  return readFile(candidatePath, 'utf8');
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

void test('connection sign-out records owned post-tap evidence before confirmation', async () => {
  const events: string[] = [];
  const report: Record<string, unknown> = {};
  const diagnostic = {
    label: 'connection-switch-1-student-signout-post-tap',
    hierarchyPath: '/private/diagnostic/hierarchy.json',
    screenshotPath: '/private/diagnostic/screenshot.png',
    selectorPresence: { signOutConfirmCta: false },
  };

  const observe: IosTrainingRuntimeContext['observe'] = (label, actions, viewId, selector) => {
    events.push(`observe:${label}`);
    assert.equal(actions, confirmationActions);
    assert.equal(viewId, 'SCR-sign-in');
    assert.equal(selector, 'auth.signIn.emailInput');
    return Promise.reject(new Error('mandatory confirmation lookup failed'));
  };

  await assert.rejects(
    observeIosConnectionSignOutWithDiagnostic({
      label: 'connection-switch-1-student',
      initialActions,
      confirmationActions,
      report,
      observePostTapDiagnostic: (label, actions) => {
        events.push(`diagnostic:${label}`);
        assert.equal(label, diagnostic.label);
        assert.equal(actions, initialActions);
        return Promise.resolve(diagnostic);
      },
      observe,
    }),
    /mandatory confirmation lookup failed/,
  );

  assert.deepEqual(events, [
    'diagnostic:connection-switch-1-student-signout-post-tap',
    'observe:connection-switch-1-student-signed-out',
  ]);
  const diagnostics = report.connectionSignoutPostTapDiagnostics as Record<string, unknown>;
  assert.deepEqual(diagnostics['connection-switch-1-student'], diagnostic);
});

void test('successful confirmation remains the only continuation after diagnostics', async () => {
  const events: string[] = [];
  const report: Record<string, unknown> = {};

  const observe: IosTrainingRuntimeContext['observe'] = (label, actions, viewId, selector) => {
    events.push(`observe:${label}`);
    assert.equal(actions, confirmationActions);
    assert.equal(viewId, 'SCR-sign-in');
    assert.equal(selector, 'auth.signIn.emailInput');
    return Promise.resolve();
  };

  await observeIosConnectionSignOutWithDiagnostic({
    label: 'connection-switch-2-coach',
    initialActions,
    confirmationActions,
    report,
    observePostTapDiagnostic: (label, actions) => {
      events.push(`diagnostic:${label}`);
      assert.equal(actions, initialActions);
      return Promise.resolve({ label, selectorPresence: { signOutConfirmCta: true } });
    },
    observe,
  });

  assert.deepEqual(events, [
    'diagnostic:connection-switch-2-coach-signout-post-tap',
    'observe:connection-switch-2-coach-signed-out',
  ]);
  assert.deepEqual(report.connectionSignoutPostTapDiagnostics, {
    'connection-switch-2-coach': {
      label: 'connection-switch-2-coach-signout-post-tap',
      selectorPresence: { signOutConfirmCta: true },
    },
  });
});

void test('connection source keeps the semantic two-step contract without fallback actions', async () => {
  const source = await sourceText();
  assert.match(source, /const signOutInitialActions\s*=/);
  assert.match(source, /const signOutConfirmationActions\s*=/);
  assert.match(source, /await observeIosConnectionSignOutWithDiagnostic\(\{/);
  assert.match(source, /connectionSignoutPostTapDiagnostics/);

  const wiring = sliceBetween(source, 'const signOutInitialActions', 'const beforeRequestId');
  assert.equal((wiring.match(/- tapOn:/g) ?? []).length, 2);
  assert.match(wiring, /id: settings\.account\.signOutCta/);
  assert.match(wiring, /id: settings\.account\.signOutConfirmCta/);
  assert.doesNotMatch(
    wiring,
    /retryTapIfNoChange|waitForAnimationToEnd|coordinate|index:|optional/i,
  );

  const helper = sliceBetween(
    source,
    'export async function observeIosConnectionSignOutWithDiagnostic',
    'export type OwnedIosNativeSessionOptions',
  );
  assert.match(helper, /diagnostics\[input\.label\] = await input\.observePostTapDiagnostic/);
  assert.match(helper, /await input\.observe\(/);
  assert.ok(
    helper.indexOf('observePostTapDiagnostic') < helper.indexOf('await input.observe('),
    'mandatory confirmation must follow diagnostic acquisition',
  );
});
