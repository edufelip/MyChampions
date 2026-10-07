import { execFile, spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import {
  createIntegratedAppEnvironment,
  assertResolvedIntegratedExpoConfig,
} from './integration-preflight';
import {
  groupProcesses,
  observeGroupProcesses,
  OwnedCommandCensusUnavailableError,
} from './owned-process-group';
import { assertTestingDocument } from './schema-validation';
import type { CommandCensusRequery, OwnedProcess } from './owned-process-group';

const execute = promisify(execFile);
const reservations = new WeakSet<object>();
export async function reserveOwnedAppPort(requestedPort?: number) {
  if (
    requestedPort !== undefined &&
    (!Number.isSafeInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535)
  )
    throw new Error('Invalid reserved app port');
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort ?? 0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('App port allocation failed');
  let released: Promise<void> | undefined;
  const reservation = {
    port: address.port,
    origin: `http://127.0.0.1:${address.port}`,
    release() {
      if (!released)
        released = new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      return released;
    },
  };
  reservations.add(reservation);
  return reservation;
}

/** A direct, isolated Expo process group; callers own the API/proxy separately. */
export async function startOwnedExpo(options: {
  clientRoot: string;
  artifactRoot: string;
  reservation: Awaited<ReturnType<typeof reserveOwnedAppPort>>;
  apiOrigin: string;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  deadlineMs?: number;
  signal?: AbortSignal;
  surface?: 'web' | 'native';
}) {
  if (process.platform === 'win32')
    throw new Error('Owned Expo process groups require a POSIX host');
  if (!reservations.delete(options.reservation))
    throw new Error('App port reservation is not owned or was reused');
  const env = createIntegratedAppEnvironment(options.parentEnv ?? process.env, {
    apiOrigin: options.apiOrigin,
    appOrigin: options.reservation.origin,
  });
  if (options.surface === 'native') {
    // Native E2E keeps warnings in runner diagnostics while preventing the
    // development LogBox layer from intercepting Maestro/Detox actions.
    env.EXPO_PUBLIC_E2E_SUPPRESS_LOGBOX = 'true';
  }
  const deadlineMs = options.deadlineMs ?? 120_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 || deadlineMs > 600_000)
    throw new Error('Invalid Expo acquisition deadline');
  const clientRoot = await realpath(options.clientRoot);
  const packageFile = path.join(clientRoot, 'package.json');
  const pkg = JSON.parse(await readFile(packageFile, 'utf8')) as { name: string };
  if (pkg.name !== 'my-champions') throw new Error('Wrong Expo owner repository');
  const artifactRoot = path.resolve(options.artifactRoot);
  if (!artifactRoot.startsWith(path.join(clientRoot, '.qa/artifacts') + path.sep))
    throw new Error('Expo artifacts must be under the client QA root');
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  if ((await realpath(artifactRoot)) !== artifactRoot)
    throw new Error('Expo artifact root contains a symlink');
  const cli = createRequire(packageFile).resolve('expo/bin/cli');
  try {
    await execute('lsof', ['-v'], { timeout: 5000 });
  } catch {
    throw new Error('Owned Expo requires lsof for listener ownership checks');
  }
  options.signal?.throwIfAborted();
  const resolved = await execute(process.execPath, [cli, 'config', '--type', 'public', '--json'], {
    cwd: clientRoot,
    env,
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
    signal: options.signal,
  });
  const config = JSON.parse(resolved.stdout) as { extra?: Record<string, unknown> };
  if (!config.extra) throw new Error('Resolved Expo configuration is missing');
  assertResolvedIntegratedExpoConfig(config.extra, options.apiOrigin);
  const temporaryRoot = await realpath(await mkdtemp(path.join(artifactRoot, 'expo-tmp-')));
  await chmod(temporaryRoot, 0o700);
  const temporaryMetadata = await lstat(temporaryRoot);
  const temporaryOwnerFile = path.join(temporaryRoot, 'owner.private.json');
  const temporaryOwner = JSON.stringify({
    artifactRoot,
    temporaryRoot,
    dev: temporaryMetadata.dev,
    ino: temporaryMetadata.ino,
    uid: temporaryMetadata.uid,
  });
  await writeFile(temporaryOwnerFile, temporaryOwner, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(artifactRoot, 'expo-cache-owner.private.json'), temporaryOwner, {
    flag: 'wx',
    mode: 0o600,
  });
  const removeTemporary = async () => {
    const directory = await lstat(temporaryRoot);
    const marker = await lstat(temporaryOwnerFile);
    if (
      (await realpath(temporaryRoot)) !== temporaryRoot ||
      path.dirname(temporaryRoot) !== artifactRoot ||
      !directory.isDirectory() ||
      (directory.mode & 0o777) !== 0o700 ||
      directory.dev !== temporaryMetadata.dev ||
      directory.ino !== temporaryMetadata.ino ||
      directory.uid !== temporaryMetadata.uid ||
      (process.getuid && directory.uid !== process.getuid()) ||
      !marker.isFile() ||
      (marker.mode & 0o777) !== 0o600 ||
      marker.uid !== directory.uid ||
      (await realpath(temporaryOwnerFile)) !== temporaryOwnerFile ||
      (await readFile(temporaryOwnerFile, 'utf8')) !== temporaryOwner
    )
      throw new Error('Expo temporary cache ownership changed; recovery retained');
    await rm(temporaryRoot, { recursive: true });
  };
  // Metro's transform cache defaults to os.tmpdir()/metro-cache. Concurrent
  // inline-environment bundles must never read or clear another run's cache.
  env.TMPDIR = temporaryRoot;
  try {
    await options.reservation.release();
  } catch (error) {
    await removeTemporary();
    throw error;
  }
  const argv = [
    cli,
    'start',
    ...(options.surface === 'native' ? [] : ['--web']),
    '--localhost',
    '--port',
    String(options.reservation.port),
    '--clear',
  ];
  const child = spawn(process.execPath, argv, {
    cwd: clientRoot,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (bytes: Buffer) => {
    output = (output + bytes.toString()).slice(-262_144);
  });
  child.stderr.on('data', (bytes: Buffer) => {
    output = (output + bytes.toString()).slice(-262_144);
  });
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  const exited = new Promise<void>((resolve) => child.once('close', () => resolve()));
  if (!child.pid) {
    await exited;
    await removeTemporary();
    throw new Error('Owned Expo process failed to start');
  }
  const pid = child.pid;
  const owned = new Map<number, OwnedProcess>();
  let stopPromise: Promise<void> | undefined;
  let cleanup = 'running';
  const commandCensusRequeries: CommandCensusRequery[] = [];
  let censusPublished = false;
  const publishCensus = async () => {
    await writeFile(
      path.join(artifactRoot, 'expo-census.ownership.json'),
      JSON.stringify(
        {
          kind: 'private Expo process census observations; no signal authority',
          pid,
          pgid: pid,
          processes: [],
          commandCensusRequeries,
          cleanup,
        },
        null,
        2,
      ),
      { mode: 0o600, flag: censusPublished ? 'w' : 'wx' },
    );
    censusPublished = true;
  };
  const inspect = async () => {
    try {
      return await groupProcesses(pid, (event) => commandCensusRequeries.push(event));
    } finally {
      await publishCensus();
    }
  };
  const observeAbsence = async () => {
    try {
      return await observeGroupProcesses(pid, (event) => commandCensusRequeries.push(event));
    } finally {
      await publishCensus();
    }
  };
  const ledger = async () => {
    const value = {
      kind: 'private process ownership ledger',
      clientRoot,
      cli,
      pid,
      pgid: pid,
      appOrigin: options.reservation.origin,
      apiOrigin: options.apiOrigin,
      processes: [...owned.values()],
      cleanup,
    };
    assertTestingDocument('expo-process-v1', value);
    await publishCensus();
    return writeFile(
      path.join(artifactRoot, 'expo-ownership.json'),
      JSON.stringify(value, null, 2),
      { mode: 0o600 },
    );
  };
  const capture = async () => {
    const current = await inspect();
    const parent = current.find((row) => row.pid === pid);
    const expected = owned.get(pid);
    if (
      parent &&
      (!expected ||
        (parent.started === expected.started && parent.commandHash === expected.commandHash))
    ) {
      for (const row of current) owned.set(row.pid, row);
    }
    return current;
  };
  const ownsListener = async () => {
    try {
      const listening = await execute(
        'lsof',
        ['-nP', `-iTCP:${options.reservation.port}`, '-sTCP:LISTEN', '-t'],
        { timeout: 5000 },
      );
      const pids = [...new Set(listening.stdout.trim().split(/\s+/).map(Number))];
      const current = await capture();
      return pids.length > 0 && pids.every((id) => current.some((row) => row.pid === id));
    } catch (error) {
      if ((error as { code?: number }).code === 1) return false;
      throw new Error('Expo listener ownership probe unavailable');
    }
  };
  const signalGroup = async (signal: 'SIGTERM' | 'SIGKILL') => {
    const current = await capture();
    for (const row of current) {
      const expected = owned.get(row.pid);
      if (!expected || row.started !== expected.started || row.commandHash !== expected.commandHash)
        throw new Error('Expo process group identity mismatch; recovery ledger retained');
    }
    if (current.length) process.kill(-pid, signal);
  };
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      try {
        await signalGroup('SIGTERM');
        const limit = performance.now() + 10_000;
        while ((await observeAbsence()).length && performance.now() < limit) await delay(100);
        if ((await observeAbsence()).length) await signalGroup('SIGKILL');
        const killLimit = performance.now() + 3000;
        while ((await observeAbsence()).length && performance.now() < killLimit) await delay(100);
        if ((await observeAbsence()).length) throw new Error('Owned Expo processes did not stop');
        // Process-group absence is the ownership boundary.  Expo can leave a
        // pipe descriptor open after every owned process has exited, which
        // prevents ChildProcess `close` from arriving and used to strand the
        // rest of a native-run cleanup behind an already-empty group.
        const closed = await Promise.race([exited.then(() => true), delay(1000).then(() => false)]);
        if (!closed) child.unref();
        await removeTemporary();
        cleanup = 'cleaned';
      } catch (error) {
        cleanup = 'failed-recovery-ledger-retained';
        throw error;
      } finally {
        await ledger();
        await writeFile(path.join(artifactRoot, 'expo.log'), output, { mode: 0o600 });
      }
    })();
    return stopPromise;
  };
  try {
    const limit = performance.now() + deadlineMs;
    let initialVerified = false;
    while (true) {
      options.signal?.throwIfAborted();
      if (spawnError || child.exitCode !== null || child.signalCode !== null)
        throw new Error('Owned Expo exited before readiness');
      if (performance.now() >= limit) throw new Error('Expo acquisition deadline exceeded');
      try {
        const current = await capture();
        if (!initialVerified) {
          if (!current.some((row) => row.pid === pid))
            throw new Error('Expo process ownership unavailable');
          await ledger();
          initialVerified = true;
        }
      } catch (error) {
        if (!(error instanceof OwnedCommandCensusUnavailableError)) throw error;
        // Unknown argv is not readiness or authority. Keep the existing startup
        // budget, retain its observations, and let the next bounded probe inspect.
        await delay(100, undefined, { signal: options.signal });
        continue;
      }
      try {
        const response = await fetch(
          options.reservation.origin + (options.surface === 'native' ? '/status' : ''),
          {
            signal: AbortSignal.timeout(1500),
            redirect: 'error',
          },
        );
        const body = await response.text();
        const healthy =
          options.surface === 'native'
            ? body.trim() === 'packager-status:running'
            : body.includes('<html');
        if (response.ok && healthy && (await ownsListener())) break;
      } catch {
        /* Not ready; original bounded acquisition deadline remains authoritative. */
      }
      await delay(100, undefined, { signal: options.signal });
    }
    await ledger();
    return {
      origin: options.reservation.origin,
      pid,
      pgid: pid,
      environment: env,
      configExtra: config.extra,
      get diagnostics() {
        return output;
      },
      get observedProcesses() {
        return [...owned.values()];
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
