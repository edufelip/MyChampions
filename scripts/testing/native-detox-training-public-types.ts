import type { DetoxConnectionEvidenceStat } from './detox-connection-evidence';
import type { DetoxRuntimeBuildMetadata } from './detox-runtime-build-metadata';

/**
 * Shared private receipt shape used by the iOS Detox training producer and its
 * finalizer. Keeping this contract independent prevents Android training's
 * source closure from importing the iOS public dispatcher through a type-only
 * edge.
 */
export type DetoxTrainingOriginalReceipt = Readonly<{
  fileName: string;
  sha256: string;
  realpath: string;
  metadata: DetoxConnectionEvidenceStat;
  value: Readonly<Record<string, unknown>>;
}>;

export type DetoxTrainingProducerEvidence = Readonly<{
  kind: 'private-detox-training-producer-evidence-not-public-receipt';
  runId: string;
  attemptId: string;
  platform: 'ios';
  childIdentity: Readonly<Record<string, unknown>>;
  backendIdentity: Readonly<Record<string, unknown>>;
  targetIdentity: Readonly<Record<string, unknown>>;
  buildIdentity: Readonly<Record<string, unknown>>;
  runtimeMetadata: DetoxRuntimeBuildMetadata;
  originalReceipts: Readonly<{
    build: DetoxTrainingOriginalReceipt;
    command: DetoxTrainingOriginalReceipt;
  }>;
  input: Readonly<{
    runId: string;
    attemptId: string;
    platform: 'ios';
    accountUid: string;
    exerciseId: string;
    exerciseName: string;
  }>;
  planId: string;
  sixSqlCheckpoints: true;
  threeAuthenticatedApiReads: true;
  savedPlanDurableAfterRestart: true;
  cleanup: Readonly<Record<string, unknown>>;
  cleanupSha256: string;
  assertionIds: readonly string[];
  stepReceipts: readonly {
    assertionId: string;
    fileName: string;
    sha256: string;
  }[];
  unrelatedState: { fileName: string; sha256: string };
  sourceReceipts: Readonly<
    Record<'api' | 'sql' | 'transport', { fileName: string; sha256: string }>
  >;
  snapshotCount: number;
  apiReadCount: number;
  proxyObservationCount: number;
  publicPromotionEligible: false;
}>;
