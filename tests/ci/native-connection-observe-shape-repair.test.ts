import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptIosConnectionObserve,
  adaptIosContext,
} from '../../scripts/testing/native-connection-journey';

type SharedObserve = ReturnType<typeof adaptIosConnectionObserve>;
type ObserveAction = Parameters<SharedObserve>[5];

const acceptAction = { kind: 'accept' } as unknown as ObserveAction;
const endAction = { kind: 'end' } as unknown as ObserveAction;

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

void test('the iOS adapter forwards semantic account navigation into the runtime contract', async () => {
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
});
