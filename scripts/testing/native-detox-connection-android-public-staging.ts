import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  requireDetoxPngBytes,
  readOwnedDetoxPrivateFile,
  requireDetoxConnectionCommand,
  requireDetoxConnectionObservation,
  type DetoxConnectionCommand,
  type DetoxConnectionObservationReceipt,
  type DetoxConnectionOwnedProcessIdentity,
} from "./detox-connection-ipc";
import {
  inspectDetoxBuildInstrumentation,
  requireDetoxBuildInstrumentation,
  type DetoxBaselineBuildInstrumentation,
} from "./detox-integrated-session-baseline";
import { requireNativeConnectionTransport } from "./native-connection-journey-core";
import { CONNECTION_PURPOSE_PLANS } from "./native-connection-platform-contract";
import { requireConnectionSnapshot } from "./native-connection-snapshot";
import {
  nativeConnectionAssertionIds,
  requireNativePilotAssertions,
  type NativePilotSelection,
} from "./native-pilot-contract";
import { readNativeEvidenceObservation } from "./native-view-evidence";
import type { DetoxAndroidConnectionPublicBridgeResult } from "./native-detox-connection-android-public-dispatch";

const RUN_ID = /^[a-f0-9]{24}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9-]{36}$/;
const DIRECT_EVIDENCE =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(?:private\.)?(?:json|xml|png)$/;
const PRIVATE_EVIDENCE =
  /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.private\.(?:json|xml|png)$/;
const COMMAND_FILE = /^detox-connection-command-(\d+)\.private\.json$/;
const RESPONSE_FILE = /^detox-connection-response-(\d+)\.private\.json$/;
const CANCEL_FILE = /^detox-connection-cancel-(\d+)\.private\.json$/;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_COMMAND_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const RECOVERY_FILE = "detox-connection-staging-recovery.private.json";
const MAX_RECOVERY_BYTES = 128 * 1024;
const RECOVERY_BUDGET_MS = 30_000;
const ACTIVE_RECOVERY_LEDGER = Symbol("detox-active-recovery-ledger");

export const DETOX_ANDROID_CONNECTION_PUBLIC_STAGING_KIND =
  "private-detox-android-connection-evidence-copy-not-public-outcome" as const;

export type DetoxAndroidConnectionEvidenceFile = Readonly<{
  name: string;
  bytes: number;
  sha256: string;
}>;

export type DetoxAndroidConnectionEvidenceCopyManifest = Readonly<{
  schemaVersion: 1;
  kind: typeof DETOX_ANDROID_CONNECTION_PUBLIC_STAGING_KIND;
  owner: "detox-driver";
  platform: "android";
  engine: "detox";
  requestedRunId: string;
  requestedAttemptId: string;
  captureRoot: string;
  outputRoot: string;
  captureRunId: string;
  backendRunId: string;
  selection: Readonly<{
    scenarioId: string;
    scenarioHash: string;
    requirementHash: string;
    assertionIds: readonly string[];
  }>;
  build: Readonly<{
    sourceTreeHash: string;
    helperInputsHash: string;
    binaryHash: string;
    detoxConfigHash: string;
  }>;
  assertionIds: readonly string[];
  files: readonly DetoxAndroidConnectionEvidenceFile[];
  ledger: readonly Record<string, unknown>[];
  nativePassingCases: 0;
  publicPromotionEligible: false;
}>;

export type DetoxAndroidConnectionEvidenceCopyResult = Readonly<{
  outputRoot: string;
  manifestPath: string;
  manifest: DetoxAndroidConnectionEvidenceCopyManifest;
}>;

export type DetoxAndroidConnectionPublicStagingInput = Readonly<{
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  bridgeResult: DetoxAndroidConnectionPublicBridgeResult;
  build: DetoxBaselineBuildInstrumentation;
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle;
  validateBuild?: (
    build: DetoxBaselineBuildInstrumentation,
    repositoryRoot: string,
  ) => void | Promise<void>;
}>;

export type DetoxAndroidConnectionPublicStagingLifecycle = Readonly<{
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}>;

type OutputNamespace = {
  root: string;
  createdRoot: boolean;
  createdFiles: Set<string>;
};

type RecoveryRecord = {
  schemaVersion: 1;
  kind: "private-detox-android-connection-staging-recovery-not-public-receipt";
  owner: "detox-driver";
  requestedRunId: string;
  requestedAttemptId: string;
  captureRoot: string;
  outputRoot: string;
  createdOutputRoot: boolean;
  status: "in-progress" | "rollback-requested" | "blocked-recovery";
  createdFiles: string[];
  remainingFiles: string[];
  reason?: string;
};

type RollbackResult = Readonly<{
  status: "completed" | "blocked-recovery" | "unknown-recovery";
  remainingFiles: readonly string[];
  recoveryLedgerPath: string | null;
}>;

type RecordValue = Record<string, unknown>;

function record(value: unknown, label: string): RecordValue {
  assert(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as RecordValue;
}

function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function lifecycleFence(
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
  label: string,
): void {
  if (lifecycle.signal.aborted) {
    throw new Error(`Detox staging aborted: ${label}`, {
      cause: lifecycle.signal.reason,
    });
  }
  assert(
    Number.isFinite(lifecycle.deadlineAtMonotonicMs),
    `Detox staging deadline is invalid: ${label}`,
  );
  if (performance.now() >= lifecycle.deadlineAtMonotonicMs) {
    throw new Error(`Detox staging deadline expired: ${label}`);
  }
}

function createRecoveryLifecycle(): DetoxAndroidConnectionPublicStagingLifecycle {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    deadlineAtMonotonicMs: performance.now() + RECOVERY_BUDGET_MS,
  };
}

async function lifecycleAwait<T>(
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
  operation: () => Promise<T>,
  label: string,
): Promise<T> {
  lifecycleFence(lifecycle, `${label}:before`);
  const value = await operation();
  lifecycleFence(lifecycle, `${label}:after`);
  return value;
}

function requireHash(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === "string" && HASH.test(value),
    `${label} must be a SHA-256 hash`,
  );
}

function requireRunId(value: unknown, label: string): asserts value is string {
  assert(
    typeof value === "string" && RUN_ID.test(value),
    `${label} must be a 24-character run ID`,
  );
}

function requirePrivateName(
  value: unknown,
  label: string,
): asserts value is string {
  assert(
    typeof value === "string" && PRIVATE_EVIDENCE.test(value),
    `${label} is unsafe`,
  );
}

function requireDirectName(
  value: unknown,
  label: string,
): asserts value is string {
  assert(
    typeof value === "string" && DIRECT_EVIDENCE.test(value),
    `${label} is unsafe`,
  );
}

function requirePurposePlan(id: string) {
  const purpose = CONNECTION_PURPOSE_PLANS.find((row) => row.id === id);
  assert(purpose, `Unknown Detox connection purpose ${id}`);
  return purpose;
}

function requireAndroidSelection(
  selection: NativePilotSelection,
  requestedRunId: string,
  requestedAttemptId: string,
): void {
  requireRunId(requestedRunId, "Detox requested run ID");
  assert.equal(requestedAttemptId, `${requestedRunId}:first`);
  assert.deepEqual(selection.arguments, {
    platform: "android",
    engine: "detox",
    scenario: "SCN-connection-android",
    mode: "integration",
  });
  assert.equal(selection.scenario.id, "SCN-connection-android");
  assert.equal(selection.scenario.platform, "android");
  assert.equal(selection.scenario.flowId, "FLW-connection");
  assert.equal(selection.scenario.dataMode, "postgres");
  assert.equal(
    selection.scenario.fixtureRef,
    "owned-postgres:SCN-connection-android:fresh-attempt",
  );
  requireHash(selection.scenarioHash, "Detox scenario hash");
  requireHash(selection.requirementHash, "Detox requirement hash");
  assert.deepEqual(
    requireNativePilotAssertions(selection).map((row) => row.id),
    [...nativeConnectionAssertionIds],
  );
}

async function requirePrivateDirectory(
  root: string,
  label: string,
): Promise<string> {
  const resolved = path.resolve(root);
  assert.equal(await realpath(resolved), resolved, `${label} is not canonical`);
  const metadata = await lstat(resolved);
  assert(
    metadata.isDirectory() && !metadata.isSymbolicLink(),
    `${label} is not a directory`,
  );
  assert((metadata.mode & 0o777) === 0o700, `${label} must be mode 0700`);
  if (process.getuid)
    assert.equal(metadata.uid, process.getuid(), `${label} owner changed`);
  return resolved;
}

async function removeNewOutputRoot(root: string): Promise<void> {
  try {
    const canonical = await realpath(root);
    if (canonical !== path.resolve(root)) return;
    const metadata = await lstat(canonical);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return;
    if ((metadata.mode & 0o777) !== 0o700) return;
    if (process.getuid && metadata.uid !== process.getuid()) return;
    if ((await readdir(canonical)).length !== 0) return;
    await rmdir(canonical);
  } catch {
    // A failed safety check deliberately leaves the namespace for recovery.
  }
}

async function ensurePrivateOutputRoot(
  root: string,
  captureRoot: string,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<OutputNamespace> {
  lifecycleFence(lifecycle, "prepare output root");
  const resolved = path.resolve(root);
  assert.notEqual(
    resolved,
    captureRoot,
    "Detox staging output cannot overwrite capture evidence",
  );
  const relative = path.relative(captureRoot, resolved);
  assert(
    relative.startsWith("..") && !path.isAbsolute(relative),
    "Detox staging output cannot be inside the protected capture root",
  );
  const parent = path.dirname(resolved);
  assert.notEqual(parent, resolved, "Detox staging output has no parent");
  assert.equal(
    await realpath(parent),
    parent,
    "Detox staging output parent is not canonical",
  );
  const parentMetadata = await lstat(parent);
  assert(parentMetadata.isDirectory() && !parentMetadata.isSymbolicLink());
  assert(
    (parentMetadata.mode & 0o777) === 0o700,
    "Detox staging output parent must be mode 0700",
  );
  if (process.getuid) assert.equal(parentMetadata.uid, process.getuid());
  if (typeof fsConstants.O_NOFOLLOW !== "number")
    throw new Error("Detox staging output cannot enforce no-follow creation");
  let createdRoot = false;
  try {
    try {
      await mkdir(resolved, { mode: 0o700 });
      createdRoot = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const canonical = await realpath(resolved);
    assert.equal(canonical, resolved, "Detox staging output is not canonical");
    const metadata = await lstat(canonical);
    assert(metadata.isDirectory() && !metadata.isSymbolicLink());
    assert((metadata.mode & 0o777) === 0o700);
    if (process.getuid) assert.equal(metadata.uid, process.getuid());
    assert.deepEqual(
      await readdir(canonical),
      [],
      "Detox staging output must start empty",
    );
    lifecycleFence(lifecycle, "prepared output root");
    return { root: canonical, createdRoot, createdFiles: new Set<string>() };
  } catch (error) {
    if (createdRoot) await removeNewOutputRoot(resolved);
    throw error;
  }
}

async function readOwnedDirectFile(
  root: string,
  name: string,
  maxBytes: number,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<Buffer> {
  lifecycleFence(lifecycle, `read ${name}`);
  await Promise.resolve();
  requireDirectName(name, "Detox direct evidence");
  const file = path.join(root, name);
  assert(
    path.dirname(file) === path.resolve(root),
    "Detox direct evidence escaped its root",
  );
  assert(
    maxBytes > 0 && maxBytes <= MAX_PNG_BYTES,
    "Detox direct evidence limit is invalid",
  );
  const observation = readNativeEvidenceObservation(root, name, true);
  assert(
    observation.bytes.byteLength <= maxBytes,
    "Detox direct evidence size is invalid",
  );
  await Promise.resolve();
  lifecycleFence(lifecycle, `read ${name}:after`);
  return observation.bytes;
}

async function writeOwnedNewFile(
  namespace: OutputNamespace,
  name: string,
  bytes: Buffer,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<void> {
  lifecycleFence(lifecycle, `write ${name}`);
  requireDirectName(name, "Detox output evidence");
  const resolvedRoot = path.resolve(namespace.root);
  const file = path.join(resolvedRoot, name);
  assert(
    path.dirname(file) === resolvedRoot,
    "Detox output evidence escaped its root",
  );
  assert.equal(
    await realpath(resolvedRoot),
    resolvedRoot,
    "Detox output root is not canonical",
  );
  if (typeof fsConstants.O_NOFOLLOW !== "number")
    throw new Error("Detox output cannot enforce no-follow writes");
  const descriptor = await open(
    file,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  namespace.createdFiles.add(name);
  try {
    let offset = 0;
    while (offset < bytes.length) {
      lifecycleFence(lifecycle, `write ${name}:chunk`);
      const result = await descriptor.write(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      assert(
        result.bytesWritten > 0,
        `Detox output write made no progress: ${name}`,
      );
      offset += result.bytesWritten;
    }
    await descriptor.sync();
    lifecycleFence(lifecycle, `write ${name}:after`);
  } finally {
    await descriptor.close();
  }
  lifecycleFence(lifecycle, `write ${name}:closed`);
}

async function writeOwnedExistingFile(
  namespace: OutputNamespace,
  name: string,
  bytes: Buffer,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<void> {
  lifecycleFence(lifecycle, `write existing ${name}:before`);
  requireDirectName(name, "Detox recovery evidence");
  const resolvedRoot = path.resolve(namespace.root);
  const file = path.join(resolvedRoot, name);
  assert(
    path.dirname(file) === resolvedRoot,
    "Detox recovery evidence escaped its root",
  );
  lifecycleFence(lifecycle, `write existing ${name}:root`);
  assert.equal(
    await realpath(resolvedRoot),
    resolvedRoot,
    "Detox recovery root is not canonical",
  );
  lifecycleFence(lifecycle, `write existing ${name}:canonical`);
  const before = await lstat(file);
  assert(
    before.isFile() && !before.isSymbolicLink(),
    "Detox recovery ledger is not a file",
  );
  assert.equal(before.nlink, 1, "Detox recovery ledger link count changed");
  assert.equal(
    before.mode & 0o777,
    0o600,
    "Detox recovery ledger mode changed",
  );
  if (process.getuid) assert.equal(before.uid, process.getuid());
  lifecycleFence(lifecycle, `write existing ${name}:owned`);
  const descriptor = await open(
    file,
    fsConstants.O_WRONLY | fsConstants.O_TRUNC | fsConstants.O_NOFOLLOW,
  );
  try {
    let offset = 0;
    while (offset < bytes.length) {
      lifecycleFence(lifecycle, `write existing ${name}:chunk`);
      const result = await descriptor.write(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      assert(
        result.bytesWritten > 0,
        `Detox recovery write made no progress: ${name}`,
      );
      offset += result.bytesWritten;
    }
    await descriptor.sync();
    lifecycleFence(lifecycle, `write existing ${name}:synced`);
  } finally {
    await descriptor.close();
  }
  lifecycleFence(lifecycle, `write existing ${name}:closed`);
  const after = await lstat(file);
  assert(after.isFile() && !after.isSymbolicLink());
  assert.equal(after.nlink, 1);
  assert.equal(after.mode & 0o777, 0o600);
  if (process.getuid) assert.equal(after.uid, process.getuid());
  lifecycleFence(lifecycle, `write existing ${name}:after`);
}

async function readPrivateJson(
  root: string,
  name: string,
  maxBytes: number,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<RecordValue> {
  requirePrivateName(name, "Detox private evidence");
  const bytes = await readOwnedPrivateFile(root, name, maxBytes, lifecycle);
  try {
    return record(
      JSON.parse(bytes.toString("utf8")),
      `Detox private file ${name}`,
    );
  } catch (error) {
    throw new Error(`Detox private file ${name} is not valid JSON`, {
      cause: error,
    });
  }
}

async function readOwnedPrivateFile(
  root: string,
  name: string,
  maxBytes: number,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<Buffer> {
  lifecycleFence(lifecycle, `read ${name}`);
  const bytes = await readOwnedDetoxPrivateFile(root, name, maxBytes);
  lifecycleFence(lifecycle, `read ${name}:after`);
  return bytes;
}

function requireLoopbackOrigin(
  value: unknown,
  label: string,
): asserts value is string {
  assert(
    typeof value === "string" && /^http:\/\/127\.0\.0\.1:\d+$/.test(value),
    `${label} invalid`,
  );
}

function requireChildIdentity(
  value: unknown,
  label: string,
): DetoxConnectionOwnedProcessIdentity {
  const row = record(value, label);
  assert(
    Number.isSafeInteger(row.pid) && Number(row.pid) > 1,
    `${label} PID invalid`,
  );
  assert(
    Number.isSafeInteger(row.pgid) && Number(row.pgid) > 1,
    `${label} PGID invalid`,
  );
  assert(
    typeof row.started === "string" && row.started.length > 0,
    `${label} start invalid`,
  );
  return {
    pid: Number(row.pid),
    pgid: Number(row.pgid),
    started: String(row.started),
  };
}

function expectedObservationLabels(): readonly string[] {
  return [
    "connection-coach-invite",
    "connection-normal-coach-pending",
    "connection-normal-coach-roster",
    "connection-student-entry",
    "connection-submit",
    "connection-student-pending",
    "connection-coach-pending-roster",
    "connection-coach-no-active-roster",
    "connection-coach-return-home",
    "connection-coach-pending",
    "connection-confirm",
    "connection-student-active",
    "connection-coach-roster",
  ];
}

async function validateCommandFiles(
  captureRoot: string,
  commands: readonly DetoxConnectionCommand[],
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<Set<string>> {
  lifecycleFence(lifecycle, "read command census");
  const names = await readdir(captureRoot);
  const commandFiles = names.filter((name) => COMMAND_FILE.test(name));
  const responseFiles = names.filter((name) => RESPONSE_FILE.test(name));
  const cancelFiles = names.filter((name) => CANCEL_FILE.test(name));
  assert.equal(
    cancelFiles.length,
    0,
    "A completed Detox capture retained a cancellation envelope",
  );
  assert(commandFiles.length > 0, "Detox command evidence is missing");
  assert.equal(
    commandFiles.length,
    responseFiles.length,
    "Detox command/response cardinality changed",
  );
  const commandsById = new Map<number, DetoxConnectionCommand>();
  for (const command of commands) {
    assert(
      !commandsById.has(command.commandId),
      "Detox report contains duplicate command IDs",
    );
    commandsById.set(command.commandId, command);
  }
  const retained = new Set<string>();
  for (const commandName of commandFiles) {
    const command = requireDetoxConnectionCommand(
      await readPrivateJson(
        captureRoot,
        commandName,
        MAX_COMMAND_BYTES,
        lifecycle,
      ),
    );
    assert.equal(command.platform, "android");
    const responseName = `detox-connection-response-${command.commandId}.private.json`;
    assert(
      responseFiles.includes(responseName),
      `Detox response for command ${command.commandId} is missing`,
    );
    const response = await readPrivateJson(
      captureRoot,
      responseName,
      MAX_RESPONSE_BYTES,
      lifecycle,
    );
    assert.equal(response.kind, "private-detox-connection-response");
    assert.equal(response.commandId, command.commandId);
    assert.equal(response.commandHash, command.commandHash);
    assert.equal(response.commandKind, command.kind);
    assert.equal(response.platform, command.platform);
    assert.equal(response.status, "completed");
    assert(Array.isArray(response.observations));
    if (command.kind === "shutdown")
      assert.equal(response.observations.length, 0);
    else assert.equal(response.observations.length, 1);
    if (commandsById.has(command.commandId)) {
      const expected = commandsById.get(command.commandId)!;
      assert.deepEqual(
        command,
        expected,
        `Detox command ${command.commandId} changed after capture`,
      );
    } else {
      assert.equal(
        command.kind,
        "shutdown",
        "Unbound Detox command was retained",
      );
    }
    retained.add(commandName);
    retained.add(responseName);
  }
  lifecycleFence(lifecycle, "validated command census");
  assert.equal(
    [...commandsById.keys()].every((id) =>
      commandFiles.includes(`detox-connection-command-${id}.private.json`),
    ),
    true,
    "A reported Detox command file is missing",
  );
  return retained;
}

async function validateOriginalReport(
  input: DetoxAndroidConnectionPublicStagingInput,
  captureRoot: string,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<{
  report: RecordValue;
  files: readonly string[];
  ledger: readonly RecordValue[];
  backendRunId: string;
}> {
  lifecycleFence(lifecycle, "validate original report");
  const bridge = input.bridgeResult;
  assert.equal(bridge.owner, "detox-driver");
  assert.equal(bridge.engine, "detox");
  assert.equal(bridge.platform, "android");
  assert.equal(bridge.requestedRunId, input.requestedRunId);
  assert.equal(bridge.requestedAttemptId, input.requestedAttemptId);
  assert.equal(bridge.nativePassingCases, 0);
  assert.equal(bridge.publicPromotionEligible, false);
  const attempt = bridge.attempt;
  assert.equal(attempt.status, "source-only");
  assert.equal(attempt.acquired, true);
  assert.equal(attempt.cleanup, "cleaned");
  assert.equal(attempt.recoveryStatus, "verified");
  assert.equal(attempt.report !== null, true);
  const report = record(attempt.report, "Detox producer report");
  assert.equal(
    report.kind,
    "private-detox-connection-capture-not-public-receipt",
  );
  assert.equal(report.output, captureRoot);
  assert.deepEqual(report.selection, input.selection);
  assert.equal(report.nativePassingCases, 0);
  assert.equal(report.publicPromotionEligible, false);
  requireAndroidSelection(
    input.selection,
    input.requestedRunId,
    input.requestedAttemptId,
  );

  const child = requireChildIdentity(
    report.detoxChildIdentity,
    "Detox child identity",
  );
  const childFile = "detox-connection-child-identity.private.json";
  const childRecord = await readPrivateJson(
    captureRoot,
    childFile,
    64 * 1024,
    lifecycle,
  );
  assert.equal(childRecord.kind, "private-detox-connection-child-identity");
  assert.deepEqual(
    requireChildIdentity(childRecord, "Detox child evidence"),
    child,
    "Detox child evidence changed after report publication",
  );

  const producer = record(
    report.detoxProducerReceipt,
    "Detox producer receipt",
  );
  assert.equal(producer.kind, "private-detox-connection-producer-receipt");
  assert.equal(producer.captureRunId, input.requestedRunId);
  assert.equal(producer.platform, "android");
  requireHash(producer.sourceTreeHash, "Detox producer source tree hash");
  requireHash(producer.helperInputsHash, "Detox producer helper hash");
  assert.equal(producer.sourceTreeHash, input.build.source.sourceTreeHash);
  assert.equal(producer.helperInputsHash, input.build.helperInputsHash);

  const backend = record(report.backend, "Detox backend identity");
  const api = record(report.connectionApiIdentity, "Detox API identity");
  requireLoopbackOrigin(backend.apiOrigin, "Detox backend origin");
  requireLoopbackOrigin(api.targetOrigin, "Detox API origin");
  assert.equal(backend.apiOrigin, api.targetOrigin);
  assert(Number.isSafeInteger(backend.apiPid) && Number(backend.apiPid) > 1);
  assert.equal(backend.apiPid, api.apiPid);
  requireRunId(backend.runId, "Detox backend run ID");
  assert(
    typeof backend.manifestArtifactRoot === "string" &&
      backend.manifestArtifactRoot.length > 0,
  );
  const backendRunId = String(backend.runId);

  const build = record(report.build, "Detox report build");
  assert.equal(build.platform, input.build.platform);
  assert.equal(build.configuration, input.build.configuration);
  assert.equal(build.binaryHash, input.build.binaryHash);
  assert.equal(build.helperInputsHash, input.build.helperInputsHash);
  assert.equal(build.detoxConfigHash, input.build.detoxConfigHash);
  const prep = record(
    report.connectionJourneyPreparation,
    "Detox connection preparation",
  );
  assert.equal(prep.nativePassingCases, 0);
  const binding = record(prep.binding, "Detox connection binding");
  const boundSelection = record(binding.selection, "Detox bound selection");
  assert.deepEqual(boundSelection.arguments, input.selection.arguments);
  assert.equal(boundSelection.scenarioHash, input.selection.scenarioHash);
  assert.equal(boundSelection.requirementHash, input.selection.requirementHash);
  assert.deepEqual(binding.assertionIds, [...nativeConnectionAssertionIds]);
  assert.equal(prep.isolationUnchanged, true);
  assert.equal(prep.trainingPlansUnchanged, true);
  const connectionId = prep.connectionId;
  assert(typeof connectionId === "string" && UUID.test(connectionId));

  const transportSource = report.detoxTransportSource;
  assert(Array.isArray(transportSource) && transportSource.length > 0);
  const transportBytes = Buffer.from(JSON.stringify(transportSource));
  requireHash(report.detoxTransportSourceHash, "Detox transport hash");
  assert.equal(report.detoxTransportSourceHash, hashJson(transportSource));
  const sourceReceipt = record(
    report.detoxTransportSourceReceipt,
    "Detox transport source receipt",
  );
  assert.equal(
    sourceReceipt.path,
    "detox-connection-transport-source.private.json",
  );
  assert.equal(sourceReceipt.sourceBytes, transportBytes.byteLength);
  assert.equal(sourceReceipt.sourceSha256, hashBytes(transportBytes));
  const sourceFile = await readOwnedPrivateFile(
    captureRoot,
    sourceReceipt.path,
    MAX_JSON_BYTES,
    lifecycle,
  );
  assert.deepEqual(sourceFile, transportBytes);
  for (const row of transportSource as RecordValue[]) {
    assert(Number.isSafeInteger(row.requestId) && Number(row.requestId) > 0);
    assert(typeof row.method === "string" && /^[A-Z]+$/.test(row.method));
    requireHash(row.pathHash, "Detox transport path hash");
    assert.equal(row.requestProfile, "native");
    assert.equal(row.targetOrigin, api.targetOrigin);
    assert(Number.isSafeInteger(row.status));
    assert.equal(row.outcome, "forwarded");
    assert.equal(row.requestOrigin, null);
    assert.equal(row.faultAttemptId, null);
    assert(typeof row.elapsedMs === "number" && row.elapsedMs >= 0);
  }

  const windows = prep.transportWindows;
  assert(Array.isArray(windows) && windows.length >= 9);
  const requiredWindows = [
    ["POST", "/connections/invite-submissions", 201, true],
    ["POST", `/connections/${connectionId}/confirm`, 200, true],
    ["GET", "/connections", 200, false],
    ["GET", "/professional/students", 200, false],
  ] as const;
  for (const [method, route, status, unique] of requiredWindows) {
    assert(
      (windows as RecordValue[]).some(
        (window) =>
          window.method === method &&
          window.route === route &&
          window.status === status &&
          window.unique === unique,
      ),
      `Detox transport window ${method} ${route} is missing`,
    );
    const matchingWindow: RecordValue = (windows as RecordValue[]).find(
      (candidate) =>
        candidate.method === method &&
        candidate.route === route &&
        candidate.status === status &&
        candidate.unique === unique,
    )!;
    assert(
      requireNativeConnectionTransport({
        observations: transportSource as never,
        method,
        route,
        status,
        targetOrigin: String(api.targetOrigin),
        afterRequestId: Number(matchingWindow.afterRequestId),
        throughRequestId: Number(matchingWindow.throughRequestId),
        unique,
      }).length > 0,
      `Detox transport rows do not bind ${method} ${route}`,
    );
  }

  const snapshots = record(prep.snapshots, "Detox SQL snapshots");
  const snapshotNames: string[] = [];
  assert.equal(Object.keys(snapshots).length, 12);
  for (const [label, raw] of Object.entries(snapshots)) {
    const row = record(raw, `Detox snapshot ${label}`);
    requirePrivateName(row.path, `Detox snapshot ${label}`);
    requireHash(row.sha256, `Detox snapshot ${label} hash`);
    const bytes = await readOwnedPrivateFile(
      captureRoot,
      row.path,
      MAX_JSON_BYTES,
      lifecycle,
    );
    assert.equal(
      hashBytes(bytes),
      row.sha256,
      `Detox snapshot ${label} changed`,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8"));
    } catch (error) {
      throw new Error(`Detox snapshot ${label} is not JSON`, { cause: error });
    }
    requireConnectionSnapshot(parsed, { runId: backendRunId });
    snapshotNames.push(String(row.path));
  }

  const commands = report.detoxConnectionCommands;
  const observations = report.detoxConnectionObservations;
  assert(Array.isArray(commands) && Array.isArray(observations));
  assert.equal(commands.length, observations.length);
  const commandByLabel = new Map<string, DetoxConnectionCommand>();
  const observationByLabel = new Map<
    string,
    DetoxConnectionObservationReceipt
  >();
  const evidenceNames: string[] = [
    childFile,
    String(sourceReceipt.path),
    ...snapshotNames,
  ];
  for (const raw of commands) {
    const command = requireDetoxConnectionCommand(raw);
    assert.equal(command.platform, "android");
    assert(!commandByLabel.has(command.label));
    commandByLabel.set(command.label, command);
    const commandName = `detox-connection-command-${command.commandId}.private.json`;
    const commandBytes = await readOwnedPrivateFile(
      captureRoot,
      commandName,
      MAX_COMMAND_BYTES,
      lifecycle,
    );
    assert.deepEqual(JSON.parse(commandBytes.toString("utf8")), command);
    evidenceNames.push(commandName);
  }
  for (const raw of observations) {
    const observation = record(
      raw,
      "Detox observation",
    ) as unknown as DetoxConnectionObservationReceipt;
    assert(!observationByLabel.has(observation.label));
    const command = commandByLabel.get(observation.label);
    assert(command, `Detox observation ${observation.label} has no command`);
    await requireDetoxConnectionObservation(
      captureRoot,
      command,
      observation,
      child,
    );
    const sourceReceipt = record(
      record(observation.sourceReceipts, "Detox observation source receipts")
        .screenshot,
      "Detox screenshot source receipt",
    );
    assert(typeof sourceReceipt.capturedCopyFile === "string");
    requireDirectName(
      sourceReceipt.capturedCopyFile,
      "Detox retained producer screenshot",
    );
    observationByLabel.set(observation.label, observation);
    for (const name of [
      observation.xmlFile,
      observation.screenshotFile,
      observation.attributesBeforeFile,
      observation.attributesAfterFile,
      `${observation.label}.png`,
      `${observation.label}-hierarchy.json`,
      sourceReceipt.capturedCopyFile,
    ]) {
      requireDirectName(
        name,
        `Detox observation ${observation.label} evidence`,
      );
      evidenceNames.push(name);
      const bytes = await readOwnedDirectFile(
        captureRoot,
        name,
        name.endsWith(".png") ? MAX_PNG_BYTES : MAX_JSON_BYTES,
        lifecycle,
      );
      assert(bytes.byteLength > 0);
      if (name.endsWith(".png"))
        requireDetoxPngBytes(bytes, `Detox projected screenshot ${name}`);
    }
  }
  assert.deepEqual(
    [...observationByLabel.keys()].sort(),
    [...expectedObservationLabels()].sort(),
    "Detox complete staging requires every actual UI observation label",
  );

  const ledgerRaw = report.detoxConnectionLedger;
  assert(Array.isArray(ledgerRaw));
  assert.equal(ledgerRaw.length, nativeConnectionAssertionIds.length);
  const ledger = ledgerRaw.map((raw, index) => {
    const row = record(raw, `Detox ledger row ${index}`);
    const purpose = requirePurposePlan(
      String(nativeConnectionAssertionIds[index]),
    );
    assert.equal(row.id, purpose.id);
    assert.equal(row.actor, purpose.actor);
    assert.equal(row.navigation, purpose.navigation);
    assert.equal(row.status, "passed");
    assert.deepEqual(row.evidenceKinds, purpose.requiredEvidence);
    assert.equal(row.bound, true);
    const labels = row.observationLabels;
    assert(Array.isArray(labels));
    for (const label of labels) assert(observationByLabel.has(String(label)));
    return row;
  });

  const cleanupName = "detox-connection-cleanup.private.json";
  const cleanup = await readPrivateJson(
    captureRoot,
    cleanupName,
    MAX_JSON_BYTES,
    lifecycle,
  );
  assert.equal(cleanup.kind, "private-detox-connection-cleanup");
  assert.equal(cleanup.captureRunId, input.requestedRunId);
  assert.equal(cleanup.backendRunId, backendRunId);
  assert.equal(cleanup.status, "cleaned");
  assert.equal(cleanup.recoveryStatus, "verified");
  assert.deepEqual(cleanup.failures, []);
  const childOutcome = record(
    cleanup.child,
    "Detox cleanup child evidence",
  ).outcome;
  assert.equal(record(childOutcome, "Detox cleanup child outcome").code, 0);
  assert.equal(
    record(childOutcome, "Detox cleanup child outcome").signal,
    null,
  );
  evidenceNames.push(cleanupName);

  const readyName = "detox-connection-ready.private.json";
  try {
    const ready = await readPrivateJson(
      captureRoot,
      readyName,
      64 * 1024,
      lifecycle,
    );
    assert.equal(ready.kind, "private-detox-connection-ready");
    assert.deepEqual(
      requireChildIdentity(ready.childIdentity, "Detox ready child"),
      child,
    );
    evidenceNames.push(readyName);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const commandEvidence = await validateCommandFiles(
    captureRoot,
    commands,
    lifecycle,
  );
  evidenceNames.push(...commandEvidence);
  return {
    report,
    files: [...new Set(evidenceNames)].sort(),
    ledger,
    backendRunId,
  };
}

async function copyProtectedFiles(
  captureRoot: string,
  namespace: OutputNamespace,
  names: readonly string[],
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<readonly DetoxAndroidConnectionEvidenceFile[]> {
  const files: DetoxAndroidConnectionEvidenceFile[] = [];
  for (const name of names) {
    lifecycleFence(lifecycle, `copy ${name}:before`);
    requireDirectName(name, "Detox copy file");
    const bytes = await readOwnedDirectFile(
      captureRoot,
      name,
      name.endsWith(".png")
        ? MAX_PNG_BYTES
        : name.startsWith("detox-connection-response-")
          ? MAX_RESPONSE_BYTES
          : MAX_JSON_BYTES,
      lifecycle,
    );
    await writeOwnedNewFile(namespace, name, bytes, lifecycle);
    const copied = await readOwnedDirectFile(
      namespace.root,
      name,
      name.endsWith(".png")
        ? MAX_PNG_BYTES
        : name.startsWith("detox-connection-response-")
          ? MAX_RESPONSE_BYTES
          : MAX_JSON_BYTES,
      lifecycle,
    );
    assert.deepEqual(copied, bytes, `Detox staged evidence changed: ${name}`);
    files.push({ name, bytes: bytes.byteLength, sha256: hashBytes(bytes) });
    lifecycleFence(lifecycle, `copy ${name}:after`);
  }
  return files;
}

async function validateBuildAgain(
  input: DetoxAndroidConnectionPublicStagingInput,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<void> {
  lifecycleFence(lifecycle, "validate build");
  requireDetoxBuildInstrumentation(input.build, input.repositoryRoot);
  if (input.validateBuild)
    await input.validateBuild(input.build, input.repositoryRoot);
  else
    await inspectDetoxBuildInstrumentation({
      repositoryRoot: input.repositoryRoot,
      build: input.build,
    });
  lifecycleFence(lifecycle, "validate build:after");
}

function requireBridgeSelection(
  input: DetoxAndroidConnectionPublicStagingInput,
): void {
  requireAndroidSelection(
    input.selection,
    input.requestedRunId,
    input.requestedAttemptId,
  );
  assert.deepEqual(
    input.bridgeResult.selection.arguments,
    input.selection.arguments,
  );
  assert.equal(
    input.bridgeResult.selection.scenarioId,
    input.selection.scenario.id,
  );
  assert.equal(
    input.bridgeResult.selection.scenarioHash,
    input.selection.scenarioHash,
  );
  assert.equal(
    input.bridgeResult.selection.requirementHash,
    input.selection.requirementHash,
  );
  assert.deepEqual(input.bridgeResult.selection.assertionIds, [
    ...nativeConnectionAssertionIds,
  ]);
  assert.deepEqual(input.bridgeResult.declaredBuildIdentity, {
    sourceTreeHash: input.build.source.sourceTreeHash,
    helperInputsHash: input.build.helperInputsHash,
    binaryHash: input.build.binaryHash,
    detoxConfigHash: input.build.detoxConfigHash,
  });
}

function recoveryRecord(
  input: DetoxAndroidConnectionPublicStagingInput,
  namespace: OutputNamespace,
  captureRoot: string,
  status: RecoveryRecord["status"],
  remainingFiles: readonly string[],
  reason?: string,
  createdFiles: readonly string[] = [...namespace.createdFiles],
): RecoveryRecord {
  return {
    schemaVersion: 1,
    kind: "private-detox-android-connection-staging-recovery-not-public-receipt",
    owner: "detox-driver",
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    captureRoot,
    outputRoot: namespace.root,
    createdOutputRoot: namespace.createdRoot,
    status,
    createdFiles: [...createdFiles].sort(),
    remainingFiles: [...remainingFiles].sort(),
    ...(reason ? { reason } : {}),
  };
}

async function recoveryLedgerIsOwned(
  namespace: OutputNamespace,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<boolean> {
  lifecycleFence(lifecycle, "inspect recovery ledger");
  const file = path.join(path.resolve(namespace.root), RECOVERY_FILE);
  if (path.dirname(file) !== path.resolve(namespace.root)) return false;
  try {
    if ((await realpath(file)) !== file) return false;
    lifecycleFence(lifecycle, "inspect recovery ledger:canonical");
    const metadata = await lstat(file);
    lifecycleFence(lifecycle, "inspect recovery ledger:stat");
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o777) !== 0o600 ||
      (process.getuid !== undefined && metadata.uid !== process.getuid())
    )
      return false;
    lifecycleFence(lifecycle, "inspect recovery ledger:after");
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeRecoveryLedger(
  input: DetoxAndroidConnectionPublicStagingInput,
  namespace: OutputNamespace,
  captureRoot: string,
  status: RecoveryRecord["status"],
  remainingFiles: readonly string[],
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
  reason?: string,
): Promise<void> {
  lifecycleFence(lifecycle, "write recovery ledger");
  const bytes = Buffer.from(
    JSON.stringify(
      recoveryRecord(
        input,
        namespace,
        captureRoot,
        status,
        remainingFiles,
        reason,
      ),
      null,
      2,
    ) + "\n",
  );
  assert(
    bytes.byteLength <= MAX_RECOVERY_BYTES,
    "Detox recovery ledger is too large",
  );
  await writeOwnedExistingFile(namespace, RECOVERY_FILE, bytes, lifecycle);
}

async function removeOwnedOutputFile(
  namespace: OutputNamespace,
  name: string,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
  allowMissing = true,
): Promise<boolean> {
  lifecycleFence(lifecycle, `remove ${name}:before`);
  requireDirectName(name, "Detox recovery file");
  const file = path.join(namespace.root, name);
  if (path.dirname(file) !== path.resolve(namespace.root)) return false;
  try {
    const metadata = await lstat(file);
    lifecycleFence(lifecycle, `remove ${name}:stat`);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.nlink !== 1 ||
      (metadata.mode & 0o777) !== 0o600 ||
      (process.getuid !== undefined && metadata.uid !== process.getuid())
    )
      return false;
    if ((await realpath(file)) !== file) return false;
    lifecycleFence(lifecycle, `remove ${name}:owned`);
    await unlink(file);
    lifecycleFence(lifecycle, `remove ${name}:unlinked`);
    try {
      await lstat(file);
      return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return false;
    }
    lifecycleFence(lifecycle, `remove ${name}:after`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return allowMissing;
    return false;
  }
}

async function removeOwnedEmptyRoot(
  root: string,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<boolean> {
  lifecycleFence(lifecycle, "remove output root:before");
  try {
    const resolved = path.resolve(root);
    if ((await realpath(resolved)) !== resolved) return false;
    lifecycleFence(lifecycle, "remove output root:canonical");
    const metadata = await lstat(resolved);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o777) !== 0o700 ||
      (process.getuid !== undefined && metadata.uid !== process.getuid())
    )
      return false;
    lifecycleFence(lifecycle, "remove output root:owned");
    if ((await readdir(resolved)).length !== 0) return false;
    lifecycleFence(lifecycle, "remove output root:empty");
    await rmdir(resolved);
    lifecycleFence(lifecycle, "remove output root:after");
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function rollbackOutputNamespace(
  input: DetoxAndroidConnectionPublicStagingInput,
  namespace: OutputNamespace,
  captureRoot: string,
  reason: string,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<RollbackResult> {
  const recoveryLedgerPath = path.join(namespace.root, RECOVERY_FILE);
  lifecycleFence(lifecycle, "rollback start");
  if (namespace.createdFiles.size === 0) {
    if (!namespace.createdRoot) {
      return {
        status: "completed",
        remainingFiles: [],
        recoveryLedgerPath: null,
      };
    }
    let removed = false;
    try {
      removed = await removeOwnedEmptyRoot(namespace.root, lifecycle);
    } catch (error) {
      reason = `${reason}; empty-root-removal:${error instanceof Error ? error.message : String(error)}`;
    }
    if (removed)
      return {
        status: "completed",
        remainingFiles: [],
        recoveryLedgerPath: null,
      };

    try {
      const remainingFiles = [RECOVERY_FILE];
      const bytes = Buffer.from(
        JSON.stringify(
          recoveryRecord(
            input,
            namespace,
            captureRoot,
            "blocked-recovery",
            remainingFiles,
            reason,
            remainingFiles,
          ),
          null,
          2,
        ) + "\n",
      );
      assert(
        bytes.byteLength <= MAX_RECOVERY_BYTES,
        "Detox recovery ledger is too large",
      );
      await writeOwnedNewFile(namespace, RECOVERY_FILE, bytes, lifecycle);
      if (await recoveryLedgerIsOwned(namespace, lifecycle)) {
        return {
          status: "blocked-recovery",
          remainingFiles,
          recoveryLedgerPath,
        };
      }
    } catch (error) {
      reason = `${reason}; recovery-ledger:${error instanceof Error ? error.message : String(error)}`;
    }
    return {
      status: "unknown-recovery",
      remainingFiles: [],
      recoveryLedgerPath: null,
    };
  }
  const failures: string[] = [];
  try {
    await writeRecoveryLedger(
      input,
      namespace,
      captureRoot,
      "rollback-requested",
      [],
      lifecycle,
      reason,
    );
  } catch (error) {
    failures.push(
      `ledger-update:${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const name of [...namespace.createdFiles].sort()) {
    if (name === RECOVERY_FILE) continue;
    try {
      if (await removeOwnedOutputFile(namespace, name, lifecycle, true))
        namespace.createdFiles.delete(name);
      else failures.push(name);
    } catch (error) {
      failures.push(
        `${name}:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const remaining = [...namespace.createdFiles].sort();
  if (
    failures.length === 0 &&
    remaining.length === 1 &&
    remaining[0] === RECOVERY_FILE
  ) {
    try {
      await writeRecoveryLedger(
        input,
        namespace,
        captureRoot,
        "rollback-requested",
        [],
        lifecycle,
        reason,
      );
    } catch (error) {
      failures.push(
        `ledger-finalize:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (failures.length === 0) {
      try {
        if (
          await removeOwnedOutputFile(
            namespace,
            RECOVERY_FILE,
            lifecycle,
            false,
          )
        )
          namespace.createdFiles.delete(RECOVERY_FILE);
        else failures.push(RECOVERY_FILE);
      } catch (error) {
        failures.push(
          `recovery-ledger:${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  if (
    failures.length === 0 &&
    namespace.createdRoot &&
    namespace.createdFiles.size === 0
  ) {
    try {
      if (!(await removeOwnedEmptyRoot(namespace.root, lifecycle)))
        failures.push(namespace.root);
    } catch (error) {
      failures.push(
        `root:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const finalRemaining = [...namespace.createdFiles].sort();
  if (failures.length > 0 || finalRemaining.length > 0) {
    try {
      await writeRecoveryLedger(
        input,
        namespace,
        captureRoot,
        "blocked-recovery",
        finalRemaining,
        lifecycle,
        `${reason}; ${failures.join(", ") || "ownership could not be verified"}`,
      );
    } catch (error) {
      failures.push(
        `ledger-blocked:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      if (await recoveryLedgerIsOwned(namespace, lifecycle)) {
        return {
          status: "blocked-recovery",
          remainingFiles: finalRemaining,
          recoveryLedgerPath,
        };
      }
    } catch (error) {
      failures.push(
        `ledger-inspect:${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return {
      status: "unknown-recovery",
      remainingFiles: finalRemaining,
      recoveryLedgerPath: null,
    };
  }
  return { status: "completed", remainingFiles: [], recoveryLedgerPath: null };
}

async function discardRecoveryLedger(
  namespace: OutputNamespace,
  lifecycle: DetoxAndroidConnectionPublicStagingLifecycle,
): Promise<void> {
  lifecycleFence(lifecycle, "remove recovery ledger");
  if (!namespace.createdFiles.has(RECOVERY_FILE)) return;
  assert(
    await removeOwnedOutputFile(namespace, RECOVERY_FILE, lifecycle, false),
    "Detox recovery ledger could not be removed",
  );
  namespace.createdFiles.delete(RECOVERY_FILE);
  lifecycleFence(lifecycle, "remove recovery ledger:after");
}

export async function stageAndroidDetoxConnectionPublicEvidence(
  input: DetoxAndroidConnectionPublicStagingInput,
): Promise<DetoxAndroidConnectionEvidenceCopyResult> {
  const lifecycle = input.lifecycle;
  lifecycleFence(lifecycle, "stage start");
  const captureRoot = await lifecycleAwait(
    lifecycle,
    () => requirePrivateDirectory(input.captureRoot, "Detox capture root"),
    "capture root",
  );
  requireBridgeSelection(input);
  await validateBuildAgain(input, lifecycle);
  const original = await validateOriginalReport(input, captureRoot, lifecycle);
  const namespace = await ensurePrivateOutputRoot(
    input.outputRoot,
    captureRoot,
    lifecycle,
  );
  try {
    const recovery = {
      schemaVersion: 1 as const,
      kind: "private-detox-android-connection-staging-recovery-not-public-receipt" as const,
      owner: "detox-driver" as const,
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      captureRoot,
      outputRoot: namespace.root,
      createdOutputRoot: namespace.createdRoot,
      status: "in-progress" as const,
      createdFiles: [] as string[],
      remainingFiles: [] as string[],
    } satisfies RecoveryRecord;
    await writeOwnedNewFile(
      namespace,
      RECOVERY_FILE,
      Buffer.from(`${JSON.stringify(recovery, null, 2)}\n`),
      lifecycle,
    );
    await writeRecoveryLedger(
      input,
      namespace,
      captureRoot,
      "in-progress",
      [],
      lifecycle,
    );
    const files = await copyProtectedFiles(
      captureRoot,
      namespace,
      original.files,
      lifecycle,
    );
    await writeRecoveryLedger(
      input,
      namespace,
      captureRoot,
      "in-progress",
      [],
      lifecycle,
    );
    const manifest: DetoxAndroidConnectionEvidenceCopyManifest = {
      schemaVersion: 1,
      kind: DETOX_ANDROID_CONNECTION_PUBLIC_STAGING_KIND,
      owner: "detox-driver",
      platform: "android",
      engine: "detox",
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      captureRoot,
      outputRoot: namespace.root,
      captureRunId: input.requestedRunId,
      backendRunId: original.backendRunId,
      selection: {
        scenarioId: input.selection.scenario.id,
        scenarioHash: input.selection.scenarioHash,
        requirementHash: input.selection.requirementHash,
        assertionIds: [...nativeConnectionAssertionIds],
      },
      build: {
        sourceTreeHash: input.build.source.sourceTreeHash,
        helperInputsHash: input.build.helperInputsHash,
        binaryHash: input.build.binaryHash,
        detoxConfigHash: input.build.detoxConfigHash,
      },
      assertionIds: [...nativeConnectionAssertionIds],
      files,
      ledger: original.ledger,
      nativePassingCases: 0,
      publicPromotionEligible: false,
    };
    const manifestName = "detox-connection-evidence-copy.private.json";
    const manifestPath = path.join(namespace.root, manifestName);
    await writeOwnedNewFile(
      namespace,
      manifestName,
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
      lifecycle,
    );
    await validateBuildAgain(input, lifecycle);
    await verifyStagedAndroidDetoxConnectionPublicEvidence({
      ...input,
      outputRoot: namespace.root,
      copyManifest: manifest,
      [ACTIVE_RECOVERY_LEDGER]: true,
    });
    lifecycleFence(lifecycle, "stage prepublication");
    await discardRecoveryLedger(namespace, lifecycle);
    lifecycleFence(lifecycle, "stage published");
    return { outputRoot: namespace.root, manifestPath, manifest };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    let recovery: RollbackResult;
    try {
      recovery = await rollbackOutputNamespace(
        input,
        namespace,
        captureRoot,
        reason,
        createRecoveryLifecycle(),
      );
    } catch (recoveryError) {
      throw new Error(
        "Detox staging failed; recovery status is unknown and no recovery ledger was published",
        { cause: recoveryError },
      );
    }
    if (
      recovery.status === "blocked-recovery" &&
      recovery.recoveryLedgerPath !== null
    ) {
      throw new Error(
        `Detox staging failed and left a blocked recovery ledger at ${recovery.recoveryLedgerPath}`,
        { cause: error },
      );
    }
    if (recovery.status === "unknown-recovery") {
      throw new Error(
        "Detox staging failed; recovery status is unknown and no recovery ledger was published",
        { cause: error },
      );
    }
    throw error;
  }
}

export type DetoxAndroidConnectionStagedVerificationInput =
  DetoxAndroidConnectionPublicStagingInput &
    Readonly<{
      copyManifest: DetoxAndroidConnectionEvidenceCopyManifest;
      [ACTIVE_RECOVERY_LEDGER]?: true;
    }>;

export async function verifyStagedAndroidDetoxConnectionPublicEvidence(
  input: DetoxAndroidConnectionStagedVerificationInput,
): Promise<void> {
  const lifecycle = input.lifecycle;
  lifecycleFence(lifecycle, "verify start");
  const captureRoot = await lifecycleAwait(
    lifecycle,
    () => requirePrivateDirectory(input.captureRoot, "Detox capture root"),
    "capture root",
  );
  const outputRoot = await lifecycleAwait(
    lifecycle,
    () => requirePrivateDirectory(input.outputRoot, "Detox staging output"),
    "staging output root",
  );
  const outputNames = await lifecycleAwait(
    lifecycle,
    () => readdir(outputRoot),
    "staging output census",
  );
  assert(
    input[ACTIVE_RECOVERY_LEDGER] === true ||
      !outputNames.includes(RECOVERY_FILE),
    "Detox staging has an unresolved recovery ledger",
  );
  requireBridgeSelection(input);
  await validateBuildAgain(input, lifecycle);
  const manifest = input.copyManifest;
  assert.equal(manifest.kind, DETOX_ANDROID_CONNECTION_PUBLIC_STAGING_KIND);
  assert.equal(manifest.captureRoot, captureRoot);
  assert.equal(manifest.outputRoot, outputRoot);
  assert.equal(manifest.requestedRunId, input.requestedRunId);
  assert.equal(manifest.requestedAttemptId, input.requestedAttemptId);
  assert.deepEqual(manifest.assertionIds, [...nativeConnectionAssertionIds]);
  assert.equal(manifest.nativePassingCases, 0);
  assert.equal(manifest.publicPromotionEligible, false);
  const original = await validateOriginalReport(input, captureRoot, lifecycle);
  assert.deepEqual(
    manifest.files.map((file) => file.name).sort(),
    [...original.files].sort(),
  );
  for (const file of manifest.files) {
    requireDirectName(file.name, "Detox staged manifest file");
    const staged = await readOwnedDirectFile(
      outputRoot,
      file.name,
      file.name.endsWith(".png") ? MAX_PNG_BYTES : MAX_JSON_BYTES,
      lifecycle,
    );
    assert.equal(staged.byteLength, file.bytes);
    assert.equal(hashBytes(staged), file.sha256);
    const originalBytes = await readOwnedDirectFile(
      captureRoot,
      file.name,
      file.name.endsWith(".png") ? MAX_PNG_BYTES : MAX_JSON_BYTES,
      lifecycle,
    );
    assert.deepEqual(
      staged,
      originalBytes,
      `Detox staged evidence differs from original: ${file.name}`,
    );
  }
  assert.deepEqual(manifest.ledger, original.ledger);
  const manifestBytes = await readOwnedPrivateFile(
    outputRoot,
    "detox-connection-evidence-copy.private.json",
    MAX_JSON_BYTES,
    lifecycle,
  );
  const parsedManifest = JSON.parse(
    manifestBytes.toString("utf8"),
  ) as RecordValue;
  assert.equal(
    parsedManifest.kind,
    DETOX_ANDROID_CONNECTION_PUBLIC_STAGING_KIND,
  );
  await validateBuildAgain(input, lifecycle);
  lifecycleFence(lifecycle, "verify complete");
}
