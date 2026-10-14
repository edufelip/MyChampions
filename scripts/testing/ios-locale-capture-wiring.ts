import { createHash } from 'node:crypto';
import {
  parseIosLocaleQuiescenceProcessCensus,
  readOwnedIosLocaleQuiescenceStdout,
} from './ios-locale-quiescence';
import { sameNativeLocaleBinding, type NativeLocaleBinding } from './locale-native-observation';
import {
  observeIosAuthMetadata,
  type NativeAuthMetadataObservation,
} from './native-auth-observation';
import {
  requireConnectionSnapshot,
  type OwnedConnectionSnapshot,
} from './native-connection-snapshot';
import { assertTestingDocument } from './schema-validation';
import type {
  IosLocaleBuildReceipt,
  IosLocaleCoachSignInReceipt,
  IosLocaleRuntimeContext,
  IosLocaleScenarioInput,
  IosLocaleScenarioResult,
} from './ios-locale-runtime-adapter';
import type { IosQuiescenceReceipt } from './ios-locale-storage';
import type { NativeAuthIdentityObservation, ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot } from './owned-session';

const IOS_BUNDLE_ID = 'com.edufelip.mychampions.dev';
const IOS_SCOPE = 'native-entry-ios';
const SIGN_IN_PATH_HASH = createHash('sha256').update('/auth/email/sign-in').digest('hex');
const HASH64 = /^[a-f0-9]{64}$/;
const CAPTURE_ID = /^[a-f0-9]{24}$/;
const ORIGIN = /^https?:\/\/127\.0\.0\.1:\d+$/;

type OwnedAccount = {
  email: string;
  password: string;
  authUid: string;
  role: string | null;
};

type LocaleFixtureAccounts = {
  coach: OwnedAccount;
  student: OwnedAccount;
};

/**
 * Exact producer surface the iOS capture must supply before the locale adapter
 * can run. The proxy/session callbacks are live getters so observations added
 * by the Maestro flow cannot be replaced by a setup snapshot.
 */
export type IosLocaleCaptureWiringInput = {
  artifactRoot: string;
  sourceRoot: string;
  cwd: string;
  output: string;
  captureRunId: string;
  binding: NativeLocaleBinding;
  device: { udid: string; runtime: string };
  metroPort: number;
  build: IosLocaleBuildReceipt;
  signal: AbortSignal;
  effectiveCommandDeadline: (requestedMs: number) => number;
  verifyTarget: (signal?: AbortSignal) => Promise<void>;
  beforeCommand?: IosLocaleRuntimeContext['beforeCommand'];
  afterCommand?: IosLocaleRuntimeContext['afterCommand'];
  env?: NodeJS.ProcessEnv;
  fixtures: {
    runId: string;
    scope: string;
    accounts: LocaleFixtureAccounts;
    fixtureAuthUids: readonly string[];
  };
  backend: {
    runId: string;
    apiPid: number;
    apiOrigin: string;
    readProfileSnapshot: (signal?: AbortSignal) => Promise<unknown>;
    readDomainSnapshot: (signal?: AbortSignal) => Promise<unknown>;
  };
  proxy: {
    requestIdFence: () => number;
    observations: () => readonly ProxyObservation[];
    nativeAuthIdentities: () => readonly NativeAuthIdentityObservation[];
  };
  probeQuiescence: IosLocaleRuntimeContext['probeQuiescence'];
  cleanupOwned?: IosLocaleRuntimeContext['cleanupOwned'];
  cleanupOwner?: 'scenario' | 'outer-capture';
  cleanupDeadlineMs?: number;
};

export type IosLocaleCaptureWiring = {
  context: IosLocaleRuntimeContext;
  run: (scenario: IosLocaleScenarioInput) => Promise<IosLocaleScenarioResult>;
  signInBoundary: {
    beforeRequestId: number;
    expectedAuthUid: string;
    expectedApiPid: number;
    expectedApiOrigin: string;
  };
};

function fail(message: string): never {
  throw new Error(`Invalid iOS locale capture wiring: ${message}`);
}

function requireFunction(value: unknown, label: string): void {
  if (typeof value !== 'function') fail(`${label} callback is unavailable`);
}

function requireHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH64.test(value)) fail(`${label} is not a SHA-256`);
  return value;
}

function requireCaptureId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !CAPTURE_ID.test(value))
    fail(`${label} is not an owned capture id`);
  return value;
}

function requireOrigin(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ORIGIN.test(value))
    fail(`${label} is not an owned loopback API origin`);
  return value;
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function hashJson(value: unknown): string {
  return hash(JSON.stringify(value));
}

function sortedUnique(values: readonly string[], label: string): string[] {
  if (
    values.length < 2 ||
    values.some((value) => typeof value !== 'string' || value.length === 0) ||
    new Set(values).size !== values.length
  )
    fail(`${label} must contain unique fixture identities`);
  return [...values].sort();
}

function requireFixtureAccounts(input: IosLocaleCaptureWiringInput): string[] {
  const fixtureAuthUids = sortedUnique(input.fixtures.fixtureAuthUids, 'fixtureAuthUids');
  const { coach, student } = input.fixtures.accounts;
  if (
    coach.role !== 'professional' ||
    student.role !== 'student' ||
    typeof coach.email !== 'string' ||
    coach.email.length === 0 ||
    typeof coach.password !== 'string' ||
    coach.password.length === 0 ||
    typeof student.email !== 'string' ||
    student.email.length === 0 ||
    typeof student.password !== 'string' ||
    student.password.length === 0 ||
    typeof coach.authUid !== 'string' ||
    typeof student.authUid !== 'string' ||
    coach.authUid === student.authUid ||
    !fixtureAuthUids.includes(coach.authUid) ||
    !fixtureAuthUids.includes(student.authUid)
  )
    fail('coach/student fixture roles or identities are not bound to the allowlist');
  if (input.fixtures.scope !== IOS_SCOPE || input.backend.runId !== input.fixtures.runId)
    fail('fixture scope/run identity is not the owned iOS entry scope');
  return fixtureAuthUids;
}

function requireBackendIdentity(input: IosLocaleCaptureWiringInput): void {
  requireCaptureId(input.captureRunId, 'captureRunId');
  requireCaptureId(input.backend.runId, 'backend.runId');
  if (!Number.isSafeInteger(input.backend.apiPid) || input.backend.apiPid <= 1)
    fail('backend API PID is invalid');
  requireOrigin(input.backend.apiOrigin, 'backend.apiOrigin');
  requireOrigin(input.build.apiOrigin, 'build.apiOrigin');
  requireOrigin(input.build.backendApiOrigin, 'build.backendApiOrigin');
  if (
    input.binding.captureRunId !== input.captureRunId ||
    input.binding.target.platform !== 'ios' ||
    input.binding.target.appId !== IOS_BUNDLE_ID ||
    input.binding.target.apiOrigin !== input.build.apiOrigin ||
    input.build.bundleId !== IOS_BUNDLE_ID ||
    input.build.backendApiOrigin !== input.backend.apiOrigin ||
    input.build.apiOrigin === input.backend.apiOrigin ||
    input.build.binaryHash !== input.binding.target.binaryHash ||
    input.build.sourceTreeHash !== input.binding.sourceTreeHash ||
    input.build.helperInputsHash !== input.binding.helperInputsHash
  )
    fail('capture/build/backend locale identities do not match');
  requireHash(input.binding.sourceTreeHash, 'binding.sourceTreeHash');
  requireHash(input.binding.helperInputsHash, 'binding.helperInputsHash');
  requireHash(input.binding.target.binaryHash, 'binding.target.binaryHash');
}

function requireProfileSnapshot(
  value: unknown,
  input: IosLocaleCaptureWiringInput,
  fixtureAuthUids: readonly string[],
): OwnedConnectionSnapshot {
  const snapshot = requireConnectionSnapshot(value, {
    runId: input.backend.runId,
    scope: IOS_SCOPE,
    fixtureAuthUids,
    target: {
      professionalAuthUid: input.fixtures.accounts.coach.authUid,
      studentAuthUid: input.fixtures.accounts.student.authUid,
      specialty: 'fitness_coach',
    },
  });
  const coach = snapshot.rows.userProfiles.find(
    (row) => row.authUid === input.fixtures.accounts.coach.authUid,
  );
  if (!coach || coach.lockedRole !== 'professional' || coach.acceptedTermsVersion !== 'v1')
    fail('profile checkpoint lacks the owned coach role/terms contract');
  return snapshot;
}

function requireDomainSnapshot(
  value: unknown,
  input: IosLocaleCaptureWiringInput,
): OwnedDomainSnapshot {
  assertTestingDocument('domain-snapshot-v1', value);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('domain snapshot is malformed');
  const snapshot = value as OwnedDomainSnapshot;
  if (
    snapshot.runId !== input.backend.runId ||
    snapshot.scope !== IOS_SCOPE ||
    snapshot.readOnly !== true
  )
    fail('domain checkpoint is not bound to the owned iOS scope');
  return snapshot;
}

function requireAuthMetadata(
  value: NativeAuthMetadataObservation,
  input: IosLocaleCaptureWiringInput,
): Extract<NativeAuthMetadataObservation, { status: 'session-present' }> {
  if (
    value.status !== 'session-present' ||
    value.sessionPresent !== true ||
    value.profilePresent !== true ||
    value.profileAuthUidHash !== hash(input.fixtures.accounts.coach.authUid)
  )
    fail('native auth metadata is not the bound coach session');
  return value;
}

function requireBoundaryRequest(
  input: IosLocaleCaptureWiringInput,
  beforeRequestId: number,
): ProxyObservation {
  const rows = input.proxy
    .observations()
    .filter(
      (row) =>
        row.requestId > beforeRequestId &&
        row.method === 'POST' &&
        row.pathHash === SIGN_IN_PATH_HASH &&
        row.status === 201 &&
        row.outcome === 'forwarded' &&
        row.requestProfile === 'native' &&
        row.requestOrigin === null &&
        row.targetOrigin === input.backend.apiOrigin &&
        row.faultAttemptId === null,
    );
  if (rows.length !== 1) fail('locale coach authentication does not have one new owned 201');
  return rows[0];
}

function requireNativeCoachIdentity(
  input: IosLocaleCaptureWiringInput,
  requestId: number,
  fixtureAuthUids: readonly string[],
): NativeAuthIdentityObservation {
  const allowlistHash = hash(JSON.stringify([...fixtureAuthUids].sort()));
  const rows = input.proxy.nativeAuthIdentities().filter((row) => row.requestId === requestId);
  if (rows.length !== 1) fail('locale coach authentication identity is not unique');
  const row = rows[0];
  if (
    row.status !== 201 ||
    row.verification !== 'verified' ||
    row.verificationReason !== 'verified' ||
    row.authUid !== input.fixtures.accounts.coach.authUid ||
    row.apiPid !== input.backend.apiPid ||
    row.targetOrigin !== input.backend.apiOrigin ||
    row.fixtureAuthUidAllowlistHash !== allowlistHash
  )
    fail('locale coach authentication principal is not bound to the owned API');
  return row;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasBlockedStep(value: unknown): boolean {
  return Array.isArray(value) && value.some((step) => isRecord(step) && step.status === 'blocked');
}

/**
 * Keep callback results fail-closed at the capture boundary. A callback is an
 * integration hook, so its return value is untrusted until it is bound to the
 * requested scenario and still carries the Pending-only contract.
 */
export function validateIosLocaleScenarioResult(
  value: unknown,
  scenario: IosLocaleScenarioInput,
): IosLocaleScenarioResult {
  if (!isRecord(value)) fail('locale callback result must be an object');
  const result = value as Partial<IosLocaleScenarioResult>;
  const expectedBaseline =
    scenario.baselineOsLocale ?? (scenario.requestedLocale === 'en-US' ? 'pt-BR' : 'en-US');
  if (
    result.kind !== 'private-ios-locale-runtime-scenario-result-not-runtime-proof' ||
    result.schemaVersion !== 3 ||
    result.scenarioId !== scenario.scenarioId ||
    result.requestedLocale !== scenario.requestedLocale ||
    result.baselineOsLocale !== expectedBaseline ||
    result.cleanupOwner !== 'outer-capture' ||
    result.runtimeQualification !== 'pending' ||
    result.nativePassingCases !== 0 ||
    result.publicLocale !== null ||
    (result.status !== 'blocked' && result.status !== 'observed') ||
    !Array.isArray(result.steps) ||
    !Array.isArray(result.checkpoints) ||
    !Array.isArray(result.phaseReceipts) ||
    !Array.isArray(result.commandReceipts) ||
    !Array.isArray(result.blockers) ||
    result.blockers.some((blocker) => typeof blocker !== 'string') ||
    typeof result.cleanupAttempted !== 'boolean' ||
    typeof result.cleanupObserved !== 'boolean'
  )
    fail('locale callback result is malformed or not Pending-bound');
  try {
    if (
      !result.expectedBinding ||
      !sameNativeLocaleBinding(result.expectedBinding, scenario.expectedBinding)
    )
      fail('locale callback result binding differs from the requested capture');
  } catch {
    fail('locale callback result binding is malformed');
  }
  if (result.status === 'blocked' && result.blockers.length === 0 && !hasBlockedStep(result.steps))
    fail('blocked locale callback result has no blocker evidence');
  if (
    result.cleanupOwner === 'outer-capture' &&
    (result.cleanupAttempted !== false ||
      result.cleanupObserved !== false ||
      result.cleanupReceipt !== null ||
      result.cleanupError !== null)
  )
    fail('outer-capture locale callback result carries scenario cleanup state');
  if (
    result.status === 'observed' &&
    (result.steps.length === 0 ||
      result.checkpoints.length === 0 ||
      result.phaseReceipts.length === 0 ||
      result.commandReceipts.length === 0 ||
      result.blockers.length !== 0 ||
      hasBlockedStep(result.steps) ||
      result.cleanupAttempted !== false ||
      result.cleanupObserved !== false ||
      result.cleanupReceipt !== null ||
      result.cleanupError !== null)
  )
    fail('observed locale callback result is incomplete or blocked');
  return result as IosLocaleScenarioResult;
}

function buildCoachSignInReceipt(
  input: IosLocaleCaptureWiringInput,
  beforeRequestId: number,
  fixtureAuthUids: readonly string[],
  authMetadata: Extract<NativeAuthMetadataObservation, { status: 'session-present' }>,
  profile: OwnedConnectionSnapshot,
  homeHierarchy: Parameters<
    NonNullable<IosLocaleRuntimeContext['readCoachSignInReceipt']>
  >[0]['homeHierarchy'],
): IosLocaleCoachSignInReceipt {
  const signIn = requireBoundaryRequest(input, beforeRequestId);
  requireNativeCoachIdentity(input, signIn.requestId, fixtureAuthUids);
  const coachHash = hash(input.fixtures.accounts.coach.authUid);
  return {
    status: 'observed',
    role: 'coach',
    fixtureRole: 'professional',
    fixtureAuthUid: input.fixtures.accounts.coach.authUid,
    sessionRunId: input.backend.runId,
    signInRequestId: signIn.requestId,
    signInStatus: 201,
    signInPathHash: SIGN_IN_PATH_HASH,
    apiPid: input.backend.apiPid,
    apiOrigin: input.backend.apiOrigin,
    sessionPresent: authMetadata.sessionPresent,
    termsAccepted: true,
    acceptedTermsVersion: 'v1',
    sessionEvidence: {
      source: 'ios-auth-storage',
      status: 'session-present',
      profilePresent: true,
      profileAuthUidHash: coachHash,
      observationHash: hashJson(authMetadata),
    },
    termsEvidence: {
      source: 'owned-sql-profile-snapshot',
      acceptedTermsVersion: 'v1',
      lockedRole: 'professional',
      authUidHash: coachHash,
      snapshotHash: hashJson(profile),
      runId: input.backend.runId,
      scope: IOS_SCOPE,
    },
    homeSelector: 'pro.home.screen',
    homeHierarchy: {
      label: homeHierarchy.label,
      hierarchyPath: homeHierarchy.hierarchyPath,
      hierarchyHash: homeHierarchy.hierarchyHash,
      captureRunId: homeHierarchy.captureRunId,
      binding: homeHierarchy.binding,
      observedAt: homeHierarchy.observedAt,
      selector: 'pro.home.screen',
    },
    observedAt: new Date().toISOString(),
  };
}

/**
 * Builds the locale adapter context from the capture's owned readers. The
 * caller still owns target acquisition, command execution and final cleanup;
 * this bridge only adds strict auth/profile/terms/domain binding and never
 * fabricates an observation when a reader is absent or fails.
 */
export function createIosLocaleCaptureWiring(
  input: IosLocaleCaptureWiringInput,
): IosLocaleCaptureWiring {
  const fixtureAuthUids = requireFixtureAccounts(input);
  requireBackendIdentity(input);
  if (!(input.signal instanceof AbortSignal)) fail('caller-owned AbortSignal is required');
  requireFunction(input.effectiveCommandDeadline, 'effectiveCommandDeadline');
  requireFunction(input.verifyTarget, 'verifyTarget');
  requireFunction(input.backend.readProfileSnapshot, 'readProfileSnapshot');
  requireFunction(input.backend.readDomainSnapshot, 'readDomainSnapshot');
  requireFunction(input.proxy.requestIdFence, 'requestIdFence');
  requireFunction(input.proxy.observations, 'observations');
  requireFunction(input.proxy.nativeAuthIdentities, 'nativeAuthIdentities');
  requireFunction(input.probeQuiescence, 'probeQuiescence');
  if ((input.cleanupOwner ?? 'scenario') === 'scenario')
    requireFunction(input.cleanupOwned, 'cleanupOwned');
  if (input.build.reusedFrom !== null && !CAPTURE_ID.test(input.build.reusedFrom))
    fail('build reuse identity is invalid');
  const beforeRequestId = input.proxy.requestIdFence();
  if (!Number.isSafeInteger(beforeRequestId) || beforeRequestId < 0)
    fail('locale sign-in boundary fence is invalid');
  const context: IosLocaleRuntimeContext = {
    artifactRoot: input.artifactRoot,
    sourceRoot: input.sourceRoot,
    cwd: input.cwd,
    output: input.output,
    captureRunId: input.captureRunId,
    binding: input.binding,
    device: input.device,
    bundleId: IOS_BUNDLE_ID,
    metroPort: input.metroPort,
    apiPid: input.backend.apiPid,
    effectiveCommandDeadline: input.effectiveCommandDeadline,
    env: input.env,
    signal: input.signal,
    beforeCommand: input.beforeCommand,
    afterCommand: input.afterCommand,
    verifyTarget: input.verifyTarget,
    build: input.build,
    fixtures: { accounts: { coach: input.fixtures.accounts.coach } },
    sessionRunId: input.backend.runId,
    readAppAuthMetadata: async (dataRoot, signal) =>
      requireAuthMetadata(await observeIosAuthMetadata(dataRoot, IOS_BUNDLE_ID, signal), input),
    readAuthProfileSnapshot: async (signal) =>
      requireProfileSnapshot(
        await input.backend.readProfileSnapshot(signal),
        input,
        fixtureAuthUids,
      ),
    readCoachSignInReceipt: ({ appAuthMetadata, authProfileSnapshot, homeHierarchy, signal }) => {
      signal?.throwIfAborted();
      return Promise.resolve().then(() => {
        signal?.throwIfAborted();
        const receipt = buildCoachSignInReceipt(
          input,
          beforeRequestId,
          fixtureAuthUids,
          requireAuthMetadata(appAuthMetadata as NativeAuthMetadataObservation, input),
          requireProfileSnapshot(authProfileSnapshot, input, fixtureAuthUids),
          homeHierarchy,
        );
        signal?.throwIfAborted();
        return receipt;
      });
    },
    probeQuiescence: input.probeQuiescence,
    readDomainSnapshot: async (signal) =>
      requireDomainSnapshot(await input.backend.readDomainSnapshot(signal), input),
    ...(input.cleanupOwned ? { cleanupOwned: input.cleanupOwned } : {}),
    cleanupOwner: input.cleanupOwner ?? 'scenario',
    cleanupDeadlineMs: input.cleanupDeadlineMs,
  };
  return {
    context,
    signInBoundary: {
      beforeRequestId,
      expectedAuthUid: input.fixtures.accounts.coach.authUid,
      expectedApiPid: input.backend.apiPid,
      expectedApiOrigin: input.backend.apiOrigin,
    },
    run: async (scenario) => {
      // The runtime adapter imports pure action builders from the capture
      // module. Resolve it only after the capture module is initialized so
      // this bridge cannot create an ESM initialization cycle.
      const runtime = await import('./ios-locale-runtime-adapter');
      return runtime.runIosLocaleScenario(scenario, runtime.createIosLocaleOwnedTransport(context));
    },
  };
}

/**
 * Execute one locale callback against the live wiring while the outer capture
 * retains cleanup ownership. The binding is independently recomputed before
 * and after the callback so source/helper/build drift cannot be relabeled as
 * a locale observation. Callback failures propagate to the outer capture.
 */
export async function runIosLocaleCaptureCallback(input: {
  wiring: IosLocaleCaptureWiring;
  scenario: IosLocaleScenarioInput;
  signal: AbortSignal;
  readCurrentBinding: () => Promise<NativeLocaleBinding>;
  execute?: (input: {
    context: IosLocaleRuntimeContext;
    run: IosLocaleCaptureWiring['run'];
    scenario: IosLocaleScenarioInput;
  }) => Promise<IosLocaleScenarioResult>;
}): Promise<IosLocaleScenarioResult> {
  input.signal.throwIfAborted();
  const before = await input.readCurrentBinding();
  if (!sameNativeLocaleBinding(before, input.scenario.expectedBinding))
    fail('locale source/helper/build binding changed before callback');
  const result = await (input.execute
    ? input.execute({
        context: input.wiring.context,
        run: input.wiring.run,
        scenario: input.scenario,
      })
    : input.wiring.run(input.scenario));
  input.signal.throwIfAborted();
  const after = await input.readCurrentBinding();
  if (!sameNativeLocaleBinding(after, input.scenario.expectedBinding))
    fail('locale source/helper/build binding changed after callback');
  return validateIosLocaleScenarioResult(result, input.scenario);
}

type QuiescenceCommand = {
  execution: string;
  cleanup: string;
  attempted: boolean;
  pid: number | null;
  pgid: number | null;
  logPath: string;
  stdoutPath: string;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  label: string;
  bindingCaptureRunId: string;
};

/**
 * Converts one already-owned `ps` command receipt into the canonical
 * quiescence receipt. The command runner is supplied by the capture so this
 * helper never spawns a process by itself; empty stdout is a valid census.
 */
export function createIosLocaleQuiescenceProbe(input: {
  artifactRoot: string;
  captureRunId: string;
  deviceId: string;
  bundleId: string;
  bindingCaptureRunId: string;
  runProcessCensus: (signal?: AbortSignal) => Promise<QuiescenceCommand>;
}): (signal?: AbortSignal) => Promise<IosQuiescenceReceipt> {
  requireCaptureId(input.captureRunId, 'captureRunId');
  if (input.bindingCaptureRunId !== input.captureRunId)
    fail('quiescence binding differs from capture');
  if (!input.deviceId || input.bundleId !== IOS_BUNDLE_ID)
    fail('quiescence target is not iOS dev app');
  return async (signal) => {
    signal?.throwIfAborted();
    const command = await input.runProcessCensus(signal);
    const pid = command.pid;
    const pgid = command.pgid;
    const logPath = command.logPath;
    const stdoutPath = command.stdoutPath;
    if (
      command.bindingCaptureRunId !== input.captureRunId ||
      command.execution !== 'completed' ||
      command.cleanup !== 'cleaned' ||
      command.childExitCode !== 0 ||
      command.childSignal !== null ||
      command.attempted !== true ||
      typeof pid !== 'number' ||
      !Number.isSafeInteger(pid) ||
      pid <= 1 ||
      typeof pgid !== 'number' ||
      !Number.isSafeInteger(pgid) ||
      pgid <= 1 ||
      logPath.length === 0 ||
      stdoutPath.length === 0
    )
      fail('quiescence command is not an owned completed command');
    const stdout = await readOwnedIosLocaleQuiescenceStdout(input.artifactRoot, stdoutPath, signal);
    const processes = parseIosLocaleQuiescenceProcessCensus(stdout.bytes, input.bundleId);
    if (processes.length > 0) fail('quiescence census still contains the owned app process');
    return {
      status: 'terminated',
      captureRunId: input.captureRunId,
      deviceId: input.deviceId,
      bundleId: IOS_BUNDLE_ID,
      appRunning: false as const,
      observedAt: new Date().toISOString(),
      probe: {
        status: 'observed',
        captureRunId: input.captureRunId,
        deviceId: input.deviceId,
        bundleId: IOS_BUNDLE_ID,
        command: {
          label: command.label,
          execution: command.execution,
          cleanup: command.cleanup,
          pid,
          pgid,
          logPath,
          stdoutPath,
          stdoutBytes: stdout.size,
          stdoutSha256: stdout.sha256,
          bindingCaptureRunId: command.bindingCaptureRunId,
        },
        processes,
        observedAt: new Date().toISOString(),
      },
    };
  };
}
