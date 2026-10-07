import { createHash } from 'node:crypto';

export const T17_REGRESSION_SCHEMA_VERSION = 1 as const;
export const T17_RUNTIME_QUALIFICATION = 'pending' as const;

const sha256Pattern = /^[a-f0-9]{64}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const relativePathPattern =
  /^(?!\/)(?![A-Za-z]:)(?!\.\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\\u0000\r\n]+$/;
const forbiddenValuePattern =
  /(postgres(?:ql)?:\/\/|bearer\s+|access[_-]?token|refresh[_-]?token|authorization\s*[:=]|cookie\s*[:=]|password\s*[:=])/i;

export type T17ExecutionOrigin = 'source-control' | 'actual-runtime';
export type T17SourceState = 'baseline' | 'mutated' | 'restored';
export type T17EvidenceKind = 'observation' | 'requirement' | 'cleanup' | 'source';
export type T17EvidencePrivacy = 'private' | 'public-screenshot';
export type T17Outcome = 'failed' | 'passed';

export type T17EvidenceBinding = {
  artifactRoot: string;
  runId: string;
  attemptId: string;
  targetIdentity: string;
  fixtureIdentity: string;
  cleanupIdentity: string;
  sourceHash: string;
  helperHash: string;
};

export type T17EvidenceRef = {
  kind: T17EvidenceKind;
  privacy: T17EvidencePrivacy;
  path: string;
  sha256: string;
  binding: T17EvidenceBinding;
};

export type T17RequirementComparison = {
  requirementRef: string;
  expected: 'pass';
  observed: 'fail' | 'pass';
  classification: 'confirmed-defect' | 'clean-control' | 'restored-pass';
};

export type T17AttemptIdentity = {
  runId: string;
  attemptId: string;
  targetIdentity: string;
  fixtureIdentity: string;
  cleanupIdentity: string;
  sourceHash: string;
  helperHash: string;
  executionOrigin: T17ExecutionOrigin;
  cleanup: {
    status: 'cleaned';
    ownedResourceIds: string[];
    evidence: T17EvidenceRef;
  };
};

export type T17Attempt = {
  id: string;
  identity: T17AttemptIdentity;
  outcome: T17Outcome;
  sourceState: T17SourceState;
  requirementComparison: T17RequirementComparison;
  originalEvidence: T17EvidenceRef[];
  requirementEvidence: T17EvidenceRef[];
};

export type T17RegressionEvidence = {
  schemaVersion: typeof T17_REGRESSION_SCHEMA_VERSION;
  artifactRoot: string;
  regressionId: string;
  requirementRefs: string[];
  reproductions: [T17Attempt, T17Attempt];
  cleanControl: T17Attempt & {
    links: {
      reproductionRunIds: [string, string];
      restoredRunId: string;
    };
  };
  restored: T17Attempt;
  sourceRestoration: {
    baselineHash: string;
    mutatedHash: string;
    restoredHash: string;
    baseline: T17EvidenceRef;
    mutated: T17EvidenceRef;
    restored: T17EvidenceRef;
  };
};

export type T17OriginalEvidenceReader = (
  artifactRoot: string,
  relativePath: string,
  privateRecord: boolean,
) => Buffer;

export type T17RegressionValidation = {
  status: 'accepted-source-contract' | 'blocked';
  issues: string[];
  runtimeQualification: typeof T17_RUNTIME_QUALIFICATION;
  promotionEligible: false;
  sourceControlAttempts: number;
  originalEvidenceRead: number;
  verifiedRunIds: string[];
};

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(
  value: RecordValue,
  allowed: readonly string[],
  label: string,
  issues: string[],
): void {
  const expected = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) issues.push(`${label} contains unknown field ${key}`);
  }
}

function safeText(value: unknown, label: string, issues: string[], max = 512): value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value.trim() !== value ||
    value.includes('\u0000') ||
    value.includes('\n') ||
    value.includes('\r') ||
    forbiddenValuePattern.test(value)
  ) {
    issues.push(`${label} is malformed or contains forbidden sensitive text`);
    return false;
  }
  return true;
}

function safeIdentifier(value: unknown, label: string, issues: string[]): value is string {
  if (!safeText(value, label, issues, 128) || !identifierPattern.test(value)) {
    issues.push(`${label} is not a bounded identifier`);
    return false;
  }
  return true;
}

function safeHash(value: unknown, label: string, issues: string[]): value is string {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    issues.push(`${label} is not a SHA-256 fingerprint`);
    return false;
  }
  return true;
}

const evidenceBindingIdentityFields = [
  'runId',
  'attemptId',
  'targetIdentity',
  'fixtureIdentity',
  'cleanupIdentity',
] as const;

function validateEvidenceBinding(
  value: unknown,
  label: string,
  issues: string[],
): value is T17EvidenceBinding {
  if (!isRecord(value)) {
    issues.push(`${label} is not a receipt binding`);
    return false;
  }
  exactKeys(
    value,
    ['artifactRoot', ...evidenceBindingIdentityFields, 'sourceHash', 'helperHash'],
    label,
    issues,
  );
  safeText(value.artifactRoot, `${label}.artifactRoot`, issues, 1024);
  evidenceBindingIdentityFields.forEach((field) =>
    safeIdentifier(value[field], `${label}.${field}`, issues),
  );
  safeHash(value.sourceHash, `${label}.sourceHash`, issues);
  safeHash(value.helperHash, `${label}.helperHash`, issues);
  return true;
}

function requireEvidenceBinding(
  value: unknown,
  label: string,
  recordArtifactRoot: string | undefined,
  expectedIdentity: T17AttemptIdentity | undefined,
  issues: string[],
): void {
  if (!validateEvidenceBinding(value, label, issues)) return;
  if (recordArtifactRoot !== undefined && value.artifactRoot !== recordArtifactRoot)
    issues.push(`${label}.artifactRoot is not bound to record.artifactRoot`);
  if (!expectedIdentity) return;
  for (const field of [...evidenceBindingIdentityFields, 'sourceHash', 'helperHash'] as const) {
    if (value[field] !== expectedIdentity[field])
      issues.push(`${label}.${field} is not bound to its attempt identity`);
  }
}

function validateEvidenceRef(
  value: unknown,
  label: string,
  issues: string[],
  expectedKind?: T17EvidenceKind,
): value is T17EvidenceRef {
  if (!isRecord(value)) {
    issues.push(`${label} is not an evidence reference`);
    return false;
  }
  exactKeys(value, ['kind', 'privacy', 'path', 'sha256', 'binding'], label, issues);
  if (!['observation', 'requirement', 'cleanup', 'source'].includes(value.kind as string))
    issues.push(`${label}.kind is unsupported`);
  if (expectedKind !== undefined && value.kind !== expectedKind)
    issues.push(`${label}.kind must be ${expectedKind}`);
  if (!safeText(value.path, `${label}.path`, issues, 240) || !relativePathPattern.test(value.path))
    issues.push(`${label}.path must be a safe artifact-relative path`);
  if (!['private', 'public-screenshot'].includes(value.privacy as string))
    issues.push(`${label}.privacy is unsupported`);
  if (
    value.privacy === 'public-screenshot' &&
    (value.kind !== 'observation' ||
      typeof value.path !== 'string' ||
      !value.path.toLowerCase().endsWith('.png'))
  )
    issues.push(`${label}.public-screenshot privacy requires an observation PNG`);
  if (
    value.privacy === 'private' &&
    value.kind === 'observation' &&
    typeof value.path === 'string' &&
    value.path.toLowerCase().endsWith('.png')
  )
    issues.push(`${label}.PNG observation must declare public-screenshot privacy`);
  safeHash(value.sha256, `${label}.sha256`, issues);
  validateEvidenceBinding(value.binding, `${label}.binding`, issues);
  return true;
}

function validateRequirementComparison(
  value: unknown,
  label: string,
  expectedClassification: T17RequirementComparison['classification'],
  expectedObserved: T17RequirementComparison['observed'],
  issues: string[],
): value is T17RequirementComparison {
  if (!isRecord(value)) {
    issues.push(`${label} is not a requirement comparison`);
    return false;
  }
  exactKeys(value, ['requirementRef', 'expected', 'observed', 'classification'], label, issues);
  safeText(value.requirementRef, `${label}.requirementRef`, issues, 240);
  if (value.expected !== 'pass') issues.push(`${label}.expected must be pass`);
  if (value.observed !== expectedObserved)
    issues.push(`${label}.observed must be ${expectedObserved}`);
  if (value.classification !== expectedClassification)
    issues.push(`${label}.classification must be ${expectedClassification}`);
  return true;
}

function validateAttempt(
  value: unknown,
  label: string,
  expectedOutcome: T17Outcome,
  expectedSourceState: T17SourceState,
  expectedObserved: T17RequirementComparison['observed'],
  expectedClassification: T17RequirementComparison['classification'],
  issues: string[],
  artifactRoot: string | undefined,
  allowLinks = false,
): value is T17Attempt {
  if (!isRecord(value)) {
    issues.push(`${label} is not an attempt`);
    return false;
  }
  exactKeys(
    value,
    [
      'id',
      'identity',
      'outcome',
      'sourceState',
      'requirementComparison',
      'originalEvidence',
      'requirementEvidence',
      ...(allowLinks ? ['links'] : []),
    ],
    label,
    issues,
  );
  safeIdentifier(value.id, `${label}.id`, issues);
  if (value.outcome !== expectedOutcome) issues.push(`${label}.outcome must be ${expectedOutcome}`);
  if (value.sourceState !== expectedSourceState)
    issues.push(`${label}.sourceState must be ${expectedSourceState}`);
  validateRequirementComparison(
    value.requirementComparison,
    `${label}.requirementComparison`,
    expectedClassification,
    expectedObserved,
    issues,
  );
  if (!Array.isArray(value.originalEvidence) || value.originalEvidence.length === 0)
    issues.push(`${label}.originalEvidence must be nonempty`);
  else
    value.originalEvidence.forEach((ref, index) =>
      validateEvidenceRef(ref, `${label}.originalEvidence[${index}]`, issues, 'observation'),
    );
  if (!Array.isArray(value.requirementEvidence) || value.requirementEvidence.length === 0)
    issues.push(`${label}.requirementEvidence must be nonempty`);
  else
    value.requirementEvidence.forEach((ref, index) =>
      validateEvidenceRef(ref, `${label}.requirementEvidence[${index}]`, issues, 'requirement'),
    );
  const identity = validateAttemptIdentity(value.identity, `${label}.identity`, issues)
    ? value.identity
    : undefined;
  if (identity && typeof value.id === 'string' && identity.attemptId !== value.id)
    issues.push(`${label}.id must equal ${label}.identity.attemptId`);
  if (identity) {
    for (const [group, refs] of [
      ['originalEvidence', value.originalEvidence],
      ['requirementEvidence', value.requirementEvidence],
      ['cleanupEvidence', [identity.cleanup?.evidence]],
    ] as const) {
      if (!Array.isArray(refs)) continue;
      refs.forEach((ref, index) =>
        requireEvidenceBinding(
          isRecord(ref) ? ref.binding : undefined,
          `${label}.${group}[${index}].binding`,
          artifactRoot,
          identity,
          issues,
        ),
      );
    }
  }
  return true;
}

function validateAttemptIdentity(
  value: unknown,
  label: string,
  issues: string[],
): value is T17AttemptIdentity {
  if (!isRecord(value)) {
    issues.push(`${label} is not an attempt identity`);
    return false;
  }
  exactKeys(
    value,
    [
      'runId',
      'attemptId',
      'targetIdentity',
      'fixtureIdentity',
      'cleanupIdentity',
      'sourceHash',
      'helperHash',
      'executionOrigin',
      'cleanup',
    ],
    label,
    issues,
  );
  for (const key of [
    'runId',
    'attemptId',
    'targetIdentity',
    'fixtureIdentity',
    'cleanupIdentity',
  ] as const)
    safeIdentifier(value[key], `${label}.${key}`, issues);
  safeHash(value.sourceHash, `${label}.sourceHash`, issues);
  safeHash(value.helperHash, `${label}.helperHash`, issues);
  if (!['source-control', 'actual-runtime'].includes(value.executionOrigin as string))
    issues.push(`${label}.executionOrigin is unsupported`);
  if (!isRecord(value.cleanup)) {
    issues.push(`${label}.cleanup is not present`);
  } else {
    exactKeys(
      value.cleanup,
      ['status', 'ownedResourceIds', 'evidence'],
      `${label}.cleanup`,
      issues,
    );
    if (value.cleanup.status !== 'cleaned') issues.push(`${label}.cleanup.status must be cleaned`);
    if (!Array.isArray(value.cleanup.ownedResourceIds)) {
      issues.push(`${label}.cleanup.ownedResourceIds must be an array`);
    } else {
      const ids = value.cleanup.ownedResourceIds;
      ids.forEach((id, index) =>
        safeIdentifier(id, `${label}.cleanup.ownedResourceIds[${index}]`, issues),
      );
      if (new Set(ids).size !== ids.length)
        issues.push(`${label}.cleanup.ownedResourceIds contains duplicates`);
    }
    validateEvidenceRef(value.cleanup.evidence, `${label}.cleanup.evidence`, issues, 'cleanup');
  }
  return true;
}

function hashBytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readAndVerify(
  reader: T17OriginalEvidenceReader,
  artifactRoot: string,
  ref: T17EvidenceRef,
  label: string,
  issues: string[],
): boolean {
  try {
    const bytes = reader(artifactRoot, ref.path, ref.privacy === 'private');
    if (!Buffer.isBuffer(bytes)) {
      issues.push(`${label} reader did not return bytes`);
      return false;
    }
    if (hashBytes(bytes) !== ref.sha256) {
      issues.push(`${label} bytes do not match its declared SHA-256`);
      return false;
    }
    return true;
  } catch {
    issues.push(`${label} original evidence is unavailable or unreadable`);
    return false;
  }
}

function collectEvidence(
  reader: T17OriginalEvidenceReader,
  artifactRoot: string,
  attempt: T17Attempt,
  label: string,
  issues: string[],
): number {
  let count = 0;
  for (const [group, refs] of [
    ['originalEvidence', attempt.originalEvidence],
    ['requirementEvidence', attempt.requirementEvidence],
    ['cleanupEvidence', [attempt.identity.cleanup.evidence]],
  ] as const) {
    refs.forEach((ref, index) => {
      if (readAndVerify(reader, artifactRoot, ref, `${label}.${group}[${index}]`, issues))
        count += 1;
    });
  }
  return count;
}

function distinctIdentityValues(
  attempts: readonly T17Attempt[],
  field: keyof T17AttemptIdentity,
  issues: string[],
): void {
  const seen = new Set<string>();
  for (const attempt of attempts) {
    const value = attempt.identity[field];
    if (typeof value !== 'string') continue;
    if (seen.has(value)) issues.push(`duplicate ${String(field)} ${value}`);
    seen.add(value);
  }
}

function rejectDuplicateEvidencePaths(
  attempts: readonly T17Attempt[],
  sourceRestoration: RecordValue | undefined,
  issues: string[],
): void {
  const seen = new Map<string, string>();
  const entries: [string, unknown][] = [];
  attempts.forEach((attempt) => {
    if (Array.isArray(attempt.originalEvidence))
      attempt.originalEvidence.forEach((ref, index) =>
        entries.push([`${attempt.id}.originalEvidence[${index}]`, ref]),
      );
    if (Array.isArray(attempt.requirementEvidence))
      attempt.requirementEvidence.forEach((ref, index) =>
        entries.push([`${attempt.id}.requirementEvidence[${index}]`, ref]),
      );
    const cleanup =
      isRecord(attempt.identity) && isRecord(attempt.identity.cleanup)
        ? attempt.identity.cleanup.evidence
        : undefined;
    entries.push([`${attempt.id}.cleanupEvidence`, cleanup]);
  });
  if (sourceRestoration) {
    for (const key of ['baseline', 'mutated', 'restored'] as const)
      entries.push([`sourceRestoration.${key}`, sourceRestoration[key]]);
  }
  for (const [label, value] of entries) {
    if (!isRecord(value) || typeof value.path !== 'string') continue;
    const previous = seen.get(value.path);
    if (previous) issues.push(`duplicate evidence path ${value.path} (${previous}, ${label})`);
    else seen.set(value.path, label);
  }
}

export function validateT17RegressionEvidence(
  input: unknown,
  reader: T17OriginalEvidenceReader,
): T17RegressionValidation {
  const issues: string[] = [];
  let originalEvidenceRead = 0;
  if (!isRecord(input)) {
    return {
      status: 'blocked',
      issues: ['record is not an object'],
      runtimeQualification: T17_RUNTIME_QUALIFICATION,
      promotionEligible: false,
      sourceControlAttempts: 0,
      originalEvidenceRead,
      verifiedRunIds: [],
    };
  }
  exactKeys(
    input,
    [
      'schemaVersion',
      'artifactRoot',
      'regressionId',
      'requirementRefs',
      'reproductions',
      'cleanControl',
      'restored',
      'sourceRestoration',
    ],
    'record',
    issues,
  );
  const recordArtifactRoot =
    typeof input.artifactRoot === 'string' ? input.artifactRoot : undefined;
  if (input.schemaVersion !== T17_REGRESSION_SCHEMA_VERSION)
    issues.push('record.schemaVersion is unsupported');
  if (!safeText(input.artifactRoot, 'record.artifactRoot', issues, 1024))
    issues.push('record.artifactRoot is required');
  safeIdentifier(input.regressionId, 'record.regressionId', issues);
  if (!Array.isArray(input.requirementRefs) || input.requirementRefs.length === 0) {
    issues.push('record.requirementRefs must be nonempty');
  } else {
    input.requirementRefs.forEach((ref, index) =>
      safeText(ref, `record.requirementRefs[${index}]`, issues, 240),
    );
    if (new Set(input.requirementRefs).size !== input.requirementRefs.length)
      issues.push('record.requirementRefs contains duplicates');
  }
  if (!Array.isArray(input.reproductions) || input.reproductions.length !== 2) {
    issues.push('record.reproductions must contain exactly two attempts');
  }
  if (!isRecord(input.sourceRestoration)) {
    issues.push('record.sourceRestoration is required');
  } else {
    exactKeys(
      input.sourceRestoration,
      ['baselineHash', 'mutatedHash', 'restoredHash', 'baseline', 'mutated', 'restored'],
      'record.sourceRestoration',
      issues,
    );
    safeHash(input.sourceRestoration.baselineHash, 'record.sourceRestoration.baselineHash', issues);
    safeHash(input.sourceRestoration.mutatedHash, 'record.sourceRestoration.mutatedHash', issues);
    safeHash(input.sourceRestoration.restoredHash, 'record.sourceRestoration.restoredHash', issues);
    validateEvidenceRef(
      input.sourceRestoration.baseline,
      'record.sourceRestoration.baseline',
      issues,
      'source',
    );
    validateEvidenceRef(
      input.sourceRestoration.mutated,
      'record.sourceRestoration.mutated',
      issues,
      'source',
    );
    validateEvidenceRef(
      input.sourceRestoration.restored,
      'record.sourceRestoration.restored',
      issues,
      'source',
    );
    if (
      typeof input.sourceRestoration.baselineHash === 'string' &&
      typeof input.sourceRestoration.mutatedHash === 'string' &&
      input.sourceRestoration.baselineHash === input.sourceRestoration.mutatedHash
    )
      issues.push('source baseline and mutated fingerprints must differ');
    if (
      typeof input.sourceRestoration.baselineHash === 'string' &&
      typeof input.sourceRestoration.restoredHash === 'string' &&
      input.sourceRestoration.baselineHash !== input.sourceRestoration.restoredHash
    )
      issues.push('restored source fingerprint must equal baseline');
  }

  const reproductions = Array.isArray(input.reproductions) ? input.reproductions : [];
  const validReproductions: T17Attempt[] = [];
  reproductions.forEach((attempt, index) => {
    if (
      validateAttempt(
        attempt,
        `record.reproductions[${index}]`,
        'failed',
        'mutated',
        'fail',
        'confirmed-defect',
        issues,
        recordArtifactRoot,
      )
    )
      validReproductions.push(attempt);
  });
  const restored = validateAttempt(
    input.restored,
    'record.restored',
    'passed',
    'restored',
    'pass',
    'restored-pass',
    issues,
    recordArtifactRoot,
  )
    ? input.restored
    : null;
  const cleanControl = validateAttempt(
    input.cleanControl,
    'record.cleanControl',
    'passed',
    'baseline',
    'pass',
    'clean-control',
    issues,
    recordArtifactRoot,
    true,
  )
    ? input.cleanControl
    : null;

  const attempts = [
    ...validReproductions,
    ...(cleanControl ? [cleanControl] : []),
    ...(restored ? [restored] : []),
  ];
  for (const field of [
    'runId',
    'attemptId',
    'targetIdentity',
    'fixtureIdentity',
    'cleanupIdentity',
  ] as const)
    distinctIdentityValues(attempts, field, issues);
  const attemptIds = new Set(attempts.map((attempt) => attempt.id));
  if (attemptIds.size !== attempts.length) issues.push('attempt IDs must be distinct');

  if (Array.isArray(input.requirementRefs)) {
    for (const attempt of attempts) {
      const requirementRef = attempt.requirementComparison.requirementRef;
      if (!input.requirementRefs.includes(requirementRef))
        issues.push(`${attempt.id} requirement reference is not declared by the record`);
    }
  }

  if (
    restored &&
    cleanControl &&
    isRecord(input.cleanControl) &&
    isRecord(input.cleanControl.links)
  ) {
    exactKeys(
      input.cleanControl.links,
      ['reproductionRunIds', 'restoredRunId'],
      'record.cleanControl.links',
      issues,
    );
    const reproductionRunIds = input.cleanControl.links.reproductionRunIds;
    if (
      !Array.isArray(reproductionRunIds) ||
      reproductionRunIds.length !== 2 ||
      new Set(reproductionRunIds).size !== reproductionRunIds.length ||
      !validReproductions.every((attempt) => reproductionRunIds.includes(attempt.identity.runId))
    )
      issues.push('clean control must link exactly both reproduction run IDs');
    if (input.cleanControl.links.restoredRunId !== restored.identity.runId)
      issues.push('clean control must link the restored run ID');
  } else {
    issues.push('clean control linkage is required');
  }

  if (isRecord(input.sourceRestoration)) {
    const sourceRestoration = input.sourceRestoration;
    const refs: [string, unknown, string | undefined, T17AttemptIdentity | undefined][] = [
      [
        'sourceRestoration.baseline',
        sourceRestoration.baseline,
        sourceRestoration.baselineHash as string | undefined,
        cleanControl?.identity,
      ],
      [
        'sourceRestoration.mutated',
        sourceRestoration.mutated,
        sourceRestoration.mutatedHash as string | undefined,
        validReproductions[0]?.identity,
      ],
      [
        'sourceRestoration.restored',
        sourceRestoration.restored,
        sourceRestoration.restoredHash as string | undefined,
        restored?.identity,
      ],
    ];
    refs.forEach(([label, ref, expectedHash, expectedIdentity]) => {
      if (validateEvidenceRef(ref, label, issues, 'source')) {
        if (typeof expectedHash === 'string' && ref.sha256 !== expectedHash)
          issues.push(`${label} bytes are not bound to its restoration fingerprint`);
        requireEvidenceBinding(
          ref.binding,
          `${label}.binding`,
          recordArtifactRoot,
          expectedIdentity,
          issues,
        );
        originalEvidenceRead += readAndVerify(
          reader,
          input.artifactRoot as string,
          ref,
          label,
          issues,
        )
          ? 1
          : 0;
      }
    });
    if (
      restored &&
      typeof sourceRestoration.restoredHash === 'string' &&
      restored.identity.sourceHash !== sourceRestoration.restoredHash
    )
      issues.push('restored attempt source fingerprint is not bound to restored source');
    if (
      cleanControl &&
      typeof sourceRestoration.baselineHash === 'string' &&
      cleanControl.identity.sourceHash !== sourceRestoration.baselineHash
    )
      issues.push('clean control source fingerprint is not bound to baseline source');
    if (
      validReproductions.some(
        (attempt) =>
          typeof sourceRestoration.mutatedHash === 'string' &&
          attempt.identity.sourceHash !== sourceRestoration.mutatedHash,
      )
    )
      issues.push('reproduction source fingerprint is not bound to mutated source');
  }
  rejectDuplicateEvidencePaths(
    attempts,
    isRecord(input.sourceRestoration) ? input.sourceRestoration : undefined,
    issues,
  );
  for (const attempt of attempts)
    originalEvidenceRead += collectEvidence(
      reader,
      input.artifactRoot as string,
      attempt,
      `record.${attempt.id}`,
      issues,
    );

  const sourceControlAttempts = attempts.filter(
    (attempt) => attempt.identity.executionOrigin === 'source-control',
  ).length;
  return {
    status: issues.length === 0 ? 'accepted-source-contract' : 'blocked',
    issues: [...new Set(issues)],
    runtimeQualification: T17_RUNTIME_QUALIFICATION,
    promotionEligible: false,
    sourceControlAttempts,
    originalEvidenceRead,
    verifiedRunIds: issues.length === 0 ? attempts.map((attempt) => attempt.identity.runId) : [],
  };
}
