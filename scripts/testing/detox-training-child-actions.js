'use strict';
/* global Buffer */

const { createHash } = require('node:crypto');
const { constants: fsConstants } = require('node:fs');
const { lstat, open, realpath } = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024;
const MAX_ATTRIBUTES_BYTES = 256 * 1024;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function identity(runtime) {
  const child = runtime.childIdentity;
  if (
    !child ||
    !Number.isSafeInteger(child.pid) ||
    child.pid <= 1 ||
    !Number.isSafeInteger(child.pgid) ||
    child.pgid <= 1 ||
    typeof child.started !== 'string' ||
    !child.started
  )
    throw new Error('Detox training child identity is missing');
  return child;
}

function fence(runtime) {
  if (runtime.signal?.aborted)
    throw runtime.signal.reason || new Error('Detox training action cancelled');
  if (Number.isFinite(runtime.deadlineAt) && performance.now() >= runtime.deadlineAt)
    throw new Error('Detox training action deadline elapsed');
}

async function guardedFileOperation(runtime, operation) {
  fence(runtime);
  const controller = new AbortController();
  let timer;
  const abort = () => controller.abort(runtime.signal?.reason);
  runtime.signal?.addEventListener('abort', abort, { once: true });
  if (Number.isFinite(runtime.deadlineAt)) {
    timer = setTimeout(
      () => controller.abort(new Error('Detox training action deadline elapsed')),
      Math.max(1, runtime.deadlineAt - performance.now()),
    );
  }
  try {
    const value = await operation(controller.signal);
    fence(runtime);
    return value;
  } finally {
    if (timer) clearTimeout(timer);
    runtime.signal?.removeEventListener('abort', abort);
  }
}

async function bounded(runtime, operation) {
  fence(runtime);
  const remaining = Number.isFinite(runtime.deadlineAt)
    ? runtime.deadlineAt - performance.now()
    : 60_000;
  if (remaining <= 0) throw new Error('Detox training action deadline elapsed');
  let timer;
  let onAbort;
  const cancellation = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Detox training action deadline elapsed')),
      remaining,
    );
    onAbort = () => reject(runtime.signal.reason || new Error('Detox training action cancelled'));
    runtime.signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const result = await Promise.race([operation(), cancellation]);
    fence(runtime);
    return result;
  } finally {
    clearTimeout(timer);
    if (onAbort) runtime.signal?.removeEventListener('abort', onAbort);
  }
}

function matcher(runtime, selector, kind = 'id') {
  if (!runtime.by || typeof runtime.by.id !== 'function' || typeof runtime.by.text !== 'function')
    throw new Error('Detox matcher API is unavailable');
  return kind === 'text' ? runtime.by.text(selector) : runtime.by.id(selector);
}

function target(runtime, selector, kind) {
  if (typeof runtime.element !== 'function') throw new Error('Detox element API is unavailable');
  return runtime.element(matcher(runtime, selector, kind));
}

function oneAttributes(value, selector) {
  const row = value && typeof value === 'object' ? value : undefined;
  if (!row) throw new Error(`Detox getAttributes returned no object for ${selector}`);
  if (Array.isArray(row.elements)) {
    if (row.elements.length !== 1)
      throw new Error(`Detox selector ${selector} matched ${row.elements.length} elements`);
    return row.elements[0];
  }
  return row;
}

function frame(value, selector) {
  const row = oneAttributes(value, selector);
  if (row.identifier !== selector)
    throw new Error(`Detox selector identity changed for ${selector}`);
  if (row.enabled !== true || row.visible !== true)
    throw new Error(`Detox selector ${selector} is not actionable`);
  if (row.frame === undefined || typeof row.frame !== 'object')
    throw new Error(`Detox frame is missing for ${selector}`);
  const result = {};
  for (const key of ['x', 'y', 'width', 'height']) {
    if (typeof row.frame[key] !== 'number' || !Number.isFinite(row.frame[key]))
      throw new Error(`Detox frame ${key} is invalid for ${selector}`);
    result[key] = row.frame[key];
  }
  if ('hittable' in row && row.hittable !== true)
    throw new Error(`Detox selector ${selector} is not hittable`);
  return result;
}

function statIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode,
    nlink: stat.nlink,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function sameStat(left, right) {
  return JSON.stringify(statIdentity(left)) === JSON.stringify(statIdentity(right));
}

async function readOriginalProducer(runtime, producerPath) {
  fence(runtime);
  if ((fsConstants.O_NOFOLLOW ?? 0) === 0)
    throw new Error('Detox screenshot reader cannot enforce no-follow opens');
  const canonicalPath = path.resolve(producerPath);
  if (canonicalPath !== producerPath || !path.isAbsolute(producerPath))
    throw new Error('Detox screenshot producer path is not normalized');
  const pathBefore = await guardedFileOperation(runtime, () => lstat(canonicalPath));
  if (
    !pathBefore.isFile() ||
    pathBefore.isSymbolicLink() ||
    pathBefore.nlink !== 1 ||
    (pathBefore.mode & 0o022) !== 0 ||
    (typeof process.getuid === 'function' && pathBefore.uid !== process.getuid()) ||
    pathBefore.size <= 0 ||
    pathBefore.size > MAX_SCREENSHOT_BYTES
  )
    throw new Error('Detox screenshot producer file is not owned and bounded');
  if ((await guardedFileOperation(runtime, () => realpath(canonicalPath))) !== canonicalPath)
    throw new Error('Detox screenshot producer path is not canonical');
  const handle = await guardedFileOperation(runtime, () =>
    open(canonicalPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW),
  );
  try {
    const descriptorBefore = await guardedFileOperation(runtime, () => handle.stat());
    if (
      !descriptorBefore.isFile() ||
      descriptorBefore.isSymbolicLink() ||
      descriptorBefore.nlink !== 1 ||
      descriptorBefore.size !== pathBefore.size ||
      !sameStat(pathBefore, descriptorBefore)
    )
      throw new Error('Detox screenshot producer identity changed before read');
    const bytes = Buffer.allocUnsafe(descriptorBefore.size);
    let offset = 0;
    while (offset < bytes.length) {
      fence(runtime);
      const result = await guardedFileOperation(runtime, () =>
        handle.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), null),
      );
      if (result.bytesRead <= 0) throw new Error('Detox screenshot producer truncated');
      offset += result.bytesRead;
    }
    const extra = await guardedFileOperation(runtime, () =>
      handle.read(Buffer.allocUnsafe(1), 0, 1, null),
    );
    if (extra.bytesRead !== 0) throw new Error('Detox screenshot producer grew during read');
    const descriptorAfter = await guardedFileOperation(runtime, () => handle.stat());
    const pathAfter = await guardedFileOperation(runtime, () => lstat(canonicalPath));
    if (!sameStat(descriptorBefore, descriptorAfter) || !sameStat(descriptorBefore, pathAfter))
      throw new Error('Detox screenshot producer identity changed during read');
    if ((await guardedFileOperation(runtime, () => realpath(canonicalPath))) !== canonicalPath)
      throw new Error('Detox screenshot producer path changed during read');
    return { bytes, metadata: descriptorAfter, path: canonicalPath };
  } finally {
    await handle.close();
  }
}

async function writeCapture(runtime, root, fileName, bytes, maxBytes) {
  fence(runtime);
  if (!Buffer.isBuffer(bytes) || bytes.length === 0)
    throw new Error(`Detox source ${fileName} is empty`);
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || bytes.length > maxBytes)
    throw new Error(`Detox source ${fileName} exceeds its bounded capture size`);
  const { readOwnedTrainingPath, writeAtomicTrainingBytes } =
    await import('./detox-training-child-protocol.mjs');
  const hooks = runtime.__testPublicationHooks;
  await writeAtomicTrainingBytes(root, fileName, bytes, maxBytes, {
    signal: runtime.signal,
    deadlineAt: runtime.deadlineAt,
    beforePublish: hooks?.beforePublish
      ? ({ temporary, final }) => hooks.beforePublish({ fileName, temporary, final })
      : undefined,
    afterPublish: hooks?.afterPublish
      ? ({ temporary, final }) => hooks.afterPublish({ fileName, temporary, final })
      : undefined,
  });
  fence(runtime);
  const canonicalRoot = await guardedFileOperation(runtime, () => realpath(path.resolve(root)));
  const file = path.join(canonicalRoot, fileName);
  const readback = await readOwnedTrainingPath(file, maxBytes, {
    signal: runtime.signal,
    deadlineAt: runtime.deadlineAt,
    privateRecord: true,
  });
  if (!readback.bytes.equals(bytes))
    throw new Error(`Detox source ${fileName} changed during write`);
  fence(runtime);
  return { file: readback.realpath, stat: readback.metadata, bytes: readback.bytes };
}

/**
 * @returns {import('./detox-training-child-client.ts').DetoxTrainingSourceReceipt}
 */
function sourceReceipt(runtime, producer, fileName, capture, producerCapture, producerSnapshot) {
  const child = identity(runtime);
  const bytes = capture.bytes;
  const receipt = {
    producer,
    sourceKind: 'file',
    sourceBytes: bytes.byteLength,
    sourceSha256: hash(bytes),
    sourcePath: capture.file,
    sourceRealpath: capture.file,
    sourceMode: 0o600,
    sourceUid: capture.stat.uid,
    sourceNlink: capture.stat.nlink,
    sourceDev: capture.stat.dev,
    sourceIno: capture.stat.ino,
    fileName,
    processPid: child.pid,
    processPgid: child.pgid,
    processStarted: child.started,
  };
  if (producerCapture) {
    receipt.producerPath = producerCapture.path;
    receipt.producerRealpath = producerCapture.path;
    receipt.producerBytes = producerCapture.bytes.byteLength;
    receipt.producerSha256 = hash(producerCapture.bytes);
    receipt.producerMode = producerCapture.metadata.mode & 0o777;
    receipt.producerUid = producerCapture.metadata.uid;
    receipt.producerNlink = producerCapture.metadata.nlink;
    receipt.producerDev = producerCapture.metadata.dev;
    receipt.producerIno = producerCapture.metadata.ino;
    receipt.producerRetention = /** @type {'owned-snapshot'} */ ('owned-snapshot');
    receipt.producerSnapshotPath = producerSnapshot.file;
    receipt.producerSnapshotRealpath = producerSnapshot.file;
    receipt.producerSnapshotBytes = producerSnapshot.bytes.byteLength;
    receipt.producerSnapshotSha256 = hash(producerSnapshot.bytes);
    receipt.producerSnapshotMode = producerSnapshot.stat.mode & 0o777;
    receipt.producerSnapshotUid = producerSnapshot.stat.uid;
    receipt.producerSnapshotNlink = producerSnapshot.stat.nlink;
    receipt.producerSnapshotDev = producerSnapshot.stat.dev;
    receipt.producerSnapshotIno = producerSnapshot.stat.ino;
  }
  return /** @type {import('./detox-training-child-client.ts').DetoxTrainingSourceReceipt} */ (
    receipt
  );
}

function renderedValue(value) {
  const row = oneAttributes(value, String(value?.identifier || 'selector'));
  for (const key of ['text', 'label', 'value', 'identifier'])
    if (typeof row[key] === 'string') return row[key];
  return undefined;
}

function selectorKinds(step) {
  const kinds = new Map();
  for (const action of step.actions)
    if (action.selector) kinds.set(action.selector, action.selectorKind || 'id');
  return step.selectors.map((selector) => kinds.get(selector) || 'id');
}

async function attributes(runtime, selectors, kinds) {
  const values = [];
  for (let index = 0; index < selectors.length; index++) {
    fence(runtime);
    const value = await bounded(runtime, () =>
      target(runtime, selectors[index], kinds[index]).getAttributes(),
    );
    values.push(value);
  }
  return values;
}

async function executeAction(runtime, action) {
  fence(runtime);
  if (action.kind === 'dismiss-keyboard') {
    await bounded(runtime, () => runtime.device.dismissKeyboard());
  } else if (action.kind === 'scroll') {
    await bounded(runtime, () =>
      target(runtime, action.container, 'id').scroll(200, action.direction),
    );
    await bounded(runtime, () => target(runtime, action.selector, 'id').tap());
  } else {
    const item = target(runtime, action.selector, action.selectorKind || 'id');
    if (action.kind === 'wait-visible')
      await bounded(runtime, () => runtime.expect(item).toBeVisible());
    else if (action.kind === 'tap') await bounded(runtime, () => item.tap());
    else if (action.kind === 'assert-visible')
      await bounded(runtime, () => runtime.expect(item).toBeVisible());
    else if (action.kind === 'assert-not-visible')
      await bounded(runtime, () => runtime.expect(item).not.toBeVisible());
    else if (action.kind === 'replace-text')
      await bounded(runtime, () => item.replaceText(action.value));
    else throw new Error(`Unsupported Detox training action ${action.kind}`);
  }
  fence(runtime);
}

async function capture(runtime, step, before, after) {
  fence(runtime);
  const xml = await bounded(runtime, () => runtime.device.generateViewHierarchyXml(true));
  if (typeof xml !== 'string' || xml.length === 0)
    throw new Error('Detox hierarchy producer returned no XML');
  const screenshotPath = await bounded(runtime, () =>
    runtime.device.takeScreenshot(`detox-training-${step.id}`),
  );
  if (typeof screenshotPath !== 'string' || !path.isAbsolute(screenshotPath))
    throw new Error('Detox screenshot producer returned no path');
  const originalScreenshot = await readOriginalProducer(runtime, screenshotPath);
  if (
    originalScreenshot.bytes.length < 8 ||
    !originalScreenshot.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error('Detox screenshot producer did not return a PNG');
  const prefix = `detox-training-${step.id}`;
  const xmlCapture = await writeCapture(
    runtime,
    runtime.artifactRoot,
    `${prefix}.xml`,
    Buffer.from(xml),
    MAX_XML_BYTES,
  );
  const screenshotCapture = await writeCapture(
    runtime,
    runtime.artifactRoot,
    `${prefix}.png`,
    originalScreenshot.bytes,
    MAX_SCREENSHOT_BYTES,
  );
  const producerSnapshot = await writeCapture(
    runtime,
    runtime.artifactRoot,
    `${prefix}-producer.png`,
    originalScreenshot.bytes,
    MAX_SCREENSHOT_BYTES,
  );
  const beforeBytes = Buffer.from(JSON.stringify(before));
  const afterBytes = Buffer.from(JSON.stringify(after));
  if (beforeBytes.length > MAX_ATTRIBUTES_BYTES || afterBytes.length > MAX_ATTRIBUTES_BYTES)
    throw new Error('Detox getAttributes evidence exceeds its bound');
  const beforeCapture = await writeCapture(
    runtime,
    runtime.artifactRoot,
    `${prefix}-before.json`,
    beforeBytes,
    MAX_ATTRIBUTES_BYTES,
  );
  const afterCapture = await writeCapture(
    runtime,
    runtime.artifactRoot,
    `${prefix}-after.json`,
    afterBytes,
    MAX_ATTRIBUTES_BYTES,
  );
  const child = identity(runtime);
  const selectorEvidence = step.selectors.map((selector, index) => {
    const firstFrame = frame(before[index], selector);
    const secondFrame = frame(after[index], selector);
    if (JSON.stringify(firstFrame) !== JSON.stringify(secondFrame))
      throw new Error(`Detox frame changed for ${selector}`);
    return { selector, before: before[index], after: after[index], frameStable: true };
  });
  const rendered = {};
  for (const [selector, expected] of Object.entries(step.expectedRendered || {})) {
    const index = step.selectors.indexOf(selector);
    if (index < 0) throw new Error(`Expected rendered selector ${selector} is not declared`);
    rendered[selector] = renderedValue(after[index]);
    if (rendered[selector] !== expected) throw new Error(`Rendered value differs for ${selector}`);
  }
  return {
    schemaVersion: 1,
    kind: 'private-detox-training-step-receipt',
    stepId: step.id,
    assertionId: step.assertionId,
    runId: runtime.runId,
    attemptId: runtime.attemptId,
    commandId: runtime.commandId,
    commandHash: runtime.commandHash,
    platform: step.platform,
    viewId: step.viewId,
    childIdentity: child,
    selectors: [...step.selectors],
    rendered,
    sourceFiles: {
      xml: path.basename(xmlCapture.file),
      screenshot: path.basename(screenshotCapture.file),
      attributesBefore: path.basename(beforeCapture.file),
      attributesAfter: path.basename(afterCapture.file),
    },
    sourceReceipts: {
      xml: sourceReceipt(
        runtime,
        'detox.device.generateViewHierarchyXml',
        path.basename(xmlCapture.file),
        xmlCapture,
      ),
      screenshot: sourceReceipt(
        runtime,
        'detox.device.takeScreenshot',
        path.basename(screenshotCapture.file),
        screenshotCapture,
        originalScreenshot,
        producerSnapshot,
      ),
      attributesBefore: sourceReceipt(
        runtime,
        'detox.element.getAttributes',
        path.basename(beforeCapture.file),
        beforeCapture,
      ),
      attributesAfter: sourceReceipt(
        runtime,
        'detox.element.getAttributes',
        path.basename(afterCapture.file),
        afterCapture,
      ),
    },
    selectorEvidence,
    startedMonotonicMs: runtime.startedMonotonicMs,
    finishedMonotonicMs: performance.now(),
    status: 'completed',
    actionCompleted: true,
    hierarchyCaptured: true,
    screenshotCaptured: true,
  };
}

async function executeTrainingStep(runtime, step) {
  const kinds = selectorKinds(step);
  const started = performance.now();
  runtime.startedMonotonicMs = started;
  const before = await attributes(runtime, step.selectors, kinds);
  for (const action of step.actions) await executeAction(runtime, action);
  const after = await attributes(runtime, step.selectors, kinds);
  return capture(runtime, step, before, after);
}

async function restartTrainingApp(runtime, input) {
  fence(runtime);
  if (
    !input ||
    typeof input.appIdentifier !== 'string' ||
    input.appIdentifier.length === 0 ||
    !Number.isSafeInteger(input.launchCount) ||
    input.launchCount <= 0 ||
    input.launchCount > 100
  )
    throw new Error('Detox restart input is invalid');
  if (
    !runtime.device ||
    typeof runtime.device.launchApp !== 'function' ||
    typeof runtime.device.disableSynchronization !== 'function'
  )
    throw new Error('Detox restart API is unavailable');
  const launchArgs = { detoxEnableSynchronization: 0 };
  const started = performance.now();
  await bounded(runtime, () => runtime.device.launchApp({ newInstance: true, launchArgs }));
  await bounded(runtime, () => runtime.device.disableSynchronization());
  fence(runtime);
  return {
    schemaVersion: 1,
    kind: 'private-detox-training-restart-receipt',
    commandId: runtime.commandId,
    commandHash: runtime.commandHash,
    status: 'completed',
    runId: runtime.runId,
    attemptId: runtime.attemptId,
    platform: runtime.platform,
    appIdentifier: input.appIdentifier,
    launchCount: input.launchCount,
    synchronizationDisabled: true,
    launchArgsHash: hash(canonical(launchArgs)),
    childIdentity: identity(runtime),
    startedMonotonicMs: started,
    finishedMonotonicMs: performance.now(),
    cleanupFence: 'required-before-return',
  };
}

module.exports = {
  executeTrainingStep,
  restartTrainingApp,
  MAX_XML_BYTES,
  MAX_SCREENSHOT_BYTES,
  MAX_ATTRIBUTES_BYTES,
};
