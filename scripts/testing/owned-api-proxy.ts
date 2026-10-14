import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { lstat, writeFile } from 'node:fs/promises';
import { createServer, request as requestHttp } from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import type { startOwnedSession } from './owned-session';
import type { IncomingHttpHeaders, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

type Session = Awaited<ReturnType<typeof startOwnedSession>>;
type Fault = {
  attemptId: string;
  method: 'POST' | 'PATCH';
  path: string;
  accountUid: string;
  accessToken: string;
};
type InternalFault = Omit<Fault, 'method'> & {
  method: Fault['method'] | 'GET';
};
export type ProxyObservation = {
  requestId: number;
  method: string;
  pathHash: string;
  requestOrigin: string | null;
  requestProfile: 'browser' | 'native';
  /** True when an inbound Authorization or Cookie credential header was present. */
  requestCredentialPresent?: boolean;
  /** Header shape only: never values, arbitrary names or token-derived hashes. */
  requestCredentialClassification?: {
    authorization: 'absent' | 'empty' | 'bearer' | 'other';
    cookie: 'absent' | 'empty' | 'present';
    knownAccessCookie: 'absent' | 'empty' | 'nonempty';
    knownRefreshCookie: 'absent' | 'empty' | 'nonempty';
    otherCookiePresent: boolean;
    malformedCookiePresent: boolean;
  };
  targetOrigin: string;
  status: number;
  outcome: 'forwarded' | 'injected' | 'rejected' | 'upstream-failed';
  faultAttemptId: string | null;
  elapsedMs: number;
};

function classifyCredentialHeaders(
  headers: IncomingHttpHeaders,
): NonNullable<ProxyObservation['requestCredentialClassification']> {
  const authorization = headers.authorization;
  const cookie = headers.cookie;
  const result: NonNullable<ProxyObservation['requestCredentialClassification']> = {
    authorization:
      authorization === undefined
        ? 'absent'
        : !authorization.trim()
          ? 'empty'
          : /^Bearer\s+\S/i.test(authorization)
            ? 'bearer'
            : 'other',
    cookie: cookie === undefined ? 'absent' : !cookie.trim() ? 'empty' : 'present',
    knownAccessCookie: 'absent',
    knownRefreshCookie: 'absent',
    otherCookiePresent: false,
    malformedCookiePresent: false,
  };
  for (const part of cookie?.split(';') ?? []) {
    if (!part.trim()) continue;
    const separator = part.indexOf('=');
    if (separator < 1 || !part.slice(0, separator).trim()) {
      result.malformedCookiePresent = true;
      continue;
    }
    const name = part.slice(0, separator).trim();
    const state = part.slice(separator + 1).trim() ? 'nonempty' : 'empty';
    // These are the current owned server's two cookie names. Unknown names are
    // deliberately not classified as harmless and are never retained.
    if (name === 'mychampions_access_token') {
      if (result.knownAccessCookie !== 'nonempty') result.knownAccessCookie = state;
    } else if (name === 'mychampions_refresh_token') {
      if (result.knownRefreshCookie !== 'nonempty') result.knownRefreshCookie = state;
    } else result.otherCookiePresent = true;
  }
  return result;
}

export type NativeAuthIdentityVerificationReason =
  | 'verified'
  | 'not-forwarded'
  | 'status-not-201'
  | 'upstream-identity-mismatch'
  | 'upstream-disconnected'
  | 'response-body-incomplete'
  | 'response-body-too-large'
  | 'response-body-invalid-json'
  | 'response-principal-missing'
  | 'response-principal-not-allowed';

/** Redacted principal evidence for the opt-in native connection lane. */
export type NativeRequestBodyCaptureConfig = {
  artifactRoot: string;
  captureRunId: string;
  /** The owned backend session run that owns this request window. */
  sessionRunId?: string;
  backendAttemptId: string;
  actorAuthUidSha256: string;
  targetOrigin: string;
  apiPid: number;
  manualCodeSha256: string;
  actionSha256: string;
};

export type NativeRequestBodyCaptureReceipt = {
  kind: 'owned-native-request-body-receipt-v1';
  producer: 'owned-api-proxy-native-request-body-v1';
  requestId: number;
  method: 'POST';
  pathHash: string;
  status: number;
  outcome: ProxyObservation['outcome'];
  targetOrigin: string;
  apiPid: number;
  backendAttemptId: string;
  actorAuthUidSha256: string;
  manualCodeSha256: string;
  actionSha256: string;
  bodyPath: string;
  bodySha256: string;
  bodySizeBytes: number;
  route: '/connections/invite-submissions';
  requestProfile: 'native';
  requestOrigin: null;
  captureRunId: string;
  sessionRunId: string;
  actorAuthUidHash: string;
  sourcePath: string;
  sourceSha256: string;
  sizeBytes: number;
  descriptorPath: string;
  schema: 'json-code';
  source: 'owned-api-proxy-native-request-body';
};

export type NativeAuthIdentityObservation = {
  requestId: number;
  ordinal: number;
  targetOrigin: string;
  apiPid: number;
  status: number;
  authUid: string | null;
  verification: 'verified' | 'unverified';
  verificationReason: NativeAuthIdentityVerificationReason;
  fixtureAuthUidAllowlistHash: string;
};

type NativeAuthResponseCapture = {
  ordinal: number;
  chunks: Buffer[];
  byteCount: number;
  tooLarge: boolean;
  ended: boolean;
  disconnected: boolean;
  errored: boolean;
};

const nativeAuthResponseMaxBytes = 16 * 1024;
const nativeRequestBodyMaxBytes = 1 * 1024 * 1024;
const nativeRequestBodyRoute = '/connections/invite-submissions';
const SHA256 = /^[a-f0-9]{64}$/u;
const nativeAuthFixtureUidMaxCount = 32;
const nativeAuthFixtureUidMaxLength = 256;

function nativeAuthFixtureAllowlistHash(values: readonly string[]) {
  return createHash('sha256')
    .update(JSON.stringify([...values].sort()))
    .digest('hex');
}

const hopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
function forwardedHeaders(headers: IncomingHttpHeaders) {
  const excluded = new Set(hopHeaders);
  for (const header of (headers.connection ?? '').split(','))
    excluded.add(header.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !excluded.has(key)));
}
function identity(session: Session) {
  requireIntegratedLoopbackOrigin(session.apiOrigin);
  if (
    session.manifest.port === Number(new URL(session.apiOrigin).port) ||
    !session.manifest.processes.some((row) => row.role === 'api' && row.pid === session.apiPid)
  )
    throw new Error('Proxy upstream does not match the owned API');
  return session.apiOrigin;
}

/** In-process control only: every upstream comes from the validated owned session. */
export async function startOwnedApiProxy(options: {
  session: Session;
  appOrigin: string;
  requestDeadlineMs?: number;
  requestProfile?: 'browser' | 'native';
  requestedPort?: number;
}) {
  const { session } = options;
  const appOrigin = requireIntegratedLoopbackOrigin(options.appOrigin);
  if (
    options.requestedPort !== undefined &&
    (!Number.isSafeInteger(options.requestedPort) ||
      options.requestedPort < 1024 ||
      options.requestedPort > 65535)
  )
    throw new Error('Invalid proxy port');
  const requestProfile = options.requestProfile ?? 'browser';
  if (!['browser', 'native'].includes(requestProfile))
    throw new Error('Invalid proxy request profile');
  let upstream = identity(session);
  let upstreamPid = session.apiPid;
  if (upstream === appOrigin) throw new Error('Proxy requires a distinct app/API origin');
  const requestDeadlineMs = options.requestDeadlineMs ?? 15_000;
  if (
    !Number.isSafeInteger(requestDeadlineMs) ||
    requestDeadlineMs < 100 ||
    requestDeadlineMs > 60_000
  )
    throw new Error('Invalid proxy request deadline');
  let origin = '';
  let closing = false;
  let restarting = false;
  let arming = false;
  let reading = false;
  let readSetup: AbortController | undefined;
  let faultSetup: AbortController | undefined;
  let fault: (InternalFault & { injectedCount: number }) | undefined;
  let counter = 0;
  let active = 0;
  let drainPromise: Promise<void> | undefined;
  let resolveDrain: (() => void) | undefined;
  let stopPromise: Promise<void> | undefined;
  let nativeAuthIdentityAllowlist: ReadonlySet<string> | undefined;
  let nativeAuthIdentityAllowlistHash = '';
  let nativeAuthRequestSeen = false;
  let nativeRequestBodyCaptureConfig: NativeRequestBodyCaptureConfig | undefined;
  let nativeRequestBodyCaptureSeen = false;
  let nativeRequestBodyReceipt: NativeRequestBodyCaptureReceipt | undefined;
  let nativeRequestBodyFailure: string | undefined;
  const nativeRequestBodyFinalizations = new Set<Promise<void>>();
  let nativeAuthOrdinal = 0;
  // Never expose or persist this credential. It comes only from forwarded
  // no-Origin catalog traffic and is bound to this upstream process lifetime.
  let observedNativeCredential: { token: string; origin: string; pid: number } | undefined;
  const attempts = new Set<string>();
  const observations: ProxyObservation[] = [];
  const nativeAuthIdentities: NativeAuthIdentityObservation[] = [];
  const sockets = new Set<Socket>();
  const outbound = new Set<ReturnType<typeof requestHttp>>();
  const responses = new Set<ServerResponse>();
  const waitForActiveRequests = () => {
    if (active === 0) return Promise.resolve();
    if (!drainPromise) {
      drainPromise = new Promise<void>((resolve) => {
        resolveDrain = resolve;
      });
    }
    return drainPromise;
  };
  const server = createServer(
    { connectionsCheckingInterval: Math.min(requestDeadlineMs, 1000) },
    (incoming, response) => {
      // Keep the request body paused while ownership is checked. Adding a
      // data listener before the async check switches IncomingMessage into
      // flowing mode; a completed native POST can then be destroyed before
      // the owned upstream pipe is installed.
      incoming.pause();
      const started = performance.now();
      const requestId = ++counter;
      const method = incoming.method ?? 'UNKNOWN';
      const raw = incoming.url ?? '';
      const pathHash = createHash('sha256').update(raw.split('?')[0]).digest('hex');
      // Do not persist arbitrary origin values, URLs, headers or request/response bodies.
      const requestOrigin = incoming.headers.origin === appOrigin ? appOrigin : null;
      const targetOrigin = upstream;
      const targetPid = upstreamPid;
      const authorization = incoming.headers.authorization;
      const nativeAuthRequest =
        requestProfile === 'native' &&
        incoming.headers.origin === undefined &&
        method === 'POST' &&
        raw === '/auth/email/sign-in';
      if (nativeAuthRequest) nativeAuthRequestSeen = true;
      const nativeBodyRequest =
        requestProfile === 'native' &&
        incoming.headers.origin === undefined &&
        method === 'POST' &&
        raw === nativeRequestBodyRoute &&
        nativeRequestBodyCaptureConfig !== undefined;
      if (nativeBodyRequest) {
        if (nativeRequestBodyCaptureSeen)
          throw new Error('Native request body capture may only observe one submission');
        nativeRequestBodyCaptureSeen = true;
      }
      const nativeBodyChunks: Buffer[] = [];
      let nativeBodyBytes = 0;
      let nativeBodyTooLarge = false;
      let nativeBodyEnded = false;
      let nativeBodyErrored = false;
      const captureNativeBody = (chunk: Buffer | Uint8Array) => {
        if (!nativeBodyRequest || nativeBodyTooLarge) return;
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        nativeBodyBytes += bytes.byteLength;
        if (nativeBodyBytes > nativeRequestBodyMaxBytes) {
          nativeBodyTooLarge = true;
          nativeBodyChunks.length = 0;
          return;
        }
        nativeBodyChunks.push(bytes);
      };
      if (nativeBodyRequest) {
        // These terminal listeners do not consume the paused body. The data
        // listener is installed only after the ownership fence succeeds.
        incoming.once('end', () => {
          nativeBodyEnded = true;
        });
        incoming.once('aborted', () => {
          nativeBodyErrored = true;
        });
        incoming.once('error', () => {
          nativeBodyErrored = true;
        });
      }
      const nativeAuthCapture: NativeAuthResponseCapture | undefined =
        nativeAuthRequest && nativeAuthIdentityAllowlist
          ? {
              ordinal: ++nativeAuthOrdinal,
              chunks: [],
              byteCount: 0,
              tooLarge: false,
              ended: false,
              disconnected: false,
              errored: false,
            }
          : undefined;
      let outcome: ProxyObservation['outcome'] = 'rejected';
      let faultAttemptId: string | null = null;
      active++;
      responses.add(response);
      let finished = false;
      const finishNativeAuthIdentity = () => {
        if (!nativeAuthCapture || !nativeAuthIdentityAllowlist) return;
        const status = response.writableFinished ? response.statusCode : 0;
        let authUid: string | null = null;
        let verificationReason: NativeAuthIdentityVerificationReason = 'not-forwarded';
        const sameOwnedUpstream =
          !closing &&
          !restarting &&
          targetOrigin === upstream &&
          targetPid === upstreamPid &&
          upstream === session.apiOrigin &&
          upstreamPid === session.apiPid;
        if (!sameOwnedUpstream) verificationReason = 'upstream-identity-mismatch';
        else if (nativeAuthCapture.errored || nativeAuthCapture.disconnected)
          verificationReason = 'upstream-disconnected';
        else if (outcome !== 'forwarded') verificationReason = 'not-forwarded';
        else if (!response.writableFinished || !nativeAuthCapture.ended)
          verificationReason = 'response-body-incomplete';
        else if (nativeAuthCapture.tooLarge) verificationReason = 'response-body-too-large';
        else if (status !== 201) verificationReason = 'status-not-201';
        else {
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.concat(nativeAuthCapture.chunks).toString('utf8'));
          } catch {
            verificationReason = 'response-body-invalid-json';
          }
          if (verificationReason === 'not-forwarded' && parsed && typeof parsed === 'object') {
            const profile = (parsed as { profile?: unknown }).profile;
            const candidate =
              profile && typeof profile === 'object'
                ? (profile as { authUid?: unknown }).authUid
                : undefined;
            if (typeof candidate !== 'string' || !candidate)
              verificationReason = 'response-principal-missing';
            else if (!nativeAuthIdentityAllowlist.has(candidate))
              verificationReason = 'response-principal-not-allowed';
            else {
              authUid = candidate;
              verificationReason = 'verified';
            }
          } else if (verificationReason === 'not-forwarded') {
            verificationReason = 'response-principal-missing';
          }
        }
        nativeAuthIdentities.push(
          Object.freeze({
            requestId,
            ordinal: nativeAuthCapture.ordinal,
            targetOrigin,
            apiPid: targetPid,
            status,
            authUid,
            verification: verificationReason === 'verified' ? 'verified' : 'unverified',
            verificationReason,
            fixtureAuthUidAllowlistHash: nativeAuthIdentityAllowlistHash,
          }),
        );
        nativeAuthCapture.chunks = [];
      };
      const finalizeNativeBodyCapture = async () => {
        const config = nativeRequestBodyCaptureConfig;
        if (!nativeBodyRequest || !config || nativeRequestBodyReceipt) return;
        if (nativeBodyErrored || !nativeBodyEnded || nativeBodyTooLarge)
          throw new Error('Native request body capture was incomplete or oversized');
        if (targetOrigin !== config.targetOrigin || targetPid !== config.apiPid)
          throw new Error('Native request body capture upstream identity changed');
        const body = Buffer.concat(nativeBodyChunks);
        let parsed: unknown;
        try {
          parsed = JSON.parse(body.toString('utf8'));
        } catch {
          throw new Error('Native request body is not JSON');
        }
        const code =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as { code?: unknown }).code
            : undefined;
        if (
          typeof code !== 'string' ||
          createHash('sha256').update(code).digest('hex') !== config.manualCodeSha256
        )
          throw new Error('Native request body code does not bind to the observed manual code');
        if (!SHA256.test(config.actionSha256) || !SHA256.test(config.actorAuthUidSha256))
          throw new Error('Native request body capture binding hashes are invalid');
        const sourcePath = 'camera-manual-submit-body.private.bin';
        const descriptorPath = 'camera-manual-submit-receipt.private.json';
        const root = realpathSync(config.artifactRoot);
        if (root !== config.artifactRoot)
          throw new Error('Native request body artifact root is not canonical');
        const sourceAbsolute = path.resolve(root, sourcePath);
        const descriptorAbsolute = path.resolve(root, descriptorPath);
        if (
          !sourceAbsolute.startsWith(`${root}${path.sep}`) ||
          !descriptorAbsolute.startsWith(`${root}${path.sep}`) ||
          realpathSync(path.dirname(sourceAbsolute)) !== path.dirname(sourceAbsolute)
        )
          throw new Error('Native request body artifact path is not canonical');
        await writeFile(sourceAbsolute, body, { flag: 'wx', mode: 0o600 });
        const sourceStat = await lstat(sourceAbsolute);
        if (
          !sourceStat.isFile() ||
          sourceStat.isSymbolicLink() ||
          sourceStat.nlink !== 1 ||
          sourceStat.mode & 0o077 ||
          sourceStat.uid !== process.getuid?.()
        )
          throw new Error('Native request body source identity is not private and regular');
        const sourceSha256 = createHash('sha256').update(body).digest('hex');
        const descriptor: NativeRequestBodyCaptureReceipt = {
          kind: 'owned-native-request-body-receipt-v1',
          producer: 'owned-api-proxy-native-request-body-v1',
          requestId,
          method: 'POST',
          pathHash,
          status: response.writableFinished ? response.statusCode : 0,
          outcome,
          targetOrigin,
          apiPid: targetPid,
          backendAttemptId: config.backendAttemptId,
          actorAuthUidSha256: config.actorAuthUidSha256,
          manualCodeSha256: config.manualCodeSha256,
          actionSha256: config.actionSha256,
          bodyPath: sourcePath,
          bodySha256: sourceSha256,
          bodySizeBytes: body.byteLength,
          route: '/connections/invite-submissions',
          requestProfile: 'native',
          requestOrigin: null,
          captureRunId: config.captureRunId,
          sessionRunId: config.sessionRunId ?? config.captureRunId,
          actorAuthUidHash: config.actorAuthUidSha256,
          sourcePath,
          sourceSha256,
          sizeBytes: body.byteLength,
          descriptorPath,
          schema: 'json-code',
          source: 'owned-api-proxy-native-request-body',
        };
        await writeFile(descriptorAbsolute, JSON.stringify(descriptor, null, 2), {
          flag: 'wx',
          mode: 0o600,
        });
        const descriptorStat = await lstat(descriptorAbsolute);
        if (
          !descriptorStat.isFile() ||
          descriptorStat.isSymbolicLink() ||
          descriptorStat.nlink !== 1 ||
          descriptorStat.mode & 0o077 ||
          descriptorStat.uid !== process.getuid?.()
        )
          throw new Error('Native request body descriptor identity is not private and regular');
        nativeRequestBodyReceipt = Object.freeze(descriptor);
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        active--;
        finishNativeAuthIdentity();
        if (nativeBodyRequest) {
          const pending = finalizeNativeBodyCapture();
          nativeRequestBodyFinalizations.add(pending);
          pending
            .catch((error: unknown) => {
              // Retain the reason privately; callers report it with the missing receipt.
              nativeRequestBodyFailure = error instanceof Error ? error.message : String(error);
            })
            .finally(() => nativeRequestBodyFinalizations.delete(pending))
            .catch(() => {});
        }
        if (
          requestProfile === 'native' &&
          incoming.headers.origin === undefined &&
          method === 'GET' &&
          raw === '/plans/predefined' &&
          outcome === 'forwarded' &&
          response.writableFinished &&
          response.statusCode === 200 &&
          !closing &&
          !restarting &&
          targetOrigin === upstream &&
          targetPid === upstreamPid &&
          upstream === session.apiOrigin &&
          upstreamPid === session.apiPid &&
          authorization?.startsWith('Bearer ') &&
          authorization.length <= 8192 &&
          authorization.length > 7 &&
          !/[\r\n]/.test(authorization)
        )
          observedNativeCredential = {
            token: authorization.slice(7),
            origin: targetOrigin,
            pid: targetPid,
          };
        observations.push({
          requestId,
          method,
          pathHash,
          requestOrigin,
          requestProfile,
          requestCredentialPresent:
            authorization !== undefined || incoming.headers.cookie !== undefined,
          requestCredentialClassification: classifyCredentialHeaders(incoming.headers),
          targetOrigin,
          status: response.writableFinished ? response.statusCode : 0,
          outcome,
          faultAttemptId,
          elapsedMs: performance.now() - started,
        });
        responses.delete(response);
        if (active === 0) resolveDrain?.();
      };
      response.once('finish', finish);
      response.once('close', finish);
      const reject = (status: number, code: string) => {
        incoming.resume();
        respond(response, status, code);
      };
      const respond = (output: ServerResponse, status: number, code: string) => {
        if (output.writableEnded || output.destroyed) return;
        if (output.headersSent) {
          output.destroy();
          return;
        }
        output.writeHead(status, {
          'content-type': 'application/json',
          ...(requestOrigin
            ? {
                'access-control-allow-origin': appOrigin,
                'access-control-allow-credentials': 'true',
                vary: 'Origin',
              }
            : {}),
        });
        output.end(
          JSON.stringify({
            error: { code, message: 'Owned integration proxy request failed.' },
          }),
        );
      };
      let downstream: ReturnType<typeof requestHttp> | undefined;
      const timer = setTimeout(() => {
        outcome = 'upstream-failed';
        downstream?.destroy(new Error('Owned proxy request deadline exceeded'));
        reject(504, 'integration_proxy_deadline');
      }, requestDeadlineMs);
      const retire = () => {
        clearTimeout(timer);
        if (downstream) outbound.delete(downstream);
      };
      response.once('finish', retire);
      response.once('close', () => {
        retire();
        downstream?.destroy();
      });
      if (
        closing ||
        restarting ||
        upstream !== session.apiOrigin ||
        upstreamPid !== session.apiPid ||
        incoming.headers.host !== new URL(origin).host ||
        !raw.startsWith('/') ||
        raw.startsWith('//') ||
        raw.includes('\\') ||
        !(
          incoming.headers.origin === appOrigin ||
          (requestProfile === 'native' && incoming.headers.origin === undefined)
        )
      ) {
        reject(403, 'integration_proxy_request_rejected');
        return;
      }
      const url = new URL(raw, origin);
      if (url.origin !== origin) {
        reject(403, 'integration_proxy_request_rejected');
        return;
      }
      if (
        fault &&
        fault.injectedCount === 0 &&
        method === fault.method &&
        raw === fault.path &&
        incoming.headers.authorization === `Bearer ${fault.accessToken}`
      ) {
        fault.injectedCount++;
        outcome = 'injected';
        faultAttemptId = fault.attemptId;
        // Consume exactly once before creating any upstream request.
        reject(
          503,
          fault.method === 'GET' ? 'integration_load_unavailable' : 'integration_save_unavailable',
        );
        return;
      }
      const forward = async () => {
        if (
          (await session.assertApiOwnership()) !== targetOrigin ||
          closing ||
          restarting ||
          incoming.destroyed ||
          response.destroyed
        )
          throw new Error('Proxy upstream ownership changed');
        outcome = 'forwarded';
        const headers = forwardedHeaders(incoming.headers);
        headers.host = new URL(targetOrigin).host;
        const child = requestHttp(`${targetOrigin}${raw}`, { method, headers }, (remote) => {
          response.writeHead(remote.statusCode ?? 502, forwardedHeaders(remote.headers));
          remote.once('error', () => response.destroy());
          if (nativeAuthCapture) {
            remote.on('data', (chunk: Buffer | Uint8Array) => {
              if (nativeAuthCapture.tooLarge) return;
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              nativeAuthCapture.byteCount += bytes.byteLength;
              if (nativeAuthCapture.byteCount > nativeAuthResponseMaxBytes) {
                nativeAuthCapture.tooLarge = true;
                nativeAuthCapture.chunks = [];
                return;
              }
              nativeAuthCapture.chunks.push(bytes);
            });
            remote.once('end', () => {
              nativeAuthCapture.ended = true;
            });
            remote.once('close', () => {
              if (!nativeAuthCapture.ended) nativeAuthCapture.disconnected = true;
            });
            remote.once('error', () => {
              nativeAuthCapture.errored = true;
            });
          }
          remote.pipe(response);
        });
        downstream = child;
        outbound.add(child);
        child.once('error', () => {
          outcome = 'upstream-failed';
          respond(response, 502, 'integration_proxy_upstream_failed');
        });
        incoming.once('aborted', () => child.destroy());
        incoming.once('error', () => child.destroy());
        if (nativeBodyRequest) incoming.on('data', captureNativeBody);
        // The request remained paused across the async ownership fence; pipe
        // is the single transition that resumes it and forwards the body.
        incoming.pipe(child);
      };
      void forward().catch(() => {
        outcome = 'upstream-failed';
        reject(503, 'integration_proxy_ownership_failed');
      });
    },
  );
  // Bound the body through our classified response before Node's fallback 408.
  // Header-only stalls still use headersTimeout and the bounded check interval.
  server.requestTimeout = requestDeadlineMs + 1000;
  server.headersTimeout = requestDeadlineMs;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.requestedPort ?? 0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Owned proxy address unavailable');
  origin = `http://127.0.0.1:${address.port}`;
  if ([appOrigin, upstream].includes(origin) || address.port === session.manifest.port) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('Owned proxy port collision');
  }
  async function armFault(input: InternalFault, nativeLoad = false) {
    if (closing || restarting || arming || reading || fault || active)
      throw new Error('Proxy is not idle for fault setup');
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(input.attemptId) ||
      attempts.has(input.attemptId)
    )
      throw new Error('Invalid or duplicate proxy attempt');
    if (
      !(
        nativeLoad &&
        requestProfile === 'native' &&
        input.method === 'GET' &&
        /^\/plans\/training\/training_plan_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          input.path,
        )
      ) &&
      !(input.method === 'POST' && input.path === '/plans/training') &&
      !(
        input.method === 'PATCH' &&
        /^\/plans\/training\/training_plan_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          input.path,
        )
      )
    )
      throw new Error('Only an exact declared training-plan save can be faulted');
    if (!input.accountUid || !input.accessToken || /[\r\n]/.test(input.accessToken))
      throw new Error('Missing fault account identity');
    arming = true;
    faultSetup = new AbortController();
    attempts.add(input.attemptId);
    try {
      if ((await session.assertApiOwnership()) !== upstream || closing || restarting)
        throw new Error('Proxy upstream changed during fault setup');
      const result = await fetch(`${upstream}/me`, {
        headers: { authorization: `Bearer ${input.accessToken}` },
        signal: AbortSignal.any([faultSetup.signal, AbortSignal.timeout(requestDeadlineMs)]),
        redirect: 'error',
      });
      if (!result.ok) throw new Error('Fault account is not authenticated in the owned API');
      const body = (await result.json()) as { profile?: { authUid?: string } };
      if (body.profile?.authUid !== input.accountUid)
        throw new Error('Fault account identity mismatch');
      if (
        closing ||
        restarting ||
        upstream !== session.apiOrigin ||
        upstreamPid !== session.apiPid ||
        (await session.assertApiOwnership()) !== upstream
      )
        throw new Error('Proxy changed during fault setup');
      fault = { ...input, injectedCount: 0 };
    } finally {
      arming = false;
      faultSetup = undefined;
    }
  }
  function requireObservedNativeCredential() {
    if (requestProfile !== 'native')
      throw new Error('Observed native fault requires native request profile');
    const observed = observedNativeCredential;
    if (
      !observed ||
      closing ||
      restarting ||
      observed.origin !== upstream ||
      observed.pid !== upstreamPid ||
      upstream !== session.apiOrigin ||
      upstreamPid !== session.apiPid
    )
      throw new Error('Current successful native catalog observation required');
    return observed.token;
  }
  async function readObservedNativeTrainingPlan(input: {
    fixtureScope: 'native-entry-ios' | 'native-entry-android';
    accountUid: string;
    planId: string;
  }) {
    const token = requireObservedNativeCredential();
    if (closing || restarting || arming || reading || fault || active)
      throw new Error('Proxy is not idle for native plan verification');
    if (
      !['native-entry-ios', 'native-entry-android'].includes(input.fixtureScope) ||
      !session.manifest.fixtureScopes.includes(input.fixtureScope) ||
      !input.accountUid ||
      !/^training_plan_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        input.planId,
      )
    )
      throw new Error('Native plan read requires an exact seeded scope and plan identity');
    reading = true;
    const abort = new AbortController();
    readSetup = abort;
    const targetOrigin = upstream;
    const targetPid = upstreamPid;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(requestDeadlineMs)]);
    const requireCurrent = async () => {
      signal.throwIfAborted();
      if (
        closing ||
        restarting ||
        targetOrigin !== upstream ||
        targetPid !== upstreamPid ||
        targetOrigin !== session.apiOrigin ||
        targetPid !== session.apiPid ||
        requireObservedNativeCredential() !== token ||
        (await session.assertApiOwnership()) !== targetOrigin
      )
        throw new Error('Native plan read upstream identity changed');
      signal.throwIfAborted();
    };
    // Fixed routes only; these independent reads are not native UI transport observations.
    const read = async (route: string) => {
      await requireCurrent();
      const response = await fetch(`${targetOrigin}${route}`, {
        headers: { authorization: `Bearer ${token}` },
        signal,
        redirect: 'error',
      });
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Native plan read body missing');
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 1_048_576) throw new Error('Native plan read body exceeds limit');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new Error('Native plan read body is invalid JSON');
      }
      await requireCurrent();
      return { status: response.status, body };
    };
    try {
      await requireCurrent();
      const snapshot = await session.snapshot(input.fixtureScope);
      const plan = snapshot.trainingPlans.find((row) => row.id === input.planId);
      if (
        snapshot.runId !== session.manifest.runId ||
        snapshot.scope !== input.fixtureScope ||
        !snapshot.readOnly ||
        !plan ||
        (plan.ownerProfessionalUid !== input.accountUid && plan.studentAuthUid !== input.accountUid)
      )
        throw new Error('Native plan read requires account ownership in scoped SQL');
      const account = await read('/me');
      if (
        account.status !== 200 ||
        (account.body as { profile?: { authUid?: string } })?.profile?.authUid !== input.accountUid
      )
        throw new Error('Native plan read observed account identity mismatch');
      const result = await read(`/plans/training/${input.planId}`);
      const returned = (result.body as { plan?: { id?: string } })?.plan;
      if (result.status !== 200 || returned?.id !== input.planId)
        throw new Error('Native plan read did not return the exact authenticated plan');
      return {
        status: result.status,
        plan: returned,
        verification: {
          runId: session.manifest.runId,
          fixtureScope: input.fixtureScope,
          accountUid: input.accountUid,
          planId: input.planId,
          apiOrigin: targetOrigin,
          apiPid: targetPid,
          scope: 'independent owned authenticated API read; no native UI assertion',
        },
      };
    } finally {
      reading = false;
      readSetup = undefined;
    }
  }
  return {
    origin,
    runId: session.manifest.runId,
    /** Monotonic request-start fence; includes requests that are still in flight. */
    get requestIdFence() {
      return counter;
    },
    get observations() {
      return observations.map((row) => ({ ...row }));
    },
    get nativeAuthIdentities() {
      return nativeAuthIdentities.map((row) => ({ ...row }));
    },
    /** Wait for all in-flight upstream work to finish before a storage/transport window. */
    async waitForQuiescence(deadlineMs = 5000, signal?: AbortSignal) {
      if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 30_000)
        throw new Error('Invalid owned proxy quiescence deadline');
      const deadline = Date.now() + deadlineMs;
      signal?.throwIfAborted();
      while (active > 0 || outbound.size > 0 || nativeRequestBodyFinalizations.size > 0) {
        signal?.throwIfAborted();
        if (Date.now() >= deadline) throw new Error('Owned proxy did not reach quiescence');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      signal?.throwIfAborted();
      return { active, outbound: outbound.size } as const;
    },
    enableNativeRequestBodyCapture(input: NativeRequestBodyCaptureConfig) {
      if (requestProfile !== 'native')
        throw new Error('Native request body capture requires native request profile');
      if (nativeRequestBodyCaptureConfig || nativeRequestBodyCaptureSeen)
        throw new Error('Native request body capture may only be enabled once before submission');
      if (
        !input ||
        typeof input !== 'object' ||
        !path.isAbsolute(input.artifactRoot) ||
        !SHA256.test(input.actorAuthUidSha256) ||
        !SHA256.test(input.manualCodeSha256) ||
        !SHA256.test(input.actionSha256) ||
        !Number.isSafeInteger(input.apiPid) ||
        input.apiPid <= 1 ||
        input.targetOrigin !== upstream ||
        input.targetOrigin !== session.apiOrigin ||
        input.apiPid !== upstreamPid ||
        !/^[a-f0-9]{24}$/.test(input.captureRunId) ||
        (input.sessionRunId !== undefined && input.sessionRunId !== session.manifest.runId) ||
        input.backendAttemptId !== `${session.manifest.runId}:first`
      )
        throw new Error('Native request body capture binding is invalid');
      if (closing || restarting || arming || reading || fault || active)
        throw new Error('Native request body capture requires an idle proxy');
      nativeRequestBodyCaptureConfig = structuredClone(input);
    },
    get nativeRequestBodyCaptureFailure() {
      return nativeRequestBodyFailure;
    },
    get nativeRequestBodyCaptureSeen() {
      return nativeRequestBodyCaptureSeen;
    },
    get nativeRequestBodyCapture() {
      return nativeRequestBodyReceipt ? structuredClone(nativeRequestBodyReceipt) : null;
    },
    enableNativeAuthIdentityCapture(fixtureAuthUids: readonly string[]) {
      if (requestProfile !== 'native')
        throw new Error('Native auth identity capture requires native request profile');
      if (nativeAuthIdentityAllowlist)
        throw new Error('Native auth identity capture may only be enabled once');
      if (nativeAuthRequestSeen)
        throw new Error('Native auth identity capture must precede native authentication');
      if (
        !Array.isArray(fixtureAuthUids) ||
        fixtureAuthUids.length === 0 ||
        fixtureAuthUids.length > nativeAuthFixtureUidMaxCount ||
        fixtureAuthUids.some(
          (value) =>
            typeof value !== 'string' ||
            value.length === 0 ||
            value.length > nativeAuthFixtureUidMaxLength ||
            value.trim() !== value ||
            !/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(value),
        ) ||
        new Set(fixtureAuthUids).size !== fixtureAuthUids.length
      )
        throw new Error('Native auth identity fixture allowlist is invalid');
      if (closing || restarting || arming || reading || fault || active)
        throw new Error('Native auth identity capture requires an idle proxy');
      const allowlist = Array.from(fixtureAuthUids as readonly string[]).sort();
      nativeAuthIdentityAllowlist = new Set(allowlist);
      nativeAuthIdentityAllowlistHash = nativeAuthFixtureAllowlistHash(allowlist);
    },
    get faultState() {
      return fault ? { attemptId: fault.attemptId, injectedCount: fault.injectedCount } : null;
    },
    armFault(input: Fault) {
      return armFault(input);
    },
    readObservedNativeTrainingPlan,
    async armObservedNativeSaveFault(input: Omit<Fault, 'accessToken'>) {
      await armFault({
        ...input,
        accessToken: requireObservedNativeCredential(),
      });
    },
    async armObservedNativeLoadFault(input: {
      attemptId: string;
      path: string;
      accountUid: string;
      fixtureScope: string;
    }) {
      const accessToken = requireObservedNativeCredential();
      if (closing || restarting || arming || reading || fault || active)
        throw new Error('Proxy is not idle for fault setup');
      if (!session.manifest.fixtureScopes.includes(input.fixtureScope))
        throw new Error('Native load fault requires an existing owned fixture scope');
      const snapshot = await session.snapshot(input.fixtureScope);
      const plan = snapshot.trainingPlans.find((row) => input.path === `/plans/training/${row.id}`);
      if (
        !plan ||
        (plan.studentAuthUid !== input.accountUid && plan.ownerProfessionalUid !== input.accountUid)
      )
        throw new Error('Native load fault requires an exact owned scoped plan');
      await armFault(
        {
          attemptId: input.attemptId,
          path: input.path,
          accountUid: input.accountUid,
          method: 'GET',
          accessToken,
        },
        true,
      );
    },
    clearFault(attemptId: string) {
      if (!fault || fault.attemptId !== attemptId) throw new Error('Proxy fault identity mismatch');
      const summary = { attemptId, injectedCount: fault.injectedCount };
      fault = undefined;
      return summary;
    },
    async restartApi() {
      if (closing || restarting || arming || reading || fault || active)
        throw new Error('Proxy is not idle for API restart');
      restarting = true;
      observedNativeCredential = undefined;
      try {
        await session.restart();
        upstream = identity(session);
        upstreamPid = session.apiPid;
        if ([origin, appOrigin].includes(upstream))
          throw new Error('Restarted API origin collision');
        return { apiOrigin: upstream, apiPid: session.apiPid };
      } finally {
        restarting = false;
      }
    },
    stop() {
      if (stopPromise) return stopPromise;
      closing = true;
      observedNativeCredential = undefined;
      faultSetup?.abort();
      readSetup?.abort();
      fault = undefined;
      const activeDrain = waitForActiveRequests();
      for (const child of outbound) child.destroy();
      for (const response of responses) response.destroy();
      stopPromise = new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      }).then(async () => {
        await Promise.race([
          activeDrain,
          new Promise<never>((_, reject) => {
            const timeout = setTimeout(
              () => reject(new Error('Owned proxy requests did not drain during stop')),
              Math.min(requestDeadlineMs, 5_000),
            );
            activeDrain.finally(() => clearTimeout(timeout)).catch(() => {});
          }),
        ]);
      });
      return stopPromise;
    },
  };
}
