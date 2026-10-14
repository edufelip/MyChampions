import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { treeHash } from '../../scripts/testing/native-build-identity';
import {
  loadReusableIosBuild,
  resolveReusableIosEntryEvidencePaths,
  validateReusableIosBuild,
} from '../../scripts/testing/native-build-reuse';
import { reserveOwnedAppPort } from '../../scripts/testing/owned-expo';

void test('reusable native bytes reject stale sources, rejected observations and changed files', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-reuse-contract-')));
  const runId = '1'.repeat(24);
  const directory = path.join(root, '.qa/artifacts/native-pilot', runId);
  const binary = path.join(
    directory,
    'ios-build/Build/Products/Debug-iphonesimulator/mychampions.app',
  );
  await mkdir(path.join(binary, 'EXConstants.bundle'), { recursive: true, mode: 0o700 });
  const source = { sha: 'a'.repeat(40), dirty: true, sourceTreeHash: 'b'.repeat(64) };
  const extra = {
    appVariant: 'dev',
    server: { baseUrl: 'http://127.0.0.1:50000' },
    e2e: {
      acceptedTermsVersion: '',
      authSession: '',
      createAccount: '',
      emailPasswordSignIn: '',
      socialAuth: '',
    },
  };
  await writeFile(path.join(binary, 'EXConstants.bundle/app.config'), JSON.stringify({ extra }));
  const build = {
    bundleId: 'com.edufelip.mychampions.dev',
    binaryPath: binary,
    binaryHash: await treeHash(binary),
    profile: 'Metro-attached Debug; not bundled release qualification',
    apiOrigin: 'http://127.0.0.1:50000',
    metroOrigin: 'http://127.0.0.1:50001',
    environmentHash: 'c'.repeat(64),
  };
  const capture = {
    result: 'observed',
    cleanup: 'cleaned',
    charter: 'entry',
    source,
    sourceAfter: source,
    build,
  };
  const qualification = {
    result: 'qualified-entry-observation',
    sourceTreeHash: source.sourceTreeHash,
    binaryHash: build.binaryHash,
    cleanupVerified: true,
    screenshotReviewed: true,
  };
  try {
    for (const [name, value] of [
      ['capture.private.json', capture],
      ['entry-qualification.private.json', qualification],
    ] as const)
      await writeFile(path.join(directory, name), JSON.stringify(value), { mode: 0o600 });
    await writeFile(path.join(directory, 'bootstrap.private.log'), 'Bundled native entry', {
      mode: 0o600,
    });
    assert.equal((await loadReusableIosBuild(root, runId, source)).apiPort, 50000);
    assert.throws(
      () =>
        validateReusableIosBuild(capture, qualification, {
          ...source,
          sourceTreeHash: 'd'.repeat(64),
        }),
      /stale/,
    );
    assert.throws(
      () =>
        validateReusableIosBuild(
          { ...capture, runtimeQualificationRejected: true },
          qualification,
          source,
        ),
      /qualified clean/,
    );
    assert.throws(
      () => validateReusableIosBuild(capture, { ...qualification, cleanupVerified: false }, source),
      /qualified clean/,
    );
    const partial = {
      ...capture,
      result: 'harness-blocked',
      charter: 'auth-account',
      viewIds: ['SCR-sign-in'],
    };
    assert.throws(
      () => validateReusableIosBuild(partial, qualification, source),
      /qualified clean/,
    );
    const screenshot = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const hierarchy = Buffer.from(
      JSON.stringify({
        attributes: {},
        children: [
          { attributes: { 'resource-id': 'auth.signIn.emailInput' }, children: [] },
          { attributes: { 'resource-id': 'auth.signIn.passwordInput' }, children: [] },
          { attributes: { 'resource-id': 'auth.signIn.submitButton' }, children: [] },
        ],
      }),
    );
    const reviewed = {
      ...qualification,
      scope: 'entry-only',
      entryEvidence: {
        screenshotHash: createHash('sha256').update(screenshot).digest('hex'),
        hierarchyHash: createHash('sha256').update(hierarchy).digest('hex'),
        screenshotPath: 'entry.png',
        hierarchyPath: 'entry-hierarchy.json',
      },
    };
    await writeFile(
      path.join(directory, 'entry-qualification.private.json'),
      JSON.stringify(reviewed),
      { mode: 0o600 },
    );
    await writeFile(path.join(directory, 'entry.png'), screenshot);
    await writeFile(path.join(directory, 'entry-hierarchy.json'), hierarchy);
    assert.equal((await loadReusableIosBuild(root, runId, source)).binaryHash, build.binaryHash);
    assert.deepEqual(resolveReusableIosEntryEvidencePaths(capture, reviewed.entryEvidence), {
      screenshotPath: 'entry.png',
      hierarchyPath: 'entry-hierarchy.json',
    });
    assert.throws(
      () =>
        validateReusableIosBuild(
          capture,
          {
            ...reviewed,
            entryEvidence: {
              ...reviewed.entryEvidence,
              hierarchyPath: 'entry-hierarchy.private.log',
            },
          },
          source,
        ),
      /does not match/,
    );
    assert.throws(
      () =>
        validateReusableIosBuild(
          capture,
          {
            ...reviewed,
            entryEvidence: { ...reviewed.entryEvidence, screenshotPath: 'other.png' },
          },
          source,
        ),
      /screenshot path is unsupported/,
    );
    await writeFile(path.join(directory, 'entry.png'), 'altered full observation');
    await assert.rejects(loadReusableIosBuild(root, runId, source), /evidence bytes changed/);
    await rm(path.join(directory, 'entry.png'));
    await rm(path.join(directory, 'entry-hierarchy.json'));

    const legacyReviewed = {
      ...reviewed,
      entryEvidence: {
        screenshotHash: reviewed.entryEvidence.screenshotHash,
        hierarchyHash: reviewed.entryEvidence.hierarchyHash,
      },
    };
    await writeFile(path.join(directory, 'capture.private.json'), JSON.stringify(partial), {
      mode: 0o600,
    });
    await writeFile(
      path.join(directory, 'entry-qualification.private.json'),
      JSON.stringify(legacyReviewed),
      { mode: 0o600 },
    );
    await assert.rejects(loadReusableIosBuild(root, runId, source), { code: 'ENOENT' });
    await writeFile(path.join(directory, 'entry.png'), screenshot);
    await writeFile(path.join(directory, 'entry-hierarchy.private.log'), hierarchy);
    assert.equal((await loadReusableIosBuild(root, runId, source)).binaryHash, build.binaryHash);
    assert.deepEqual(resolveReusableIosEntryEvidencePaths(partial, legacyReviewed.entryEvidence), {
      screenshotPath: 'entry.png',
      hierarchyPath: 'entry-hierarchy.private.log',
    });
    assert.throws(
      () =>
        validateReusableIosBuild(
          partial,
          {
            ...legacyReviewed,
            entryEvidence: {
              ...legacyReviewed.entryEvidence,
              hierarchyPath: 'entry-hierarchy.json',
            },
          },
          source,
        ),
      /does not match/,
    );
    assert.throws(
      () =>
        validateReusableIosBuild(
          partial,
          {
            ...legacyReviewed,
            entryEvidence: { ...legacyReviewed.entryEvidence, hierarchyPath: '../escape' },
          },
          source,
        ),
      /does not match/,
    );
    assert.equal(partial.result, 'harness-blocked');
    assert.throws(
      () => validateReusableIosBuild({ ...partial, viewIds: [] }, reviewed, source),
      /qualified clean/,
    );
    await writeFile(path.join(directory, 'entry.png'), 'changed observation');
    await assert.rejects(loadReusableIosBuild(root, runId, source), /evidence bytes changed/);
    await writeFile(path.join(binary, 'modified'), 'changed bytes');
    await assert.rejects(loadReusableIosBuild(root, runId, source), /bytes changed/);
    await assert.rejects(loadReusableIosBuild(root, '../escape', source), /run ID/);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('fixed native endpoints are reserved afresh and never adopt an occupied listener', async () => {
  await assert.rejects(reserveOwnedAppPort(1023), /Invalid/);
  const first = await reserveOwnedAppPort();
  let rebound: Awaited<ReturnType<typeof reserveOwnedAppPort>> | undefined;
  try {
    await assert.rejects(reserveOwnedAppPort(first.port), { code: 'EADDRINUSE' });
    await first.release();
    rebound = await reserveOwnedAppPort(first.port);
    assert.equal(rebound.origin, first.origin);
  } finally {
    await first.release();
    await rebound?.release();
  }
});
