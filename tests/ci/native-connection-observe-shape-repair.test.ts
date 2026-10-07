import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { requireDetoxConnectionCommand } from '../../scripts/testing/detox-connection-ipc';
import {
  adaptIosConnectionObserve,
  adaptIosContext,
} from '../../scripts/testing/native-connection-journey';

type SharedObserve = ReturnType<typeof adaptIosConnectionObserve>;
type ObserveAction = Parameters<SharedObserve>[5];

const acceptAction = { kind: 'accept' } as unknown as ObserveAction;
const endAction = { kind: 'end' } as unknown as ObserveAction;

const canonicalValue = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonicalValue).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => `${JSON.stringify(key)}:${canonicalValue(child)}`)
          .join(',')}}`
      : JSON.stringify(value);

const hashJson = (value: unknown): string =>
  createHash('sha256').update(canonicalValue(value)).digest('hex');

void test('the iOS adapter consumes the shared action without passing it as selectors', async () => {
  const calls: unknown[][] = [];
  const maestroObserve: Parameters<typeof adaptIosConnectionObserve>[0] = (...args) => {
    calls.push(args);
    return Promise.resolve();
  };
  const observe = adaptIosConnectionObserve(maestroObserve);

  await observe(
    'connection-confirm',
    '- tapOn:\n    id: pro.pending.accept\n- assertNotVisible:\n    text: pending-relation',
    'SCR-pro-pending',
    ['pro.pending.screen'],
    'id',
    acceptAction,
  );

  assert.deepEqual(calls, [
    [
      'connection-confirm',
      '- tapOn:\n    id: pro.pending.accept\n- assertNotVisible:\n    text: pending-relation',
      'SCR-pro-pending',
      ['pro.pending.screen'],
      'id',
    ],
  ]);
  await assert.rejects(
    observe(
      'connection-end',
      '- tapOn:\n    id: pro.active.end',
      'SCR-pro-roster',
      'pro.roster.screen',
      'id',
      endAction,
    ),
    (error: unknown) => error instanceof assert.AssertionError && error.message.includes('accept'),
  );
  assert.equal(calls.length, 1, 'unsupported action must not reach the Maestro observer');
});

void test('the iOS adapter forwards semantic account navigation into both runtime contracts', async () => {
  const calls: [string, string][] = [];
  const context = {
    switchAccount: (actor: string, navigation?: string) => {
      calls.push([actor, navigation ?? 'missing']);
      return Promise.resolve({});
    },
  } as never;
  const adapted = adaptIosContext(context);

  await adapted.switchAccount('coach', 'student-professionals-back');
  await adapted.switchAccount('student', 'none');
  assert.deepEqual(calls, [
    ['coach', 'student-professionals-back'],
    ['student', 'none'],
  ]);

  const commandWithoutHash = {
    schemaVersion: 1,
    commandId: 1,
    kind: 'switch-account',
    platform: 'ios',
    actor: calls[0][0],
    navigation: calls[0][1],
    label: 'connection-switch-1-coach',
    semanticActions: 'owned-detox-account-switch',
    viewId: 'SCR-pro-home',
    selectors: 'pro.home.screen',
    selectorKind: 'id',
    commandHash: undefined,
  };
  const command = requireDetoxConnectionCommand({
    ...commandWithoutHash,
    commandHash: hashJson(commandWithoutHash),
  });
  assert.equal(command.navigation, 'student-professionals-back');
  const invalidNavigation = {
    schemaVersion: 1,
    commandId: 2,
    kind: 'switch-account',
    platform: 'ios',
    actor: 'coach',
    navigation: '- tapOn: back',
    label: 'connection-switch-1-coach',
    semanticActions: 'owned-detox-account-switch',
    viewId: 'SCR-pro-home',
    selectors: 'pro.home.screen',
    selectorKind: 'id',
    commandHash: undefined,
  };
  assert.throws(() =>
    requireDetoxConnectionCommand({
      ...invalidNavigation,
      commandHash: hashJson(invalidNavigation),
    }),
  );
});
