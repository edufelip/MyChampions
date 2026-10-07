import assert from 'node:assert/strict';
import path from 'node:path';
import {
  writeAtomicDetoxConnectionBytes,
  type DetoxConnectionEvidenceDirectoryIdentity,
} from './detox-connection-evidence';

const DETOX_RESULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Publish the standalone Detox terminal result through the descriptor-backed
 * writer. The expected root identity is captured by the owning caller before
 * driver execution and is checked again at publication.
 */
export async function writeDetoxConnectionResult<T extends object>(
  input: Readonly<{
    artifactRoot: string;
    expectedRootIdentity: DetoxConnectionEvidenceDirectoryIdentity;
    result: T;
    receivedSignals: readonly string[];
    signal?: AbortSignal;
    deadlineAt?: number;
  }>,
): Promise<string> {
  const destination = path.join(input.artifactRoot, 'detox-connection-result.private.json');
  const serialized = Buffer.from(
    `${JSON.stringify(
      {
        ...input.result,
        receivedSignals: [...input.receivedSignals],
        publicPromotionEligible: false,
        nativePassingCases: 0,
      },
      null,
      2,
    )}
`,
  );
  assert(
    serialized.byteLength <= DETOX_RESULT_MAX_BYTES,
    `Detox connection result exceeds ${DETOX_RESULT_MAX_BYTES} bytes`,
  );
  const readback = await writeAtomicDetoxConnectionBytes(
    input.artifactRoot,
    'detox-connection-result.private.json',
    serialized,
    DETOX_RESULT_MAX_BYTES,
    {
      signal: input.signal,
      deadlineAt: input.deadlineAt,
      expectedRootIdentity: input.expectedRootIdentity,
    },
  );
  assert.equal(readback.realpath, destination);
  assert(readback.bytes.equals(serialized), 'Detox connection result bytes failed readback');
  assert.equal(readback.metadata.mode & 0o777, 0o600);
  assert.equal(readback.metadata.nlink, 1);
  return readback.realpath;
}
