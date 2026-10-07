import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  androidSessionStorageLimits,
  buildAndroidSessionStorageProbePlan,
  parseAndroidSessionStorageObservation,
  parseAndroidStorageListing,
  redactAndroidSqliteQuery,
  readOwnedAndroidStableFile,
  requireAndroidPersistedProfileIdentityHash,
  requireAbsentAndroidDatabaseCoherence,
  requireCoherentAndroidDatabaseListing,
  requireSameAndroidDatabaseListing,
  writeOwnedAndroidPrivateFile,
  type AndroidSessionStorageCheckpoint,
  type AndroidStorageFileReceipt,
} from './native-android-session-adapter';
import type { DetoxSessionCacheCheckpoint } from './detox-session-cache-observation';
import type { NativeCommandExecution } from './owned-native-command';

const expectedAppId = 'com.edufelip.mychampions.dev';
const serialPattern = /^emulator-55(?:5[468]|[67][02468]|8[024])$/;

const checkpointLabels: Readonly<Record<DetoxSessionCacheCheckpoint, string>> = {
  afterLogin: 'auth-before-relaunch',
  afterRestoration: 'auth-after-restore',
  afterCancel: 'auth-after-cancel',
  afterSignout: 'auth-after-signout',
  afterSignedOutRelaunch: 'auth-after-signed-out-relaunch',
};

const presentCheckpoints = new Set<DetoxSessionCacheCheckpoint>([
  'afterLogin',
  'afterRestoration',
  'afterCancel',
]);

export type DetoxAndroidSessionStoragePhase =
  'before-login' | 'after-login' | 'after-restoration' | 'after-signed-out-relaunch';

const phaseLabels: Readonly<Record<DetoxAndroidSessionStoragePhase, string>> = {
  'before-login': 'auth-before-login',
  'after-login': 'auth-after-login',
  'after-restoration': 'auth-after-restoration',
  'after-signed-out-relaunch': 'auth-after-signed-out-relaunch',
};

export type DetoxAndroidSessionStorageBinding = Readonly<{
  runId: string;
  scope: 'native-entry-android';
  apiOrigin: string;
  apiPid: number;
  backendAttemptId: string;
  manifestSha256: string;
  fixtureAuthUidAllowlistHash: string;
  waitForQuiescence: () => Promise<void>;
}>;

type DetoxAndroidCommandBinding = Omit<DetoxAndroidSessionStorageBinding, 'waitForQuiescence'>;

export type DetoxAndroidOwnedCommandExecution = NativeCommandExecution &
  Readonly<{
    command: string;
    argv: readonly string[];
    cwd: string;
    deadlineMs: number;
    commandHash: string;
    inputSha256?: string | null;
    target: { serial: string; adbServerPort: number };
    binding: DetoxAndroidCommandBinding;
  }>;

type ProducerCommandInput = {
  label: string;
  argv: readonly string[];
  artifactRoot: string;
  deadlineMs: number;
  signal: AbortSignal;
  /** Optional bounded stdin for deterministic owned shell-free file writes. */
  input?: string;
  stdoutPath?: string;
  target: { serial: string; adbServerPort: number };
  binding: DetoxAndroidCommandBinding;
};

export type DetoxAndroidSessionStorageTarget = Readonly<{
  appId: typeof expectedAppId;
  serial: string;
  adbServerPort: number;
  verify: () => Promise<void>;
  runAdb: (input: ProducerCommandInput) => Promise<DetoxAndroidOwnedCommandExecution>;
  runHostSqlite: (input: ProducerCommandInput) => Promise<DetoxAndroidOwnedCommandExecution>;
}>;

export type DetoxAndroidSessionStorageProducerInput = Readonly<{
  checkpoint: DetoxSessionCacheCheckpoint;
  artifactRoot: string;
  target: DetoxAndroidSessionStorageTarget;
  binding: DetoxAndroidSessionStorageBinding;
  actorAuthUid?: string;
  signal: AbortSignal;
  deadlineMs?: number;
  phase?: DetoxAndroidSessionStoragePhase;
  removeRawQuery?: (filePath: string) => Promise<void>;
}>;

type CommandReceipt = Readonly<{
  label: string;
  execution: NativeCommandExecution['execution'];
  cleanup: NativeCommandExecution['cleanup'];
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  logPath: string | null;
  stdoutPath: string | null;
  ownershipPath: string | null;
  pid: number;
  pgid: number;
  started: string;
  processCommandHash: string;
  command: string;
  argv: readonly string[];
  cwd: string;
  deadlineMs: number;
  commandHash: string;
  target: { serial: string; adbServerPort: number };
  binding: DetoxAndroidCommandBinding;
}>;

export class AndroidSessionStorageQueryError extends Error {
  readonly queryFailure: unknown;
  readonly queryCleanupFailure: unknown;

  constructor(queryFailure: unknown, queryCleanupFailure: unknown) {
    const causeText = (value: unknown) =>
      (value instanceof Error ? value.message : String(value)).slice(0, 300);
    super(
      queryFailure
        ? `Android session storage query failed; cleanup status retained (cause: ${causeText(queryFailure)})`
        : `Android session storage query cleanup failed (cause: ${causeText(queryCleanupFailure)})`,
    );
    this.name = 'AndroidSessionStorageQueryError';
    this.queryFailure = queryFailure;
    this.queryCleanupFailure = queryCleanupFailure;
  }
}

export function buildDetoxAndroidStorageCommandHash(input: {
  command: string;
  argv: readonly string[];
  cwd: string;
  deadlineMs: number;
  phase: NativeCommandExecution['phase'];
  inputSha256?: string;
  target: { serial: string; adbServerPort: number };
  binding: DetoxAndroidCommandBinding;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        command: input.command,
        argv: [...input.argv],
        cwd: input.cwd,
        deadlineMs: input.deadlineMs,
        phase: input.phase,
        ...(input.inputSha256 ? { inputSha256: input.inputSha256 } : {}),
        target: input.target,
        binding: input.binding,
      }),
    )
    .digest('hex');
}

function requireRunDeadline(value: number | undefined): number {
  const deadlineMs = value ?? 60_000;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 100 || deadlineMs > 600_000)
    throw new Error('Android Detox storage command deadline is invalid');
  return deadlineMs;
}

function requireCheckpoint(value: DetoxSessionCacheCheckpoint): string {
  const label = checkpointLabels[value];
  if (!label) throw new Error('Android Detox storage checkpoint is invalid');
  return label;
}

function requirePhase(value: DetoxAndroidSessionStoragePhase | undefined): string | undefined {
  if (value === undefined) return undefined;
  const label = phaseLabels[value];
  if (!label) throw new Error('Android Detox storage phase is invalid');
  return label;
}

function requireBinding(binding: DetoxAndroidSessionStorageBinding) {
  if (
    !/^[a-f0-9]{24}$/.test(binding.runId) ||
    binding.scope !== 'native-entry-android' ||
    !/^https?:\/\//.test(binding.apiOrigin) ||
    !Number.isSafeInteger(binding.apiPid) ||
    binding.apiPid <= 1 ||
    binding.backendAttemptId !== `${binding.runId}:first` ||
    !/^[a-f0-9]{64}$/.test(binding.manifestSha256) ||
    !/^[a-f0-9]{64}$/.test(binding.fixtureAuthUidAllowlistHash) ||
    typeof binding.waitForQuiescence !== 'function'
  )
    throw new Error('Android storage binding is not an owned first-attempt identity');
}

function requireTarget(target: DetoxAndroidSessionStorageTarget) {
  if (
    target.appId !== expectedAppId ||
    !serialPattern.test(target.serial) ||
    !Number.isSafeInteger(target.adbServerPort) ||
    target.adbServerPort < 1024 ||
    target.adbServerPort > 49151 ||
    typeof target.verify !== 'function' ||
    typeof target.runAdb !== 'function' ||
    typeof target.runHostSqlite !== 'function'
  )
    throw new Error('Android Detox storage target is not an owned configured target');
}

async function requireCommandReceipt(
  label: string,
  execution: DetoxAndroidOwnedCommandExecution,
  stdoutPath?: string,
  command?: readonly string[],
  target?: DetoxAndroidSessionStorageTarget,
  binding?: DetoxAndroidSessionStorageBinding,
  artifactRoot?: string,
): Promise<CommandReceipt> {
  if (
    execution.execution !== 'completed' ||
    execution.cleanup !== 'cleaned' ||
    execution.childExitCode !== 0 ||
    execution.childSignal !== null ||
    (stdoutPath !== undefined && execution.stdoutPath !== stdoutPath) ||
    execution.pid === null ||
    execution.pgid === null ||
    !Number.isSafeInteger(execution.pid) ||
    !Number.isSafeInteger(execution.pgid) ||
    execution.pid <= 1 ||
    execution.pgid <= 1 ||
    typeof execution.command !== 'string' ||
    !path.isAbsolute(execution.command) ||
    !Array.isArray(execution.argv) ||
    typeof execution.cwd !== 'string' ||
    !path.isAbsolute(execution.cwd) ||
    !Number.isSafeInteger(execution.deadlineMs) ||
    !/^[a-f0-9]{64}$/.test(execution.commandHash) ||
    execution.censusFailure != null ||
    execution.outputFailure != null ||
    !target ||
    !binding ||
    execution.target.serial !== target.serial ||
    execution.target.adbServerPort !== target.adbServerPort ||
    execution.binding.runId !== binding.runId ||
    execution.binding.scope !== binding.scope ||
    execution.binding.apiOrigin !== binding.apiOrigin ||
    execution.binding.apiPid !== binding.apiPid ||
    execution.binding.backendAttemptId !== binding.backendAttemptId ||
    execution.binding.manifestSha256 !== binding.manifestSha256 ||
    execution.binding.fixtureAuthUidAllowlistHash !== binding.fixtureAuthUidAllowlistHash ||
    (command &&
      (execution.command.endsWith('/sqlite3')
        ? JSON.stringify(execution.argv) !== JSON.stringify(command)
        : JSON.stringify(execution.argv) !==
          JSON.stringify([
            '-H',
            '127.0.0.1',
            '-P',
            String(target.adbServerPort),
            '-s',
            target.serial,
            ...command,
          ])))
  )
    throw new Error(
      `Android Detox storage command ${label} did not complete cleanly (execution=${String(
        execution.execution,
      )}, cleanup=${String(execution.cleanup)}, exit=${String(execution.childExitCode)}, signal=${String(
        execution.childSignal,
      )}, census=${execution.censusFailure ? 'failed' : 'ok'}, output=${
        execution.outputFailure ? JSON.stringify(execution.outputFailure).slice(0, 200) : 'ok'
      })`,
    );
  const expectedCommandHash = buildDetoxAndroidStorageCommandHash({
    command: execution.command,
    argv: execution.argv,
    cwd: execution.cwd,
    deadlineMs: execution.deadlineMs,
    phase: execution.phase,
    target: execution.target,
    binding: execution.binding,
  });
  if (execution.commandHash !== expectedCommandHash)
    throw new Error(`Android Detox storage command ${label} descriptor hash is invalid`);
  if (
    execution.command.endsWith('/sqlite3')
      ? execution.command !== '/usr/bin/sqlite3'
      : !execution.command.endsWith('/platform-tools/adb')
  )
    throw new Error(`Android Detox storage command ${label} tool path is not pinned`);
  if (execution.argv.includes('sh') || execution.argv.includes('-c'))
    throw new Error(`Android Detox storage command ${label} uses a shell escape`);
  if (!artifactRoot || !execution.ownershipPath || !execution.logPath || !execution.stdoutPath)
    throw new Error(`Android Detox storage command ${label} private receipts are incomplete`);
  const root = await requirePrivateArtifactRoot(artifactRoot);
  const privateReceipt = async (filePath: string, name: string) => {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(root + path.sep))
      throw new Error(`Android Detox storage command ${label} ${name} escaped the artifact root`);
    if ((await realpath(resolved)) !== resolved) throw new Error(`Android ${name} receipt escaped`);
    const metadata = await lstat(resolved);
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o777) !== 0o600 ||
      (process.getuid && metadata.uid !== process.getuid()) ||
      metadata.size > 16 * 1024 * 1024
    )
      throw new Error(`Android ${name} receipt is not a private regular file`);
  };
  await Promise.all([
    privateReceipt(execution.ownershipPath, 'ownership'),
    privateReceipt(execution.logPath, 'log'),
    privateReceipt(execution.stdoutPath, 'stdout'),
  ]);
  const ownership = JSON.parse(await readFile(execution.ownershipPath, 'utf8')) as {
    kind?: unknown;
    cleanup?: unknown;
    pid?: unknown;
    pgid?: unknown;
    processes?: unknown;
  };
  if (
    ownership.kind !== 'private worker process ownership' ||
    ownership.cleanup !== 'cleaned' ||
    ownership.pid !== execution.pgid ||
    ownership.pgid !== execution.pgid ||
    !Array.isArray(ownership.processes)
  )
    throw new Error(`Android Detox storage command ${label} ownership ledger is incomplete`);
  const matchesExecution = (row: unknown) =>
    Boolean(row) &&
    typeof row === 'object' &&
    (row as Record<string, unknown>).pid === execution.pid &&
    (row as Record<string, unknown>).pgid === execution.pgid;
  // A short command can exit before the periodic census lists it; the
  // ownership requery still records its start identity as "unavailable".
  const requeried = Array.isArray(
    (ownership as { commandCensusRequeries?: unknown }).commandCensusRequeries,
  )
    ? ((ownership as { commandCensusRequeries: unknown[] }).commandCensusRequeries.flatMap(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          Array.isArray((entry as { unavailable?: unknown }).unavailable)
            ? (entry as { unavailable: unknown[] }).unavailable
            : [],
      ) as unknown[])
    : [];
  const processRecord = (ownership.processes.find(matchesExecution) ??
    requeried.find(matchesExecution)) as Record<string, unknown> | undefined;
  if (
    !processRecord ||
    typeof processRecord.started !== 'string' ||
    processRecord.started.length === 0 ||
    typeof processRecord.commandHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(processRecord.commandHash)
  )
    throw new Error(`Android Detox storage command ${label} process start identity is missing`);
  return {
    label,
    execution: execution.execution,
    cleanup: execution.cleanup,
    childExitCode: execution.childExitCode,
    childSignal: execution.childSignal,
    logPath: execution.logPath,
    stdoutPath: execution.stdoutPath,
    ownershipPath: execution.ownershipPath,
    pid: execution.pid,
    pgid: execution.pgid,
    started: processRecord.started,
    processCommandHash: processRecord.commandHash,
    command: execution.command,
    argv: [...(execution.argv as readonly string[])],
    cwd: execution.cwd,
    deadlineMs: execution.deadlineMs,
    commandHash: execution.commandHash,
    target: { ...execution.target },
    binding: { ...execution.binding },
  };
}

async function requirePrivateArtifactRoot(root: string) {
  const resolved = path.resolve(root);
  if ((await realpath(resolved)) !== resolved)
    throw new Error('Android storage root is not canonical');
  const metadata = await lstat(resolved);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    metadata.uid !== process.getuid?.() ||
    (metadata.mode & 0o777) !== 0o700
  )
    throw new Error('Android storage root is not an owned private directory');
  return resolved;
}

function receiptSummary(receipt: AndroidStorageFileReceipt) {
  return {
    path: receipt.path,
    kind: receipt.kind,
    sizeBytes: receipt.sizeBytes,
    sha256: receipt.sha256,
    ownerUid: receipt.ownerUid,
    mode: receipt.mode,
    verification: receipt.verification,
  };
}

/**
 * Reads one Android Detox session checkpoint from the owned target.  The
 * command callbacks are constructed by the target owner; this module only
 * supplies fixed argv from the adapter's probe plan and validates every
 * returned private artifact before publishing the parsed checkpoint.
 */
export async function readDetoxAndroidSessionStorageCheckpoint(
  input: DetoxAndroidSessionStorageProducerInput,
): Promise<AndroidSessionStorageCheckpoint> {
  const phaseLabel = requirePhase(input.phase);
  const label = phaseLabel ?? requireCheckpoint(input.checkpoint);
  const deadlineMs = requireRunDeadline(input.deadlineMs);
  requireTarget(input.target);
  requireBinding(input.binding);
  input.signal.throwIfAborted();
  const artifactRoot = await requirePrivateArtifactRoot(input.artifactRoot);
  await input.target.verify();
  const plan = buildAndroidSessionStorageProbePlan(input.target.appId);
  const commandReceipts: CommandReceipt[] = [];
  let quiescenceFenceCount = 0;
  const runAdb = async (
    command: Omit<
      ProducerCommandInput,
      'artifactRoot' | 'deadlineMs' | 'signal' | 'target' | 'binding'
    >,
  ) => {
    input.signal.throwIfAborted();
    await input.binding.waitForQuiescence();
    quiescenceFenceCount += 1;
    input.signal.throwIfAborted();
    await input.target.verify();
    const commandWithReceipt = {
      ...command,
      stdoutPath: command.stdoutPath ?? path.join(artifactRoot, command.label + '.stdout'),
    };
    const execution = await input.target.runAdb({
      ...commandWithReceipt,
      artifactRoot,
      deadlineMs,
      signal: input.signal,
      target: { serial: input.target.serial, adbServerPort: input.target.adbServerPort },
      binding: {
        runId: input.binding.runId,
        scope: input.binding.scope,
        apiOrigin: input.binding.apiOrigin,
        apiPid: input.binding.apiPid,
        backendAttemptId: input.binding.backendAttemptId,
        manifestSha256: input.binding.manifestSha256,
        fixtureAuthUidAllowlistHash: input.binding.fixtureAuthUidAllowlistHash,
      },
    });
    commandReceipts.push(
      await requireCommandReceipt(
        command.label,
        execution,
        commandWithReceipt.stdoutPath,
        commandWithReceipt.argv,
        input.target,
        input.binding,
        artifactRoot,
      ),
    );
    return execution;
  };
  const runHostSqlite = async (
    command: Omit<
      ProducerCommandInput,
      'artifactRoot' | 'deadlineMs' | 'signal' | 'target' | 'binding'
    >,
  ) => {
    input.signal.throwIfAborted();
    await input.binding.waitForQuiescence();
    quiescenceFenceCount += 1;
    input.signal.throwIfAborted();
    await input.target.verify();
    const commandWithReceipt = {
      ...command,
      stdoutPath: command.stdoutPath ?? path.join(artifactRoot, command.label + '.stdout'),
    };
    const execution = await input.target.runHostSqlite({
      ...commandWithReceipt,
      artifactRoot,
      deadlineMs,
      signal: input.signal,
      target: { serial: input.target.serial, adbServerPort: input.target.adbServerPort },
      binding: {
        runId: input.binding.runId,
        scope: input.binding.scope,
        apiOrigin: input.binding.apiOrigin,
        apiPid: input.binding.apiPid,
        backendAttemptId: input.binding.backendAttemptId,
        manifestSha256: input.binding.manifestSha256,
        fixtureAuthUidAllowlistHash: input.binding.fixtureAuthUidAllowlistHash,
      },
    });
    commandReceipts.push(
      await requireCommandReceipt(
        command.label,
        execution,
        commandWithReceipt.stdoutPath,
        commandWithReceipt.argv,
        input.target,
        input.binding,
        artifactRoot,
      ),
    );
    return execution;
  };

  // The proxy fence runs before every owned command. Mid-flow checkpoints must
  // not kill the app the Detox flow is still driving: consistency comes from
  // the rollback-journal check before and after the copy plus the unchanged
  // directory listing. Only the before-login read (app not yet driven) stops it.
  await runAdb({
    label: `${label}-quiesce`,
    argv:
      input.phase === 'before-login'
        ? ['shell', 'am', 'force-stop', plan.appId]
        : ['shell', 'true'],
  });

  const databasePath = path.join(artifactRoot, `${label}-async-storage.db`);
  const queryPath = path.join(artifactRoot, `${label}-async-storage-query.json`);
  const rawQueryPath = path.join(artifactRoot, `${label}-async-storage-query.raw.private`);
  const secureStorePath = path.join(artifactRoot, `${label}-secure-store.xml`);
  const databaseListingPath = path.join(artifactRoot, `${label}-async-directory.stdout`);
  const databaseAfterListingPath = path.join(artifactRoot, `${label}-async-directory-after.stdout`);
  const secureStoreListingPath = path.join(artifactRoot, `${label}-secure-presence.stdout`);
  // A fresh install has never run the app, so before login its sandbox may
  // have no databases/ directory. That is a valid signed-out state; record it
  // as database 'absent' from an owned app-directory listing instead of a capture.
  const readPresentDatabase = async () => {
    const databaseDirectory = await runAdb({
      label: `${label}-async-directory`,
      argv: plan.databaseDirectoryArgv,
      stdoutPath: databaseListingPath,
    });
    if (!databaseDirectory.stdoutPath)
      throw new Error('Android database listing stdout is missing');
    const databaseListing = await readOwnedAndroidStableFile({
      artifactRoot,
      filePath: databaseDirectory.stdoutPath,
      kind: 'listing',
      maxBytes: androidSessionStorageLimits.listingBytes,
      signal: input.signal,
    });
    const databaseNames = parseAndroidStorageListing(
      databaseListing.bytes.toString('utf8'),
      'Android AsyncStorage database',
    );
    // A rollback journal is only an uncommitted ("hot") write when its header
    // carries SQLite's journal magic. TRUNCATE leaves it empty and PERSIST
    // zeroes the header on commit, so read the bytes before accepting it.
    let rollbackJournalVerifiedEmpty = false;
    if (databaseNames.includes('RKStorage-journal')) {
      const journalCapture = await runAdb({
        label: `${label}-journal-capture`,
        argv: ['exec-out', 'run-as', plan.appId, 'cat', 'databases/RKStorage-journal'],
      });
      const journalBytes = journalCapture.stdoutPath
        ? await readFile(journalCapture.stdoutPath)
        : null;
      rollbackJournalVerifiedEmpty =
        journalBytes !== null &&
        (journalBytes.length === 0 ||
          (journalBytes.length >= 8 && journalBytes.subarray(0, 8).every((byte) => byte === 0)));
    }
    const coherence = requireCoherentAndroidDatabaseListing(databaseNames, {
      rollbackJournalVerifiedEmpty,
    });
    const databaseSidecars: AndroidStorageFileReceipt[] = [];
    let database: AndroidStorageFileReceipt | undefined;
    for (const relativePath of plan.databaseRelativePaths) {
      input.signal.throwIfAborted();
      const fileName = path.basename(relativePath);
      if (!databaseNames.includes(fileName)) continue;
      const artifactPath =
        fileName === 'RKStorage'
          ? databasePath
          : path.join(
              artifactRoot,
              `${path.basename(databasePath)}${fileName.slice('RKStorage'.length)}`,
            );
      const capture = await runAdb({
        // Owned command labels must be lowercase ([a-z0-9-]).
        label: `${label}-${fileName.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}-capture`,
        argv: plan.databaseCaptureArgv(relativePath),
        stdoutPath: artifactPath,
      });
      if (!capture.stdoutPath) throw new Error(`Android ${fileName} capture stdout is missing`);
      const receipt = await readOwnedAndroidStableFile({
        artifactRoot,
        filePath: capture.stdoutPath,
        kind: fileName === 'RKStorage' ? 'database' : 'sidecar',
        maxBytes:
          fileName === 'RKStorage'
            ? androidSessionStorageLimits.databaseBytes
            : androidSessionStorageLimits.sidecarBytes,
        signal: input.signal,
      });
      if (fileName === 'RKStorage') database = receipt.receipt;
      else databaseSidecars.push(receipt.receipt);
    }
    if (!database) throw new Error('Android AsyncStorage database capture is missing');
    if (databaseNames.includes('RKStorage-journal')) {
      // Re-read the journal after copying: a write that began mid-copy would
      // leave a hot (magic-header) journal and makes this copy untrustworthy.
      const recheck = await runAdb({
        label: `${label}-journal-recheck`,
        argv: ['exec-out', 'run-as', plan.appId, 'cat', 'databases/RKStorage-journal'],
      });
      const recheckBytes = recheck.stdoutPath ? await readFile(recheck.stdoutPath) : null;
      if (
        recheckBytes === null ||
        !(
          recheckBytes.length === 0 ||
          (recheckBytes.length >= 8 && recheckBytes.subarray(0, 8).every((byte) => byte === 0))
        )
      )
        throw new Error('Android AsyncStorage database changed during capture');
    }
    const databaseAfterDirectory = await runAdb({
      label: `${label}-async-directory-after`,
      argv: plan.databaseDirectoryArgv,
      stdoutPath: databaseAfterListingPath,
    });
    if (!databaseAfterDirectory.stdoutPath)
      throw new Error('Android post-capture database listing stdout is missing');
    const databaseAfterListing = await readOwnedAndroidStableFile({
      artifactRoot,
      filePath: databaseAfterDirectory.stdoutPath,
      kind: 'listing',
      maxBytes: androidSessionStorageLimits.listingBytes,
      signal: input.signal,
    });
    const databaseNamesAfter = parseAndroidStorageListing(
      databaseAfterListing.bytes.toString('utf8'),
      'Android AsyncStorage database after capture',
    );
    requireCoherentAndroidDatabaseListing(databaseNamesAfter, { rollbackJournalVerifiedEmpty });
    requireSameAndroidDatabaseListing(databaseNames, databaseNamesAfter);

    let queryCapture: AndroidStorageFileReceipt | undefined;
    let querySourceReceipt:
      AndroidSessionStorageCheckpoint['privateArtifacts']['querySource'] | undefined;
    let rawQueryJson = '';
    let queryProfileAuthUidHash: string | null = null;
    let queryFailure: unknown = null;
    let queryCleanupFailure: unknown = null;
    try {
      const queryExecution = await runHostSqlite({
        label: `${label}-async-query`,
        argv: ['-readonly', '-json', databasePath, plan.sqliteQuery],
        stdoutPath: rawQueryPath,
      });
      if (!queryExecution.stdoutPath) throw new Error('Android sqlite query stdout is missing');
      // sqlite3 -json prints nothing for zero rows (the signed-out state); the
      // projection parser's canonical empty result is "[]".
      if ((await stat(queryExecution.stdoutPath)).size === 0)
        await writeFile(queryExecution.stdoutPath, '[]\n', { flag: 'w' });
      const rawQueryCapture = await readOwnedAndroidStableFile({
        artifactRoot,
        filePath: queryExecution.stdoutPath,
        kind: 'frame',
        maxBytes: androidSessionStorageLimits.queryBytes,
        signal: input.signal,
      });
      rawQueryJson = rawQueryCapture.bytes.toString('utf8');
      const redactedQuery = redactAndroidSqliteQuery(rawQueryJson);
      queryProfileAuthUidHash = redactedQuery.profileAuthUidHash;
      querySourceReceipt = {
        path: rawQueryCapture.receipt.path,
        kind: 'query',
        sizeBytes: rawQueryCapture.receipt.sizeBytes,
        sha256: rawQueryCapture.receipt.sha256,
        ownerUid: rawQueryCapture.receipt.ownerUid,
        mode: rawQueryCapture.receipt.mode,
        retained: false,
        databaseSha256: database.sha256,
        databaseSidecarSha256: databaseSidecars.map((receipt) => receipt.sha256),
        verification: 'owned-query-source-v6',
      };
      queryCapture = await writeOwnedAndroidPrivateFile({
        artifactRoot,
        relativePath: path.basename(queryPath),
        bytes: redactedQuery.redactedJson,
        kind: 'query',
        signal: input.signal,
      });
    } catch (error) {
      queryFailure = error;
    } finally {
      try {
        await (input.removeRawQuery ?? (async (filePath: string) => rm(filePath, { force: true })))(
          rawQueryPath,
        );
      } catch (error) {
        queryCleanupFailure = error;
      }
    }
    if (queryFailure || queryCleanupFailure)
      throw new AndroidSessionStorageQueryError(queryFailure, queryCleanupFailure);
    if (!queryCapture || !querySourceReceipt)
      throw new Error('Android query redaction receipts are incomplete');
    const verifiedQueryCapture = queryCapture;
    const verifiedQuerySourceReceipt = querySourceReceipt;
    return {
      database: database as AndroidStorageFileReceipt,
      databaseSidecars,
      coherence,
      databaseListingReceipt: databaseListing.receipt,
      databaseAfterListingReceipt: databaseAfterListing.receipt as AndroidStorageFileReceipt | null,
      rawQueryJson: rawQueryJson as string | null,
      queryProfileAuthUidHash,
      verifiedQueryCapture: verifiedQueryCapture as AndroidStorageFileReceipt | null,
      verifiedQuerySourceReceipt: verifiedQuerySourceReceipt as
        AndroidSessionStorageCheckpoint['privateArtifacts']['querySource'] | null,
    };
  };
  // Only the before-login checkpoint can precede the app's first launch.
  let appListingReceipt: AndroidStorageFileReceipt | null = null;
  let databasesPresent = true;
  if (input.phase === 'before-login') {
    const appDirectory = await runAdb({
      label: `${label}-app-directory`,
      argv: ['shell', 'run-as', plan.appId, 'ls', '-1'],
      stdoutPath: path.join(artifactRoot, `${label}-app-directory.stdout`),
    });
    if (!appDirectory.stdoutPath)
      throw new Error('Android app directory listing stdout is missing');
    const appListing = await readOwnedAndroidStableFile({
      artifactRoot,
      filePath: appDirectory.stdoutPath,
      kind: 'listing',
      maxBytes: androidSessionStorageLimits.listingBytes,
      signal: input.signal,
    });
    appListingReceipt = appListing.receipt;
    databasesPresent = parseAndroidStorageListing(
      appListing.bytes.toString('utf8'),
      'Android app data directory',
    ).includes('databases');
  }
  const {
    database,
    databaseSidecars,
    coherence,
    databaseListingReceipt,
    databaseAfterListingReceipt,
    rawQueryJson,
    queryProfileAuthUidHash,
    verifiedQueryCapture,
    verifiedQuerySourceReceipt,
  } = databasesPresent
    ? await readPresentDatabase()
    : {
        database: null,
        databaseSidecars: [] as AndroidStorageFileReceipt[],
        coherence: requireAbsentAndroidDatabaseCoherence(),
        databaseListingReceipt: appListingReceipt as AndroidStorageFileReceipt,
        databaseAfterListingReceipt: null,
        rawQueryJson: null,
        queryProfileAuthUidHash: null,
        verifiedQueryCapture: null,
        verifiedQuerySourceReceipt: null,
      };
  const secureStoreDirectory = await runAdb({
    label: `${label}-secure-presence`,
    argv: plan.secureStorePresenceArgv,
    stdoutPath: secureStoreListingPath,
  });
  if (!secureStoreDirectory.stdoutPath)
    throw new Error('Android SecureStore listing stdout is missing');
  const secureStoreListing = await readOwnedAndroidStableFile({
    artifactRoot,
    filePath: secureStoreDirectory.stdoutPath,
    kind: 'listing',
    maxBytes: androidSessionStorageLimits.listingBytes,
    signal: input.signal,
  });
  const secureStoreNames = parseAndroidStorageListing(
    secureStoreListing.bytes.toString('utf8'),
    'Android SecureStore directory',
  );
  const securePreferences = secureStoreNames.includes('SecureStore.xml') ? 'present' : 'absent';
  let secureStore: Awaited<ReturnType<typeof readOwnedAndroidStableFile>> | null = null;
  if (securePreferences === 'present') {
    const secureExecution = await runAdb({
      label: `${label}-secure-capture`,
      argv: plan.secureStoreCaptureArgv,
      stdoutPath: secureStorePath,
    });
    if (!secureExecution.stdoutPath) throw new Error('Android SecureStore XML stdout is missing');
    secureStore = await readOwnedAndroidStableFile({
      artifactRoot,
      filePath: secureExecution.stdoutPath,
      kind: 'xml',
      maxBytes: androidSessionStorageLimits.xmlBytes,
      signal: input.signal,
    });
  }
  input.signal.throwIfAborted();
  const observation = parseAndroidSessionStorageObservation({
    database: database ? 'present' : 'absent',
    sqliteJson: rawQueryJson,
    securePreferences,
    secureStoreXml: secureStore?.bytes.toString('utf8') ?? null,
    sessionKeyHash: createHash('sha256').update(plan.sessionKey).digest('hex'),
  });
  if (observation.asyncStorage.profileAuthUidHash !== queryProfileAuthUidHash)
    throw new Error('Android session profile identity hash changed during query redaction');
  const expectedStatus = presentCheckpoints.has(input.checkpoint)
    ? 'session-present'
    : 'session-absent';
  if (observation.status !== expectedStatus)
    throw new Error(`Android ${input.checkpoint} storage status is ${observation.status}`);
  if (expectedStatus === 'session-present') {
    if (!input.actorAuthUid)
      throw new Error('Android present Detox storage checkpoint lacks the actor identity');
    requireAndroidPersistedProfileIdentityHash({
      observation,
      expectedAuthUid: input.actorAuthUid,
    });
  } else if (input.actorAuthUid !== undefined) {
    throw new Error('Android signed-out Detox storage checkpoint received an actor identity');
  }
  const checkpoint: AndroidSessionStorageCheckpoint = {
    ...observation,
    coherence,
    privateArtifacts: {
      database,
      databaseSidecars,
      query: verifiedQueryCapture,
      querySource: verifiedQuerySourceReceipt,
      secureStore: secureStore?.receipt ?? null,
      databaseListing: databaseListingReceipt,
      secureStoreListing: secureStoreListing.receipt,
    },
  };
  await writeOwnedAndroidPrivateFile({
    artifactRoot,
    relativePath: `${label}-storage-observation.private.json`,
    bytes: JSON.stringify(checkpoint, null, 2),
    kind: 'query',
    signal: input.signal,
  });
  await writeOwnedAndroidPrivateFile({
    artifactRoot,
    relativePath: `${label}-storage-command-receipts.private.json`,
    bytes: JSON.stringify(
      {
        schemaVersion: 1,
        kind: 'private-detox-android-session-storage-command-receipts',
        checkpoint: input.checkpoint,
        phase: input.phase ?? null,
        quiescenceFenceCount,
        binding: {
          runId: input.binding.runId,
          scope: input.binding.scope,
          apiOrigin: input.binding.apiOrigin,
          apiPid: input.binding.apiPid,
          backendAttemptId: input.binding.backendAttemptId,
          manifestSha256: input.binding.manifestSha256,
          fixtureAuthUidAllowlistHash: input.binding.fixtureAuthUidAllowlistHash,
        },
        target: { serial: input.target.serial, adbServerPort: input.target.adbServerPort },
        commands: commandReceipts,
        sourceReceipts: [
          receiptSummary(databaseListingReceipt),
          ...(database ? [receiptSummary(database)] : []),
          ...databaseSidecars.map(receiptSummary),
          ...(databaseAfterListingReceipt ? [receiptSummary(databaseAfterListingReceipt)] : []),
          ...(verifiedQueryCapture ? [receiptSummary(verifiedQueryCapture)] : []),
          ...(secureStore ? [receiptSummary(secureStore.receipt)] : []),
          receiptSummary(secureStoreListing.receipt),
        ],
      },
      null,
      2,
    ),
    kind: 'frame',
    signal: input.signal,
  });
  return checkpoint;
}
