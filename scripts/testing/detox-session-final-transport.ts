import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NativeAuthIdentityObservation, ProxyObservation } from './owned-api-proxy';

type OwnedProxy = {
  readonly requestIdFence: number;
  readonly observations: readonly ProxyObservation[];
  readonly nativeAuthIdentities: readonly NativeAuthIdentityObservation[];
  stop(): Promise<void>;
};

export type DetoxFinalTransportEvidence = Readonly<{
  stopped: true;
  requestIdFence: number;
  observationIds: readonly number[];
  observations: readonly ProxyObservation[];
  identities: readonly NativeAuthIdentityObservation[];
  file: string;
  bytes: number;
  sha256: string;
}>;

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
};

export function requireClosedStartedRequestWindows(input: {
  checkpoints: readonly { requestIdFence: number; observedRequestIds: readonly number[] }[];
  observations: readonly ProxyObservation[];
  finalRequestIdFence: number;
}) {
  const rows = new Map(input.observations.map((row) => [row.requestId, row]));
  if (rows.size !== input.observations.length)
    throw new Error('Detox final transport repeats a request ID');
  if (!Number.isSafeInteger(input.finalRequestIdFence) || input.finalRequestIdFence < 0)
    throw new Error('Detox final request fence is invalid');
  if (
    [...rows.keys()].some(
      (id) => !Number.isSafeInteger(id) || id < 1 || id > input.finalRequestIdFence,
    )
  )
    throw new Error('Detox final transport contains an out-of-fence request ID');
  for (let id = 1; id <= input.finalRequestIdFence; id++)
    if (!rows.has(id)) throw new Error('Detox final transport omitted a started request');
  let previous = 0;
  for (const checkpoint of input.checkpoints) {
    if (
      !Number.isSafeInteger(checkpoint.requestIdFence) ||
      checkpoint.requestIdFence < previous ||
      checkpoint.requestIdFence > input.finalRequestIdFence
    )
      throw new Error('Detox phase started-request fence is not monotonic');
    const expected = input.observations
      .filter((row) => row.requestId > previous && row.requestId <= checkpoint.requestIdFence)
      .map((row) => row.requestId);
    if (
      stable([...checkpoint.observedRequestIds].sort((a, b) => a - b)) !==
      stable([...expected].sort((a, b) => a - b))
    )
      throw new Error('Detox phase checkpoint does not bind its started-request window');
    previous = checkpoint.requestIdFence;
  }
  if (input.checkpoints.length > 0 && previous !== input.finalRequestIdFence)
    throw new Error('Detox terminal checkpoint closed before the final request fence');
  return true;
}

export async function stopAndReadFinalTransport(options: {
  proxy: OwnedProxy;
  artifactRoot: string;
  fileName?: string;
}): Promise<DetoxFinalTransportEvidence> {
  const fileName = options.fileName ?? 'detox-transport-observations.private.json';
  if (!/^[a-z0-9-]+\.private\.json$/.test(fileName))
    throw new Error('Detox final transport filename is unsafe');
  await options.proxy.stop();
  const requestIdFence = options.proxy.requestIdFence;
  const observations = options.proxy.observations.map((row) => ({ ...row }));
  const identities = options.proxy.nativeAuthIdentities.map((row) => ({ ...row }));
  if (
    options.proxy.requestIdFence !== requestIdFence ||
    stable(options.proxy.observations) !== stable(observations)
  )
    throw new Error('Detox proxy changed after its stopped drain');
  requireClosedStartedRequestWindows({
    checkpoints: [],
    observations,
    finalRequestIdFence: requestIdFence,
  });
  const bytes = Buffer.from(
    JSON.stringify({ stopped: true, requestIdFence, observations, identities }) + '\n',
  );
  const file = path.join(options.artifactRoot, fileName);
  await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
  const metadata = await lstat(file);
  if (
    (await realpath(file)) !== file ||
    !metadata.isFile() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o600
  )
    throw new Error('Detox final transport receipt is not a private regular file');
  const retained = await readFile(file);
  if (stable(JSON.parse(retained.toString('utf8'))) !== stable(JSON.parse(bytes.toString('utf8'))))
    throw new Error('Detox final transport receipt changed after write');
  return Object.freeze({
    stopped: true,
    requestIdFence,
    observationIds: observations.map((row) => row.requestId),
    observations,
    identities,
    file,
    bytes: retained.byteLength,
    sha256: hash(retained),
  });
}
