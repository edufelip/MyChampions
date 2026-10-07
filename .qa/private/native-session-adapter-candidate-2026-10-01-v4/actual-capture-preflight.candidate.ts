import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../../scripts/testing/native-pilot-contract';
import { readNativeEvidence } from '../../../scripts/testing/native-view-evidence';
import type {
  IosSessionAdapterCandidateInput,
  IosSessionCaptureCandidate,
} from './native-session-adapter.candidate';
import { validateIosSessionAdapterCandidate } from './native-session-adapter.candidate';
import type {
  NativeAuthIdentityObservation,
  ProxyObservation,
} from '../../../scripts/testing/owned-api-proxy';
import type {
  OwnedDomainSnapshot,
  OwnedManifest,
  OwnedFixtures,
} from '../../../scripts/testing/owned-session';

const root = path.resolve(__dirname, '../../..');
const legacyCaptureId = '50ddeb1f3d43a32fd441b065';
const defaultCaptureRoot = path.join(root, '.qa/artifacts/native-pilot', legacyCaptureId);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const requiredSessionFields = [
  'sessionAssertionSequence',
  'sessionUiObservationOrder',
  'sessionInitialAuth',
  'nativeAuthIdentityEvidence',
  'authMetadataBeforeRelaunch',
  'authMetadataAfterRelaunch',
  'authMetadataAfterCancel',
  'cancelSignoutCheckpoint',
  'authMetadataAfterSignout',
  'authMetadataAfterSignedoutRelaunch',
  'relaunchTransport',
  'relaunchTransportRange',
  'signedOutRelaunchTransport',
  'signedOutRelaunchTransportRange',
  'sessionSqlBefore',
  'sessionSqlAfterSignedoutRelaunch',
  'sessionSqlBeforeAfterUnchanged',
  'sessionViewEvidence',
  'sessionEvidencePublication',
] as const;

type JsonRecord = Record<string, unknown>;
type LoadedFile = {
  path: string;
  sha256: string;
  bytes: number;
  value: unknown;
};

type ActualSessionCaptureLoad = {
  kind: 'private-native-session-v4-actual-capture-loader';
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
    sessionSqlBefore: LoadedFile | null;
    sessionSqlAfterSignedoutRelaunch: LoadedFile | null;
  };
  input?: IosSessionAdapterCandidateInput;
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
    const message = error instanceof Error ? error.message : String(error);
    missing.push(`${label}: ${message}`);
    return null;
  }
}

function capturePath(capture: JsonRecord, field: string, missing: string[]): string | null {
  const value = capture[field];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    missing.push(`capture.${field}`);
    return null;
  }
  const relative = (value as JsonRecord).path;
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative)) {
    missing.push(`capture.${field}.path`);
    return null;
  }
  return relative;
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
 * Load an actual capture exclusively through owner/private evidence readers.
 * This does not fill absent fields and cannot qualify a runtime receipt.
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
  const files: ActualSessionCaptureLoad['files'] = {
    capture: captureFile,
    backendManifest: null,
    fixtures: null,
    transport: readJson(
      captureRoot,
      'transport-observations.private.json',
      'transport-observations.private.json',
      missing,
    ),
    nativeAuthIdentities: null,
    sessionSqlBefore: null,
    sessionSqlAfterSignedoutRelaunch: null,
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
      } else {
        missing.push('capture.backend.artifactRoot');
      }
    } else {
      missing.push('capture.backend');
    }

    for (const [field, label] of [
      ['nativeAuthIdentityEvidence', 'native-auth-identities.private.json'],
      ['sessionSqlBefore', 'session-sql-before.private.json'],
      ['sessionSqlAfterSignedoutRelaunch', 'session-sql-after-signed-out-relaunch.private.json'],
    ] as const) {
      const relative = capturePath(capture, field, missing);
      if (relative)
        files[field === 'nativeAuthIdentityEvidence' ? 'nativeAuthIdentities' : field] = readJson(
          captureRoot,
          relative,
          label,
          missing,
        );
    }
    const missingCaptureFields = requiredSessionFields.filter(
      (field) => !Object.hasOwn(capture, field),
    );
    missing.push(...missingCaptureFields.map((field) => `capture.${field}`));
  }

  const status: ActualSessionCaptureLoad['status'] =
    missing.length === 0 && selection ? 'loaded' : selection ? 'incomplete' : 'selection-blocked';
  if (
    status !== 'loaded' ||
    !capture ||
    !files.backendManifest ||
    !files.fixtures ||
    !files.transport ||
    !files.nativeAuthIdentities ||
    !files.sessionSqlBefore ||
    !files.sessionSqlAfterSignedoutRelaunch
  )
    return {
      kind: 'private-native-session-v4-actual-capture-loader',
      captureRoot,
      captureId: path.basename(captureRoot),
      status,
      selection,
      missing: [...new Set(missing)],
      files,
    };

  const manifest = record(
    files.backendManifest.value,
    'owned manifest.json',
  ) as unknown as OwnedManifest;
  const fixtures = record(files.fixtures.value, 'owned fixtures') as unknown as OwnedFixtures;
  const authReceipt = record(
    capture.nativeAuthIdentityEvidence,
    'capture.nativeAuthIdentityEvidence',
  );
  const apiProcess = manifest.processes.find((process) => process.role === 'api');
  const backend = record(capture.backend, 'capture.backend');
  if (backend.runId !== manifest.runId)
    missing.push('capture.backend.runId differs from manifest.runId');
  if (manifest.artifactRoot !== backendRoot)
    missing.push('manifest.artifactRoot differs from owned backend root');
  if (!manifest.fixtureScopes.includes('native-entry-ios'))
    missing.push('manifest.fixtureScopes lacks native-entry-ios');
  if (fixtures.runId !== manifest.runId || fixtures.scope !== 'native-entry-ios')
    missing.push('owned fixtures identity differs from manifest/native-entry-ios scope');
  if (!apiProcess) missing.push('owned manifest API process');
  if (
    typeof authReceipt.apiPid !== 'number' ||
    typeof authReceipt.targetOrigin !== 'string' ||
    apiProcess?.pid !== authReceipt.apiPid
  )
    missing.push('capture.nativeAuthIdentityEvidence.apiPid/targetOrigin');
  if (missing.length > 0)
    return {
      kind: 'private-native-session-v4-actual-capture-loader',
      captureRoot,
      captureId: path.basename(captureRoot),
      status: 'incomplete',
      selection,
      missing: [...new Set(missing)],
      files,
    };

  const transport = files.transport.value as ProxyObservation[];
  const nativeAuthIdentities = files.nativeAuthIdentities.value as NativeAuthIdentityObservation[];
  if (
    !Array.isArray(transport) ||
    transport.some(
      (row) =>
        !row ||
        typeof row !== 'object' ||
        (row as ProxyObservation).targetOrigin !== authReceipt.targetOrigin,
    )
  )
    missing.push('transport rows are not bound to the auth receipt target origin');
  if (!Array.isArray(nativeAuthIdentities)) missing.push('native auth identities are not an array');
  if (missing.length > 0)
    return {
      kind: 'private-native-session-v4-actual-capture-loader',
      captureRoot,
      captureId: path.basename(captureRoot),
      status: 'incomplete',
      selection,
      missing: [...new Set(missing)],
      files,
    };
  const input: IosSessionAdapterCandidateInput = {
    selection: selection!,
    capture: capture as unknown as IosSessionCaptureCandidate,
    evidenceRoot: captureRoot,
    fixtureAuthUids: Object.values(fixtures.accounts).map((account) => account.authUid),
    ownedSessionManifest: {
      runId: manifest.runId,
      artifactRoot: manifest.artifactRoot,
      fixtureScopes: manifest.fixtureScopes,
      coachAuthUid: fixtures.accounts.coach.authUid,
      apiPid: authReceipt.apiPid as number,
      apiOrigin: authReceipt.targetOrigin as string,
    },
    transportObservations: transport,
    nativeAuthIdentities,
    sessionSqlBefore: files.sessionSqlBefore.value as OwnedDomainSnapshot,
    sessionSqlAfterSignedoutRelaunch: files.sessionSqlAfterSignedoutRelaunch
      .value as OwnedDomainSnapshot,
  };
  return {
    kind: 'private-native-session-v4-actual-capture-loader',
    captureRoot,
    captureId: path.basename(captureRoot),
    status: 'loaded',
    selection,
    missing: [...new Set(missing)],
    files,
    input,
  };
}

function parseCaptureRoot(argv: readonly string[]): string {
  if (argv.length === 0) return defaultCaptureRoot;
  if (argv.length === 2 && argv[0] === '--capture-root' && argv[1]) return path.resolve(argv[1]);
  throw new Error('Usage: actual-capture-preflight.candidate.ts [--capture-root <private-root>]');
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
    // This is a read-only migration preflight. Preserve the legacy diagnostic and
    // report why it cannot be treated as the new explicit session charter.
    assert.equal(capture?.result, 'observed');
    assert.equal(capture?.cleanup, 'cleaned');
    assert.equal(capture?.nativePassingCases, 0);
    assert.equal(capture?.charter, 'auth-account');
  }

  let validation: { status: string; error?: string; nativePassingCases?: number } = {
    status: 'not-attempted',
  };
  if (loaded.input) {
    try {
      const result = validateIosSessionAdapterCandidate(loaded.input);
      validation = {
        status: 'candidate-contract-validated',
        nativePassingCases: result.nativePassingCases,
      };
    } catch (error) {
      validation = {
        status: 'candidate-contract-rejected',
        error: error instanceof Error ? error.message : String(error),
        nativePassingCases: 0,
      };
    }
  }

  console.log(
    JSON.stringify(
      {
        kind: 'private-native-session-v4-preflight-not-behavior-pass',
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
        loadedFiles: Object.fromEntries(
          Object.entries(loaded.files)
            .filter(([, file]) => file)
            .map(([label, file]) => [
              label,
              { path: file!.path, sha256: file!.sha256, bytes: file!.bytes },
            ]),
        ),
        missing: loaded.missing,
        validation,
        legacyEvidencePreserved: path.basename(loaded.captureRoot) === legacyCaptureId,
        note: 'The actual session adapter loader reads owner-checked bytes only; absent session fields remain incomplete and are never relabeled as a pass.',
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
