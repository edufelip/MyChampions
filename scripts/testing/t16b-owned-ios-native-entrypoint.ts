import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type IosConnectionRuntimeContext,
  type OwnedIosNativeSessionOptions,
} from './capture-native-testability';
import { selectNativePilotScenario } from './native-pilot-contract';
import { readNativeEvidenceObservation } from './native-view-evidence';
import { runIosConnectionAttempt } from './run-ios-connection-attempt';
import {
  selectionBindingHash,
  type OriginalEvidence,
  type SelectionExpectation,
  type T16BSelectionReaders,
} from './t16b-owned-exploration-controller';
import {
  deriveT16BSelectionExpectation,
  runOwnedT16BFromFreshMaestroObservations,
  type T16BSelectionIdentityObservation,
  type T16BFreshSelectionObserver,
  type T16BOwnedRuntimeBootstrapInput,
} from './t16b-owned-maestro-bootstrap';
import type { T16BOwnedRuntimeResult } from './t16b-owned-maestro-runtime';

/**
 * The existing connection-attempt owner owns the simulator, Expo, API session,
 * seven-purpose journey and independent cleanup. This entrypoint attaches
 * T16-B after that real journey; it does not accept a caller-created observer
 * or a caller-created selection identity.
 */
export const T16B_IOS_NATIVE_ENTRYPOINT_SCHEMA = 't16-b-owned-ios-native-session-entrypoint-v2';
export const T16B_QA_EXPLORE_ROUTE = 'qa:explore' as const;
export const T16B_SUPPORTED_CHARTER_ID = 'EXP-TWO-ROLE-CONSISTENCY' as const;

type Report = Record<string, unknown>;

export type T16BOwnedIosNativeEntrypointInput = Omit<T16BOwnedRuntimeBootstrapInput, 'observer'> &
  Pick<
    OwnedIosNativeSessionOptions,
    | 'requestedRunId'
    | 'callerOutputRoot'
    | 'deadlineAtMonotonicMs'
    | 'coldReset'
    | 'bootstatusDeadlineMs'
    | 'deadlines'
    | 'reuseBuildRunId'
    | 'reuseBuildSourceRoot'
    | 'locale'
  > & {
    /** Publishes the live context to the T16 cleanup owner before MCP starts. */
    readonly onT16Context?: (context: IosConnectionRuntimeContext) => void;
  };

export type T16BOwnedIosNativeEntrypointResult = {
  readonly schema: typeof T16B_IOS_NATIVE_ENTRYPOINT_SCHEMA;
  readonly connection: Awaited<ReturnType<typeof runIosConnectionAttempt>>;
  readonly exploration: T16BOwnedRuntimeResult | null;
};

const SHA256 = /^[a-f0-9]{64}$/;
const LOCALES = ['en-US', 'pt-BR', 'es-ES'] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function record(value: unknown, label: string): Report {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is missing`);
  return value as Report;
}

function stringValue(value: unknown, label: string): string {
  assert(typeof value === 'string' && value.length > 0, `${label} is missing`);
  assert(!/[\u0000\r\n]/.test(value), `${label} contains a control character`);
  return value;
}

function safeId(value: unknown, label: string): string {
  const result = stringValue(value, label);
  assert(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(result), `${label} is invalid`);
  return result;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function objectField(value: Report, key: string, label: string): Report {
  return record(value[key], label);
}

async function requireEntrypointRepositoryRoot(value: string): Promise<string> {
  assert(typeof value === 'string' && path.isAbsolute(value), 'Owned repository root is invalid');
  const repositoryRoot = path.resolve(value);
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const [canonicalRepositoryRoot, canonicalModuleRoot] = await Promise.all([
    realpath(repositoryRoot),
    realpath(moduleRoot),
  ]);
  assert(
    canonicalRepositoryRoot === repositoryRoot && canonicalModuleRoot === moduleRoot,
    'Owned repository root is not canonical',
  );
  assert(
    canonicalRepositoryRoot === canonicalModuleRoot,
    'Owned repository root differs from the entrypoint source checkout',
  );
  return canonicalRepositoryRoot;
}

function actualLocale(report: Report): (typeof LOCALES)[number] {
  const binding = report.localeBinding;
  const bindingLocale =
    binding &&
    typeof binding === 'object' &&
    !Array.isArray(binding) &&
    Object.prototype.hasOwnProperty.call(binding, 'effectiveLocale')
      ? (binding as Report).effectiveLocale
      : undefined;
  const value = report.observedOsLocale ?? bindingLocale;
  assert(
    LOCALES.includes(value as (typeof LOCALES)[number]),
    'Owned connection locale was not observed',
  );
  return value as (typeof LOCALES)[number];
}

function processIdentity(
  report: Report,
  apiPid: number,
): {
  pid: number;
  observedAtMonotonicMs: number;
  processStarted: string;
  startSha256: string;
} {
  const backend = objectField(report, 'backend', 'Owned backend report');
  const processes = backend.processes;
  assert(Array.isArray(processes), 'Owned backend process receipt is missing');
  const processRows = processes as readonly unknown[];
  const row = processRows.find(
    (candidate) =>
      candidate && typeof candidate === 'object' && (candidate as Report).pid === apiPid,
  );
  assert(row && typeof row === 'object', 'Owned API process is absent from the backend receipt');
  const processRow = row as Report;
  const started = stringValue(processRow.started, 'Owned API process start');
  const script = stringValue(processRow.script, 'Owned API process script');
  return {
    pid: apiPid,
    observedAtMonotonicMs: performance.now(),
    processStarted: started,
    startSha256: hash({ pid: apiPid, started, script }),
  };
}

function requireColdResetId(report: Report): string {
  const reset = report.coldResetEvidence;
  const receipt = record(reset, 'Owned cold reset evidence');
  const receiptPath = stringValue(receipt.path, 'Owned cold reset receipt path');
  const normalizedPath = path.posix.normalize(receiptPath);
  assert(
    !path.isAbsolute(receiptPath) &&
      normalizedPath === receiptPath &&
      !receiptPath.split('/').includes('..'),
    'Owned cold reset receipt path is not a safe relative receipt path',
  );
  const receiptHash = stringValue(receipt.sha256, 'Owned cold reset receipt hash');
  assert(SHA256.test(receiptHash), 'Owned cold reset receipt hash is invalid');
  const receiptPathHash = createHash('sha256').update(receiptPath).digest('hex');
  return `reset-${receiptPathHash}-${receiptHash.slice(0, 24)}`;
}

function captureIdentity(
  context: IosConnectionRuntimeContext,
  repositoryRoot: string,
  requestedRunId?: string,
): {
  identity: T16BSelectionIdentityObservation;
  report: Report;
  locale: (typeof LOCALES)[number];
} {
  const report = context.report;
  const captureRunId = safeId(report.captureRunId, 'Owned capture run id');
  const logicalRunId = safeId(requestedRunId ?? captureRunId, 'Owned requested run id');
  const backend = objectField(report, 'backend', 'Owned backend report');
  const build = objectField(report, 'build', 'Owned build report');
  const device = objectField(report, 'device', 'Owned device report');
  const apiPid = context.apiIdentity.apiPid;
  assert(Number.isSafeInteger(apiPid) && apiPid > 0, 'Owned API pid is invalid');
  const targetId = safeId(device.udid, 'Owned device UDID');
  const binarySha256 = stringValue(build.binaryHash, 'Owned binary hash');
  assert(SHA256.test(binarySha256), 'Owned binary hash is invalid');
  const bundleId = safeId(build.bundleId, 'Owned app bundle id');
  const locale = actualLocale(report);
  const fixtureIds = ['student', 'coach'] as const;
  const roleIds = fixtureIds.map((role) =>
    safeId(context.fixtures.accounts[role].authUid, `Owned ${role} auth UID`),
  );
  const fixtureMode = 'integration' as const;
  const fixtureScope = safeId(context.fixtures.scope, 'Owned fixture scope');
  const fixtureId = safeId(context.fixtures.runId, 'Owned fixture run id');
  const resetId = requireColdResetId(report);
  const artifactRoot = path.relative(repositoryRoot, context.output);
  assert(
    artifactRoot.startsWith('.qa/artifacts/') && !path.isAbsolute(artifactRoot),
    'Owned capture artifact root is outside the repository artifact boundary',
  );
  const selectionReceiptId = `${logicalRunId}:selection`;
  const observerStartedAtMonotonicMs = performance.now();
  assert(typeof process.getuid === 'function', 'Owned observer uid is unavailable');
  const identity: T16BSelectionIdentityObservation = {
    runId: logicalRunId,
    attemptId: `${logicalRunId}:first`,
    platform: 'ios',
    locale,
    deviceId: targetId,
    targetId,
    selector: targetId,
    appIdOrOrigin: bundleId,
    apiOrigin: stringValue(context.apiIdentity.targetOrigin, 'Owned API origin'),
    buildId: binarySha256,
    binarySha256,
    connector: {
      kind: 'maestro',
      id: 'maestro-mcp-2.6.1',
      name: 'maestro',
      version: stringValue(
        objectField(report, 'toolVersions', 'Owned tool versions').maestro,
        'Maestro version',
      ),
    },
    roleIds,
    fixtureId,
    fixtureMode,
    fixtureScope,
    resetId,
    artifactRoot,
    observerPid: process.pid,
    observerUid: process.getuid(),
    observerStartedAtMonotonicMs,
    selectionReceiptId,
  };
  assert(identity.connector.version === '2.6.1', 'Owned capture did not observe Maestro 2.6.1');
  assert(backend.runId === context.fixtures.runId, 'Owned backend and fixture runs differ');
  return { identity, report, locale };
}

function safeProxyObservation(value: unknown, label: string): Report {
  const row = record(value, label);
  return {
    requestId: row.requestId,
    method: row.method,
    pathHash: row.pathHash,
    requestOrigin: row.requestOrigin,
    requestProfile: row.requestProfile,
    requestCredentialPresent: row.requestCredentialPresent,
    requestCredentialClassification: row.requestCredentialClassification,
    targetOrigin: row.targetOrigin,
    status: row.status,
    outcome: row.outcome,
    faultAttemptId: row.faultAttemptId,
    elapsedMs: row.elapsedMs,
  };
}

async function ensureOwnedRoleAuthObservations(
  context: IosConnectionRuntimeContext,
  signal: AbortSignal | undefined,
): Promise<void> {
  const roleIds = new Set([
    context.fixtures.accounts.coach.authUid,
    context.fixtures.accounts.student.authUid,
  ]);
  const verified = () =>
    new Set(
      context.proxy.nativeAuthIdentities
        .filter(
          (row) =>
            row.verification === 'verified' &&
            row.status === 201 &&
            row.targetOrigin === context.apiIdentity.targetOrigin &&
            row.apiPid === context.apiIdentity.apiPid &&
            row.authUid !== null,
        )
        .map((row) => row.authUid),
    );
  const switches: string[] = [];
  let changedActor = false;
  if (!verified().has(context.fixtures.accounts.student.authUid)) {
    signal?.throwIfAborted();
    const result = await context.switchAccount('student');
    signal?.throwIfAborted();
    assert(roleIds.has(result.actorAuthUid), 'Owned student switch returned a foreign actor');
    switches.push('student');
    changedActor = true;
  }
  if (!verified().has(context.fixtures.accounts.coach.authUid) || changedActor) {
    signal?.throwIfAborted();
    const result = await context.switchAccount('coach');
    signal?.throwIfAborted();
    assert(roleIds.has(result.actorAuthUid), 'Owned coach switch returned a foreign actor');
    switches.push('coach');
  }
  const finalVerified = verified();
  assert(
    [...roleIds].every((roleId) => finalVerified.has(roleId)),
    'Owned capture could not establish verified coach and student sessions',
  );
  context.report.t16BRolePreparation = {
    requiredRoles: ['coach', 'student'],
    switches,
    verifiedRoleCount: finalVerified.size,
    restoredCoach: switches.length > 0,
  };
}

function selectionIdentityFields(
  expected: SelectionExpectation,
  provenance: Report,
  capturedAtMonotonicMs: number,
  extra: Report,
): Report {
  return {
    runId: expected.requestedRunId,
    attemptId: expected.requestedAttemptId,
    targetId: expected.targetId,
    selector: expected.selector,
    appIdOrOrigin: expected.appIdOrOrigin,
    apiOrigin: expected.apiOrigin,
    buildId: expected.buildId,
    binarySha256: expected.binarySha256,
    ...extra,
    capturedAtMonotonicMs,
    selectionProvenance: provenance,
  };
}

export function createOwnedSelectionObserver(
  context: IosConnectionRuntimeContext,
  repositoryRoot: string,
  requestedRunId?: string,
): T16BFreshSelectionObserver {
  const capture = captureIdentity(context, repositoryRoot, requestedRunId);
  const identity = capture.identity;
  const expectation = deriveT16BSelectionExpectation(identity);
  const bindingSha256 = selectionBindingHash(expectation);
  const targetProcess = processIdentity(capture.report, context.apiIdentity.apiPid);
  const evidenceCache = new Map<string, Promise<OriginalEvidence>>();
  let ordinal = 0;
  const readEvidence = (
    kind: OriginalEvidence['kind'],
    payload: Report,
    extra: Report,
    cacheKey: string = kind,
  ): Promise<OriginalEvidence> => {
    const cached = evidenceCache.get(cacheKey);
    if (cached) return cached;
    const currentOrdinal = ++ordinal;
    const capturedAtMonotonicMs = performance.now();
    const provenance = {
      selectionBindingSha256: bindingSha256,
      selectionReceiptId: identity.selectionReceiptId,
      observerPid: identity.observerPid,
      observerUid: identity.observerUid,
      observerStartedAtMonotonicMs: identity.observerStartedAtMonotonicMs,
      selectionOrdinal: currentOrdinal,
    };
    const operation = (async () => {
      const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, kind, payload }), 'utf8');
      const relative = `t16-selection-${cacheKey.replace(/[^A-Za-z0-9-]/g, '-')}.private.json`;
      await writeFile(path.join(context.output, relative), bytes, {
        flag: 'wx',
        mode: 0o600,
      });
      const observation = readNativeEvidenceObservation(context.output, relative, true);
      return {
        kind,
        runId: identity.runId,
        attemptId: identity.attemptId,
        platform: identity.platform,
        locale: identity.locale,
        path: relative,
        bytes: observation.bytes,
        capturedAtMonotonicMs,
        identity: selectionIdentityFields(expectation, provenance, capturedAtMonotonicMs, extra),
        source: {
          artifactRoot: context.output,
          path: relative,
          sha256: createHash('sha256').update(observation.bytes).digest('hex'),
          bytes: observation.bytes.length,
          uid: observation.identity.uid,
          mode: '0600' as const,
          nlink: 1 as const,
          regular: true as const,
          symlink: false as const,
        },
      } satisfies OriginalEvidence;
    })();
    evidenceCache.set(cacheKey, operation);
    return operation;
  };
  const report = capture.report;
  const backend = objectField(report, 'backend', 'Owned backend report');
  const build = objectField(report, 'build', 'Owned build report');
  const device = objectField(report, 'device', 'Owned device report');
  const toolVersions = objectField(report, 'toolVersions', 'Owned tool versions');
  const authIdentities = context.proxy.nativeAuthIdentities;
  const roleIds = identity.roleIds;
  const requireIndependentRoles = () => {
    const verifiedRows = authIdentities.filter(
      (row) =>
        row.verification === 'verified' &&
        row.status === 201 &&
        row.targetOrigin === identity.apiOrigin &&
        row.apiPid === targetProcess.pid &&
        row.authUid !== null,
    );
    const authUids = new Set(verifiedRows.map((row) => row.authUid));
    assert(
      roleIds.every((roleId) => authUids.has(roleId)),
      'Owned capture did not observe verified independent authenticated sessions for both T16 roles',
    );
    assert(
      verifiedRows.length >= roleIds.length,
      'Owned capture did not observe one verified sign-in per T16 role',
    );
  };
  const requireReadOnlyAuthApi = () => {
    const reads = context.proxy.observations.filter(
      (row) =>
        row.requestProfile === 'native' &&
        row.status >= 200 &&
        row.status < 300 &&
        row.outcome === 'forwarded' &&
        row.targetOrigin === identity.apiOrigin,
    );
    assert(reads.length > 0, 'Owned capture did not observe an owned forwarded auth/API read');
  };
  const selectionReaders: T16BSelectionReaders = {
    readTarget: async (signal) => {
      signal.throwIfAborted();
      return readEvidence(
        'target',
        { report: { device, build, backend } },
        {
          ownedTargetProcess: targetProcess,
        },
      );
    },
    readBuild: async (signal) => {
      signal.throwIfAborted();
      return readEvidence('build', { report: { build } }, { buildId: identity.buildId });
    },
    readTool: async (signal) => {
      signal.throwIfAborted();
      return readEvidence(
        'tool',
        { report: { toolVersions } },
        {
          connectorId: identity.connector.id,
          kind: 'maestro',
          name: identity.connector.name,
          version: identity.connector.version,
          targetSelectionCapability: true,
          sessionId: `${identity.runId}:maestro`,
        },
      );
    },
    readLocale: async (signal) => {
      signal.throwIfAborted();
      return readEvidence(
        'locale',
        { observedOsLocale: identity.locale },
        {
          requestedLocale: identity.locale,
          effectiveLocale: identity.locale,
          observedLocale: identity.locale,
        },
      );
    },
    readRoles: async (signal) => {
      signal.throwIfAborted();
      requireIndependentRoles();
      return readEvidence(
        'roles',
        { roleIds },
        {
          roleIds,
          sessionIds: roleIds.map((roleId) => `${identity.runId}:${roleId}`),
          independentSessions: true,
        },
      );
    },
    readFixture: async (signal) => {
      signal.throwIfAborted();
      return readEvidence(
        'fixture',
        {
          fixtureId: identity.fixtureId,
          scope: identity.fixtureScope,
          fixtureAuthUidAllowlistHash: report.fixtureAuthUidAllowlistHash,
        },
        {
          fixtureId: identity.fixtureId,
          mode: identity.fixtureMode,
          scope: identity.fixtureScope,
        },
      );
    },
    readReset: async (signal) => {
      signal.throwIfAborted();
      return readEvidence(
        'reset',
        { reset: report.coldResetEvidence },
        {
          resetId: identity.resetId,
          fresh: true,
          verified: true,
        },
      );
    },
    readAuthApi: async (signal) => {
      signal.throwIfAborted();
      requireReadOnlyAuthApi();
      return readEvidence(
        'auth-api',
        { apiOrigin: identity.apiOrigin },
        {
          apiOrigin: identity.apiOrigin,
          scope: identity.fixtureScope,
          readOnly: true,
          independent: true,
          roleIds,
        },
      );
    },
    readSql: async (signal) => {
      signal.throwIfAborted();
      const snapshot = await context.connectionSnapshot();
      assert(snapshot.readOnly === true, 'Owned SQL snapshot is not read-only');
      return readEvidence(
        'sql',
        { snapshot },
        {
          scope: identity.fixtureScope,
          readOnly: true,
          independent: true,
        },
      );
    },
    readOwnership: async (signal) => {
      signal.throwIfAborted();
      return readEvidence(
        'ownership',
        { report: { captureRunId: identity.runId, device, backend } },
        {
          artifactRoot: identity.artifactRoot,
          ownerUid: identity.observerUid,
          current: true,
          foreignResourcesPreserved: true,
          ownedTargetProcess: targetProcess,
        },
      );
    },
    readPostActionEvidence: async ({ requestId, signal }) => {
      signal.throwIfAborted();
      const numericRequestId = Number(requestId);
      assert(Number.isSafeInteger(numericRequestId), 'T16 action request id is not numeric');
      const row = context.proxy.observations.find(
        (candidate) => candidate.requestId === numericRequestId,
      );
      assert(row, 'Owned proxy has no observation for the T16 action request');
      const snapshot = await context.connectionSnapshot();
      return {
        api: await readEvidence(
          'action-api',
          { observation: safeProxyObservation(row, 'proxy observation') },
          { requestId, status: row.status },
          `action-api-${requestId}`,
        ),
        sql: await readEvidence(
          'action-sql',
          { snapshot },
          { requestId, scope: identity.fixtureScope, readOnly: true },
          `action-sql-${requestId}`,
        ),
      };
    },
  };
  return {
    readSelectionIdentity: (signal) => {
      signal.throwIfAborted();
      return Promise.resolve(identity);
    },
    ...selectionReaders,
  };
}

/**
 * Actual owner composition. The capture creates the target/build/backend/
 * fixture context; the T16 observer is constructed inside that callback and
 * the existing T16 caller owns its MCP child. Missing current receipts block
 * before MCP acquisition and remain a truthful harness result.
 */
export async function runOwnedT16BFromOwnedIosNativeSession(
  input: T16BOwnedIosNativeEntrypointInput,
): Promise<T16BOwnedIosNativeEntrypointResult> {
  const repositoryRoot = await requireEntrypointRepositoryRoot(input.repositoryRoot);
  assert(
    input.charter.id === T16B_SUPPORTED_CHARTER_ID &&
      input.charter.platforms.includes('ios') &&
      input.charter.connectorsByPlatform.ios === 'maestro',
    `T16-B ${T16B_QA_EXPLORE_ROUTE} does not support this charter/platform`,
  );
  assert(
    typeof input.requestedRunId === 'string' && /^[a-f0-9]{24}$/.test(input.requestedRunId),
    'T16-B owned entrypoint requires a requested run id',
  );
  assert(input.coldReset !== undefined, 'T16-B owned entrypoint requires a verified cold reset');
  assert(
    input.locale !== undefined && LOCALES.includes(input.locale),
    'T16-B owned entrypoint requires an explicitly observed locale request',
  );
  // This is the explicit qa:explore route's native acquisition prerequisite.
  // It is intentionally selected from the charter route here rather than from
  // the ordinary native-pilot command's default connection branch.
  const selection = await selectNativePilotScenario(
    {
      platform: 'ios',
      engine: 'maestro',
      scenario: 'SCN-connection-ios',
      mode: 'integration',
    },
    JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ),
    repositoryRoot,
  );
  let exploration: T16BOwnedRuntimeResult | null = null;
  const signal = input.signal ?? new AbortController().signal;
  const connection = await runIosConnectionAttempt({
    repositoryRoot,
    requestedRunId: input.requestedRunId,
    selection,
    signal,
    callerOutputRoot: input.callerOutputRoot,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    coldReset: input.coldReset,
    bootstatusDeadlineMs: input.bootstatusDeadlineMs,
    deadlines: input.deadlines,
    reuseBuildRunId: input.reuseBuildRunId,
    reuseBuildSourceRoot: input.reuseBuildSourceRoot,
    locale: input.locale,
    executeConnectionLocale: async ({ run, scenario }) => run(scenario),
    t16Continuation: async (context) => {
      input.onT16Context?.(context);
      await ensureOwnedRoleAuthObservations(context, signal);
      const observer = createOwnedSelectionObserver(context, repositoryRoot, input.requestedRunId);
      exploration = await runOwnedT16BFromFreshMaestroObservations({
        ...input,
        observer,
      });
      context.report.t16BExecution = {
        status: exploration.status,
        schema: exploration.schema,
        publicationEligible: false,
        runtimePassingCases: 0,
      };
    },
  });
  return {
    schema: T16B_IOS_NATIVE_ENTRYPOINT_SCHEMA,
    connection,
    exploration,
  };
}
