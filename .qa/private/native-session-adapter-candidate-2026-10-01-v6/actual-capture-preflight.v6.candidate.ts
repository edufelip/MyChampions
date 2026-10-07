import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../../scripts/testing/native-pilot-contract';
import {
  nativeSessionProfileCheckpointIds,
  verifyNativeSessionProfileCheckpoints,
  type NativeSessionProfileCheckpointInput,
} from '../../../scripts/testing/native-session-profile-checkpoints';
import { readNativeEvidence } from '../../../scripts/testing/native-view-evidence';
import type {
  NativeAuthIdentityObservation,
  ProxyObservation,
} from '../../../scripts/testing/owned-api-proxy';
import type { OwnedConnectionSnapshot } from '../../../scripts/testing/native-connection-snapshot';
import type {
  OwnedDomainSnapshot,
  OwnedFixtures,
  OwnedManifest,
} from '../../../scripts/testing/owned-session';

const root = path.resolve(__dirname, '../../..');
const legacyCaptureId = '50ddeb1f3d43a32fd441b065';
const defaultCaptureRoot = path.join(root, '.qa/artifacts/native-pilot', legacyCaptureId);
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
type Checkpoint = (typeof nativeSessionProfileCheckpointIds)[number];
type JsonRecord = Record<string, unknown>;
type LoadedFile = { path: string; sha256: string; bytes: number; value: unknown };
type Receipt = {
  path?: unknown;
  runId?: unknown;
  scope?: unknown;
  sha256?: unknown;
  bytes?: unknown;
  ownedRunId?: unknown;
  fixtureScope?: unknown;
  artifactRoot?: unknown;
  apiPid?: unknown;
  targetOrigin?: unknown;
  fixtureAuthUidAllowlistHash?: unknown;
};

type ActualSessionCaptureLoad = {
  kind: 'private-native-session-v6-actual-capture-loader';
  captureRoot: string;
  captureId: string;
  status: 'incomplete' | 'loaded' | 'selection-blocked';
  selection: NativePilotSelection | null;
  missing: string[];
  files: {
    capture: LoadedFile | null;
    backendManifest: LoadedFile | null;
    fixtures: LoadedFile | null;
    transport: LoadedFile | null;
    nativeAuthIdentities: LoadedFile | null;
    profiles: Record<Checkpoint, LoadedFile | null>;
    domain: Record<Checkpoint, LoadedFile | null>;
  };
  verification?: ReturnType<typeof verifyNativeSessionProfileCheckpoints>;
  input?: NativeSessionProfileCheckpointInput;
};

function record(value: unknown, label: string): JsonRecord {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as JsonRecord;
}

async function privateRoot(value: string, label: string): Promise<string> {
  const canonical = await realpath(value);
  const info = await lstat(canonical);
  assert.equal(canonical, path.resolve(value), `${label} is not canonical`);
  assert(info.isDirectory(), `${label} is not a directory`);
  assert.equal(info.uid, process.getuid?.(), `${label} is not owned`);
  assert.equal(info.mode & 0o777, 0o700, `${label} is not private`);
  return canonical;
}

function readJson(
  rootPath: string,
  relative: string,
  label: string,
  missing: string[],
): LoadedFile | null {
  try {
    const bytes = readNativeEvidence(rootPath, relative, true);
    return {
      path: relative,
      sha256: sha256(bytes),
      bytes: bytes.length,
      value: JSON.parse(bytes.toString()),
    };
  } catch (error) {
    missing.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function receipt(value: unknown, label: string, missing: string[]): Receipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    missing.push(`${label} receipt`);
    return null;
  }
  return value as Receipt;
}

function receiptPath(value: unknown, label: string, missing: string[]): string | null {
  const row = receipt(value, label, missing);
  const relative = row?.path;
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    missing.push(`${label}.path`);
    return null;
  }
  return relative;
}

function readDeclaredFile(
  rootPath: string,
  declaration: unknown,
  label: string,
  missing: string[],
): { file: LoadedFile | null; receipt: Receipt | null } {
  const row = receipt(declaration, label, missing);
  const relative = receiptPath(declaration, label, missing);
  return {
    file: relative ? readJson(rootPath, relative, label, missing) : null,
    receipt: row,
  };
}

function checkReceipt(
  declaration: Receipt | null,
  file: LoadedFile | null,
  label: string,
  expected: {
    runId: string;
    artifactRoot: string;
    apiPid: number;
    targetOrigin: string;
    fixtureAuthUidAllowlistHash: string;
  },
  missing: string[],
) {
  if (!declaration || !file) return;
  const checks: [keyof Receipt, unknown][] = [
    ['path', file.path],
    ['sha256', file.sha256],
    ['bytes', file.bytes],
    ['runId', expected.runId],
    ['ownedRunId', expected.runId],
    ['scope', 'native-entry-ios'],
    ['fixtureScope', 'native-entry-ios'],
    ['artifactRoot', expected.artifactRoot],
    ['apiPid', expected.apiPid],
    ['targetOrigin', expected.targetOrigin],
    ['fixtureAuthUidAllowlistHash', expected.fixtureAuthUidAllowlistHash],
  ];
  for (const [field, actual] of checks)
    if (declaration[field] !== actual)
      missing.push(`${label}.${String(field)} is not bound to owned bytes`);
}

function declaredCheckpointFiles(
  capture: JsonRecord,
  field: 'sessionProfileSnapshots' | 'sessionDomainSnapshots',
  rootPath: string,
  missing: string[],
): { files: Record<Checkpoint, LoadedFile | null>; receipts: Record<Checkpoint, Receipt | null> } {
  const files = {} as Record<Checkpoint, LoadedFile | null>;
  const receipts = {} as Record<Checkpoint, Receipt | null>;
  const container = capture[field];
  if (!container || typeof container !== 'object' || Array.isArray(container)) {
    missing.push(`capture.${field}`);
    for (const checkpoint of nativeSessionProfileCheckpointIds) {
      files[checkpoint] = null;
      receipts[checkpoint] = null;
    }
    return { files, receipts };
  }
  const rows = container as JsonRecord;
  const seen = new Set<string>();
  for (const checkpoint of nativeSessionProfileCheckpointIds) {
    const label = `capture.${field}.${checkpoint}`;
    const declaration = rows[checkpoint];
    const relative = receiptPath(declaration, label, missing);
    if (relative && seen.has(relative))
      missing.push(`${label}.path is reused by another checkpoint`);
    if (relative) seen.add(relative);
    const loaded = relative ? readJson(rootPath, relative, label, missing) : null;
    files[checkpoint] = loaded;
    receipts[checkpoint] = receipt(declaration, label, missing);
  }
  return { files, receipts };
}

function windowValue(value: unknown, label: string, missing: string[]) {
  const row = record(value, label);
  const afterRequestId = row.afterRequestId;
  const throughRequestId = row.throughRequestId;
  if (
    !Number.isSafeInteger(afterRequestId) ||
    !Number.isSafeInteger(throughRequestId) ||
    (afterRequestId as number) < 0 ||
    (throughRequestId as number) <= (afterRequestId as number)
  )
    missing.push(`${label} is not a bounded request-id window`);
  return { afterRequestId: afterRequestId as number, throughRequestId: throughRequestId as number };
}

async function selectCurrentSession(repositoryRoot: string): Promise<NativePilotSelection> {
  const inventory = JSON.parse(
    await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  );
  return selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-session-ios', mode: 'integration' },
    inventory,
    repositoryRoot,
  );
}

/**
 * Loads a complete iOS session capture from owner-checked private bytes. The
 * checkpoint verifier only runs after all receipt/hash/path/API bindings and
 * every aggregate snapshot has been re-read from disk.
 */
export async function loadActualIosSessionAdapterInput(options: {
  repositoryRoot?: string;
  captureRoot: string;
}): Promise<ActualSessionCaptureLoad> {
  const repositoryRoot = await realpath(options.repositoryRoot ?? root);
  const captureRoot = await privateRoot(options.captureRoot, 'Actual capture root');
  const missing: string[] = [];
  const captureFile = readJson(
    captureRoot,
    'capture.private.json',
    'capture.private.json',
    missing,
  );
  const capture = captureFile ? record(captureFile.value, 'capture.private.json') : null;
  const profiles = {} as Record<Checkpoint, LoadedFile | null>;
  const domain = {} as Record<Checkpoint, LoadedFile | null>;
  for (const checkpoint of nativeSessionProfileCheckpointIds) {
    profiles[checkpoint] = null;
    domain[checkpoint] = null;
  }
  const files: ActualSessionCaptureLoad['files'] = {
    capture: captureFile,
    backendManifest: null,
    fixtures: null,
    transport: null,
    nativeAuthIdentities: null,
    profiles,
    domain,
  };
  let selection: NativePilotSelection | null = null;
  try {
    selection = await selectCurrentSession(repositoryRoot);
  } catch (error) {
    missing.push(
      `current SCN-session-ios selection: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let backendRoot: string | null = null;
  let profileReceipts: Record<Checkpoint, Receipt | null> | null = null;
  let domainReceipts: Record<Checkpoint, Receipt | null> | null = null;
  if (capture) {
    const backend = capture.backend;
    if (backend && typeof backend === 'object' && !Array.isArray(backend)) {
      const artifactRoot = (backend as JsonRecord).artifactRoot;
      if (typeof artifactRoot === 'string' && path.isAbsolute(artifactRoot)) {
        try {
          backendRoot = await privateRoot(artifactRoot, 'Owned backend artifact root');
          files.backendManifest = readJson(
            backendRoot,
            'manifest.json',
            'owned manifest.json',
            missing,
          );
          files.fixtures = readJson(
            backendRoot,
            'fixtures-native-entry-ios.private.json',
            'owned fixtures-native-entry-ios.private.json',
            missing,
          );
        } catch (error) {
          missing.push(
            `owned backend artifact root: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      } else missing.push('capture.backend.artifactRoot');
    } else missing.push('capture.backend');

    const transportDeclaration = capture.transportEvidence;
    const transportPath = receiptPath(transportDeclaration, 'capture.transportEvidence', missing);
    files.transport = transportPath
      ? readJson(captureRoot, transportPath, 'transport observations', missing)
      : null;
    const nativeAuthPath = receiptPath(
      capture.nativeAuthIdentityEvidence,
      'capture.nativeAuthIdentityEvidence',
      missing,
    );
    files.nativeAuthIdentities = nativeAuthPath
      ? readJson(captureRoot, nativeAuthPath, 'native auth identities', missing)
      : null;
    const profile = declaredCheckpointFiles(
      capture,
      'sessionProfileSnapshots',
      captureRoot,
      missing,
    );
    const domainSnapshots = declaredCheckpointFiles(
      capture,
      'sessionDomainSnapshots',
      captureRoot,
      missing,
    );
    Object.assign(files.profiles, profile.files);
    Object.assign(files.domain, domainSnapshots.files);
    profileReceipts = profile.receipts;
    domainReceipts = domainSnapshots.receipts;
    for (const field of [
      'sessionProfileLoginWindow',
      'sessionProfileRestorationWindow',
      'persistedCoachIdentity',
      'sessionProfileCheckpointVerification',
    ])
      if (!Object.hasOwn(capture, field)) missing.push(`capture.${field}`);
  }
  const base = {
    kind: 'private-native-session-v6-actual-capture-loader' as const,
    captureRoot,
    captureId: path.basename(captureRoot),
    selection,
    missing: [...new Set(missing)],
    files,
  };
  if (
    missing.length ||
    !capture ||
    !files.backendManifest ||
    !files.fixtures ||
    !files.transport ||
    !files.nativeAuthIdentities ||
    !profileReceipts ||
    !domainReceipts ||
    Object.values(files.profiles).some((file) => !file) ||
    Object.values(files.domain).some((file) => !file) ||
    !selection
  )
    return { ...base, status: selection ? 'incomplete' : 'selection-blocked' };

  const manifest = record(
    files.backendManifest.value,
    'owned manifest.json',
  ) as unknown as OwnedManifest;
  const fixtures = record(files.fixtures.value, 'owned fixtures') as unknown as OwnedFixtures;
  const backend = record(capture.backend, 'capture.backend');
  const authDeclaration = receipt(
    capture.nativeAuthIdentityEvidence,
    'capture.nativeAuthIdentityEvidence',
    missing,
  );
  const transportDeclaration = receipt(
    capture.transportEvidence,
    'capture.transportEvidence',
    missing,
  );
  const apiProcess = manifest.processes.find((process) => process.role === 'api');
  const fixtureAuthUids = Object.values(fixtures.accounts)
    .map((account) => account.authUid)
    .sort();
  const fixtureAuthUidAllowlistHash = sha256(JSON.stringify(fixtureAuthUids));
  if (backend.runId !== manifest.runId)
    missing.push('capture.backend.runId differs from manifest.runId');
  if (manifest.artifactRoot !== backendRoot)
    missing.push('manifest.artifactRoot differs from owned backend root');
  if (!manifest.fixtureScopes.includes('native-entry-ios'))
    missing.push('manifest.fixtureScopes lacks native-entry-ios');
  if (fixtures.runId !== manifest.runId || fixtures.scope !== 'native-entry-ios')
    missing.push('owned fixtures identity differs from manifest/native-entry-ios scope');
  if (!apiProcess) missing.push('owned manifest API process');
  const apiPid = authDeclaration?.apiPid;
  const targetOrigin = authDeclaration?.targetOrigin;
  if (
    typeof apiPid !== 'number' ||
    typeof targetOrigin !== 'string' ||
    apiProcess?.pid !== apiPid ||
    apiProcess?.pid !== transportDeclaration?.apiPid ||
    targetOrigin !== transportDeclaration?.targetOrigin
  )
    missing.push('API PID/origin declarations do not agree with owned manifest and transport');
  if (
    typeof capture.fixtureHash !== 'string' ||
    capture.fixtureHash !== sha256(JSON.stringify(fixtures))
  )
    missing.push('capture.fixtureHash differs from owned fixtures');
  checkReceipt(
    authDeclaration,
    files.nativeAuthIdentities,
    'capture.nativeAuthIdentityEvidence',
    {
      runId: manifest.runId,
      artifactRoot: manifest.artifactRoot,
      apiPid: apiPid as number,
      targetOrigin: targetOrigin as string,
      fixtureAuthUidAllowlistHash,
    },
    missing,
  );
  checkReceipt(
    transportDeclaration,
    files.transport,
    'capture.transportEvidence',
    {
      runId: manifest.runId,
      artifactRoot: manifest.artifactRoot,
      apiPid: apiPid as number,
      targetOrigin: targetOrigin as string,
      fixtureAuthUidAllowlistHash,
    },
    missing,
  );
  for (const checkpoint of nativeSessionProfileCheckpointIds) {
    checkReceipt(
      profileReceipts[checkpoint],
      files.profiles[checkpoint],
      `capture.sessionProfileSnapshots.${checkpoint}`,
      {
        runId: manifest.runId,
        artifactRoot: manifest.artifactRoot,
        apiPid: apiPid as number,
        targetOrigin: targetOrigin as string,
        fixtureAuthUidAllowlistHash,
      },
      missing,
    );
    checkReceipt(
      domainReceipts[checkpoint],
      files.domain[checkpoint],
      `capture.sessionDomainSnapshots.${checkpoint}`,
      {
        runId: manifest.runId,
        artifactRoot: manifest.artifactRoot,
        apiPid: apiPid as number,
        targetOrigin: targetOrigin as string,
        fixtureAuthUidAllowlistHash,
      },
      missing,
    );
  }
  const transport = files.transport.value;
  const nativeAuthIdentities = files.nativeAuthIdentities.value;
  if (!Array.isArray(transport)) missing.push('transport observations are not an array');
  if (!Array.isArray(nativeAuthIdentities)) missing.push('native auth identities are not an array');
  if (
    Array.isArray(transport) &&
    transport.some(
      (row) =>
        !row ||
        typeof row !== 'object' ||
        (row as ProxyObservation).targetOrigin !== targetOrigin ||
        (row as ProxyObservation).requestProfile !== 'native' ||
        (row as ProxyObservation).requestOrigin !== null ||
        (row as ProxyObservation).outcome !== 'forwarded' ||
        (row as ProxyObservation).faultAttemptId !== null,
    )
  )
    missing.push('transport rows are not owned native forwarded observations');
  if (Array.isArray(nativeAuthIdentities)) {
    for (const identity of nativeAuthIdentities as NativeAuthIdentityObservation[])
      if (
        identity.targetOrigin !== targetOrigin ||
        identity.apiPid !== apiPid ||
        identity.fixtureAuthUidAllowlistHash !== fixtureAuthUidAllowlistHash ||
        !fixtureAuthUids.includes(identity.authUid ?? '')
      )
        missing.push('native auth identity is not bound to the owned API/fixture allowlist');
  }
  if (missing.length) return { ...base, status: 'incomplete', missing: [...new Set(missing)] };

  const windows = {
    login: windowValue(
      capture.sessionProfileLoginWindow,
      'capture.sessionProfileLoginWindow',
      missing,
    ),
    restoration: windowValue(
      capture.sessionProfileRestorationWindow,
      'capture.sessionProfileRestorationWindow',
      missing,
    ),
  };
  const persisted = record(capture.persistedCoachIdentity, 'capture.persistedCoachIdentity');
  const afterLoginAuthUidHash = persisted.afterLoginAuthUidHash;
  const afterRestorationAuthUidHash = persisted.afterRestorationAuthUidHash;
  if (
    typeof afterLoginAuthUidHash !== 'string' ||
    typeof afterRestorationAuthUidHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(afterLoginAuthUidHash) ||
    !/^[a-f0-9]{64}$/.test(afterRestorationAuthUidHash)
  )
    missing.push('capture.persistedCoachIdentity contains invalid redacted hashes');
  const input: NativeSessionProfileCheckpointInput = {
    platform: 'ios',
    backendRunId: manifest.runId,
    fixtureAuthUids,
    coachAuthUid: fixtures.accounts.coach.authUid,
    studentAuthUid: fixtures.accounts.student.authUid,
    expectedApiIdentity: { apiPid: apiPid as number, targetOrigin: targetOrigin as string },
    profiles: {
      beforeLogin: files.profiles.beforeLogin!.value as OwnedConnectionSnapshot,
      afterLogin: files.profiles.afterLogin!.value as OwnedConnectionSnapshot,
      afterRestoration: files.profiles.afterRestoration!.value as OwnedConnectionSnapshot,
      afterSignedOutRelaunch: files.profiles.afterSignedOutRelaunch!
        .value as OwnedConnectionSnapshot,
    },
    domain: {
      beforeLogin: files.domain.beforeLogin!.value as OwnedDomainSnapshot,
      afterLogin: files.domain.afterLogin!.value as OwnedDomainSnapshot,
      afterRestoration: files.domain.afterRestoration!.value as OwnedDomainSnapshot,
      afterSignedOutRelaunch: files.domain.afterSignedOutRelaunch!.value as OwnedDomainSnapshot,
    },
    observations: transport as ProxyObservation[],
    authIdentities: nativeAuthIdentities as NativeAuthIdentityObservation[],
    loginWindow: windows.login,
    restorationWindow: windows.restoration,
    persistedCoachIdentity: {
      afterLoginAuthUidHash: afterLoginAuthUidHash as string,
      afterRestorationAuthUidHash: afterRestorationAuthUidHash as string,
    },
  };
  if (missing.length) return { ...base, status: 'incomplete', missing: [...new Set(missing)] };
  let verification: ReturnType<typeof verifyNativeSessionProfileCheckpoints>;
  try {
    verification = verifyNativeSessionProfileCheckpoints(input);
  } catch (error) {
    missing.push(
      `shared session profile checkpoint verifier: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { ...base, status: 'incomplete', missing: [...new Set(missing)] };
  }
  const declared = record(
    capture.sessionProfileCheckpointVerification,
    'capture.sessionProfileCheckpointVerification',
  );
  if (
    declared.kind !== verification.kind ||
    declared.status !== verification.status ||
    JSON.stringify(declared.checkpointIds) !== JSON.stringify(verification.checkpointIds) ||
    declared.signInRequestId !== verification.signInRequestId ||
    declared.restorationHydrateRequestId !== verification.restorationHydrateRequestId ||
    declared.coachAuthUidHash !== verification.coachAuthUidHash ||
    declared.nativePassingCases !== 0
  )
    missing.push(
      'capture.sessionProfileCheckpointVerification differs from re-read verifier result',
    );
  if (missing.length) return { ...base, status: 'incomplete', missing: [...new Set(missing)] };
  return {
    ...base,
    status: 'loaded',
    missing: [],
    verification,
    input,
  };
}

function parseCaptureRoot(argv: readonly string[]): string {
  if (argv.length === 0) return defaultCaptureRoot;
  if (argv.length === 2 && argv[0] === '--capture-root' && argv[1]) return path.resolve(argv[1]);
  throw new Error(
    'Usage: actual-capture-preflight.v6.candidate.ts [--capture-root <private-root>]',
  );
}

async function main() {
  const captureRoot = parseCaptureRoot(process.argv.slice(2));
  const loaded = await loadActualIosSessionAdapterInput({ captureRoot });
  const capture = loaded.files.capture?.value as JsonRecord | undefined;
  const original = capture
    ? {
        charter: capture.charter,
        result: capture.result,
        cleanup: capture.cleanup,
        nativePassingCases: capture.nativePassingCases,
      }
    : null;
  if (path.basename(loaded.captureRoot) === legacyCaptureId) {
    assert.equal(capture?.result, 'observed');
    assert.equal(capture?.cleanup, 'cleaned');
    assert.equal(capture?.nativePassingCases, 0);
    assert.equal(capture?.charter, 'auth-account');
  }
  const fileSummary = (file: LoadedFile | null) =>
    file ? { path: file.path, sha256: file.sha256, bytes: file.bytes } : null;
  console.log(
    JSON.stringify(
      {
        kind: 'private-native-session-v6-preflight-not-behavior-pass',
        captureId: loaded.captureId,
        capturePath: loaded.captureRoot,
        status: loaded.status,
        original,
        selection: loaded.selection
          ? {
              arguments: loaded.selection.arguments,
              scenarioHash: loaded.selection.scenarioHash,
              requirementHash: loaded.selection.requirementHash,
            }
          : null,
        loadedFiles: {
          capture: fileSummary(loaded.files.capture),
          backendManifest: fileSummary(loaded.files.backendManifest),
          fixtures: fileSummary(loaded.files.fixtures),
          transport: fileSummary(loaded.files.transport),
          nativeAuthIdentities: fileSummary(loaded.files.nativeAuthIdentities),
          profiles: Object.fromEntries(
            Object.entries(loaded.files.profiles).map(([key, file]) => [
              key,
              file ? { path: file.path, sha256: file.sha256, bytes: file.bytes } : null,
            ]),
          ),
          domain: Object.fromEntries(
            Object.entries(loaded.files.domain).map(([key, file]) => [
              key,
              file ? { path: file.path, sha256: file.sha256, bytes: file.bytes } : null,
            ]),
          ),
        },
        missing: loaded.missing,
        verification: loaded.verification ?? null,
        legacyEvidencePreserved: path.basename(loaded.captureRoot) === legacyCaptureId,
        note: 'The v6 loader re-reads owner-checked checkpoint, transport, auth-identity and backend bytes before invoking the shared verifier; missing or tampered evidence remains incomplete.',
      },
      null,
      2,
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename))
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  });
