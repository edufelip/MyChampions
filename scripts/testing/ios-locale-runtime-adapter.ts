import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildIosCredentialEntryActions,
  buildIosPasswordOfferDismissalActions,
} from './capture-native-testability';
import {
  IOS_LANGUAGE_STORAGE_CONTRACT,
  readIosLanguageOverride,
  resetIosLanguageOverride,
  type IosLanguageResetReceipt,
  type IosLanguageStorageObservation,
  type IosOwnedFileReceipt,
  type IosQuiescenceReceipt,
} from './ios-locale-storage';
import {
  parseLocaleContextDiagnosticSubtree,
  type NativeLocaleContextObservation,
} from './locale-context-validator';
import {
  parseNativeLocaleBinding,
  qualifyNativeLocaleEvidence,
  SUPPORTED_NATIVE_LOCALES,
  type NativeLocaleBinding,
  type NativeLocaleEvidence,
  type SupportedNativeLocale,
} from './locale-native-observation';
import { observeIosAuthMetadata } from './native-auth-observation';
import { nativeHierarchyHasAttribute, parseNativeHierarchy } from './native-hierarchy';
import {
  normalizeNativeLocaleCommandOutput,
  type NativeLocaleCommandRead,
} from './native-locale-capture-seam';
import { executeOwnedNativeCommand, type NativeCommandExecution } from './owned-native-command';

export type { IosQuiescenceReceipt } from './ios-locale-storage';

const IOS_BUNDLE_ID = IOS_LANGUAGE_STORAGE_CONTRACT.bundleId;
const CAPTURE_ID = /^[a-f0-9]{24}$/;
const HASH64 = /^[a-f0-9]{64}$/;
function isHash64(value: unknown): value is string {
  return typeof value === 'string' && HASH64.test(value);
}
const SAFE_LABEL = /^[a-z0-9-]{1,96}$/;
const SAFE_ID = /^[A-Za-z0-9._-]{1,256}$/;
const SAFE_OPERATION = /^[A-Za-z0-9._:-]{1,128}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T.*Z$/;
const MAX_COMMAND_OUTPUT = 8 * 1024 * 1024;
const SIGN_IN_PATH_HASH = createHash('sha256').update('/auth/email/sign-in').digest('hex');

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export const IOS_LOCALE_NORMAL_SELECTORS = [
  'tabs.account',
  'settings.account.screen',
  'settings.account.languageRow',
  'settings.languageSelect.screen',
  'settings.languageSelect.option.en-US',
  'settings.languageSelect.option.pt-BR',
  'settings.languageSelect.option.es-ES',
  'settings.languageSelect.saveButton',
] as const;

export type IosLocalePhaseStatus = 'observed' | 'blocked' | 'pending' | 'read-error' | 'unobserved';

export type IosLocalePhaseReceipt = {
  status: IosLocalePhaseStatus;
  captureRunId: string | null;
  operationId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  reason: string | null;
  commandReceiptRefs: readonly IosLocaleCommandReceiptRef[];
};

export type IosLocaleCommandReceiptRef = {
  label: string;
  command: string;
  argv: readonly string[];
  captureRunId: string;
  binding: NativeLocaleBinding;
  pid: number;
  pgid: number;
  deadlineMs: number;
  logSha256: string | null;
  stdoutSha256: string | null;
};

export type IosLocaleFreshTargetReceipt = IosLocalePhaseReceipt & {
  target: NativeLocaleBinding['target'];
  sourceTreeHash: string;
  helperInputsHash: string;
  binaryHash: string;
  buildMode: 'qualified-reuse' | 'qualified-fresh';
  reusedFrom: string | null;
};

export type IosLocaleHierarchyFrame = {
  label: string;
  hierarchyPath: string;
  hierarchyHash: string;
  tree: unknown;
  captureRunId: string;
  binding: NativeLocaleBinding;
  observedAt: string;
};

export type IosLocaleSelectionAudit =
  | { status: 'observed'; selectedLocale: SupportedNativeLocale }
  | {
      status: 'blocked';
      reason:
        | 'language-screen-missing'
        | 'language-screen-ambiguous'
        | 'locale-option-missing'
        | 'locale-option-ambiguous'
        | 'selected-locale-missing'
        | 'selected-locale-ambiguous'
        | 'selected-locale-mismatch';
    };

export type IosLocaleCoachSignInReceipt = {
  status: 'observed';
  role: 'coach';
  fixtureRole: 'professional';
  fixtureAuthUid: string;
  sessionRunId: string;
  signInRequestId: number;
  signInStatus: 201;
  signInPathHash: string;
  apiPid: number;
  apiOrigin: string;
  sessionPresent: true;
  termsAccepted: true;
  acceptedTermsVersion: 'v1';
  sessionEvidence: {
    source: 'ios-auth-storage';
    status: 'session-present';
    profilePresent: true;
    profileAuthUidHash: string;
    observationHash: string;
  };
  termsEvidence: {
    source: 'owned-sql-profile-snapshot';
    acceptedTermsVersion: 'v1';
    lockedRole: 'professional';
    authUidHash: string;
    snapshotHash: string;
    runId: string;
    scope: string;
  };
  homeSelector: 'pro.home.screen';
  homeHierarchy: Pick<
    IosLocaleHierarchyFrame,
    'label' | 'hierarchyPath' | 'hierarchyHash' | 'captureRunId' | 'binding' | 'observedAt'
  > & { selector: 'pro.home.screen' };
  observedAt: string;
};

export type IosLocaleBuildReceipt = {
  /** Entry/build identity is observed separately from locale runtime qualification. */
  qualification: 'qualified' | 'entry-observed' | 'runtime-qualified';
  sourceTreeHash: string;
  helperInputsHash: string;
  binaryHash: string;
  bundleId: typeof IOS_BUNDLE_ID;
  /** App-facing proxy origin bound into the target/build identity. */
  apiOrigin: string;
  /** Owned server origin used by transport and principal receipts. */
  backendApiOrigin: string;
  reusedFrom: string | null;
};

export type IosLocaleCleanupReceipt = {
  status: 'cleaned' | 'failed-recovery-required';
  captureRunId: string;
  attempt: 1;
  ownedResources: readonly string[];
  foreignResourcesPreserved: boolean;
  startedAt: string;
  finishedAt: string;
  failure: null | {
    code: 'cleanup-timeout' | 'cleanup-error' | 'cleanup-invalid-receipt';
    message: string;
    recoveryRequired: true;
    pendingOperation: boolean;
  };
};

export type IosLocaleCommandReceipt = {
  label: string;
  command: string;
  argv: readonly string[];
  execution: NativeCommandExecution['execution'];
  cleanup: NativeCommandExecution['cleanup'];
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  pid: number | null;
  pgid: number | null;
  startedAt: string;
  finishedAt: string;
  deadlineMs: number;
  captureRunId: string;
  binding: NativeLocaleBinding;
  log: IosOwnedFileReceipt | null;
  stdout: IosOwnedFileReceipt | null;
};

export type IosLocaleObservedOsReadback = NativeLocaleEvidence['observedOsLocale'] & {
  checkpoint: string;
  commandReceiptRefs: readonly IosLocaleCommandReceiptRef[];
};

export type IosLocaleAppContainerReceipt = {
  status: 'observed';
  captureRunId: string;
  binding: NativeLocaleBinding;
  path: string;
  uid: number;
  mode: number;
  canonical: true;
  symlink: false;
  observedAt: string;
};

export type IosLocaleOverrideReceipt = NativeLocaleEvidence['override'] & {
  storage: IosLanguageStorageObservation;
  captureRunId: string;
  binding: NativeLocaleBinding;
};

export type IosLocaleClearReceipt = IosLocalePhaseReceipt & {
  storageReset: IosLanguageResetReceipt;
};

export class IosLocaleClearError extends Error {
  constructor(
    public readonly storageReset: Extract<
      IosLanguageResetReceipt,
      { status: 'failed-recovery-required' }
    >,
  ) {
    super(`exact iOS language reset requires recovery: ${storageReset.failure.phase}`);
    this.name = 'IosLocaleClearError';
  }
}

export type IosLocaleRuntimeContext = {
  artifactRoot: string;
  sourceRoot: string;
  cwd: string;
  output: string;
  captureRunId: string;
  binding: NativeLocaleBinding;
  device: { udid: string; runtime: string };
  bundleId: typeof IOS_BUNDLE_ID;
  metroPort: number;
  apiPid: number;
  /** Caller-provided effective step deadline; it must never extend the requested cap. */
  effectiveCommandDeadline: (requestedMs: number) => number;
  env?: NodeJS.ProcessEnv;
  /** Required caller-owned whole-run cancellation/deadline signal. */
  signal: AbortSignal;
  /** The outer capture may retain sole cleanup ownership for an integrated branch. */
  cleanupOwner?: 'scenario' | 'outer-capture';
  /** Existing capture runner hook: host lock and Maestro/ADB liveness gate. */
  beforeCommand?: (
    label: string,
    command: 'xcrun' | 'maestro',
    signal?: AbortSignal,
  ) => Promise<void>;
  afterCommand?: (
    label: string,
    command: 'xcrun' | 'maestro',
    signal?: AbortSignal,
  ) => Promise<void>;
  verifyTarget: (signal?: AbortSignal) => Promise<void>;
  build: IosLocaleBuildReceipt;
  fixtures: {
    accounts: {
      coach: { email: string; password: string; authUid: string; role: string | null };
    };
  };
  sessionRunId: string;
  readAppAuthMetadata: (dataRoot: string, signal?: AbortSignal) => Promise<unknown>;
  readAuthProfileSnapshot: (signal?: AbortSignal) => Promise<unknown>;
  readCoachSignInReceipt: (input: {
    appAuthMetadata: unknown;
    authProfileSnapshot: unknown;
    homeHierarchy: IosLocaleHierarchyFrame;
    signal?: AbortSignal;
  }) => Promise<IosLocaleCoachSignInReceipt>;
  probeQuiescence: (signal?: AbortSignal) => Promise<IosQuiescenceReceipt>;
  readDomainSnapshot: (signal?: AbortSignal) => Promise<unknown>;
  cleanupOwned?: (signal: AbortSignal) => Promise<IosLocaleCleanupReceipt>;
  cleanupDeadlineMs?: number;
};

export type IosLocaleRuntimePhase = IosLocalePhaseReceipt;

export type IosLocaleRuntimeTransport = {
  readonly platform: 'ios';
  readonly contextCleanupOwner: 'scenario' | 'outer-capture';
  prepareFreshTarget(input: { binding: NativeLocaleBinding }): Promise<IosLocaleFreshTargetReceipt>;
  setOsLocale(input: {
    locale: SupportedNativeLocale;
    reason: 'selection-baseline' | 'fallback-reset';
  }): Promise<IosLocaleRuntimePhase>;
  readOsLocale(input: { checkpoint: string }): Promise<IosLocaleObservedOsReadback>;
  readOverride(input: { checkpoint: string }): Promise<IosLocaleOverrideReceipt>;
  launch(input: { checkpoint: string }): Promise<IosLocaleRuntimePhase>;
  runNormalFlow(input: { requestedLocale: SupportedNativeLocale }): Promise<IosLocaleRuntimePhase>;
  captureHierarchy(input: { label: string }): Promise<IosLocaleHierarchyFrame>;
  auditSelection(input: {
    frame: IosLocaleHierarchyFrame;
    requestedLocale: SupportedNativeLocale;
  }): IosLocaleSelectionAudit;
  saveSelection(): Promise<IosLocaleRuntimePhase>;
  clearOverride(): Promise<IosLocaleClearReceipt>;
  cleanup(): Promise<IosLocaleRuntimePhase>;
  cleanupReceipt(): IosLocaleCleanupReceipt | null;
  commandReceipts(): readonly IosLocaleCommandReceipt[];
  appContainerReceipt(): IosLocaleAppContainerReceipt | null;
  coachSignInReceipt(): IosLocaleCoachSignInReceipt | null;
};

type ScenarioId = 'locale-selection-persistence' | 'locale-os-fallback-reset';
type ContextCheckpointId =
  'initial-fallback' | 'selected' | 'persisted' | 'fallback-reset' | 'fallback-reset-persisted';

type ScenarioStep =
  | { kind: 'prepare'; id: 'fresh-target' }
  | {
      kind: 'set-os';
      id: 'set-selection-baseline-os' | 'set-fallback-reset-os';
      locale: SupportedNativeLocale;
      reason: 'selection-baseline' | 'fallback-reset';
    }
  | {
      kind: 'read-os';
      id:
        | 'read-selection-baseline-os'
        | 'read-fallback-reset-os-before-launch'
        | 'read-fallback-reset-os-after-reset';
      expected: SupportedNativeLocale;
    }
  | {
      kind: 'read-override';
      id:
        | 'read-initial-override'
        | 'read-selected-override'
        | 'read-persisted-override'
        | 'read-reset-override'
        | 'read-reset-persisted-override';
      expectedStatus: NativeLocaleEvidence['override']['status'];
      expectedLocale: SupportedNativeLocale | null;
    }
  | { kind: 'launch'; id: 'launch-initial' | 'relaunch-after-selection' | 'relaunch-after-reset' }
  | { kind: 'context'; id: ContextCheckpointId; label: string }
  | { kind: 'run-flow'; id: 'run-locale-selection'; requestedLocale: SupportedNativeLocale }
  | { kind: 'selection'; id: 'capture-selected-language-screen'; label: string }
  | { kind: 'save-selection'; id: 'save-locale-selection' }
  | { kind: 'clear'; id: 'clear-override' }
  | { kind: 'cleanup'; id: 'cleanup' };

export type IosLocaleScenarioInput = {
  scenarioId: ScenarioId;
  requestedLocale: SupportedNativeLocale;
  expectedBinding: NativeLocaleBinding;
  baselineOsLocale?: SupportedNativeLocale;
};

export type IosLocaleCheckpoint = {
  id: ContextCheckpointId;
  frame: IosLocaleHierarchyFrame;
  context: NativeLocaleContextObservation;
  storageOverride: NativeLocaleEvidence['override'] | null;
  qualification: 'eligible' | 'blocked' | 'not-evaluated';
  reason: string | null;
};

export type IosLocaleScenarioResult = {
  kind: 'private-ios-locale-runtime-scenario-result-not-runtime-proof';
  schemaVersion: 3;
  scenarioId: ScenarioId;
  requestedLocale: SupportedNativeLocale;
  baselineOsLocale: SupportedNativeLocale;
  expectedBinding: NativeLocaleBinding;
  status: 'observed' | 'blocked';
  runtimeQualification: 'pending';
  nativePassingCases: 0;
  publicLocale: null;
  freshTarget: IosLocaleFreshTargetReceipt | null;
  phaseReceipts: readonly { id: string; receipt: IosLocalePhaseReceipt }[];
  osReadbacks: readonly {
    checkpoint: string;
    observation: IosLocaleObservedOsReadback;
  }[];
  overrideReadbacks: readonly {
    checkpoint: string;
    observation: IosLocaleOverrideReceipt;
  }[];
  selectionFrames: readonly {
    frame: IosLocaleHierarchyFrame;
    audit: IosLocaleSelectionAudit;
  }[];
  coachSignInReceipt: IosLocaleCoachSignInReceipt | null;
  commandReceipts: readonly IosLocaleCommandReceipt[];
  appContainerReceipts: readonly IosLocaleAppContainerReceipt[];
  resetReceipts: readonly IosLanguageResetReceipt[];
  steps: readonly {
    id: string;
    status: IosLocalePhaseStatus | 'captured' | 'blocked';
    blocker: string | null;
  }[];
  checkpoints: readonly IosLocaleCheckpoint[];
  cleanupAttempted: boolean;
  cleanupObserved: boolean;
  cleanupOwner: 'scenario' | 'outer-capture';
  cleanupReceipt: IosLocaleCleanupReceipt | null;
  cleanupError: string | null;
  blockers: readonly string[];
};

function isSupportedLocale(value: unknown): value is SupportedNativeLocale {
  return SUPPORTED_NATIVE_LOCALES.includes(value as SupportedNativeLocale);
}

function safeAppId(value: string): string {
  if (!SAFE_ID.test(value)) throw new Error('iOS locale app ID is invalid');
  return value;
}

function safeLabel(value: string): string {
  if (!SAFE_LABEL.test(value)) throw new Error('iOS locale operation label is invalid');
  return value;
}

function safeBinding(value: unknown): NativeLocaleBinding {
  return parseNativeLocaleBinding(value);
}

function isoNow(): string {
  return new Date().toISOString();
}

function phase(
  captureRunId: string,
  operationId: string,
  reason: string | null = null,
  commandReceiptRefs: readonly IosLocaleCommandReceiptRef[] = [],
): IosLocalePhaseReceipt {
  if (!CAPTURE_ID.test(captureRunId) || !SAFE_OPERATION.test(operationId))
    throw new Error('iOS locale phase identity is invalid');
  const startedAt = isoNow();
  const finishedAt = isoNow();
  return {
    status: 'observed',
    captureRunId,
    operationId,
    startedAt,
    finishedAt,
    reason,
    commandReceiptRefs,
  };
}

function expectedPhase(receipt: IosLocalePhaseReceipt, captureRunId: string, label: string) {
  if (
    receipt.status !== 'observed' ||
    receipt.captureRunId !== captureRunId ||
    receipt.operationId === null ||
    receipt.startedAt === null ||
    receipt.finishedAt === null ||
    receipt.reason !== null ||
    !ISO.test(receipt.startedAt) ||
    !ISO.test(receipt.finishedAt) ||
    Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)
  )
    throw new Error(`${label} did not return a complete owned phase receipt`);
  return receipt;
}

function requirePhaseCommandReceipts(
  receipt: IosLocalePhaseReceipt,
  commandReceipts: readonly IosLocaleCommandReceipt[],
  label: string,
): void {
  if (
    receipt.commandReceiptRefs.length > 0 &&
    !commandReceiptReferencesMatch(receipt.commandReceiptRefs, commandReceipts)
  )
    throw new Error(
      `${label} command receipt references are not bound to the recorded child processes`,
    );
}

function localeRaw(locale: SupportedNativeLocale): string {
  return ({ 'en-US': 'en_US', 'pt-BR': 'pt_BR', 'es-ES': 'es_ES' } as const)[locale];
}

function localeLanguage(locale: SupportedNativeLocale): 'en' | 'pt' | 'es' {
  return ({ 'en-US': 'en', 'pt-BR': 'pt', 'es-ES': 'es' } as const)[locale];
}

function checkAbort(signal: AbortSignal | undefined, label: string): void {
  if (!signal?.aborted) return;
  const reason: unknown = signal.reason;
  throw reason instanceof Error ? reason : new Error(`iOS locale operation aborted: ${label}`);
}

export function validateIosLocaleEffectiveDeadline(
  requestedMs: number,
  effectiveMs: number,
): number {
  if (
    !Number.isSafeInteger(requestedMs) ||
    requestedMs <= 0 ||
    !Number.isSafeInteger(effectiveMs) ||
    effectiveMs <= 0 ||
    effectiveMs > requestedMs
  )
    throw new Error('iOS locale effective deadline is invalid or extends the requested cap');
  return effectiveMs;
}

/** Parse only the first AppleLanguages array entry; no raw value leaves the packet. */
export function parseIosAppleLanguagesFirst(raw: string): 'en' | 'pt' | 'es' | null {
  if (
    Buffer.byteLength(raw, 'utf8') > 128 ||
    [...raw].some(
      (character) =>
        (character < ' ' && !['\t', '\n', '\r'].includes(character)) || character === '\u007f',
    )
  )
    return null;
  if (raw.includes('\uFFFD')) return null;
  const trimmed = raw.trim();
  if (!/^\(.*\)$/s.test(trimmed)) return null;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return null;
  const entries = body.split(',').map((entry) => entry.trim());
  if (entries.length === 0 || entries.some((entry) => !/^(?:en|pt|es)$/i.test(entry))) return null;
  const first = entries[0].slice(0, 2).toLowerCase();
  return first === 'en' || first === 'pt' || first === 'es' ? first : null;
}

/** Reject a region-only or stale AppleLocale write before app-locale qualification. */
export function requireIosAppleLanguagesMatch(
  locale: SupportedNativeLocale,
  rawAppleLanguages: string,
): void {
  const actual = parseIosAppleLanguagesFirst(rawAppleLanguages);
  if (actual !== localeLanguage(locale))
    throw new Error(
      `iOS AppleLanguages first entry is stale for ${locale}: expected ${localeLanguage(locale)}`,
    );
}

export function buildIosLocaleOsWriteArgv(input: {
  udid: string;
  locale: SupportedNativeLocale;
}): readonly [readonly string[], readonly string[]] {
  if (!/^[A-Fa-f0-9-]{36}$/.test(input.udid) || !isSupportedLocale(input.locale))
    throw new Error('iOS locale OS write identity is invalid');
  return [
    [
      'simctl',
      'spawn',
      input.udid,
      'defaults',
      'write',
      'NSGlobalDomain',
      'AppleLanguages',
      '-array',
      localeLanguage(input.locale),
    ],
    [
      'simctl',
      'spawn',
      input.udid,
      'defaults',
      'write',
      'NSGlobalDomain',
      'AppleLocale',
      localeRaw(input.locale),
    ],
  ];
}

export function buildIosLocaleOsReadArgv(
  udid: string,
): readonly [readonly string[], readonly string[]] {
  if (!/^[A-Fa-f0-9-]{36}$/.test(udid)) throw new Error('iOS locale OS read identity is invalid');
  return [
    ['simctl', 'spawn', udid, 'defaults', 'read', 'NSGlobalDomain', 'AppleLanguages'],
    ['simctl', 'spawn', udid, 'defaults', 'read', 'NSGlobalDomain', 'AppleLocale'],
  ];
}

function iosLocaleReadError(): NativeLocaleEvidence['observedOsLocale'] {
  return {
    status: 'read-error',
    source: 'ios-simctl-defaults',
    raw: null,
    resolved: null,
    normalization: 'none',
  };
}

/** Combine the two current defaults reads without borrowing an older command row. */
export function normalizeIosLocaleReadback(input: {
  binding: NativeLocaleBinding;
  appleLanguages: NativeLocaleCommandRead;
  appleLocale: NativeLocaleCommandRead;
}): NativeLocaleEvidence['observedOsLocale'] {
  const normalized = normalizeNativeLocaleCommandOutput({
    binding: input.binding,
    command: input.appleLocale,
  }).observedOsLocale;
  if (!normalized || normalized.status !== 'observed' || normalized.resolved === null)
    return normalized ?? iosLocaleReadError();
  if (
    !input.appleLanguages.attempted ||
    input.appleLanguages.execution !== 'completed' ||
    input.appleLanguages.cleanup !== 'cleaned' ||
    input.appleLanguages.stdoutText === null
  )
    return iosLocaleReadError();
  try {
    requireIosAppleLanguagesMatch(normalized.resolved, input.appleLanguages.stdoutText);
  } catch {
    return {
      status: 'invalid',
      source: 'ios-simctl-defaults',
      raw: `${normalized.raw ?? ''}|AppleLanguages-stale`,
      resolved: null,
      normalization: 'none',
    };
  }
  return normalized;
}

export function buildIosLocaleTerminateArgv(
  udid: string,
  bundleId = IOS_BUNDLE_ID,
): readonly string[] {
  if (!/^[A-Fa-f0-9-]{36}$/.test(udid) || bundleId !== IOS_BUNDLE_ID)
    throw new Error('iOS locale terminate identity is invalid');
  return ['simctl', 'terminate', udid, bundleId];
}

export function buildIosLocaleLaunchArgv(
  udid: string,
  bundleId: string,
  metroPort: number,
): readonly string[] {
  if (
    !/^[A-Fa-f0-9-]{36}$/.test(udid) ||
    bundleId !== IOS_BUNDLE_ID ||
    !Number.isSafeInteger(metroPort) ||
    metroPort < 1024 ||
    metroPort > 65535
  )
    throw new Error('iOS locale launch identity is invalid');
  return [
    'simctl',
    'launch',
    '--terminate-running-process',
    udid,
    bundleId,
    '-RCT_jsLocation',
    `localhost:${metroPort}`,
  ];
}

export function buildIosLocaleHierarchyArgv(udid: string): readonly string[] {
  if (!/^[A-Fa-f0-9-]{36}$/.test(udid)) throw new Error('iOS locale hierarchy identity is invalid');
  return ['--no-ansi', '--udid', udid, 'hierarchy'];
}

function buildSelectionFlow(appId: string, requestedLocale: SupportedNativeLocale): string {
  const options = SUPPORTED_NATIVE_LOCALES.map(
    (locale) => `- assertVisible:\n    id: settings.languageSelect.option.${locale}`,
  ).join('\n');
  return [
    `appId: ${JSON.stringify(safeAppId(appId))}`,
    'name: "Locale account selection"',
    '---',
    '- tapOn:',
    '    id: tabs.account',
    '- extendedWaitUntil:',
    '    visible:',
    '      id: settings.account.screen',
    '    timeout: 90000',
    '- tapOn:',
    '    id: settings.account.languageRow',
    '- extendedWaitUntil:',
    '    visible:',
    '      id: settings.languageSelect.screen',
    '    timeout: 90000',
    options,
    '- tapOn:',
    `    id: settings.languageSelect.option.${requestedLocale}`,
    '- assertVisible:',
    `    id: settings.languageSelect.option.${requestedLocale}.checkmark`,
  ].join('\n');
}

export const buildIosLocaleSelectionFlow = buildSelectionFlow;

function buildSaveFlow(appId: string): string {
  return [
    `appId: ${JSON.stringify(safeAppId(appId))}`,
    'name: "Locale account selection save"',
    '---',
    '- tapOn:',
    '    id: settings.languageSelect.saveButton',
    '- extendedWaitUntil:',
    '    visible:',
    '      id: settings.account.screen',
    '    timeout: 90000',
  ].join('\n');
}

export const buildIosLocaleSaveFlow = buildSaveFlow;

function buildCoachLoginFlow(appId: string, email: string, password: string): string {
  return [
    `appId: ${JSON.stringify(safeAppId(appId))}`,
    'name: "Locale coach authentication"',
    '---',
    buildIosCredentialEntryActions(email, password),
    buildIosPasswordOfferDismissalActions(),
    '- extendedWaitUntil:',
    '    visible:',
    '      id: pro.home.screen',
    '    timeout: 90000',
  ].join('\n');
}

export const buildIosLocaleCoachLoginFlow = buildCoachLoginFlow;

function directOutputPath(root: string, candidate: string): string {
  const file = path.resolve(root, candidate);
  if (
    path.dirname(file) !== path.resolve(root) ||
    !SAFE_LABEL.test(path.basename(file).split('.')[0])
  )
    throw new Error('iOS locale command output path is not a direct safe child');
  return file;
}

async function readPrivateText(
  root: string,
  file: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<string> {
  const requestedFile = path.isAbsolute(file) ? file : path.resolve(root, file);
  checkAbort(signal, `before-private-read:${path.basename(requestedFile)}`);
  const canonicalRoot = await realpath(root);
  checkAbort(signal, `after-private-root-realpath:${path.basename(requestedFile)}`);
  const rootMeta = await lstat(canonicalRoot);
  checkAbort(signal, `after-private-root-stat:${path.basename(requestedFile)}`);
  const canonicalFile = await realpath(requestedFile);
  checkAbort(signal, `after-private-file-realpath:${path.basename(requestedFile)}`);
  const metadata = await lstat(requestedFile);
  checkAbort(signal, `after-private-file-stat:${path.basename(requestedFile)}`);
  if (
    canonicalRoot !== path.resolve(root) ||
    !rootMeta.isDirectory() ||
    (rootMeta.mode & 0o777) !== 0o700 ||
    (process.getuid !== undefined && rootMeta.uid !== process.getuid()) ||
    canonicalFile !== path.resolve(requestedFile) ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600 ||
    (process.getuid !== undefined && metadata.uid !== process.getuid()) ||
    metadata.size > maxBytes
  )
    throw new Error('iOS locale command output is not a bounded private file');
  checkAbort(signal, `before-private-read-bytes:${path.basename(requestedFile)}`);
  const bytes = await readFile(canonicalFile, { signal });
  checkAbort(signal, `after-private-read-bytes:${path.basename(requestedFile)}`);
  if (bytes.byteLength !== metadata.size)
    throw new Error('iOS locale command output changed while reading');
  const text = bytes.toString('utf8');
  if (text.includes('\uFFFD')) throw new Error('iOS locale command output is not valid UTF-8');
  return text;
}

async function readOwnedArtifact(
  root: string,
  file: string,
  maxBytes = MAX_COMMAND_OUTPUT,
  signal?: AbortSignal,
): Promise<IosOwnedFileReceipt> {
  const requestedFile = path.isAbsolute(file) ? file : path.resolve(root, file);
  checkAbort(signal, `before-owned-artifact-read:${path.basename(requestedFile)}`);
  const canonicalRoot = await realpath(root);
  checkAbort(signal, `after-owned-root-realpath:${path.basename(requestedFile)}`);
  const rootMeta = await lstat(canonicalRoot);
  checkAbort(signal, `after-owned-root-stat:${path.basename(requestedFile)}`);
  const canonicalFile = await realpath(requestedFile);
  checkAbort(signal, `after-owned-file-realpath:${path.basename(requestedFile)}`);
  const metadata = await lstat(requestedFile);
  checkAbort(signal, `after-owned-file-stat:${path.basename(requestedFile)}`);
  if (
    canonicalRoot !== path.resolve(root) ||
    !rootMeta.isDirectory() ||
    (rootMeta.mode & 0o777) !== 0o700 ||
    (process.getuid !== undefined && rootMeta.uid !== process.getuid()) ||
    path.dirname(canonicalFile) !== canonicalRoot ||
    canonicalFile !== path.resolve(requestedFile) ||
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600 ||
    (process.getuid !== undefined && metadata.uid !== process.getuid()) ||
    metadata.size > maxBytes
  )
    throw new Error('iOS locale artifact is not a bounded owned private file');
  checkAbort(signal, `before-owned-artifact-read-bytes:${path.basename(requestedFile)}`);
  const bytes = await readFile(canonicalFile, { signal });
  checkAbort(signal, `after-owned-artifact-read-bytes:${path.basename(requestedFile)}`);
  if (bytes.byteLength !== metadata.size)
    throw new Error('iOS locale artifact changed while reading');
  return {
    path: path.relative(canonicalRoot, canonicalFile),
    uid: metadata.uid,
    mode: metadata.mode & 0o777,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    canonical: true,
    symlink: false,
  };
}

function requireCommandSuccess(result: NativeCommandExecution, label: string) {
  if (result.execution !== 'completed' || result.cleanup !== 'cleaned' || result.logPath === null)
    throw new Error(`${label} execution=${result.execution} cleanup=${result.cleanup}`);
  return result;
}

export function commandReceiptReferencesMatch(
  refs: readonly IosLocaleCommandReceiptRef[],
  receipts: readonly IosLocaleCommandReceipt[],
): boolean {
  if (refs.length === 0) return false;
  if (new Set(refs.map((ref) => ref.label)).size !== refs.length) return false;
  return refs.every((ref) => {
    const receipt = receipts.find((candidate) => candidate.label === ref.label);
    return Boolean(
      receipt &&
      receipt.execution === 'completed' &&
      receipt.cleanup === 'cleaned' &&
      receipt.command === ref.command &&
      JSON.stringify(receipt.argv) === JSON.stringify(ref.argv) &&
      receipt.captureRunId === ref.captureRunId &&
      JSON.stringify(receipt.binding) === JSON.stringify(ref.binding) &&
      typeof receipt.pid === 'number' &&
      Number.isSafeInteger(receipt.pid) &&
      receipt.pid > 0 &&
      typeof receipt.pgid === 'number' &&
      Number.isSafeInteger(receipt.pgid) &&
      receipt.pgid > 0 &&
      receipt.pid === ref.pid &&
      receipt.pgid === ref.pgid &&
      receipt.deadlineMs === ref.deadlineMs &&
      (receipt.log?.sha256 ?? null) === ref.logSha256 &&
      (receipt.stdout?.sha256 ?? null) === ref.stdoutSha256,
    );
  });
}

function requireCoachSignInReceipt(
  value: unknown,
  expected: {
    sessionRunId: string;
    captureRunId: string;
    fixtureAuthUid: string;
    apiPid: number;
    apiOrigin: string;
    binding: NativeLocaleBinding;
  },
): IosLocaleCoachSignInReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('coach sign-in receipt is malformed');
  const row = value as Record<string, unknown>;
  if (
    row.status !== 'observed' ||
    row.role !== 'coach' ||
    row.fixtureRole !== 'professional' ||
    row.fixtureAuthUid !== expected.fixtureAuthUid ||
    row.sessionRunId !== expected.sessionRunId ||
    !Number.isSafeInteger(row.signInRequestId) ||
    (row.signInRequestId as number) <= 0 ||
    row.signInStatus !== 201 ||
    row.signInPathHash !== SIGN_IN_PATH_HASH ||
    row.apiPid !== expected.apiPid ||
    row.apiOrigin !== expected.apiOrigin ||
    row.sessionPresent !== true ||
    row.termsAccepted !== true ||
    row.acceptedTermsVersion !== 'v1' ||
    !row.sessionEvidence ||
    typeof row.sessionEvidence !== 'object' ||
    (row.sessionEvidence as Record<string, unknown>).source !== 'ios-auth-storage' ||
    (row.sessionEvidence as Record<string, unknown>).status !== 'session-present' ||
    (row.sessionEvidence as Record<string, unknown>).profilePresent !== true ||
    (row.sessionEvidence as Record<string, unknown>).profileAuthUidHash !==
      createHash('sha256').update(expected.fixtureAuthUid).digest('hex') ||
    !isHash64((row.sessionEvidence as Record<string, unknown>).observationHash) ||
    !row.termsEvidence ||
    typeof row.termsEvidence !== 'object' ||
    (row.termsEvidence as Record<string, unknown>).source !== 'owned-sql-profile-snapshot' ||
    (row.termsEvidence as Record<string, unknown>).acceptedTermsVersion !== 'v1' ||
    (row.termsEvidence as Record<string, unknown>).lockedRole !== 'professional' ||
    (row.termsEvidence as Record<string, unknown>).authUidHash !==
      createHash('sha256').update(expected.fixtureAuthUid).digest('hex') ||
    !isHash64((row.termsEvidence as Record<string, unknown>).authUidHash) ||
    !isHash64((row.termsEvidence as Record<string, unknown>).snapshotHash) ||
    (row.termsEvidence as Record<string, unknown>).runId !== expected.sessionRunId ||
    (row.termsEvidence as Record<string, unknown>).scope !== 'native-entry-ios' ||
    row.homeSelector !== 'pro.home.screen' ||
    !row.homeHierarchy ||
    typeof row.homeHierarchy !== 'object' ||
    Array.isArray(row.homeHierarchy) ||
    (row.homeHierarchy as Record<string, unknown>).selector !== 'pro.home.screen' ||
    (row.homeHierarchy as Record<string, unknown>).captureRunId !== expected.captureRunId ||
    typeof (row.homeHierarchy as Record<string, unknown>).label !== 'string' ||
    typeof (row.homeHierarchy as Record<string, unknown>).hierarchyPath !== 'string' ||
    !isHash64((row.homeHierarchy as Record<string, unknown>).hierarchyHash) ||
    typeof row.observedAt !== 'string' ||
    !ISO.test(row.observedAt)
  )
    throw new Error('coach sign-in receipt is unbound, incomplete or mismatched');
  const homeHierarchy = row.homeHierarchy as Record<string, unknown>;
  const homeBinding = safeBinding(homeHierarchy.binding);
  if (JSON.stringify(homeBinding) !== JSON.stringify(expected.binding))
    throw new Error('coach home hierarchy binding differs from the current locale binding');
  return row as unknown as IosLocaleCoachSignInReceipt;
}

export const validateIosLocaleCoachSignInReceipt = requireCoachSignInReceipt;

function flattenIds(value: unknown): string[] {
  const ids: string[] = [];
  const queue: unknown[] = [value];
  const seen = new Set<object>();
  while (queue.length > 0) {
    const current = queue.pop();
    if (!current || typeof current !== 'object' || Array.isArray(current)) continue;
    if (seen.has(current)) continue;
    seen.add(current);
    const node = current as { attributes?: Record<string, unknown>; children?: unknown[] };
    const attributes = node.attributes;
    const id =
      attributes?.['resource-id'] ??
      attributes?.testID ??
      attributes?.identifier ??
      attributes?.['accessibility-id'];
    if (typeof id === 'string' && id.length > 0) ids.push(id.replace(/^[^:]+:id\//, ''));
    if (Array.isArray(node.children)) queue.push(...node.children);
  }
  return ids;
}

/** Audit the pre-save language screen separately from the hydrated context. */
export function auditIosLocaleSelectionControls(
  tree: unknown,
  requestedLocale: SupportedNativeLocale,
): IosLocaleSelectionAudit {
  const ids = flattenIds(tree);
  const screenCount = ids.filter((id) => id === 'settings.languageSelect.screen').length;
  if (screenCount === 0) return { status: 'blocked', reason: 'language-screen-missing' };
  if (screenCount > 1) return { status: 'blocked', reason: 'language-screen-ambiguous' };
  for (const locale of SUPPORTED_NATIVE_LOCALES) {
    const count = ids.filter((id) => id === `settings.languageSelect.option.${locale}`).length;
    if (count === 0) return { status: 'blocked', reason: 'locale-option-missing' };
    if (count > 1) return { status: 'blocked', reason: 'locale-option-ambiguous' };
  }
  const selected = SUPPORTED_NATIVE_LOCALES.filter(
    (locale) =>
      ids.filter((id) => id === `settings.languageSelect.option.${locale}.checkmark`).length > 0,
  );
  if (selected.length === 0) return { status: 'blocked', reason: 'selected-locale-missing' };
  if (selected.length > 1 || ids.filter((id) => id.endsWith('.checkmark')).length !== 1)
    return { status: 'blocked', reason: 'selected-locale-ambiguous' };
  if (selected[0] !== requestedLocale)
    return { status: 'blocked', reason: 'selected-locale-mismatch' };
  return { status: 'observed', selectedLocale: selected[0] };
}

export function createIosLocaleOwnedTransport(
  context: IosLocaleRuntimeContext,
): IosLocaleRuntimeTransport {
  const binding = safeBinding(context.binding);
  const cleanupOwner = context.cleanupOwner ?? 'scenario';
  if (!(context.signal instanceof AbortSignal))
    throw new Error('iOS locale owned context requires a caller-owned AbortSignal');
  if (
    context.bundleId !== IOS_BUNDLE_ID ||
    binding.target.platform !== 'ios' ||
    binding.target.deviceId !== context.device.udid ||
    binding.target.appId !== context.bundleId ||
    binding.target.apiOrigin !== context.build.apiOrigin ||
    context.build.bundleId !== IOS_BUNDLE_ID ||
    !/^https?:\/\/127\.0\.0\.1:\d+$/.test(context.build.backendApiOrigin) ||
    context.build.binaryHash !== binding.target.binaryHash ||
    context.build.sourceTreeHash !== binding.sourceTreeHash ||
    context.build.helperInputsHash !== binding.helperInputsHash ||
    !CAPTURE_ID.test(context.sessionRunId) ||
    (context.build.reusedFrom !== null && !CAPTURE_ID.test(context.build.reusedFrom)) ||
    (cleanupOwner === 'scenario' && typeof context.cleanupOwned !== 'function')
  )
    throw new Error('iOS locale owned context does not match its binding');
  const env = { ...process.env, ...context.env, MAESTRO_CLI_NO_ANALYTICS: 'true' };
  const commandRecords: {
    label: string;
    command: string;
    argv: readonly string[];
    result: NativeCommandExecution;
    startedAt: string;
    finishedAt: string;
    deadlineMs: number;
    captureRunId: string;
    binding: NativeLocaleBinding;
    log: IosOwnedFileReceipt | null;
    stdout: IosOwnedFileReceipt | null;
  }[] = [];
  let commandOrdinal = 0;
  let dataRoot: string | null = null;
  let dataContainerReceipt: IosLocaleAppContainerReceipt | null = null;
  let cleanupAttempt: Promise<IosLocaleCleanupReceipt> | undefined;
  let cleanupReceiptValue: IosLocaleCleanupReceipt | null = null;
  let lastCoachReceipt: IosLocaleCoachSignInReceipt | null = null;
  const commandReceiptRef = (row: {
    label: string;
    command: string;
    argv: readonly string[];
    deadlineMs: number;
    captureRunId: string;
    binding: NativeLocaleBinding;
    result: NativeCommandExecution;
    log: IosOwnedFileReceipt | null;
    stdout: IosOwnedFileReceipt | null;
  }): IosLocaleCommandReceiptRef => {
    const pid = row.result.pid;
    const pgid = row.result.pgid;
    if (
      typeof pid !== 'number' ||
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      typeof pgid !== 'number' ||
      !Number.isSafeInteger(pgid) ||
      pgid <= 0
    )
      throw new Error(`${row.label} did not return positive PID/PGID process identity`);
    return {
      label: row.label,
      command: row.command,
      argv: [...row.argv],
      captureRunId: row.captureRunId,
      binding: row.binding,
      pid,
      pgid,
      deadlineMs: row.deadlineMs,
      logSha256: row.log?.sha256 ?? null,
      stdoutSha256: row.stdout?.sha256 ?? null,
    };
  };
  const refsSince = (start: number) => commandRecords.slice(start).map(commandReceiptRef);

  const command = async (
    labelBase: string,
    executable: string,
    argv: readonly string[],
    timeoutMs: number,
    stdoutFile?: string,
  ): Promise<NativeCommandExecution> => {
    const label = `${safeLabel(labelBase)}-${++commandOrdinal}`;
    checkAbort(context.signal, `${label}-before-target`);
    await context.verifyTarget(context.signal);
    checkAbort(context.signal, `${label}-after-target`);
    await context.beforeCommand?.(
      label,
      executable === 'maestro' ? 'maestro' : 'xcrun',
      context.signal,
    );
    checkAbort(context.signal, `${label}-before-execute`);
    const startedAt = isoNow();
    const deadlineMs = validateIosLocaleEffectiveDeadline(
      timeoutMs,
      context.effectiveCommandDeadline(timeoutMs),
    );
    const result = await executeOwnedNativeCommand({
      command: executable,
      argv: [...argv],
      artifactRoot: context.artifactRoot,
      label,
      env,
      cwd: context.cwd,
      deadlineMs,
      signal: context.signal,
      phase: 'step',
      ...(stdoutFile ? { stdoutPath: stdoutFile } : {}),
    });
    const finishedAt = isoNow();
    const log = result.logPath
      ? await readOwnedArtifact(
          context.artifactRoot,
          result.logPath,
          MAX_COMMAND_OUTPUT,
          context.signal,
        )
      : null;
    const stdout = result.stdoutPath
      ? await readOwnedArtifact(
          context.artifactRoot,
          result.stdoutPath,
          MAX_COMMAND_OUTPUT,
          context.signal,
        )
      : null;
    commandRecords.push({
      label,
      command: executable,
      argv: [...argv],
      result,
      startedAt,
      finishedAt,
      deadlineMs,
      captureRunId: context.captureRunId,
      binding,
      log,
      stdout,
    });
    checkAbort(context.signal, `${label}-after-execute`);
    requireCommandSuccess(result, label);
    await context.verifyTarget(context.signal);
    checkAbort(context.signal, `${label}-after-verify`);
    await context.afterCommand?.(
      label,
      executable === 'maestro' ? 'maestro' : 'xcrun',
      context.signal,
    );
    checkAbort(context.signal, `${label}-before-return`);
    return result;
  };

  const appContainer = async (): Promise<string> => {
    checkAbort(context.signal, 'app-container-before-command');
    if (dataRoot !== null) return dataRoot;
    const stdoutFile = directOutputPath(context.artifactRoot, 'locale-app-container.stdout');
    const result = await command(
      'locale-app-container',
      'xcrun',
      ['simctl', 'get_app_container', context.device.udid, context.bundleId, 'data'],
      15_000,
      stdoutFile,
    );
    checkAbort(context.signal, 'app-container-after-command');
    const raw = await readPrivateText(
      context.artifactRoot,
      result.stdoutPath ?? stdoutFile,
      4096,
      context.signal,
    );
    checkAbort(context.signal, 'app-container-after-stdout-read');
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length !== 1 || !lines[0].startsWith('/'))
      throw new Error('iOS app data container output is invalid');
    dataRoot = await realpath(lines[0]);
    checkAbort(context.signal, 'app-container-after-realpath');
    const metadata = await lstat(dataRoot);
    checkAbort(context.signal, 'app-container-after-stat');
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (process.getuid !== undefined && metadata.uid !== process.getuid())
    )
      throw new Error('iOS app data container is not an owned canonical directory');
    dataContainerReceipt = {
      status: 'observed',
      captureRunId: context.captureRunId,
      binding,
      path: dataRoot,
      uid: metadata.uid,
      mode: metadata.mode & 0o777,
      canonical: true,
      symlink: false,
      observedAt: isoNow(),
    };
    return dataRoot;
  };

  const runMaestro = async (label: string, yaml: string): Promise<NativeCommandExecution> => {
    const safe = safeLabel(label);
    checkAbort(context.signal, `${safe}-before-flow-write`);
    const flowPath = path.join(context.output, `${safe}.yaml`);
    await writeFile(flowPath, yaml, { flag: 'wx', mode: 0o600, signal: context.signal });
    checkAbort(context.signal, `${safe}-after-flow-write`);
    const debugDirectory = path.join(context.output, `${safe}-debug`);
    const artifactDirectory = path.join(context.output, `${safe}-artifacts`);
    return command(
      safe,
      'maestro',
      [
        '--no-ansi',
        '--udid',
        context.device.udid,
        'test',
        '--debug-output',
        debugDirectory,
        '--test-output-dir',
        artifactDirectory,
        flowPath,
      ],
      300_000,
    );
  };

  const readOs = async (checkpoint: string): Promise<IosLocaleObservedOsReadback> => {
    const [languagesArgv, localeArgv] = buildIosLocaleOsReadArgv(context.device.udid);
    const readOne = async (labelBase: string, argv: readonly string[]) => {
      const invocationOrdinal = commandOrdinal + 1;
      const stdoutFile = directOutputPath(
        context.artifactRoot,
        `locale-os-read-${labelBase}-${invocationOrdinal}.stdout`,
      );
      let returned: NativeCommandExecution | undefined;
      try {
        returned = await command(labelBase, 'xcrun', argv, 15_000, stdoutFile);
      } catch {
        // A target or pre-command failure may produce no command row. Bind only
        // the exact label for this invocation; never reuse a prior read.
      }
      const label = `${safeLabel(labelBase)}-${invocationOrdinal}`;
      const recordedRow = commandRecords.find((row) => row.label === label);
      const recorded = recordedRow?.result;
      const result = returned ?? recorded;
      let stdoutText: string | null = null;
      if (result?.stdoutPath) {
        try {
          const stdoutPath = path.isAbsolute(result.stdoutPath)
            ? result.stdoutPath
            : path.resolve(context.artifactRoot, result.stdoutPath);
          stdoutText = await readPrivateText(
            context.artifactRoot,
            stdoutPath,
            4096,
            context.signal,
          );
        } catch (error) {
          if (context.signal?.aborted) throw error;
          stdoutText = null;
        }
      }
      checkAbort(context.signal, `${label}-after-stdout-read`);
      return {
        result,
        stdoutText,
        receiptRef: recordedRow ? commandReceiptRef(recordedRow) : null,
        command: {
          execution: result?.execution ?? 'harness-blocked',
          cleanup: result?.cleanup ?? 'unknown',
          attempted: result !== undefined,
          stdoutText,
          childExitCode: result?.childExitCode ?? null,
          childSignal: result?.childSignal ?? null,
          pid: result?.pid ?? null,
          pgid: result?.pgid ?? null,
          logPath: result?.logPath ?? null,
          stdoutPath: result?.stdoutPath ?? null,
        } satisfies NativeLocaleCommandRead,
      };
    };

    const languages = await readOne('locale-os-read-languages', languagesArgv);
    const locale = await readOne('locale-os-read-locale', localeArgv);
    const observed = normalizeIosLocaleReadback({
      binding,
      appleLanguages: languages.command,
      appleLocale: locale.command,
    });
    checkAbort(context.signal, 'locale-os-read-before-return');
    return {
      ...observed,
      checkpoint,
      commandReceiptRefs: [languages.receiptRef, locale.receiptRef].filter(
        (ref): ref is IosLocaleCommandReceiptRef => ref !== null,
      ),
    };
  };

  const terminateForReset = async (): Promise<IosQuiescenceReceipt> => {
    await command(
      'locale-reset-terminate',
      'xcrun',
      buildIosLocaleTerminateArgv(context.device.udid, context.bundleId),
      30_000,
    );
    checkAbort(context.signal, 'clear-before-quiescence-probe');
    const receipt = await context.probeQuiescence(context.signal);
    checkAbort(context.signal, 'clear-after-quiescence-probe');
    if (
      receipt.status !== 'terminated' ||
      receipt.captureRunId !== context.captureRunId ||
      receipt.deviceId !== context.device.udid ||
      receipt.bundleId !== context.bundleId ||
      receipt.appRunning !== false
    )
      throw new Error('iOS locale quiescence probe is unbound or app-running');
    return receipt;
  };

  const captureHierarchyFrame = async (inputLabel: string): Promise<IosLocaleHierarchyFrame> => {
    const label = safeLabel(inputLabel);
    checkAbort(context.signal, `${label}-before-hierarchy-command`);
    const stdoutFile = directOutputPath(context.artifactRoot, `${label}-hierarchy.stdout`);
    const result = await command(
      `${label}-hierarchy`,
      'maestro',
      buildIosLocaleHierarchyArgv(context.device.udid),
      120_000,
      stdoutFile,
    );
    checkAbort(context.signal, `${label}-after-hierarchy-command`);
    const text = await readPrivateText(
      context.artifactRoot,
      result.stdoutPath ?? stdoutFile,
      MAX_COMMAND_OUTPUT,
      context.signal,
    );
    checkAbort(context.signal, `${label}-after-hierarchy-read`);
    const tree = parseNativeHierarchy(text);
    const bytes = Buffer.from(JSON.stringify(tree));
    const hierarchyPath = `${label}-hierarchy.json`;
    checkAbort(context.signal, `${label}-before-hierarchy-write`);
    await writeFile(path.join(context.output, hierarchyPath), bytes, {
      flag: 'wx',
      mode: 0o600,
      signal: context.signal,
    });
    checkAbort(context.signal, `${label}-after-hierarchy-write`);
    checkAbort(context.signal, `${label}-before-hierarchy-receipt`);
    return {
      label,
      hierarchyPath,
      hierarchyHash: createHash('sha256').update(bytes).digest('hex'),
      tree,
      captureRunId: context.captureRunId,
      binding,
      observedAt: isoNow(),
    };
  };

  return {
    platform: 'ios',
    contextCleanupOwner: cleanupOwner,
    async prepareFreshTarget(input) {
      const expected = safeBinding(input.binding);
      checkAbort(context.signal, 'fresh-target-before-verify');
      await context.verifyTarget(context.signal);
      checkAbort(context.signal, 'fresh-target-after-verify');
      if (
        JSON.stringify(expected) !== JSON.stringify(binding) ||
        context.build.sourceTreeHash !== expected.sourceTreeHash ||
        context.build.helperInputsHash !== expected.helperInputsHash ||
        context.build.binaryHash !== expected.target.binaryHash ||
        context.build.bundleId !== expected.target.appId ||
        context.build.apiOrigin !== expected.target.apiOrigin
      )
        throw new Error('iOS locale build/source/target identity is stale');
      const base = phase(context.captureRunId, 'fresh-target');
      return {
        ...base,
        target: expected.target,
        sourceTreeHash: expected.sourceTreeHash,
        helperInputsHash: expected.helperInputsHash,
        binaryHash: expected.target.binaryHash,
        buildMode: context.build.reusedFrom === null ? 'qualified-fresh' : 'qualified-reuse',
        reusedFrom: context.build.reusedFrom,
      };
    },
    async setOsLocale(input) {
      if (!isSupportedLocale(input.locale)) throw new Error('iOS locale OS locale is unsupported');
      const [languagesArgv, localeArgv] = buildIosLocaleOsWriteArgv({
        udid: context.device.udid,
        locale: input.locale,
      });
      const label = input.reason === 'selection-baseline' ? 'baseline' : 'reset';
      const commandStart = commandRecords.length;
      await command(`locale-os-write-${label}-languages`, 'xcrun', languagesArgv, 15_000);
      await command(`locale-os-write-${label}-locale`, 'xcrun', localeArgv, 15_000);
      checkAbort(context.signal, `locale-os-write-${label}-before-receipt`);
      return phase(context.captureRunId, `set-os-${input.reason}`, null, refsSince(commandStart));
    },
    async readOsLocale(input) {
      return readOs(input.checkpoint);
    },
    async readOverride() {
      checkAbort(context.signal, 'override-before-container');
      const root = await appContainer();
      checkAbort(context.signal, 'override-before-storage-read');
      const observation = await readIosLanguageOverride(root, context.bundleId, context.signal);
      checkAbort(context.signal, 'override-after-storage-read');
      return {
        status: observation.status,
        source: 'language-storage' as const,
        value: observation.status === 'present' ? observation.value : null,
        storage: observation,
        captureRunId: context.captureRunId,
        binding,
      };
    },
    async launch(input) {
      const commandStart = commandRecords.length;
      if (input.checkpoint !== 'launch-initial') {
        await command(
          'locale-relaunch-terminate',
          'xcrun',
          buildIosLocaleTerminateArgv(context.device.udid, context.bundleId),
          30_000,
        );
      }
      await command(
        input.checkpoint === 'launch-initial' ? 'locale-launch-initial' : 'locale-relaunch-launch',
        'xcrun',
        buildIosLocaleLaunchArgv(context.device.udid, context.bundleId, context.metroPort),
        30_000,
      );
      return phase(
        context.captureRunId,
        `launch-${input.checkpoint}`,
        null,
        refsSince(commandStart),
      );
    },
    async runNormalFlow(input) {
      const coach = context.fixtures.accounts.coach;
      if (!coach || !coach.email || !coach.password || !coach.authUid)
        throw new Error('locale flow requires a bound coach fixture identity');
      const commandStart = commandRecords.length;
      await runMaestro(
        'locale-coach-login',
        buildCoachLoginFlow(context.bundleId, coach.email, coach.password),
      );
      const homeHierarchy = await captureHierarchyFrame('locale-coach-home');
      if (!nativeHierarchyHasAttribute(homeHierarchy.tree, 'resource-id', 'pro.home.screen'))
        throw new Error('Locale coach login did not produce the current hydrated home hierarchy');
      const root = await appContainer();
      const auth = await context.readAppAuthMetadata(root, context.signal);
      checkAbort(context.signal, 'locale-coach-auth-after-storage-read');
      const profile = await context.readAuthProfileSnapshot(context.signal);
      checkAbort(context.signal, 'locale-coach-profile-after-sql-read');
      const rawSignIn = await context.readCoachSignInReceipt({
        appAuthMetadata: auth,
        authProfileSnapshot: profile,
        homeHierarchy,
        signal: context.signal,
      });
      checkAbort(context.signal, 'locale-coach-sign-in-receipt-after-read');
      const signIn = requireCoachSignInReceipt(rawSignIn, {
        sessionRunId: context.sessionRunId,
        captureRunId: context.captureRunId,
        fixtureAuthUid: coach.authUid,
        apiPid: context.apiPid,
        apiOrigin: context.build.backendApiOrigin,
        binding,
      });
      checkAbort(context.signal, 'locale-coach-sign-in-receipt-after-validate');
      if (signIn.fixtureAuthUid !== coach.authUid)
        throw new Error('locale coach fixture identity mismatch');
      lastCoachReceipt = signIn;
      await runMaestro(
        'locale-account-language',
        buildSelectionFlow(context.bundleId, input.requestedLocale),
      );
      return phase(context.captureRunId, 'run-locale-selection', null, refsSince(commandStart));
    },
    async captureHierarchy(input) {
      return captureHierarchyFrame(input.label);
    },
    auditSelection(input) {
      return auditIosLocaleSelectionControls(input.frame.tree, input.requestedLocale);
    },
    async saveSelection() {
      const commandStart = commandRecords.length;
      await runMaestro('locale-account-language-save', buildSaveFlow(context.bundleId));
      return phase(context.captureRunId, 'save-locale-selection', null, refsSince(commandStart));
    },
    async clearOverride() {
      checkAbort(context.signal, 'clear-before-terminate');
      const commandStart = commandRecords.length;
      const quiescence = await terminateForReset();
      checkAbort(context.signal, 'clear-after-terminate');
      const root = await appContainer();
      checkAbort(context.signal, 'clear-before-auth-read');
      const authBefore = await observeIosAuthMetadata(root, context.bundleId, context.signal);
      checkAbort(context.signal, 'clear-after-auth-read');
      checkAbort(context.signal, 'clear-before-domain-read');
      const domainBefore = await context.readDomainSnapshot(context.signal);
      checkAbort(context.signal, 'clear-after-domain-read');
      const reset = await resetIosLanguageOverride({
        dataRoot: root,
        bundleId: context.bundleId,
        quiescence,
        captureRunId: context.captureRunId,
        deviceId: context.device.udid,
        authBefore,
        domainBefore,
        readAuthAfter: (signal) => observeIosAuthMetadata(root, context.bundleId, signal),
        readDomainAfter: (signal) => context.readDomainSnapshot(signal),
        signal: context.signal,
      });
      checkAbort(context.signal, 'clear-after-reset');
      if (reset.status !== 'observed') throw new IosLocaleClearError(reset);
      checkAbort(context.signal, 'clear-before-receipt');
      return {
        ...phase(context.captureRunId, 'clear-override', null, refsSince(commandStart)),
        storageReset: reset,
      };
    },
    async cleanup() {
      if (cleanupOwner === 'outer-capture')
        throw new Error('iOS locale cleanup is owned by the outer capture lifecycle');
      const cleanupOwned = context.cleanupOwned;
      if (!cleanupOwned) throw new Error('iOS locale scenario cleanup callback is unavailable');
      if (!cleanupAttempt) {
        const cleanupDeadlineMs = context.cleanupDeadlineMs ?? 300_000;
        if (
          !Number.isSafeInteger(cleanupDeadlineMs) ||
          cleanupDeadlineMs <= 0 ||
          cleanupDeadlineMs > 300_000
        )
          throw new Error('iOS locale cleanup deadline is invalid or exceeds the bounded cap');
        const cleanupController = new AbortController();
        const startedAt = isoNow();
        const cleanupOperation = Promise.resolve().then(() =>
          cleanupOwned(cleanupController.signal),
        );
        // A callback that ignores cancellation must not keep the scenario awaiting forever.
        // Its late result is deliberately not promoted after the first bounded receipt.
        void cleanupOperation.catch(() => undefined);
        cleanupAttempt = (async () => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          let timedOut = false;
          const timeout = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              const reason = new Error('iOS locale cleanup deadline exceeded');
              cleanupController.abort(reason);
              reject(reason);
            }, cleanupDeadlineMs);
          });
          try {
            const rawReceipt = await Promise.race([cleanupOperation, timeout]);
            const finishedAt = isoNow();
            if (
              rawReceipt.status !== 'cleaned' ||
              rawReceipt.captureRunId !== context.captureRunId ||
              rawReceipt.foreignResourcesPreserved !== true
            )
              return {
                status: 'failed-recovery-required' as const,
                captureRunId: context.captureRunId,
                attempt: 1 as const,
                ownedResources: rawReceipt.ownedResources ?? [],
                foreignResourcesPreserved: rawReceipt.foreignResourcesPreserved === true,
                startedAt,
                finishedAt,
                failure: {
                  code: 'cleanup-invalid-receipt' as const,
                  message: 'owned cleanup returned an invalid or unbound receipt',
                  recoveryRequired: true as const,
                  pendingOperation: false,
                },
              } satisfies IosLocaleCleanupReceipt;
            return {
              ...rawReceipt,
              status: 'cleaned' as const,
              captureRunId: context.captureRunId,
              attempt: 1 as const,
              startedAt,
              finishedAt,
              failure: null,
            } satisfies IosLocaleCleanupReceipt;
          } catch (error) {
            const finishedAt = isoNow();
            return {
              status: 'failed-recovery-required' as const,
              captureRunId: context.captureRunId,
              attempt: 1 as const,
              ownedResources: [],
              foreignResourcesPreserved: false,
              startedAt,
              finishedAt,
              failure: {
                code: timedOut ? 'cleanup-timeout' : 'cleanup-error',
                message: error instanceof Error ? error.message.slice(0, 160) : 'cleanup failed',
                recoveryRequired: true as const,
                pendingOperation: timedOut,
              },
            } satisfies IosLocaleCleanupReceipt;
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
        })();
        void cleanupAttempt.then(
          (receipt) => {
            cleanupReceiptValue = receipt;
          },
          () => {
            /* The awaited cleanupAttempt below remains the failure authority. */
          },
        );
      }
      const receipt = await cleanupAttempt;
      cleanupReceiptValue = receipt;
      if (receipt.status !== 'cleaned')
        throw new Error(
          `iOS locale owned cleanup requires recovery: ${receipt.failure?.code ?? 'unknown'}`,
        );
      // Preserve the first cleanup receipt even when the scenario signal is already aborted.
      return phase(context.captureRunId, 'cleanup');
    },
    cleanupReceipt() {
      return cleanupReceiptValue;
    },
    commandReceipts() {
      return commandRecords.map(
        ({
          label,
          command: executable,
          argv,
          result,
          startedAt,
          finishedAt,
          deadlineMs,
          captureRunId,
          binding: rowBinding,
          log,
          stdout,
        }) => ({
          label,
          command: executable,
          argv,
          execution: result.execution,
          cleanup: result.cleanup,
          childExitCode: result.childExitCode,
          childSignal: result.childSignal,
          pid: result.pid,
          pgid: result.pgid,
          startedAt,
          finishedAt,
          deadlineMs,
          captureRunId,
          binding: rowBinding,
          log,
          stdout,
        }),
      );
    },
    appContainerReceipt() {
      return dataContainerReceipt;
    },
    coachSignInReceipt() {
      return lastCoachReceipt;
    },
  };
}

function buildScenarioPlan(
  scenarioId: ScenarioId,
  requestedLocale: SupportedNativeLocale,
  baselineOsLocale: SupportedNativeLocale,
): readonly ScenarioStep[] {
  if (scenarioId === 'locale-selection-persistence') {
    return [
      { kind: 'prepare', id: 'fresh-target' },
      {
        kind: 'set-os',
        id: 'set-selection-baseline-os',
        locale: baselineOsLocale,
        reason: 'selection-baseline',
      },
      { kind: 'read-os', id: 'read-selection-baseline-os', expected: baselineOsLocale },
      {
        kind: 'read-override',
        id: 'read-initial-override',
        expectedStatus: 'absent',
        expectedLocale: null,
      },
      { kind: 'launch', id: 'launch-initial' },
      { kind: 'context', id: 'initial-fallback', label: 'locale-initial-fallback' },
      { kind: 'run-flow', id: 'run-locale-selection', requestedLocale },
      {
        kind: 'selection',
        id: 'capture-selected-language-screen',
        label: 'locale-selected-language-screen',
      },
      { kind: 'save-selection', id: 'save-locale-selection' },
      {
        kind: 'read-override',
        id: 'read-selected-override',
        expectedStatus: 'present',
        expectedLocale: requestedLocale,
      },
      { kind: 'context', id: 'selected', label: 'locale-selected-context' },
      { kind: 'launch', id: 'relaunch-after-selection' },
      {
        kind: 'read-override',
        id: 'read-persisted-override',
        expectedStatus: 'present',
        expectedLocale: requestedLocale,
      },
      { kind: 'context', id: 'persisted', label: 'locale-persisted-context' },
      { kind: 'clear', id: 'clear-override' },
      {
        kind: 'set-os',
        id: 'set-fallback-reset-os',
        locale: requestedLocale,
        reason: 'fallback-reset',
      },
      { kind: 'read-os', id: 'read-fallback-reset-os-after-reset', expected: requestedLocale },
      { kind: 'launch', id: 'relaunch-after-reset' },
      {
        kind: 'read-override',
        id: 'read-reset-override',
        expectedStatus: 'absent',
        expectedLocale: null,
      },
      { kind: 'context', id: 'fallback-reset', label: 'locale-fallback-reset-context' },
      { kind: 'cleanup', id: 'cleanup' },
    ];
  }
  return [
    { kind: 'prepare', id: 'fresh-target' },
    { kind: 'clear', id: 'clear-override' },
    {
      kind: 'set-os',
      id: 'set-fallback-reset-os',
      locale: requestedLocale,
      reason: 'fallback-reset',
    },
    { kind: 'read-os', id: 'read-fallback-reset-os-before-launch', expected: requestedLocale },
    { kind: 'launch', id: 'launch-initial' },
    {
      kind: 'read-override',
      id: 'read-reset-override',
      expectedStatus: 'absent',
      expectedLocale: null,
    },
    { kind: 'context', id: 'fallback-reset', label: 'locale-fallback-reset-context' },
    { kind: 'launch', id: 'relaunch-after-reset' },
    {
      kind: 'read-override',
      id: 'read-reset-persisted-override',
      expectedStatus: 'absent',
      expectedLocale: null,
    },
    {
      kind: 'context',
      id: 'fallback-reset-persisted',
      label: 'locale-fallback-reset-persisted-context',
    },
    { kind: 'cleanup', id: 'cleanup' },
  ];
}

function validateOverride(
  value: NativeLocaleEvidence['override'],
  expectedStatus: NativeLocaleEvidence['override']['status'],
  expectedLocale: SupportedNativeLocale | null,
) {
  if (
    value.status !== expectedStatus ||
    value.source !== 'language-storage' ||
    value.value !== expectedLocale ||
    (value.status === 'present' ? value.value === null : value.value !== null)
  )
    throw new Error('locale storage override does not match the reviewed checkpoint');
  return value;
}

function checkpoint(
  id: ContextCheckpointId,
  frame: IosLocaleHierarchyFrame,
  context: NativeLocaleContextObservation,
  storageOverride: NativeLocaleEvidence['override'] | null,
  osObservation: NativeLocaleEvidence['observedOsLocale'] | null,
  expectedLocale: SupportedNativeLocale,
): IosLocaleCheckpoint {
  if (context.status === 'blocked')
    return {
      id,
      frame,
      context,
      storageOverride,
      qualification: 'blocked',
      reason: `context-${context.reason}`,
    };
  if (storageOverride === null)
    return {
      id,
      frame,
      context,
      storageOverride,
      qualification: 'not-evaluated',
      reason: 'storage-unobserved',
    };
  if (
    storageOverride.status !== context.snapshot.override.status ||
    storageOverride.value !== context.snapshot.override.value
  )
    return {
      id,
      frame,
      context,
      storageOverride,
      qualification: 'blocked',
      reason: 'storage-context-override-mismatch',
    };
  if (context.snapshot.hydration !== 'hydrated')
    return {
      id,
      frame,
      context,
      storageOverride,
      qualification: 'blocked',
      reason: 'context-not-hydrated',
    };
  const expectedEffective =
    storageOverride.status === 'present'
      ? storageOverride.value
      : (osObservation?.resolved ?? null);
  if (expectedEffective === null || context.snapshot.effectiveLocale !== expectedEffective)
    return {
      id,
      frame,
      context,
      storageOverride,
      qualification: 'blocked',
      reason: 'effective-locale-mismatch',
    };
  if (id === 'selected' || id === 'persisted') {
    if (storageOverride.status !== 'present' || storageOverride.value !== expectedLocale)
      return {
        id,
        frame,
        context,
        storageOverride,
        qualification: 'blocked',
        reason: 'selected-override-mismatch',
      };
  } else if (storageOverride.status !== 'absent') {
    return {
      id,
      frame,
      context,
      storageOverride,
      qualification: 'blocked',
      reason: 'fallback-override-not-absent',
    };
  }
  if (id === 'fallback-reset' || id === 'fallback-reset-persisted' || id === 'initial-fallback') {
    if (osObservation?.status !== 'observed' || osObservation.resolved !== expectedEffective)
      return {
        id,
        frame,
        context,
        storageOverride,
        qualification: 'blocked',
        reason: 'os-locale-proof-unavailable',
      };
    const result = qualifyNativeLocaleEvidence(
      {
        schemaVersion: 1,
        requestedLocale: expectedEffective,
        observedOsLocale: osObservation,
        effectiveAppLocale: {
          hydration: context.snapshot.hydration,
          source: context.snapshot.effectiveSource,
          value: context.snapshot.effectiveLocale,
        },
        override: storageOverride,
        binding: frame.binding,
      },
      expectedEffective,
      frame.binding,
    );
    if (!result.eligible)
      return {
        id,
        frame,
        context,
        storageOverride,
        qualification: 'blocked',
        reason: `qualification-${result.reason}`,
      };
  }
  return { id, frame, context, storageOverride, qualification: 'eligible', reason: null };
}

export function evaluateIosLocaleContextCheckpoint(input: {
  id: ContextCheckpointId;
  frame: IosLocaleHierarchyFrame;
  storageOverride: NativeLocaleEvidence['override'] | null;
  expectedOsLocale: SupportedNativeLocale | null;
  expectedLocale: SupportedNativeLocale;
}): IosLocaleCheckpoint {
  return checkpoint(
    input.id,
    input.frame,
    parseLocaleContextDiagnosticSubtree(input.frame.tree),
    input.storageOverride,
    input.expectedOsLocale
      ? {
          status: 'observed',
          source: 'ios-simctl-defaults',
          raw: input.expectedOsLocale.replace('-', '_'),
          resolved: input.expectedOsLocale,
          normalization: 'platform-canonical',
        }
      : null,
    input.expectedLocale,
  );
}

/** Execute only through the concrete owned iOS transport; result remains Pending by design. */
export async function runIosLocaleScenario(
  input: IosLocaleScenarioInput,
  transport: IosLocaleRuntimeTransport,
): Promise<IosLocaleScenarioResult> {
  const expectedBinding = safeBinding(input.expectedBinding);
  if (expectedBinding.target.platform !== 'ios' || transport.platform !== 'ios')
    throw new Error('iOS locale scenario requires an iOS binding and transport');
  if (!isSupportedLocale(input.requestedLocale)) throw new Error('requested locale is unsupported');
  const baselineOsLocale =
    input.baselineOsLocale ?? (input.requestedLocale === 'en-US' ? 'pt-BR' : 'en-US');
  if (!isSupportedLocale(baselineOsLocale)) throw new Error('baseline OS locale is unsupported');
  if (
    input.scenarioId === 'locale-selection-persistence' &&
    baselineOsLocale === input.requestedLocale
  )
    throw new Error('selection baseline must differ from requested locale');
  const cleanupOwner = transport.contextCleanupOwner ?? 'scenario';
  const plan = buildScenarioPlan(input.scenarioId, input.requestedLocale, baselineOsLocale).filter(
    (step) => cleanupOwner === 'outer-capture' || step.kind !== 'cleanup',
  );
  const steps: IosLocaleScenarioResult['steps'][number][] = [];
  const checkpoints: IosLocaleCheckpoint[] = [];
  const blockers: string[] = [];
  const phaseReceipts: { id: string; receipt: IosLocalePhaseReceipt }[] = [];
  const osReadbacks: {
    checkpoint: string;
    observation: IosLocaleObservedOsReadback;
  }[] = [];
  const overrideReadbacks: {
    checkpoint: string;
    observation: IosLocaleOverrideReceipt;
  }[] = [];
  const selectionFrames: {
    frame: IosLocaleHierarchyFrame;
    audit: IosLocaleSelectionAudit;
  }[] = [];
  const os = new Map<string, IosLocaleObservedOsReadback>();
  const overrides = new Map<string, NativeLocaleEvidence['override']>();
  const resetReceipts: IosLanguageResetReceipt[] = [];
  let freshTarget: IosLocaleFreshTargetReceipt | null = null;
  let failed = false;
  let stoppedAfterFailure = false;
  let cleanupAttempted = false;
  let cleanupObserved = false;
  let cleanupReceipt: IosLocaleCleanupReceipt | null = null;
  let cleanupError: string | null = null;
  const addBlocker = (reason: string) => {
    if (!blockers.includes(reason)) blockers.push(reason);
  };
  const record = (
    id: string,
    status: IosLocaleScenarioResult['steps'][number]['status'],
    blocker: string | null = null,
  ) => {
    steps.push({ id, status, blocker });
    if (blocker) addBlocker(blocker);
    if (status === 'blocked') {
      failed = true;
      stoppedAfterFailure = true;
    }
  };
  try {
    for (const step of plan) {
      if (stoppedAfterFailure) break;
      try {
        if (step.kind === 'prepare') {
          const receipt = await transport.prepareFreshTarget({ binding: expectedBinding });
          expectedPhase(receipt, expectedBinding.captureRunId, step.id);
          requirePhaseCommandReceipts(receipt, transport.commandReceipts(), step.id);
          freshTarget = receipt;
          phaseReceipts.push({ id: step.id, receipt });
          record(step.id, 'observed');
        } else if (step.kind === 'set-os') {
          const receipt = await transport.setOsLocale({ locale: step.locale, reason: step.reason });
          expectedPhase(receipt, expectedBinding.captureRunId, step.id);
          requirePhaseCommandReceipts(receipt, transport.commandReceipts(), step.id);
          phaseReceipts.push({ id: step.id, receipt });
          record(step.id, 'observed');
        } else if (step.kind === 'read-os') {
          const observation = await transport.readOsLocale({ checkpoint: step.id });
          osReadbacks.push({ checkpoint: step.id, observation });
          if (observation.status !== 'observed' || observation.resolved !== step.expected)
            throw new Error('OS locale read-back mismatch');
          os.set(step.id, observation);
          record(step.id, 'observed');
        } else if (step.kind === 'read-override') {
          const rawObservation = await transport.readOverride({ checkpoint: step.id });
          overrideReadbacks.push({ checkpoint: step.id, observation: rawObservation });
          const observation = validateOverride(
            rawObservation,
            step.expectedStatus,
            step.expectedLocale,
          );
          overrides.set(step.id, observation);
          record(step.id, 'observed');
        } else if (step.kind === 'launch') {
          const receipt = await transport.launch({ checkpoint: step.id });
          expectedPhase(receipt, expectedBinding.captureRunId, step.id);
          requirePhaseCommandReceipts(receipt, transport.commandReceipts(), step.id);
          phaseReceipts.push({ id: step.id, receipt });
          record(step.id, 'observed');
        } else if (step.kind === 'run-flow') {
          const receipt = await transport.runNormalFlow({ requestedLocale: step.requestedLocale });
          expectedPhase(receipt, expectedBinding.captureRunId, step.id);
          requirePhaseCommandReceipts(receipt, transport.commandReceipts(), step.id);
          phaseReceipts.push({ id: step.id, receipt });
          record(step.id, 'observed');
        } else if (step.kind === 'selection') {
          const frame = await transport.captureHierarchy({ label: step.label });
          const audit = transport.auditSelection({ frame, requestedLocale: input.requestedLocale });
          selectionFrames.push({ frame, audit });
          if (audit.status === 'blocked') throw new Error(`selection-${audit.reason}`);
          record(step.id, 'captured');
        } else if (step.kind === 'save-selection') {
          const receipt = await transport.saveSelection();
          expectedPhase(receipt, expectedBinding.captureRunId, step.id);
          requirePhaseCommandReceipts(receipt, transport.commandReceipts(), step.id);
          phaseReceipts.push({ id: step.id, receipt });
          record(step.id, 'observed');
        } else if (step.kind === 'clear') {
          const clear = await transport.clearOverride();
          expectedPhase(clear, expectedBinding.captureRunId, step.id);
          requirePhaseCommandReceipts(clear, transport.commandReceipts(), step.id);
          phaseReceipts.push({ id: step.id, receipt: clear });
          if (!clear.storageReset || clear.storageReset.status !== 'observed')
            throw new Error('exact storage reset receipt is missing');
          resetReceipts.push(clear.storageReset);
          record(step.id, 'observed');
        } else if (step.kind === 'context') {
          const frame = await transport.captureHierarchy({ label: step.label });
          const context = parseLocaleContextDiagnosticSubtree(frame.tree);
          const overrideId =
            step.id === 'initial-fallback'
              ? 'read-initial-override'
              : step.id === 'selected'
                ? 'read-selected-override'
                : step.id === 'persisted'
                  ? 'read-persisted-override'
                  : step.id === 'fallback-reset'
                    ? 'read-reset-override'
                    : 'read-reset-persisted-override';
          const override = overrides.get(overrideId) ?? null;
          const osId =
            step.id === 'initial-fallback' || step.id === 'selected' || step.id === 'persisted'
              ? 'read-selection-baseline-os'
              : input.scenarioId === 'locale-selection-persistence'
                ? 'read-fallback-reset-os-after-reset'
                : 'read-fallback-reset-os-before-launch';
          const osObservation = os.get(osId) ?? null;
          const result = checkpoint(
            step.id,
            frame,
            context,
            override,
            osObservation,
            input.requestedLocale,
          );
          checkpoints.push(result);
          if (result.qualification === 'blocked') record(step.id, 'blocked', result.reason);
          else record(step.id, 'captured');
        } else if (step.kind === 'cleanup') {
          cleanupAttempted = true;
          const receipt = await transport.cleanup();
          expectedPhase(receipt, expectedBinding.captureRunId, step.id);
          requirePhaseCommandReceipts(receipt, transport.commandReceipts(), step.id);
          phaseReceipts.push({ id: step.id, receipt });
          cleanupObserved = true;
          cleanupReceipt = transport.cleanupReceipt();
          record(step.id, 'observed');
        }
      } catch (error) {
        failed = true;
        if (step.kind === 'clear' && error instanceof IosLocaleClearError)
          resetReceipts.push(error.storageReset);
        const reason = error instanceof Error ? error.message.slice(0, 160) : 'step-failed';
        record(step.id, 'blocked', reason);
        if (step.kind !== 'cleanup') {
          stoppedAfterFailure = true;
          addBlocker('stopped-after-step-failure');
        }
      }
    }
  } finally {
    if (
      transport.contextCleanupOwner !== 'outer-capture' &&
      !steps.some((step) => step.id === 'cleanup' && step.status === 'observed')
    ) {
      cleanupAttempted = true;
      try {
        const receipt = await transport.cleanup();
        expectedPhase(receipt, expectedBinding.captureRunId, 'cleanup');
        requirePhaseCommandReceipts(receipt, transport.commandReceipts(), 'cleanup');
        phaseReceipts.push({ id: 'cleanup', receipt });
        cleanupObserved = true;
        cleanupReceipt = transport.cleanupReceipt();
        record('cleanup', 'observed');
      } catch (error) {
        failed = true;
        cleanupReceipt = transport.cleanupReceipt();
        cleanupError = error instanceof Error ? error.message.slice(0, 160) : 'cleanup-unproven';
        record('cleanup', 'blocked', 'cleanup-unproven');
      }
    }
  }
  if (checkpoints.some((item) => item.qualification !== 'eligible')) {
    failed = true;
    addBlocker('locale-qualification-incomplete');
  }
  if (steps.some((step) => step.status === 'blocked')) failed = true;
  return {
    kind: 'private-ios-locale-runtime-scenario-result-not-runtime-proof',
    schemaVersion: 3,
    scenarioId: input.scenarioId,
    requestedLocale: input.requestedLocale,
    baselineOsLocale,
    expectedBinding,
    status: failed ? 'blocked' : 'observed',
    runtimeQualification: 'pending',
    nativePassingCases: 0,
    publicLocale: null,
    freshTarget,
    phaseReceipts,
    osReadbacks,
    overrideReadbacks,
    selectionFrames,
    coachSignInReceipt: transport.coachSignInReceipt(),
    commandReceipts: transport.commandReceipts(),
    appContainerReceipts: transport.appContainerReceipt() ? [transport.appContainerReceipt()!] : [],
    resetReceipts,
    steps,
    checkpoints,
    cleanupAttempted,
    cleanupObserved,
    cleanupOwner,
    cleanupReceipt,
    cleanupError,
    blockers,
  };
}

export function buildIosLocaleBindingGuard(value: unknown): NativeLocaleBinding {
  const binding = parseNativeLocaleBinding(value);
  if (!HASH64.test(binding.sourceTreeHash) || !CAPTURE_ID.test(binding.captureRunId))
    throw new Error('iOS locale binding is not an owned capture identity');
  return binding;
}

export const IOS_LOCALE_RUNTIME_CONTRACT = {
  bundleId: IOS_BUNDLE_ID,
  storageKey: IOS_LANGUAGE_STORAGE_CONTRACT.key,
  normalSelectors: IOS_LOCALE_NORMAL_SELECTORS,
  forbiddenResetTokens: ['pm clear', 'simctl erase', 'clearState', 'rm -rf'],
  publicLocale: null,
  runtimeQualification: 'pending',
} as const;
