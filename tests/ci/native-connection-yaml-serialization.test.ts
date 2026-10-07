import assert from 'node:assert/strict';
import test from 'node:test';
import YAML from 'yaml';
import { buildNativeConnectionSubmissionActions } from '../../scripts/testing/native-connection-journey-core';
import {
  ANDROID_CONNECTION_PLATFORM,
  IOS_CONNECTION_PLATFORM,
} from '../../scripts/testing/native-connection-platform-contract';

const expectedPendingIdPattern = 'student\\.professionals\\.connectionPending\\..+';

function parseMaestroActions(actions: string): unknown[] {
  const document = YAML.parseDocument(actions);
  assert.equal(document.errors.length, 0, document.errors.map((error) => error.message).join('; '));
  const parsed = document.toJS() as unknown;
  assert(Array.isArray(parsed));
  return parsed;
}

void test('the actual connection-submit builder emits parser-safe regex YAML', () => {
  for (const profile of [IOS_CONNECTION_PLATFORM, ANDROID_CONNECTION_PLATFORM]) {
    const actions = buildNativeConnectionSubmissionActions(profile, 'TEST-CODE');
    const commands = parseMaestroActions(actions);

    assert.deepEqual(
      commands.map((command) =>
        typeof command === 'string' ? [command] : Object.keys(command as object),
      ),
      [['tapOn'], ['eraseText'], ['inputText'], ['hideKeyboard'], ['tapOn'], ['extendedWaitUntil']],
    );
    assert.equal((commands[2] as { inputText: string }).inputText, 'TEST-CODE');
    assert.equal(
      (
        commands[5] as {
          extendedWaitUntil: { visible: { id: string }; timeout: number };
        }
      ).extendedWaitUntil.visible.id,
      expectedPendingIdPattern,
    );
    assert.equal(
      (
        commands[5] as {
          extendedWaitUntil: { visible: { id: string }; timeout: number };
        }
      ).extendedWaitUntil.timeout,
      90000,
    );
  }
});

void test('the former one-backslash double-quoted selector is rejected before UI execution', () => {
  const malformed =
    '- extendedWaitUntil:\n' +
    '    visible:\n' +
    '      id: "student\\.professionals\\.connectionPending\\..+"\n' +
    '    timeout: 90000\n';

  assert.throws(
    () => YAML.parse(malformed),
    (error: unknown) =>
      error instanceof Error && /Invalid escape sequence \\. /.test(error.message),
  );
});
