import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, createConnection } from 'node:net';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import { assertTestingDocument } from './schema-validation';
import type { IntegrationContext, IntegrationCase } from './integration-context';
import type { startOwnedApiProxy } from './owned-api-proxy';
import type { OwnedDomainSnapshot, OwnedFixtures, startOwnedSession } from './owned-session';
import type { Socket } from 'node:net';

export type WorkerOperation =
  | { kind: 'snapshot' }
  | { kind: 'restart' }
  | { kind: 'arm-save-fault'; method: 'POST' | 'PATCH'; path: string; accessToken: string }
  | { kind: 'clear-save-fault' };
export type WorkerEndpoint = { root: string; socket: string };
type Request = {
  schemaVersion: 1;
  id: string;
  attemptId: string;
  capability: string;
  operation: WorkerOperation;
};
type Response = {
  schemaVersion: 1;
  id: string;
  attemptId: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};
const requestLimit = 65_536;
const responseLimit = 1_048_576;
const keysAre = (value: object, keys: string[]) =>
  Object.keys(value).sort().join(',') === keys.sort().join(',');
export function validateWorkerRequest(value: unknown): Request {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid worker request');
  const row = value as Request;
  if (
    !keysAre(row, ['schemaVersion', 'id', 'attemptId', 'capability', 'operation']) ||
    row.schemaVersion !== 1 ||
    !/^[a-f0-9]{24}$/.test(row.id) ||
    !/^[a-z-]+$/.test(row.attemptId) ||
    !/^[a-f0-9]{64}$/.test(row.capability) ||
    !row.operation ||
    typeof row.operation !== 'object' ||
    Array.isArray(row.operation)
  )
    throw new Error('Invalid worker identity');
  const operation = row.operation;
  if (
    ['snapshot', 'restart', 'clear-save-fault'].includes(operation.kind) &&
    keysAre(operation, ['kind'])
  )
    return row;
  if (
    operation.kind === 'arm-save-fault' &&
    keysAre(operation, ['kind', 'method', 'path', 'accessToken']) &&
    ((operation.method === 'POST' && operation.path === '/plans/training') ||
      (operation.method === 'PATCH' &&
        /^\/plans\/training\/training_plan_[a-f0-9-]{36}$/.test(operation.path))) &&
    typeof operation.accessToken === 'string' &&
    operation.accessToken.length > 0 &&
    operation.accessToken.length <= 16384 &&
    !/[\r\n]/.test(operation.accessToken)
  )
    return row;
  throw new Error('Invalid worker operation');
}

async function endpointMetadata(endpoint: WorkerEndpoint, runId: string) {
  const temporary = await realpath('/tmp');
  if (
    (await realpath(endpoint.root)) !== endpoint.root ||
    path.dirname(endpoint.root) !== temporary ||
    !path.basename(endpoint.root).startsWith(`mc-web-control-${runId}-`) ||
    endpoint.socket !== path.join(endpoint.root, 'control.sock')
  )
    throw new Error('Worker control root changed');
  const root = await lstat(endpoint.root);
  if (
    !root.isDirectory() ||
    (root.mode & 0o777) !== 0o700 ||
    (process.getuid && root.uid !== process.getuid())
  )
    throw new Error('Worker control directory is not private');
  const socket = await lstat(endpoint.socket);
  if (
    !socket.isSocket() ||
    (socket.mode & 0o777) !== 0o600 ||
    (process.getuid && socket.uid !== process.getuid())
  )
    throw new Error('Worker control socket is not private');
}

export async function startWorkerControl(options: {
  context: IntegrationContext;
  fixtures: Map<string, OwnedFixtures>;
  session: Awaited<ReturnType<typeof startOwnedSession>>;
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>;
  signal: AbortSignal;
}) {
  const { context, fixtures, session, proxy, signal } = options;
  assertTestingDocument('integration-context-v1', context);
  if (
    context.runId !== session.manifest.runId ||
    context.parentPid !== process.pid ||
    context.apiOrigin !== proxy.origin
  )
    throw new Error('Worker control owner mismatch');
  const root = await realpath(
    await mkdtemp(path.join(await realpath('/tmp'), `mc-web-control-${context.runId}-`)),
  );
  await chmod(root, 0o700);
  const endpoint = { root, socket: path.join(root, 'control.sock') };
  const owner = {
    runId: context.runId,
    parentPid: context.parentPid,
    parentStarted: context.parentStarted,
    root,
  };
  const ownerFile = path.join(root, 'owner.private.json');
  const ownerBytes = JSON.stringify(owner);
  await writeFile(ownerFile, ownerBytes, { mode: 0o600, flag: 'wx' });
  const sockets = new Set<Socket>();
  const requests = new Set<string>();
  const observations: { id: string; attemptId: string; operation: string; outcome: string }[] = [];
  let closing = false;
  let drain = Promise.resolve();
  let stopPromise: Promise<void> | undefined;
  const handle = async (raw: unknown) => {
    const request = validateWorkerRequest(raw);
    const selected = context.cases.find((row) => row.attemptId === request.attemptId);
    if (
      !selected ||
      !timingSafeEqual(Buffer.from(selected.controlToken), Buffer.from(request.capability)) ||
      requests.has(request.id) ||
      requests.size >= 1000 ||
      closing ||
      signal.aborted
    )
      throw new Error('Worker control identity rejected');
    requests.add(request.id);
    const operation = request.operation;
    const observation = {
      id: request.id,
      attemptId: selected.attemptId,
      operation: operation.kind,
      outcome: 'failed',
    };
    observations.push(observation);
    let result: unknown;
    if (operation.kind === 'snapshot') result = await session.snapshot(selected.fixtureScope);
    else if (operation.kind === 'restart') {
      if (!['training-durable', 'save-retry', 'unrelated-denial'].includes(selected.scenarioId))
        throw new Error('Scenario cannot restart');
      result = await proxy.restartApi();
    } else {
      if (selected.scenarioId !== 'save-retry')
        throw new Error('Scenario cannot configure save faults');
      if (operation.kind === 'arm-save-fault') {
        const fixture = fixtures.get(selected.attemptId);
        if (!fixture) throw new Error('Fault fixture missing');
        if (operation.method === 'PATCH') {
          const snapshot = await session.snapshot(selected.fixtureScope);
          if (
            !snapshot.trainingPlans.some(
              (row) =>
                `/plans/training/${row.id}` === operation.path &&
                row.ownerProfessionalUid === fixture.accounts.coach.authUid,
            )
          )
            throw new Error('Fault plan is outside the selected coach scope');
        }
        await proxy.armFault({
          attemptId: selected.attemptId,
          method: operation.method,
          path: operation.path,
          accountUid: fixture.accounts.coach.authUid,
          accessToken: operation.accessToken,
        });
        result = proxy.faultState;
      } else result = proxy.clearFault(selected.attemptId);
    }
    signal.throwIfAborted();
    observation.outcome = 'completed';
    return result;
  };
  const server = createServer((socket) => {
    if (closing) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(35_000, () => socket.destroy());
    let buffer = '';
    let consumed = false;
    const decoder = new StringDecoder('utf8');
    socket.on('data', (bytes) => {
      if (consumed) {
        socket.destroy();
        return;
      }
      buffer += decoder.write(bytes);
      if (Buffer.byteLength(buffer) > requestLimit) {
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      consumed = true;
      if (newline !== buffer.length - 1) {
        socket.destroy();
        return;
      }
      let raw: unknown;
      try {
        raw = JSON.parse(buffer.slice(0, newline));
      } catch {
        socket.destroy();
        return;
      }
      drain = drain.then(async () => {
        const identity = raw as { id?: unknown; attemptId?: unknown };
        const response: Response = {
          schemaVersion: 1,
          id: typeof identity?.id === 'string' ? identity.id : '',
          attemptId: typeof identity?.attemptId === 'string' ? identity.attemptId : '',
          ok: false,
          error: 'worker-control-rejected',
        };
        try {
          if (closing || signal.aborted || socket.destroyed) throw new Error('Control is closing');
          response.result = await handle(raw);
          response.ok = true;
          delete response.error;
        } catch {
          /* Errors never echo capabilities, bearer tokens or private bodies. */
        }
        const bytes = JSON.stringify(response) + '\n';
        if (!socket.destroyed && Buffer.byteLength(bytes) <= responseLimit) socket.end(bytes);
        else socket.destroy();
      });
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(endpoint.socket, () => {
        server.off('error', reject);
        resolve();
      });
    });
    await chmod(endpoint.socket, 0o600);
    await endpointMetadata(endpoint, context.runId);
  } catch (error) {
    server.close();
    await rm(root, { recursive: true, force: true });
    throw error;
  }
  return {
    endpoint,
    get observations() {
      return observations.map((row) => ({ ...row }));
    },
    stop() {
      if (stopPromise) return stopPromise;
      closing = true;
      for (const socket of sockets) socket.destroy();
      stopPromise = (async () => {
        await drain;
        let ownershipError: unknown;
        try {
          await endpointMetadata(endpoint, context.runId);
          const metadata = await lstat(ownerFile);
          if (
            !metadata.isFile() ||
            (metadata.mode & 0o777) !== 0o600 ||
            (process.getuid && metadata.uid !== process.getuid()) ||
            (await realpath(ownerFile)) !== ownerFile ||
            (await readFile(ownerFile, 'utf8')) !== ownerBytes
          )
            throw new Error('Worker control owner changed; recovery retained');
        } catch (error) {
          ownershipError = error;
        }
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        if (ownershipError)
          throw ownershipError instanceof Error
            ? ownershipError
            : new Error('Worker control ownership unknown; recovery retained');
        await rm(root, { recursive: true });
      })();
      return stopPromise;
    },
  };
}

export async function invokeWorkerControl(
  context: IntegrationContext,
  selected: IntegrationCase,
  operation: WorkerOperation,
) {
  if (!context.control) throw new Error('Worker control is unavailable');
  await endpointMetadata(context.control, context.runId);
  const request: Request = {
    schemaVersion: 1,
    id: randomBytes(12).toString('hex'),
    attemptId: selected.attemptId,
    capability: selected.controlToken,
    operation,
  };
  validateWorkerRequest(request);
  return new Promise<unknown>((resolve, reject) => {
    const socket = createConnection(context.control!.socket);
    let buffer = '';
    let settled = false;
    const decoder = new StringDecoder('utf8');
    const deadline = setTimeout(
      () => finish(new Error('Worker control deadline exceeded')),
      35_000,
    );
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
    socket.once('error', () => finish(new Error('Worker control transport failed')));
    socket.once('close', () => {
      if (!settled) finish(new Error('Worker control closed without a response'));
    });
    socket.on('data', (bytes) => {
      buffer += decoder.write(bytes);
      if (Buffer.byteLength(buffer) > responseLimit) {
        finish(new Error('Worker control response too large'));
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        if (newline !== buffer.length - 1) throw new Error('Unexpected response framing');
        const response = JSON.parse(buffer.slice(0, newline)) as Response;
        if (
          response.schemaVersion !== 1 ||
          response.id !== request.id ||
          response.attemptId !== selected.attemptId ||
          response.ok !== true ||
          !keysAre(response, ['schemaVersion', 'id', 'attemptId', 'ok', 'result'])
        )
          throw new Error('Worker control response rejected');
        if (operation.kind === 'snapshot') {
          assertTestingDocument('domain-snapshot-v1', response.result);
          const snapshot = response.result as OwnedDomainSnapshot;
          if (snapshot.runId !== context.runId || snapshot.scope !== selected.fixtureScope)
            throw new Error('Worker snapshot identity mismatch');
        }
        if (operation.kind === 'restart') {
          const result = response.result as { apiOrigin: string; apiPid: number };
          if (
            !result ||
            !keysAre(result, ['apiOrigin', 'apiPid']) ||
            !Number.isSafeInteger(result.apiPid) ||
            result.apiPid <= 1
          )
            throw new Error('Invalid worker restart result');
          requireIntegratedLoopbackOrigin(result.apiOrigin);
          if ([context.apiOrigin, context.appOrigin].includes(result.apiOrigin))
            throw new Error('Restart origin collision');
        } else if (operation.kind !== 'snapshot') {
          const result = response.result as { attemptId: string; injectedCount: number };
          if (
            !result ||
            !keysAre(result, ['attemptId', 'injectedCount']) ||
            result.attemptId !== selected.attemptId ||
            ![0, 1].includes(result.injectedCount)
          )
            throw new Error('Invalid worker fault result');
        }
        finish(undefined, response.result);
      } catch {
        finish(new Error('Worker control response rejected'));
      }
    });
  });
}
