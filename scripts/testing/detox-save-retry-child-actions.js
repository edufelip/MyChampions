'use strict';
/* global Buffer */

const { createHash } = require('node:crypto');
const { constants: fsConstants } = require('node:fs');
const { lstat, open, realpath } = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const {
  assertDetoxSaveRetryCommand,
  DETOX_SAVE_RETRY_DRAFT,
  DETOX_SAVE_RETRY_PROTOCOL_SCHEMA,
} = require('./detox-save-retry-child-protocol.mjs');
const { writeAtomicDetoxConnectionBytes } = require('./detox-connection-evidence.ts');

const ACTION_TIMEOUT_MS = 20_000;
const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;
const SCREENSHOT_READ_CHUNK_BYTES = 64 * 1024;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function hashText(value) {
  return hashBytes(Buffer.from(value, 'utf8'));
}

function requireRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object')
    throw new Error('Detox save/retry runtime is missing');
  if (runtime.platform !== 'ios' && runtime.platform !== 'android')
    throw new Error('Detox save/retry runtime platform is unavailable');
  for (const key of ['device', 'by']) {
    if (typeof runtime[key] !== 'object' || runtime[key] === null)
      throw new Error(`Detox save/retry runtime.${key} is unavailable`);
  }
  for (const key of ['element', 'waitFor']) {
    if (typeof runtime[key] !== 'function')
      throw new Error(`Detox save/retry runtime.${key} is unavailable`);
  }
  if (typeof runtime.by.id !== 'function' || typeof runtime.by.text !== 'function')
    throw new Error('Detox save/retry matcher API is unavailable');
  if (typeof runtime.artifactRoot !== 'string' || !runtime.artifactRoot.startsWith('/'))
    throw new Error('Detox save/retry artifact root is unavailable');
  const child = runtime.childIdentity;
  if (
    !child ||
    !Number.isSafeInteger(child.pid) ||
    child.pid <= 1 ||
    !Number.isSafeInteger(child.pgid) ||
    child.pgid <= 1 ||
    typeof child.started !== 'string' ||
    child.started.length === 0
  )
    throw new Error('Detox save/retry child identity is missing');
  if (!Array.isArray(runtime.selectorObservations)) runtime.selectorObservations = [];
}

function checkLive(runtime) {
  if (runtime.signal?.aborted)
    throw runtime.signal.reason || new Error('Detox save/retry action cancelled');
  if (Number.isFinite(runtime.deadlineAt) && performance.now() >= runtime.deadlineAt)
    throw new Error('Detox save/retry action deadline elapsed');
}

async function bounded(runtime, operation) {
  checkLive(runtime);
  const remaining = Number.isFinite(runtime.deadlineAt)
    ? runtime.deadlineAt - performance.now()
    : ACTION_TIMEOUT_MS;
  if (remaining <= 0) throw new Error('Detox save/retry action deadline elapsed');
  let timer;
  let onAbort;
  const cancellation = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Detox save/retry action deadline elapsed')),
      Math.max(1, Math.min(remaining, ACTION_TIMEOUT_MS)),
    );
    onAbort = () => reject(runtime.signal.reason || new Error('Detox save/retry action cancelled'));
    runtime.signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([Promise.resolve().then(operation), cancellation]);
    checkLive(runtime);
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) runtime.signal?.removeEventListener('abort', onAbort);
  }
}

function matcher(runtime, selector, kind = 'id') {
  checkLive(runtime);
  return kind === 'text' ? runtime.by.text(selector) : runtime.by.id(selector);
}

function target(runtime, selector, kind = 'id') {
  return runtime.element(matcher(runtime, selector, kind));
}

async function waitVisible(runtime, selector, kind = 'id') {
  checkLive(runtime);
  const value = runtime.waitFor(target(runtime, selector, kind));
  await bounded(runtime, () => value.toBeVisible().withTimeout(ACTION_TIMEOUT_MS));
  await observeSelector(runtime, selector, kind);
}

async function waitAbsent(runtime, selector) {
  checkLive(runtime);
  const value = runtime.waitFor(target(runtime, selector));
  await bounded(runtime, () => value.not.toBeVisible().withTimeout(ACTION_TIMEOUT_MS));
}

async function tap(runtime, selector, kind = 'id') {
  await waitVisible(runtime, selector, kind);
  await bounded(runtime, () => target(runtime, selector, kind).tap());
}

async function replaceText(runtime, selector, value) {
  await waitVisible(runtime, selector);
  await bounded(runtime, () => target(runtime, selector).replaceText(value));
}

async function scrollTo(runtime, selector, container, direction = 'down') {
  checkLive(runtime);
  const value = runtime.waitFor(target(runtime, selector));
  await bounded(runtime, () =>
    value.toBeVisible().whileElement(target(runtime, container)).scroll(260, direction, 0.5, 0.35),
  );
  await observeSelector(runtime, selector, 'id');
}

function sameScreenshotIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    (left.mode & 0o777) === (right.mode & 0o777) &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function statIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    uid: stat.uid,
    gid: stat.gid,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function requirePrivateScreenshotStat(stat, label) {
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not a regular file`);
  if (stat.nlink !== 1) throw new Error(`${label} has unexpected hard links`);
  if ((stat.mode & 0o022) !== 0) throw new Error(`${label} is group/other writable`);
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    throw new Error(`${label} owner is not the current user`);
  if (stat.size <= 0 || stat.size > MAX_SCREENSHOT_BYTES)
    throw new Error(`${label} size is outside the bounded read`);
}

function requirePngBytes(bytes, label = 'Detox screenshot') {
  if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.length > MAX_SCREENSHOT_BYTES)
    throw new Error(`${label} bytes are outside the bounded PNG read`);
  if (!bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    throw new Error(`${label} is not a PNG`);
  let offset = 8;
  let sawHeader = false;
  let sawIdat = false;
  let sawEnd = false;
  let idatClosed = false;
  let chunkIndex = 0;
  const crc32 = (value) => {
    let crc = 0xffffffff;
    for (const byte of value) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error(`${label} contains a truncated PNG chunk`);
    const size = bytes.readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString('ascii');
    const end = offset + 12 + size;
    if (end > bytes.length) throw new Error(`${label} contains a truncated PNG chunk`);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    const expectedCrc = bytes.readUInt32BE(offset + 8 + size);
    if (crc32(Buffer.concat([typeBytes, data])) !== expectedCrc)
      throw new Error(`${label} ${type} chunk CRC is invalid`);
    if (chunkIndex === 0 && type !== 'IHDR') throw new Error(`${label} must start with IHDR`);
    if (type === 'IHDR') {
      if (size !== 13 || sawHeader) throw new Error(`${label} has an invalid IHDR`);
      if (bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0)
        throw new Error(`${label} has invalid PNG dimensions`);
      sawHeader = true;
    }
    if (type === 'IDAT') {
      if (!sawHeader || sawEnd || idatClosed)
        throw new Error(`${label} IDAT chunk is out of order`);
      if (size === 0) throw new Error(`${label} has an empty IDAT`);
      sawIdat = true;
    } else if (sawIdat) {
      idatClosed = true;
    }
    if (type === 'IEND') {
      if (!sawIdat) throw new Error(`${label} has no IDAT chunk`);
      if (size !== 0 || sawEnd) throw new Error(`${label} has an invalid IEND`);
      sawEnd = true;
      if (end !== bytes.length) throw new Error(`${label} has trailing bytes after IEND`);
    }
    offset = end;
    chunkIndex += 1;
  }
  if (!sawHeader || !sawIdat || !sawEnd || offset !== bytes.length)
    throw new Error(`${label} is not a complete PNG`);
  return bytes;
}

async function readOriginalProducer(runtime, screenshotPath) {
  checkLive(runtime);
  if (!screenshotPath.startsWith('/')) throw new Error('Detox screenshot path is not absolute');
  const beforePath = await bounded(runtime, () => lstat(screenshotPath));
  requirePrivateScreenshotStat(beforePath, 'Detox screenshot');
  if ((fsConstants.O_NOFOLLOW ?? 0) === 0)
    throw new Error('Detox screenshot reader cannot enforce no-follow opens');
  const canonicalPath = await bounded(runtime, () => realpath(screenshotPath));
  if (canonicalPath !== path.resolve(screenshotPath))
    throw new Error('Detox screenshot producer path is not canonical');
  const canonicalPathStat = await bounded(runtime, () => lstat(canonicalPath));
  if (!sameScreenshotIdentity(beforePath, canonicalPathStat))
    throw new Error('Detox screenshot path target changed during canonicalization');

  const handle = await bounded(runtime, () =>
    open(screenshotPath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)),
  );
  try {
    const descriptorBefore = await bounded(runtime, () => handle.stat());
    if (!sameScreenshotIdentity(beforePath, descriptorBefore))
      throw new Error('Detox screenshot changed before descriptor read');
    const chunks = [];
    let offset = 0;
    while (offset < descriptorBefore.size) {
      checkLive(runtime);
      const chunk = Buffer.alloc(
        Math.min(SCREENSHOT_READ_CHUNK_BYTES, descriptorBefore.size - offset),
      );
      const result = await bounded(runtime, () => handle.read(chunk, 0, chunk.length, offset));
      if (result.bytesRead <= 0) throw new Error('Detox screenshot ended during bounded read');
      chunks.push(chunk.subarray(0, result.bytesRead));
      offset += result.bytesRead;
    }
    const extra = Buffer.alloc(1);
    const growth = await bounded(runtime, () => handle.read(extra, 0, extra.length, offset));
    if (growth.bytesRead !== 0) throw new Error('Detox screenshot grew during bounded read');
    const descriptorAfter = await bounded(runtime, () => handle.stat());
    const afterPath = await bounded(runtime, () => lstat(screenshotPath));
    if (!sameScreenshotIdentity(descriptorBefore, descriptorAfter))
      throw new Error('Detox screenshot changed during bounded read');
    if (!sameScreenshotIdentity(descriptorBefore, afterPath))
      throw new Error('Detox screenshot path changed during bounded read');
    checkLive(runtime);
    return {
      bytes: Buffer.concat(chunks),
      path: path.resolve(screenshotPath),
      realpath: canonicalPath,
      metadata: descriptorAfter,
    };
  } finally {
    await handle.close();
  }
}

async function writeOwnedScreenshot(runtime, phase, bytes) {
  const artifactRoot = await bounded(runtime, () => realpath(runtime.artifactRoot));
  const snapshotName = `detox-save-retry-${phase}-snapshot.png`;
  if (!/^[a-z0-9-]+-snapshot\.png$/.test(snapshotName))
    throw new Error('Detox screenshot snapshot name is not canonical');
  // The shared writer opens an exclusive no-follow temporary inode, fences the
  // owned root before/after publication, hard-links the final inode, and reads
  // it back through the same descriptor identity. No path-based write is used.
  await bounded(runtime, () =>
    writeAtomicDetoxConnectionBytes(artifactRoot, snapshotName, bytes, MAX_SCREENSHOT_BYTES, {
      signal: runtime.signal,
      deadlineAt: runtime.deadlineAt,
      checkLive: () => checkLive(runtime),
    }),
  );
  const snapshotPath = path.join(artifactRoot, snapshotName);
  const snapshot = await readOriginalProducer(runtime, snapshotPath);
  if (!snapshot.bytes.equals(bytes)) throw new Error('Detox screenshot snapshot bytes changed');
  return { ...snapshot, artifactRoot };
}

async function observeSelector(runtime, selector, kind = 'id') {
  const value = target(runtime, selector, kind);
  if (!value || typeof value.getAttributes !== 'function')
    throw new Error(`Detox selector ${selector} has no getAttributes API`);
  const attributes = await bounded(runtime, () => value.getAttributes());
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes))
    throw new Error(`Detox selector ${selector} returned invalid attributes`);
  runtime.selectorObservations.push({
    selector,
    selectorKind: kind,
    attributes,
    source: 'detox.element.getAttributes',
  });
}

function selectorObservationsFor(runtime, selectors, startIndex) {
  const observed = new Map();
  for (const row of runtime.selectorObservations.slice(startIndex)) {
    if (!observed.has(row.selector)) observed.set(row.selector, row);
  }
  return selectors.map((selector) => {
    const row = observed.get(selector);
    if (!row) throw new Error(`Detox selector ${selector} has no bound attributes observation`);
    return row;
  });
}

async function capture(
  runtime,
  phase,
  state,
  selectors,
  actionCount,
  startedMonotonicMs,
  observedText,
  observationStart,
) {
  checkLive(runtime);
  if (typeof runtime.device.generateViewHierarchyXml !== 'function')
    throw new Error('Detox hierarchy capture API is unavailable');
  if (typeof runtime.device.takeScreenshot !== 'function')
    throw new Error('Detox screenshot capture API is unavailable');
  const hierarchyXml = await bounded(runtime, () => runtime.device.generateViewHierarchyXml(true));
  if (typeof hierarchyXml !== 'string' || hierarchyXml.length === 0)
    throw new Error('Detox hierarchy capture is empty');
  if (hierarchyXml.length > 4 * 1024 * 1024)
    throw new Error('Detox hierarchy capture exceeds the bounded receipt size');
  const screenshotPath = await bounded(runtime, () =>
    runtime.device.takeScreenshot(`detox-save-retry-${phase}`),
  );
  if (typeof screenshotPath !== 'string' || !screenshotPath.startsWith('/'))
    throw new Error('Detox screenshot path is not absolute');
  const producer = await readOriginalProducer(runtime, screenshotPath);
  const screenshotBytes = requirePngBytes(producer.bytes);
  const snapshot = await writeOwnedScreenshot(runtime, phase, screenshotBytes);
  if (typeof runtime.parseHierarchy !== 'function')
    throw new Error('Detox hierarchy parser is unavailable');
  const hierarchy = await bounded(runtime, () =>
    runtime.parseHierarchy(hierarchyXml, runtime.platform),
  );
  if (!hierarchy || typeof hierarchy !== 'object')
    throw new Error('Detox hierarchy parser returned no tree');
  checkLive(runtime);
  return {
    kind: 'private-detox-save-retry-action',
    phase,
    state,
    actionCount,
    selectors: [...selectors],
    selectorObservations: selectorObservationsFor(runtime, selectors, observationStart),
    hierarchyXml,
    hierarchy,
    hierarchySha256: hashText(hierarchyXml),
    hierarchySource: 'detox.device.generateViewHierarchyXml',
    ...(observedText ? { observedText } : {}),
    screenshot: {
      path: snapshot.path,
      realpath: snapshot.realpath,
      artifactRoot: snapshot.artifactRoot,
      bytes: screenshotBytes.byteLength,
      sha256: hashBytes(screenshotBytes),
      source: 'detox.device.takeScreenshot',
      producerPath: producer.path,
      producerRealpath: producer.realpath,
      producerStat: statIdentity(producer.metadata),
      producerSha256: hashBytes(producer.bytes),
      snapshotPath: snapshot.path,
      snapshotStat: statIdentity(snapshot.metadata),
    },
    startedMonotonicMs,
    finishedMonotonicMs: performance.now(),
  };
}

async function prepareDraft(runtime, command) {
  const started = performance.now();
  const observationStart = runtime.selectorObservations.length;
  const selectors = [
    'tabs.training',
    'pro.library.training.create',
    'pro.training_plan.screen',
    'pro.training_plan.name',
    'pro.training_plan.addSession',
    'pro.training_plan.addSession.name',
    'pro.training_plan.addSession.confirm',
    'pro.training_plan.sessionRow.Strength',
    'pro.training_plan.sessionRow.Strength.addItem',
    'exerciseSearch.modal',
    'exerciseSearch.input',
    `exerciseSearch.result.${command.draft.exerciseId}`,
    'exerciseSearch.detail',
    'exerciseSearch.quantity',
    'exerciseSearch.notes',
    'exerciseSearch.confirm',
    `pro.training_plan.itemRow.${command.draft.exerciseName.replace(/[^A-Za-z0-9]/g, '_')}`,
  ];
  await tap(runtime, 'tabs.training');
  await tap(runtime, 'pro.library.training.create');
  await waitVisible(runtime, 'pro.training_plan.screen');
  await replaceText(runtime, 'pro.training_plan.name', command.draft.title);
  await scrollTo(runtime, 'pro.training_plan.addSession', 'pro.training_plan.screen');
  await tap(runtime, 'pro.training_plan.addSession');
  await replaceText(runtime, 'pro.training_plan.addSession.name', command.draft.sessionName);
  await tap(runtime, 'pro.training_plan.addSession.confirm');
  await waitVisible(runtime, 'pro.training_plan.sessionRow.Strength');
  await tap(runtime, 'pro.training_plan.sessionRow.Strength.addItem');
  await waitVisible(runtime, 'exerciseSearch.modal');
  await replaceText(runtime, 'exerciseSearch.input', 'QA Exercise');
  await waitVisible(runtime, `exerciseSearch.result.${command.draft.exerciseId}`);
  await tap(runtime, `exerciseSearch.result.${command.draft.exerciseId}`);
  await waitVisible(runtime, 'exerciseSearch.detail');
  await replaceText(runtime, 'exerciseSearch.quantity', command.draft.quantity);
  await replaceText(runtime, 'exerciseSearch.notes', command.draft.notes);
  await scrollTo(runtime, 'exerciseSearch.confirm', 'exerciseSearch.detail');
  await tap(runtime, 'exerciseSearch.confirm');
  await waitAbsent(runtime, 'exerciseSearch.modal');
  await waitVisible(
    runtime,
    `pro.training_plan.itemRow.${command.draft.exerciseName.replace(/[^A-Za-z0-9]/g, '_')}`,
  );
  return capture(
    runtime,
    'prepare-draft',
    'draft',
    selectors,
    selectors.length,
    started,
    undefined,
    observationStart,
  );
}

async function failSave(runtime, command) {
  const started = performance.now();
  const observationStart = runtime.selectorObservations.length;
  const selectors = ['pro.training_plan.saveButton', command.errorText];
  await scrollTo(runtime, 'pro.training_plan.saveButton', 'pro.training_plan.screen');
  await tap(runtime, 'pro.training_plan.saveButton');
  await waitVisible(runtime, command.errorText, 'text');
  return capture(
    runtime,
    'failed-save',
    'error',
    selectors,
    selectors.length,
    started,
    command.errorText,
    observationStart,
  );
}

async function retrySave(runtime) {
  const started = performance.now();
  const observationStart = runtime.selectorObservations.length;
  const selectors = ['OK', 'pro.training_plan.saveButton', 'pro.library.training.create'];
  await tap(runtime, 'OK', 'text');
  await scrollTo(runtime, 'pro.training_plan.saveButton', 'pro.training_plan.screen');
  await tap(runtime, 'pro.training_plan.saveButton');
  await waitVisible(runtime, 'pro.library.training.create');
  return capture(
    runtime,
    'retry-save',
    'library',
    selectors,
    selectors.length,
    started,
    undefined,
    observationStart,
  );
}

async function reopen(runtime, command) {
  const started = performance.now();
  const observationStart = runtime.selectorObservations.length;
  const quantityId = `pro.training_plan.itemRow.${command.draft.exerciseName.replace(/[^A-Za-z0-9]/g, '_')}.quantity`;
  const selectors = [
    `pro.library.training.row.${command.planId}`,
    'pro.training_plan.screen',
    quantityId,
  ];
  await tap(runtime, `pro.library.training.row.${command.planId}`);
  await waitVisible(runtime, 'pro.training_plan.screen');
  await scrollTo(runtime, quantityId, 'pro.training_plan.screen');
  return capture(
    runtime,
    'reopen',
    'reopened',
    selectors,
    selectors.length,
    started,
    undefined,
    observationStart,
  );
}

function response(command, runtime, status, startedMonotonicMs, actionReceipt, error) {
  return {
    schemaVersion: DETOX_SAVE_RETRY_PROTOCOL_SCHEMA,
    kind: 'private-detox-save-retry-response',
    commandId: command.commandId,
    commandHash: command.commandHash,
    commandKind: command.commandKind,
    runId: command.runId,
    attemptId: command.attemptId,
    platform: command.platform,
    status,
    childIdentity: { ...runtime.childIdentity },
    startedMonotonicMs,
    finishedMonotonicMs: performance.now(),
    ...(actionReceipt ? { actionReceipt } : {}),
    ...(error ? { error } : {}),
  };
}

/**
 * Actual Detox child entrypoint. The runtime is populated by the existing
 * owned Jest/Detox child with device/by/element/waitFor globals; the optional
 * injected runtime used by source tests cannot publish a native receipt.
 */
export async function runDetoxSaveRetryChildCommand(commandValue, runtime) {
  const command = assertDetoxSaveRetryCommand(commandValue);
  requireRuntime(runtime);
  if (runtime.platform !== command.platform)
    throw new Error('Detox save/retry command platform does not match the child runtime');
  const started = performance.now();
  let actionReceipt;
  try {
    if (command.commandKind === 'prepare-draft')
      actionReceipt = await prepareDraft(runtime, command);
    else if (command.commandKind === 'failed-save')
      actionReceipt = await failSave(runtime, command);
    else if (command.commandKind === 'retry-save') actionReceipt = await retrySave(runtime);
    else if (command.commandKind === 'reopen') actionReceipt = await reopen(runtime, command);
    else if (command.commandKind === 'shutdown') {
      if (typeof runtime.shutdown !== 'function')
        throw new Error('Detox save/retry shutdown API is unavailable');
      await bounded(runtime, () => runtime.shutdown());
    }
    return response(command, runtime, 'completed', started, actionReceipt);
  } catch (error) {
    const cancelled = runtime.signal?.aborted || /cancelled|deadline/i.test(errorMessage(error));
    return response(command, runtime, cancelled ? 'cancelled' : 'failed', started, actionReceipt, {
      name: error instanceof Error ? error.name : 'Error',
      message: errorMessage(error),
    });
  }
}

export { DETOX_SAVE_RETRY_DRAFT };
