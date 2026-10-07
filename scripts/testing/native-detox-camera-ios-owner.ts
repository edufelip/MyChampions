import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  type DetoxCameraAttemptReport,
  type DetoxCameraCleanup,
  type DetoxCameraTerminal,
  requireDetoxCameraBootstrapEvidence,
  requireDetoxCameraSelection,
} from './native-detox-camera-ios-contract';
import {
  requireDetoxCameraEvidenceLive,
  writeOwnedExclusive,
  type DetoxCameraEvidenceLifecycle,
} from './native-detox-camera-ios-evidence';
import {
  runDetoxIosCameraProducer,
  type DetoxCameraProducerContext,
} from './native-detox-camera-ios-producer';
import {
  stageDetoxIosCameraPrivateEvidence,
  writeDetoxIosCameraTerminal,
  type DetoxCameraStageResult,
} from './native-detox-camera-ios-stage';
import type { NativeCommandExecution } from './owned-native-command';

export type DetoxCameraAcquiredRuntime = {
  artifactRoot: string;
  stageRoot: string;
  producer: DetoxCameraProducerContext;
  runtimeFacts?: DetoxCameraRuntimeFacts;
  cleanup: (reason: 'completed' | 'failed' | 'aborted') => Promise<DetoxCameraCleanup>;
};

export type DetoxCameraOwner = {
  acquire: () => Promise<DetoxCameraAcquiredRuntime>;
  lifecycle: DetoxCameraEvidenceLifecycle;
};

export type DetoxCameraRuntimeFacts = {
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification: 'completed' | 'child-failed' | 'deadline' | 'cancelled' | 'harness-blocked';
  flagsHash: string | null;
  timingsMs: {
    build: number;
    install: number;
    reset: number;
    scenario: number;
    verify: number;
    cleanup: number;
  };
};

export type DetoxCameraOwnerResult = {
  kind: 'detox-ios-camera-owner-result';
  report: DetoxCameraAttemptReport | null;
  stage: DetoxCameraStageResult | null;
  terminal: DetoxCameraTerminal | null;
  cleanup: DetoxCameraCleanup;
  error: { code: string; message: string } | null;
  runtimeFacts: DetoxCameraRuntimeFacts | null;
  publicPromotionEligible: false;
};

export type DetoxCameraAcquisitionFailure = Readonly<{
  resource: string;
  acquisitionPhase: 'pre-spawn' | 'spawned' | 'unknown' | 'validation';
  cleanup: 'not-acquired' | 'failed-recovery-ledger-retained';
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  pid: number | null;
  pgid: number | null;
  orchestrator: Record<string, unknown> | null;
  manifest: Record<string, unknown> | null;
  closed: Record<string, unknown> | null;
  diagnostics: string;
  unknownHandle: boolean;
  /** Paths are confined lexically under artifactRoot; file identity is not asserted here. */
  artifactPathsLexicallyValidated: boolean;
  logPath: string | null;
  stdoutPath: string | null;
  ownershipPath: string | null;
  /**
   * The protected Jest selection command can fail after its own process has
   * been acquired and cleaned, before a Detox child exists. Preserve that
   * command receipt separately from the camera acquisition boundary so clean
   * preflight cleanup is observable without turning selection into success.
   */
  preflight?: DetoxCameraJestListTestsFailure;
  error: { name: string; message: string };
}>;

export type DetoxCameraJestListTestsFailure = Readonly<{
  kind: 'detox-ios-camera-jest-list-tests-failure';
  command: Readonly<{
    command: string;
    argv: readonly string[];
    cwd: string;
  }>;
  execution: NativeCommandExecution;
  runnerInputsSha256: string;
  cameraTestPath: string;
  cameraTestSha256: string;
  /** Cleanup is clean only after the descriptor-bound ledger proves the leader and empty final census. */
  ownershipProof: 'validated-empty-final-census' | 'unproven';
  cleanupStatus: 'cleaned' | 'uncertain';
  artifactPathsLexicallyValidated: boolean;
  failure: { name: string; message: string } | null;
}>;

/**
 * Acquisition can fail after one or more owned resources exist. The current
 * owner publishes its cleanup ledger before raising this error so the public
 * dispatcher retains the original blocked outcome and runtime facts instead
 * of collapsing the attempt into an unacquired preflight.
 */
export class DetoxCameraAcquisitionError extends Error {
  readonly runtimeFacts: DetoxCameraRuntimeFacts;
  readonly cleanup: DetoxCameraCleanup;
  readonly acquisitionFailure: DetoxCameraAcquisitionFailure;

  constructor(
    message: string,
    runtimeFacts: DetoxCameraRuntimeFacts,
    cleanup: DetoxCameraCleanup,
    acquisitionFailure: DetoxCameraAcquisitionFailure,
  ) {
    super(message);
    this.name = 'DetoxCameraAcquisitionError';
    this.runtimeFacts = runtimeFacts;
    this.cleanup = cleanup;
    this.acquisitionFailure = acquisitionFailure;
  }
}

function errorRecord(error: unknown): { code: string; message: string } {
  const message = error instanceof Error ? error.message : 'Detox camera owner failed';
  // Error text is deliberately reduced to a bounded classification. Paths, credentials and response bodies
  // must never become part of a private terminal receipt.
  const code = /cancel|abort/i.test(message)
    ? 'cancelled'
    : /deadline|timeout/i.test(message)
      ? 'deadline'
      : 'failed';
  return {
    code,
    message: message
      .slice(0, 240)
      .replace(/(?:password|token|secret|authorization|cookie|invite)[^\s]*/gi, '[redacted]'),
  };
}

async function writePrivateJson(
  path: string,
  value: unknown,
  lifecycle: DetoxCameraEvidenceLifecycle,
): Promise<{ path: string; sha256: string }> {
  await requireDetoxCameraEvidenceLive(lifecycle);
  const bytes = Buffer.from(JSON.stringify(value));
  if (bytes.length > 1024 * 1024) throw new Error('Detox camera terminal JSON exceeds 1 MiB');
  const root = resolve(path, '..');
  const name = path.slice(root.length + 1);
  if (!name || name.includes('/'))
    throw new Error(`Detox camera terminal JSON must be a direct child: ${path}`);
  const written = await writeOwnedExclusive(root, name, bytes, lifecycle);
  await requireDetoxCameraEvidenceLive(lifecycle);
  return { path: written.path, sha256: written.sha256 };
}

export async function runOwnedDetoxIosCameraAttempt(
  owner: DetoxCameraOwner,
): Promise<DetoxCameraOwnerResult> {
  const lifecycle = owner.lifecycle;
  let acquired: DetoxCameraAcquiredRuntime | null = null;
  let report: DetoxCameraAttemptReport | null = null;
  let stage: DetoxCameraStageResult | null = null;
  let cleanup: DetoxCameraCleanup = {
    captureCleanup: 'not-acquired',
    independentCleanup: 'not-acquired',
    ownedProcessPairs: [],
    foreignResourcesPreserved: false,
    terminal: 'blocked',
    error: null,
  };
  let failure: { code: string; message: string } | null = null;
  let runtimeFacts: DetoxCameraRuntimeFacts | null = null;
  try {
    acquired = await owner.acquire();
    runtimeFacts = acquired.runtimeFacts ?? null;
    requireDetoxCameraSelection(
      acquired.producer.owner.target.platform === 'ios'
        ? {
            platform: 'ios',
            engine: 'detox',
            scenario: 'SCN-camera-denied-ios',
            mode: 'integration',
          }
        : {},
    );
    const scenarioStarted = performance.now();
    report = await runDetoxIosCameraProducer(acquired.producer);
    requireDetoxCameraBootstrapEvidence(report.bootstrapEvidence, report.owner);
    if (runtimeFacts) runtimeFacts.timingsMs.scenario = performance.now() - scenarioStarted;
  } catch (error) {
    failure = errorRecord(error);
    if (error instanceof DetoxCameraAcquisitionError) {
      runtimeFacts = error.runtimeFacts;
      cleanup = error.cleanup;
    }
  } finally {
    if (acquired) {
      const cleanupStarted = performance.now();
      try {
        cleanup = await acquired.cleanup(
          failure?.code === 'cancelled' ? 'aborted' : failure ? 'failed' : 'completed',
        );
        if (runtimeFacts) runtimeFacts.timingsMs.cleanup = performance.now() - cleanupStarted;
      } catch (error) {
        failure ??= errorRecord(error);
        if (runtimeFacts) runtimeFacts.timingsMs.cleanup = performance.now() - cleanupStarted;
        cleanup = {
          ...cleanup,
          terminal: 'blocked',
          error: errorRecord(error).message,
        };
      }
    }
  }
  if (report && runtimeFacts && runtimeFacts.childClassification !== 'completed') {
    failure ??= {
      code: 'failed',
      message: 'Detox camera child did not complete successfully',
    };
  }
  if (report) {
    report = { ...report, cleanup };
    let reportWritten: { path: string; sha256: string };
    try {
      reportWritten = await writePrivateJson(
        join(resolve(acquired!.artifactRoot), 'detox-camera-report.private.json'),
        report,
        lifecycle,
      );
    } catch (error) {
      failure ??= errorRecord(error);
      return {
        kind: 'detox-ios-camera-owner-result',
        report,
        stage: null,
        terminal: null,
        cleanup,
        error: failure,
        runtimeFacts,
        publicPromotionEligible: false,
      };
    }
    const verificationStarted = performance.now();
    if (
      !failure &&
      cleanup.captureCleanup === 'cleaned' &&
      cleanup.independentCleanup === 'cleaned' &&
      cleanup.terminal === 'complete'
    ) {
      try {
        stage = await stageDetoxIosCameraPrivateEvidence({
          report,
          outputRoot: acquired!.stageRoot,
          reportPath: reportWritten.path,
          cleanup,
          lifecycle,
        });
      } catch (error) {
        failure = errorRecord(error);
      }
    }
    if (runtimeFacts) runtimeFacts.timingsMs.verify = performance.now() - verificationStarted;
    let terminal: DetoxCameraTerminal | null = null;
    try {
      terminal = await writeDetoxIosCameraTerminal({
        outputRoot: acquired!.artifactRoot,
        reportPath: reportWritten.path,
        report,
        cleanup,
        stagePath: stage
          ? join(resolve(acquired!.stageRoot), 'detox-camera-stage.private.json')
          : null,
        result: failure
          ? failure.code === 'cancelled'
            ? 'aborted'
            : 'blocked'
          : stage
            ? 'verified-private'
            : 'blocked',
        lifecycle,
      });
    } catch (error) {
      failure ??= errorRecord(error);
    }
    return {
      kind: 'detox-ios-camera-owner-result',
      report,
      stage,
      terminal,
      cleanup,
      error: failure,
      runtimeFacts,
      publicPromotionEligible: false,
    };
  }
  if (acquired) {
    try {
      await writePrivateJson(
        join(resolve(acquired.artifactRoot), 'detox-camera-failure.private.json'),
        {
          kind: 'detox-ios-camera-failure',
          error: failure,
          cleanup,
          publicPromotionEligible: false,
        },
        lifecycle,
      );
    } catch (error) {
      failure ??= errorRecord(error);
    }
  }
  return {
    kind: 'detox-ios-camera-owner-result',
    report: null,
    stage: null,
    terminal: null,
    cleanup,
    error: failure,
    runtimeFacts,
    publicPromotionEligible: false,
  };
}
