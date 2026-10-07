import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../../scripts/testing/native-pilot-contract';
import { readNativeEvidence } from '../../../scripts/testing/native-view-evidence';
import type { OwnedConnectionSnapshot } from '../../../scripts/testing/native-connection-snapshot';
import type {
  SessionProfileSnapshotEvidence,
  SessionProfileSnapshotLabel,
  SessionProfileSnapshotReceipt,
} from './session-profile-snapshot-supplement.candidate';

const root = path.resolve(__dirname, '../../..');
const defaultCaptureRoot = path.join(root, '.qa/artifacts/native-pilot/50ddeb1f3d43a32fd441b065');
const snapshotFieldByLabel: Record<SessionProfileSnapshotLabel, string> = {
  'before-login': 'sessionSqlBeforeLogin',
  'after-initial-login': 'sessionSqlAfterInitialLogin',
  'after-restore': 'sessionSqlAfterRestore',
  'after-signed-out-relaunch': 'sessionSqlAfterSignedoutRelaunch',
};

type JsonRecord = Record<string, unknown>;
type LoadedFile = { path: string; sha256: string; bytes: number; value: unknown };

export type ProfileSnapshotPreflightResult = {
  kind: 'private-ios-session-profile-snapshot-preflight-not-behavior-pass';
  captureRoot: string;
  captureId: string;
  status: 'incomplete' | 'loaded' | 'selection-blocked';
  selection: NativePilotSelection | null;
  missing: string[];
  files: {
    capture: LoadedFile | null;
    beforeLogin: LoadedFile | null;
    afterInitialLogin: LoadedFile | null;
    afterRestore: LoadedFile | null;
    afterSignedOutRelaunch: LoadedFile | null;
  };
  profileEvidence?: Record<SessionProfileSnapshotLabel, SessionProfileSnapshotEvidence>;
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

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

function declaredPath(capture: JsonRecord, field: string, missing: string[]): string | null {
  const declaration = capture[field];
  if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
    missing.push(`capture.${field}`);
    return null;
  }
  const relative = (declaration as JsonRecord).path;
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
 * Read only the four supplemental profile snapshot files. The main v4 loader
 * remains the owner of auth/API/transport/session fields; this loader refuses
 * to fill those fields and returns incomplete until all four declared bytes
 * exist with receipt metadata in capture.private.json.
 */
export async function loadActualSessionProfileSnapshotEvidence(options: {
  repositoryRoot?: string;
  captureRoot: string;
}): Promise<ProfileSnapshotPreflightResult> {
  const repositoryRoot = await realpath(options.repositoryRoot ?? root);
  const captureRoot = await privateRoot(options.captureRoot, 'Actual profile capture root');
  const missing: string[] = [];
  const files: ProfileSnapshotPreflightResult['files'] = {
    capture: readJson(captureRoot, 'capture.private.json', 'capture.private.json', missing),
    beforeLogin: null,
    afterInitialLogin: null,
    afterRestore: null,
    afterSignedOutRelaunch: null,
  };
  const capture = files.capture ? record(files.capture.value, 'capture.private.json') : null;
  let selection: NativePilotSelection | null = null;
  try {
    selection = await selectCurrentSession(repositoryRoot);
  } catch (error) {
    missing.push(
      `current SCN-session-ios selection: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (capture) {
    for (const [label, field] of Object.entries(snapshotFieldByLabel) as [
      SessionProfileSnapshotLabel,
      string,
    ][]) {
      const relative = declaredPath(capture, field, missing);
      if (!relative) continue;
      const key =
        label === 'before-login'
          ? 'beforeLogin'
          : label === 'after-initial-login'
            ? 'afterInitialLogin'
            : label === 'after-restore'
              ? 'afterRestore'
              : 'afterSignedOutRelaunch';
      files[key] = readJson(captureRoot, relative, `capture.${field}`, missing);
      const declaration = capture[field];
      if (
        files[key] &&
        declaration &&
        typeof declaration === 'object' &&
        !Array.isArray(declaration)
      ) {
        const receipt = declaration as JsonRecord;
        const actual = files[key]!;
        if (receipt.path !== actual.path) missing.push(`capture.${field}.path differs from file`);
        if (receipt.sha256 !== actual.sha256)
          missing.push(`capture.${field}.sha256 differs from file`);
        if (receipt.bytes !== actual.bytes)
          missing.push(`capture.${field}.bytes differs from file`);
        for (const metadata of [
          'runId',
          'scope',
          'ownedRunId',
          'apiPid',
          'targetOrigin',
          'fixtureAuthUidAllowlistHash',
        ])
          if (receipt[metadata] === undefined || receipt[metadata] === null)
            missing.push(`capture.${field}.${metadata}`);
      }
    }
  }
  const status: ProfileSnapshotPreflightResult['status'] =
    missing.length === 0 && selection ? 'loaded' : selection ? 'incomplete' : 'selection-blocked';
  if (
    status !== 'loaded' ||
    !capture ||
    !files.beforeLogin ||
    !files.afterInitialLogin ||
    !files.afterRestore ||
    !files.afterSignedOutRelaunch
  )
    return {
      kind: 'private-ios-session-profile-snapshot-preflight-not-behavior-pass',
      captureRoot,
      captureId: path.basename(captureRoot),
      status,
      selection,
      missing: [...new Set(missing)],
      files,
    };

  const profileEvidence = {} as Record<SessionProfileSnapshotLabel, SessionProfileSnapshotEvidence>;
  for (const [label, file] of [
    ['before-login', files.beforeLogin],
    ['after-initial-login', files.afterInitialLogin],
    ['after-restore', files.afterRestore],
    ['after-signed-out-relaunch', files.afterSignedOutRelaunch],
  ] as const) {
    const declaration = record(
      capture[snapshotFieldByLabel[label]],
      `capture.${snapshotFieldByLabel[label]}`,
    );
    const snapshot = file.value as OwnedConnectionSnapshot;
    const receipt = declaration as unknown as SessionProfileSnapshotReceipt;
    profileEvidence[label] = {
      label,
      snapshot,
      bytes: readNativeEvidence(captureRoot, file.path, true),
      receipt: {
        path: receipt.path,
        sha256: receipt.sha256,
        bytes: receipt.bytes,
        runId: receipt.runId,
        scope: receipt.scope,
        ownedRunId: receipt.ownedRunId,
        apiPid: receipt.apiPid,
        targetOrigin: receipt.targetOrigin,
        fixtureAuthUidAllowlistHash: receipt.fixtureAuthUidAllowlistHash,
      },
    };
  }
  return {
    kind: 'private-ios-session-profile-snapshot-preflight-not-behavior-pass',
    captureRoot,
    captureId: path.basename(captureRoot),
    status: 'loaded',
    selection,
    missing: [...new Set(missing)],
    files,
    profileEvidence,
  };
}

function parseCaptureRoot(argv: readonly string[]): string {
  if (argv.length === 0) return defaultCaptureRoot;
  if (argv.length === 2 && argv[0] === '--capture-root' && argv[1]) return path.resolve(argv[1]);
  throw new Error('Usage: profile-snapshot-preflight.candidate.ts [--capture-root <private-root>]');
}

async function main() {
  const loaded = await loadActualSessionProfileSnapshotEvidence({
    captureRoot: parseCaptureRoot(process.argv.slice(2)),
  });
  const capture = loaded.files.capture?.value as JsonRecord | undefined;
  console.log(
    JSON.stringify(
      {
        kind: loaded.kind,
        captureRoot: loaded.captureRoot,
        captureId: loaded.captureId,
        status: loaded.status,
        original: capture
          ? {
              charter: capture.charter,
              result: capture.result,
              cleanup: capture.cleanup,
              nativePassingCases: capture.nativePassingCases,
            }
          : null,
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
        profileEvidence: loaded.profileEvidence
          ? Object.fromEntries(
              Object.entries(loaded.profileEvidence).map(([label, evidence]) => [
                label,
                {
                  path: evidence.receipt.path,
                  sha256: evidence.receipt.sha256,
                  bytes: evidence.receipt.bytes,
                },
              ]),
            )
          : undefined,
        note: 'This supplemental loader reads four owned profile snapshot files only; it never fills missing session fields or claims a native/public pass.',
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
