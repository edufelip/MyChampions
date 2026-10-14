import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  androidSessionPublicAssertionIds,
  androidSessionPublicSelection,
  type AndroidSessionPublicDependencyResult,
} from '../../scripts/testing/native-android-session-public-contract';
import {
  collectAndroidSessionProducerReceipts,
  readAndroidStagedSourceForTest,
  requiredAndroidSessionBundlePaths,
  stageAndroidSessionPublicDependency,
  verifyAndroidStagedFileForTest,
  verifyStagedAndroidSessionDependency,
  type AndroidSessionProducerReceipt,
} from '../../scripts/testing/native-android-session-public-staging';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const id = (letter: string) => letter.repeat(24);

/**
 * This is an injected post-selection fixture. The production caller must use
 * selectNativePilotScenario against the live declaration; staging tests must
 * not become coupled to unrelated inventory drift.
 */
function selection(): Promise<NativePilotSelection> {
  return Promise.resolve({
    arguments: { ...androidSessionPublicSelection },
    scenario: {
      id: 'SCN-session-android',
      platform: 'android',
      engine: 'maestro',
      flowId: 'FLW-session',
      transitionIds: [],
      requirementRefs: [],
      dataMode: 'postgres',
      fixtureRef: 'owned-postgres:SCN-session-android:fresh-attempt',
      freshnessInputs: { requirementPaths: [] },
    },
    scenarioHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64),
  });
}

function dependency(captureRunId: string): AndroidSessionPublicDependencyResult {
  const framePaths = Array.from(
    { length: 30 },
    (_, index) => `frames/frame-${String(index + 1).padStart(2, '0')}.private.json`,
  );
  const profilePaths = Array.from(
    { length: 4 },
    (_, index) => `android-session-checkpoints/phase-${index + 1}/profile.private.json`,
  );
  const domainPaths = Array.from(
    { length: 4 },
    (_, index) => `android-session-checkpoints/phase-${index + 1}/domain.private.json`,
  );
  return {
    kind: 'private-android-session-public-dependency-not-public-receipt',
    status: 'validated-source-only',
    platform: 'android',
    engine: 'maestro',
    charter: 'session-account',
    assertionIds: [...androidSessionPublicAssertionIds],
    captureRunId,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    serverRevocationQualified: false,
    cleanup: 'cleaned',
    files: {
      framePaths,
      profilePaths,
      domainPaths,
      transportPath: 'transport-observations.private.json',
      nativeAuthIdentitiesPath: 'native-auth-identities.private.json',
      sqlPaths: ['sql/session-before.private.json', 'sql/session-after.private.json'],
    },
    verification: {
      profileCheckpointStatus: 'verified',
      signInRequestId: 1,
      restorationHydrateRequestId: 2,
      signedOutRequestCount: 1,
      coachAuthUidHash: 'a'.repeat(64),
      fixtureAuthUidAllowlistHash: 'b'.repeat(64),
    },
  };
}

async function fixture<T>(
  callback: (input: {
    captureRoot: string;
    outputRoot: string;
    captureRunId: string;
    requestedRunId: string;
    dependency: AndroidSessionPublicDependencyResult;
    producerReceipts: readonly AndroidSessionProducerReceipt[];
  }) => Promise<T>,
): Promise<T> {
  const parent = await mkdtemp(
    path.join(await realpath(os.tmpdir()), 'android-session-staging-candidate-'),
  );
  const captureRunId = id('a');
  const requestedRunId = id('b');
  const captureRoot = path.join(parent, captureRunId);
  const outputRoot = path.join(parent, requestedRunId);
  await mkdir(captureRoot, { recursive: true, mode: 0o700 });
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const value = dependency(captureRunId);
  const paths = requiredAndroidSessionBundlePaths(value);
  const bytesByPath = new Map<string, Buffer>();
  for (const [index, relative] of paths.entries()) {
    const target = path.join(captureRoot, relative);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(`android-evidence-${index}\n`);
    await writeFile(target, bytes, { mode: 0o600 });
    bytesByPath.set(relative, bytes);
  }
  const producerReceipts = await Promise.all(
    paths.map(async (relative): Promise<AndroidSessionProducerReceipt> => {
      const metadata = await lstat(path.join(captureRoot, relative));
      const bytes = bytesByPath.get(relative);
      assert(bytes);
      return {
        path: relative,
        sizeBytes: metadata.size,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ownerUid: metadata.uid,
        mode: metadata.mode & 0o777,
        verification: 'owned-stable-reader-v6',
        ...(relative === 'capture.private.json' || relative === 'external-cleanup.private.json'
          ? { kind: 'sidecar' }
          : {}),
        ...(relative.startsWith('sql/') ? { kind: 'query' } : {}),
        ...(relative === 'transport-observations.private.json' ? { kind: 'transport' } : {}),
        ...(relative === 'native-auth-identities.private.json' ? { kind: 'auth' } : {}),
        ...(relative.endsWith('.png') ? { contentKind: 'png' } : {}),
        ...(relative.endsWith('-hierarchy.json') ? { contentKind: 'hierarchy-json' } : {}),
        ...(relative.endsWith('-hierarchy.stdout') ? { contentKind: 'hierarchy-source' } : {}),
      };
    }),
  );
  try {
    return await callback({
      captureRoot,
      outputRoot,
      captureRunId,
      requestedRunId,
      dependency: value,
      producerReceipts,
    });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
}

void test('Android staging copies the bounded six-assertion bundle and re-verifies every byte', async () => {
  const current = await selection();
  await fixture(
    async ({
      captureRoot,
      outputRoot,
      captureRunId,
      requestedRunId,
      dependency: value,
      producerReceipts,
    }) => {
      const staged = await stageAndroidSessionPublicDependency({
        dependency: value,
        captureRoot,
        outputRoot,
        requestedRunId,
        selection: current,
        producerReceipts,
      });
      assert.equal(staged.nativePassingCases, 0);
      assert.equal(staged.publicPromotionEligible, false);
      assert.deepEqual(staged.assertionIds, androidSessionPublicAssertionIds);
      await verifyStagedAndroidSessionDependency({
        outputRoot,
        copyManifest: staged.copyManifest,
        requestedRunId,
        captureRunId,
        captureRoot,
        dependency: value,
        selection: current,
        producerReceipts,
      });
      assert.equal(staged.artifacts.length > 1, true);
    },
  );
});

void test('Android staging rejects changed manifest bytes and copied evidence', async () => {
  const current = await selection();
  await fixture(
    async ({
      captureRoot,
      outputRoot,
      captureRunId,
      requestedRunId,
      dependency: value,
      producerReceipts,
    }) => {
      const staged = await stageAndroidSessionPublicDependency({
        dependency: value,
        captureRoot,
        outputRoot,
        requestedRunId,
        selection: current,
        producerReceipts,
      });
      const manifestPath = path.join(outputRoot, staged.copyManifest.path);
      await writeFile(manifestPath, Buffer.from('tampered'), { mode: 0o600 });
      await assert.rejects(
        verifyStagedAndroidSessionDependency({
          outputRoot,
          copyManifest: staged.copyManifest,
          requestedRunId,
          captureRunId,
          captureRoot,
          dependency: value,
          selection: current,
          producerReceipts,
        }),
        /manifest changed/,
      );
    },
  );
});

void test('Android staging binds the complete durable selection and its digest', async () => {
  const current = await selection();
  await fixture(
    async ({
      captureRoot,
      outputRoot,
      captureRunId,
      requestedRunId,
      dependency: value,
      producerReceipts,
    }) => {
      const staged = await stageAndroidSessionPublicDependency({
        dependency: value,
        captureRoot,
        outputRoot,
        requestedRunId,
        selection: current,
        producerReceipts,
      });
      const manifestPath = path.join(outputRoot, staged.copyManifest.path);
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
      const binding = manifest.selectionBinding as Record<string, unknown>;
      binding.scenarioHash = 'c'.repeat(64);
      const mutated = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
      await writeFile(manifestPath, mutated, { mode: 0o600 });
      await assert.rejects(
        verifyStagedAndroidSessionDependency({
          outputRoot,
          copyManifest: {
            path: staged.copyManifest.path,
            sha256: createHash('sha256').update(mutated).digest('hex'),
          },
          requestedRunId,
          captureRunId,
          captureRoot,
          dependency: value,
          selection: current,
          producerReceipts,
        }),
        /selection binding/,
      );
    },
  );
});

void test('Android staging rejects missing files, wrong selection and public receipt creation', async () => {
  const current = await selection();
  await fixture(
    async ({
      captureRoot,
      outputRoot,
      captureRunId,
      requestedRunId,
      dependency: value,
      producerReceipts,
    }) => {
      const staged = await stageAndroidSessionPublicDependency({
        dependency: value,
        captureRoot,
        outputRoot,
        requestedRunId,
        selection: current,
        producerReceipts,
      });
      const first = staged.artifacts.find((relative) => relative.endsWith('frame-01.private.json'));
      assert(first);
      await rm(path.join(outputRoot, first));
      await assert.rejects(
        verifyStagedAndroidSessionDependency({
          outputRoot,
          copyManifest: staged.copyManifest,
          requestedRunId,
          captureRunId,
          captureRoot,
          dependency: value,
          selection: current,
          producerReceipts,
        }),
        /ENOENT|no such file|staged byte/,
      );
      await assert.rejects(
        stageAndroidSessionPublicDependency({
          dependency: value,
          captureRoot,
          outputRoot,
          requestedRunId,
          selection: { ...current, arguments: { ...current.arguments, engine: 'detox' as never } },
          producerReceipts,
        }),
        /Android|selection|Expected values/,
      );
      await writeFile(path.join(outputRoot, 'receipt.json'), '{}', { mode: 0o600 });
      await assert.rejects(
        verifyStagedAndroidSessionDependency({
          outputRoot,
          copyManifest: staged.copyManifest,
          requestedRunId,
          captureRunId,
          captureRoot,
          dependency: value,
          selection: current,
          producerReceipts,
        }),
        /receipt\.json|staged byte|ENOENT/,
      );
    },
  );
});

void test('Android staging requires private output roots', async () => {
  const current = await selection();
  await fixture(
    async ({ captureRoot, outputRoot, requestedRunId, dependency: value, producerReceipts }) => {
      await chmod(outputRoot, 0o755);
      await assert.rejects(
        stageAndroidSessionPublicDependency({
          dependency: value,
          captureRoot,
          outputRoot,
          requestedRunId,
          selection: current,
          producerReceipts,
        }),
        /private/,
      );
    },
  );
});

void test('Android staging binds the producer receipt set and source metadata', async () => {
  const current = await selection();
  await fixture(
    async ({
      captureRoot,
      outputRoot,
      captureRunId,
      requestedRunId,
      dependency: value,
      producerReceipts,
    }) => {
      const source = path.join(captureRoot, producerReceipts[0].path);
      await chmod(source, 0o644);
      await assert.rejects(
        stageAndroidSessionPublicDependency({
          dependency: value,
          captureRoot,
          outputRoot,
          requestedRunId,
          selection: current,
          producerReceipts,
        }),
        /0600|mode|private/,
      );
      await chmod(source, 0o600);
      await assert.rejects(
        stageAndroidSessionPublicDependency({
          dependency: value,
          captureRoot,
          outputRoot,
          requestedRunId,
          selection: current,
          producerReceipts: [...producerReceipts, producerReceipts[0]],
        }),
        /duplicated/,
      );
      const staged = await stageAndroidSessionPublicDependency({
        dependency: value,
        captureRoot,
        outputRoot,
        requestedRunId,
        selection: current,
        producerReceipts,
      });
      await writeFile(source, Buffer.from('source mutated after copy\n'), { mode: 0o600 });
      await assert.rejects(
        verifyStagedAndroidSessionDependency({
          outputRoot,
          copyManifest: staged.copyManifest,
          requestedRunId,
          captureRunId,
          captureRoot,
          dependency: value,
          selection: current,
          producerReceipts,
        }),
        /source hash changed|byte count changed|timestamp changed/,
      );
    },
  );
});

void test('Android receipt collection accepts producer receipts only, never current bytes', () => {
  const explicit: AndroidSessionProducerReceipt = {
    path: 'capture.private.json',
    sizeBytes: 4,
    sha256: 'a'.repeat(64),
    ownerUid: process.getuid?.() ?? 501,
    mode: 0o600,
    verification: 'owned-stable-reader-v6',
  };
  assert.deepEqual(
    collectAndroidSessionProducerReceipts({
      producerFiles: [explicit, { path: 'frames/implicit.json', bytes: 'current bytes' }],
      repeated: { receipt: explicit },
    }),
    [explicit],
  );
});

void test('Android staging rejects destination replacement after the byte read', async () => {
  const current = await selection();
  await fixture(
    async ({ captureRoot, outputRoot, requestedRunId, dependency: value, producerReceipts }) => {
      const staged = await stageAndroidSessionPublicDependency({
        dependency: value,
        captureRoot,
        outputRoot,
        requestedRunId,
        selection: current,
        producerReceipts,
      });
      const relative = staged.artifacts.find((item) => item.endsWith('frame-01.private.json'));
      assert(relative);
      const file = {
        path: 'frames/frame-01.private.json',
        sha256: producerReceipts.find((row) => row.path === 'frames/frame-01.private.json')!.sha256,
        bytes: producerReceipts.find((row) => row.path === 'frames/frame-01.private.json')!
          .sizeBytes,
        sourceReceipt: producerReceipts.find((row) => row.path === 'frames/frame-01.private.json')!,
      };
      const target = path.join(outputRoot, relative);
      const replacement = `${target}.replacement`;
      await assert.rejects(
        verifyAndroidStagedFileForTest({
          outputRoot,
          prefix: `evidence/${value.captureRunId}`,
          file,
          afterRead: async () => {
            await rename(target, replacement);
            await writeFile(target, Buffer.from('android-evidence-0\n'), { mode: 0o600 });
          },
        }),
        /inode|metadata|timestamp|changed/,
      );
      await rm(replacement, { force: true });
    },
  );
});

void test('Android staging source reader rejects source replacement after the byte read', async () => {
  await fixture(async ({ captureRoot, producerReceipts }) => {
    const sourceReceipt = producerReceipts.find((value) =>
      value.path.endsWith('frame-01.private.json'),
    );
    assert(sourceReceipt);
    const sourcePath = path.join(captureRoot, sourceReceipt.path);
    const movedPath = `${sourcePath}.moved`;
    await assert.rejects(
      readAndroidStagedSourceForTest({
        captureRoot,
        receipt: sourceReceipt,
        afterRead: async () => rename(sourcePath, movedPath),
      }),
      /changed|canonical|ENOENT/,
    );
  });
});
