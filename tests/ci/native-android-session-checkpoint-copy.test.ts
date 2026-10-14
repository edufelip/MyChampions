import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  persistAndroidSessionCheckpointArtifacts,
  type AndroidSessionCheckpointApiLifetime,
} from '../../scripts/testing/native-android-session-checkpoint-copy';
import type { AndroidSessionCheckpointReceipt } from '../../scripts/testing/native-android-session-adapter';

type Phase = 'before-login' | 'after-login' | 'after-restoration' | 'after-signed-out-relaunch';
const phases: readonly Phase[] = [
  'before-login',
  'after-login',
  'after-restoration',
  'after-signed-out-relaunch',
];
const runId = '0123456789abcdef01234567';
const scope = 'native-entry-android';
const apiOrigin = 'http://127.0.0.1:41001';
const apiPid = 41001;
const apiStarted = 'Thu Oct  2 04:00:00 2026';
const apiScript = '/server/scripts/testing/serve.ts';
const backendAttemptId = `${runId}:first`;
const manifestSha256 = 'a'.repeat(64);
const fixtureAuthUidAllowlistHash = 'b'.repeat(64);
const uid = process.getuid?.() ?? 501;
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function profile(phase: Phase, index: number) {
  const timestamp = `2026-10-02T04:0${index}:00.000Z`;
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1',
    runId,
    scope,
    readOnly: true,
    fixtureAuthUids: ['coach-auth', 'student-auth'],
    target: {
      professionalAuthUid: 'coach-auth',
      studentAuthUid: 'student-auth',
      specialty: 'fitness_coach',
    },
    rowCounts: {
      userProfiles: 2,
      professionalSpecialties: 0,
      inviteCodes: 0,
      connections: 0,
      connectionInviteGuards: 0,
      pendingStudents: 0,
      pendingStudentSlots: 0,
      trackingAccess: 0,
      activeSpecialties: 0,
    },
    rows: {
      userProfiles: [
        {
          authUid: 'coach-auth',
          lockedRole: 'professional',
          acceptedTermsVersion: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        {
          authUid: 'student-auth',
          lockedRole: 'student',
          acceptedTermsVersion: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      professionalSpecialties: [],
      inviteCodes: [],
      connections: [],
      connectionInviteGuards: [],
      pendingStudents: [],
      pendingStudentSlots: [],
      trackingAccess: [],
      activeSpecialties: [],
    },
  };
}

function domain(phase: Phase, index: number) {
  const timestamp = `2026-10-02T04:0${index}:00.000Z`;
  return {
    schemaVersion: 1,
    runId,
    scope,
    readOnly: true,
    trainingPlans: [
      {
        id: `plan-${index}`,
        studentAuthUid: 'student-auth',
        ownerProfessionalUid: 'coach-auth',
        sourceKind: 'assigned',
        name: null,
        isArchived: false,
        isDraft: false,
        lifecycleConnectionId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        sessions: [],
      },
    ],
    connections: [],
  };
}

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'android-session-v3-')));
  const sourceRoot = path.join(root, 'owned');
  const outputRoot = path.join(root, 'capture');
  await mkdir(sourceRoot, { mode: 0o700 });
  await mkdir(outputRoot, { mode: 0o700 });
  const checkpoints: AndroidSessionCheckpointReceipt[] = [];
  for (const [index, phase] of phases.entries()) {
    const profilePath = `profile-${phase}.private.json`;
    const domainPath = `domain-${phase}.private.json`;
    const profileBytes = Buffer.from(JSON.stringify(profile(phase, index)));
    const domainBytes = Buffer.from(JSON.stringify(domain(phase, index)));
    await writeFile(path.join(sourceRoot, profilePath), profileBytes, { mode: 0o600 });
    await writeFile(path.join(sourceRoot, domainPath), domainBytes, { mode: 0o600 });
    checkpoints.push({
      phase,
      runId,
      scope,
      apiOrigin,
      apiPid,
      backendAttemptId,
      manifestSha256,
      fixtureAuthUidAllowlistHash,
      profile: {
        path: profilePath,
        sizeBytes: profileBytes.length,
        sha256: digest(profileBytes),
        ownerUid: uid,
        mode: 0o600,
        verification: 'owned-runtime-document-v6',
      },
      domain: {
        path: domainPath,
        sizeBytes: domainBytes.length,
        sha256: digest(domainBytes),
        ownerUid: uid,
        mode: 0o600,
        verification: 'owned-runtime-document-v6',
      },
    });
  }
  const api: AndroidSessionCheckpointApiLifetime = {
    runId,
    apiOrigin,
    apiPid,
    apiStarted,
    apiScript,
    backendAttemptId,
    manifestSha256,
  };
  return { root, sourceRoot, outputRoot, checkpoints, api };
}

function options(
  value: Awaited<ReturnType<typeof fixture>>,
  probe: () => Promise<AndroidSessionCheckpointApiLifetime>,
) {
  return {
    outputRoot: value.outputRoot,
    sourceRoot: value.sourceRoot,
    checkpoints: value.checkpoints,
    expectedRunId: runId,
    expectedScope: scope,
    expectedApiOrigin: apiOrigin,
    expectedApiPid: apiPid,
    expectedBackendAttemptId: backendAttemptId,
    expectedManifestSha256: manifestSha256,
    expectedFixtureAuthUidAllowlistHash: fixtureAuthUidAllowlistHash,
    expectedApiStarted: apiStarted,
    expectedApiScript: apiScript,
    probeApiLifetime: probe,
  };
}

async function cleanup(value: Awaited<ReturnType<typeof fixture>>) {
  await rm(value.root, { recursive: true, force: true });
}

void test('actual owner copy writes all four profile/domain pairs before cleanup', async () => {
  const value = await fixture();
  try {
    const events: string[] = [];
    const copied = await persistAndroidSessionCheckpointArtifacts(
      options(value, () => {
        events.push('api-probe');
        return Promise.resolve(value.api);
      }),
    );
    events.push('copy-returned');
    assert.deepEqual(events, ['api-probe', 'api-probe', 'api-probe', 'copy-returned']);
    assert.equal(copied.checkpoints.length, 4);
    for (const checkpoint of copied.checkpoints) {
      for (const receipt of [checkpoint.profile, checkpoint.domain]) {
        const bytes = await readFile(path.join(value.outputRoot, receipt.path));
        assert.equal(bytes.length, receipt.sizeBytes);
        assert.equal(digest(bytes), receipt.sha256);
        assert.equal(receipt.sha256, receipt.source.sha256);
        assert.equal((await stat(path.join(value.outputRoot, receipt.path))).mode & 0o777, 0o600);
      }
    }
    await rm(value.sourceRoot, { recursive: true, force: true });
    assert.equal(
      (await stat(path.join(value.outputRoot, copied.checkpoints[0].profile.path))).isFile(),
      true,
    );
    events.push('cleanup');
    assert.deepEqual(events, ['api-probe', 'api-probe', 'api-probe', 'copy-returned', 'cleanup']);
  } finally {
    await cleanup(value);
  }
});

void test('late source mutation after copy is rejected before cleanup', async () => {
  const value = await fixture();
  try {
    let probes = 0;
    await assert.rejects(
      persistAndroidSessionCheckpointArtifacts(
        options(value, async () => {
          probes++;
          if (probes === 2)
            await writeFile(
              path.join(value.sourceRoot, value.checkpoints[3].domain.path),
              Buffer.from(JSON.stringify(domain('after-signed-out-relaunch', 99))),
              { mode: 0o600 },
            );
          return value.api;
        }),
      ),
      /checkpoint source|Owned runtime document|hash changed/,
    );
    assert.equal(probes, 2);
    assert.equal((await stat(value.sourceRoot)).isDirectory(), true);
  } finally {
    await cleanup(value);
  }
});

void test('late API restart identity is rejected before publishing the bundle', async () => {
  const value = await fixture();
  try {
    let probes = 0;
    await assert.rejects(
      persistAndroidSessionCheckpointArtifacts(
        options(value, () => {
          probes++;
          return Promise.resolve(
            probes === 1 ? value.api : { ...value.api, apiPid: value.api.apiPid + 1 },
          );
        }),
      ),
      /PID changed/,
    );
    assert.equal(probes, 2);
  } finally {
    await cleanup(value);
  }
});

void test('late API restart after source reread is rejected before publication', async () => {
  const value = await fixture();
  try {
    let probes = 0;
    await assert.rejects(
      persistAndroidSessionCheckpointArtifacts(
        options(value, () => {
          probes++;
          return Promise.resolve(
            probes < 3 ? value.api : { ...value.api, apiPid: value.api.apiPid + 1 },
          );
        }),
      ),
      /PID changed/,
    );
    assert.equal(probes, 3);
    assert.equal((await stat(value.sourceRoot)).isDirectory(), true);
  } finally {
    await cleanup(value);
  }
});

void test('forged protected receipt and failed read prevent cleanup ordering', async () => {
  const value = await fixture();
  let missing: Awaited<ReturnType<typeof fixture>> | undefined;
  try {
    const forged = structuredClone(value);
    forged.checkpoints[0].profile.sha256 = 'c'.repeat(64);
    await assert.rejects(
      persistAndroidSessionCheckpointArtifacts(options(forged, () => Promise.resolve(value.api))),
      /checkpoint source|hash changed|source receipt|forged/,
    );
    missing = await fixture();
    await rm(path.join(missing.sourceRoot, missing.checkpoints[2].profile.path));
    await assert.rejects(
      persistAndroidSessionCheckpointArtifacts(
        options(missing, () => Promise.resolve(missing!.api)),
      ),
      /ENOENT|no such file|Owned runtime/,
    );
    assert.equal((await stat(missing.outputRoot)).isDirectory(), true);
  } finally {
    await cleanup(value);
    if (missing) await cleanup(missing);
  }
});

void test('abort before acquisition prevents any copy probe', async () => {
  const value = await fixture();
  try {
    const controller = new AbortController();
    controller.abort(new Error('test abort'));
    let probes = 0;
    await assert.rejects(
      persistAndroidSessionCheckpointArtifacts({
        ...options(value, () => {
          probes++;
          return Promise.resolve(value.api);
        }),
        signal: controller.signal,
      }),
      /aborted|test abort/,
    );
    assert.equal(probes, 0);
  } finally {
    await cleanup(value);
  }
});

void test('abort after initial lifetime probe prevents publication before cleanup', async () => {
  const value = await fixture();
  try {
    const controller = new AbortController();
    const events: string[] = [];
    let probes = 0;
    await assert.rejects(
      persistAndroidSessionCheckpointArtifacts({
        ...options(value, () => {
          probes++;
          events.push('api-probe');
          controller.abort(new Error('cancel during checkpoint copy'));
          return Promise.resolve(value.api);
        }),
        signal: controller.signal,
      }),
      /aborted|cancel during checkpoint copy/,
    );
    assert.equal(probes, 1);
    assert.deepEqual(events, ['api-probe']);
    assert.equal((await stat(value.sourceRoot)).isDirectory(), true);
    assert.equal((await stat(value.outputRoot)).isDirectory(), true);
  } finally {
    await cleanup(value);
  }
});
void test('abort after final lifetime probe is fenced before publication', async () => {
  const value = await fixture();
  try {
    const controller = new AbortController();
    let probes = 0;
    await assert.rejects(
      persistAndroidSessionCheckpointArtifacts({
        ...options(value, () => {
          probes++;
          if (probes === 3) controller.abort(new Error('final checkpoint fence'));
          return Promise.resolve(value.api);
        }),
        signal: controller.signal,
      }),
      /aborted|final checkpoint fence/,
    );
    assert.equal(probes, 3);
    assert.equal((await stat(value.sourceRoot)).isDirectory(), true);
    assert.equal((await stat(value.outputRoot)).isDirectory(), true);
  } finally {
    await cleanup(value);
  }
});
