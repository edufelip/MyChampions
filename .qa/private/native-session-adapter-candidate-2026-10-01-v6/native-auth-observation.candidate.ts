import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const sessionKey = 'auth.server.session';

/** Reports shape only; credentials and profile values never leave this reader. */
export async function observeIosAuthMetadata(dataRoot: string, bundleId: string) {
  if (
    bundleId !== 'com.edufelip.mychampions.dev' ||
    (await realpath(dataRoot)) !== dataRoot ||
    !(await stat(dataRoot)).isDirectory()
  )
    throw new Error('Native auth observation requires a canonical dev app data container');
  const storage = path.join(
    dataRoot,
    'Library/Application Support',
    bundleId,
    'RCTAsyncLocalStorage_V1',
  );
  const readOwned = async (name: string) => {
    const file = path.join(storage, name);
    if ((await realpath(file)) !== file || (await stat(file)).size > 64 * 1024)
      throw new Error('Native auth metadata file is escaped or too large');
    return readFile(file, 'utf8');
  };
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readOwned('manifest.json')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { status: 'manifest-absent' as const, sessionPresent: false };
    throw error;
  }
  if (!Object.hasOwn(manifest, sessionKey))
    return { status: 'session-absent' as const, sessionPresent: false };
  const value = manifest[sessionKey];
  const raw =
    value === null ? await readOwned(createHash('md5').update(sessionKey).digest('hex')) : value;
  if (typeof raw !== 'string') throw new Error('Native auth metadata record is malformed');
  const record = JSON.parse(raw) as Record<string, unknown>;
  const profile =
    record.profile && typeof record.profile === 'object' && !Array.isArray(record.profile)
      ? (record.profile as Record<string, unknown>)
      : null;
  const profileAuthUidHash =
    profile && typeof profile.authUid === 'string' && profile.authUid.length > 0
      ? createHash('sha256').update(profile.authUid).digest('hex')
      : undefined;
  return {
    status: 'session-present' as const,
    sessionPresent: true,
    profilePresent: Boolean(record.profile && typeof record.profile === 'object'),
    expiryPresent: typeof record.expiresAt === 'string',
    plaintextAccessTokenPresent: typeof record.accessToken === 'string',
    plaintextRefreshTokenPresent: typeof record.refreshToken === 'string',
    ...(profileAuthUidHash ? { profileAuthUidHash } : {}),
  };
}
