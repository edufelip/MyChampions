import path from 'node:path';
import {
  runOwnedT16BMaestroExploration,
  type T16BOwnedRuntimeResult,
  type T16BOwnedRuntimeInput,
  type T16BOwnedTargetBinding,
} from './t16b-owned-maestro-runtime';
import type {
  SelectionExpectation,
  T16BSelectionReaders,
} from './t16b-owned-exploration-controller';

/**
 * This is the owned observation boundary for the production T16-B caller.
 * Every value comes from a current observer; no fixture flag or target string
 * is accepted as a substitute for the ten later protected evidence rows.
 */
export type T16BSelectionIdentityObservation = {
  readonly runId: string;
  readonly attemptId: string;
  readonly platform: SelectionExpectation['platform'];
  readonly locale: SelectionExpectation['locale'];
  readonly deviceId: string;
  readonly targetId: string;
  readonly selector: string;
  readonly appIdOrOrigin: string;
  readonly apiOrigin: string;
  readonly buildId: string;
  readonly binarySha256: string;
  readonly connector: SelectionExpectation['connector'];
  readonly roleIds: readonly string[];
  readonly fixtureId: string;
  readonly fixtureMode: SelectionExpectation['fixtureMode'];
  readonly fixtureScope: string;
  readonly resetId: string;
  /** Relative path below the checked-in repository .qa/artifacts root. */
  readonly artifactRoot: string;
  readonly observerPid: number;
  readonly observerUid: number;
  readonly observerStartedAtMonotonicMs: number;
  readonly selectionReceiptId: string;
};

export type T16BFreshSelectionObserver = {
  readonly readSelectionIdentity: (
    signal: AbortSignal,
  ) => Promise<T16BSelectionIdentityObservation>;
  readonly readTarget: T16BSelectionReaders['readTarget'];
  readonly readBuild: T16BSelectionReaders['readBuild'];
  readonly readTool: T16BSelectionReaders['readTool'];
  readonly readLocale: T16BSelectionReaders['readLocale'];
  readonly readRoles: T16BSelectionReaders['readRoles'];
  readonly readFixture: T16BSelectionReaders['readFixture'];
  readonly readReset: T16BSelectionReaders['readReset'];
  readonly readAuthApi: T16BSelectionReaders['readAuthApi'];
  readonly readSql: T16BSelectionReaders['readSql'];
  readonly readOwnership: T16BSelectionReaders['readOwnership'];
  readonly readPostActionEvidence: T16BSelectionReaders['readPostActionEvidence'];
};

export type T16BOwnedRuntimeBootstrapInput = Omit<
  T16BOwnedRuntimeInput,
  'expectation' | 'target' | 'selection'
> & {
  readonly observer: T16BFreshSelectionObserver;
};

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const LOCALES = ['en-US', 'pt-BR', 'es-ES'] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function safeId(value: unknown, label: string): string {
  assert(typeof value === 'string' && SAFE_ID.test(value), `${label} is invalid`);
  return value;
}

function safeText(value: unknown, label: string, max = 512): string {
  assert(
    typeof value === 'string' && value.length > 0 && value.length <= max,
    `${label} is invalid`,
  );
  assert(!/[\u0000\r\n]/.test(value), `${label} contains a control character`);
  return value;
}

function safeOrigin(value: unknown, label: string): string {
  const result = safeText(value, label);
  let parsed: URL;
  try {
    parsed = new URL(result);
  } catch {
    throw new Error(`${label} is not an origin`);
  }
  assert(
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === result &&
      parsed.username === '' &&
      parsed.password === '',
    `${label} must be an origin without credentials or a path`,
  );
  return result;
}

function safeRelativeArtifactRoot(value: unknown): string {
  const result = safeText(value, 'selection identity artifactRoot', 1024);
  assert(!path.isAbsolute(result) && SAFE_PATH.test(result), 'artifactRoot must be relative');
  const parts = result.split('/');
  assert(
    result.startsWith('.qa/artifacts/') && !parts.includes('.') && !parts.includes('..'),
    'artifactRoot must stay below .qa/artifacts',
  );
  return result;
}

function requireObserver(observer: T16BFreshSelectionObserver): void {
  const methods: readonly (keyof T16BFreshSelectionObserver)[] = [
    'readSelectionIdentity',
    'readTarget',
    'readBuild',
    'readTool',
    'readLocale',
    'readRoles',
    'readFixture',
    'readReset',
    'readAuthApi',
    'readSql',
    'readOwnership',
    'readPostActionEvidence',
  ];
  for (const method of methods)
    assert(typeof observer[method] === 'function', `selection observer is missing ${method}`);
}

function freezeIdentity(value: T16BSelectionIdentityObservation): T16BSelectionIdentityObservation {
  const connector = Object.freeze({ ...value.connector });
  return Object.freeze({
    ...value,
    connector,
    roleIds: Object.freeze([...value.roleIds]),
  });
}

export function deriveT16BSelectionExpectation(
  observed: T16BSelectionIdentityObservation,
): SelectionExpectation {
  const value = freezeIdentity(observed);
  const runId = safeId(value.runId, 'selection identity runId');
  const attemptId = safeId(value.attemptId, 'selection identity attemptId');
  assert(attemptId.startsWith(`${runId}:`), 'selection identity attempt is not bound to run');
  assert(value.platform === 'ios' || value.platform === 'android', 'selection platform is invalid');
  assert(LOCALES.includes(value.locale), 'selection locale is invalid');
  const deviceId = safeId(value.deviceId, 'selection deviceId');
  const targetId = safeId(value.targetId, 'selection targetId');
  assert(deviceId === targetId, 'selection device and target identities differ');
  const selector = safeText(value.selector, 'selection selector');
  const appIdOrOrigin = safeText(value.appIdOrOrigin, 'selection appIdOrOrigin');
  const apiOrigin = safeOrigin(value.apiOrigin, 'selection apiOrigin');
  const buildId = safeId(value.buildId, 'selection buildId');
  assert(SHA256.test(value.binarySha256), 'selection binarySha256 is invalid');
  assert(value.connector.kind === 'maestro', 'T16-B bootstrap requires a Maestro observer');
  const connector = {
    kind: 'maestro' as const,
    id: safeId(value.connector.id, 'selection connector id'),
    name: safeText(value.connector.name, 'selection connector name'),
    version: safeText(value.connector.version, 'selection connector version'),
  };
  const roleIds = [...value.roleIds].map((role, index) =>
    safeId(role, `selection roleIds[${index}]`),
  );
  assert(
    roleIds.length > 0 && new Set(roleIds).size === roleIds.length,
    'selection roles are invalid',
  );
  const fixtureId = safeId(value.fixtureId, 'selection fixtureId');
  const fixtureScope = safeId(value.fixtureScope, 'selection fixtureScope');
  const resetId = safeId(value.resetId, 'selection resetId');
  const artifactRoot = safeRelativeArtifactRoot(value.artifactRoot);
  assert(
    value.fixtureMode === 'fixture' || value.fixtureMode === 'integration',
    'selection fixture mode is invalid',
  );
  assert(
    Number.isSafeInteger(value.observerPid) && value.observerPid > 0,
    'selection observer pid is invalid',
  );
  assert(typeof process.getuid === 'function', 'selection observer owner is unavailable');
  assert(value.observerUid === process.getuid(), 'selection observer uid differs');
  assert(
    Number.isFinite(value.observerStartedAtMonotonicMs) && value.observerStartedAtMonotonicMs >= 0,
    'selection observer start is invalid',
  );
  safeId(value.selectionReceiptId, 'selection receipt id');
  return {
    requestedRunId: runId,
    requestedAttemptId: attemptId,
    platform: value.platform,
    locale: value.locale,
    targetId,
    selector,
    appIdOrOrigin,
    apiOrigin,
    buildId,
    binarySha256: value.binarySha256,
    connector,
    roleIds,
    fixtureId,
    fixtureMode: value.fixtureMode,
    fixtureScope,
    resetId,
    artifactRoot,
  };
}

export function deriveT16BOwnedTargetBinding(
  expectation: SelectionExpectation,
): T16BOwnedTargetBinding {
  return {
    deviceId: expectation.targetId,
    targetId: expectation.targetId,
    platform: expectation.platform,
    selector: expectation.selector,
    appIdOrOrigin: expectation.appIdOrOrigin,
    apiOrigin: expectation.apiOrigin,
    buildId: expectation.buildId,
    binarySha256: expectation.binarySha256,
  };
}

function selectionReaders(observer: T16BFreshSelectionObserver): T16BSelectionReaders {
  return {
    readTarget: (signal) => observer.readTarget(signal),
    readBuild: (signal) => observer.readBuild(signal),
    readTool: (signal) => observer.readTool(signal),
    readLocale: (signal) => observer.readLocale(signal),
    readRoles: (signal) => observer.readRoles(signal),
    readFixture: (signal) => observer.readFixture(signal),
    readReset: (signal) => observer.readReset(signal),
    readAuthApi: (signal) => observer.readAuthApi(signal),
    readSql: (signal) => observer.readSql(signal),
    readOwnership: (signal) => observer.readOwnership(signal),
    readPostActionEvidence: (input) => observer.readPostActionEvidence(input),
  };
}

async function readIdentityBounded(
  observer: T16BFreshSelectionObserver,
  signal: AbortSignal | undefined,
  deadlineMs: number,
): Promise<T16BSelectionIdentityObservation> {
  assert(
    Number.isSafeInteger(deadlineMs) && deadlineMs > 0 && deadlineMs <= 60_000,
    'selection identity deadline is invalid',
  );
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) onAbort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new Error('selection identity deadline reached'));
      reject(new Error('selection identity deadline reached'));
    }, deadlineMs);
  });
  try {
    const operation = Promise.resolve().then(() =>
      observer.readSelectionIdentity(controller.signal),
    );
    operation.catch(() => undefined);
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Production composition seam. The observer supplies current owned metadata
 * and the ten protected evidence readers; the existing caller then performs
 * all validation, MCP ownership, action budgeting and cleanup.
 */
export async function runOwnedT16BFromFreshMaestroObservations(
  input: T16BOwnedRuntimeBootstrapInput,
): Promise<T16BOwnedRuntimeResult> {
  requireObserver(input.observer);
  input.signal?.throwIfAborted();
  const identity = await readIdentityBounded(
    input.observer,
    input.signal,
    input.protocolDeadlineMs ?? 60_000,
  );
  const expectation = deriveT16BSelectionExpectation(identity);
  const target = deriveT16BOwnedTargetBinding(expectation);
  return runOwnedT16BMaestroExploration({
    ...input,
    expectation,
    target,
    selection: selectionReaders(input.observer),
  });
}

/** The bootstrap intentionally has no native/public qualification claim. */
export const T16B_BOOTSTRAP_QUALIFICATION = 'pending' as const;
