import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  parseNativeLocaleBinding,
  parseNativeLocaleEvidence,
  SUPPORTED_NATIVE_LOCALES,
  type NativeLocaleBinding,
  type NativeLocaleEvidence,
  type NativeLocalePlatform,
} from './locale-native-observation';

/** Versioned bytes for the existing capture helper-input ledger. */
export const NATIVE_LOCALE_HELPER_HASH_VERSION = 'native-locale-helper-inputs-v1';
const HASH64 = /^[a-f0-9]{64}$/;
const CAPTURE_ID = /^[a-f0-9]{24}$/;
const MAX_OS_RAW_BYTES = 128;
const MAX_HELPER_ROWS = 512;
const MAX_HELPER_PATH = 1024;

type HelperInput = { path: string; sha256: string };
type NativeLocaleCommandExecution =
  'completed' | 'child-failed' | 'deadline' | 'cancelled' | 'harness-blocked';
type NativeLocaleCommandCleanup =
  'not-acquired' | 'cleaned' | 'failed-recovery-ledger-retained' | 'unknown';

export type NativeLocaleCommandRead = {
  execution: NativeLocaleCommandExecution;
  cleanup: NativeLocaleCommandCleanup;
  attempted: boolean;
  stdoutText: string | null;
  childExitCode?: number | null;
  childSignal?: NodeJS.Signals | null;
  pid?: number | null;
  pgid?: number | null;
  logPath?: string | null;
  stdoutPath?: string | null;
};

export type NativeLocaleCommandNormalization = {
  observedOsLocale: NativeLocaleEvidence['observedOsLocale'] | null;
  blocker:
    | 'locale-command-not-attempted'
    | 'locale-command-read-error'
    | 'locale-command-output-missing'
    | 'locale-command-output-too-large'
    | 'locale-command-output-control-character'
    | null;
};

/**
 * Read a command-owned locale stdout child without applying the generic
 * evidence reader's non-empty-file rule. A successful getprop/defaults read
 * may be a legitimate zero-byte result and is interpreted by the caller as
 * `absent` or as the Android fallback trigger.
 */
export function readOwnedNativeLocaleStdout(root: string, relative: string): string {
  const canonicalRoot = realpathSync(root);
  const parent = lstatSync(canonicalRoot);
  if (
    canonicalRoot !== path.resolve(root) ||
    !parent.isDirectory() ||
    parent.uid !== process.getuid?.() ||
    (parent.mode & 0o777) !== 0o700
  )
    invalid('locale stdout root is not canonical, private and owned');
  if (
    !relative ||
    path.isAbsolute(relative) ||
    path.basename(relative) !== relative ||
    relative.includes('\\') ||
    relative === '.' ||
    relative === '..'
  )
    invalid('locale stdout path must be a direct relative child');
  const file = path.resolve(canonicalRoot, relative);
  if (
    path.dirname(file) !== canonicalRoot ||
    !file.startsWith(canonicalRoot + path.sep) ||
    realpathSync(file) !== file
  )
    invalid('locale stdout path escaped or contains a symlink');
  const meta = lstatSync(file);
  if (
    !meta.isFile() ||
    meta.uid !== parent.uid ||
    (meta.mode & 0o777) !== 0o600 ||
    meta.size > MAX_OS_RAW_BYTES
  )
    invalid('locale stdout file is not an owned bounded private input');
  const bytes = readFileSync(file);
  if (bytes.byteLength !== meta.size) invalid('locale stdout file changed while it was being read');
  return bytes.toString('utf8');
}

function invalid(message: string): never {
  throw new Error(`Invalid native locale capture seam: ${message}`);
}

function checkedHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH64.test(value))
    invalid(`${label} must be a lowercase SHA-256`);
  return value;
}

function checkedPath(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_HELPER_PATH ||
    value.trim() !== value ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').some((part) => part.length === 0 || part === '.' || part === '..')
  )
    invalid(`${label} must be a relative canonical path`);
  return value;
}

function checkedRows(value: readonly HelperInput[]): HelperInput[] {
  if (value.length === 0 || value.length > MAX_HELPER_ROWS)
    invalid('helper input rows are outside the bounded range');
  const rows: readonly HelperInput[] = value;
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const path = checkedPath(row.path, `helperInputs[${index}].path`);
    if (seen.has(path)) invalid(`helper input path is duplicated: ${path}`);
    seen.add(path);
    return { path, sha256: checkedHash(row.sha256, `helperInputs[${index}].sha256`) };
  });
}

/** Hash the exact helper ledger using stable, UTF-8, length-framed bytes. */
export function hashNativeLocaleHelperInputs(value: readonly HelperInput[]): string {
  const rows = checkedRows(value).sort((left, right) =>
    Buffer.compare(Buffer.from(left.path, 'utf8'), Buffer.from(right.path, 'utf8')),
  );
  const chunks: Buffer[] = [
    Buffer.from(`${NATIVE_LOCALE_HELPER_HASH_VERSION}\n${rows.length}\n`, 'utf8'),
  ];
  for (const row of rows) {
    const pathBytes = Buffer.from(row.path, 'utf8');
    chunks.push(
      Buffer.from(`${pathBytes.byteLength}:`, 'utf8'),
      pathBytes,
      Buffer.from(`:${row.sha256}\n`, 'utf8'),
    );
  }
  return createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
}

/** Build through the canonical parser; this module owns no binding policy. */
export function buildNativeLocaleBinding(input: {
  captureRunId: string;
  sourceTreeHash: string;
  helperInputs: readonly HelperInput[];
  target: NativeLocaleBinding['target'];
}): NativeLocaleBinding {
  if (!CAPTURE_ID.test(input.captureRunId))
    invalid('captureRunId must be the owned 24-character artifact id');
  return parseNativeLocaleBinding({
    captureRunId: input.captureRunId,
    sourceTreeHash: checkedHash(input.sourceTreeHash, 'sourceTreeHash'),
    helperInputsHash: hashNativeLocaleHelperInputs(input.helperInputs),
    target: input.target,
  });
}

function evidenceWith(
  binding: NativeLocaleBinding,
  observedOsLocale: NativeLocaleEvidence['observedOsLocale'],
): NativeLocaleEvidence['observedOsLocale'] {
  return parseNativeLocaleEvidence({
    schemaVersion: 1,
    requestedLocale: null,
    observedOsLocale,
    effectiveAppLocale: { hydration: 'unobserved', source: 'unobserved', value: null },
    override: { status: 'unobserved', source: 'unobserved', value: null },
    binding,
  }).observedOsLocale;
}

function sourceFor(
  platform: NativeLocalePlatform,
): NativeLocaleEvidence['observedOsLocale']['source'] {
  return platform === 'ios' ? 'ios-simctl-defaults' : 'android-getprop';
}

/** Normalize one owned command result without changing the canonical locale policy. */
export function normalizeNativeLocaleCommandOutput(input: {
  binding: NativeLocaleBinding;
  command: NativeLocaleCommandRead;
}): NativeLocaleCommandNormalization {
  const source = sourceFor(input.binding.target.platform);
  if (!input.command.attempted)
    return { observedOsLocale: null, blocker: 'locale-command-not-attempted' };
  if (input.command.execution !== 'completed' || input.command.cleanup !== 'cleaned')
    return {
      observedOsLocale: evidenceWith(input.binding, {
        status: 'read-error',
        source,
        raw: null,
        resolved: null,
        normalization: 'none',
      }),
      blocker: 'locale-command-read-error',
    };
  if (input.command.stdoutText === null)
    return { observedOsLocale: null, blocker: 'locale-command-output-missing' };
  if (Buffer.byteLength(input.command.stdoutText, 'utf8') > MAX_OS_RAW_BYTES)
    return { observedOsLocale: null, blocker: 'locale-command-output-too-large' };
  const raw = input.command.stdoutText.trim();
  if ([...raw].some((character) => character < ' ' || character === '\u007f'))
    return { observedOsLocale: null, blocker: 'locale-command-output-control-character' };
  if (raw.length === 0)
    return {
      observedOsLocale: evidenceWith(input.binding, {
        status: 'absent',
        source,
        raw: null,
        resolved: null,
        normalization: 'none',
      }),
      blocker: null,
    };
  if (SUPPORTED_NATIVE_LOCALES.includes(raw as (typeof SUPPORTED_NATIVE_LOCALES)[number])) {
    return {
      observedOsLocale: evidenceWith(input.binding, {
        status: 'observed',
        source,
        raw,
        resolved: raw as (typeof SUPPORTED_NATIVE_LOCALES)[number],
        normalization: 'exact',
      }),
      blocker: null,
    };
  }
  const platformCanonical =
    input.binding.target.platform === 'ios'
      ? new Map<string, (typeof SUPPORTED_NATIVE_LOCALES)[number]>([
          ['en_US', 'en-US'],
          ['pt_BR', 'pt-BR'],
          ['es_ES', 'es-ES'],
        ]).get(raw)
      : undefined;
  if (platformCanonical !== undefined) {
    return {
      observedOsLocale: evidenceWith(input.binding, {
        status: 'observed',
        source,
        raw,
        resolved: platformCanonical,
        normalization: 'platform-canonical',
      }),
      blocker: null,
    };
  }
  if (raw === 'en' || raw === 'pt' || raw === 'es')
    return {
      observedOsLocale: evidenceWith(input.binding, {
        status: 'observed',
        source,
        raw,
        resolved: null,
        normalization: 'language-only',
      }),
      blocker: null,
    };
  return {
    observedOsLocale: evidenceWith(input.binding, {
      status: 'invalid',
      source,
      raw,
      resolved: null,
      normalization: 'none',
    }),
    blocker: null,
  };
}

export type NativeLocaleFinalization<T> =
  | { status: 'finalized'; value: T }
  | { status: 'blocked'; error: { name: string; message: string } };

/** Keep observation projection errors from escaping into resource cleanup. */
export async function safelyFinalizeNativeLocaleObservation<T>(
  finalize: () => T | Promise<T>,
): Promise<NativeLocaleFinalization<T>> {
  try {
    return { status: 'finalized', value: await finalize() };
  } catch (error) {
    return {
      status: 'blocked',
      error: {
        name: error instanceof Error ? error.name.slice(0, 128) : 'UnknownError',
        message:
          error instanceof Error
            ? error.message.slice(0, 512)
            : 'Native locale observation finalization failed',
      },
    };
  }
}

export type AndroidLocalePropertyRead = NativeLocaleCommandRead & {
  status: 'completed' | 'read-error' | 'not-attempted';
  value: string | null;
};

function checkedAndroidPropertyRead(value: AndroidLocalePropertyRead): AndroidLocalePropertyRead {
  const read = { ...value };
  if (
    !['completed', 'child-failed', 'deadline', 'cancelled', 'harness-blocked'].includes(
      read.execution,
    ) ||
    !['not-acquired', 'cleaned', 'failed-recovery-ledger-retained', 'unknown'].includes(
      read.cleanup,
    ) ||
    typeof read.attempted !== 'boolean' ||
    (read.stdoutText !== null && typeof read.stdoutText !== 'string') ||
    !['completed', 'read-error', 'not-attempted'].includes(read.status) ||
    (read.value !== null && typeof read.value !== 'string')
  )
    invalid('Android locale command metadata is invalid');
  return read;
}

/** Keep harness, cancellation and ownership failures in the enclosing capture. */
export function shouldPropagateAndroidLocaleCommandFailure(
  read: Pick<AndroidLocalePropertyRead, 'execution' | 'cleanup'>,
  controllerAborted = false,
): boolean {
  return (
    controllerAborted ||
    read.execution === 'harness-blocked' ||
    read.execution === 'deadline' ||
    read.execution === 'cancelled' ||
    read.cleanup !== 'cleaned'
  );
}

/**
 * Read persisted Android locale first; consult product default only after a
 * completed, cleaned, empty persisted read. The callback carries the real
 * owned-command record so failed/cancelled/cleanup states remain observable.
 */
export async function readAndroidNativeLocaleProperties(
  readProperty: (
    property: string,
  ) => Promise<AndroidLocalePropertyRead> | AndroidLocalePropertyRead,
): Promise<{
  persisted: AndroidLocalePropertyRead;
  productDefault: AndroidLocalePropertyRead | null;
  selected: AndroidLocalePropertyRead;
  selectedProperty: 'persist.sys.locale' | 'ro.product.locale' | null;
}> {
  const read = async (property: string): Promise<AndroidLocalePropertyRead> =>
    checkedAndroidPropertyRead(await readProperty(property));
  const persisted = await read('persist.sys.locale');
  if (persisted.status !== 'completed')
    return {
      persisted,
      productDefault: null,
      selected: persisted,
      selectedProperty: 'persist.sys.locale',
    };
  if (persisted.value === null || persisted.value.trim() !== '')
    return {
      persisted,
      productDefault: null,
      selected: persisted,
      selectedProperty: 'persist.sys.locale',
    };
  const productDefault = await read('ro.product.locale');
  return {
    persisted,
    productDefault,
    selected: productDefault,
    selectedProperty: 'ro.product.locale',
  };
}
