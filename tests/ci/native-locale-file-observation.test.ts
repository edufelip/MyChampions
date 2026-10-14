import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildNativeLocaleContextCandidateFromFile } from '../../scripts/testing/native-locale-file-observation';
import type { NativeLocaleBinding } from '../../scripts/testing/locale-native-observation';

const binding: NativeLocaleBinding = {
  captureRunId: 'a'.repeat(24),
  sourceTreeHash: '1'.repeat(64),
  helperInputsHash: '2'.repeat(64),
  target: {
    platform: 'ios',
    deviceId: 'owned-device',
    osVersion: 'iOS-26-5',
    appId: 'com.edufelip.mychampions.dev',
    binaryHash: '3'.repeat(64),
    apiOrigin: 'http://127.0.0.1:61251',
  },
};

const observedOsLocale = {
  status: 'read-error',
  source: 'ios-simctl-defaults',
  raw: null,
  resolved: null,
  normalization: 'none',
} as const;

function tree(): unknown {
  return {
    attributes: { testID: 'testing.locale.diagnostic' },
    children: [
      {
        attributes: { testID: 'testing.locale.hydration.hydrated' },
      },
      {
        attributes: { testID: 'testing.locale.effective.en-US' },
      },
      {
        attributes: { testID: 'testing.locale.override.absent' },
      },
    ],
  };
}

async function privateRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locale-file-observer-'));
  await chmod(root, 0o700);
  return realpath(root);
}

function input(artifactRoot: string, hierarchyPath = 'coach-home-hierarchy.json') {
  return {
    artifactRoot,
    hierarchyPath,
    binding,
    expectedBinding: binding,
    observedOsLocale,
  };
}

void test('reads an owned hierarchy and preserves the preparation-only boundary', async () => {
  const root = await privateRoot();
  try {
    const bytes = Buffer.from(JSON.stringify(tree()));
    const hierarchyPath = path.join(root, 'coach-home-hierarchy.json');
    await writeFile(hierarchyPath, bytes, { mode: 0o600 });
    const result = buildNativeLocaleContextCandidateFromFile(input(root));
    assert.equal(result.status, 'preparation-only');
    assert.equal(result.runtimeQualification, 'pending');
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.publicLocale, null);
    assert.equal(result.treePath, 'coach-home-hierarchy.json');
    assert.equal(result.treeHash, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(result.appObservation, {
      status: 'observed',
      snapshot: {
        hydration: 'hydrated',
        effectiveSource: 'LocaleContext',
        effectiveLocale: 'en-US',
        override: { status: 'absent', source: 'language-storage', value: null },
      },
    });
    assert.deepEqual(result.observedOsLocale, observedOsLocale);
    assert.ok(result.blockers.includes('runtime-proof-pending'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('keeps unreadable, malformed and escaped files blocked', async () => {
  const root = await privateRoot();
  try {
    const malformedPath = path.join(root, 'malformed.json');
    await writeFile(malformedPath, '{', { mode: 0o600 });
    const malformed = buildNativeLocaleContextCandidateFromFile(input(root, 'malformed.json'));
    assert.equal(malformed.runtimeQualification, 'pending');
    assert.equal(malformed.publicLocale, null);
    assert.equal(malformed.treePath, 'malformed.json');
    assert.equal(malformed.appObservation.status, 'blocked');
    assert.ok(malformed.blockers.includes('hierarchy-json-invalid'));

    const escaped = buildNativeLocaleContextCandidateFromFile(input(root, '../outside.json'));
    assert.equal(escaped.appObservation.status, 'blocked');
    assert.ok(escaped.blockers.includes('hierarchy-file-unreadable'));
    assert.equal(escaped.publicLocale, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('does not accept source-shaped runtime metadata through the file adapter', async () => {
  const root = await privateRoot();
  try {
    const hierarchyPath = path.join(root, 'coach-home-hierarchy.json');
    await writeFile(hierarchyPath, JSON.stringify(tree()), { mode: 0o600 });
    const runtimeShapedInput = {
      ...input(root),
      runtimeMetadata: {
        hydratedDevice: { status: 'observed', value: 'pt-BR' },
        reset: { status: 'observed' },
        relaunch: { status: 'observed' },
        cleanup: { status: 'observed' },
        rawStorageValue: 'private-value-must-not-leak',
      },
    } as unknown as Parameters<typeof buildNativeLocaleContextCandidateFromFile>[0];
    const result = buildNativeLocaleContextCandidateFromFile(runtimeShapedInput);
    assert.equal(result.nativePassingCases, 0);
    assert.equal(result.runtimeBoundary.reset, 'pending');
    assert.equal(result.runtimeBoundary.relaunch, 'pending');
    assert.equal(result.runtimeBoundary.cleanup, 'pending');
    assert.equal(result.publicLocale, null);
    assert.equal('runtimeMetadata' in result, false);
    assert.equal(JSON.stringify(result).includes('private-value-must-not-leak'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
