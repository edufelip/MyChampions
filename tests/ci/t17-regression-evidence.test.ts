import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readNativeEvidence } from '../../scripts/testing/native-view-evidence';
import {
  validateT17RegressionEvidence,
  type T17EvidenceKind,
  type T17EvidenceBinding,
  type T17EvidenceRef,
  type T17AttemptIdentity,
  type T17RegressionEvidence,
} from '../../scripts/testing/t17-regression-evidence';

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const helperHash = 'f'.repeat(64);
const requirementRef = 'docs/qa/agent-exploration-playbook-v1.md#L230-L235';

type Fixture = {
  root: string;
  record: T17RegressionEvidence;
  bytes: Map<string, Buffer>;
};

type EvidenceBindingIdentity = Pick<
  T17AttemptIdentity,
  | 'runId'
  | 'attemptId'
  | 'targetIdentity'
  | 'fixtureIdentity'
  | 'cleanupIdentity'
  | 'sourceHash'
  | 'helperHash'
>;

async function privateRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-t17-regression-')));
  await chmod(root, 0o700);
  return root;
}

function makeRef(
  kind: T17EvidenceKind,
  filePath: string,
  bytes: Buffer,
  root: string,
  identity: EvidenceBindingIdentity,
): T17EvidenceRef {
  const binding: T17EvidenceBinding = {
    artifactRoot: root,
    runId: identity.runId,
    attemptId: identity.attemptId,
    targetIdentity: identity.targetIdentity,
    fixtureIdentity: identity.fixtureIdentity,
    cleanupIdentity: identity.cleanupIdentity,
    sourceHash: identity.sourceHash,
    helperHash: identity.helperHash,
  };
  return {
    kind,
    privacy:
      kind === 'observation' && filePath.toLowerCase().endsWith('.png')
        ? 'public-screenshot'
        : 'private',
    path: filePath,
    sha256: hash(bytes),
    binding,
  };
}

function attempt(
  root: string,
  bytes: Map<string, Buffer>,
  label: string,
  outcome: 'failed' | 'passed',
  sourceState: 'baseline' | 'mutated' | 'restored',
  sourceHash: string,
  classification: 'confirmed-defect' | 'clean-control' | 'restored-pass',
  observed: 'fail' | 'pass',
): T17RegressionEvidence['restored'] {
  const observationPath =
    label === 'repro-1'
      ? `evidence/${label}-observation.png`
      : `evidence/${label}-observation.json`;
  const requirementPath = `evidence/${label}-requirement.json`;
  const cleanupPath = `evidence/${label}-cleanup.json`;
  const observation =
    label === 'repro-1'
      ? Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD3sAAAAASUVORK5CYII=',
          'base64',
        )
      : Buffer.from(JSON.stringify({ label, state: sourceState }));
  const requirement = Buffer.from(JSON.stringify({ requirementRef, expected: 'pass', observed }));
  const cleanup = Buffer.from(JSON.stringify({ label, status: 'cleaned', ownedResourceIds: [] }));
  bytes.set(observationPath, observation);
  bytes.set(requirementPath, requirement);
  bytes.set(cleanupPath, cleanup);
  const identity = {
    runId: `run-${label}`,
    attemptId: `attempt-${label}`,
    targetIdentity: `target-${label}`,
    fixtureIdentity: `fixture-${label}`,
    cleanupIdentity: `cleanup-${label}`,
    sourceHash,
    helperHash,
    executionOrigin: 'source-control' as const,
  };
  return {
    id: `attempt-${label}`,
    identity: {
      ...identity,
      cleanup: {
        status: 'cleaned',
        ownedResourceIds: [],
        evidence: makeRef('cleanup', cleanupPath, cleanup, root, identity),
      },
    },
    outcome,
    sourceState,
    requirementComparison: {
      requirementRef,
      expected: 'pass',
      observed,
      classification,
    },
    originalEvidence: [makeRef('observation', observationPath, observation, root, identity)],
    requirementEvidence: [makeRef('requirement', requirementPath, requirement, root, identity)],
  };
}

async function fixture(): Promise<Fixture> {
  const root = await privateRoot();
  const bytes = new Map<string, Buffer>();
  const baseline = Buffer.from('source baseline bytes\n');
  const mutated = Buffer.from('source mutated bytes\n');
  const restored = Buffer.from('source baseline bytes\n');
  bytes.set('source/baseline.ts', baseline);
  bytes.set('source/mutated.ts', mutated);
  bytes.set('source/restored.ts', restored);
  const baselineHash = hash(baseline);
  const mutatedHash = hash(mutated);
  const restoredHash = hash(restored);
  const reproductions = [
    attempt(root, bytes, 'repro-1', 'failed', 'mutated', mutatedHash, 'confirmed-defect', 'fail'),
    attempt(root, bytes, 'repro-2', 'failed', 'mutated', mutatedHash, 'confirmed-defect', 'fail'),
  ] as [T17RegressionEvidence['restored'], T17RegressionEvidence['restored']];
  const cleanControl = attempt(
    root,
    bytes,
    'control',
    'passed',
    'baseline',
    baselineHash,
    'clean-control',
    'pass',
  ) as T17RegressionEvidence['cleanControl'];
  cleanControl.links = {
    reproductionRunIds: [reproductions[0].identity.runId, reproductions[1].identity.runId],
    restoredRunId: 'run-restored',
  };
  const restoredAttempt = attempt(
    root,
    bytes,
    'restored',
    'passed',
    'restored',
    restoredHash,
    'restored-pass',
    'pass',
  );
  const record: T17RegressionEvidence = {
    schemaVersion: 1,
    artifactRoot: root,
    regressionId: 'REG-T17-example',
    requirementRefs: [requirementRef],
    reproductions,
    cleanControl,
    restored: restoredAttempt,
    sourceRestoration: {
      baselineHash,
      mutatedHash,
      restoredHash,
      baseline: makeRef('source', 'source/baseline.ts', baseline, root, cleanControl.identity),
      mutated: makeRef('source', 'source/mutated.ts', mutated, root, reproductions[0].identity),
      restored: makeRef('source', 'source/restored.ts', restored, root, restoredAttempt.identity),
    },
  };
  for (const [filePath, fileBytes] of bytes) {
    const target = path.join(root, filePath);
    await mkdirParent(target);
    await writeFile(target, fileBytes, { mode: filePath.endsWith('.png') ? 0o644 : 0o600 });
  }
  return { root, record, bytes };
}

async function mkdirParent(target: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
}

function validate(record: unknown) {
  return validateT17RegressionEvidence(record, readNativeEvidence);
}

void test('accepts two fresh failing reproductions, linked clean control and restored pass', async () => {
  const input = await fixture();
  try {
    const result = validate(input.record);
    assert.equal(result.status, 'accepted-source-contract');
    assert.equal(result.runtimeQualification, 'pending');
    assert.equal(result.promotionEligible, false);
    assert.equal(result.sourceControlAttempts, 4);
    assert.equal(result.verifiedRunIds.length, 4);
    assert.equal(result.originalEvidenceRead, 15);
    assert.deepEqual(result.issues, []);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('blocks a reversed requirement outcome and retains no verified run IDs', async () => {
  const input = await fixture();
  try {
    const invalid = structuredClone(input.record);
    invalid.reproductions[0].requirementComparison.observed = 'pass';
    const result = validate(invalid);
    assert.equal(result.status, 'blocked');
    assert.match(result.issues.join('|'), /observed must be fail/);
    assert.deepEqual(result.verifiedRunIds, []);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('blocks duplicate identity, incomplete clean linkage and restoration mismatch', async () => {
  const input = await fixture();
  try {
    const invalid = structuredClone(input.record);
    invalid.cleanControl.identity.runId = invalid.reproductions[0].identity.runId;
    invalid.cleanControl.links.reproductionRunIds = [
      invalid.reproductions[0].identity.runId,
      'run-unknown',
    ];
    invalid.sourceRestoration.restoredHash = invalid.sourceRestoration.mutatedHash;
    const result = validate(invalid);
    assert.equal(result.status, 'blocked');
    assert.match(result.issues.join('|'), /duplicate runId/);
    assert.match(result.issues.join('|'), /clean control must link exactly both reproduction/);
    assert.match(result.issues.join('|'), /restored source fingerprint must equal baseline/);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('blocks missing or changed original bytes through the real bounded reader', async () => {
  const input = await fixture();
  try {
    const invalid = structuredClone(input.record);
    invalid.restored.originalEvidence[0].sha256 = '0'.repeat(64);
    const result = validate(invalid);
    assert.equal(result.status, 'blocked');
    assert.match(result.issues.join('|'), /bytes do not match/);
    const missing = structuredClone(input.record);
    missing.cleanControl.requirementEvidence[0].path = 'evidence/missing.json';
    const missingResult = validate(missing);
    assert.equal(missingResult.status, 'blocked');
    assert.match(missingResult.issues.join('|'), /original evidence is unavailable/);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('binds evidence kinds and source snapshots to their declared bytes', async () => {
  const input = await fixture();
  try {
    const kindMismatch = structuredClone(input.record);
    kindMismatch.cleanControl.originalEvidence[0].kind = 'source';
    const kindResult = validate(kindMismatch);
    assert.equal(kindResult.status, 'blocked');
    assert.match(kindResult.issues.join('|'), /kind must be observation/);

    const sourceMismatch = structuredClone(input.record);
    sourceMismatch.sourceRestoration.baselineHash = 'a'.repeat(64);
    const sourceResult = validate(sourceMismatch);
    assert.equal(sourceResult.status, 'blocked');
    assert.match(sourceResult.issues.join('|'), /not bound to its restoration fingerprint/);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('binds privacy, receipt identity and globally unique artifact paths', async () => {
  const input = await fixture();
  try {
    const wrongPngPrivacy = structuredClone(input.record);
    wrongPngPrivacy.reproductions[0].originalEvidence[0].privacy = 'private';
    const wrongPngResult = validate(wrongPngPrivacy);
    assert.equal(wrongPngResult.status, 'blocked');
    assert.match(wrongPngResult.issues.join('|'), /PNG observation must declare public-screenshot/);

    await chmod(
      path.join(input.root, input.record.cleanControl.requirementEvidence[0].path),
      0o644,
    );
    const wrongPrivateModeResult = validate(input.record);
    assert.equal(wrongPrivateModeResult.status, 'blocked');
    assert.match(wrongPrivateModeResult.issues.join('|'), /original evidence is unavailable/);
    await chmod(
      path.join(input.root, input.record.cleanControl.requirementEvidence[0].path),
      0o600,
    );

    const duplicatePath = structuredClone(input.record);
    duplicatePath.cleanControl.requirementEvidence[0].path =
      duplicatePath.reproductions[0].requirementEvidence[0].path;
    const duplicateResult = validate(duplicatePath);
    assert.equal(duplicateResult.status, 'blocked');
    assert.match(duplicateResult.issues.join('|'), /duplicate evidence path/);

    const staleBinding = structuredClone(input.record);
    staleBinding.sourceRestoration.baseline.binding.runId =
      staleBinding.reproductions[0].identity.runId;
    const staleBindingResult = validate(staleBinding);
    assert.equal(staleBindingResult.status, 'blocked');
    assert.match(staleBindingResult.issues.join('|'), /not bound to its attempt identity/);

    const staleAttemptId = structuredClone(input.record);
    staleAttemptId.restored.id = 'attempt-restored-replaced';
    const staleAttemptResult = validate(staleAttemptId);
    assert.equal(staleAttemptResult.status, 'blocked');
    assert.match(staleAttemptResult.issues.join('|'), /id must equal/);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('never promotes a source record from an execution-origin label alone', async () => {
  const input = await fixture();
  try {
    const claimed = structuredClone(input.record);
    claimed.restored.identity.executionOrigin = 'actual-runtime';
    const result = validate(claimed);
    assert.equal(result.status, 'accepted-source-contract');
    assert.equal(result.sourceControlAttempts, 3);
    assert.equal(result.runtimeQualification, 'pending');
    assert.equal(result.promotionEligible, false);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('keeps source-shaped records pending and rejects extra promotion fields', async () => {
  const input = await fixture();
  try {
    const invalid = structuredClone(input.record) as T17RegressionEvidence &
      Record<string, unknown>;
    invalid.publicPromotionEligible = true;
    const result = validate(invalid);
    assert.equal(result.status, 'blocked');
    assert.match(result.issues.join('|'), /unknown field publicPromotionEligible/);
    const valid = validate(input.record);
    assert.equal(valid.runtimeQualification, 'pending');
    assert.equal(valid.promotionEligible, false);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});
