import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

const MAX_QUIESCENCE_BYTES = 64 * 1024;

export type IosLocaleQuiescenceProcess = { pid: number; command: string };

export function parseIosLocaleQuiescenceProcessCensus(
  bytes: Buffer,
  bundleId: string,
): readonly IosLocaleQuiescenceProcess[] {
  if (bytes.byteLength > MAX_QUIESCENCE_BYTES)
    throw new Error('Locale quiescence process census exceeded the bounded read');
  const text = bytes.toString('utf8');
  if (text.includes('\uFFFD'))
    throw new Error('Locale quiescence process census is not valid UTF-8');
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const rows: IosLocaleQuiescenceProcess[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) throw new Error('Locale quiescence process census contains a blank interior row');
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (!match) throw new Error('Locale quiescence process census contains a malformed row');
    const pid = Number(match[1]);
    const command = match[2].trim();
    if (!Number.isSafeInteger(pid) || pid <= 0 || !command || /[\u0000-\u001f\u007f]/.test(command))
      throw new Error('Locale quiescence process census contains an invalid process row');
    rows.push({ pid, command });
  }
  return rows.filter(
    (processRow) =>
      processRow.command.includes(bundleId) ||
      /(?:^|[\\/])mychampions(?:$|[\\/\s])/i.test(processRow.command),
  );
}

export async function readOwnedIosLocaleQuiescenceStdout(
  artifactRoot: string,
  file: string,
  signal?: AbortSignal,
): Promise<{ bytes: Buffer; sha256: string; size: number }> {
  signal?.throwIfAborted();
  const requestedFile = path.isAbsolute(file) ? file : path.resolve(artifactRoot, file);
  const canonicalRoot = await realpath(artifactRoot);
  const rootMeta = await lstat(canonicalRoot);
  const canonicalFile = await realpath(requestedFile);
  const fileMeta = await lstat(requestedFile);
  if (
    canonicalRoot !== path.resolve(artifactRoot) ||
    !rootMeta.isDirectory() ||
    (rootMeta.mode & 0o777) !== 0o700 ||
    (process.getuid !== undefined && rootMeta.uid !== process.getuid()) ||
    path.dirname(canonicalFile) !== canonicalRoot ||
    canonicalFile !== path.resolve(requestedFile) ||
    !fileMeta.isFile() ||
    fileMeta.isSymbolicLink() ||
    (fileMeta.mode & 0o777) !== 0o600 ||
    (process.getuid !== undefined && fileMeta.uid !== process.getuid()) ||
    fileMeta.size > MAX_QUIESCENCE_BYTES
  )
    throw new Error('Locale quiescence stdout is not a bounded owned private file');
  signal?.throwIfAborted();
  const bytes = await readFile(canonicalFile, { signal });
  signal?.throwIfAborted();
  if (bytes.byteLength !== fileMeta.size)
    throw new Error('Locale quiescence stdout changed while reading');
  return {
    bytes,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}
