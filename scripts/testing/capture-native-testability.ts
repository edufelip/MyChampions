import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  chmod,
  copyFile,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import {
  collectIosCredentialEntryOwnedDiagnostic,
  bindIosCredentialEntryOwnedLedger,
  invalidateIosCredentialEntryOwnedSidecar,
  requireIosCredentialEntryFreshness,
  runIosCredentialEntryOwnedWiring,
  requireIosCredentialInteractionDiagnosticPreflight,
  type IosCredentialEntryOwnedBinding,
  type IosCredentialEntryOwnedStageInput,
} from './ios-credential-entry-owned-seam';
import {
  createIosLocaleCaptureWiring,
  createIosLocaleQuiescenceProbe,
  runIosLocaleCaptureCallback,
  validateIosLocaleScenarioResult,
  type IosLocaleCaptureWiringInput,
} from './ios-locale-capture-wiring';
import {
  observeIosSessionPostTapDiagnostic,
  observeIosSessionSignOutWithDiagnostic,
} from './ios-session-post-tap-diagnostic';
import { sameNativeLocaleBinding, type NativeLocaleBinding } from './locale-native-observation';
import {
  observeIosAuthMetadata,
  requireRetainedNativeSessionIdentity,
} from './native-auth-observation';
import { sourceIdentity, treeHash } from './native-build-identity';
import { loadReusableIosBuild } from './native-build-reuse';
import {
  captureIosCameraPreludeBoundary,
  observeIosCameraDenial,
  readOwnedIosCameraPermission,
  type IosCameraCommandExecution,
  type IosCameraPermissionObservation,
} from './native-camera-observation';
import { observeNativeConnectionStates } from './native-connection-observation';
import {
  buildIosConnectionPasswordOfferActions,
  nativeConnectionPasswordOfferCommandMetadataPath,
  nativeConnectionPasswordOfferPromptScreenshotPath,
  requireNativeConnectionPasswordOfferWitness,
} from './native-connection-password-offer-witness';
import { nativeHierarchyHasAttribute, parseNativeHierarchy } from './native-hierarchy';
import {
  requireNativeHostAvailability,
  requireNativeHostAvailabilityAtStep,
} from './native-host-contention';
import {
  buildIosIncrementalBuildBinding,
  buildIosXcodebuildArguments,
  hashOwnedFile,
  loadIosIncrementalBuildCachePredecessor,
  prepareIosIncrementalBuildCache,
  resolveIosIncrementalBuildToolchain,
  writeIosIncrementalBuildCacheReceipt,
  writeIosIncrementalBuildCacheResultReceipt,
  type IosIncrementalBuildCachePredecessor,
  type IosIncrementalBuildCachePreparation,
  type IosIncrementalBuildBinding,
} from './native-ios-incremental-build-cache';
import {
  buildNativeLocaleBinding,
  normalizeNativeLocaleCommandOutput,
  readOwnedNativeLocaleStdout,
  safelyFinalizeNativeLocaleObservation,
  type NativeLocaleCommandRead,
} from './native-locale-capture-seam';
import { buildNativeLocaleContextCandidateFromFile } from './native-locale-file-observation';
import {
  findMaestroQuantityFailureCommands,
  recordNativeQuantityFailure,
} from './native-maestro-assertion-failure';
import { nativeSessionAssertionIds } from './native-pilot-contract';
import {
  assertIosNativeModuleRegistration,
  assertNativeBootstrapHealthy,
  inspectNativeMetroEntry,
  nativeObservationBudget,
  nativeExecutionDeadlines,
  nativeCommandDeadline,
  NativeExecutionDeadlineError,
} from './native-runtime-preflight';
import { observeIosSaveRetry } from './native-save-retry-observation';
import { readNativeSessionHelperInputs } from './native-session-helper-ledger';
import {
  verifyNativeSessionProfileCheckpoints,
  requireSignedOutSessionTransport,
  requireFinalSessionTransport,
  publishNativeSessionLedger,
} from './native-session-profile-checkpoints';
import { observeIosTrainingDiscard } from './native-training-discard-observation';
import { observeIosTrainingLocalEdit } from './native-training-edit-observation';
import { observeIosTrainingLoad } from './native-training-load-observation';
import {
  observeIosSavedTrainingJourney,
  observeIosTrainingTitleSelection,
} from './native-training-maestro-driver';
import { observeNativeTrainingDraft } from './native-training-observation';
import {
  readNativeEvidence,
  validateNativeRuntimeFrameFiles,
  type ViewEvidence,
} from './native-view-evidence';
import { acquireAdbServerReference } from './owned-adb-server';
import { startOwnedApiProxy } from './owned-api-proxy';
import { reserveOwnedAppPort, startOwnedExpo } from './owned-expo';
import {
  acquireOwnedIosSimulator,
  IosSimulatorBootstrapError,
  iosSimulatorBootstatusDeadline,
  validateBootedIosDevice,
} from './owned-ios-simulator';
import { verifyIosSimulatorApp, writeSimulatorBuildEntitlements } from './owned-ios-simulator-app';
import { executeOwnedNativeCommand } from './owned-native-command';
import { inspectProcessIdentity } from './owned-process-group';
import { OwnedSessionAcquisitionError, startOwnedSession } from './owned-session';
import {
  produceIosColdReset,
  type ColdResetPreparationExpectation,
} from './t15-cold-ios-reset-producer';
import type {
  IosLocaleRuntimeContext,
  IosLocaleScenarioInput,
  IosLocaleScenarioResult,
} from './ios-locale-runtime-adapter';
import type { OwnedConnectionSnapshot } from './native-connection-snapshot';
import type { NativeExecutionDeadlines } from './native-runtime-preflight';
import type { NativeAuthIdentityObservation, ProxyObservation } from './owned-api-proxy';
import type { NativeCommandExecution } from './owned-native-command';
import type {
  OwnedDomainSnapshot,
  OwnedFixtures,
  OwnedManifest,
  OwnedOrchestratorIdentity,
} from './owned-session';

const execute = promisify(execFile);
const ownedSessionDiagnosticsMaxBytes = 65_536;

type SafeOwnedSessionManifest = {
  phase: OwnedManifest['phase'];
  runId: string;
  artifactRoot: string;
  composeProject: string;
  port: number;
  fixtureScopes: string[];
  processes: OwnedManifest['processes'];
  repositories: OwnedManifest['repositories'];
};

export type IosOwnedSessionAcquisitionFailure = {
  cleanup: OwnedSessionAcquisitionError['cleanup'];
  /** pre-spawn means prepare/start failed before a direct child identity existed. */
  acquisitionPhase: 'pre-spawn' | 'spawned';
  childExitCode: number | null;
  pid: number | null;
  /** Direct child identity retained even when no runtime manifest was published. */
  orchestrator: OwnedOrchestratorIdentity | null;
  manifest: SafeOwnedSessionManifest | null;
  closed: {
    event: 'closed';
    receiptPath: string;
    cleanup: string;
    exitCode: number;
  } | null;
  diagnosticsHash: string;
  diagnosticsBytes: number;
  diagnosticsTruncated: boolean;
};

function boundedOwnedSessionDiagnostics(value: string): {
  bytes: Buffer;
  truncated: boolean;
} {
  const bytes = Buffer.from(value);
  if (bytes.length <= ownedSessionDiagnosticsMaxBytes) return { bytes, truncated: false };
  return {
    bytes: bytes.subarray(bytes.length - ownedSessionDiagnosticsMaxBytes),
    truncated: true,
  };
}

function safeOwnedSessionManifest(manifest: OwnedManifest): SafeOwnedSessionManifest {
  return {
    phase: manifest.phase,
    runId: manifest.runId,
    artifactRoot: manifest.artifactRoot,
    composeProject: manifest.composeProject,
    port: manifest.port,
    fixtureScopes: [...manifest.fixtureScopes],
    processes: manifest.processes.map((process) => ({ ...process })),
    repositories: Object.fromEntries(
      Object.entries(manifest.repositories).map(([name, repository]) => [name, { ...repository }]),
    ),
  };
}

/** Project an acquisition rejection without exposing the session owner token. */
export function projectIosOwnedSessionAcquisitionFailure(
  error: OwnedSessionAcquisitionError,
): IosOwnedSessionAcquisitionFailure {
  const diagnostics = boundedOwnedSessionDiagnostics(error.diagnostics);
  return {
    cleanup: error.cleanup,
    acquisitionPhase: error.pid !== undefined || error.orchestrator ? 'spawned' : 'pre-spawn',
    childExitCode: error.childExitCode,
    pid: error.pid ?? null,
    orchestrator: error.orchestrator
      ? {
          pid: error.orchestrator.pid,
          started: error.orchestrator.started,
          script: error.orchestrator.script,
          status: error.orchestrator.status,
        }
      : null,
    manifest: error.manifest ? safeOwnedSessionManifest(error.manifest) : null,
    closed: error.closed
      ? {
          event: 'closed',
          receiptPath: error.closed.receiptPath,
          cleanup: error.closed.cleanup,
          exitCode: error.closed.exitCode,
        }
      : null,
    diagnosticsHash: createHash('sha256').update(diagnostics.bytes).digest('hex'),
    diagnosticsBytes: diagnostics.bytes.length,
    diagnosticsTruncated: diagnostics.truncated,
  };
}

/** Preserve an owned backend recovery ledger when the capture has no session object to stop. */
export function projectIosCaptureCleanup(
  cleanupFailures: readonly string[],
  acquisitionCleanup?: OwnedSessionAcquisitionError['cleanup'],
): 'cleaned' | { status: 'failed-recovery-retained'; resources: string[] } {
  const resources = [
    ...cleanupFailures,
    ...(acquisitionCleanup === 'failed-recovery-ledger-retained' ? ['backend-acquisition'] : []),
  ];
  const uniqueResources = [...new Set(resources)];
  return uniqueResources.length
    ? { status: 'failed-recovery-retained', resources: uniqueResources }
    : 'cleaned';
}

export const iosNativeCharters = [
  'entry',
  'credential-entry-diagnostic',
  'auth-account',
  'session',
  'training-draft',
  'training-discard',
  'training-load',
  'training-edit',
  'training-journey',
  'training-title-selection',
  'training-title-gesture',
  'save-retry',
  'connection-states',
  'connection-journey',
  'camera-denied',
  'locale-selection-persistence',
  'locale-os-fallback-reset',
] as const;
export type IosNativeCharter = (typeof iosNativeCharters)[number];

/**
 * Generic auth and navigation observations are evidence of UI state only. A
 * camera frame may carry actor/auth provenance only when the caller has
 * explicitly established the current authenticated camera boundary.
 */
export type IosCameraObservationMode = 'generic' | 'authenticated-camera';

export function shouldAttachIosCameraFrameSource(input: {
  charter: IosNativeCharter;
  mode: IosCameraObservationMode;
}): boolean {
  return input.charter === 'camera-denied' && input.mode === 'authenticated-camera';
}

/**
 * Capture-only camera charters have no verified camera auth boundary. The
 * callback-integrated path establishes that boundary before it can request
 * camera frame provenance.
 */
export function selectIosCameraObservationMode(
  cameraIntegration: boolean,
): IosCameraObservationMode {
  return cameraIntegration ? 'authenticated-camera' : 'generic';
}

export function requireIosCameraFrameAuthRequestId(input: {
  mode: IosCameraObservationMode;
  authRequestId: number | undefined;
}): number | undefined {
  if (input.mode === 'generic') return undefined;
  const authRequestId = input.authRequestId;
  if (
    typeof authRequestId !== 'number' ||
    !Number.isSafeInteger(authRequestId) ||
    authRequestId <= 0
  )
    throw new Error('Camera frame source identity is unavailable');
  return authRequestId;
}

const iosNativeAuthPreludeCharters: readonly IosNativeCharter[] = [
  'credential-entry-diagnostic',
  'auth-account',
  'training-draft',
  'training-discard',
  'training-load',
  'training-edit',
  'training-journey',
  'training-title-selection',
  'training-title-gesture',
  'save-retry',
  'connection-states',
  'connection-journey',
  'camera-denied',
  'session',
];

/** The default entry snapshot never types credentials. */
export function iosNativeCharterUsesAuthPrelude(charter: IosNativeCharter): boolean {
  return iosNativeAuthPreludeCharters.includes(charter);
}

export type IosTrainingRuntimeContext = Omit<
  Parameters<typeof observeIosSavedTrainingJourney>[0],
  'report'
>;
export type IosSaveRetryRuntimeContext = Pick<
  IosTrainingRuntimeContext,
  'output' | 'fixtures' | 'snapshot' | 'proxy' | 'observe'
> & {
  accountUid: string;
  /** The capture's actual report; the save observer appends its raw preparation facts here. */
  report: Record<string, unknown>;
};
export type IosConnectionAccount = 'coach' | 'student';
export type IosConnectionAccountSwitchResult = {
  actor: IosConnectionAccount;
  beforeRequestId: number;
  authRequestId: number;
  afterRequestId: number;
  actorAuthUid: string;
};
export type IosConnectionApiIdentity = {
  apiPid: number;
  targetOrigin: string;
};
type IosConnectionAuthIdentityCapture = {
  enableNativeAuthIdentityCapture: (fixtureAuthUids: readonly string[]) => void;
  nativeAuthIdentities: readonly NativeAuthIdentityObservation[];
};
export type IosConnectionRuntimeContext = {
  output: string;
  fixtures: OwnedFixtures;
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>;
  apiIdentity: IosConnectionApiIdentity;
  observe: IosTrainingRuntimeContext['observe'];
  snapshot: () => Promise<OwnedDomainSnapshot>;
  connectionSnapshot: () => Promise<OwnedConnectionSnapshot>;
  isolationSnapshot: () => Promise<OwnedConnectionSnapshot>;
  report: Record<string, unknown>;
  switchAccount: (
    actor: IosConnectionAccount,
    backActions?: string,
  ) => Promise<IosConnectionAccountSwitchResult>;
};

export async function observeIosConnectionSignOutWithDiagnostic(input: {
  label: string;
  initialActions: string;
  confirmationActions: string;
  report: Record<string, unknown>;
  observe: IosTrainingRuntimeContext['observe'];
  observePostTapDiagnostic: (label: string, actions: string) => Promise<Record<string, unknown>>;
}): Promise<void> {
  const diagnostics = (input.report.connectionSignoutPostTapDiagnostics ??= {}) as Record<
    string,
    unknown
  >;
  diagnostics[input.label] = await input.observePostTapDiagnostic(
    `${input.label}-signout-post-tap`,
    input.initialActions,
  );
  await input.observe(
    `${input.label}-signed-out`,
    input.confirmationActions,
    'SCR-sign-in',
    'auth.signIn.emailInput',
  );
}
export type IosCameraRuntimeContext = IosConnectionRuntimeContext & {
  /** Separate scope acquired before camera continuation for unchanged-state proof. */
  connectionIsolationFixtures: OwnedFixtures;
  /** Actual command ledger shared with camera observers; never caller metadata. */
  commandExecutions: readonly IosCameraCommandExecution[];
  displayName: string;
  permission: () => Promise<IosCameraPermissionObservation>;
  signal: AbortSignal;
};
export type OwnedIosNativeSessionOptions = {
  charter: IosNativeCharter;
  /** Requested public attempt owner for resource-window binding. */
  requestedRunId?: string;
  /** Caller-owned precreated public artifact namespace bound to the capture receipt. */
  callerOutputRoot?: string;
  /** Absolute monotonic whole-run deadline inherited from the public runner. */
  deadlineAtMonotonicMs?: number;
  /** Reviewed fingerprints only; target/backend rows are derived after acquisition. */
  coldReset?: ColdResetPreparationExpectation;
  locale?: 'en-US' | 'pt-BR' | 'es-ES';
  reuseBuildRunId?: string;
  /** Explicit qualified-build cache root; absent means this checkout. */
  reuseBuildSourceRoot?: string;
  /** Optional producer-owned cleaned failed build used only for compiler caches. */
  incrementalBuildCacheSourceRoot?: string;
  bootstatusDeadlineMs?: number;
  deadlines?: NativeExecutionDeadlines;
  signal?: AbortSignal;
  executeTraining?: (context: IosTrainingRuntimeContext) => Promise<void>;
  executeSaveRetry?: (context: IosSaveRetryRuntimeContext) => Promise<void>;
  executeConnection?: (context: IosConnectionRuntimeContext) => Promise<void>;
  /** Runs after the connection flow's final home/password witness. */
  executeConnectionAfterFlow?: (context: IosConnectionRuntimeContext) => Promise<void>;
  /** Enables one owned pre-auth email tap/input diagnostic before camera continuation. */
  credentialInteractionDiagnostic?: boolean;
  /** Integration-only camera continuation; no callback keeps inventory semantics. */
  executeCamera?: (context: IosCameraRuntimeContext) => Promise<void>;
  /** Integration-only locale continuation; runtime result remains preparation-only. */
  executeLocale?: (input: {
    context: IosLocaleRuntimeContext;
    run: (scenario: IosLocaleScenarioInput) => Promise<IosLocaleScenarioResult>;
    scenario: IosLocaleScenarioInput;
  }) => Promise<IosLocaleScenarioResult>;
  /** Explicit locale continuation for the connection charter. */
  executeConnectionLocale?: (input: {
    context: IosLocaleRuntimeContext;
    run: (scenario: IosLocaleScenarioInput) => Promise<IosLocaleScenarioResult>;
    scenario: IosLocaleScenarioInput;
  }) => Promise<IosLocaleScenarioResult>;
};
export type OwnedIosNativeSessionResult = {
  artifactRoot: string;
  exitCode: number;
  report: Record<string, unknown>;
};

/**
 * Project one validated locale callback result without allowing a blocked or
 * malformed branch to be relabeled by the generic capture finalizer.
 */
export function applyIosLocaleScenarioResult(
  report: Record<string, unknown>,
  result: IosLocaleScenarioResult,
): boolean {
  report.localeScenario = result;
  report.localeScenarioStatus = result.status;
  report.localeScenarioCleanupOwner = result.cleanupOwner;
  report.localeScenarioBlockers = [...result.blockers];
  const publishableAtThisBoundary =
    result.status === 'observed' &&
    result.cleanupOwner === 'outer-capture' &&
    result.runtimeQualification === 'pending' &&
    result.nativePassingCases === 0 &&
    result.publicLocale === null &&
    result.blockers.length === 0 &&
    result.cleanupAttempted === false &&
    result.cleanupObserved === false &&
    result.cleanupReceipt === null &&
    result.cleanupError === null;
  if (!publishableAtThisBoundary) report.result = 'harness-blocked';
  return publishableAtThisBoundary;
}

export type IosConnectionBackendProcess = {
  role: string;
  pid: number;
  started: string;
  script: string;
};

export type IosConnectionBackendProvenance = {
  backendAttemptId: string;
  apiOrigin: string;
  apiProcess: Pick<IosConnectionBackendProcess, 'pid' | 'started' | 'script'>;
};

/**
 * Binds the connection lane's API origin and first-attempt identity to the
 * exact API process row already validated by the owned session.
 */
export function buildIosConnectionBackendProvenance(input: {
  runId: string;
  apiOrigin: string;
  apiPid: number;
  processes: readonly IosConnectionBackendProcess[];
}): IosConnectionBackendProvenance {
  if (!/^[a-f0-9]{24}$/.test(input.runId))
    throw new Error('Connection backend run identity is invalid');
  if (typeof input.apiOrigin !== 'string' || input.apiOrigin.length === 0)
    throw new Error('Connection backend API origin is missing');
  if (!Number.isSafeInteger(input.apiPid) || input.apiPid <= 1)
    throw new Error('Connection backend API PID is invalid');
  const apiRows = input.processes.filter((row) => row.role === 'api');
  if (apiRows.length !== 1) throw new Error('Connection backend API process is not unique');
  const apiProcess = apiRows[0];
  if (apiProcess.pid !== input.apiPid)
    throw new Error('Connection backend API process PID differs from session identity');
  if (
    !Number.isSafeInteger(apiProcess.pid) ||
    apiProcess.pid <= 1 ||
    typeof apiProcess.started !== 'string' ||
    apiProcess.started.length === 0 ||
    typeof apiProcess.script !== 'string' ||
    apiProcess.script.length === 0
  )
    throw new Error('Connection backend API process identity is incomplete');
  return {
    backendAttemptId: `${input.runId}:first`,
    apiOrigin: input.apiOrigin,
    apiProcess: {
      pid: apiProcess.pid,
      started: apiProcess.started,
      script: apiProcess.script,
    },
  };
}

function requireCredentialActionInput(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0)
    throw new Error('Invalid credential input');
  return value;
}

function escapeCredentialSelectorText(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const passwordOfferTextSelector = '^Save Password\\?$';
const passwordOfferDismissSelector = '^Not Now$';

/**
 * Dismisses the iOS password-save offer only after it is actually visible and
 * requires it to disappear before the caller proceeds to its home marker.
 * This emits no credentials or mutation commands; the one tap is bounded and
 * retries only when Maestro observes no hierarchy change.
 */
export function buildIosPasswordOfferDismissalActions(): string {
  return [
    '- extendedWaitUntil:',
    '    visible:',
    `      text: ${JSON.stringify(passwordOfferTextSelector)}`,
    '    timeout: 30000',
    '- waitForAnimationToEnd:',
    '    timeout: 5000',
    '- tapOn:',
    `    text: ${JSON.stringify(passwordOfferDismissSelector)}`,
    '    retryTapIfNoChange: true',
    '    waitToSettleTimeoutMs: 5000',
    '- extendedWaitUntil:',
    '    notVisible:',
    `      text: ${JSON.stringify(passwordOfferTextSelector)}`,
    '    timeout: 30000',
  ].join('\n');
}

/**
 * Builds the private Maestro sign-in prelude used by the iOS inventory capture.
 * This is a generated-flow contract only; native focus and text fidelity remain
 * runtime evidence captured by the surrounding observation.
 */
export function buildIosCredentialEntryActions(email: unknown, password: unknown): string {
  const safeEmail = requireCredentialActionInput(email);
  const safePassword = requireCredentialActionInput(password);
  const emailPattern = `^${escapeCredentialSelectorText(safeEmail)}$`;
  return [
    '- tapOn:',
    '    id: auth.signIn.emailInput',
    '    retryTapIfNoChange: true',
    `- inputText: ${JSON.stringify(safeEmail)}`,
    '- assertVisible:',
    '    id: auth.signIn.emailInput',
    `    text: ${JSON.stringify(emailPattern)}`,
    '- tapOn:',
    '    id: auth.signIn.passwordInput',
    '    retryTapIfNoChange: true',
    `- inputText: ${JSON.stringify(safePassword)}`,
    '- assertVisible:',
    '    id: auth.signIn.emailInput',
    `    text: ${JSON.stringify(emailPattern)}`,
    '- hideKeyboard',
    '- assertVisible:',
    '    id: auth.signIn.submitButton',
    '- tapOn:',
    '    id: auth.signIn.submitButton',
  ].join('\n');
}

/**
 * Continues the already-observed credential entry at the password field. The
 * diagnostic branch owns the email tap/input and exact assertion, so this
 * continuation intentionally contains no email action and no retry action.
 */
export function buildIosCredentialEntryPasswordContinuationActions(password: unknown): string {
  const safePassword = requireCredentialActionInput(password);
  return [
    '- tapOn:',
    '    id: auth.signIn.passwordInput',
    `- inputText: ${JSON.stringify(safePassword)}`,
    '- hideKeyboard',
    '- assertVisible:',
    '    id: auth.signIn.submitButton',
    '- tapOn:',
    '    id: auth.signIn.submitButton',
  ].join('\n');
}

/** The diagnostic input and exact assertion are separate owned flows. */
/**
 * Continues the camera branch after the diagnostic while preserving the
 * original email assertion that the combined sign-in flow performs after
 * password input. The diagnostic owns exactly one email tap and one input.
 */
export function buildIosCredentialEntryPasswordContinuationWithOriginalEmailAssertionActions(
  password: unknown,
  email: unknown,
): string {
  const safePassword = requireCredentialActionInput(password);
  const safeEmail = requireCredentialActionInput(email);
  const emailPattern = `^${escapeCredentialSelectorText(safeEmail)}$`;
  return [
    '- hideKeyboard',
    '- tapOn:',
    '    id: auth.signIn.passwordInput',
    `- inputText: ${JSON.stringify(safePassword)}`,
    '- assertVisible:',
    '    id: auth.signIn.emailInput',
    `    text: ${JSON.stringify(emailPattern)}`,
    '- hideKeyboard',
    '- assertVisible:',
    '    id: auth.signIn.submitButton',
    '- tapOn:',
    '    id: auth.signIn.submitButton',
  ].join('\n');
}

export function resolveIosCredentialDiagnosticPostLogin(input: { cameraIntegration: boolean }): {
  actor: 'coach' | 'student';
  screenshot: 'SCR-pro-home' | 'SCR-student-home';
  selector: 'pro.home.screen' | 'student.home.screen';
} {
  if (typeof input.cameraIntegration !== 'boolean')
    throw new Error('Credential diagnostic camera integration state is invalid');
  if (!input.cameraIntegration)
    return {
      actor: 'coach',
      screenshot: 'SCR-pro-home',
      selector: 'pro.home.screen',
    };
  return {
    actor: 'student',
    screenshot: 'SCR-student-home',
    selector: 'student.home.screen',
  };
}

export function buildIosCredentialEntryDiagnosticInputActions(email: unknown): string {
  const safeEmail = requireCredentialActionInput(email);
  // Each diagnostic stage owns a separate Maestro invocation. Acquire focus
  // in the same invocation that types; do not rely on the prior driver's focus.
  return `${buildIosCredentialEntryDiagnosticTapActions()}\n- inputText: ${JSON.stringify(safeEmail)}`;
}

/** The diagnostic tap is one bounded driver action; Maestro retries are disabled explicitly. */
export function buildIosCredentialEntryDiagnosticTapActions(): string {
  return '- tapOn:\n    id: auth.signIn.emailInput\n    retryTapIfNoChange: false';
}

export function buildIosCredentialEntryDiagnosticAssertionActions(email: unknown): string {
  const safeEmail = requireCredentialActionInput(email);
  const emailPattern = `^${escapeCredentialSelectorText(safeEmail)}$`;
  return [
    '- assertVisible:',
    '    id: auth.signIn.emailInput',
    `    text: ${JSON.stringify(emailPattern)}`,
  ].join('\n');
}

/**
 * Builds the only navigation boundary permitted before a connection account
 * switch. The caller may provide the current screen's semantic back action;
 * the switch itself always reaches the account tab through normal UI.
 */
export function buildIosConnectionAccountSwitchActions(backActions = ''): string {
  if (typeof backActions !== 'string')
    throw new Error('Invalid iOS connection account back actions');
  const requested = backActions.trim();
  const prefix =
    requested === '' || requested === 'none'
      ? ''
      : requested === 'student-professionals-back'
        ? '- hideKeyboard\n- tapOn:\n    id: "student.professionals.backButton"\n- extendedWaitUntil:\n    visible:\n      id: "student.home.screen"\n    timeout: 90000'
        : requested;
  if (
    prefix !== '' &&
    (!prefix.startsWith('- ') || /\b(?:launchApp|runScript|openLink|clearState)\b/.test(prefix))
  )
    throw new Error('Invalid iOS connection account back actions');
  return `${prefix ? `${prefix}\n` : ''}- tapOn:\n    id: tabs.account`;
}

const nativeSignInPathHash = createHash('sha256').update('/auth/email/sign-in').digest('hex');

function requireIosConnectionAuthIdentityCapture(
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>,
): asserts proxy is Awaited<ReturnType<typeof startOwnedApiProxy>> &
  IosConnectionAuthIdentityCapture {
  const candidate = proxy as unknown as {
    enableNativeAuthIdentityCapture?: unknown;
    nativeAuthIdentities?: unknown;
  };
  if (
    typeof candidate.enableNativeAuthIdentityCapture !== 'function' ||
    !Array.isArray(candidate.nativeAuthIdentities)
  )
    throw new Error('Connection journey requires owned native auth identity capture');
}

/**
 * Auth sign-in evidence must belong to the current account switch. Historic
 * successful sign-ins cannot satisfy a later switch boundary.
 */
export function requireIosConnectionSignInBoundary(
  observations: readonly ProxyObservation[],
  beforeRequestId: number,
): {
  beforeRequestId: number;
  authRequestId: number;
  afterRequestId: number;
} {
  if (!Number.isSafeInteger(beforeRequestId) || beforeRequestId < 0)
    throw new Error('Invalid iOS connection sign-in observation boundary');
  const afterRequestId = observations.reduce(
    (maximum, row) => Math.max(maximum, row.requestId),
    beforeRequestId,
  );
  const matches = observations.filter(
    (row) =>
      row.requestId > beforeRequestId &&
      row.method === 'POST' &&
      row.pathHash === nativeSignInPathHash &&
      row.status === 201 &&
      row.outcome === 'forwarded' &&
      row.requestProfile === 'native',
  );
  if (matches.length !== 1)
    throw new Error('iOS connection account switch lacks one new native sign-in response');
  return { beforeRequestId, authRequestId: matches[0].requestId, afterRequestId };
}

function requireIosCameraInitialAuthBoundary(value: unknown): {
  beforeRequestId: number;
  authRequestId: number;
  afterRequestId: number;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Camera initial auth boundary is not an object');
  const fields = value as Record<string, unknown>;
  const requestId = (name: string): number => {
    const candidate = fields[name];
    if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0)
      throw new Error(`Camera initial auth boundary has an invalid ${name}`);
    return candidate;
  };
  const beforeRequestId = requestId('beforeRequestId');
  const authRequestId = requestId('authRequestId');
  const afterRequestId = requestId('afterRequestId');
  if (authRequestId <= beforeRequestId || afterRequestId < authRequestId)
    throw new Error('Camera initial auth boundary request ordering is invalid');
  return { beforeRequestId, authRequestId, afterRequestId };
}

export function requireIosConnectionActorIdentity(
  identities: readonly NativeAuthIdentityObservation[],
  expected: {
    actorAuthUid: string;
    authRequestId: number;
    apiIdentity: IosConnectionApiIdentity;
    fixtureAuthUids: readonly string[];
  },
): string {
  const fixtureAuthUids = [...expected.fixtureAuthUids].sort();
  if (
    fixtureAuthUids.length === 0 ||
    fixtureAuthUids.some((value) => typeof value !== 'string' || value.length === 0) ||
    new Set(fixtureAuthUids).size !== fixtureAuthUids.length
  )
    throw new Error('iOS connection fixture actor allowlist is invalid');
  const allowlistHash = createHash('sha256').update(JSON.stringify(fixtureAuthUids)).digest('hex');
  const requestIds = new Set<number>();
  const ordinals = new Set<number>();
  for (const identity of identities) {
    if (
      !Number.isSafeInteger(identity.requestId) ||
      identity.requestId < 1 ||
      requestIds.has(identity.requestId) ||
      !Number.isSafeInteger(identity.ordinal) ||
      identity.ordinal < 1 ||
      ordinals.has(identity.ordinal) ||
      typeof identity.targetOrigin !== 'string' ||
      identity.targetOrigin.length === 0 ||
      !Number.isSafeInteger(identity.apiPid) ||
      identity.apiPid < 1 ||
      !Number.isSafeInteger(identity.status) ||
      (identity.authUid !== null &&
        (typeof identity.authUid !== 'string' || !fixtureAuthUids.includes(identity.authUid))) ||
      (identity.verification !== 'verified' && identity.verification !== 'unverified') ||
      typeof identity.verificationReason !== 'string' ||
      identity.fixtureAuthUidAllowlistHash !== allowlistHash
    )
      throw new Error('iOS connection native auth identity evidence is malformed');
    requestIds.add(identity.requestId);
    ordinals.add(identity.ordinal);
  }
  const matches = identities.filter((identity) => identity.requestId === expected.authRequestId);
  if (matches.length !== 1)
    throw new Error('iOS connection sign-in request identity is not unique');
  const matched = matches[0];
  if (
    matched.status !== 201 ||
    matched.verification !== 'verified' ||
    matched.verificationReason !== 'verified' ||
    matched.authUid !== expected.actorAuthUid ||
    matched.apiPid !== expected.apiIdentity.apiPid ||
    matched.targetOrigin !== expected.apiIdentity.targetOrigin
  )
    throw new Error('iOS connection sign-in lacks one verified owned actor identity');
  if (!matched || typeof matched.authUid !== 'string')
    throw new Error('iOS connection sign-in lacks one verified owned actor identity');
  return matched.authUid;
}

export function parseIosNativeCaptureArguments(
  args: readonly string[],
): OwnedIosNativeSessionOptions {
  const reuseArg = args.find((arg) => arg.startsWith('--reuse-build='));
  const incrementalCacheArg = args.find((arg) => arg.startsWith('--incremental-build-cache='));
  const charterArg = args.find((arg) => arg.startsWith('--charter='));
  const localeArg = args.find((arg) => arg.startsWith('--locale='));
  const charter = charterArg?.slice('--charter='.length) ?? 'entry';
  const locale = localeArg?.slice('--locale='.length);
  const localeCharter =
    charter === 'locale-selection-persistence' || charter === 'locale-os-fallback-reset';
  if (
    !args.includes('--platform=ios') ||
    !args.includes('--mode=inventory') ||
    new Set(args).size !== args.length ||
    !iosNativeCharters.includes(charter as IosNativeCharter) ||
    args.length !==
      2 +
        Number(Boolean(reuseArg)) +
        Number(Boolean(incrementalCacheArg)) +
        Number(Boolean(charterArg)) +
        Number(Boolean(localeArg)) ||
    (reuseArg && !/^--reuse-build=[a-f0-9]{24}$/.test(reuseArg)) ||
    (incrementalCacheArg &&
      (!incrementalCacheArg.startsWith('--incremental-build-cache=/') ||
        incrementalCacheArg.includes('\0'))) ||
    (localeCharter && !/^(?:en-US|pt-BR|es-ES)$/.test(locale ?? '')) ||
    (!localeCharter && localeArg !== undefined)
  )
    throw new Error('Invalid iOS native capture arguments');
  return {
    charter: charter as IosNativeCharter,
    ...(localeCharter ? { locale: locale as 'en-US' | 'pt-BR' | 'es-ES' } : {}),
    ...(reuseArg ? { reuseBuildRunId: reuseArg.slice('--reuse-build='.length) } : {}),
    ...(incrementalCacheArg
      ? {
          incrementalBuildCacheSourceRoot: incrementalCacheArg.slice(
            '--incremental-build-cache='.length,
          ),
        }
      : {}),
  };
}

export type CallerOutputRootBinding = {
  path: string;
  identity: {
    dev: number;
    ino: number;
    mode: number;
    uid: number;
    nlink: number;
  };
};

/**
 * The capture producer's public binding envelope.  Keep this at report level
 * because the camera adapter consumes the report after cleanup; `budget` is
 * an execution ledger and is not the binding contract.
 */
export function buildCallerOutputRootBindingReceipt(input: {
  requestedRunId?: string;
  captureRunId: string;
  binding: CallerOutputRootBinding | null;
  deadlineAtMonotonicMs?: number;
}): Record<string, unknown> {
  return {
    requestedRunId: input.requestedRunId ?? null,
    captureRunId: input.captureRunId,
    callerOutputRootBinding: input.binding,
    callerDeadlineAtMonotonicMs: input.deadlineAtMonotonicMs ?? null,
  };
}

export function buildCallerOutputRootBindingSidecar(input: {
  requestedRunId?: string;
  captureRunId: string;
  binding: CallerOutputRootBinding;
  deadlineAtMonotonicMs: number;
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'private caller artifact namespace binding, not passing evidence',
    requestedRunId: input.requestedRunId ?? null,
    captureRunId: input.captureRunId,
    binding: input.binding,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
  };
}

async function captureCallerOutputRootBinding(
  outputRoot: string,
  requestedRunId: string | undefined,
): Promise<CallerOutputRootBinding> {
  const resolved = path.resolve(outputRoot);
  const canonical = await realpath(resolved);
  if (canonical !== resolved) throw new Error('Caller artifact root must be a canonical path');
  const metadata = await stat(resolved);
  if (
    !metadata.isDirectory() ||
    (metadata.mode & 0o777) !== 0o700 ||
    (process.getuid && metadata.uid !== process.getuid())
  )
    throw new Error('Caller artifact root must be a private owned directory');
  if (requestedRunId !== undefined && path.basename(resolved) !== requestedRunId)
    throw new Error('Caller artifact root does not match the requested run ID');
  return {
    path: resolved,
    identity: {
      dev: metadata.dev,
      ino: metadata.ino,
      mode: metadata.mode & 0o777,
      uid: metadata.uid,
      nlink: metadata.nlink,
    },
  };
}

/** Shared owned lifecycle; importing it neither launches work nor installs process handlers. */
export async function runOwnedIosNativeSession(
  options: OwnedIosNativeSessionOptions,
): Promise<OwnedIosNativeSessionResult> {
  if (
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) =>
        ![
          'charter',
          'reuseBuildRunId',
          'reuseBuildSourceRoot',
          'incrementalBuildCacheSourceRoot',
          'bootstatusDeadlineMs',
          'deadlines',
          'locale',
          'signal',
          'executeTraining',
          'executeSaveRetry',
          'executeConnection',
          'executeConnectionAfterFlow',
          'executeCamera',
          'credentialInteractionDiagnostic',
          'executeLocale',
          'executeConnectionLocale',
          'requestedRunId',
          'callerOutputRoot',
          'deadlineAtMonotonicMs',
          'coldReset',
        ].includes(key),
    ) ||
    !iosNativeCharters.includes(options.charter) ||
    ((options.charter === 'locale-selection-persistence' ||
      options.charter === 'locale-os-fallback-reset' ||
      (options.charter === 'connection-journey' &&
        options.executeConnectionLocale !== undefined)) &&
      !options.locale) ||
    (!(
      options.charter === 'locale-selection-persistence' ||
      options.charter === 'locale-os-fallback-reset' ||
      (options.charter === 'connection-journey' && options.executeConnectionLocale !== undefined)
    ) &&
      options.locale !== undefined) ||
    (options.locale !== undefined && !['en-US', 'pt-BR', 'es-ES'].includes(options.locale)) ||
    (options.reuseBuildRunId !== undefined && !/^[a-f0-9]{24}$/.test(options.reuseBuildRunId)) ||
    (options.reuseBuildSourceRoot !== undefined &&
      (!path.isAbsolute(options.reuseBuildSourceRoot) ||
        options.reuseBuildSourceRoot.includes('\0'))) ||
    (options.incrementalBuildCacheSourceRoot !== undefined &&
      (!path.isAbsolute(options.incrementalBuildCacheSourceRoot) ||
        options.incrementalBuildCacheSourceRoot.includes('\0'))) ||
    (options.reuseBuildRunId !== undefined &&
      options.incrementalBuildCacheSourceRoot !== undefined) ||
    (options.incrementalBuildCacheSourceRoot !== undefined &&
      (options.charter !== 'camera-denied' || options.executeCamera === undefined)) ||
    (options.executeTraining !== undefined &&
      (typeof options.executeTraining !== 'function' || options.charter !== 'training-journey')) ||
    (options.executeSaveRetry !== undefined &&
      (typeof options.executeSaveRetry !== 'function' || options.charter !== 'save-retry')) ||
    (options.executeConnection !== undefined &&
      (typeof options.executeConnection !== 'function' ||
        options.charter !== 'connection-journey')) ||
    (options.executeConnectionAfterFlow !== undefined &&
      (typeof options.executeConnectionAfterFlow !== 'function' ||
        options.charter !== 'connection-journey')) ||
    (options.executeCamera !== undefined &&
      (typeof options.executeCamera !== 'function' || options.charter !== 'camera-denied')) ||
    (options.credentialInteractionDiagnostic !== undefined &&
      (typeof options.credentialInteractionDiagnostic !== 'boolean' ||
        options.charter !== 'camera-denied' ||
        options.executeCamera === undefined)) ||
    (options.executeLocale !== undefined &&
      (typeof options.executeLocale !== 'function' ||
        (options.charter !== 'locale-selection-persistence' &&
          options.charter !== 'locale-os-fallback-reset'))) ||
    (options.executeConnectionLocale !== undefined &&
      (typeof options.executeConnectionLocale !== 'function' ||
        options.charter !== 'connection-journey')) ||
    (options.executeTraining !== undefined &&
      (options.executeSaveRetry !== undefined ||
        options.executeConnection !== undefined ||
        options.executeCamera !== undefined)) ||
    (options.executeSaveRetry !== undefined &&
      (options.executeConnection !== undefined || options.executeCamera !== undefined)) ||
    (options.executeConnection !== undefined && options.executeCamera !== undefined) ||
    (options.executeLocale !== undefined &&
      (options.executeTraining !== undefined ||
        options.executeSaveRetry !== undefined ||
        options.executeConnection !== undefined ||
        options.executeCamera !== undefined)) ||
    (options.charter === 'connection-journey' && options.executeConnection === undefined) ||
    (options.signal !== undefined && !(options.signal instanceof AbortSignal)) ||
    (options.requestedRunId !== undefined && !/^[a-f0-9]{24}$/.test(options.requestedRunId)) ||
    (options.callerOutputRoot !== undefined &&
      (!path.isAbsolute(options.callerOutputRoot) || options.callerOutputRoot.includes('\0'))) ||
    (options.deadlineAtMonotonicMs !== undefined &&
      (!Number.isFinite(options.deadlineAtMonotonicMs) ||
        options.deadlineAtMonotonicMs <= performance.now())) ||
    (options.callerOutputRoot === undefined) !== (options.deadlineAtMonotonicMs === undefined) ||
    (options.coldReset !== undefined &&
      (options.requestedRunId !== options.coldReset.requestedRunId ||
        !(
          options.executeTraining ||
          options.executeSaveRetry ||
          options.executeConnection ||
          options.executeConnectionAfterFlow ||
          options.executeConnectionLocale ||
          options.executeCamera
        )))
  )
    throw new Error('Invalid owned iOS session options');
  iosSimulatorBootstatusDeadline(options.bootstatusDeadlineMs);
  nativeExecutionDeadlines(options.deadlines);
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  let cancellation: 'SIGINT' | 'SIGTERM' | undefined;
  const onAbort = () => {
    const reason: unknown = options.signal?.reason;
    cancellation = reason === 'SIGTERM' || reason === 'SIGINT' ? reason : undefined;
    controller.abort(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await executeOwnedIosSession({ ...options }, controller, () => cancellation);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
}

async function executeOwnedIosSession(
  options: OwnedIosNativeSessionOptions,
  controller: AbortController,
  cancellation: () => 'SIGINT' | 'SIGTERM' | undefined,
): Promise<OwnedIosNativeSessionResult> {
  const { charter, reuseBuildRunId, reuseBuildSourceRoot, incrementalBuildCacheSourceRoot } =
    options;
  const cameraIntegration = charter === 'camera-denied' && options.executeCamera !== undefined;
  const connectionLocaleIntegration =
    charter === 'connection-journey' && options.executeConnectionLocale !== undefined;
  const localeIntegration =
    charter === 'locale-selection-persistence' ||
    charter === 'locale-os-fallback-reset' ||
    connectionLocaleIntegration;
  const needsConnectionContext = charter === 'connection-journey' || cameraIntegration;
  const deadlines = nativeExecutionDeadlines(options.deadlines);
  const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const hostRootValue: unknown = process.env.MYCHAMPIONS_NATIVE_STATE_ROOT;
  const hostRoot = typeof hostRootValue === 'string' ? hostRootValue : undefined;
  if (
    !hostRoot ||
    (await realpath(hostRoot)) !== hostRoot ||
    ((await stat(hostRoot)).mode & 0o777) !== 0o700 ||
    (await stat(hostRoot)).uid !== process.getuid?.()
  )
    throw new Error(
      'Run through the existing native host-lock wrapper with a private canonical state root',
    );
  const callerOutputRootBinding = options.callerOutputRoot
    ? await captureCallerOutputRootBinding(options.callerOutputRoot, options.requestedRunId)
    : null;
  const output = path.join(root, '.qa/artifacts/native-pilot', randomBytes(12).toString('hex'));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const captureRunId = path.basename(output);
  const timingsMs = {
    build: 0,
    install: 0,
    reset: 0,
    scenario: 0,
    verify: 0,
    cleanup: 0,
  };
  let timedPhase: keyof typeof timingsMs | undefined = 'reset';
  let phaseStarted = performance.now();
  const beginPhase = (next?: keyof typeof timingsMs) => {
    const now = performance.now();
    if (timedPhase) timingsMs[timedPhase] += now - phaseStarted;
    timedPhase = next;
    phaseStarted = now;
  };
  process.stdout.write(
    `${options.executeTraining || options.executeSaveRetry || options.executeConnection || cameraIntegration || localeIntegration ? 'Owned native execution' : 'Native inventory'} artifacts: ${output}\n`,
  );
  await writeFile(
    path.join(output, 'previous-ios-devices.private.json'),
    (
      await execute('xcrun', ['simctl', 'list', 'devices', '--json'], {
        timeout: 15000,
      })
    ).stdout,
    { mode: 0o600, flag: 'wx' },
  );
  const report: Record<string, unknown> = {
    kind: options.executeTraining
      ? 'private-owned-native-training-execution-not-public-receipt'
      : options.executeSaveRetry
        ? 'private-owned-native-save-retry-execution-not-public-receipt'
        : options.executeConnection
          ? 'private-owned-native-connection-execution-not-public-receipt'
          : cameraIntegration
            ? 'private-owned-native-camera-execution-not-public-receipt'
            : localeIntegration
              ? 'private-owned-native-locale-execution-not-public-receipt'
              : 'private-native-inventory-observation-not-behavior-attempt',
    mode:
      options.executeTraining ||
      options.executeSaveRetry ||
      options.executeConnection ||
      cameraIntegration ||
      localeIntegration
        ? 'integration'
        : 'inventory',
    platform: 'ios',
    scope:
      options.executeTraining ||
      options.executeSaveRetry ||
      options.executeConnection ||
      cameraIntegration ||
      localeIntegration
        ? 'shared owned native lifecycle; public assertions and final receipt verification pending'
        : 'native inventory observation only; no behavior pass',
    startedAt: new Date().toISOString(),
    captureRunId,
    captureRoot: output,
    result: 'harness-blocked',
    nativePassingCases: 0,
    observedOsLocale: null,
    localeBinding: null,
    localeExpectedBinding: null,
    localeContextCandidate: null,
    viewIds: [],
    connectionPasswordOfferWitnesses: [],
    cleanup: 'pending',
    timingsMs,
  };
  Object.assign(
    report,
    buildCallerOutputRootBindingReceipt({
      requestedRunId: options.requestedRunId,
      captureRunId,
      binding: callerOutputRootBinding,
      deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    }),
  );
  const budget = nativeObservationBudget(
    charter === 'training-journey' ||
      charter === 'connection-journey' ||
      cameraIntegration ||
      localeIntegration
      ? { buildMs: 900_000, observationMs: 1_200_000, cleanupMs: 300_000 }
      : undefined,
  );
  report.budget = {
    ...budget,
    simulatorBootstatusMs: iosSimulatorBootstatusDeadline(options.bootstatusDeadlineMs),
    execution: deadlines,
    callerDeadlineAtMonotonicMs: options.deadlineAtMonotonicMs ?? null,
    callerOutputRootBinding,
  };
  if (callerOutputRootBinding)
    await writeFile(
      path.join(output, 'caller-output-root-binding.private.json'),
      JSON.stringify(
        buildCallerOutputRootBindingSidecar({
          requestedRunId: options.requestedRunId,
          captureRunId,
          binding: callerOutputRootBinding,
          deadlineAtMonotonicMs: options.deadlineAtMonotonicMs!,
        }),
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
  const initialSource = await sourceIdentity(root);
  report.source = initialSource;
  const helperIdentity = async () => readNativeSessionHelperInputs(root);
  const helperInputsBefore = await helperIdentity();
  report.helperInputsBefore = helperInputsBefore;
  const acquisitionIntents: string[] = [];
  report.acquisitionIntents = acquisitionIntents;
  const declareAcquisition = async (resource: string) => {
    const order = ['adb', 'simulator', 'backend', 'proxy', 'expo'];
    if (resource !== order[acquisitionIntents.length])
      throw new Error('Owned native acquisition order changed');
    await writeFile(
      path.join(output, `acquisition-${resource}.private.json`),
      JSON.stringify({
        schemaVersion: 1,
        kind: 'owned iOS acquisition intent',
        runId: path.basename(output),
        resource,
        previous: [...acquisitionIntents],
        startedAt: new Date().toISOString(),
      }),
      { flag: 'wx', mode: 0o600 },
    );
    acquisitionIntents.push(resource);
  };
  let reusable: Awaited<ReturnType<typeof loadReusableIosBuild>> | undefined;
  let incrementalCachePredecessor: IosIncrementalBuildCachePredecessor | undefined;
  let reservation!: Awaited<ReturnType<typeof reserveOwnedAppPort>>;
  let apiReservation: Awaited<ReturnType<typeof reserveOwnedAppPort>> | undefined;
  try {
    report.metroEntryPreflight = inspectNativeMetroEntry(root, 'ios');
    report.hostPreflight = await requireNativeHostAvailability(output);
    if (reuseBuildRunId)
      reusable = await loadReusableIosBuild(root, reuseBuildRunId, initialSource, {
        sourceRoot: reuseBuildSourceRoot,
      });
    if (incrementalBuildCacheSourceRoot) {
      incrementalCachePredecessor = await loadIosIncrementalBuildCachePredecessor(
        incrementalBuildCacheSourceRoot,
        initialSource,
      );
    }
    if (reusable && incrementalCachePredecessor)
      throw new Error(
        'Qualified app reuse and incremental compiler-cache handoff cannot be combined',
      );
    if (reusable) await verifyIosSimulatorApp(reusable.binaryPath, output);
    const resolvedNative = JSON.parse(
      (
        await execute(
          process.execPath,
          [
            'node_modules/expo-modules-autolinking/bin/expo-modules-autolinking',
            'resolve',
            '--platform',
            'apple',
            '--json',
          ],
          { cwd: root, timeout: 30_000 },
        )
      ).stdout,
    ) as Parameters<typeof assertIosNativeModuleRegistration>[0]['resolved'];
    assertIosNativeModuleRegistration({
      resolved: resolvedNative,
      lock: await readFile(path.join(root, 'ios/Podfile.lock'), 'utf8'),
      installed: await readFile(path.join(root, 'ios/Pods/Manifest.lock'), 'utf8'),
      provider: await readFile(
        path.join(root, 'ios/Pods/Target Support Files/Pods-mychampions/ExpoModulesProvider.swift'),
        'utf8',
      ),
    });
    const version = (await execute('maestro', ['--version'], { timeout: 30_000 })).stdout.trim();
    if (version !== '2.6.1') throw new Error('Native pilot requires pinned Maestro 2.6.1');
    report.toolVersions = { node: process.version, maestro: version };
    reservation = await reserveOwnedAppPort(
      reusable?.metroPort ?? incrementalCachePredecessor?.metroPort,
    );
    if (reusable) apiReservation = await reserveOwnedAppPort(reusable.apiPort);
    report.reservedPorts = [reservation.port, ...(apiReservation ? [apiReservation.port] : [])];
  } catch (error) {
    await reservation?.release();
    await apiReservation?.release();
    report.error = (error as Error).message;
    report.cleanup = 'not-acquired';
    report.result = cancellation() ? 'cancelled' : 'harness-blocked';
    const afterStateFailures: {
      surface: string;
      name: string;
      message: string;
    }[] = [];
    const boundedError = (cause: unknown) => ({
      name: cause instanceof Error ? cause.name.slice(0, 128) : 'UnknownError',
      message:
        cause instanceof Error
          ? cause.message.slice(0, 512)
          : 'iOS preflight after-state observation failed',
    });
    try {
      report.sourceAfter = await sourceIdentity(root);
    } catch (cause) {
      report.sourceAfter = null;
      afterStateFailures.push({ surface: 'source', ...boundedError(cause) });
    }
    try {
      report.helperInputsAfter = await helperIdentity();
    } catch (cause) {
      report.helperInputsAfter = null;
      afterStateFailures.push({ surface: 'helpers', ...boundedError(cause) });
    }
    try {
      const afterIosDevices = (
        await execute('xcrun', ['simctl', 'list', 'devices', '--json'], {
          timeout: 15_000,
        })
      ).stdout;
      JSON.parse(afterIosDevices);
      await writeFile(path.join(output, 'after-ios-devices.private.json'), afterIosDevices, {
        mode: 0o600,
        flag: 'wx',
      });
    } catch (cause) {
      afterStateFailures.push({
        surface: 'ios-devices',
        ...boundedError(cause),
      });
    }

    report.preflightAfterState = afterStateFailures.length === 0 ? 'observed' : 'unknown';
    report.preflightAfterStateFailures = afterStateFailures;
    beginPhase();
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(output, 'capture.private.json'), JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
    return {
      artifactRoot: output,
      exitCode: cancellation() === 'SIGINT' ? 130 : cancellation() === 'SIGTERM' ? 143 : 2,
      report,
    };
  }
  let device: Awaited<ReturnType<typeof acquireOwnedIosSimulator>> | undefined;
  let session: Awaited<ReturnType<typeof startOwnedSession>> | undefined;
  let proxy: Awaited<ReturnType<typeof startOwnedApiProxy>> | undefined;
  let app: Awaited<ReturnType<typeof startOwnedExpo>> | undefined;
  let adb: Awaited<ReturnType<typeof acquireAdbServerReference>> | undefined;
  let acquisitionFailureCleanup: OwnedSessionAcquisitionError['cleanup'] | undefined;
  let failed = false;
  let observationTimer: ReturnType<typeof setTimeout> | undefined;
  const wholeDeadlineAtMs = Math.min(
    options.deadlineAtMonotonicMs ?? Number.POSITIVE_INFINITY,
    performance.now() + Math.min(budget.totalMs, deadlines.wholeRunMs),
  );
  let observationDeadlineAtMs: number | undefined;
  const wholeTimer = setTimeout(
    () => {
      report.budgetTimeout = 'whole-capture';
      controller.abort(
        new NativeExecutionDeadlineError(
          'whole-capture',
          Math.min(budget.totalMs, deadlines.wholeRunMs),
        ),
      );
    },
    Math.max(0, wholeDeadlineAtMs - performance.now()),
  );
  const commandCleanupFailures: string[] = [];
  const commandExecutions: (NativeCommandExecution & {
    label: string;
    deadlineMs: number;
    command: string;
    argv: string[];
    flowSha256?: string;
    ownershipReceiptSha256?: string;
    startIdentity?: {
      pid: number;
      pgid: number;
      started: string;
      commandHash: string;
    };
  })[] = [];
  report.commandExecutions = commandExecutions;
  let incrementalBuildBinding: IosIncrementalBuildBinding | undefined;
  let incrementalBuildPreparation: IosIncrementalBuildCachePreparation | undefined;
  let localeExpectedBindingInputs:
    | {
        sourceTreeHash: string;
        helperInputs: typeof helperInputsBefore;
        target: NativeLocaleBinding['target'];
      }
    | undefined;
  let localeBinding: NativeLocaleBinding | undefined;
  let localeCapture:
    | {
        command: NativeLocaleCommandRead;
        hierarchyPath: string;
      }
    | undefined;
  const deviceHealth: {
    label: string;
    observedAt: string;
    udid: string;
    state: string;
    isAvailable: boolean;
  }[] = [];
  report.ownedDeviceHealthEvents = deviceHealth;
  const requireBooted = async (label: string) => {
    controller.signal.throwIfAborted();
    const actual = await device!.inspect(controller.signal);
    controller.signal.throwIfAborted();
    deviceHealth.push({
      label,
      observedAt: new Date().toISOString(),
      udid: actual.udid,
      state: actual.state,
      isAvailable: actual.isAvailable,
    });
    validateBootedIosDevice(device!, actual);
  };
  const run = async (
    label: string,
    command: string,
    argv: string[],
    env: NodeJS.ProcessEnv,
    timeoutMs: number,
  ): Promise<string> => {
    controller.signal.throwIfAborted();
    await requireNativeHostAvailabilityAtStep(output, label);
    controller.signal.throwIfAborted();
    if (path.basename(command) === 'maestro') {
      if (!adb) throw new Error('Maestro requires a declared session ADB reference');
      await adb.assertAlive(`before-${label}`);
    }
    const phase = label === 'build' ? 'build' : 'step';
    const deadlineMs = nativeCommandDeadline(timeoutMs, phase, deadlines);
    const result = await executeOwnedNativeCommand({
      command,
      argv,
      env,
      artifactRoot: output,
      label,
      cwd: root,
      deadlineMs,
      signal: controller.signal,
      phase,
    });
    commandExecutions.push({
      label,
      command,
      argv: [...argv],
      deadlineMs,
      ...result,
    });
    if (result.execution === 'deadline') report.deadline = { step: label, deadlineMs };
    if (result.cleanup !== 'cleaned' && result.cleanup !== 'not-acquired')
      commandCleanupFailures.push(label);
    if (
      options.executeTraining &&
      result.execution === 'child-failed' &&
      result.childExitCode === 1 &&
      result.childSignal === null &&
      result.cleanup === 'cleaned' &&
      command === 'maestro' &&
      !controller.signal.aborted
    ) {
      try {
        const commandsPath = await findMaestroQuantityFailureCommands(output, label);
        await requireBooted(`${label}-before-failure-diagnostic`);
        const healthy = await fetch(`${proxy!.origin}/health`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
        });
        if (healthy.status !== 200) throw new Error('Owned failure diagnostic API is unavailable');
        await writeFile(
          path.join(output, `${label}-failure-health.private.json`),
          JSON.stringify({
            kind: 'owned native failure diagnostic API health',
            captureRunId: path.basename(output),
            apiOrigin: proxy!.origin,
            status: healthy.status,
          }),
          { flag: 'wx', mode: 0o600 },
        );
        const hierarchyLog = await run(
          `${label}-failure-hierarchy`,
          'maestro',
          ['--no-ansi', '--udid', device!.udid, 'hierarchy'],
          env,
          120_000,
        );
        await requireBooted(`${label}-after-failure-diagnostic`);
        const hierarchyPath = `${label}-failure-hierarchy.json`;
        await writeFile(
          path.join(output, hierarchyPath),
          JSON.stringify(parseNativeHierarchy(await readFile(hierarchyLog, 'utf8'))),
          { flag: 'wx', mode: 0o600 },
        );
        const screenshotPath = `${label}-failure.png`;
        await execute(
          'xcrun',
          ['simctl', 'io', device!.udid, 'screenshot', path.join(output, screenshotPath)],
          { timeout: 30_000 },
        );
        await recordNativeQuantityFailure({
          root: output,
          label,
          commandsPath,
          hierarchyPath,
          screenshotPath,
        });
        report.applicationFailureCandidate = 'native-application-failure.private.json';
      } catch {
        // Ambiguous command/driver/selector/device evidence remains a harness block.
        report.applicationFailureCandidateUnavailable = true;
      }
    }
    if (result.execution !== 'completed' || result.cleanup !== 'cleaned' || !result.logPath)
      throw new Error(
        `Native ${label} execution=${result.execution} cleanup=${result.cleanup}; inspect command execution record`,
      );
    if (path.basename(command) === 'maestro') await adb!.assertAlive(`after-${label}`);
    return result.logPath;
  };
  const bindCredentialExecution = async (
    label: string,
    flowPath?: string,
  ): Promise<(typeof commandExecutions)[number]> => {
    const execution = commandExecutions.find((row) => row.label === label);
    if (!execution) throw new Error(`Credential command ${label} was not recorded`);
    if (!execution.ownershipPath)
      throw new Error(`Credential command ${label} has no ownership ledger`);
    const ownershipBytes = await readFile(execution.ownershipPath);
    const ledgerIdentity = bindIosCredentialEntryOwnedLedger(ownershipBytes, execution);
    execution.ownershipReceiptSha256 = ledgerIdentity.ownershipReceiptSha256;
    execution.startIdentity = ledgerIdentity.startIdentity;
    if (flowPath)
      execution.flowSha256 = createHash('sha256')
        .update(await readFile(flowPath))
        .digest('hex');
    return execution;
  };
  const readLocaleCommand = async (): Promise<
    NativeCommandExecution & { label: string; deadlineMs: number }
  > => {
    const label = 'locale-os-read';
    await requireNativeHostAvailabilityAtStep(output, label);
    await adb?.assertAlive(`before-${label}`);
    await device!.verify(controller.signal);
    await requireBooted(`before-${label}`);
    const deadlineMs = nativeCommandDeadline(15_000, 'step', deadlines);
    const stdoutPath = path.join(output, `${label}.stdout`);
    const result = await executeOwnedNativeCommand({
      command: 'xcrun',
      argv: ['simctl', 'spawn', device!.udid, 'defaults', 'read', 'NSGlobalDomain', 'AppleLocale'],
      env: process.env,
      artifactRoot: output,
      label,
      cwd: root,
      stdoutPath,
      deadlineMs,
      signal: controller.signal,
      phase: 'step',
    });
    const record = {
      label,
      command: 'xcrun',
      argv: ['simctl', 'spawn', device!.udid, 'defaults', 'read', 'NSGlobalDomain', 'AppleLocale'],
      deadlineMs,
      ...result,
    };
    commandExecutions.push(record);
    if (result.execution === 'deadline') report.deadline = { step: label, deadlineMs };
    if (result.cleanup !== 'cleaned' && result.cleanup !== 'not-acquired')
      commandCleanupFailures.push(label);
    if (
      result.execution === 'completed' &&
      result.cleanup === 'cleaned' &&
      !controller.signal.aborted
    ) {
      await device!.verify(controller.signal);
      await requireBooted(`after-${label}`);
    }
    return record;
  };
  const runLocaleProcessCensus = async (signal?: AbortSignal) => {
    signal?.throwIfAborted();
    await requireNativeHostAvailabilityAtStep(output, 'locale-quiescence');
    await device!.verify(signal ?? controller.signal);
    await requireBooted('locale-quiescence-before-command');
    const label = `locale-quiescence-${commandExecutions.length + 1}`;
    const stdoutPath = path.join(output, `${label}.stdout`);
    const argv = ['simctl', 'spawn', device!.udid, 'ps', '-axo', 'pid=,command='];
    const deadlineMs = nativeCommandDeadline(15_000, 'step', deadlines);
    const result = await executeOwnedNativeCommand({
      command: 'xcrun',
      argv,
      env: process.env,
      artifactRoot: output,
      label,
      cwd: root,
      stdoutPath,
      deadlineMs,
      signal: signal ?? controller.signal,
      phase: 'step',
    });
    commandExecutions.push({
      label,
      command: 'xcrun',
      argv,
      deadlineMs,
      ...result,
    });
    if (result.execution === 'deadline') report.deadline = { step: label, deadlineMs };
    if (result.cleanup !== 'cleaned' && result.cleanup !== 'not-acquired')
      commandCleanupFailures.push(label);
    if (result.execution === 'completed' && result.cleanup === 'cleaned')
      await requireBooted('locale-quiescence-after-command');
    return {
      execution: result.execution,
      cleanup: result.cleanup,
      attempted: result.pid !== null,
      pid: result.pid,
      pgid: result.pgid,
      logPath: result.logPath ?? '',
      stdoutPath: result.stdoutPath ?? stdoutPath,
      childExitCode: result.childExitCode,
      childSignal: result.childSignal,
      label,
      bindingCaptureRunId: captureRunId,
    };
  };
  try {
    await declareAcquisition('adb');
    adb = await acquireAdbServerReference({
      artifactRoot: output,
      mode: 'own-or-borrow',
      signal: controller.signal,
    });
    report.adbServer = adb.report;
    await declareAcquisition('simulator');
    device = await acquireOwnedIosSimulator({
      artifactRoot: output,
      deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
      signal: controller.signal,
      bootstatusDeadlineMs: options.bootstatusDeadlineMs,
    });
    report.device = {
      udid: device.udid,
      name: device.name,
      runtime: device.runtime,
      type: device.deviceTypeIdentifier,
      foreignBootedDevices: device.foreignBootedDevices,
    };
    await declareAcquisition('backend');
    session = await startOwnedSession({
      serverRoot: path.resolve(root, '../server'),
      appOrigin: reservation.origin,
      signal: controller.signal,
      deadlineMs: budget.totalMs,
    });
    const backendProcesses = structuredClone(session.manifest.processes);
    const backendReport: Record<string, unknown> = {
      runId: session.manifest.runId,
      composeProject: session.manifest.composeProject,
      artifactRoot: session.manifest.artifactRoot,
      processes: backendProcesses,
    };
    if (needsConnectionContext)
      Object.assign(
        backendReport,
        buildIosConnectionBackendProvenance({
          runId: session.manifest.runId,
          apiOrigin: session.apiOrigin,
          apiPid: session.apiPid,
          processes: backendProcesses,
        }),
      );
    report.backend = backendReport;
    await apiReservation?.release();
    await declareAcquisition('proxy');
    proxy = await startOwnedApiProxy({
      session,
      appOrigin: reservation.origin,
      requestProfile: 'native',
      requestedPort: reusable?.apiPort,
    });
    const fixtures = await session.fixtures('native-entry-ios');
    let connectionIsolationFixtures: OwnedFixtures | undefined;
    let cameraActiveActor: IosConnectionAccount = 'student';
    let cameraActiveAuthRequestId: number | undefined;
    const fixtureAuthUidAllowlistHash = createHash('sha256')
      .update(
        JSON.stringify(
          Object.values(fixtures.accounts)
            .map((account) => account.authUid)
            .sort(),
        ),
      )
      .digest('hex');
    report.fixtureAuthUidAllowlistHash = fixtureAuthUidAllowlistHash;
    const connectionIsolationScope = 'native-connection-isolation-ios' as const;
    const connectionApiIdentity: IosConnectionApiIdentity | undefined = needsConnectionContext
      ? { apiPid: session.apiPid, targetOrigin: session.apiOrigin }
      : undefined;
    if (needsConnectionContext) {
      connectionIsolationFixtures = await session.fixtures(connectionIsolationScope);
      const connectionProxy = proxy;
      if (!connectionProxy)
        throw new Error('Owned API proxy unavailable for camera/connection fixtures');
      if (!connectionApiIdentity)
        throw new Error('Camera/connection API identity is unavailable after backend acquisition');
      requireIosConnectionAuthIdentityCapture(connectionProxy);
      connectionProxy.enableNativeAuthIdentityCapture(
        Object.values(fixtures.accounts).map((account) => account.authUid),
      );
      if (cameraIntegration) {
        const isolationFixtureBytes = Buffer.from(JSON.stringify(connectionIsolationFixtures));
        const isolationFixturePath = 'fixtures-native-connection-isolation-ios.private.json';
        await writeFile(path.join(output, isolationFixturePath), isolationFixtureBytes, {
          flag: 'wx',
          mode: 0o600,
        });
        report.connectionIsolationFixtureEvidence = {
          path: isolationFixturePath,
          bytes: isolationFixtureBytes.length,
          sha256: createHash('sha256').update(isolationFixtureBytes).digest('hex'),
          source: 'owned-session.fixtures',
          runId: connectionIsolationFixtures.runId,
          scope: connectionIsolationFixtures.scope,
        };
      }
      report.connectionIsolationScope = connectionIsolationScope;
      report.connectionApiIdentity = { ...connectionApiIdentity };
      report.nativeLogoutContract = {
        requirementRefs: ['FR-270', 'BR-342'],
        scope: 'local-native-session-clear for camera/connection account switches',
        serverRevocationQualified: false,
      };
    }
    if (charter === 'session') {
      requireIosConnectionAuthIdentityCapture(proxy);
      proxy.enableNativeAuthIdentityCapture(
        Object.values(fixtures.accounts).map((account) => account.authUid),
      );
    }
    if (localeIntegration) {
      requireIosConnectionAuthIdentityCapture(proxy);
      proxy.enableNativeAuthIdentityCapture(
        Object.values(fixtures.accounts).map((account) => account.authUid),
      );
    }
    report.fixtureHash = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
    if (cameraIntegration || localeIntegration) {
      const fixtureBytes = Buffer.from(JSON.stringify(fixtures));
      await writeFile(path.join(output, 'fixtures.private.json'), fixtureBytes, {
        flag: 'wx',
        mode: 0o600,
      });
      report.fixtureEvidence = {
        path: 'fixtures.private.json',
        bytes: fixtureBytes.length,
        sha256: createHash('sha256').update(fixtureBytes).digest('hex'),
        source: 'owned-session.fixtures',
        runId: fixtures.runId,
        scope: fixtures.scope,
      };
    }
    await declareAcquisition('expo');
    app = await startOwnedExpo({
      clientRoot: root,
      artifactRoot: output,
      reservation,
      apiOrigin: proxy.origin,
      surface: 'native',
      signal: controller.signal,
    });
    const nativeEnv = {
      ...app.environment,
      RCT_METRO_PORT: String(reservation.port),
    };
    const derived = path.join(output, 'ios-build');
    beginPhase('build');
    if (!reusable) {
      const simulatorEntitlements = await writeSimulatorBuildEntitlements(output);
      const toolchain = await resolveIosIncrementalBuildToolchain();
      incrementalBuildBinding = buildIosIncrementalBuildBinding({
        source: initialSource,
        toolchain,
        metroPort: reservation.port,
        entitlementsSha256: await hashOwnedFile(simulatorEntitlements),
      });
      report.iosIncrementalBuildBinding = incrementalBuildBinding;
      if (incrementalCachePredecessor) {
        incrementalBuildPreparation = await prepareIosIncrementalBuildCache({
          predecessor: incrementalCachePredecessor,
          destinationRoot: output,
          currentBinding: incrementalBuildBinding,
          deadlineMs: budget.buildMs,
          artifactRoot: output,
        });
        report.incrementalBuildCacheHandoff = incrementalBuildPreparation;
      }
      const buildArgv = buildIosXcodebuildArguments({
        derivedDataPath: derived,
        deviceUdid: device.udid,
        entitlementsPath: simulatorEntitlements,
        metroPort: reservation.port,
      });
      await run('build', 'xcodebuild', buildArgv, nativeEnv, budget.buildMs);
    } else if (
      createHash('sha256').update(JSON.stringify(app.configExtra)).digest('hex') !==
        reusable.environmentHash ||
      proxy.origin !== reusable.apiOrigin ||
      app.origin !== reusable.metroOrigin
    ) {
      throw new Error('Reusable native build configuration/endpoints changed');
    }
    const binary =
      reusable?.binaryPath ??
      path.join(derived, 'Build/Products/Debug-iphonesimulator/mychampions.app');
    const bundleId = (
      await execute(
        '/usr/libexec/PlistBuddy',
        ['-c', 'Print :CFBundleIdentifier', path.join(binary, 'Info.plist')],
        { timeout: 5000 },
      )
    ).stdout.trim();
    if (bundleId !== 'com.edufelip.mychampions.dev')
      throw new Error('Native build metadata is not the expected dev app');
    const simulatorApp = await verifyIosSimulatorApp(binary, output);
    const binaryHash = await treeHash(binary);
    const localeTarget = {
      platform: 'ios' as const,
      deviceId: device.udid,
      osVersion: device.runtime,
      appId: bundleId,
      binaryHash,
      apiOrigin: proxy.origin,
    };
    const localeBuildBinding = buildNativeLocaleBinding({
      captureRunId,
      sourceTreeHash: initialSource.sourceTreeHash,
      helperInputs: structuredClone(helperInputsBefore),
      target: localeTarget,
    });
    localeBinding = localeBuildBinding;
    localeExpectedBindingInputs = {
      sourceTreeHash: initialSource.sourceTreeHash,
      helperInputs: structuredClone(helperInputsBefore),
      target: localeTarget,
    };
    report.build = {
      qualification: 'entry-observed',
      bundleId,
      binaryPath: binary,
      binaryHash,
      sourceTreeHash: initialSource.sourceTreeHash,
      helperInputsHash: localeBuildBinding.helperInputsHash,
      profile: 'Metro-attached Debug; not bundled release qualification',
      apiOrigin: proxy.origin,
      backendApiOrigin: session.apiOrigin,
      metroOrigin: app.origin,
      node: process.version,
      environmentHash: createHash('sha256').update(JSON.stringify(app.configExtra)).digest('hex'),
      reusedFrom: reusable?.sourceRunId ?? null,
    };
    report.installedBuild = {
      ...simulatorApp,
      binaryHash: await treeHash(binary),
    };

    const captureCredentialEntryDiagnostic = async (
      expectedEmail: string,
    ): Promise<Awaited<ReturnType<typeof collectIosCredentialEntryOwnedDiagnostic>>> => {
      if (!session) throw new Error('Credential diagnostic backend session is unavailable');
      if (!fixtures || fixtures.scope !== 'native-entry-ios')
        throw new Error('Credential diagnostic fixture scope is unavailable');
      const helperInputsHashBefore = createHash('sha256')
        .update(JSON.stringify(helperInputsBefore))
        .digest('hex');
      const backendProvenance = buildIosConnectionBackendProvenance({
        runId: session.manifest.runId,
        apiOrigin: session.apiOrigin,
        apiPid: session.apiPid,
        processes: session.manifest.processes,
      });
      const stageInputs: IosCredentialEntryOwnedStageInput[] = [];
      const commandByLabel = (label: string) =>
        commandExecutions.find((execution) => execution.label === label) ?? null;
      const statusAfterFailure = (
        execution: (typeof commandExecutions)[number] | null,
      ): 'failed' | 'blocked' => (execution?.execution === 'child-failed' ? 'failed' : 'blocked');
      const captureFrame = async (
        hierarchyLabel: string,
        screenshotLabel: string,
        fileStem: string,
      ): Promise<{
        hierarchy: unknown;
        hierarchyBytes: Buffer;
        hierarchyPath: string;
        screenshotBytes: Buffer;
        screenshotPath: string;
        hierarchyExecution: (typeof commandExecutions)[number];
        screenshotExecution: (typeof commandExecutions)[number];
      } | null> => {
        let hierarchyExecution: (typeof commandExecutions)[number] | null = null;
        let screenshotExecution: (typeof commandExecutions)[number] | null = null;
        try {
          await requireBooted(fileStem + '-before-hierarchy');
          const hierarchyLog = await run(
            hierarchyLabel,
            'maestro',
            ['--no-ansi', '--udid', device!.udid, 'hierarchy'],
            { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
            120_000,
          );
          hierarchyExecution = await bindCredentialExecution(hierarchyLabel);
          const actualTree = parseNativeHierarchy(await readFile(hierarchyLog, 'utf8'));
          const hierarchyBytes = Buffer.from(JSON.stringify(actualTree));
          const hierarchyPath = fileStem + '-hierarchy.json';
          await writeFile(path.join(output, hierarchyPath), hierarchyBytes, {
            flag: 'wx',
            mode: 0o600,
          });
          await requireBooted(fileStem + '-after-hierarchy');
          const screenshotPath = fileStem + '.png';
          await requireBooted(fileStem + '-before-screenshot');
          await run(
            screenshotLabel,
            'xcrun',
            ['simctl', 'io', device!.udid, 'screenshot', path.join(output, screenshotPath)],
            process.env,
            30_000,
          );
          screenshotExecution = await bindCredentialExecution(screenshotLabel);
          const screenshotBytes = await readFile(path.join(output, screenshotPath));
          await requireBooted(fileStem + '-after-screenshot');
          return {
            hierarchy: actualTree,
            hierarchyBytes,
            hierarchyPath,
            screenshotBytes,
            screenshotPath,
            hierarchyExecution,
            screenshotExecution,
          };
        } catch {
          return null;
        }
      };
      const appendStage = async (stage: {
        name: IosCredentialEntryOwnedStageInput['stage'];
        sequence: number;
        actions?: string;
      }): Promise<boolean> => {
        const actionLabel = stage.name === 'entry' ? null : 'credential-' + stage.name + '-action';
        const hierarchyLabel = 'credential-' + stage.name + '-hierarchy';
        const screenshotLabel = 'credential-' + stage.name + '-screenshot';
        const assertionLabel =
          stage.name === 'email-after-input' ? 'credential-email-after-input-assertion' : null;
        const assertionHierarchyLabel = 'credential-email-after-input-post-assertion-hierarchy';
        const assertionScreenshotLabel = 'credential-email-after-input-post-assertion-screenshot';
        let actionExecution: (typeof commandExecutions)[number] | null = null;
        let assertionExecution: (typeof commandExecutions)[number] | null = null;
        let hierarchyExecution: (typeof commandExecutions)[number] | null = null;
        let screenshotExecution: (typeof commandExecutions)[number] | null = null;
        let postAssertionHierarchyExecution: (typeof commandExecutions)[number] | null = null;
        let postAssertionScreenshotExecution: (typeof commandExecutions)[number] | null = null;
        let actionStatus: IosCredentialEntryOwnedStageInput['actionStatus'] = 'completed';
        let hierarchy: unknown = null;
        let hierarchyBytes: Buffer | null = null;
        let screenshotBytes: Buffer | null = null;
        let hierarchyPath: string | null = null;
        let screenshotPath: string | null = null;
        let postAssertionHierarchy: unknown = null;
        let postAssertionHierarchyBytes: Buffer | null = null;
        let postAssertionHierarchyPath: string | null = null;
        let postAssertionScreenshotBytes: Buffer | null = null;
        let postAssertionScreenshotPath: string | null = null;
        let actionFlowSha256: string | null = null;
        let assertionFlowSha256: string | null = null;
        let postAssertionHierarchyLabel: string | null = null;
        let postAssertionScreenshotLabel: string | null = null;

        if (stage.actions !== undefined) {
          const flowPath = path.join(output, stage.name + '.yaml');
          await writeFile(
            flowPath,
            'appId: ' +
              bundleId +
              '\nname: Owned credential diagnostic ' +
              stage.name +
              '\n---\n' +
              stage.actions +
              '\n',
            { flag: 'wx', mode: 0o600 },
          );
          await requireBooted(stage.name + '-before-action');
          try {
            await run(
              actionLabel!,
              'maestro',
              [
                '--no-ansi',
                '--udid',
                device!.udid,
                'test',
                '--debug-output',
                path.join(output, stage.name + '-debug'),
                '--test-output-dir',
                path.join(output, stage.name + '-artifacts'),
                flowPath,
              ],
              { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
              300_000,
            );
            actionExecution = await bindCredentialExecution(actionLabel!, flowPath);
            await requireBooted(stage.name + '-after-action');
            actionFlowSha256 = actionExecution.flowSha256 ?? null;
          } catch {
            actionExecution = commandByLabel(actionLabel!);
            if (actionExecution)
              actionExecution = await bindCredentialExecution(actionLabel!, flowPath);
            actionFlowSha256 = actionExecution?.flowSha256 ?? null;
            actionStatus = statusAfterFailure(actionExecution);
          }
        }

        if (actionStatus === 'completed') {
          const preFrame = await captureFrame(
            hierarchyLabel,
            screenshotLabel,
            'credential-' + stage.name,
          );
          if (preFrame) {
            hierarchy = preFrame.hierarchy;
            hierarchyBytes = preFrame.hierarchyBytes;
            hierarchyPath = preFrame.hierarchyPath;
            screenshotBytes = preFrame.screenshotBytes;
            screenshotPath = preFrame.screenshotPath;
            hierarchyExecution = preFrame.hierarchyExecution;
            screenshotExecution = preFrame.screenshotExecution;
          } else {
            const frameFailure = commandByLabel(hierarchyLabel) ?? commandByLabel(screenshotLabel);
            hierarchyExecution = null;
            screenshotExecution = null;
            actionStatus = statusAfterFailure(frameFailure);
          }
        }

        if (actionStatus === 'completed' && stage.name === 'email-after-input') {
          const assertionFlowPath = path.join(output, 'email-after-input-assertion.yaml');
          await writeFile(
            assertionFlowPath,
            'appId: ' +
              bundleId +
              '\nname: Owned credential exact email assertion\n---\n' +
              buildIosCredentialEntryDiagnosticAssertionActions(expectedEmail) +
              '\n',
            { flag: 'wx', mode: 0o600 },
          );
          await requireBooted('email-after-input-before-assertion');
          try {
            await run(
              assertionLabel!,
              'maestro',
              [
                '--no-ansi',
                '--udid',
                device!.udid,
                'test',
                '--debug-output',
                path.join(output, 'email-after-input-assertion-debug'),
                '--test-output-dir',
                path.join(output, 'email-after-input-assertion-artifacts'),
                assertionFlowPath,
              ],
              { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
              300_000,
            );
            assertionExecution = await bindCredentialExecution(assertionLabel!, assertionFlowPath);
            assertionFlowSha256 = assertionExecution.flowSha256 ?? null;
            await requireBooted('email-after-input-after-assertion');
          } catch {
            assertionExecution = commandByLabel(assertionLabel!);
            if (assertionExecution)
              assertionExecution = await bindCredentialExecution(
                assertionLabel!,
                assertionFlowPath,
              );
            assertionFlowSha256 = assertionExecution?.flowSha256 ?? null;
            actionStatus = statusAfterFailure(assertionExecution);
            postAssertionHierarchyLabel = assertionHierarchyLabel;
            postAssertionScreenshotLabel = assertionScreenshotLabel;
            const postFrame = await captureFrame(
              assertionHierarchyLabel,
              assertionScreenshotLabel,
              'email-after-input-post-assertion',
            );
            if (postFrame) {
              postAssertionHierarchy = postFrame.hierarchy;
              postAssertionHierarchyBytes = postFrame.hierarchyBytes;
              postAssertionHierarchyPath = postFrame.hierarchyPath;
              postAssertionScreenshotBytes = postFrame.screenshotBytes;
              postAssertionScreenshotPath = postFrame.screenshotPath;
              postAssertionHierarchyExecution = postFrame.hierarchyExecution;
              postAssertionScreenshotExecution = postFrame.screenshotExecution;
            }
          }
        }

        stageInputs.push({
          stage: stage.name,
          sequence: stage.sequence,
          actionKind:
            stage.name === 'entry'
              ? 'observation'
              : stage.name === 'email-after-tap'
                ? 'tap-email'
                : 'input-email',
          selector: stage.name === 'entry' ? null : 'auth.signIn.emailInput',
          actionStatus,
          actionLabel,
          hierarchyLabel,
          screenshotLabel,
          actionExecution,
          actionFlowSha256,
          assertionExecution,
          assertionLabel,
          assertionFlowSha256,
          hierarchyExecution,
          screenshotExecution,
          postAssertionHierarchyExecution,
          postAssertionScreenshotExecution,
          postAssertionHierarchyLabel,
          postAssertionScreenshotLabel,
          commandExecutions,
          hierarchy,
          hierarchyBytes,
          screenshotBytes,
          hierarchyPath,
          screenshotPath,
          postAssertionHierarchy,
          postAssertionHierarchyBytes,
          postAssertionHierarchyPath,
          postAssertionScreenshotBytes,
          postAssertionScreenshotPath,
          keyboard: 'unknown',
          appBoundary: 'unknown',
          expectedEmail,
        });
        return actionStatus === 'completed';
      };

      await appendStage({ name: 'entry', sequence: 0 });
      if (stageInputs[0]?.actionStatus === 'completed')
        await appendStage({
          name: 'email-after-tap',
          sequence: 1,
          actions: buildIosCredentialEntryDiagnosticTapActions(),
        });
      if (stageInputs[1]?.actionStatus === 'completed')
        await appendStage({
          name: 'email-after-input',
          sequence: 2,
          actions: buildIosCredentialEntryDiagnosticInputActions(expectedEmail),
        });

      const sourceAfter = await sourceIdentity(root);
      const helperInputsAfter = await helperIdentity();
      const helperInputsAfterHash = createHash('sha256')
        .update(JSON.stringify(helperInputsAfter))
        .digest('hex');
      requireIosCredentialEntryFreshness({
        sourceTreeHashBefore: initialSource.sourceTreeHash,
        sourceTreeHashAfter: sourceAfter.sourceTreeHash,
        helperInputsHashBefore,
        helperInputsHashAfter: helperInputsAfterHash,
      });
      const binding: IosCredentialEntryOwnedBinding = {
        captureRunId,
        fixtureRunId: fixtures.runId,
        fixtureScope: 'native-entry-ios',
        backendRunId: session.manifest.runId,
        backendAttemptId: backendProvenance.backendAttemptId,
        scope: 'native-entry-ios',
        semanticSelector: 'auth.signIn.emailInput',
        deviceId: device!.udid,
        runtime: device!.runtime,
        bundleId,
        binaryHash,
        sourceTreeHash: initialSource.sourceTreeHash,
        sourceTreeHashAfter: sourceAfter.sourceTreeHash,
        helperInputsHash: helperInputsHashBefore,
        helperInputsAfterHash,
        apiOrigin: session.apiOrigin,
        apiPid: session.apiPid,
      };
      const diagnostic = collectIosCredentialEntryOwnedDiagnostic(binding, stageInputs);
      const privateSidecar = Buffer.from(
        JSON.stringify(
          {
            kind: 'private-owned-ios-credential-entry-diagnostic-evidence',
            schemaVersion: 4,
            evidenceState: 'valid',
            valid: true,
            invalidation: null,
            binding,
            stages: diagnostic.receipts,
            result: diagnostic.result,
          },
          null,
          2,
        ),
      );
      const sidecarPath = 'credential-entry-diagnostic.private.json';
      await writeFile(path.join(output, sidecarPath), privateSidecar, {
        flag: 'wx',
        mode: 0o600,
      });
      report.credentialEntryDiagnostic = diagnostic.result;
      report.credentialEntryDiagnosticEvidence = {
        path: sidecarPath,
        bytes: privateSidecar.length,
        sha256: createHash('sha256').update(privateSidecar).digest('hex'),
        evidenceState: 'valid',
        valid: true,
        binding,
        stageCount: diagnostic.receipts.length,
      };
      return diagnostic;
    };
    beginPhase('install');
    observationDeadlineAtMs = Math.min(wholeDeadlineAtMs, performance.now() + budget.observationMs);
    observationTimer = setTimeout(
      () => {
        report.budgetTimeout = 'observations';
        controller.abort(new NativeExecutionDeadlineError('observations', budget.observationMs));
      },
      Math.max(0, observationDeadlineAtMs - performance.now()),
    );
    const coldResetStartedAt = new Date().toISOString();
    await device.verify(controller.signal);
    await run(
      'ios-install',
      'xcrun',
      ['simctl', 'install', device.udid, simulatorApp.binaryPath],
      process.env,
      60_000,
    );
    const installExecution = commandExecutions.at(-1);
    if (
      !installExecution ||
      installExecution.label !== 'ios-install' ||
      installExecution.execution !== 'completed' ||
      installExecution.cleanup !== 'cleaned' ||
      installExecution.pid === null
    )
      throw new Error('Owned iOS install did not produce a completed command ledger row');
    await execute(
      'xcrun',
      [
        'simctl',
        'spawn',
        device.udid,
        'defaults',
        'write',
        'NSGlobalDomain',
        'AppleLanguages',
        '-array',
        'en',
      ],
      { timeout: 15_000 },
    );
    await execute(
      'xcrun',
      [
        'simctl',
        'spawn',
        device.udid,
        'defaults',
        'write',
        'NSGlobalDomain',
        'AppleLocale',
        'en_US',
      ],
      { timeout: 15_000 },
    );
    const localeCommand = await readLocaleCommand();
    let localeStdoutText: string | null = null;
    if (localeCommand.stdoutPath) {
      try {
        localeStdoutText = readOwnedNativeLocaleStdout(
          output,
          path.basename(localeCommand.stdoutPath),
        );
      } catch {
        localeStdoutText = null;
      }
    }
    localeCapture = {
      command: {
        execution: localeCommand.execution,
        cleanup: localeCommand.cleanup,
        attempted: localeCommand.pid !== null,
        stdoutText: localeStdoutText,
      },
      hierarchyPath: 'entry-hierarchy.json',
    };
    if (options.coldReset) {
      controller.signal.throwIfAborted();
      await requireNativeHostAvailabilityAtStep(output, 'ios-get-app-container');
      const containerLabel = 'ios-get-app-container';
      const containerStdoutPath = path.join(output, 'ios-get-app-container.stdout');
      const containerDeadlineMs = nativeCommandDeadline(15_000, 'step', deadlines);
      const containerResult = await executeOwnedNativeCommand({
        command: 'xcrun',
        argv: ['simctl', 'get_app_container', device.udid, bundleId, 'data'],
        env: process.env,
        artifactRoot: output,
        label: containerLabel,
        cwd: root,
        stdoutPath: containerStdoutPath,
        deadlineMs: containerDeadlineMs,
        signal: controller.signal,
        phase: 'step',
      });
      commandExecutions.push({
        label: containerLabel,
        command: 'xcrun',
        argv: ['simctl', 'get_app_container', device.udid, bundleId, 'data'],
        deadlineMs: containerDeadlineMs,
        ...containerResult,
      });
      if (
        containerResult.execution !== 'completed' ||
        containerResult.cleanup !== 'cleaned' ||
        containerResult.pid === null ||
        containerResult.stdoutPath !== containerStdoutPath
      )
        throw new Error(
          'Owned iOS app-container lookup did not produce a completed command ledger row',
        );
      controller.signal.throwIfAborted();
      const installedContainerPath = (await readFile(containerStdoutPath, 'utf8')).trim();
      if (!installedContainerPath) throw new Error('Owned iOS app container path is missing');
      controller.signal.throwIfAborted();
      const proxyProcess = await inspectProcessIdentity(process.pid);
      if (!proxyProcess) throw new Error('Capture process ownership could not be observed');
      const ownerRunId = options.requestedRunId;
      if (!ownerRunId) throw new Error('Cold reset owner run ID is missing after owned preflight');
      const reset = await produceIosColdReset({
        expectation: options.coldReset,
        context: {
          outputRoot: output,
          captureRunId,
          ownerRunId,
          resetStartedAt: coldResetStartedAt,
          device,
          session,
          proxy,
          fixtures,
          build: {
            appId: bundleId,
            binaryHash,
            binaryPath: simulatorApp.binaryPath,
          },
          appState: {
            phase: 'installed-before-ui',
            appId: bundleId,
            installedContainerPath,
            installExecution: {
              execution: installExecution.execution,
              cleanup: installExecution.cleanup,
              pid: installExecution.pid,
            },
          },
          proxyProcess: {
            pid: proxyProcess.pid,
            started: proxyProcess.started,
            script: proxyProcess.command,
          },
          signal: controller.signal,
        },
      });
      report.coldReset = reset;
      report.coldResetEvidence = {
        path: path.relative(output, reset.receiptPath),
        sha256: reset.receiptHash,
        target: reset.target,
        backend: reset.backend,
        resourceCleanupStatus: 'deferred-to-capture-finalizer',
      };
    }
    await run(
      'app-launch',
      'xcrun',
      [
        'simctl',
        'launch',
        '--terminate-running-process',
        device.udid,
        bundleId,
        '-RCT_jsLocation',
        `localhost:${reservation.port}`,
      ],
      nativeEnv,
      30_000,
    );
    await execute(
      'xcrun',
      ['simctl', 'io', device.udid, 'screenshot', path.join(output, 'launched.png')],
      { timeout: 30_000, signal: controller.signal },
    );
    const readinessFlow = path.join(output, 'entry-readiness.yaml');
    beginPhase('scenario');
    await writeFile(
      readinessFlow,
      `appId: ${bundleId}\nname: Native entry readiness observation\n---\n- extendedWaitUntil:\n    visible:\n      id: auth.signIn.emailInput\n    timeout: 90000\n- assertVisible:\n    id: auth.signIn.passwordInput\n- assertVisible:\n    id: auth.signIn.submitButton\n`,
      { mode: 0o600 },
    );
    await requireBooted('entry-before-actions');
    await run(
      'entry-readiness',
      'maestro',
      [
        '--no-ansi',
        '--udid',
        device.udid,
        'test',
        '--debug-output',
        path.join(output, 'entry-debug'),
        '--test-output-dir',
        path.join(output, 'entry-artifacts'),
        readinessFlow,
      ],
      { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
      300_000,
    );
    await requireBooted('entry-after-actions');
    const hierarchy = await run(
      'entry-hierarchy',
      'maestro',
      ['--no-ansi', '--udid', device.udid, 'hierarchy'],
      { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
      300_000,
    );
    const tree = await readFile(hierarchy, 'utf8');
    const entryTree = parseNativeHierarchy(tree);
    const required = [
      'auth.signIn.emailInput',
      'auth.signIn.passwordInput',
      'auth.signIn.submitButton',
    ];
    if (!required.every((id) => nativeHierarchyHasAttribute(entryTree, 'resource-id', id)))
      throw new Error(
        'Native auth entry selectors absent from actual hierarchy; retain observation',
      );
    await requireBooted('entry-before-screenshot');
    await execute(
      'xcrun',
      ['simctl', 'io', device.udid, 'screenshot', path.join(output, 'entry.png')],
      { timeout: 30_000, signal: controller.signal },
    );
    report.viewIds = ['SCR-sign-in'];
    report.charter = charter;
    await writeFile(path.join(output, 'entry-hierarchy.json'), JSON.stringify(entryTree), {
      mode: 0o600,
    });
    if (iosNativeCharterUsesAuthPrelude(charter)) {
      const frames = [
        {
          viewId: 'SCR-sign-in',
          hierarchyPath: 'entry-hierarchy.json',
          screenshotPath: 'entry.png',
        },
      ];
      const buildCameraFrameSource = (input: {
        label: string;
        flowPath: string;
        hierarchyPath: string;
        screenshotPath: string;
        mode: IosCameraObservationMode;
      }) => {
        if (charter !== 'camera-denied' || input.mode !== 'authenticated-camera') return undefined;
        const backend = report.backend as { runId?: unknown };
        const deviceIdentity = report.device as { udid?: unknown };
        const authRequestId = requireIosCameraFrameAuthRequestId({
          mode: input.mode,
          authRequestId: cameraActiveAuthRequestId,
        });
        if (typeof backend.runId !== 'string' || typeof deviceIdentity.udid !== 'string')
          throw new Error('Camera frame source identity is unavailable');
        const rows = commandExecutions.filter((row) => row.label === `${input.label}-screenshot`);
        if (rows.length !== 1)
          throw new Error(`Camera screenshot command is not unique: ${input.label}`);
        const commandExecution = rows[0];
        const expectedArgv = [
          'simctl',
          'io',
          deviceIdentity.udid,
          'screenshot',
          path.join(output, input.screenshotPath),
        ];
        if (
          commandExecution.command !== 'xcrun' ||
          JSON.stringify(commandExecution.argv) !== JSON.stringify(expectedArgv) ||
          commandExecution.phase !== 'step' ||
          commandExecution.execution !== 'completed' ||
          commandExecution.cleanup !== 'cleaned' ||
          commandExecution.childExitCode !== 0 ||
          commandExecution.childSignal !== null ||
          !commandExecution.logPath ||
          !commandExecution.ownershipPath
        )
          throw new Error(
            `Camera screenshot command is not an owned completed step: ${input.label}`,
          );
        const flowBytes = readNativeEvidence(output, input.flowPath, true);
        const hierarchyBytes = readNativeEvidence(output, input.hierarchyPath, true);
        const screenshotBytes = readNativeEvidence(output, input.screenshotPath, false);
        return {
          label: input.label,
          actor: cameraActiveActor,
          actorAuthUid: fixtures.accounts[cameraActiveActor].authUid,
          authRequestId,
          flowReference: {
            path: input.flowPath,
            bytes: flowBytes.length,
            sha256: createHash('sha256').update(flowBytes).digest('hex'),
            source: 'owned-maestro-flow',
            runId: backend.runId,
            scope: 'native-entry-ios',
          },
          hierarchyReference: {
            path: input.hierarchyPath,
            bytes: hierarchyBytes.length,
            sha256: createHash('sha256').update(hierarchyBytes).digest('hex'),
            source: 'owned-maestro-hierarchy',
            runId: backend.runId,
            scope: 'native-entry-ios',
          },
          screenshotReference: {
            path: input.screenshotPath,
            bytes: screenshotBytes.length,
            sha256: createHash('sha256').update(screenshotBytes).digest('hex'),
            source: 'owned-xcrun-simctl-screenshot',
            runId: backend.runId,
            scope: 'native-entry-ios',
            deviceUdid: deviceIdentity.udid,
            commandLabel: commandExecution.label,
            commandExecution: {
              label: commandExecution.label,
              command: commandExecution.command,
              argv: commandExecution.argv,
              phase: commandExecution.phase,
              execution: commandExecution.execution,
              cleanup: commandExecution.cleanup,
              childExitCode: commandExecution.childExitCode,
              childSignal: commandExecution.childSignal,
              deadlineMs: commandExecution.deadlineMs,
              logPath: commandExecution.logPath,
              ownershipPath: commandExecution.ownershipPath,
            },
          },
        };
      };
      report.observations = frames;
      const observe = async (
        label: string,
        actions: string,
        viewId: string,
        selector: string | string[],
        selectorKind: 'id' | 'text' = 'id',
        notVisibleSelectors: readonly string[] = [],
        cameraFrameMode: IosCameraObservationMode = 'generic',
      ) => {
        await requireBooted(`${label}-before-actions`);
        const selectors = typeof selector === 'string' ? [selector] : selector;
        const primary = selectors[0];
        const flow = path.join(output, `${label}.yaml`);
        await writeFile(
          flow,
          `appId: ${bundleId}\nname: Native inventory ${label}\n---\n${actions}\n- extendedWaitUntil:\n    visible:\n      ${selectorKind}: ${JSON.stringify(selectorKind === 'text' ? '^' + primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$' : primary)}\n    timeout: 90000\n` +
            selectors
              .slice(1)
              .map((id) => `- assertVisible:\n    id: ${JSON.stringify(id)}\n`)
              .join('') +
            notVisibleSelectors
              .map((id) => `- assertNotVisible:\n    id: ${JSON.stringify(id)}\n`)
              .join(''),
          { mode: 0o600 },
        );
        await run(
          label,
          'maestro',
          [
            '--no-ansi',
            '--udid',
            device!.udid,
            'test',
            '--debug-output',
            path.join(output, `${label}-debug`),
            '--test-output-dir',
            path.join(output, `${label}-artifacts`),
            flow,
          ],
          { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
          300_000,
        );
        await requireBooted(`${label}-after-actions`);
        const frameTree = await run(
          `${label}-hierarchy`,
          'maestro',
          ['--no-ansi', '--udid', device!.udid, 'hierarchy'],
          { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
          120_000,
        );
        await requireBooted(`${label}-before-screenshot`);
        const screenshotPath = path.join(output, `${label}.png`);
        const screenshot =
          charter === 'session'
            ? await sessionExecute(
                `${label}-screenshot`,
                'xcrun',
                ['simctl', 'io', device!.udid, 'screenshot', screenshotPath],
                { timeout: 30_000 },
              )
            : charter === 'camera-denied'
              ? await run(
                  `${label}-screenshot`,
                  'xcrun',
                  ['simctl', 'io', device!.udid, 'screenshot', screenshotPath],
                  process.env,
                  30_000,
                )
              : await execute(
                  'xcrun',
                  ['simctl', 'io', device!.udid, 'screenshot', screenshotPath],
                  {
                    timeout: 30_000,
                  },
                );
        void screenshot;
        const actualTree = parseNativeHierarchy(
          charter === 'session'
            ? await sessionReadText(`${label}-hierarchy-read`, frameTree)
            : await readFile(frameTree, 'utf8'),
        );
        if (
          !selectors.every((id) =>
            nativeHierarchyHasAttribute(
              actualTree,
              selectorKind === 'id' ? 'resource-id' : 'accessibilityText',
              id,
            ),
          )
        )
          throw new Error(`Native ${label} selector absent from actual tree`);
        if (
          notVisibleSelectors.some((id) =>
            nativeHierarchyHasAttribute(actualTree, 'resource-id', id),
          )
        )
          throw new Error(`Native ${label} retained a prohibited selector after the action`);
        const canonicalTree = `${label}-hierarchy.json`;
        if (charter === 'session')
          await sessionWriteText(
            `${label}-hierarchy-write`,
            path.join(output, canonicalTree),
            JSON.stringify(actualTree),
            { mode: 0o600 },
          );
        else
          await writeFile(path.join(output, canonicalTree), JSON.stringify(actualTree), {
            mode: 0o600,
          });
        assertNativeBootstrapHealthy(app!.diagnostics);
        const relativeScreenshotPath = path.relative(output, screenshotPath);
        const cameraFrameSource = shouldAttachIosCameraFrameSource({
          charter,
          mode: cameraFrameMode,
        })
          ? buildCameraFrameSource({
              label,
              flowPath: path.relative(output, flow),
              hierarchyPath: canonicalTree,
              screenshotPath: relativeScreenshotPath,
              mode: cameraFrameMode,
            })
          : undefined;
        frames.push({
          label,
          viewId,
          hierarchyPath: canonicalTree,
          screenshotPath: relativeScreenshotPath,
          ...(cameraFrameSource ? cameraFrameSource : {}),
          ...(notVisibleSelectors.length > 0
            ? { notVisibleSelectors: [...notVisibleSelectors] }
            : {}),
        });
        report.viewIds = [...new Set(['SCR-sign-in', ...frames.map((frame) => frame.viewId)])];
      };
      const observeCamera = async (
        label: string,
        actions: string,
        viewId: string,
        selector: string | string[],
        selectorKind: 'id' | 'text' = 'id',
        notVisibleSelectors: readonly string[] = [],
      ) =>
        observe(
          label,
          actions,
          viewId,
          selector,
          selectorKind,
          notVisibleSelectors,
          'authenticated-camera',
        );
      const observePostTapDiagnostic = async (label: string, actions: string) => {
        await requireBooted(`${label}-before-actions`);
        const flow = path.join(output, `${label}.yaml`);
        await writeFile(
          flow,
          `appId: ${bundleId}\nname: Native inventory ${label}\n---\n${actions}\n`,
          { mode: 0o600, flag: 'wx' },
        );
        await run(
          label,
          'maestro',
          [
            '--no-ansi',
            '--udid',
            device!.udid,
            'test',
            '--debug-output',
            path.join(output, `${label}-debug`),
            '--test-output-dir',
            path.join(output, `${label}-artifacts`),
            flow,
          ],
          { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
          300_000,
        );
        await requireBooted(`${label}-after-actions`);
        const frameTree = await run(
          `${label}-hierarchy`,
          'maestro',
          ['--no-ansi', '--udid', device!.udid, 'hierarchy'],
          { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
          120_000,
        );
        await requireBooted(`${label}-before-screenshot`);
        const screenshotPath = path.join(output, `${label}.png`);
        await execute('xcrun', ['simctl', 'io', device!.udid, 'screenshot', screenshotPath], {
          timeout: 30_000,
        });
        const actualTree = parseNativeHierarchy(await readFile(frameTree, 'utf8'));
        const canonicalTree = `${label}-hierarchy.json`;
        const canonicalTreePath = path.join(output, canonicalTree);
        await writeFile(canonicalTreePath, JSON.stringify(actualTree), {
          mode: 0o600,
          flag: 'wx',
        });
        const screenshotBytes = await readFile(screenshotPath);
        const hierarchyBytes = await readFile(canonicalTreePath);
        return {
          label,
          flowPath: path.relative(output, flow),
          hierarchyPath: canonicalTree,
          screenshotPath: path.relative(output, screenshotPath),
          hierarchyHash: createHash('sha256').update(hierarchyBytes).digest('hex'),
          screenshotHash: createHash('sha256').update(screenshotBytes).digest('hex'),
          selectorPresence: {
            accountScreen: nativeHierarchyHasAttribute(
              actualTree,
              'resource-id',
              'settings.account.screen',
            ),
            signOutCta: nativeHierarchyHasAttribute(
              actualTree,
              'resource-id',
              'settings.account.signOutCta',
            ),
            signOutConfirm: nativeHierarchyHasAttribute(
              actualTree,
              'resource-id',
              'settings.account.signOutConfirm',
            ),
            signOutConfirmCta: nativeHierarchyHasAttribute(
              actualTree,
              'resource-id',
              'settings.account.signOutConfirmCta',
            ),
          },
        };
      };
      const listFiles = async (directory: string): Promise<string[]> => {
        const entries = await readdir(directory, { withFileTypes: true });
        const files: string[] = [];
        for (const entry of entries) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) files.push(...(await listFiles(target)));
          else if (entry.isFile()) files.push(target);
        }
        return files;
      };
      const observeConnectionPasswordOffer = async (
        label: string,
        actor: IosConnectionAccount,
        credentialActions: string,
        viewId: string,
        homeSelector: string,
        beforeRequestId: number,
      ) => {
        await requireBooted(`${label}-before-actions`);
        const promptScreenshotName = `${label}-password-offer`;
        const flow = path.join(output, `${label}.yaml`);
        await writeFile(
          flow,
          `appId: ${bundleId}\nname: Native connection ${label}\n---\n${buildIosConnectionPasswordOfferActions(
            credentialActions,
            promptScreenshotName,
            homeSelector,
          )}\n`,
          { mode: 0o600 },
        );
        await run(
          label,
          'maestro',
          [
            '--no-ansi',
            '--udid',
            device!.udid,
            'test',
            '--debug-output',
            path.join(output, `${label}-debug`),
            '--test-output-dir',
            path.join(output, `${label}-artifacts`),
            flow,
          ],
          { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
          300_000,
        );
        await requireBooted(`${label}-after-actions`);
        const artifactDirectory = path.join(output, `${label}-artifacts`);
        const artifactFiles = await listFiles(artifactDirectory);
        const commandFiles = artifactFiles.filter(
          (candidate) =>
            path.basename(candidate).startsWith('commands-') && candidate.endsWith('.json'),
        );
        if (commandFiles.length !== 1)
          throw new Error(`Connection ${label} command metadata is not unique`);
        const promptFiles = artifactFiles.filter(
          (candidate) => path.basename(candidate) === `${promptScreenshotName}.png`,
        );
        if (promptFiles.length !== 1)
          throw new Error(`Connection ${label} prompt screenshot is not unique`);
        const commandMetadataPath = nativeConnectionPasswordOfferCommandMetadataPath(label);
        const promptScreenshotPath = nativeConnectionPasswordOfferPromptScreenshotPath(label);
        await copyFile(commandFiles[0], path.join(output, commandMetadataPath));
        await chmod(path.join(output, commandMetadataPath), 0o600);
        await copyFile(promptFiles[0], path.join(output, promptScreenshotPath));
        await chmod(path.join(output, promptScreenshotPath), 0o600);
        const commandBytes = await readFile(path.join(output, commandMetadataPath));
        const promptBytes = await readFile(path.join(output, promptScreenshotPath));
        const signInPathHash = createHash('sha256').update('/auth/email/sign-in').digest('hex');
        const signInRows = proxy!.observations.filter(
          (row) =>
            row.pathHash === signInPathHash &&
            row.requestId > beforeRequestId &&
            row.status === 201 &&
            row.outcome === 'forwarded' &&
            row.requestProfile === 'native',
        );
        if (signInRows.length !== 1)
          throw new Error(`Connection ${label} native sign-in request is not unique`);
        const signIn = signInRows[0];
        const witness = {
          kind: 'private-native-connection-password-offer-witness',
          schemaVersion: 1,
          actor,
          flowLabel: label,
          actorAuthUid: fixtures.accounts[actor].authUid,
          signInRequestOrdinal: proxy!.observations.filter(
            (row) => row.pathHash === signInPathHash && row.requestId <= signIn.requestId,
          ).length,
          authRequestId: signIn.requestId,
          commandMetadataPath,
          commandMetadataSha256: createHash('sha256').update(commandBytes).digest('hex'),
          commandMetadataBytes: commandBytes.length,
          promptScreenshotPath,
          promptScreenshotSha256: createHash('sha256').update(promptBytes).digest('hex'),
          promptScreenshotBytes: promptBytes.length,
          promptSelector: '^Save Password\\?$',
          dismissSelector: '^Not Now$',
          dismissEnabled: true,
          retryTapIfNoChange: true,
          promptAbsenceAsserted: true,
          steps: [
            'prompt-visible',
            'prompt-screenshot',
            'dismiss-visible-enabled',
            'dismiss-animation-settled',
            'dismiss-tap',
            'prompt-absent',
            'home-visible',
          ],
          nativePassingCases: 0,
        } as const;
        await requireNativeConnectionPasswordOfferWitness(witness, {
          artifactRoot: output,
          actor,
          flowLabel: label,
          actorAuthUid: fixtures.accounts[actor].authUid,
          signInRequestOrdinal: witness.signInRequestOrdinal,
          authRequestId: signIn.requestId,
          homeSelector,
        });
        const frameTree = await run(
          `${label}-hierarchy`,
          'maestro',
          ['--no-ansi', '--udid', device!.udid, 'hierarchy'],
          { ...process.env, MAESTRO_CLI_NO_ANALYTICS: 'true' },
          120_000,
        );
        await requireBooted(`${label}-before-screenshot`);
        const screenshotPath = path.join(output, `${label}.png`);
        await execute('xcrun', ['simctl', 'io', device!.udid, 'screenshot', screenshotPath], {
          timeout: 30_000,
        });
        const actualTree = parseNativeHierarchy(await readFile(frameTree, 'utf8'));
        if (!nativeHierarchyHasAttribute(actualTree, 'resource-id', homeSelector))
          throw new Error(`Native ${label} home selector absent from actual tree`);
        const canonicalTree = `${label}-hierarchy.json`;
        await writeFile(path.join(output, canonicalTree), JSON.stringify(actualTree), {
          mode: 0o600,
        });
        assertNativeBootstrapHealthy(app!.diagnostics);
        frames.push({
          viewId,
          hierarchyPath: canonicalTree,
          screenshotPath: path.relative(output, screenshotPath),
        });
        report.viewIds = [...new Set(['SCR-sign-in', ...frames.map((frame) => frame.viewId)])];
        const previousWitnesses = Array.isArray(report.connectionPasswordOfferWitnesses)
          ? (report.connectionPasswordOfferWitnesses as unknown[])
          : [];
        report.connectionPasswordOfferWitnesses = [...previousWitnesses, witness];
      };
      const assertSessionIoActive = (label: string) => {
        if (charter === 'session') controller.signal.throwIfAborted();
        void label;
      };
      const sessionDirectIo = async <T>(
        label: string,
        operation: () => T | PromiseLike<T>,
      ): Promise<T> => {
        assertSessionIoActive(`${label}-before`);
        const value = await operation();
        assertSessionIoActive(`${label}-after`);
        return value;
      };
      const sessionExecute = (
        label: string,
        command: string,
        argv: string[],
        options: { timeout?: number; maxBuffer?: number } = {},
      ) =>
        sessionDirectIo(label, () =>
          execute(command, argv, { ...options, signal: controller.signal }),
        );
      const sessionReadText = (label: string, file: string) =>
        sessionDirectIo(label, () =>
          readFile(file, { encoding: 'utf8', signal: controller.signal }),
        );
      const sessionWriteText = (
        label: string,
        file: string,
        data: string | Uint8Array,
        options: { mode?: number; flag?: string } = {},
      ) =>
        sessionDirectIo(label, () =>
          writeFile(file, data, { ...options, signal: controller.signal }),
        );
      const sessionReadEvidence = (label: string, relative: string, privateRecord = false) => {
        assertSessionIoActive(`${label}-before`);
        const bytes = readNativeEvidence(output, relative, privateRecord);
        assertSessionIoActive(`${label}-after`);
        return bytes;
      };
      const observeSessionPostTapDiagnostic = (label: string, actions: string) =>
        observeIosSessionPostTapDiagnostic({
          label,
          actions,
          output,
          bundleId,
          deviceUdid: device!.udid,
          signal: controller.signal,
          requireBooted,
          writeText: sessionWriteText,
          run,
          execute: sessionExecute,
          readEvidence: sessionReadEvidence,
          parseHierarchy: (text) => parseNativeHierarchy(text),
          hasAttribute: nativeHierarchyHasAttribute,
        });
      const sessionSnapshot = (label: string) =>
        sessionDirectIo(label, () => session!.snapshot('native-entry-ios'));
      const sessionAuthMetadata = (label: string, dataContainer: string) =>
        sessionDirectIo(label, () =>
          observeIosAuthMetadata(dataContainer, bundleId, controller.signal),
        );
      type SessionCheckpointReceipt = {
        path: string;
        runId: string;
        scope: string;
        sha256: string;
        bytes: number;
        ownedRunId: string;
        fixtureScope: string;
        artifactRoot: string;
        apiPid: number;
        targetOrigin: string;
        fixtureAuthUidAllowlistHash: string;
      };
      const persistSessionCheckpoint = async (
        label: string,
        relative: string,
        value: OwnedConnectionSnapshot | OwnedDomainSnapshot,
      ): Promise<{
        value: OwnedConnectionSnapshot | OwnedDomainSnapshot;
        receipt: SessionCheckpointReceipt;
      }> => {
        const bytes = JSON.stringify(value, null, 2);
        await sessionWriteText(label + '-write', path.join(output, relative), bytes, {
          mode: 0o600,
          flag: 'wx',
        });
        const ownedBytes = sessionReadEvidence(label + '-read', relative, true);
        const parsed = JSON.parse(ownedBytes.toString()) as
          OwnedConnectionSnapshot | OwnedDomainSnapshot;
        if (JSON.stringify(parsed) !== JSON.stringify(value))
          throw new Error(`${label} changed during owned readback`);
        return {
          value: parsed,
          receipt: {
            path: relative,
            runId: parsed.runId,
            scope: parsed.scope,
            sha256: createHash('sha256').update(ownedBytes).digest('hex'),
            bytes: ownedBytes.length,
            ownedRunId: session!.manifest.runId,
            fixtureScope: 'native-entry-ios',
            artifactRoot: session!.manifest.artifactRoot,
            apiPid: session!.apiPid,
            targetOrigin: session!.apiOrigin,
            fixtureAuthUidAllowlistHash,
          },
        };
      };
      const sessionPersistedCoachIdentityHash = async (label: string, dataContainer: string) => {
        const metadata = await sessionAuthMetadata(label, dataContainer);
        const hash = (metadata as { profileAuthUidHash?: unknown }).profileAuthUidHash;
        if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))
          throw new Error(`${label} lacks the redacted persisted coach profile identity hash`);
        return hash;
      };
      const sessionDeviceVerify = (label: string) =>
        sessionDirectIo(label, () => device!.verify(controller.signal));
      const buildIosConnectionRuntimeContext = (
        input: Omit<IosConnectionRuntimeContext, 'switchAccount'>,
      ): IosConnectionRuntimeContext => {
        requireIosConnectionAuthIdentityCapture(input.proxy);
        let switchOrdinal = 0;
        const signOutInitialActions =
          '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutCta';
        const signOutConfirmationActions =
          '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutConfirmCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutConfirmCta';
        return {
          ...input,
          switchAccount: async (actor, backActions = '') => {
            const ordinal = ++switchOrdinal;
            const label = `connection-switch-${ordinal}-${actor}`;
            await observe(
              `${label}-account`,
              buildIosConnectionAccountSwitchActions(backActions),
              'SCR-account',
              'settings.account.screen',
            );
            await observeIosConnectionSignOutWithDiagnostic({
              label,
              initialActions: signOutInitialActions,
              confirmationActions: signOutConfirmationActions,
              report: input.report,
              observe: input.observe,
              observePostTapDiagnostic,
            });
            const beforeRequestId = input.proxy.observations.reduce(
              (maximum, row) => Math.max(maximum, row.requestId),
              0,
            );
            const actorCredentials = fixtures.accounts[actor];
            await observeConnectionPasswordOffer(
              `${label}-home`,
              actor,
              buildIosCredentialEntryActions(actorCredentials.email, actorCredentials.password),
              actor === 'coach' ? 'SCR-pro-home' : 'SCR-student-home',
              actor === 'coach' ? 'pro.home.screen' : 'student.home.screen',
              beforeRequestId,
            );
            const boundary = requireIosConnectionSignInBoundary(
              input.proxy.observations,
              beforeRequestId,
            );
            const actorAuthUid = requireIosConnectionActorIdentity(
              input.proxy.nativeAuthIdentities,
              {
                actorAuthUid: actorCredentials.authUid,
                authRequestId: boundary.authRequestId,
                apiIdentity: input.apiIdentity,
                fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
              },
            );
            const result: IosConnectionAccountSwitchResult = {
              actor,
              actorAuthUid,
              ...boundary,
            };
            const previous = Array.isArray(input.report.connectionAccountSwitches)
              ? (input.report.connectionAccountSwitches as unknown[])
              : [];
            input.report.connectionAccountSwitches = [...previous, result];
            if (cameraIntegration) {
              cameraActiveActor = actor;
              cameraActiveAuthRequestId = boundary.authRequestId;
            }
            return result;
          },
        };
      };
      const credentials =
        charter === 'camera-denied'
          ? fixtures.accounts[cameraIntegration ? 'student' : 'unrelated-student']
          : fixtures.accounts.coach;
      let cameraInitialAuthBeforeRequestId: number | undefined;
      let sessionProfileBeforeLogin: OwnedConnectionSnapshot | undefined;
      let sessionProfileAfterLogin: OwnedConnectionSnapshot | undefined;
      let sessionProfileAfterRestoration: OwnedConnectionSnapshot | undefined;
      let sessionProfileAfterSignedOutRelaunch: OwnedConnectionSnapshot | undefined;
      let sessionDomainAfterLogin: OwnedDomainSnapshot | undefined;
      let sessionDomainAfterRestoration: OwnedDomainSnapshot | undefined;
      let sessionDomainAfterSignedOutRelaunch: OwnedDomainSnapshot | undefined;
      let sessionProfileSnapshotReceipts: Record<string, SessionCheckpointReceipt> | undefined;
      let sessionDomainSnapshotReceipts: Record<string, SessionCheckpointReceipt> | undefined;
      let sessionDataContainer: string | undefined;
      let sessionLoginBeforeRequestId = 0;
      let sessionLoginWindow: { afterRequestId: number; throughRequestId: number } | undefined;
      let sessionRestorationWindow:
        { afterRequestId: number; throughRequestId: number } | undefined;
      let afterLoginAuthUidHash: string | undefined;
      let afterRestorationAuthUidHash: string | undefined;
      const sessionSqlBefore =
        charter === 'session' ? await sessionSnapshot('session-sql-before-snapshot') : undefined;
      if (sessionSqlBefore) {
        const sessionSqlBeforeBytes = JSON.stringify(sessionSqlBefore, null, 2);
        if (charter === 'session')
          await sessionWriteText(
            'session-sql-before-write',
            path.join(output, 'session-sql-before.private.json'),
            sessionSqlBeforeBytes,
            { mode: 0o600, flag: 'wx' },
          );
        else
          await writeFile(
            path.join(output, 'session-sql-before.private.json'),
            sessionSqlBeforeBytes,
            { mode: 0o600, flag: 'wx' },
          );
        const ownedSessionSqlBeforeBytes =
          charter === 'session'
            ? sessionReadEvidence(
                'session-sql-before-read',
                'session-sql-before.private.json',
                true,
              )
            : readNativeEvidence(output, 'session-sql-before.private.json', true);
        report.sessionSqlBefore = {
          path: 'session-sql-before.private.json',
          runId: sessionSqlBefore.runId,
          scope: sessionSqlBefore.scope,
          sha256: createHash('sha256').update(ownedSessionSqlBeforeBytes).digest('hex'),
          bytes: ownedSessionSqlBeforeBytes.length,
          ownedRunId: session.manifest.runId,
          fixtureScope: 'native-entry-ios',
          artifactRoot: session.manifest.artifactRoot,
          apiPid: session.apiPid,
          targetOrigin: session.apiOrigin,
          fixtureAuthUidAllowlistHash,
        };
        if (charter === 'session') {
          sessionProfileBeforeLogin = await sessionDirectIo(
            'session-profile-before-login-snapshot',
            () => session!.connectionSnapshot('native-entry-ios'),
          );
          const before = await persistSessionCheckpoint(
            'session-profile-before-login',
            'session-profile-before-login.private.json',
            sessionProfileBeforeLogin,
          );
          sessionProfileBeforeLogin = before.value as OwnedConnectionSnapshot;
          sessionProfileSnapshotReceipts = { beforeLogin: before.receipt };
          const domainBefore = await persistSessionCheckpoint(
            'session-domain-before-login',
            'session-domain-before-login.private.json',
            sessionSqlBefore,
          );
          report.sessionDomainSnapshotReceipts = {
            beforeLogin: domainBefore.receipt,
          };
          sessionDomainSnapshotReceipts = { beforeLogin: domainBefore.receipt };
          sessionLoginBeforeRequestId = proxy.requestIdFence;
        }
      }
      if (localeIntegration) {
        if (!options.locale || !localeBinding || !localeExpectedBindingInputs)
          throw new Error('Locale capture binding inputs were not established by the owned build');
        const build = report.build as {
          qualification: 'entry-observed' | 'runtime-qualified';
          sourceTreeHash: string;
          helperInputsHash: string;
          binaryHash: string;
          bundleId: 'com.edufelip.mychampions.dev';
          apiOrigin: string;
          backendApiOrigin: string;
          reusedFrom: string | null;
        };
        const verifyLocaleTarget = async (signal?: AbortSignal) => {
          signal?.throwIfAborted();
          await device!.verify(signal ?? controller.signal);
          await requireBooted('locale-target');
          signal?.throwIfAborted();
        };
        const beforeLocaleCommand = async (
          label: string,
          command: 'xcrun' | 'maestro',
          signal?: AbortSignal,
        ) => {
          signal?.throwIfAborted();
          await requireNativeHostAvailabilityAtStep(output, `locale-before-${label}`);
          if (command === 'maestro') await adb!.assertAlive(`locale-before-${label}`);
          await verifyLocaleTarget(signal);
        };
        const afterLocaleCommand = async (
          label: string,
          command: 'xcrun' | 'maestro',
          signal?: AbortSignal,
        ) => {
          signal?.throwIfAborted();
          if (command === 'maestro') await adb!.assertAlive(`locale-after-${label}`);
          await verifyLocaleTarget(signal);
        };
        const localeProbe = createIosLocaleQuiescenceProbe({
          artifactRoot: output,
          captureRunId,
          deviceId: device.udid,
          bundleId,
          bindingCaptureRunId: localeBinding.captureRunId,
          runProcessCensus: runLocaleProcessCensus,
        });
        const wiringInput: IosLocaleCaptureWiringInput = {
          artifactRoot: output,
          sourceRoot: root,
          cwd: root,
          output,
          captureRunId,
          binding: localeBinding,
          device: { udid: device.udid, runtime: device.runtime },
          metroPort: reservation.port,
          build,
          signal: controller.signal,
          effectiveCommandDeadline: (requestedMs) =>
            nativeCommandDeadline(requestedMs, 'step', deadlines),
          verifyTarget: verifyLocaleTarget,
          beforeCommand: beforeLocaleCommand,
          afterCommand: afterLocaleCommand,
          env: nativeEnv,
          fixtures: {
            runId: fixtures.runId,
            scope: fixtures.scope,
            accounts: {
              coach: fixtures.accounts.coach,
              student: fixtures.accounts.student,
            },
            fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
          },
          backend: {
            runId: session.manifest.runId,
            apiPid: session.apiPid,
            apiOrigin: session.apiOrigin,
            readProfileSnapshot: (signal) =>
              session!.connectionSnapshot('native-entry-ios', signal),
            readDomainSnapshot: (signal) => session!.snapshot('native-entry-ios', signal),
          },
          proxy: {
            requestIdFence: () => proxy!.requestIdFence,
            observations: () => proxy!.observations,
            nativeAuthIdentities: () => proxy!.nativeAuthIdentities,
          },
          probeQuiescence: localeProbe,
          cleanupOwner: 'outer-capture',
        };
        const wiring = createIosLocaleCaptureWiring(wiringInput);
        const scenario: IosLocaleScenarioInput = {
          scenarioId: connectionLocaleIntegration
            ? 'locale-selection-persistence'
            : (charter as IosLocaleScenarioInput['scenarioId']),
          requestedLocale: options.locale,
          expectedBinding: localeBinding,
          baselineOsLocale: options.locale === 'en-US' ? 'pt-BR' : 'en-US',
        };
        const scenarioResult = await runIosLocaleCaptureCallback({
          wiring,
          scenario,
          signal: controller.signal,
          readCurrentBinding: async () => {
            const currentSource = await sourceIdentity(root);
            const currentHelpers = await helperIdentity();
            const currentBinaryHash = await treeHash(binary);
            return buildNativeLocaleBinding({
              captureRunId,
              sourceTreeHash: currentSource.sourceTreeHash,
              helperInputs: currentHelpers,
              target: {
                platform: 'ios',
                deviceId: device!.udid,
                osVersion: device!.runtime,
                appId: bundleId,
                binaryHash: currentBinaryHash,
                apiOrigin: proxy!.origin,
              },
            });
          },
          execute: connectionLocaleIntegration
            ? options.executeConnectionLocale
            : options.executeLocale,
        });
        const validatedScenarioResult = validateIosLocaleScenarioResult(scenarioResult, scenario);
        if (!applyIosLocaleScenarioResult(report, validatedScenarioResult)) failed = true;
      }
      if (charter === 'connection-journey') {
        await observeConnectionPasswordOffer(
          'coach-home',
          'coach',
          buildIosCredentialEntryActions(credentials.email, credentials.password),
          'SCR-pro-home',
          'pro.home.screen',
          0,
        );
        if (options.executeConnectionAfterFlow) {
          const activeProxy = proxy;
          if (!activeProxy) throw new Error('Connection proxy unavailable after flow');
          const afterFlowContext = buildIosConnectionRuntimeContext({
            output,
            fixtures,
            proxy: activeProxy,
            apiIdentity: connectionApiIdentity!,
            observe,
            report,
            snapshot: () => session!.snapshot('native-entry-ios'),
            connectionSnapshot: () => session!.connectionSnapshot('native-entry-ios'),
            isolationSnapshot: () => session!.connectionSnapshot(connectionIsolationScope),
          });
          await options.executeConnectionAfterFlow(afterFlowContext);
        }
      } else {
        if (cameraIntegration) {
          if (!proxy) throw new Error('Camera integration API proxy is unavailable before sign-in');
          cameraInitialAuthBeforeRequestId = proxy.requestIdFence;
        }
        const cameraCredentialDiagnostic =
          charter === 'camera-denied' && options.credentialInteractionDiagnostic === true;
        if (cameraCredentialDiagnostic) {
          requireIosCredentialInteractionDiagnosticPreflight({
            ownedSession: session !== undefined && fixtures !== undefined,
            ownedTarget: device !== undefined && app !== undefined,
            deadlineAtMs: Math.min(wholeDeadlineAtMs, observationDeadlineAtMs ?? wholeDeadlineAtMs),
            signal: controller.signal,
          });
          report.credentialInteractionDiagnostic = 'pre-auth-email-stage';
        }
        if (charter === 'credential-entry-diagnostic' || cameraCredentialDiagnostic) {
          const diagnosticPostLogin = resolveIosCredentialDiagnosticPostLogin({
            cameraIntegration,
          });
          await runIosCredentialEntryOwnedWiring({
            captureDiagnostic: () => captureCredentialEntryDiagnostic(credentials.email),
            onDiagnostic: (diagnostic) => {
              report.credentialEntryDiagnosticBranchStatus = diagnostic.result.status;
            },
            onOuterFailure: (error) => {
              report.credentialEntryDiagnosticBranchOutcome =
                error instanceof Error && error.message.includes('did not observe')
                  ? 'blocked-by-diagnostic'
                  : 'failed-before-continuation';
            },
            continueAfterDiagnostic: async () => {
              if (!proxy)
                throw new Error('Credential diagnostic proxy unavailable before password witness');
              const beforeRequestId = proxy.requestIdFence;
              await observeConnectionPasswordOffer(
                'credential-diagnostic-home',
                diagnosticPostLogin.actor,
                cameraCredentialDiagnostic
                  ? buildIosCredentialEntryPasswordContinuationWithOriginalEmailAssertionActions(
                      credentials.password,
                      credentials.email,
                    )
                  : buildIosCredentialEntryPasswordContinuationActions(credentials.password),
                diagnosticPostLogin.screenshot,
                diagnosticPostLogin.selector,
                beforeRequestId,
              );
            },
          });
        } else {
          await observe(
            'password-save-prompt',
            buildIosCredentialEntryActions(credentials.email, credentials.password),
            'STATE-password-save',
            'Save Password?',
            'text',
          );
          await observe(
            charter === 'camera-denied' ? 'camera-student-home' : 'coach-home',
            buildIosPasswordOfferDismissalActions(),
            charter === 'camera-denied' ? 'SCR-student-home' : 'SCR-pro-home',
            charter === 'camera-denied' ? 'student.home.screen' : 'pro.home.screen',
          );
        }
      }
      const pathHash = (route: string) => createHash('sha256').update(route).digest('hex');
      if (
        !proxy.observations.some(
          (row) =>
            row.pathHash === pathHash('/auth/email/sign-in') &&
            row.status === 201 &&
            row.outcome === 'forwarded' &&
            row.requestProfile === 'native',
        )
      )
        throw new Error('Native normal sign-in was not observed through the owned proxy');
      if (charter === 'connection-journey') {
        const authenticatedProxy = proxy;
        if (!authenticatedProxy || !connectionApiIdentity)
          throw new Error('Connection journey API identity is unavailable after coach sign-in');
        requireIosConnectionAuthIdentityCapture(authenticatedProxy);
        const coachBoundary = requireIosConnectionSignInBoundary(
          authenticatedProxy.observations,
          0,
        );
        const coachAuthUid = requireIosConnectionActorIdentity(
          authenticatedProxy.nativeAuthIdentities,
          {
            actorAuthUid: fixtures.accounts.coach.authUid,
            authRequestId: coachBoundary.authRequestId,
            apiIdentity: connectionApiIdentity,
            fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
          },
        );
        report.connectionInitialAuth = {
          actor: 'coach',
          actorAuthUid: coachAuthUid,
          ...coachBoundary,
        };
      }
      if (cameraIntegration) {
        const authenticatedProxy = proxy;
        if (!authenticatedProxy || !connectionApiIdentity)
          throw new Error('Camera integration API identity is unavailable after student sign-in');
        requireIosConnectionAuthIdentityCapture(authenticatedProxy);
        const studentBoundary = requireIosConnectionSignInBoundary(
          authenticatedProxy.observations,
          cameraInitialAuthBeforeRequestId ??
            (() => {
              throw new Error('Camera initial auth prelude fence was not captured');
            })(),
        );
        const studentAuthUid = requireIosConnectionActorIdentity(
          authenticatedProxy.nativeAuthIdentities,
          {
            actorAuthUid: fixtures.accounts.student.authUid,
            authRequestId: studentBoundary.authRequestId,
            apiIdentity: connectionApiIdentity,
            fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
          },
        );
        cameraActiveActor = 'student';
        cameraActiveAuthRequestId = studentBoundary.authRequestId;
        report.cameraInitialAuth = {
          actor: 'student',
          actorAuthUid: studentAuthUid,
          ...studentBoundary,
        };
      }
      if (charter === 'session') {
        requireIosConnectionAuthIdentityCapture(proxy);
        const sessionAuthBoundary = requireIosConnectionSignInBoundary(
          proxy.observations,
          sessionLoginBeforeRequestId,
        );
        const sessionAuthUid = requireIosConnectionActorIdentity(proxy.nativeAuthIdentities, {
          actorAuthUid: fixtures.accounts.coach.authUid,
          authRequestId: sessionAuthBoundary.authRequestId,
          apiIdentity: {
            apiPid: session.apiPid,
            targetOrigin: session.apiOrigin,
          },
          fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
        });
        report.sessionInitialAuth = {
          actor: 'coach',
          actorAuthUid: sessionAuthUid,
          apiPid: session.apiPid,
          targetOrigin: session.apiOrigin,
          ...sessionAuthBoundary,
        };
        const nativeAuthIdentityPath = 'native-auth-identities.private.json';
        const nativeAuthIdentityBytes = JSON.stringify(proxy.nativeAuthIdentities, null, 2);
        await sessionWriteText(
          'native-auth-identities-write',
          path.join(output, nativeAuthIdentityPath),
          nativeAuthIdentityBytes,
          { mode: 0o600, flag: 'wx' },
        );
        const ownedNativeAuthIdentityBytes = sessionReadEvidence(
          'native-auth-identities-read',
          nativeAuthIdentityPath,
          true,
        );
        report.nativeAuthIdentityEvidence = {
          path: nativeAuthIdentityPath,
          sha256: createHash('sha256').update(ownedNativeAuthIdentityBytes).digest('hex'),
          bytes: ownedNativeAuthIdentityBytes.length,
          runId: session.manifest.runId,
          scope: 'native-entry-ios',
          ownedRunId: session.manifest.runId,
          fixtureScope: 'native-entry-ios',
          artifactRoot: session.manifest.artifactRoot,
          apiPid: session.apiPid,
          targetOrigin: session.apiOrigin,
          fixtureAuthUidAllowlistHash,
        };
        sessionDataContainer = (
          await sessionExecute(
            'session-data-container-read',
            'xcrun',
            ['simctl', 'get_app_container', device.udid, bundleId, 'data'],
            { timeout: 15_000 },
          )
        ).stdout.trim();
        sessionDomainAfterLogin = await sessionSnapshot('session-domain-after-login-snapshot');
        sessionProfileAfterLogin = await sessionDirectIo(
          'session-profile-after-login-snapshot',
          () => session!.connectionSnapshot('native-entry-ios'),
        );
        const profileAfterLogin = await persistSessionCheckpoint(
          'session-profile-after-login',
          'session-profile-after-login.private.json',
          sessionProfileAfterLogin,
        );
        sessionProfileAfterLogin = profileAfterLogin.value as OwnedConnectionSnapshot;
        sessionProfileSnapshotReceipts = {
          ...sessionProfileSnapshotReceipts,
          afterLogin: profileAfterLogin.receipt,
        };
        const domainAfterLogin = await persistSessionCheckpoint(
          'session-domain-after-login',
          'session-domain-after-login.private.json',
          sessionDomainAfterLogin,
        );
        sessionDomainAfterLogin = domainAfterLogin.value as OwnedDomainSnapshot;
        sessionDomainSnapshotReceipts = {
          ...sessionDomainSnapshotReceipts,
          afterLogin: domainAfterLogin.receipt,
        };
        afterLoginAuthUidHash = await sessionPersistedCoachIdentityHash(
          'session-profile-cache-after-login',
          sessionDataContainer,
        );
        sessionLoginWindow = {
          afterRequestId: sessionLoginBeforeRequestId,
          throughRequestId: proxy.requestIdFence,
        };
        report.sessionProfileLoginWindow = sessionLoginWindow;
        report.persistedCoachIdentity = { afterLoginAuthUidHash };
        report.sessionProfileSnapshots = sessionProfileSnapshotReceipts;
        report.sessionDomainSnapshots = sessionDomainSnapshotReceipts;
      }
      if (charter === 'credential-entry-diagnostic') {
        // The bounded diagnostic ends after verified normal sign-in/home.
        // Account, sign-out and relaunch belong to their explicit charters.
        report.credentialEntryDiagnosticContinuation = 'coach-home-observed';
      } else if (charter === 'session') {
        if (!sessionSqlBefore)
          throw new Error('Native session SQL baseline was not captured before the journey');
        const sessionUiObservationOrder = ['entry', 'password-save-prompt', 'coach-home'];
        const observeSession = async (
          label: string,
          actions: string,
          viewId: string,
          selector: string | string[],
          selectorKind: 'id' | 'text' = 'id',
          notVisibleSelectors: readonly string[] = [],
        ) => {
          sessionUiObservationOrder.push(label);
          await observe(label, actions, viewId, selector, selectorKind, notVisibleSelectors);
        };
        const sessionAssertionSequence: string[] = [nativeSessionAssertionIds[0]];
        if (!sessionDataContainer)
          throw new Error('Native session data container was not captured');
        const dataContainer = sessionDataContainer;
        const requireSignedOutMetadata = (
          metadata: Awaited<ReturnType<typeof observeIosAuthMetadata>>,
          label: string,
        ) => {
          const candidate = metadata as {
            sessionPresent?: unknown;
            profilePresent?: unknown;
            profileAuthUidHash?: unknown;
            expiryPresent?: unknown;
            plaintextAccessTokenPresent?: unknown;
            plaintextRefreshTokenPresent?: unknown;
          };
          if (
            candidate.sessionPresent === true ||
            candidate.profilePresent === true ||
            typeof candidate.profileAuthUidHash === 'string' ||
            candidate.expiryPresent === true ||
            candidate.plaintextAccessTokenPresent === true ||
            candidate.plaintextRefreshTokenPresent === true
          )
            throw new Error(`${label} contains positive persisted-session metadata`);
        };
        const metadataBeforeRelaunch = await sessionAuthMetadata(
          'session-metadata-before-relaunch',
          dataContainer,
        );
        report.authMetadataBeforeRelaunch = metadataBeforeRelaunch;
        if (!metadataBeforeRelaunch.sessionPresent)
          throw new Error('Native session baseline has no persisted session metadata');
        const beforeRelaunchRequestId = proxy.requestIdFence;
        const beforeRelaunchTransportCount = proxy.observations.length;
        await sessionExecute(
          'session-restore-terminate',
          'xcrun',
          ['simctl', 'terminate', device.udid, bundleId],
          { timeout: 30_000 },
        );
        await sessionExecute(
          'session-restore-launch',
          'xcrun',
          [
            'simctl',
            'launch',
            device.udid,
            bundleId,
            '-RCT_jsLocation',
            `localhost:${reservation.port}`,
          ],
          { timeout: 30_000 },
        );
        await observeSession('restored-home', '', 'SCR-pro-home', 'pro.home.screen');
        await sessionDeviceVerify('session-restore-device-verify');
        const metadataAfterRelaunch = await sessionAuthMetadata(
          'session-metadata-after-relaunch',
          dataContainer,
        );
        report.authMetadataAfterRelaunch = metadataAfterRelaunch;
        if (!metadataAfterRelaunch.sessionPresent)
          throw new Error('Native session restoration lost persisted session metadata');
        sessionDomainAfterRestoration = await sessionSnapshot(
          'session-domain-after-restoration-snapshot',
        );
        sessionProfileAfterRestoration = await sessionDirectIo(
          'session-profile-after-restoration-snapshot',
          () => session!.connectionSnapshot('native-entry-ios'),
        );
        const profileAfterRestoration = await persistSessionCheckpoint(
          'session-profile-after-restoration',
          'session-profile-after-restoration.private.json',
          sessionProfileAfterRestoration,
        );
        sessionProfileAfterRestoration = profileAfterRestoration.value as OwnedConnectionSnapshot;
        sessionProfileSnapshotReceipts = {
          ...sessionProfileSnapshotReceipts,
          afterRestoration: profileAfterRestoration.receipt,
        };
        const domainAfterRestoration = await persistSessionCheckpoint(
          'session-domain-after-restoration',
          'session-domain-after-restoration.private.json',
          sessionDomainAfterRestoration,
        );
        sessionDomainAfterRestoration = domainAfterRestoration.value as OwnedDomainSnapshot;
        sessionDomainSnapshotReceipts = {
          ...sessionDomainSnapshotReceipts,
          afterRestoration: domainAfterRestoration.receipt,
        };
        afterRestorationAuthUidHash = await sessionPersistedCoachIdentityHash(
          'session-profile-cache-after-restoration',
          dataContainer,
        );
        sessionRestorationWindow = {
          afterRequestId: beforeRelaunchRequestId,
          throughRequestId: proxy.requestIdFence,
        };
        report.sessionProfileRestorationWindow = sessionRestorationWindow;
        report.persistedCoachIdentity = {
          afterLoginAuthUidHash: afterLoginAuthUidHash!,
          afterRestorationAuthUidHash,
        };
        report.sessionProfileSnapshots = sessionProfileSnapshotReceipts;
        report.sessionDomainSnapshots = sessionDomainSnapshotReceipts;
        const relaunchTransport = proxy.observations.slice(beforeRelaunchTransportCount);
        report.relaunchTransport = relaunchTransport;
        report.relaunchTransportRange = {
          startOrdinal: beforeRelaunchTransportCount,
          endOrdinalExclusive: proxy.observations.length,
          firstRequestId: relaunchTransport[0]?.requestId ?? null,
          lastRequestId: relaunchTransport[relaunchTransport.length - 1]?.requestId ?? null,
        };
        if (
          relaunchTransport.some(
            (row) =>
              row.requestProfile !== 'native' ||
              row.requestOrigin !== null ||
              row.outcome !== 'forwarded' ||
              row.faultAttemptId !== null ||
              row.targetOrigin !== session!.apiOrigin,
          )
        )
          throw new Error('Restoration transport contains a non-owned native row');
        if (
          !relaunchTransport.some(
            (row) =>
              row.pathHash === pathHash('/me/hydrate') &&
              row.status === 200 &&
              row.outcome === 'forwarded' &&
              row.requestProfile === 'native',
          )
        )
          throw new Error('Restored native identity did not hydrate through the owned server');
        if (relaunchTransport.some((row) => row.pathHash === pathHash('/auth/email/sign-in')))
          throw new Error('Restored native identity signed in a second time');
        sessionAssertionSequence.push(nativeSessionAssertionIds[1]);
        await observeSession(
          'account',
          '- tapOn:\n    id: tabs.account',
          'SCR-account',
          'settings.account.screen',
        );
        const emailPattern =
          '^' + fixtures.accounts.coach.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
        await observeSession(
          'restored-identity',
          `- assertVisible: ${JSON.stringify(emailPattern)}`,
          'SCR-account',
          'settings.account.screen',
        );
        await observeIosSessionSignOutWithDiagnostic({
          report,
          observePostTapDiagnostic: observeSessionPostTapDiagnostic,
          observeSession,
        });
        await observeSession(
          'cancel-signout',
          '- tapOn:\n    id: settings.account.signOutCancelCta',
          'SCR-account',
          'settings.account.screen',
          'id',
          ['settings.account.signOutConfirm'],
        );
        const metadataAfterCancel = await sessionAuthMetadata(
          'session-metadata-after-cancel',
          dataContainer,
        );
        requireRetainedNativeSessionIdentity(
          metadataAfterRelaunch,
          metadataAfterCancel,
          afterRestorationAuthUidHash,
        );
        report.authMetadataAfterCancel = metadataAfterCancel;
        report.cancelSignoutCheckpoint = {
          observationLabel: 'cancel-signout',
          hierarchyPath: 'cancel-signout-hierarchy.json',
          sessionPresent: true,
        };
        sessionAssertionSequence.push(nativeSessionAssertionIds[2]);
        await observeSession(
          'signout-reopen',
          '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutCta',
          'STATE-signout-confirm',
          'settings.account.signOutConfirm',
        );
        await observeSession(
          'signout-confirmed',
          '- tapOn:\n    id: settings.account.signOutConfirmCta',
          'SCR-sign-in',
          'auth.signIn.emailInput',
        );
        report.nativeLogoutContract = {
          requirementRefs: ['FR-270', 'BR-342'],
          scope: 'local-native-session-clear',
          serverRevocationQualified: false,
        };
        const metadataAfterSignout = await sessionAuthMetadata(
          'session-metadata-after-signout',
          dataContainer,
        );
        report.authMetadataAfterSignout = metadataAfterSignout;
        requireSignedOutMetadata(metadataAfterSignout, 'Native sign-out metadata');
        if (metadataAfterSignout.sessionPresent)
          throw new Error('Native sign-out did not clear persisted session metadata');
        sessionAssertionSequence.push(nativeSessionAssertionIds[3]);
        const signedOutRelaunchAfterRequestId = proxy.requestIdFence;
        await sessionDeviceVerify('session-before-signed-out-relaunch');
        await sessionExecute(
          'session-signed-out-terminate',
          'xcrun',
          ['simctl', 'terminate', device.udid, bundleId],
          { timeout: 30_000 },
        );
        await sessionExecute(
          'session-signed-out-launch',
          'xcrun',
          [
            'simctl',
            'launch',
            device.udid,
            bundleId,
            '-RCT_jsLocation',
            `localhost:${reservation.port}`,
          ],
          { timeout: 30_000 },
        );
        await observeSession('signed-out-relaunch', '', 'SCR-sign-in', 'auth.signIn.emailInput');
        const metadataAfterSignedoutRelaunch = await sessionAuthMetadata(
          'session-metadata-after-signed-out-relaunch',
          dataContainer,
        );
        report.authMetadataAfterSignedoutRelaunch = metadataAfterSignedoutRelaunch;
        requireSignedOutMetadata(
          metadataAfterSignedoutRelaunch,
          'Signed-out native relaunch metadata',
        );
        if (metadataAfterSignedoutRelaunch.sessionPresent)
          throw new Error('Signed-out native relaunch restored persisted session metadata');
        sessionDomainAfterSignedOutRelaunch = await sessionSnapshot(
          'session-domain-after-signed-out-relaunch-snapshot',
        );
        sessionProfileAfterSignedOutRelaunch = await sessionDirectIo(
          'session-profile-after-signed-out-relaunch-snapshot',
          () => session!.connectionSnapshot('native-entry-ios'),
        );
        const profileAfterSignedOutRelaunch = await persistSessionCheckpoint(
          'session-profile-after-signed-out-relaunch',
          'session-profile-after-signed-out-relaunch.private.json',
          sessionProfileAfterSignedOutRelaunch,
        );
        sessionProfileAfterSignedOutRelaunch =
          profileAfterSignedOutRelaunch.value as OwnedConnectionSnapshot;
        sessionProfileSnapshotReceipts = {
          ...sessionProfileSnapshotReceipts,
          afterSignedOutRelaunch: profileAfterSignedOutRelaunch.receipt,
        };
        const domainAfterSignedOutRelaunch = await persistSessionCheckpoint(
          'session-domain-after-signed-out-relaunch',
          'session-domain-after-signed-out-relaunch.private.json',
          sessionDomainAfterSignedOutRelaunch,
        );
        sessionDomainAfterSignedOutRelaunch =
          domainAfterSignedOutRelaunch.value as OwnedDomainSnapshot;
        sessionDomainSnapshotReceipts = {
          ...sessionDomainSnapshotReceipts,
          afterSignedOutRelaunch: domainAfterSignedOutRelaunch.receipt,
        };
        report.sessionProfileSnapshots = sessionProfileSnapshotReceipts;
        report.sessionDomainSnapshots = sessionDomainSnapshotReceipts;
        if (!sessionDomainAfterSignedOutRelaunch)
          throw new Error('Native session domain checkpoint was not captured');
        const sessionSqlAfterSignedoutRelaunch = sessionDomainAfterSignedOutRelaunch;
        const sessionSqlAfterSignedoutRelaunchBytes = JSON.stringify(
          sessionSqlAfterSignedoutRelaunch,
          null,
          2,
        );
        await sessionWriteText(
          'session-sql-after-signed-out-relaunch-write',
          path.join(output, 'session-sql-after-signed-out-relaunch.private.json'),
          sessionSqlAfterSignedoutRelaunchBytes,
          { mode: 0o600, flag: 'wx' },
        );
        const ownedSessionSqlAfterSignedoutRelaunchBytes = sessionReadEvidence(
          'session-sql-after-signed-out-relaunch-read',
          'session-sql-after-signed-out-relaunch.private.json',
          true,
        );
        report.sessionSqlAfterSignedoutRelaunch = {
          path: 'session-sql-after-signed-out-relaunch.private.json',
          runId: sessionSqlAfterSignedoutRelaunch.runId,
          scope: sessionSqlAfterSignedoutRelaunch.scope,
          sha256: createHash('sha256')
            .update(ownedSessionSqlAfterSignedoutRelaunchBytes)
            .digest('hex'),
          bytes: ownedSessionSqlAfterSignedoutRelaunchBytes.length,
          ownedRunId: session.manifest.runId,
          fixtureScope: 'native-entry-ios',
          artifactRoot: session.manifest.artifactRoot,
          apiPid: session.apiPid,
          targetOrigin: session.apiOrigin,
          fixtureAuthUidAllowlistHash,
        };
        if (
          JSON.stringify(sessionSqlBefore.trainingPlans) !==
            JSON.stringify(sessionSqlAfterSignedoutRelaunch.trainingPlans) ||
          JSON.stringify(sessionSqlBefore.connections) !==
            JSON.stringify(sessionSqlAfterSignedoutRelaunch.connections)
        )
          throw new Error('Native session journey changed unrelated owned SQL state');
        // Close the actual stream before hashing and verifying it. This also captures
        // requests begun before a boundary but completed after it.
        const sessionTransportProxy = proxy;
        await sessionDirectIo('session-transport-close', () => sessionTransportProxy.stop());
        const signedOutRelaunchWindow = {
          afterRequestId: signedOutRelaunchAfterRequestId,
          throughRequestId: proxy.requestIdFence,
        };
        // Retain the actual closed boundary even when validation rejects it.
        report.signedOutRelaunchTransportRange = signedOutRelaunchWindow;
        const signedOutRelaunchTransport = requireSignedOutSessionTransport({
          observations: proxy.observations,
          window: signedOutRelaunchWindow,
          expectedTargetOrigin: session.apiOrigin,
        });
        report.signedOutRelaunchTransport = signedOutRelaunchTransport;
        const sessionTransportPath = 'transport-observations.private.json';
        await sessionWriteText(
          'session-transport-write',
          path.join(output, sessionTransportPath),
          JSON.stringify(proxy.observations, null, 2),
          { mode: 0o600, flag: 'wx' },
        );
        const ownedSessionTransportBytes = sessionReadEvidence(
          'session-transport-read',
          sessionTransportPath,
          true,
        );
        report.transportEvidence = {
          path: sessionTransportPath,
          sha256: createHash('sha256').update(ownedSessionTransportBytes).digest('hex'),
          bytes: ownedSessionTransportBytes.length,
          runId: session.manifest.runId,
          scope: 'native-entry-ios',
          ownedRunId: session.manifest.runId,
          fixtureScope: 'native-entry-ios',
          artifactRoot: session.manifest.artifactRoot,
          apiPid: session.apiPid,
          targetOrigin: session.apiOrigin,
          fixtureAuthUidAllowlistHash,
        };
        if (
          !sessionProfileBeforeLogin ||
          !sessionProfileAfterLogin ||
          !sessionProfileAfterRestoration ||
          !sessionProfileAfterSignedOutRelaunch ||
          !sessionDomainAfterLogin ||
          !sessionDomainAfterRestoration ||
          !sessionDomainAfterSignedOutRelaunch ||
          !sessionLoginWindow ||
          !sessionRestorationWindow ||
          !afterLoginAuthUidHash ||
          !afterRestorationAuthUidHash
        )
          throw new Error('Native session profile checkpoint acquisition is incomplete');
        const sessionProfileCheckpointVerification = verifyNativeSessionProfileCheckpoints({
          platform: 'ios',
          backendRunId: session.manifest.runId,
          fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
          coachAuthUid: fixtures.accounts.coach.authUid,
          studentAuthUid: fixtures.accounts.student.authUid,
          expectedApiIdentity: {
            apiPid: session.apiPid,
            targetOrigin: session.apiOrigin,
          },
          profiles: {
            beforeLogin: sessionProfileBeforeLogin,
            afterLogin: sessionProfileAfterLogin,
            afterRestoration: sessionProfileAfterRestoration,
            afterSignedOutRelaunch: sessionProfileAfterSignedOutRelaunch,
          },
          domain: {
            beforeLogin: sessionSqlBefore,
            afterLogin: sessionDomainAfterLogin,
            afterRestoration: sessionDomainAfterRestoration,
            afterSignedOutRelaunch: sessionDomainAfterSignedOutRelaunch,
          },
          observations: proxy.observations,
          authIdentities: proxy.nativeAuthIdentities,
          loginWindow: sessionLoginWindow,
          restorationWindow: sessionRestorationWindow,
          persistedCoachIdentity: {
            afterLoginAuthUidHash,
            afterRestorationAuthUidHash,
          },
        });
        report.sessionProfileCheckpointVerification = sessionProfileCheckpointVerification;
        report.sessionSqlBeforeAfterUnchanged = true;
        sessionAssertionSequence.push(nativeSessionAssertionIds[4]);
        sessionAssertionSequence.push(nativeSessionAssertionIds[5]);
        if (sessionAssertionSequence.length !== nativeSessionAssertionIds.length)
          throw new Error('Native session assertion sequence is incomplete');
        const sessionViewEvidence = await sessionDirectIo(
          'session-view-evidence-publication',
          () => {
            const sealed: ViewEvidence[] = [];
            for (const frame of frames) {
              const screenshotBytes = sessionReadEvidence(
                'session-screenshot-read',
                frame.screenshotPath,
              );
              const hierarchyBytes = sessionReadEvidence(
                'session-hierarchy-read',
                frame.hierarchyPath,
                true,
              );
              const sealedFrame = {
                ...frame,
                screenshotHash: createHash('sha256').update(screenshotBytes).digest('hex'),
                hierarchyHash: createHash('sha256').update(hierarchyBytes).digest('hex'),
                reviewed: false,
              } as const;
              validateNativeRuntimeFrameFiles(output, [sealedFrame], [sealedFrame.viewId]);
              sealed.push(sealedFrame);
            }
            return sealed;
          },
        );
        publishNativeSessionLedger(
          report,
          {
            sessionAssertionSequence,
            sessionUiObservationOrder,
            sessionSqlBeforeAfterUnchanged: true,
            sessionProfileSnapshots: sessionProfileSnapshotReceipts,
            sessionDomainSnapshots: sessionDomainSnapshotReceipts,
            sessionProfileLoginWindow: sessionLoginWindow,
            sessionProfileRestorationWindow: sessionRestorationWindow,
            persistedCoachIdentity: {
              afterLoginAuthUidHash,
              afterRestorationAuthUidHash,
            },
            sessionProfileCheckpointVerification,
            observations: sessionViewEvidence,
            sessionViewEvidence,
          },
          controller.signal,
        );
      } else if (charter === 'camera-denied') {
        const activeProxy = proxy;
        if (!activeProxy) throw new Error('Camera observation API proxy is unavailable');
        const displayName = (
          await execute(
            'plutil',
            ['-extract', 'CFBundleDisplayName', 'raw', path.join(binary, 'Info.plist')],
            { timeout: 15_000 },
          )
        ).stdout.trim();
        const cameraObservationMode = selectIosCameraObservationMode(cameraIntegration);
        const cameraObserver =
          cameraObservationMode === 'authenticated-camera' ? observeCamera : observe;
        const cameraInitialAuth = cameraIntegration
          ? requireIosCameraInitialAuthBoundary(report.cameraInitialAuth)
          : undefined;
        const cameraInitialAuthAfterRequestId = cameraInitialAuth?.afterRequestId;
        if (
          cameraIntegration &&
          (typeof cameraInitialAuthAfterRequestId !== 'number' ||
            !Number.isSafeInteger(cameraInitialAuthAfterRequestId) ||
            cameraInitialAuthAfterRequestId < 0)
        )
          throw new Error('Camera initial auth boundary lacks its captured post-auth fence');
        // requestIdFence records request starts, so an in-flight request can
        // still be absent from observations at the marker instant. Drain the
        // owned proxy first, then capture the fence and prefix immediately
        // before entering the camera observer. The bounded drain remains
        // abort-aware and cannot turn an unknown prefix into a clean marker.
        await activeProxy.waitForQuiescence(5_000, controller.signal);
        const cameraPrelude = captureIosCameraPreludeBoundary(
          activeProxy.observations,
          activeProxy.requestIdFence,
        );
        await observeIosCameraDenial({
          output,
          report,
          studentAuthUid: credentials.authUid,
          displayName,
          permission: () => readOwnedIosCameraPermission(device!, bundleId, controller.signal),
          snapshot: () => session!.snapshot('native-entry-ios'),
          observations: () => activeProxy.observations,
          preludeRequestIdFence: cameraPrelude.requestIdFence,
          preludeObservationCount: cameraPrelude.observationCount,
          preludeObservationPrefixSha256: cameraPrelude.observationPrefixSha256,
          cameraInitialAuthAfterRequestId:
            cameraInitialAuthAfterRequestId ?? cameraPrelude.requestIdFence,
          observe: cameraObserver,
          waitForQuiescence: (deadlineMs, signal) =>
            activeProxy.waitForQuiescence(deadlineMs, signal),
          requestIdFence: () => activeProxy.requestIdFence,
          signal: controller.signal,
        });
        if (options.executeCamera) {
          if (!connectionApiIdentity)
            throw new Error('Camera integration API identity is unavailable');
          const context = buildIosConnectionRuntimeContext({
            output,
            fixtures,
            proxy: activeProxy,
            apiIdentity: connectionApiIdentity,
            // Account switching stays on generic observations until its new
            // sign-in boundary is verified; only the camera continuation gets
            // the explicit provenance mode.
            observe,
            report,
            snapshot: () => session!.snapshot('native-entry-ios'),
            connectionSnapshot: () => session!.connectionSnapshot('native-entry-ios'),
            isolationSnapshot: () => session!.connectionSnapshot(connectionIsolationScope),
          });
          if (!connectionIsolationFixtures)
            throw new Error('Camera connection isolation fixtures were not acquired');
          await options.executeCamera({
            ...context,
            connectionIsolationFixtures,
            commandExecutions,
            observe: observeCamera,
            displayName,
            signal: controller.signal,
            permission: () => readOwnedIosCameraPermission(device!, bundleId, controller.signal),
          });
        }
      } else if (['training-title-selection', 'training-title-gesture'].includes(charter)) {
        await observeIosTrainingTitleSelection({
          method: charter === 'training-title-gesture' ? 'paragraph-gesture' : 'menu',
          output,
          fixtures,
          report,
          snapshot: () => session!.snapshot('native-entry-ios'),
          observe,
        });
      } else if (charter === 'training-journey') {
        const context: IosTrainingRuntimeContext = {
          output,
          fixtures,
          snapshot: () => session!.snapshot('native-entry-ios'),
          proxy,
          observe,
          restartRuntime: async () => {
            await device!.verify(controller.signal);
            await execute('xcrun', ['simctl', 'terminate', device!.udid, bundleId], {
              timeout: 30_000,
            });
            await proxy!.restartApi();
            report.backendRestart = {
              apiPid: session!.apiPid,
              processes: structuredClone(session!.manifest.processes),
            };
            await device!.verify(controller.signal);
            await execute(
              'xcrun',
              [
                'simctl',
                'launch',
                device!.udid,
                bundleId,
                '-RCT_jsLocation',
                `localhost:${reservation.port}`,
              ],
              { timeout: 30_000 },
            );
          },
        };
        if (options.executeTraining) await options.executeTraining(context);
        else await observeIosSavedTrainingJourney({ ...context, report });
      } else if (charter === 'training-edit') {
        await observeIosTrainingLocalEdit({
          output,
          fixtures,
          report,
          snapshot: () => session!.snapshot('native-entry-ios'),
          proxy,
          observe,
        });
      } else if (charter === 'training-load') {
        await observeIosTrainingLoad({
          output,
          savedPlanId: fixtures.savedPlanId,
          accountUid: credentials.authUid,
          report,
          snapshot: () => session!.snapshot('native-entry-ios'),
          proxy,
          observe,
        });
      } else if (['training-draft', 'training-discard', 'save-retry'].includes(charter)) {
        if (charter === 'save-retry' && options.executeSaveRetry) {
          await options.executeSaveRetry({
            output,
            fixtures,
            snapshot: () => session!.snapshot('native-entry-ios'),
            proxy,
            observe,
            accountUid: credentials.authUid,
            report,
          });
        } else {
          await observeNativeTrainingDraft({
            platform: 'ios',
            output,
            savedPlanId: fixtures.savedPlanId,
            report,
            snapshot: () => session!.snapshot('native-entry-ios'),
            observations: () => proxy!.observations,
            observe,
          });
        }
        if (charter === 'training-discard')
          await observeIosTrainingDiscard({
            output,
            savedPlanId: fixtures.savedPlanId,
            report,
            snapshot: () => session!.snapshot('native-entry-ios'),
            observations: () => proxy!.observations,
            observe,
          });
        if (charter === 'save-retry' && !options.executeSaveRetry)
          await observeIosSaveRetry({
            output,
            accountUid: credentials.authUid,
            report,
            snapshot: () => session!.snapshot('native-entry-ios'),
            proxy: proxy,
            observe,
          });
      } else if (charter === 'connection-journey') {
        if (!options.executeConnection)
          throw new Error('iOS connection journey requires its owned execution callback');
        const activeProxy = proxy;
        if (!activeProxy) throw new Error('Owned API proxy unavailable for connection journey');
        const apiIdentity = connectionApiIdentity;
        if (!apiIdentity) throw new Error('Connection journey API identity is unavailable');
        const context = buildIosConnectionRuntimeContext({
          output,
          fixtures,
          proxy: activeProxy,
          apiIdentity,
          observe,
          report,
          snapshot: () => session!.snapshot('native-entry-ios'),
          connectionSnapshot: () => session!.connectionSnapshot('native-entry-ios'),
          isolationSnapshot: () => session!.connectionSnapshot(connectionIsolationScope),
        });
        await options.executeConnection(context);
      } else if (charter === 'connection-states') {
        await observeNativeConnectionStates({
          platform: 'ios',
          output,
          fixtures,
          report,
          snapshot: () => session!.snapshot('native-entry-ios'),
          observations: () => proxy!.observations,
          observe,
          switchAccount: async (account) => {
            await observe(
              `${account}-account`,
              (account === 'active-student'
                ? '- tapOn:\n    id: student.professionals.backButton\n'
                : '') + '- tapOn:\n    id: tabs.account',
              'SCR-account',
              'settings.account.screen',
            );
            await observe(
              `${account}-signed-out`,
              '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutCta\n- scrollUntilVisible:\n    element:\n      id: settings.account.signOutConfirmCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutConfirmCta',
              'SCR-sign-in',
              'auth.signIn.emailInput',
            );
            const credentials = fixtures.accounts[account];
            await observe(
              `${account}-password-save-prompt`,
              buildIosCredentialEntryActions(credentials.email, credentials.password),
              'STATE-password-save',
              'Save Password?',
              'text',
            );
            await observe(
              `${account}-home`,
              buildIosPasswordOfferDismissalActions(),
              'SCR-student-home',
              'student.home.screen',
            );
          },
        });
        report.nativeLogoutContract = {
          requirementRefs: ['FR-270', 'BR-342'],
          scope: 'local-native-session-clear for normal fixture account switches',
          serverRevocationQualified: false,
        };
      } else {
        await observe(
          'account',
          '- tapOn:\n    id: tabs.account',
          'SCR-account',
          'settings.account.screen',
        );
        report.signOutPostTapDiagnostic = await observePostTapDiagnostic(
          'signout-post-tap',
          '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutCta',
        );
        await observe(
          'signout-confirm',
          '',
          'STATE-signout-confirm',
          'settings.account.signOutConfirm',
        );
        await observe(
          'cancel-signout',
          '- tapOn:\n    id: settings.account.signOutCancelCta',
          'SCR-account',
          'settings.account.screen',
        );
        await device.verify(controller.signal);
        const dataContainer = (
          await execute('xcrun', ['simctl', 'get_app_container', device.udid, bundleId, 'data'], {
            timeout: 15_000,
          })
        ).stdout.trim();
        report.authMetadataBeforeRelaunch = await observeIosAuthMetadata(
          dataContainer,
          bundleId,
          controller.signal,
        );
        const beforeRelaunchTransportCount = proxy.observations.length;
        await execute('xcrun', ['simctl', 'terminate', device.udid, bundleId], {
          timeout: 30_000,
        });
        await execute(
          'xcrun',
          [
            'simctl',
            'launch',
            device.udid,
            bundleId,
            '-RCT_jsLocation',
            `localhost:${reservation.port}`,
          ],
          { timeout: 30_000 },
        );
        let restorationError: Error | undefined;
        try {
          await observe('restored-home', '', 'SCR-pro-home', 'pro.home.screen');
        } catch (error) {
          restorationError =
            error instanceof Error
              ? error
              : new Error('Native restoration failed', { cause: error });
        }
        try {
          await device.verify(controller.signal);
          report.authMetadataAfterRelaunch = await observeIosAuthMetadata(
            dataContainer,
            bundleId,
            controller.signal,
          );
          report.relaunchTransport = proxy.observations.slice(beforeRelaunchTransportCount);
          const systemLog = await execute(
            'xcrun',
            [
              'simctl',
              'spawn',
              device.udid,
              'log',
              'show',
              '--last',
              '3m',
              '--style',
              'compact',
              '--predicate',
              'process == "mychampions" OR process == "securityd"',
            ],
            { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
          );
          await writeFile(
            path.join(output, 'native-storage-system.private.log'),
            systemLog.stdout,
            {
              mode: 0o600,
            },
          );
        } catch (error) {
          report.authDiagnosticsError = (error as Error).message;
          restorationError ??=
            error instanceof Error
              ? error
              : new Error('Native diagnostics failed', { cause: error });
        }
        if (restorationError) throw restorationError;
        if (
          !proxy.observations
            .slice(beforeRelaunchTransportCount)
            .some(
              (row) =>
                row.pathHash === pathHash('/me/hydrate') &&
                row.status === 200 &&
                row.outcome === 'forwarded',
            )
        )
          throw new Error('Restored native identity did not hydrate through the owned server');
        await observe(
          'restored-account',
          '- tapOn:\n    id: tabs.account',
          'SCR-account',
          'settings.account.screen',
        );
        const emailPattern =
          '^' + fixtures.accounts.coach.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';
        await observe(
          'restored-identity',
          `- assertVisible: ${JSON.stringify(emailPattern)}`,
          'SCR-account',
          'settings.account.screen',
        );
        report.signedOutPostTapDiagnostic = await observePostTapDiagnostic(
          'signed-out-post-tap',
          '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutCta',
        );
        await observe(
          'signed-out',
          '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutConfirmCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutConfirmCta',
          'SCR-sign-in',
          'auth.signIn.emailInput',
        );
        // FR-270 / BR-342 preserve local native bearer-session clearing. Server
        // logout is the browser cookie contract. This inventory charter observes
        // the existing native contract; it cannot qualify the pilot's separate
        // server-revocation requirement or silently change product auth behavior.
        report.nativeLogoutContract = {
          requirementRefs: ['FR-270', 'BR-342'],
          scope: 'local-native-session-clear',
          serverRevocationQualified: false,
        };
        const metadataAfterSignout = await observeIosAuthMetadata(
          dataContainer,
          bundleId,
          controller.signal,
        );
        report.authMetadataAfterSignout = metadataAfterSignout;
        if (metadataAfterSignout.sessionPresent)
          throw new Error('Native sign-out did not clear persisted session metadata');
        await device.verify(controller.signal);
        await execute('xcrun', ['simctl', 'terminate', device.udid, bundleId], {
          timeout: 30_000,
        });
        await execute(
          'xcrun',
          [
            'simctl',
            'launch',
            device.udid,
            bundleId,
            '-RCT_jsLocation',
            `localhost:${reservation.port}`,
          ],
          { timeout: 30_000 },
        );
        await observe('signed-out-relaunch', '', 'SCR-sign-in', 'auth.signIn.emailInput');
        const metadataAfterSignedoutRelaunch = await observeIosAuthMetadata(
          dataContainer,
          bundleId,
        );
        report.authMetadataAfterSignedoutRelaunch = metadataAfterSignedoutRelaunch;
        if (metadataAfterSignedoutRelaunch.sessionPresent)
          throw new Error('Signed-out native relaunch restored persisted session metadata');
        await writeFile(
          path.join(output, 'transport-observations.private.json'),
          JSON.stringify(proxy.observations, null, 2),
          { mode: 0o600 },
        );
      }
    }
    beginPhase('verify');
    const currentSource = await sourceIdentity(root);
    await writeFile(path.join(output, 'bootstrap.private.log'), app.diagnostics, { mode: 0o600 });
    assertNativeBootstrapHealthy(app.diagnostics);
    if (JSON.stringify(currentSource) !== JSON.stringify(initialSource))
      throw new Error('Native source identity changed during capture');
    if (!failed) {
      report.result = 'observed';
      report.selectors = required;
      report.localeSetup =
        'en-US requested on newly owned simulator; full locale behavior not qualified';
    }
  } catch (error) {
    failed = true;
    if (controller.signal.reason instanceof NativeExecutionDeadlineError)
      report.deadline = {
        step: controller.signal.reason.step,
        deadlineMs: controller.signal.reason.deadlineMs,
      };
    report.error = (error as Error).message;
    if (error instanceof OwnedSessionAcquisitionError) {
      const acquisitionFailure = projectIosOwnedSessionAcquisitionFailure(error);
      acquisitionFailureCleanup = acquisitionFailure.cleanup;
      report.backendAcquisitionFailure = {
        ...acquisitionFailure,
        diagnosticsPath: 'backend-acquisition.private.log',
      };
      const diagnostics = boundedOwnedSessionDiagnostics(error.diagnostics);
      try {
        await writeFile(path.join(output, 'backend-acquisition.private.log'), diagnostics.bytes, {
          flag: 'wx',
          mode: 0o600,
        });
      } catch {
        report.backendAcquisitionDiagnosticsUnavailable = true;
      }
    }
    if (error instanceof IosSimulatorBootstrapError) {
      report.simulatorBootstrapFailure = error.failure;
      if (error.failure.identity)
        report.device = {
          ...error.failure.identity,
          type: error.failure.identity.deviceTypeIdentifier,
          acquisitionPhase: 'bootstrap-failed',
        };
    }
    if (device) {
      try {
        const actual = await device.inspect();
        report.deviceHealthOnFailure = {
          observedAt: new Date().toISOString(),
          udid: actual.udid,
          state: actual.state,
          isAvailable: actual.isAvailable,
        };
      } catch (healthError) {
        report.deviceHealthOnFailure = {
          state: 'unknown',
          error: (healthError as Error).message,
        };
      }
    }
  } finally {
    beginPhase('cleanup');
    const errors: string[] = [...commandCleanupFailures];
    if (device) {
      try {
        await device.verify();
        const systemLog = await execute(
          'xcrun',
          [
            'simctl',
            'spawn',
            device.udid,
            'log',
            'show',
            '--last',
            '3m',
            '--style',
            'compact',
            '--predicate',
            'process == "mychampions" OR process == "securityd" OR process == "amfid" OR process == "runningboardd" OR process == "SpringBoard" OR process == "launchd_sim" OR subsystem BEGINSWITH "com.apple.launchservices"',
          ],
          { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
        );
        await writeFile(path.join(output, 'native-runtime-system.private.log'), systemLog.stdout, {
          mode: 0o600,
        });
      } catch (error) {
        report.systemDiagnosticsUnavailable = true;
        await writeFile(
          path.join(output, 'native-runtime-system-error.private.json'),
          JSON.stringify({
            kind: 'owned-simulator diagnostic retrieval error',
            message: (error as Error).message.slice(0, 65536),
          }),
          { mode: 0o600, flag: 'wx' },
        ).catch(() => {
          report.systemDiagnosticErrorReceiptUnavailable = true;
        });
      }
    }
    if (proxy) {
      try {
        if (charter === 'session') {
          await proxy.stop();
          // Terminal diagnostics preserve the complete stopped stream even when
          // acquisition or publication failed; original evidence is never rewritten.
          const terminalReceipts: Record<string, { path: string; bytes: number; sha256: string }> =
            {};
          for (const [name, rows] of [
            ['transport-terminal.private.json', proxy.observations],
            ['native-auth-terminal.private.json', proxy.nativeAuthIdentities],
          ] as const) {
            await writeFile(path.join(output, name), JSON.stringify(rows, null, 2), {
              mode: 0o600,
              flag: 'wx',
            });
            const bytes = readNativeEvidence(output, name, true);
            terminalReceipts[name] = {
              path: name,
              bytes: bytes.length,
              sha256: createHash('sha256').update(bytes).digest('hex'),
            };
          }
          report.sessionTerminalTransportDiagnostics = terminalReceipts;
          if (report.sessionEvidencePublication === 'complete') {
            const bytes = readNativeEvidence(output, 'transport-observations.private.json', true);
            const receipt = report.transportEvidence as {
              sha256: string;
              bytes: number;
            };
            requireFinalSessionTransport(bytes, receipt, proxy.observations);
            const authBytes = readNativeEvidence(
              output,
              'native-auth-identities.private.json',
              true,
            );
            const authReceipt = report.nativeAuthIdentityEvidence as {
              sha256: string;
              bytes: number;
            };
            requireFinalSessionTransport(authBytes, authReceipt, proxy.nativeAuthIdentities);
          }
        } else {
          const transportPath = 'transport-observations.private.json';
          await writeFile(
            path.join(output, transportPath),
            JSON.stringify(proxy.observations, null, 2),
            { mode: 0o600, flag: 'wx' },
          );
          if (needsConnectionContext || localeIntegration) {
            const transportBytes = readNativeEvidence(output, transportPath, true);
            report.transportEvidence = {
              path: transportPath,
              bytes: transportBytes.length,
              sha256: createHash('sha256').update(transportBytes).digest('hex'),
              source: 'owned-api-proxy.observations',
              runId: session?.manifest.runId,
              scope: 'native-entry-ios',
              apiPid: session?.apiPid,
              targetOrigin: session?.apiOrigin,
              fixtureAuthUidAllowlistHash:
                typeof report.fixtureAuthUidAllowlistHash === 'string'
                  ? report.fixtureAuthUidAllowlistHash
                  : undefined,
            };
          }
        }
      } catch {
        errors.push('transport-evidence');
        if (charter === 'session') report.sessionEvidencePublication = 'rejected-final-evidence';
      }
      if (needsConnectionContext || localeIntegration) {
        try {
          const authPath = 'native-auth-identities.private.json';
          await writeFile(
            path.join(output, authPath),
            JSON.stringify(proxy.nativeAuthIdentities, null, 2),
            { mode: 0o600, flag: 'wx' },
          );
          const authBytes = readNativeEvidence(output, authPath, true);
          report.nativeAuthIdentityEvidence = {
            path: authPath,
            bytes: authBytes.length,
            sha256: createHash('sha256').update(authBytes).digest('hex'),
            source: 'owned-api-proxy.nativeAuthIdentities',
            runId: session?.manifest.runId,
            scope: 'native-entry-ios',
            apiPid: session?.apiPid,
            targetOrigin: session?.apiOrigin,
            fixtureAuthUidAllowlistHash:
              typeof report.fixtureAuthUidAllowlistHash === 'string'
                ? report.fixtureAuthUidAllowlistHash
                : undefined,
          };
        } catch {
          errors.push('native-auth-identity-evidence');
        }
      }
    }
    const invalidateCredentialEntryDiagnosticSidecar = async (reason: string): Promise<void> => {
      const evidence = report.credentialEntryDiagnosticEvidence;
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return;
      const sidecarPath = (evidence as { path?: unknown }).path;
      if (typeof sidecarPath !== 'string' || sidecarPath.length === 0) return;
      const invalidationPath = 'credential-entry-diagnostic-invalidation.private.json';
      await invalidateIosCredentialEntryOwnedSidecar({
        report,
        reason,
        sidecarIoPath: path.join(output, sidecarPath),
        sidecarReportPath: sidecarPath,
        originalIoPath: path.join(output, 'credential-entry-diagnostic.original.private.json'),
        invalidationIoPath: path.join(output, invalidationPath),
        invalidationReportPath: invalidationPath,
        failureIoPath: path.join(
          output,
          'credential-entry-diagnostic-invalidation-failure.private.json',
        ),
        failureReportPath: 'credential-entry-diagnostic-invalidation-failure.private.json',
        io: {
          read: (filePath) => readFile(filePath),
          write: (filePath, bytes, options) => writeFile(filePath, bytes, options),
        },
      });
    };
    try {
      report.sourceAfter = await sourceIdentity(root);
      report.helperInputsAfter = await helperIdentity();
      const helperChanged =
        JSON.stringify(report.helperInputsBefore) !== JSON.stringify(report.helperInputsAfter);
      const sourceChanged = JSON.stringify(report.sourceAfter) !== JSON.stringify(initialSource);
      if (helperChanged) {
        failed = true;
        report.helperMismatch = true;
      }
      if (sourceChanged) {
        failed = true;
        report.sourceMismatch = true;
      }
      if (helperChanged || sourceChanged)
        await invalidateCredentialEntryDiagnosticSidecar(
          helperChanged && sourceChanged
            ? 'source and helper inputs changed after the diagnostic sidecar was written'
            : helperChanged
              ? 'helper inputs changed after the diagnostic sidecar was written'
              : 'source changed after the diagnostic sidecar was written',
        );
    } catch {
      failed = true;
      report.sourceIdentityUnavailable = true;
      try {
        await invalidateCredentialEntryDiagnosticSidecar(
          'source or helper identity became unavailable after the diagnostic sidecar was written',
        );
      } catch {
        report.credentialEntryDiagnosticInvalidationUnavailable = true;
      }
    }
    clearTimeout(observationTimer);
    for (const [name, cleanup] of [
      ['expo', () => app?.stop()],
      ['proxy', () => proxy?.stop()],
      ['backend', () => session?.stop()],
      ['simulator', () => device?.stop()],
      ['adb-server', () => adb?.stop()],
      ['reservation', () => reservation.release()],
      ['api-reservation', () => apiReservation?.release()],
    ] as const) {
      try {
        await cleanup();
      } catch {
        errors.push(name);
      }
    }
    try {
      const previous = JSON.parse(
        await readFile(path.join(output, 'previous-ios-devices.private.json'), 'utf8'),
      ) as { devices: Record<string, { udid: string; state: string }[]> };
      const current = JSON.parse(
        (
          await execute('xcrun', ['simctl', 'list', 'devices', '--json'], {
            timeout: 15000,
          })
        ).stdout,
      ) as typeof previous;
      const states = new Map(
        Object.values(current.devices)
          .flat()
          .map((row) => [row.udid, row.state]),
      );
      if (
        Object.values(previous.devices)
          .flat()
          .some((row) => states.get(row.udid) !== row.state)
      )
        errors.push('foreign-ios-state-changed');
    } catch {
      errors.push('foreign-ios-state-check');
    }
    if (
      existsSync(path.join(output, 'simulator-owner.private.json')) &&
      !existsSync(path.join(output, 'simulator-cleanup.json'))
    )
      errors.push('simulator-recovery');
    if (app) {
      await writeFile(path.join(output, 'bootstrap.private.log'), app.diagnostics, { mode: 0o600 });
      try {
        assertNativeBootstrapHealthy(app.diagnostics);
      } catch (error) {
        failed = true;
        report.error = (error as Error).message;
        report.runtimeQualificationRejected = true;
      }
    }
    // Finalize only after every owned resource cleanup has been attempted.
    const localeFinalization = await safelyFinalizeNativeLocaleObservation(() => {
      if (
        !localeCapture ||
        !localeExpectedBindingInputs ||
        report.sourceMismatch ||
        report.helperMismatch ||
        report.sourceIdentityUnavailable
      )
        return;
      const capturedSource = report.sourceAfter as { sourceTreeHash: string };
      const capturedHelpers = report.helperInputsAfter as typeof helperInputsBefore;
      const capturedDevice = report.device as {
        udid: string;
        runtime: string;
      };
      const capturedBuild = report.build as {
        bundleId: string;
        binaryHash: string;
        apiOrigin: string;
      };
      const capturedBinding = buildNativeLocaleBinding({
        captureRunId,
        sourceTreeHash: capturedSource.sourceTreeHash,
        helperInputs: capturedHelpers,
        target: {
          platform: 'ios',
          deviceId: capturedDevice.udid,
          osVersion: capturedDevice.runtime,
          appId: capturedBuild.bundleId,
          binaryHash: capturedBuild.binaryHash,
          apiOrigin: capturedBuild.apiOrigin,
        },
      });
      const expectedBinding = buildNativeLocaleBinding({
        captureRunId,
        sourceTreeHash: localeExpectedBindingInputs.sourceTreeHash,
        helperInputs: localeExpectedBindingInputs.helperInputs,
        target: localeExpectedBindingInputs.target,
      });
      const normalized = normalizeNativeLocaleCommandOutput({
        binding: capturedBinding,
        command: localeCapture.command,
      });
      report.localeBinding = capturedBinding;
      report.localeExpectedBinding = expectedBinding;
      report.observedOsLocale = normalized.observedOsLocale;
      report.localeObservationBlocker = normalized.blocker;
      if (!sameNativeLocaleBinding(capturedBinding, expectedBinding)) {
        failed = true;
        report.localeBindingMismatch = true;
      }
      report.localeContextCandidate = buildNativeLocaleContextCandidateFromFile({
        artifactRoot: output,
        hierarchyPath: localeCapture.hierarchyPath,
        binding: capturedBinding,
        expectedBinding,
        observedOsLocale: normalized.observedOsLocale,
      });
    });
    if (localeFinalization.status === 'blocked') {
      failed = true;
      report.localeBinding = null;
      report.localeExpectedBinding = null;
      report.observedOsLocale = null;
      report.localeContextCandidate = null;
      report.localeObservationBlocker = 'locale-observation-finalization-failed';
      report.localeObservationError = localeFinalization.error;
    }
    clearTimeout(wholeTimer);
    if (report.budgetTimeout) failed = true;
    report.cleanup = projectIosCaptureCleanup(errors, acquisitionFailureCleanup);
    if (report.cleanup !== 'cleaned') failed = true;
    if (incrementalBuildBinding) {
      const buildExecution = commandExecutions.find((execution) => execution.label === 'build');
      const failedBuild =
        buildExecution &&
        (buildExecution.execution === 'child-failed' || buildExecution.execution === 'deadline');
      if (failedBuild) {
        try {
          const receipt = await writeIosIncrementalBuildCacheReceipt({
            artifactRoot: output,
            captureRunId,
            source: initialSource,
            sourceAfter:
              report.sourceAfter && typeof report.sourceAfter === 'object'
                ? (report.sourceAfter as Awaited<ReturnType<typeof sourceIdentity>>)
                : null,
            binding: incrementalBuildBinding,
            command: buildExecution,
            captureCleanup: report.cleanup as string,
          });
          report.incrementalBuildCacheReceipt = {
            path: receipt.path,
            sha256: receipt.sha256,
            bytes: receipt.bytes,
          };
        } catch (error) {
          report.incrementalBuildCacheReceiptError = (error as Error).message;
          failed = true;
        }
      }
      if (incrementalBuildPreparation) {
        try {
          if (!buildExecution) throw new Error('iOS build execution record is missing');
          const resultReceipt = await writeIosIncrementalBuildCacheResultReceipt({
            artifactRoot: output,
            preparation: incrementalBuildPreparation,
            command: buildExecution,
            captureCleanup: report.cleanup as string,
          });
          report.incrementalBuildCacheResultReceipt = {
            path: resultReceipt.path,
            sha256: resultReceipt.sha256,
            bytes: resultReceipt.bytes,
          };
        } catch (error) {
          report.incrementalBuildCacheReceiptError = (error as Error).message;
          failed = true;
        }
      }
    }
    if (charter === 'session' && controller.signal.aborted) {
      for (const key of [
        'observations',
        'sessionInitialAuth',
        'nativeAuthIdentityEvidence',
        'authMetadataBeforeRelaunch',
        'authMetadataAfterRelaunch',
        'authMetadataAfterCancel',
        'cancelSignoutCheckpoint',
        'relaunchTransport',
        'relaunchTransportRange',
        'authMetadataAfterSignout',
        'nativeLogoutContract',
        'signedOutRelaunchTransport',
        'signedOutRelaunchTransportRange',
        'authMetadataAfterSignedoutRelaunch',
        'sessionSqlBefore',
        'sessionSqlAfterSignedoutRelaunch',
        'sessionSqlBeforeAfterUnchanged',
        'transportEvidence',
        'sessionProfileSnapshots',
        'sessionDomainSnapshots',
        'sessionProfileLoginWindow',
        'sessionProfileRestorationWindow',
        'persistedCoachIdentity',
        'sessionProfileCheckpointVerification',
        'sessionAssertionSequence',
        'sessionUiObservationOrder',
        'sessionViewEvidence',
      ])
        delete report[key];
      report.sessionEvidencePublication = 'aborted-before-complete';
      failed = true;
    }
    if (failed) {
      report.result = cancellation() ? 'cancelled' : 'harness-blocked';
      if (charter === 'session' && report.sessionEvidencePublication === 'complete')
        report.sessionEvidencePublication = 'rejected-terminal-validation';
    }
    beginPhase();
    report.finishedAt = new Date().toISOString();
    await writeFile(path.join(output, 'capture.private.json'), JSON.stringify(report, null, 2), {
      mode: 0o600,
    });
  }
  return {
    artifactRoot: output,
    exitCode:
      cancellation() === 'SIGINT' ? 130 : cancellation() === 'SIGTERM' ? 143 : failed ? 2 : 0,
    report,
  };
}

async function main() {
  process.umask(0o077);
  const controller = new AbortController();
  const onInt = () => controller.abort('SIGINT');
  const onTerm = () => controller.abort('SIGTERM');
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  try {
    const result = await runOwnedIosNativeSession({
      ...parseIosNativeCaptureArguments(process.argv.slice(2)),
      signal: controller.signal,
    });
    process.exitCode = result.exitCode;
  } finally {
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch(() => {
    process.stderr.write('Native inventory startup blocked before observation.\n');
    process.exitCode = 2;
  });
