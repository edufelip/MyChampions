import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import {
  readNativeEvidenceObservation,
  type NativeEvidenceIdentity,
} from '../../scripts/testing/native-view-evidence';
import {
  awaitT16Lifecycle,
  projectIosConnectionT16BTerminal,
} from '../../scripts/testing/run-ios-connection-attempt';
import {
  buildT16BParentOwnedInputBinding,
  requireT16BVerifiedParentOwnedInputBinding,
  verifyT16BParentOwnedInputBinding,
} from '../../scripts/testing/t16b-outer-cleanup-binding';
import type { NativeConnectionAttemptBinding } from '../../scripts/testing/native-connection-attempt-binding';

const runId = 'a'.repeat(24);
const backendRunId = 'b'.repeat(24);
const kinds = [
  'target',
  'build',
  'tool',
  'locale',
  'roles',
  'fixture',
  'reset',
  'authApi',
  'sql',
  'ownership',
] as const;

function connectionBinding(captureRunId = runId): NativeConnectionAttemptBinding {
  return {
    schemaVersion: 1,
    kind: 'private-native-connection-attempt-binding-not-public-receipt',
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    captureRunId,
    backendRunId,
    backendAttemptId: `${backendRunId}:first`,
    fixtureScope: 'native-entry-ios',
    scenarioId: 'SCN-connection-ios',
    selection: {
      arguments: {
        platform: 'ios',
        engine: 'maestro',
        scenario: 'SCN-connection-ios',
        mode: 'integration',
      },
      scenarioHash: 'd'.repeat(64),
      requirementHash: 'e'.repeat(64),
    },
    assertionIds: ['assertion-one'],
    assertionSemanticSha256: 'f'.repeat(64),
    assertionContractSha256: '1'.repeat(64),
    nativePassingCases: 0,
  };
}

function cleanupBinding(artifactRoot: string) {
  return {
    schemaVersion: 1 as const,
    kind: 'private-t16-b-outer-cleanup-binding-not-public-receipt' as const,
    scope: 'outer-ios-native-session' as const,
    captureRunId: runId,
    artifactRoot,
    source: {
      path: 'external-cleanup.private.json' as const,
      bytes: 128,
      sha256: 'a'.repeat(64),
      identity: {
        dev: 1,
        ino: 2,
        uid: 3,
        gid: 4,
        mode: 0o600,
        nlink: 1,
        size: 128,
        mtimeMs: 1,
        ctimeMs: 1,
      },
    },
    facts: {
      kind: 'independent ios native inventory cleanup proof' as const,
      result: 'passed' as const,
      runId,
      captureResult: 'observed',
      captureCleanupClean: true,
      pidStartPairs: 1,
      survivors: [],
      unknownProcessQueries: [],
      missingForeignDevices: [],
      ownedDeviceAbsent: true,
      cacheAbsent: true,
      docker: { container: [], network: [], volume: [] },
      finishedAt: '2026-10-04T00:00:00.000Z',
    },
  };
}

type FixtureSelectionEvidence = Record<
  string,
  {
    path: string;
    sha256: string;
    bytes: number;
    kind: string;
    identity: NativeEvidenceIdentity;
  }
>;

async function fixture(): Promise<{
  parent: string;
  root: string;
  selectionEvidence: FixtureSelectionEvidence;
}> {
  const artifacts = path.join(process.cwd(), '.qa', 'artifacts');
  await mkdir(artifacts, { recursive: true, mode: 0o700 });
  const parent = await mkdtemp(path.join(artifacts, 't16b-v3-'));
  await chmod(parent, 0o700);
  const root = path.join(parent, runId);
  await mkdir(root, { mode: 0o700 });
  await chmod(root, 0o700);
  const selectionEvidence = Object.fromEntries(
    await Promise.all(
      kinds.map(async (kind) => {
        const relative = `selection-${kind}.private.json`;
        const bytes = Buffer.from(JSON.stringify({ kind, original: true }), 'utf8');
        await writeFile(path.join(root, relative), bytes, { flag: 'wx', mode: 0o600 });
        await chmod(path.join(root, relative), 0o600);
        const observation = readNativeEvidenceObservation(root, relative, true);
        return [
          kind,
          {
            path: relative,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            bytes: bytes.byteLength,
            kind,
            identity: observation.identity,
          },
        ];
      }),
    ),
  ) as FixtureSelectionEvidence;
  return { parent, root, selectionEvidence };
}

void test('terminal consumes only a protected parent reread with descriptor identities', async () => {
  const { parent, root, selectionEvidence } = await fixture();
  try {
    const compact = buildT16BParentOwnedInputBinding({
      connectionBinding: connectionBinding(),
      selectionEvidence,
    });
    const verified = await verifyT16BParentOwnedInputBinding({
      artifactRoot: root,
      binding: compact,
    });
    const terminal = projectIosConnectionT16BTerminal({
      artifactRoot: root,
      execution: { status: 'explored' },
      outerCleanup: cleanupBinding(root),
      parentOwnedInput: verified,
      captureCleanup: 'cleaned',
      verificationResult: 'passed',
    });
    assert.equal(terminal.status, 'observed');
    assert.equal(terminal.parentOwnedInput?.verification.verified, true);
    assert.equal(terminal.parentOwnedInput?.selectionEvidence.target.identity.nlink, 1);
    requireT16BVerifiedParentOwnedInputBinding(verified, root);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('parent reread rejects a same-path mutation and a late reread catches it', async () => {
  const { parent, root, selectionEvidence } = await fixture();
  try {
    const compact = buildT16BParentOwnedInputBinding({
      connectionBinding: connectionBinding(),
      selectionEvidence,
    });
    const verified = await verifyT16BParentOwnedInputBinding({
      artifactRoot: root,
      binding: compact,
    });
    const targetPath = path.join(root, verified.selectionEvidence.target.path);
    const before = await readFile(targetPath);
    await writeFile(targetPath, Buffer.from(JSON.stringify({ target: 'mutated' }), 'utf8'), {
      mode: 0o600,
    });
    await assert.rejects(
      verifyT16BParentOwnedInputBinding({ artifactRoot: root, binding: compact }),
      /selectionEvidence\.target (?:size|hash) changed/,
    );
    assert.notDeepEqual(before, await readFile(path.join(root, 'selection-target.private.json')));
    // The production caller performs this same protected reread immediately
    // before projection; a late mutation must therefore fail that second
    // read rather than reaching the synchronous projector.
    await assert.rejects(
      verifyT16BParentOwnedInputBinding({ artifactRoot: root, binding: verified }),
      /selectionEvidence\.target (?:size|hash) changed/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('parent reread rejects same-byte inode replacement after selection', async () => {
  const { parent, root, selectionEvidence } = await fixture();
  try {
    const compact = buildT16BParentOwnedInputBinding({
      connectionBinding: connectionBinding(),
      selectionEvidence,
    });
    const targetPath = path.join(root, selectionEvidence.target.path);
    const targetBytes = await readFile(targetPath);
    const replacementPath = path.join(root, 'selection-target.replacement.private.json');
    await writeFile(replacementPath, targetBytes, { flag: 'wx', mode: 0o600 });
    await chmod(replacementPath, 0o600);
    await rename(replacementPath, targetPath);
    await assert.rejects(
      verifyT16BParentOwnedInputBinding({ artifactRoot: root, binding: compact }),
      /selectionEvidence\.target descriptor identity changed/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

void test('a compact or forged parent object cannot become an observed terminal', () => {
  const root = `/owned/.qa/artifacts/native-pilot/${runId}`;
  const compact = buildT16BParentOwnedInputBinding({
    connectionBinding: connectionBinding(),
    selectionEvidence: Object.fromEntries(
      kinds.map((kind) => [
        kind,
        { path: `selection-${kind}.private.json`, sha256: 'c'.repeat(64), bytes: 32, kind },
      ]),
    ),
  });
  const terminal = projectIosConnectionT16BTerminal({
    artifactRoot: root,
    execution: { status: 'explored' },
    outerCleanup: cleanupBinding(root),
    parentOwnedInput: compact,
    captureCleanup: 'cleaned',
    verificationResult: 'passed',
  });
  assert.equal(terminal.status, 'blocked');
  assert(terminal.blockers.includes('parent-owned-input-binding-unavailable'));
});

void test('outer cleanup and evidence preparation cannot cross an abort or absolute deadline fence', async () => {
  const controller = new AbortController();
  const cleanup = awaitT16Lifecycle(
    () =>
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('late-cleanup'), 15);
      }),
    controller.signal,
    undefined,
    'outer cleanup control',
  );
  controller.abort(new Error('outer cleanup cancelled'));
  await assert.rejects(cleanup, /outer cleanup cancelled/);

  const deadline = performance.now() + 1;
  await assert.rejects(
    awaitT16Lifecycle(
      () => new Promise((resolve) => setTimeout(resolve, 10)),
      new AbortController().signal,
      deadline,
      'evidence preparation control',
    ),
    /T16 lifecycle deadline reached during evidence preparation control/,
  );
});
