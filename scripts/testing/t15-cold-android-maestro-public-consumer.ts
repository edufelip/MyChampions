import { createHash } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { readNativeEvidenceObservation } from './native-view-evidence';
import { finalizeT15AndroidMaestroPublicEvidence } from './t15-cold-android-maestro-public-finalizer';
import type {
  NativeComparisonReceiptInput,
  NativeComparisonAttemptExpectation,
} from './compare-native-pilot';
import type { NativePilotSelection } from './native-pilot-contract';
import type { FreshColdReset } from './t15-cold-dispatcher';
import type {
  T15OwnedPublicConsumer,
  T15OwnedLifecycleSessionResult,
} from './t15-cold-owned-lifecycle';

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Row {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function relative(root: string, file: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(file);
  const value = path.relative(resolvedRoot, resolved);
  if (!value || value.startsWith('..') || path.isAbsolute(value))
    throw new Error('Android public consumer path escaped its root');
  return value;
}

function deadline(signal: AbortSignal, deadlineAt: number): void {
  if (signal.aborted) throw new Error('android-public-consumer-cancelled');
  if (!Number.isFinite(deadlineAt) || performance.now() >= deadlineAt)
    throw new Error('android-public-consumer-deadline');
}

function adapterRelative(flowId: string): string {
  if (flowId === 'FLW-session') return 'android-session-runtime-adapter.private.json';
  if (flowId === 'FLW-camera-denied') return 'android-camera-runtime-adapter.private.json';
  return 'runtime-adapter.private.json';
}

function readAdapter(
  root: string,
  relativePath: string,
): {
  row: Row;
  path: string;
  hash: string;
  identity: unknown;
} {
  const observation = readNativeEvidenceObservation(root, relativePath, true);
  let parsed: unknown;
  try {
    parsed = JSON.parse(observation.bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('android-public-consumer-adapter-json-invalid');
  }
  if (!isRecord(parsed)) throw new Error('android-public-consumer-adapter-invalid');
  return {
    row: parsed,
    path: path.join(root, relativePath),
    hash: sha(observation.bytes),
    identity: observation.identity,
  };
}

function lifecycleReport(lifecycle: T15OwnedLifecycleSessionResult): Row {
  if (!isRecord(lifecycle.report) || lifecycle.report.cleanup !== 'cleaned')
    throw new Error('android-public-consumer-cleanup-not-proven');
  return lifecycle.report;
}

function rowReceipt(input: {
  expected: NativeComparisonAttemptExpectation;
  selection: NativePilotSelection;
  lifecycle: T15OwnedLifecycleSessionResult;
  reset: FreshColdReset;
  outputRoot: string;
  adapter: ReturnType<typeof readAdapter>;
  captureRunId: string;
  backendRunId: string;
  blocker: string;
}): NativeComparisonReceiptInput {
  const body = {
    schemaVersion: 1,
    kind: 'private-t15-android-maestro-public-terminal-not-qualified',
    result: 'harness-blocked',
    runId: input.expected.runId,
    attemptId: input.expected.attemptId,
    scenarioId: input.selection.scenario.id,
    phase: 'P4',
    layer: 'native',
    engine: 'maestro',
    platform: 'android',
    exitCode: 2,
    childExitCode: null,
    captureRunId: input.captureRunId,
    ownerRunId: input.expected.runId,
    backendRunId: input.backendRunId,
    target: isRecord(input.reset.target) ? input.reset.target : null,
    backend: isRecord(input.reset.backend) ? input.reset.backend : null,
    lifecycle: {
      cleanup: input.lifecycle.report.cleanup,
      ownershipWindows: input.lifecycle.report.ownershipWindows ?? null,
      originalAttemptReceipt: input.lifecycle.report.originalAttemptReceipt ?? null,
    },
    sourceAdapter: {
      path: input.adapter.path,
      relativePath: relative(input.lifecycle.artifactRoot, input.adapter.path),
      sha256: input.adapter.hash,
      identity: input.adapter.identity,
      kind: input.adapter.row.kind ?? null,
      verificationResult: input.adapter.row.verificationResult ?? null,
      publicPromotionEligible: input.adapter.row.publicPromotionEligible ?? false,
      nativePassingCases: input.adapter.row.nativePassingCases ?? 0,
    },
    nativePassingCases: 0,
    publicPromotionEligible: false,
    blocker: input.blocker,
  };
  const bytes = Buffer.from(JSON.stringify(body, null, 2) + '\n', 'utf8');
  const receiptPath = path.join(input.outputRoot, 'cold-public-receipt.private.json');
  return {
    path: receiptPath,
    artifactRoot: input.outputRoot,
    receipt: body,
    receiptHash: sha(bytes),
  };
}

/**
 * Android Maestro adapters retain their source/runtime evidence boundary. This
 * consumer invokes the distinct finalizer only after the owner has closed its
 * target, backend, reset, capture and cleanup windows; a finalizer failure is
 * reread as a protected blocked terminal row.
 */
export function createT15AndroidMaestroPublicConsumer(options: {
  repositoryRoot: string;
}): T15OwnedPublicConsumer {
  return async (input) => {
    deadline(input.signal, input.deadlineAtMonotonicMs);
    const report = lifecycleReport(input.lifecycle);
    const captureRunId =
      typeof report.captureRunId === 'string'
        ? report.captureRunId
        : path.basename(input.lifecycle.artifactRoot);
    const backend = report.backend;
    if (!isRecord(backend) || typeof backend.runId !== 'string')
      throw new Error('android-public-consumer-backend-unbound');
    const adapter = readAdapter(
      input.lifecycle.artifactRoot,
      adapterRelative(input.selection.scenario.flowId),
    );
    deadline(input.signal, input.deadlineAtMonotonicMs);
    try {
      return await finalizeT15AndroidMaestroPublicEvidence({
        repositoryRoot: options.repositoryRoot,
        expected: input.expected,
        selection: input.selection,
        lifecycle: input.lifecycle,
        reset: input.reset,
        outputRoot: input.outputRoot,
        signal: input.signal,
        deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
      });
    } catch (error) {
      deadline(input.signal, input.deadlineAtMonotonicMs);
      const receipt = rowReceipt({
        expected: input.expected,
        selection: input.selection,
        lifecycle: input.lifecycle,
        reset: input.reset,
        outputRoot: input.outputRoot,
        adapter,
        captureRunId,
        backendRunId: backend.runId,
        blocker:
          error instanceof Error
            ? `android-maestro-native-finalizer-blocked:${error.message.slice(0, 240)}`
            : 'android-maestro-native-finalizer-blocked',
      });
      const receiptBytes = Buffer.from(JSON.stringify(receipt.receipt, null, 2) + '\n', 'utf8');
      await lstat(input.outputRoot);
      await writeFile(receipt.path, receiptBytes, { flag: 'wx', mode: 0o600 });
      const observed = readNativeEvidenceObservation(
        input.outputRoot,
        'cold-public-receipt.private.json',
        true,
      );
      const parsed = JSON.parse(observed.bytes.toString('utf8')) as unknown;
      if (!isRecord(parsed) || JSON.stringify(parsed) !== JSON.stringify(receipt.receipt))
        throw new Error('android-public-consumer-terminal-readback-mismatch');
      return {
        path: receipt.path,
        artifactRoot: input.outputRoot,
        receipt: parsed,
        receiptHash: sha(observed.bytes),
      };
    }
  };
}

export const t15AndroidMaestroPublicConsumerContract = {
  sourceAdapters: 'read-protected-before-terminal' as const,
  terminal: 'protected-android-maestro-finalizer' as const,
  publicPassingCases: 'finalizer-derived' as const,
  nativePassingCases: 'finalizer-derived' as const,
};
