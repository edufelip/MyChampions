import assert from 'node:assert/strict';

const RUN_ID = /^[a-f0-9]{24}$/u;

/**
 * Keep the public caller, capture namespace, acquired Android target and
 * backend session as independently produced lifecycle identities. The outer
 * caller is the only source of requestedRunId; target/backend producers must
 * preserve their own run IDs through every receipt.
 */
export function requireAndroidDetoxCameraIdentityBoundary(input: {
  requestedRunId: string;
  captureRunId: string;
  ownerRunId: string;
  backendRunId: string;
}): void {
  const rows = [
    ['requested outer attempt', input.requestedRunId],
    ['capture artifact', input.captureRunId],
    ['owned target', input.ownerRunId],
    ['backend session', input.backendRunId],
  ] as const;
  for (const [label, value] of rows) {
    assert(
      typeof value === 'string' && RUN_ID.test(value),
      `Android Detox camera ${label} run ID is invalid`,
    );
  }
  assert.equal(
    new Set(rows.map(([, value]) => value)).size,
    rows.length,
    'Android Detox camera outer, capture, target-owner, and backend identities must remain distinct',
  );
}

export function requireAndroidDetoxCameraRunId(
  value: unknown,
  label: string,
): asserts value is string {
  assert(typeof value === 'string' && RUN_ID.test(value), `${label} is invalid`);
}
