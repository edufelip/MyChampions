import { createHash } from 'node:crypto';
export const androidSessionCharterId = 'session-account' as const;
export const legacyAndroidAuthDiagnosticCharterId = 'auth-account' as const;

export const androidSessionPrerequisiteContract = {
  roles: ['coach'] as const,
  fixtureScope: 'native-entry-android',
  session: 'one owned backend session, one owned native app session, one owned proxy run',
  locales: ['en-US', 'pt-BR', 'es-ES'] as const,
  source: 'current source tree and helper identity captured before and after the run',
  api: 'owned loopback API process plus pinned proxy/run/manifest identity',
  sql: 'owned Postgres session plus private RKStorage/WAL/SHM and redacted query receipts',
} as const;

export const androidSessionAssertionSequence = [
  'before-login-owned-profile-domain',
  'coach-sign-in-post-201',
  'after-login-persisted-profile-hash',
  'single-restore-post-hydrate-200',
  'cancelled-sign-out-confirmation-absent',
  'signed-out-relaunch-local-clear',
] as const;

export type AndroidSessionAssertionId = (typeof androidSessionAssertionSequence)[number];

export type AndroidSessionAssertionReceipt = {
  id: AndroidSessionAssertionId;
  order: number;
  status: 'verified';
  sourceReceiptHashes: readonly string[];
  phase: string;
};

export type AndroidSessionCharterResult = {
  charter: typeof androidSessionCharterId;
  status: 'verified';
  restorationCount: 1;
  assertionIds: readonly AndroidSessionAssertionId[];
  assertions: readonly AndroidSessionAssertionReceipt[];
  charterSha256: string;
};

export type AndroidSessionTerminalQualification = {
  status: 'verified' | 'blocked';
  blockers: readonly ('result-not-observed' | 'cleanup-not-cleaned' | 'evidence-unavailable')[];
};

/**
 * Gate whole-run qualification separately from nested checkpoint receipts.
 * A verified checkpoint remains truthful historical evidence when final cleanup
 * fails, but consumers cannot treat the run as qualified.
 */
export function buildAndroidSessionTerminalQualification(input: {
  result: string;
  cleanup: string;
  evidenceStatus: string | undefined;
}): AndroidSessionTerminalQualification {
  const blockers: AndroidSessionTerminalQualification['blockers'][number][] = [];
  if (input.result !== 'observed') blockers.push('result-not-observed');
  if (input.cleanup !== 'cleaned') blockers.push('cleanup-not-cleaned');
  if (input.evidenceStatus !== 'available') blockers.push('evidence-unavailable');
  return {
    status: blockers.length === 0 ? 'verified' : 'blocked',
    blockers,
  };
}

/** Exit success requires final session qualification only for the session lane. */
export function androidNativeCaptureExitCode(input: {
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  result: unknown;
  cleanup: unknown;
  isAuthSessionFlow: boolean;
  sessionQualification: unknown;
}): number {
  if (input.cancellation === 'SIGINT') return 130;
  if (input.cancellation === 'SIGTERM') return 143;
  const qualification = input.sessionQualification;
  const sessionVerified =
    typeof qualification === 'object' &&
    qualification !== null &&
    'status' in qualification &&
    qualification.status === 'verified';
  return input.result === 'observed' &&
    input.cleanup === 'cleaned' &&
    (!input.isAuthSessionFlow || sessionVerified)
    ? 0
    : 2;
}

function requireHash(value: string, label: string) {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(`${label} is not a SHA-256 receipt`);
}

/**
 * The session lane has one explicit restoration and six ordered assertions.
 * This is a source contract: each receipt hash must come from a verified
 * runtime source receipt before this function is called.
 */
export function requireAndroidSessionCharter(input: {
  assertionReceipts: readonly AndroidSessionAssertionReceipt[];
  restorationCount: number;
}): AndroidSessionCharterResult {
  if (input.restorationCount !== 1)
    throw new Error('Android session charter requires exactly one restoration');
  if (input.assertionReceipts.length !== androidSessionAssertionSequence.length)
    throw new Error('Android session charter requires six ordered assertions');
  input.assertionReceipts.forEach((receipt, index) => {
    if (
      receipt.id !== androidSessionAssertionSequence[index] ||
      receipt.order !== index + 1 ||
      receipt.status !== 'verified' ||
      typeof receipt.phase !== 'string' ||
      receipt.phase.length === 0 ||
      receipt.sourceReceiptHashes.length === 0
    )
      throw new Error('Android session charter assertion order or status is invalid');
    receipt.sourceReceiptHashes.forEach((hash) => requireHash(hash, `${receipt.id} source`));
    if (new Set(receipt.sourceReceiptHashes).size !== receipt.sourceReceiptHashes.length)
      throw new Error(`${receipt.id} source receipts must be distinct`);
  });
  const assertionIds = input.assertionReceipts.map((receipt) => receipt.id);
  return {
    charter: androidSessionCharterId,
    status: 'verified',
    restorationCount: 1,
    assertionIds,
    assertions: structuredClone(input.assertionReceipts),
    charterSha256: createHash('sha256').update(JSON.stringify(assertionIds)).digest('hex'),
  };
}
