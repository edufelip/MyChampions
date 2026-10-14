import assert from 'node:assert/strict';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { requireCoachInviteActionExecution } from '../../scripts/testing/native-camera-submission-evidence';

let root = '';

before(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'mc-camera-p1-binding-')));
  await chmod(root, 0o700);
  await writeFile(
    path.join(root, 'camera-coach-invite.yaml'),
    'appId: com.edufelip.mychampions.dev\nname: Native inventory camera-coach-invite\n---\n- scrollUntilVisible:\n    element:\n      id: pro.home.inviteCodeValue\n    direction: DOWN\n    timeout: 30000\n    centerElement: true\n- extendedWaitUntil:\n    visible:\n      id: pro.home.screen\n    timeout: 90000\n',
    { mode: 0o600 },
  );
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

function commandExecution(overrides: Record<string, unknown> = {}) {
  return {
    label: 'camera-coach-invite',
    command: 'maestro',
    argv: [
      '--no-ansi',
      '--udid',
      'owned',
      'test',
      '--debug-output',
      path.join(root, 'camera-coach-invite-debug'),
      '--test-output-dir',
      path.join(root, 'camera-coach-invite-artifacts'),
      path.join(root, 'camera-coach-invite.yaml'),
    ],
    phase: 'step',
    execution: 'completed',
    cleanup: 'cleaned',
    childExitCode: 0,
    childSignal: null,
    deadlineMs: 30_000,
    logPath: path.join(root, 'camera-coach-invite.log'),
    ownershipPath: path.join(root, 'camera-coach-invite.owner.json'),
    ...overrides,
  };
}

function digestFor(row: ReturnType<typeof commandExecution>) {
  return {
    actionExecution: {
      label: row.label,
      command: row.command,
      argv: row.argv,
      phase: row.phase,
      execution: row.execution,
      cleanup: row.cleanup,
      childExitCode: row.childExitCode,
      childSignal: row.childSignal,
      deadlineMs: row.deadlineMs,
      logPath: row.logPath,
      ownershipPath: row.ownershipPath,
    },
  };
}

void test('camera coach invite visibility binds the actual completed Maestro command', () => {
  const row = commandExecution();
  assert.doesNotThrow(() =>
    requireCoachInviteActionExecution(
      root,
      { captureRoot: root, device: { udid: 'owned' }, commandExecutions: [row] },
      digestFor(row),
    ),
  );
});

void test('camera coach invite visibility rejects missing, failed, foreign, and escaped flow evidence', async () => {
  const valid = commandExecution();
  assert.throws(() =>
    requireCoachInviteActionExecution(
      root,
      { captureRoot: root, commandExecutions: [] },
      digestFor(valid),
    ),
  );
  const failed = commandExecution({ execution: 'child-failed', cleanup: 'unknown' });
  assert.throws(() =>
    requireCoachInviteActionExecution(
      root,
      { captureRoot: root, commandExecutions: [failed] },
      digestFor(failed),
    ),
  );
  const foreign = commandExecution({
    argv: ['maestro', '--device', 'foreign', '/private/tmp/foreign/camera-coach-invite.yaml'],
  });
  assert.throws(() =>
    requireCoachInviteActionExecution(
      root,
      { captureRoot: root, commandExecutions: [foreign] },
      digestFor(foreign),
    ),
  );
  await writeFile(
    path.join(root, 'camera-coach-invite.yaml'),
    'appId: com.edufelip.mychampions.dev\nname: Native inventory camera-coach-invite\n---\n- runFlow:\n    file: foreign.yaml\n',
    { mode: 0o600 },
  );
  const restored = commandExecution();
  assert.throws(() =>
    requireCoachInviteActionExecution(
      root,
      { captureRoot: root, commandExecutions: [restored] },
      digestFor(restored),
    ),
  );
  await writeFile(
    path.join(root, 'camera-coach-invite.yaml'),
    'appId: com.edufelip.mychampions.dev\nname: Native inventory camera-coach-invite\n---\n- scrollUntilVisible:\n    element:\n      id: pro.home.inviteCodeValue\n    direction: DOWN\n    timeout: 30000\n    centerElement: true\n- extendedWaitUntil:\n    visible:\n      id: pro.home.screen\n    timeout: 90000\n',
    { mode: 0o600 },
  );
});
