'use strict';

import { createHash } from 'node:crypto';
import path from 'node:path';

export const DETOX_SAVE_RETRY_PROTOCOL_SCHEMA = 1;
export const DETOX_SAVE_RETRY_COMMANDS = Object.freeze([
  'prepare-draft',
  'failed-save',
  'retry-save',
  'reopen',
  'shutdown',
]);
const RUN_ID = /^[a-f0-9]{24}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ATTEMPT_ID = /^([a-f0-9]{24}):first$/;
const PLAN_ID = /^training_plan_[a-f0-9-]{36}$/;
const MAX_SELECTOR = /^[^\u0000-\u001f\u007f]{1,240}$/u;

export const DETOX_SAVE_RETRY_DRAFT = Object.freeze({
  title: 'Native QA Draft',
  sessionName: 'Strength',
  exerciseId: '00000000-0000-4000-8000-000000000001',
  exerciseName: 'en QA Exercise 1',
  quantity: '3x8',
  notes: '',
});

const PREPARE_SELECTORS = Object.freeze([
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
  `exerciseSearch.result.${DETOX_SAVE_RETRY_DRAFT.exerciseId}`,
  'exerciseSearch.detail',
  'exerciseSearch.quantity',
  'exerciseSearch.notes',
  'exerciseSearch.confirm',
  `pro.training_plan.itemRow.${DETOX_SAVE_RETRY_DRAFT.exerciseName.replace(/[^A-Za-z0-9]/g, '_')}`,
]);
const RETRY_SELECTORS = Object.freeze([
  'OK',
  'pro.training_plan.saveButton',
  'pro.library.training.create',
]);

export function selectorsForDetoxSaveRetryCommand(
  commandKind,
  planId = undefined,
  errorText = undefined,
) {
  if (commandKind === 'prepare-draft') return [...PREPARE_SELECTORS];
  if (commandKind === 'failed-save') {
    text(errorText, 'save/retry failure text');
    return ['pro.training_plan.saveButton', errorText];
  }
  if (commandKind === 'retry-save') return [...RETRY_SELECTORS];
  if (commandKind === 'shutdown') return [];
  if (commandKind === 'reopen') {
    text(planId, 'save/retry reopen plan ID', PLAN_ID);
    const quantityId = `pro.training_plan.itemRow.${DETOX_SAVE_RETRY_DRAFT.exerciseName.replace(/[^A-Za-z0-9]/g, '_')}.quantity`;
    return [`pro.library.training.row.${planId}`, 'pro.training_plan.screen', quantityId];
  }
  throw new Error('save/retry command selector plan is unsupported');
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value;
}

function text(value, label, pattern = undefined) {
  if (typeof value !== 'string' || value.length === 0 || (pattern && !pattern.test(value)))
    throw new Error(`${label} is invalid`);
  return value;
}

function hash(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

export function hashJson(value) {
  return hash(value);
}

function requireIdentity(value, label) {
  const row = record(value, label);
  if (!Number.isSafeInteger(row.pid) || row.pid <= 1) throw new Error(`${label}.pid is invalid`);
  if (!Number.isSafeInteger(row.pgid) || row.pgid <= 1) throw new Error(`${label}.pgid is invalid`);
  text(row.started, `${label}.started`);
  return { pid: row.pid, pgid: row.pgid, started: row.started };
}

function requireDraft(value) {
  const row = record(value, 'save/retry draft');
  for (const [key, expected] of Object.entries(DETOX_SAVE_RETRY_DRAFT)) {
    if (row[key] !== expected) throw new Error(`save/retry draft ${key} is not canonical`);
  }
  return { ...DETOX_SAVE_RETRY_DRAFT };
}

function requirePrivateStat(value, label, expectedSize) {
  const row = record(value, label);
  for (const key of ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size']) {
    if (!Number.isSafeInteger(row[key]) || row[key] < 0)
      throw new Error(`${label}.${key} is invalid`);
  }
  for (const key of ['mtimeMs', 'ctimeMs']) {
    if (!Number.isFinite(row[key]) || row[key] < 0) throw new Error(`${label}.${key} is invalid`);
  }
  if (row.nlink !== 1 || (row.mode & 0o022) !== 0)
    throw new Error(`${label} is not a private single-link file`);
  if (expectedSize !== undefined && row.size !== expectedSize)
    throw new Error(`${label}.size does not match screenshot bytes`);
  return row;
}

function requireOwnedPath(value, root, label) {
  text(value, label);
  if (!path.isAbsolute(value) || path.resolve(value) !== value)
    throw new Error(`${label} must be a normalized absolute path`);
  const canonicalRoot = path.resolve(root);
  if (value === canonicalRoot || !value.startsWith(`${canonicalRoot}${path.sep}`))
    throw new Error(`${label} escaped the owned artifact root`);
  return value;
}

function requireScreenshot(value) {
  const row = record(value, 'save/retry screenshot receipt');
  text(row.path, 'save/retry screenshot path');
  if (!row.path.startsWith('/')) throw new Error('save/retry screenshot path must be absolute');
  text(row.realpath, 'save/retry screenshot realpath');
  if (!row.realpath.startsWith('/'))
    throw new Error('save/retry screenshot realpath must be absolute');
  text(row.artifactRoot, 'save/retry screenshot artifact root');
  if (!row.artifactRoot.startsWith('/') || path.resolve(row.artifactRoot) !== row.artifactRoot)
    throw new Error('save/retry screenshot artifact root must be normalized absolute');
  requireOwnedPath(row.path, row.artifactRoot, 'save/retry screenshot snapshot path');
  if (row.realpath !== row.path) throw new Error('save/retry screenshot snapshot path changed');
  if (!Number.isSafeInteger(row.bytes) || row.bytes <= 0 || row.bytes > 16 * 1024 * 1024)
    throw new Error('save/retry screenshot bytes are invalid');
  text(row.sha256, 'save/retry screenshot hash', SHA256);
  if (row.source !== 'detox.device.takeScreenshot')
    throw new Error('save/retry screenshot source is not Detox');
  text(row.producerPath, 'save/retry screenshot producer path');
  text(row.producerRealpath, 'save/retry screenshot producer realpath');
  if (!path.isAbsolute(row.producerPath) || !path.isAbsolute(row.producerRealpath))
    throw new Error('save/retry screenshot producer paths must be absolute');
  if (row.producerPath !== row.producerRealpath)
    throw new Error('save/retry screenshot producer path is not canonical');
  requireOwnedPath(row.snapshotPath, row.artifactRoot, 'save/retry screenshot snapshot path');
  if (row.snapshotPath !== row.path)
    throw new Error('save/retry screenshot snapshot aliases differ');
  requirePrivateStat(row.producerStat, 'save/retry screenshot producer stat', row.bytes);
  requirePrivateStat(row.snapshotStat, 'save/retry screenshot snapshot stat', row.bytes);
  text(row.producerSha256, 'save/retry screenshot producer hash', SHA256);
  if (row.producerSha256 !== row.sha256)
    throw new Error('save/retry screenshot producer hash differs from snapshot hash');
  return {
    path: row.path,
    realpath: row.realpath,
    artifactRoot: row.artifactRoot,
    bytes: row.bytes,
    sha256: row.sha256,
    source: row.source,
    producerPath: row.producerPath,
    producerRealpath: row.producerRealpath,
    producerStat: row.producerStat,
    producerSha256: row.producerSha256,
    snapshotPath: row.snapshotPath,
    snapshotStat: row.snapshotStat,
  };
}

function requireActionReceipt(value, command) {
  const row = record(value, 'save/retry action receipt');
  if (row.kind !== 'private-detox-save-retry-action')
    throw new Error('save/retry action receipt kind is invalid');
  if (row.phase !== command.commandKind)
    throw new Error('save/retry action phase does not match command');
  if (!Number.isSafeInteger(row.actionCount) || row.actionCount < 1 || row.actionCount > 100)
    throw new Error('save/retry action count is invalid');
  if (!Array.isArray(row.selectors) || row.selectors.length === 0)
    throw new Error('save/retry action selectors are missing');
  const selectors = row.selectors.map((selector, index) =>
    text(selector, `save/retry selector ${index}`, MAX_SELECTOR),
  );
  if (new Set(selectors).size !== selectors.length)
    throw new Error('save/retry selectors are duplicated');
  const expectedSelectors = selectorsForDetoxSaveRetryCommand(
    command.commandKind,
    command.planId,
    command.errorText,
  );
  if (JSON.stringify(selectors) !== JSON.stringify(expectedSelectors))
    throw new Error('save/retry selectors do not match the declared action plan');
  if (
    !Array.isArray(row.selectorObservations) ||
    row.selectorObservations.length !== selectors.length
  )
    throw new Error('save/retry selector observations are incomplete');
  row.selectorObservations.forEach((rawObservation, index) => {
    const observation = record(rawObservation, `save/retry selector observation ${index}`);
    if (observation.selector !== selectors[index])
      throw new Error('save/retry selector observation order changed');
    const expectedKind =
      observation.selector === 'OK' ||
      (command.commandKind === 'failed-save' && observation.selector === command.errorText)
        ? 'text'
        : 'id';
    if (observation.selectorKind !== expectedKind)
      throw new Error('save/retry selector observation kind is invalid');
    record(observation.attributes, `save/retry selector attributes ${index}`);
    if (observation.source !== 'detox.element.getAttributes')
      throw new Error('save/retry selector observation source is not Detox');
  });
  text(row.hierarchySha256, 'save/retry hierarchy hash', SHA256);
  text(row.hierarchyXml, 'save/retry hierarchy source bytes');
  if (row.hierarchyXml.length > 4 * 1024 * 1024)
    throw new Error('save/retry hierarchy source exceeds the bounded receipt size');
  if (hashText(row.hierarchyXml) !== row.hierarchySha256)
    throw new Error('save/retry hierarchy hash does not bind source bytes');
  record(row.hierarchy, 'save/retry hierarchy tree');
  text(row.hierarchySource, 'save/retry hierarchy source');
  if (row.hierarchySource !== 'detox.device.generateViewHierarchyXml')
    throw new Error('save/retry hierarchy source is not Detox');
  const screenshot = requireScreenshot(row.screenshot);
  if (!Number.isFinite(row.startedMonotonicMs) || !Number.isFinite(row.finishedMonotonicMs))
    throw new Error('save/retry action timing is invalid');
  if (row.finishedMonotonicMs < row.startedMonotonicMs)
    throw new Error('save/retry action timing is reversed');
  if (command.commandKind === 'failed-save') {
    if (row.observedText !== command.errorText)
      throw new Error('save/retry failure text is not bound to the command');
  } else if (row.observedText !== undefined) {
    throw new Error('save/retry non-failure action carries observed error text');
  }
  if (!['draft', 'error', 'library', 'reopened'].includes(row.state))
    throw new Error('save/retry action state is invalid');
  return { ...row, selectors, screenshot };
}

export function assertDetoxSaveRetryCommand(value) {
  const row = record(value, 'Detox save/retry command');
  if (row.schemaVersion !== DETOX_SAVE_RETRY_PROTOCOL_SCHEMA)
    throw new Error('save/retry command schema is unsupported');
  if (row.kind !== 'private-detox-save-retry-command')
    throw new Error('save/retry command kind is invalid');
  if (!Number.isSafeInteger(row.commandId) || row.commandId <= 0)
    throw new Error('save/retry command ID is invalid');
  text(row.runId, 'save/retry run ID', RUN_ID);
  if (!ATTEMPT_ID.test(row.attemptId) || row.attemptId.slice(0, 24) !== row.runId)
    throw new Error('save/retry attempt ID is invalid');
  if (row.platform !== 'ios' && row.platform !== 'android')
    throw new Error('save/retry platform is invalid');
  if (!DETOX_SAVE_RETRY_COMMANDS.includes(row.commandKind))
    throw new Error('save/retry command phase is unsupported');
  const withoutHash = { ...row, commandHash: undefined };
  text(row.commandHash, 'save/retry command hash', SHA256);
  if (hash(withoutHash) !== row.commandHash) throw new Error('save/retry command hash is stale');
  if (row.commandKind === 'shutdown') {
    if (
      row.draft !== undefined ||
      row.errorText !== undefined ||
      row.planId !== undefined ||
      row.selectors !== undefined
    )
      throw new Error('shutdown carries save inputs');
    return { ...row };
  }
  if (!Array.isArray(row.selectors)) throw new Error('save/retry command selectors are missing');
  const draft = requireDraft(row.draft);
  if (row.commandKind === 'failed-save') text(row.errorText, 'save/retry error text');
  else if (row.errorText !== undefined) throw new Error('non-failure command carries error text');
  const expectedSelectors = selectorsForDetoxSaveRetryCommand(
    row.commandKind,
    row.planId,
    row.errorText,
  );
  if (JSON.stringify(row.selectors) !== JSON.stringify(expectedSelectors))
    throw new Error('save/retry command selectors are not canonical');
  if (row.commandKind === 'reopen') {
    text(row.planId, 'save/retry plan ID', /^training_plan_[a-f0-9-]{36}$/);
  } else if (row.planId !== undefined) {
    throw new Error('pre-retry command carries a plan ID');
  }
  return { ...row, draft };
}

export function buildDetoxSaveRetryCommand(input) {
  const command = {
    schemaVersion: DETOX_SAVE_RETRY_PROTOCOL_SCHEMA,
    kind: 'private-detox-save-retry-command',
    commandId: input.commandId,
    runId: input.runId,
    attemptId: input.attemptId,
    platform: input.platform,
    commandKind: input.commandKind,
    ...(input.commandKind === 'shutdown'
      ? {}
      : {
          selectors: selectorsForDetoxSaveRetryCommand(
            input.commandKind,
            input.planId,
            input.errorText,
          ),
        }),
    ...(input.commandKind === 'shutdown' ? {} : { draft: { ...DETOX_SAVE_RETRY_DRAFT } }),
    ...(input.commandKind === 'failed-save' ? { errorText: input.errorText } : {}),
    ...(input.commandKind === 'reopen' ? { planId: input.planId } : {}),
    commandHash: undefined,
  };
  return assertDetoxSaveRetryCommand({ ...command, commandHash: hash(command) });
}

export function assertDetoxSaveRetryResponse(value, command, expectedChild, deadlineAt = Infinity) {
  const row = record(value, 'Detox save/retry response');
  if (row.schemaVersion !== DETOX_SAVE_RETRY_PROTOCOL_SCHEMA)
    throw new Error('save/retry response schema is unsupported');
  if (row.kind !== 'private-detox-save-retry-response')
    throw new Error('save/retry response kind is invalid');
  if (row.commandId !== command.commandId || row.commandHash !== command.commandHash)
    throw new Error('save/retry response command identity changed');
  if (row.runId !== command.runId || row.attemptId !== command.attemptId)
    throw new Error('save/retry response run identity changed');
  if (row.platform !== command.platform || row.commandKind !== command.commandKind)
    throw new Error('save/retry response platform/phase changed');
  if (!['completed', 'failed', 'cancelled'].includes(row.status))
    throw new Error('save/retry response status is invalid');
  const childIdentity = requireIdentity(row.childIdentity, 'save/retry response child identity');
  if (
    expectedChild &&
    (childIdentity.pid !== expectedChild.pid ||
      childIdentity.pgid !== expectedChild.pgid ||
      childIdentity.started !== expectedChild.started)
  )
    throw new Error('save/retry child identity changed');
  if (!Number.isFinite(row.startedMonotonicMs) || !Number.isFinite(row.finishedMonotonicMs))
    throw new Error('save/retry response timing is invalid');
  if (row.finishedMonotonicMs < row.startedMonotonicMs)
    throw new Error('save/retry response timing is reversed');
  if (row.finishedMonotonicMs > deadlineAt)
    throw new Error('save/retry response arrived after deadline');
  if (row.status === 'completed') {
    if (command.commandKind === 'shutdown') {
      if (row.actionReceipt !== undefined) throw new Error('shutdown published an action receipt');
    } else {
      requireActionReceipt(row.actionReceipt, command);
    }
  } else {
    const error = record(row.error, 'save/retry child error');
    text(error.name, 'save/retry child error name');
    text(error.message, 'save/retry child error message');
    if (row.actionReceipt !== undefined) requireActionReceipt(row.actionReceipt, command);
  }
  return { ...row, childIdentity };
}
