import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  observeIosSessionPostTapDiagnostic,
  observeIosSessionSignOutWithDiagnostic,
  sessionSignOutPostTapActions,
} from '../../scripts/testing/ios-session-post-tap-diagnostic';

const output = '/private/owned/session-diagnostic';
const hierarchyPath = path.join(output, 'maestro-hierarchy.txt');
const hierarchyJson = JSON.stringify({
  attributes: { 'resource-id': 'settings.account.screen' },
  children: [
    {
      attributes: { 'resource-id': 'settings.account.signOutCta' },
      children: [],
    },
    {
      attributes: { 'resource-id': 'settings.account.signOutConfirm' },
      children: [],
    },
    {
      attributes: { 'resource-id': 'settings.account.signOutConfirmCta' },
      children: [],
    },
  ],
});
const validPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

type FakeIoOptions = {
  signal?: AbortSignal;
  oversizedHierarchy?: boolean;
  abortAfterAction?: boolean;
  malformedScreenshot?: boolean;
  missingSelector?: string;
};

function makeFakeIo(options: FakeIoOptions = {}) {
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  const events: string[] = [];
  const writes: string[] = [];
  const runs: string[] = [];
  const reads: string[] = [];
  const io = {
    output,
    bundleId: 'com.example.app',
    deviceUdid: 'SIMULATOR-UDID',
    signal,
    requireBooted: (label: string) => {
      events.push(`boot:${label}`);
      return Promise.resolve();
    },
    writeText: (label: string, file: string) => {
      events.push(`write:${label}`);
      writes.push(file);
      return Promise.resolve();
    },
    run: (label: string) => {
      events.push(`run:${label}`);
      runs.push(label);
      if (options.abortAfterAction && label === 'session-signout-post-tap') controller.abort();
      return Promise.resolve(label.endsWith('hierarchy') ? hierarchyPath : 'maestro-output');
    },
    execute: (label: string) => {
      events.push(`execute:${label}`);
      return Promise.resolve();
    },
    readEvidence: (label: string, relativePath: string) => {
      events.push(`read:${label}`);
      reads.push(relativePath);
      if (options.oversizedHierarchy && label.endsWith('hierarchy-read'))
        return Buffer.alloc(8 * 1024 * 1024 + 1);
      if (relativePath.endsWith('.png'))
        return options.malformedScreenshot ? Buffer.from('not-png') : validPng;
      return Buffer.from(hierarchyJson);
    },
    parseHierarchy: (text: string) => JSON.parse(text) as unknown,
    hasAttribute: (tree: unknown, attribute: string, value: string) => {
      if (value === options.missingSelector) return false;
      const visit = (node: unknown): boolean => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
        const record = node as {
          attributes?: Record<string, unknown>;
          children?: unknown[];
        };
        return (
          record.attributes?.[attribute] === value ||
          (Array.isArray(record.children) && record.children.some(visit))
        );
      };
      return visit(tree);
    },
  };
  return { controller, events, writes, runs, reads, io };
}

void test('session post-tap route preserves one scroll and one tap before confirmation', async () => {
  const events: string[] = [];
  const report: Record<string, unknown> = {
    sessionAssertionSequence: ['initial-auth', 'restored-auth'],
    sessionUiObservationOrder: ['account'],
  };
  const beforeLedger = structuredClone(report);

  await observeIosSessionSignOutWithDiagnostic({
    report,
    observePostTapDiagnostic: (label, actions) => {
      events.push(`diagnostic:${label}`);
      assert.equal(label, 'session-signout-post-tap');
      assert.equal(actions, sessionSignOutPostTapActions);
      assert.equal((actions.match(/- tapOn:/g) ?? []).length, 1);
      assert.doesNotMatch(actions, /retryTapIfNoChange|coordinate|index:/);
      return Promise.resolve({ label, screenshotHash: 'hash' });
    },
    observeSession: (label, actions, viewId, selector) => {
      events.push(`observe:${label}`);
      assert.equal(actions, '');
      assert.equal(viewId, 'STATE-signout-confirm');
      assert.equal(selector, 'settings.account.signOutConfirm');
      return Promise.resolve();
    },
  });

  assert.deepEqual(events, ['diagnostic:session-signout-post-tap', 'observe:signout-confirm']);
  assert.deepEqual(report.sessionAssertionSequence, beforeLedger.sessionAssertionSequence);
  assert.deepEqual(report.sessionUiObservationOrder, beforeLedger.sessionUiObservationOrder);
  assert.deepEqual(report.sessionSignOutPostTapDiagnostic, {
    label: 'session-signout-post-tap',
    screenshotHash: 'hash',
  });
});

void test('failed confirmation retains diagnostic evidence and leaves session ledger unchanged', async () => {
  const report: Record<string, unknown> = {
    sessionAssertionSequence: ['initial-auth'],
    sessionUiObservationOrder: ['account'],
  };
  const beforeLedger = structuredClone(report);

  await assert.rejects(
    observeIosSessionSignOutWithDiagnostic({
      report,
      observePostTapDiagnostic: () =>
        Promise.resolve({
          label: 'session-signout-post-tap',
          hierarchyHash: 'retained',
        }),
      observeSession: () => Promise.reject(new Error('confirmation was not observed')),
    }),
    /confirmation was not observed/,
  );

  assert.deepEqual(report.sessionAssertionSequence, beforeLedger.sessionAssertionSequence);
  assert.deepEqual(report.sessionUiObservationOrder, beforeLedger.sessionUiObservationOrder);
  assert.deepEqual(report.sessionSignOutPostTapDiagnostic, {
    label: 'session-signout-post-tap',
    hierarchyHash: 'retained',
  });
});

void test('session adapter fences abort after the single action and before hierarchy capture', async () => {
  const { events, runs, io } = makeFakeIo({ abortAfterAction: true });

  await assert.rejects(
    observeIosSessionPostTapDiagnostic({
      ...io,
      label: 'session-signout-post-tap',
      actions: sessionSignOutPostTapActions,
    }),
    /aborted/,
  );

  assert.deepEqual(runs, ['session-signout-post-tap']);
  assert.ok(events.includes('write:session-signout-post-tap-flow-write'));
  assert.ok(!events.some((event) => event === 'run:session-signout-post-tap-hierarchy'));
});

void test('session adapter publishes only bounded owned hierarchy and screenshot evidence', async () => {
  const { writes, reads, runs, io } = makeFakeIo();

  const result = await observeIosSessionPostTapDiagnostic({
    ...io,
    label: 'session-signout-post-tap',
    actions: sessionSignOutPostTapActions,
  });

  assert.deepEqual(runs, ['session-signout-post-tap', 'session-signout-post-tap-hierarchy']);
  assert.deepEqual(reads, [
    'session-signout-post-tap.yaml',
    'maestro-hierarchy.txt',
    'session-signout-post-tap-hierarchy.json',
    'session-signout-post-tap.png',
  ]);
  assert.deepEqual(writes, [
    path.join(output, 'session-signout-post-tap.yaml'),
    path.join(output, 'session-signout-post-tap-hierarchy.json'),
  ]);
  assert.equal(result.flowPath, 'session-signout-post-tap.yaml');
  assert.equal(result.hierarchyPath, 'session-signout-post-tap-hierarchy.json');
  assert.equal(result.screenshotPath, 'session-signout-post-tap.png');
  assert.equal(result.hierarchyHash.length, 64);
  assert.equal(result.screenshotHash.length, 64);
  assert.equal(result.flowHash.length, 64);
  assert.equal(result.selectorPresence.signOutConfirmCta, true);
  assert.equal(result.selectorPresence.accountScreen, true);
  assert.equal(result.selectorPresence.signOutCta, true);
});

void test('session adapter rejects oversized hierarchy evidence before canonical write', async () => {
  const { writes, reads, io } = makeFakeIo({ oversizedHierarchy: true });

  await assert.rejects(
    observeIosSessionPostTapDiagnostic({
      ...io,
      label: 'session-signout-post-tap',
      actions: sessionSignOutPostTapActions,
    }),
    /not bounded owned evidence/,
  );

  assert.deepEqual(writes, [path.join(output, 'session-signout-post-tap.yaml')]);
  assert.deepEqual(reads, ['session-signout-post-tap.yaml', 'maestro-hierarchy.txt']);
});

void test('session adapter rejects malformed screenshot bytes but records absent confirmation selectors', async () => {
  const malformed = makeFakeIo({ malformedScreenshot: true });
  await assert.rejects(
    observeIosSessionPostTapDiagnostic({
      ...malformed.io,
      label: 'session-signout-post-tap',
      actions: sessionSignOutPostTapActions,
    }),
    /not a PNG/,
  );

  const missing = makeFakeIo({
    missingSelector: 'settings.account.signOutConfirm',
  });
  const result = await observeIosSessionPostTapDiagnostic({
    ...missing.io,
    label: 'session-signout-post-tap',
    actions: sessionSignOutPostTapActions,
  });
  assert.equal(result.selectorPresence.accountScreen, true);
  assert.equal(result.selectorPresence.signOutCta, true);
  assert.equal(result.selectorPresence.signOutConfirm, false);
  assert.equal(result.selectorPresence.signOutConfirmCta, true);

  const malformedHierarchy = makeFakeIo();
  await assert.rejects(
    observeIosSessionPostTapDiagnostic({
      ...malformedHierarchy.io,
      label: 'session-signout-post-tap',
      actions: sessionSignOutPostTapActions,
      parseHierarchy: () => [],
    }),
    /structured tree/,
  );
});

void test('absent confirmation retains diagnostic evidence before the authoritative session assertion', async () => {
  const report: Record<string, unknown> = {
    sessionAssertionSequence: ['initial-auth', 'restored-auth'],
    sessionUiObservationOrder: ['account'],
  };
  const beforeLedger = structuredClone(report);
  const events: string[] = [];
  const diagnostic = {
    label: 'session-signout-post-tap',
    hierarchyHash: 'retained',
    selectorPresence: {
      accountScreen: true,
      signOutCta: true,
      signOutConfirm: false,
      signOutConfirmCta: false,
    },
  };

  await assert.rejects(
    observeIosSessionSignOutWithDiagnostic({
      report,
      observePostTapDiagnostic: () => {
        events.push('diagnostic');
        return Promise.resolve(diagnostic);
      },
      observeSession: (label, actions, viewId, selector) => {
        events.push(`observe:${label}`);
        assert.equal(actions, '');
        assert.equal(viewId, 'STATE-signout-confirm');
        assert.equal(selector, 'settings.account.signOutConfirm');
        return Promise.reject(new Error('confirmation was not observed'));
      },
    }),
    /confirmation was not observed/,
  );

  assert.deepEqual(events, ['diagnostic', 'observe:signout-confirm']);
  assert.deepEqual(report.sessionAssertionSequence, beforeLedger.sessionAssertionSequence);
  assert.deepEqual(report.sessionUiObservationOrder, beforeLedger.sessionUiObservationOrder);
  assert.deepEqual(report.sessionSignOutPostTapDiagnostic, diagnostic);
});

void test('capture branch delegates session charter to session-aware adapter', async () => {
  const source = await readFile(
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '../../scripts/testing/capture-native-testability.ts',
    ),
    'utf8',
  );
  assert.match(source, /observeIosSessionSignOutWithDiagnostic/);
  assert.match(source, /observeSessionPostTapDiagnostic/);
  const sessionBranchStart = source.indexOf("} else if (charter === 'session')");
  assert.notEqual(sessionBranchStart, -1);
  const sessionBranch = source.slice(
    sessionBranchStart,
    source.indexOf("} else if (charter === 'camera-denied')", sessionBranchStart),
  );
  assert.match(sessionBranch, /observeIosSessionSignOutWithDiagnostic/);
  assert.doesNotMatch(sessionBranch, /retryTapIfNoChange|coordinate:\s*\[/);
});
