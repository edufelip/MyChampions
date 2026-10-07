/* global Buffer, __filename, test */

const { createHash } = require('node:crypto');
const { readdir } = require('node:fs/promises');
const path = require('node:path');
require('tsx/cjs');
const {
  runDetoxConnectionAction,
} = require('../scripts/testing/detox-connection-actionability.ts');
const connectionEvidence = require('../scripts/testing/detox-connection-evidence.ts');
const { requireDetoxPngBytes } = require('../scripts/testing/detox-connection-ipc.ts');
const { performance } = require('node:perf_hooks');
const trainingProtocolPromise = import('../scripts/testing/detox-training-child-protocol.mjs');
const saveRetryProtocolPromise = import('../scripts/testing/detox-save-retry-child-protocol.mjs');
const {
  executeTrainingStep,
  restartTrainingApp,
} = require('../scripts/testing/detox-training-child-actions.js');
const {
  runDetoxSaveRetryChildCommand,
} = require('../scripts/testing/detox-save-retry-child-actions.js');

const platform = process.env.DETOX_CONNECTION_PLATFORM;
const artifactRoot = process.env.DETOX_CONNECTION_ARTIFACT_ROOT;
const coachEmail = process.env.DETOX_CONNECTION_COACH_EMAIL;
const coachPassword = process.env.DETOX_CONNECTION_COACH_PASSWORD;
const studentEmail = process.env.DETOX_CONNECTION_STUDENT_EMAIL;
const studentPassword = process.env.DETOX_CONNECTION_STUDENT_PASSWORD;

if (!['ios', 'android'].includes(platform)) throw new Error('Detox connection platform is missing');
if (!artifactRoot || !coachEmail || !coachPassword || !studentEmail || !studentPassword)
  throw new Error('Detox connection credentials/artifact root are missing');

const profile = {
  accountTab: 'tabs.account',
  signOut: 'settings.account.signOutCta',
  signOutConfirm: 'settings.account.signOutConfirmCta',
  signInEmail: 'auth.signIn.emailInput',
  signInPassword: 'auth.signIn.passwordInput',
  signInSubmit: 'auth.signIn.submitButton',
  coachHome: 'pro.home.screen',
  studentHome: 'student.home.screen',
  studentProfessionalsEntry: 'student.home.accountButton',
  studentProfessionalsScreen: 'student.professionals.screen',
  studentProfessionalsBack: 'student.professionals.backButton',
  studentCodeInput: 'student.professionals.codeInput',
  studentConnect: 'student.professionals.connectButton',
  pendingStudentCardPrefix: 'student.professionals.connectionPending.',
  activeStudentCardPrefix: 'student.professionals.activeConnection.',
  coachInviteCode: 'pro.home.inviteCodeValue',
  coachPendingConnections: 'pro.home.pendingConnections',
  coachRoster: 'pro.home.rosterCta',
  coachPendingScreen: 'pro.pending.screen',
  coachPendingBack: 'pro.pending.backButton',
  coachPendingFilter: 'pro.students.filter.pending',
  coachActiveFilter: 'pro.students.filter.active',
  coachRosterScreen: 'pro.students.screen',
};

let currentActor = 'coach';
let inviteCode;
let connectionId;
let lastCommandId = 0;
let launchCount = 0;
let activeCommand;
let activeCommandDeadlineAt;
let ownedChildIdentity;
let lastTrainingCommandId = 0;
let lastSaveRetryCommandId = 0;

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function commandHash(command) {
  return sha256(Buffer.from(canonical({ ...command, commandHash: undefined })));
}

async function privateWrite(name, value) {
  const bytes =
    typeof value === 'string' || Buffer.isBuffer(value)
      ? Buffer.from(value)
      : Buffer.from(JSON.stringify(value) + '\n');
  return connectionEvidence.writeAtomicDetoxConnectionBytes(
    artifactRoot,
    name,
    bytes,
    16 * 1024 * 1024,
    { checkLive: cancellationFence, deadlineAt: activeCommandDeadlineAt },
  );
}

async function cancellationFence() {
  if (activeCommand && (await commandCancelled(activeCommand)))
    throw new Error('Detox action cancelled before the next owned operation');
}

async function privatePublish(name, value) {
  const bytes =
    typeof value === 'string' || Buffer.isBuffer(value)
      ? Buffer.from(value)
      : Buffer.from(JSON.stringify(value) + '\n');
  await connectionEvidence.writeAtomicDetoxConnectionBytes(
    artifactRoot,
    name,
    bytes,
    16 * 1024 * 1024,
    { deadlineAt: activeCommandDeadlineAt },
  );
}

async function ownedAction(operation) {
  await cancellationFence();
  const value = await operation();
  await cancellationFence();
  return value;
}

async function ownedRead(name, maxBytes = 1024 * 1024) {
  return connectionEvidence.readOwnedDetoxConnectionFile(artifactRoot, name, maxBytes);
}

async function commandCancelled(command) {
  try {
    const value = JSON.parse(
      (
        await ownedRead(`detox-connection-cancel-${command.commandId}.private.json`, 16 * 1024)
      ).toString('utf8'),
    );
    if (
      value.schemaVersion !== 1 ||
      value.commandId !== command.commandId ||
      value.commandHash !== command.commandHash
    )
      throw new Error('Detox cancellation identity changed');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function selectors(value) {
  return typeof value === 'string' ? [value] : value;
}

async function waitForId(id, timeout = 90_000) {
  await ownedAction(() =>
    waitFor(element(by.id(id)))
      .toBeVisible()
      .withTimeout(timeout),
  );
}

async function waitForIdAbsent(id, timeout = 15_000) {
  await ownedAction(() =>
    expect(element(by.id(id)))
      .not.toBeVisible()
      .withTimeout(timeout),
  );
}

async function tapId(id) {
  await waitForId(id);
  await ownedAction(() => element(by.id(id)).tap());
}

async function scrollToId(id, container, direction = 'down') {
  await ownedAction(() =>
    waitFor(element(by.id(id)))
      .toBeVisible()
      .whileElement(by.id(container))
      .scroll(260, direction, 0.5, 0.5),
  );
}

async function launchFresh() {
  await ownedAction(() =>
    device.launchApp({ newInstance: true, launchArgs: { detoxEnableSynchronization: 0 } }),
  );
  await ownedAction(() => device.disableSynchronization());
  launchCount += 1;
}

async function signIn(email, password, landing) {
  await waitForId('auth.signIn.title');
  await ownedAction(() => element(by.id(profile.signInEmail)).replaceText(email));
  await ownedAction(() => element(by.id(profile.signInPassword)).replaceText(password));
  await ownedAction(() => element(by.id(profile.signInSubmit)).tap());
  await waitForId(landing, 90_000);
}

async function verifyRunnerSourceIdentity() {
  const expected = process.env.DETOX_CONNECTION_TEST_SHA256;
  if (!expected) throw new Error('Detox test source hash is missing');
  const verify = async (sourcePath, expectedHash, label) => {
    const resolved = path.resolve(sourcePath);
    const observed = await connectionEvidence.readDetoxConnectionPath(resolved, 8 * 1024 * 1024, {
      privateRecord: false,
    });
    if (sha256(observed.bytes) !== expectedHash)
      throw new Error(`${label} source changed after parent validation`);
  };
  await verify(__filename, expected, 'Detox test');
  const configPath = process.env.DETOX_CONNECTION_JEST_CONFIG_PATH;
  const configExpected = process.env.DETOX_CONNECTION_JEST_CONFIG_SHA256;
  if (!configPath || !configExpected) throw new Error('Detox Jest config source hash is missing');
  await verify(configPath, configExpected, 'Detox Jest config');
  const actionabilityPath = process.env.DETOX_CONNECTION_ACTIONABILITY_PATH;
  const actionabilityExpected = process.env.DETOX_CONNECTION_ACTIONABILITY_SHA256;
  if (!actionabilityPath || !actionabilityExpected)
    throw new Error('Detox actionability source hash is missing');
  await verify(actionabilityPath, actionabilityExpected, 'Detox actionability source');
  const hierarchyPath = process.env.DETOX_CONNECTION_HIERARCHY_PATH;
  const hierarchyExpected = process.env.DETOX_CONNECTION_HIERARCHY_SHA256;
  if (!hierarchyPath || !hierarchyExpected)
    throw new Error('Detox hierarchy source hash is missing');
  await verify(hierarchyPath, hierarchyExpected, 'Detox hierarchy source');
  const saveRetryActionsPath = process.env.DETOX_SAVE_RETRY_ACTIONS_PATH;
  const saveRetryActionsExpected = process.env.DETOX_SAVE_RETRY_ACTIONS_SHA256;
  if (!saveRetryActionsPath || !saveRetryActionsExpected)
    throw new Error('Detox save/retry child actions source hash is missing');
  await verify(
    saveRetryActionsPath,
    saveRetryActionsExpected,
    'Detox save/retry child actions source',
  );
  const saveRetryProtocolPath = process.env.DETOX_SAVE_RETRY_PROTOCOL_PATH;
  const saveRetryProtocolExpected = process.env.DETOX_SAVE_RETRY_PROTOCOL_SHA256;
  if (!saveRetryProtocolPath || !saveRetryProtocolExpected)
    throw new Error('Detox save/retry child protocol source hash is missing');
  await verify(
    saveRetryProtocolPath,
    saveRetryProtocolExpected,
    'Detox save/retry child protocol source',
  );
}

async function readOwnedChildIdentity() {
  if (ownedChildIdentity) return ownedChildIdentity;
  const value = JSON.parse(
    (await ownedRead('detox-connection-child-identity.private.json', 64 * 1024)).toString('utf8'),
  );
  if (
    value.kind !== 'private-detox-connection-child-identity' ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 1 ||
    !Number.isSafeInteger(value.pgid) ||
    value.pgid <= 1 ||
    typeof value.started !== 'string' ||
    value.started.length === 0
  )
    throw new Error('Detox owned child identity is malformed');
  ownedChildIdentity = { pid: value.pid, pgid: value.pgid, started: value.started };
  return ownedChildIdentity;
}

function childIdentityFields() {
  if (!ownedChildIdentity) throw new Error('Detox owned child identity was not loaded');
  return {
    childPid: ownedChildIdentity.pid,
    childPgid: ownedChildIdentity.pgid,
    childStarted: ownedChildIdentity.started,
  };
}

async function screenshotSourceReceipt(sourcePathValue, identity, command) {
  if (
    typeof sourcePathValue !== 'string' ||
    sourcePathValue.length === 0 ||
    !path.isAbsolute(sourcePathValue) ||
    path.resolve(sourcePathValue) !== sourcePathValue
  )
    throw new Error('Detox screenshot producer path must be a nonempty absolute normalized string');
  const sourcePath = sourcePathValue;
  const source = await connectionEvidence.readDetoxConnectionPath(sourcePath, 16 * 1024 * 1024, {
    privateRecord: false,
    checkLive: cancellationFence,
    deadlineAt: activeCommandDeadlineAt,
  });
  requireDetoxPngBytes(source.bytes, 'Detox screenshot producer source');
  const snapshotFile = `${command.label}-screenshot-source.private.png`;
  const snapshot = await connectionEvidence.writeAtomicDetoxConnectionBytes(
    artifactRoot,
    snapshotFile,
    source.bytes,
    16 * 1024 * 1024,
    { checkLive: cancellationFence, deadlineAt: activeCommandDeadlineAt },
  );
  return {
    producer: 'detox.device.takeScreenshot',
    sourceKind: 'file',
    processPid: identity.pid,
    processPgid: identity.pgid,
    processStarted: identity.started,
    sourceBytes: source.bytes.byteLength,
    sourceSha256: sha256(source.bytes),
    sourcePath,
    sourceRealpath: source.realpath,
    producerPath: sourcePath,
    producerRealpath: source.realpath,
    sourceMode: source.metadata.mode & 0o777,
    sourceUid: source.metadata.uid,
    sourceDev: source.metadata.dev,
    sourceIno: source.metadata.ino,
    sourceGid: source.metadata.gid,
    sourceNlink: source.metadata.nlink,
    sourceSnapshotPath: snapshotFile,
    sourceSnapshotBytes: snapshot.bytes.byteLength,
    sourceSnapshotSha256: sha256(snapshot.bytes),
    sourceCommandId: command.commandId,
    sourceCommandHash: command.commandHash,
    sourceLabel: command.label,
  };
}

function memorySourceReceipt(producer, bytes, identity, command) {
  return {
    producer,
    sourceKind: 'memory',
    processPid: identity.pid,
    processPgid: identity.pgid,
    processStarted: identity.started,
    sourceBytes: bytes.byteLength,
    sourceSha256: sha256(bytes),
    sourceCommandId: command.commandId,
    sourceCommandHash: command.commandHash,
    sourceLabel: command.label,
  };
}

function extractConnectionId(values) {
  for (const value of values) {
    const match =
      /(?:connectionPending|activeConnection|pro\.students\.row)\.([a-f0-9-]{36})$/.exec(value);
    if (match) return match[1];
  }
  return undefined;
}

function actionCleanupForPublishedFiles(publishedFiles) {
  return {
    status: 'published',
    files: publishedFiles.map((file) => ({ ...file, outcome: 'published' })),
  };
}

function errorSummary(error) {
  return {
    name: error?.name || 'Error',
    message: String(error?.message || error).slice(0, 512),
  };
}

async function recoverDedicatedActionFiles(command, publishedFiles, originalError) {
  if (publishedFiles.length === 0) return { status: 'not-started', files: [] };
  const recoveryDeadlineAt = performance.now() + 30_000;
  const files = [];
  const sameInode = (left, right) =>
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.uid === right.uid &&
    left.gid === right.gid;
  const observeReplacement = async (file) => {
    try {
      const maxBytes = file.name.endsWith('.xml') ? 4 * 1024 * 1024 : 512 * 1024;
      const observed = await connectionEvidence.readOwnedDetoxConnectionEvidence(
        artifactRoot,
        file.name,
        maxBytes,
      );
      if (sameInode(observed.metadata, file.metadata)) return undefined;
      return {
        metadata: observed.metadata,
        bytes: observed.bytes.byteLength,
        sha256: sha256(observed.bytes),
      };
    } catch {
      return undefined;
    }
  };
  for (const file of publishedFiles) {
    try {
      const outcome = await connectionEvidence.removeOwnedDetoxConnectionFile(
        artifactRoot,
        file.name,
        file.metadata,
        { deadlineAt: recoveryDeadlineAt },
      );
      files.push({ ...file, outcome });
    } catch (error) {
      const replacement = await observeReplacement(file);
      files.push({
        ...file,
        outcome: 'blocked',
        error: errorSummary(error).message,
        ...(replacement ? { replacement } : {}),
      });
    }
  }
  let status = files.every((file) => file.outcome === 'removed' || file.outcome === 'absent')
    ? 'cleaned'
    : files.some((file) => file.replacement !== undefined)
      ? 'blocked-recovery'
      : 'unknown-recovery';
  const ledgerName = `${command.label}-action-cleanup.private.json`;
  const ledger = {
    schemaVersion: 1,
    kind: 'private-detox-connection-action-cleanup',
    commandId: command.commandId,
    commandHash: command.commandHash,
    status,
    files,
    recoveryDeadlineAt,
    originalError: errorSummary(originalError),
  };
  const ledgerBytes = Buffer.from(JSON.stringify(ledger) + '\n', 'utf8');
  try {
    await connectionEvidence.writeAtomicDetoxConnectionBytes(
      artifactRoot,
      ledgerName,
      ledgerBytes,
      1024 * 1024,
      { deadlineAt: recoveryDeadlineAt },
    );
    return {
      status,
      files,
      ledgerPath: ledgerName,
      ledgerSha256: sha256(ledgerBytes),
      recoveryDeadlineAt,
    };
  } catch {
    status = 'unknown-recovery';
    return { status, files, recoveryDeadlineAt };
  }
}

async function terminalActionCleanup(command, observations, originalError) {
  if (!command.action) return undefined;
  const action = observations?.find((observation) => observation?.action)?.action;
  if (!action?.publishedFiles?.length) return { status: 'not-started', files: [] };
  return recoverDedicatedActionFiles(command, action.publishedFiles, originalError);
}

async function runDedicatedAction(command, runtime = {}) {
  if (!command.action) throw new Error(`Detox ${command.label} has no action bundle`);
  const publishedFiles = [];
  const restoreCommand = runtime.activateCommand
    ? { command: activeCommand, deadlineAt: activeCommandDeadlineAt }
    : undefined;
  if (runtime.activateCommand) {
    activeCommand = command;
    activeCommandDeadlineAt = runtime.deadlineAt ?? performance.now() + 600_000;
  }
  try {
    await cancellationFence();
    const result = await (runtime.runAction ?? runDetoxConnectionAction)({
      action: command.action,
      platform,
      driver: runtime.driver ?? {
        generateViewHierarchyXml: () => device.generateViewHierarchyXml(true),
        elementForSelector: (selector) => element(by.id(selector)),
        runOwned: ownedAction,
      },
    });
    await cancellationFence();
    const identity = await readOwnedChildIdentity();
    const actionXmlFile = `${command.label}-action.private.xml`;
    const actionAttributesBeforeFile = `${command.label}-action-attributes-before.private.json`;
    const actionAttributesAfterFile = `${command.label}-action-attributes-after.private.json`;
    const actionXmlBytes = Buffer.from(result.hierarchyXml, 'utf8');
    const actionAttributesBeforeBytes = Buffer.from(
      JSON.stringify(result.attributesBefore) + '\n',
      'utf8',
    );
    const actionAttributesAfterBytes = Buffer.from(
      JSON.stringify(result.attributesAfter) + '\n',
      'utf8',
    );
    const publish = async (name, bytes) => {
      await cancellationFence();
      const receipt = await connectionEvidence.writeAtomicDetoxConnectionBytes(
        artifactRoot,
        name,
        bytes,
        16 * 1024 * 1024,
        { deadlineAt: activeCommandDeadlineAt },
      );
      const published = { name, metadata: receipt.metadata };
      publishedFiles.push(published);
      await runtime.onPublished?.(published);
      return receipt;
    };
    await publish(actionXmlFile, actionXmlBytes);
    await cancellationFence();
    await publish(actionAttributesBeforeFile, actionAttributesBeforeBytes);
    await cancellationFence();
    await publish(actionAttributesAfterFile, actionAttributesAfterBytes);
    await cancellationFence();
    return {
      kind: result.kind,
      selector: result.selector,
      selectorKind: result.selectorKind,
      actionXmlFile,
      actionAttributesBeforeFile,
      actionAttributesAfterFile,
      actionXmlSha256: sha256(actionXmlBytes),
      actionAttributesBeforeSha256: sha256(actionAttributesBeforeBytes),
      actionAttributesAfterSha256: sha256(actionAttributesAfterBytes),
      sourceReceipts: {
        xml: memorySourceReceipt(
          'detox.device.generateViewHierarchyXml',
          actionXmlBytes,
          identity,
          command,
        ),
        attributesBefore: memorySourceReceipt(
          'detox.element.getAttributes',
          actionAttributesBeforeBytes,
          identity,
          command,
        ),
        attributesAfter: memorySourceReceipt(
          'detox.element.getAttributes',
          actionAttributesAfterBytes,
          identity,
          command,
        ),
      },
      resolution: result.resolution,
      publishedFiles,
      tapCompleted: result.tapCompleted,
    };
  } catch (error) {
    const cleanup = await recoverDedicatedActionFiles(command, publishedFiles, error);
    const wrapped = error instanceof Error ? error : new Error(String(error));
    wrapped.detoxActionCleanup = cleanup;
    throw wrapped;
  } finally {
    if (restoreCommand) {
      activeCommand = restoreCommand.command;
      activeCommandDeadlineAt = restoreCommand.deadlineAt;
    }
  }
}

function attributesFor(selector, kind) {
  return element(kind === 'text' ? by.text(selector) : by.id(selector)).getAttributes();
}

async function capture(command, action) {
  await cancellationFence();
  const identity = await readOwnedChildIdentity();
  const startedMonotonicMs = performance.now();
  const targetSelectors = selectors(command.selectors);
  const before = [];
  for (const selector of targetSelectors)
    before.push(await ownedAction(() => attributesFor(selector, command.selectorKind)));
  const xml = Buffer.from(await ownedAction(() => device.generateViewHierarchyXml(true)), 'utf8');
  const screenshotSource = await ownedAction(() => device.takeScreenshot(command.label));
  const screenshotReceipt = await screenshotSourceReceipt(screenshotSource, identity, command);
  const screenshot = await connectionEvidence.readOwnedDetoxConnectionFile(
    artifactRoot,
    String(screenshotReceipt.sourceSnapshotPath),
    16 * 1024 * 1024,
    { checkLive: cancellationFence, deadlineAt: activeCommandDeadlineAt },
  );
  requireDetoxPngBytes(screenshot, 'Detox screenshot owned snapshot');
  await cancellationFence();
  const after = [];
  for (const selector of targetSelectors)
    after.push(await ownedAction(() => attributesFor(selector, command.selectorKind)));
  const xmlFile = `${command.label}.private.xml`;
  const screenshotFile = `${command.label}.private.png`;
  const attributesBeforeFile = `${command.label}-attributes-before.private.json`;
  const attributesAfterFile = `${command.label}-attributes-after.private.json`;
  const beforeBytes = Buffer.from(JSON.stringify(before) + '\n');
  const afterBytes = Buffer.from(JSON.stringify(after) + '\n');
  await cancellationFence();
  await privateWrite(xmlFile, xml);
  await cancellationFence();
  await privateWrite(screenshotFile, screenshot);
  await cancellationFence();
  await privateWrite(attributesBeforeFile, beforeBytes);
  await cancellationFence();
  await privateWrite(attributesAfterFile, afterBytes);
  await cancellationFence();
  const selectorsReceipt = targetSelectors.map((selector, index) => ({
    selector,
    kind: command.selectorKind,
    before: before[index],
    after: after[index],
    frameStable: true,
  }));
  const finishedMonotonicMs = performance.now();
  return {
    schemaVersion: 1,
    kind: 'private-detox-connection-observation',
    commandId: command.commandId,
    commandHash: command.commandHash,
    label: command.label,
    actor: command.actor,
    platform,
    viewId: command.viewId,
    xmlFile,
    screenshotFile,
    attributesBeforeFile,
    attributesAfterFile,
    xmlSha256: sha256(xml),
    screenshotSha256: sha256(screenshot),
    attributesBeforeSha256: sha256(beforeBytes),
    attributesAfterSha256: sha256(afterBytes),
    sourceReceipts: {
      xml: memorySourceReceipt('detox.device.generateViewHierarchyXml', xml, identity, command),
      screenshot: screenshotReceipt,
      attributesBefore: memorySourceReceipt(
        'detox.element.getAttributes',
        beforeBytes,
        identity,
        command,
      ),
      attributesAfter: memorySourceReceipt(
        'detox.element.getAttributes',
        afterBytes,
        identity,
        command,
      ),
    },
    selectors: selectorsReceipt,
    ...(action ? { action } : {}),
    startedMonotonicMs,
    finishedMonotonicMs,
    actionCompleted: true,
    hierarchyCaptured: true,
    screenshotCaptured: true,
  };
}

async function executeObserve(command) {
  const ids = selectors(command.selectors);
  const dynamicId = extractConnectionId(ids);
  if (dynamicId) connectionId = dynamicId;
  let action;
  switch (command.label) {
    case 'connection-coach-invite':
      await scrollToId(profile.coachInviteCode, profile.coachHome);
      break;
    case 'connection-normal-coach-pending':
      await scrollToId(profile.coachPendingConnections, profile.coachHome, 'up');
      await tapId(profile.coachPendingConnections);
      await waitForId(profile.coachPendingScreen);
      break;
    case 'connection-normal-coach-roster':
      await tapId(profile.coachPendingBack);
      await scrollToId(profile.coachRoster, profile.coachHome);
      await tapId(profile.coachRoster);
      await waitForId(profile.coachRosterScreen);
      break;
    case 'connection-student-entry':
      await tapId(profile.studentProfessionalsEntry);
      await waitForId(profile.studentCodeInput);
      await waitForIdAbsent('student.professionals.loading');
      break;
    case 'connection-submit':
      if (!inviteCode) throw new Error('Detox student submit has no captured invite code');
      await ownedAction(() => element(by.id(profile.studentCodeInput)).replaceText(inviteCode));
      await tapId(profile.studentConnect);
      await waitForId(profile.studentProfessionalsScreen);
      break;
    case 'connection-student-pending':
      if (!dynamicId)
        throw new Error('Detox pending student selector has no dynamic connection ID');
      await scrollToId(
        `${profile.pendingStudentCardPrefix}${dynamicId}`,
        profile.studentProfessionalsScreen,
      );
      break;
    case 'connection-coach-pending-roster':
      if (!dynamicId) throw new Error('Detox pending roster selector has no dynamic connection ID');
      await scrollToId(profile.coachRoster, profile.coachHome);
      await tapId(profile.coachRoster);
      await tapId(profile.coachPendingFilter);
      await scrollToId(`pro.students.row.${dynamicId}`, profile.coachRosterScreen);
      break;
    case 'connection-coach-no-active-roster':
      if (!connectionId) throw new Error('Detox active roster negative check has no connection ID');
      await tapId(profile.coachActiveFilter);
      await ownedAction(() =>
        expect(element(by.id(`pro.students.row.${connectionId}`)))
          .not.toBeVisible()
          .withTimeout(90_000),
      );
      break;
    case 'connection-coach-return-home':
      await tapId('tabs.home');
      await waitForId(profile.coachHome);
      break;
    case 'connection-coach-pending':
      if (!connectionId) throw new Error('Detox coach pending queue has no connection ID');
      await scrollToId(profile.coachPendingConnections, profile.coachHome, 'up');
      await tapId(profile.coachPendingConnections);
      await waitForId(profile.coachPendingScreen);
      await ownedAction(() =>
        waitFor(element(by.text(connectionId)))
          .toBeVisible()
          .withTimeout(90_000),
      );
      break;
    case 'connection-confirm':
      try {
        action = await runDedicatedAction(command);
        if (connectionId)
          await ownedAction(() =>
            expect(element(by.text(connectionId)))
              .not.toBeVisible()
              .withTimeout(90_000),
          );
      } catch (error) {
        if (action?.publishedFiles?.length) error.detoxActionReceipt = action;
        throw error;
      }
      break;
    case 'connection-coach-roster':
      if (!dynamicId) throw new Error('Detox active roster selector has no dynamic connection ID');
      await tapId(profile.coachPendingBack);
      await scrollToId(profile.coachRoster, profile.coachHome);
      await tapId(profile.coachRoster);
      await tapId(profile.coachActiveFilter);
      await scrollToId(`pro.students.row.${dynamicId}`, profile.coachRosterScreen);
      break;
    case 'connection-student-active':
      if (!dynamicId) throw new Error('Detox student active selector has no dynamic connection ID');
      await tapId(profile.studentProfessionalsEntry);
      await scrollToId(
        `${profile.activeStudentCardPrefix}${dynamicId}`,
        profile.studentProfessionalsScreen,
      );
      if (command.action) {
        try {
          action = await runDedicatedAction(command);
        } catch (error) {
          if (action?.publishedFiles?.length) error.detoxActionReceipt = action;
          throw error;
        }
      }
      break;
    default:
      throw new Error(`Detox connection step is not explicitly mapped: ${command.label}`);
  }
  let observation;
  try {
    observation = await capture(command, action);
    const inviteAttributes = observation.selectors.find(
      (row) => row.selector === profile.coachInviteCode,
    );
    if (command.label === 'connection-coach-invite' && inviteAttributes) {
      const value =
        inviteAttributes.after.accessibilityText ||
        inviteAttributes.after.text ||
        inviteAttributes.after.value;
      const match = /(?:^|: )([A-F0-9]{8})$/.exec(String(value || ''));
      if (!match)
        throw new Error('Detox coach invite attribute did not contain an owned invite code');
      inviteCode = match[1];
    }
    return observation;
  } catch (error) {
    if (action?.publishedFiles?.length) error.detoxActionReceipt = action;
    throw error;
  }
}

async function executeSwitch(command) {
  if (command.navigation === 'student-professionals-back')
    await tapId(profile.studentProfessionalsBack);
  await tapId(profile.accountTab);
  await waitForId('settings.account.screen');
  await scrollToId(profile.signOut, 'settings.account.screen');
  await tapId(profile.signOut);
  await scrollToId(profile.signOutConfirm, 'settings.account.screen');
  await tapId(profile.signOutConfirm);
  await waitForId('auth.signIn.title');
  currentActor = command.actor;
  await signIn(
    currentActor === 'coach' ? coachEmail : studentEmail,
    currentActor === 'coach' ? coachPassword : studentPassword,
    currentActor === 'coach' ? profile.coachHome : profile.studentHome,
  );
  return capture({
    ...command,
    label: command.label,
    viewId: currentActor === 'coach' ? 'SCR-pro-home' : 'SCR-student-home',
    selectors: currentActor === 'coach' ? profile.coachHome : profile.studentHome,
    actor: currentActor,
  });
}

async function publishResponse(command, response) {
  await privatePublish(`detox-connection-response-${command.commandId}.private.json`, response);
}

function cancelledResponse(command, startedMonotonicMs, observations = [], actionCleanup) {
  return {
    schemaVersion: 1,
    kind: 'private-detox-connection-response',
    commandId: command.commandId,
    commandHash: command.commandHash,
    commandKind: command.kind,
    status: 'cancelled',
    actor: command.actor,
    platform,
    observations,
    ...(actionCleanup ? { actionCleanup } : {}),
    error: { name: 'AbortError', message: 'Detox parent cancelled the owned command' },
    ...childIdentityFields(),
    startedMonotonicMs,
    finishedMonotonicMs: performance.now(),
  };
}

async function publishConnectionTerminalError(command, startedMonotonicMs, observations, error) {
  const actionCleanup =
    error?.detoxActionCleanup ??
    (error?.detoxActionReceipt?.publishedFiles?.length
      ? await recoverDedicatedActionFiles(command, error.detoxActionReceipt.publishedFiles, error)
      : command.action
        ? { status: 'not-started', files: [] }
        : undefined);
  let cancellationRequested = false;
  let cancellationProbeError;
  try {
    cancellationRequested = await commandCancelled(command);
  } catch (probeError) {
    cancellationProbeError = probeError;
  }
  if (cancellationRequested && !cancellationProbeError) {
    await publishResponse(
      command,
      cancelledResponse(command, startedMonotonicMs, observations, actionCleanup),
    );
    return { status: 'cancelled', actionCleanup };
  }
  const reportedError = cancellationProbeError ?? error;
  await publishResponse(command, {
    schemaVersion: 1,
    kind: 'private-detox-connection-response',
    commandId: command.commandId,
    commandHash: command.commandHash,
    commandKind: command.kind,
    status: 'failed',
    actor: command.actor,
    platform,
    observations: typeof observations === 'undefined' ? [] : observations,
    ...(actionCleanup ? { actionCleanup } : {}),
    error: {
      name: reportedError?.name || 'Error',
      message: reportedError?.message || String(reportedError),
    },
    ...childIdentityFields(),
    startedMonotonicMs,
    finishedMonotonicMs: performance.now(),
  });
  return { status: 'failed', actionCleanup };
}

async function trainingCancellation(command, protocol) {
  try {
    const value = JSON.parse(
      (
        await protocol.readOwnedTrainingFile(
          artifactRoot,
          `detox-training-cancel-${command.commandId}.private.json`,
          16 * 1024,
        )
      ).toString('utf8'),
    );
    if (
      value.schemaVersion !== 1 ||
      value.kind !== 'private-detox-training-cancel' ||
      value.commandId !== command.commandId ||
      value.commandHash !== command.commandHash
    )
      throw new Error('Detox training cancellation identity changed');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function monitorTrainingCancellation(command, controller, protocol) {
  while (!controller.signal.aborted) {
    if (await trainingCancellation(command, protocol)) {
      controller.abort(new Error('Detox training action cancelled'));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function trainingResponse(command, status, startedMonotonicMs, fields = {}) {
  return {
    schemaVersion: 1,
    kind: 'private-detox-training-response',
    commandId: command.commandId,
    commandHash: command.commandHash,
    commandKind: command.commandKind,
    runId: command.runId,
    attemptId: command.attemptId,
    platform: command.platform,
    status,
    childIdentity: ownedChildIdentity,
    startedMonotonicMs,
    finishedMonotonicMs: performance.now(),
    ...fields,
  };
}

async function publishTrainingResult(
  protocol,
  command,
  controller,
  startedMonotonicMs,
  status,
  fields = {},
) {
  let finalStatus = status;
  if (
    status === 'completed' &&
    (controller.signal.aborted || (await trainingCancellation(command, protocol)))
  )
    finalStatus = 'cancelled';
  const response = trainingResponse(command, finalStatus, startedMonotonicMs, fields);
  try {
    await protocol.publishTrainingResponse(
      artifactRoot,
      response,
      finalStatus === 'completed'
        ? { signal: controller.signal, deadlineAt: startedMonotonicMs + command.timeoutMs }
        : {},
    );
  } catch (error) {
    if (
      finalStatus === 'completed' &&
      (controller.signal.aborted || (await trainingCancellation(command, protocol)))
    ) {
      await protocol.publishTrainingResponse(
        artifactRoot,
        trainingResponse(command, 'cancelled', startedMonotonicMs),
      );
      return;
    }
    throw error;
  }
}

async function executeTrainingCommand(command, protocol) {
  const startedMonotonicMs = performance.now();
  const controller = new AbortController();
  const runtime = {
    artifactRoot,
    runId: command.runId,
    attemptId: command.attemptId,
    platform: command.platform,
    childIdentity: ownedChildIdentity,
    commandId: command.commandId,
    commandHash: command.commandHash,
    signal: controller.signal,
    deadlineAt: startedMonotonicMs + command.timeoutMs,
    device,
    element,
    by,
    expect,
  };
  const monitor = monitorTrainingCancellation(command, controller, protocol);
  try {
    if (await trainingCancellation(command, protocol)) {
      await publishTrainingResult(protocol, command, controller, startedMonotonicMs, 'cancelled');
      return command.commandKind === 'shutdown';
    }
    if (command.commandKind === 'training-step') {
      const stepReceipt = await executeTrainingStep(runtime, command.step);
      await publishTrainingResult(protocol, command, controller, startedMonotonicMs, 'completed', {
        stepReceipt,
      });
      return false;
    }
    if (command.commandKind === 'restart-app') {
      const restartReceipt = await restartTrainingApp(runtime, {
        appIdentifier: command.appIdentifier,
        launchCount: command.launchCount,
      });
      await publishTrainingResult(protocol, command, controller, startedMonotonicMs, 'completed', {
        restartReceipt,
      });
      return false;
    }
    await publishTrainingResult(protocol, command, controller, startedMonotonicMs, 'completed');
    return true;
  } catch (error) {
    const cancelled = controller.signal.aborted || (await trainingCancellation(command, protocol));
    await publishTrainingResult(
      protocol,
      command,
      controller,
      startedMonotonicMs,
      cancelled ? 'cancelled' : 'failed',
      cancelled
        ? {}
        : { error: { name: error?.name || 'Error', message: error?.message || String(error) } },
    );
    throw error;
  } finally {
    controller.abort();
    await monitor;
  }
}

async function nextTrainingCommand(protocol) {
  const deadlineAt = performance.now() + 600_000;
  const command = await protocol.waitForTrainingCommand({
    root: artifactRoot,
    afterCommandId: lastTrainingCommandId,
    deadlineAt,
  });
  if (command.platform !== platform) throw new Error('Detox training platform changed');
  lastTrainingCommandId = command.commandId;
  return command;
}

async function nextCommand() {
  const deadline = performance.now() + 600_000;
  for (;;) {
    const names = (await readdir(artifactRoot)).filter((name) =>
      /^detox-connection-command-\d+\.private\.json$/.test(name),
    );
    const ids = names
      .map((name) => Number(name.match(/(\d+)/)[1]))
      .filter((id) => id > lastCommandId)
      .sort((a, b) => a - b);
    if (ids.length) {
      const command = JSON.parse(
        await (
          await ownedRead(`detox-connection-command-${ids[0]}.private.json`, 128 * 1024)
        ).toString('utf8'),
      );
      if (command.platform !== platform || command.commandHash !== commandHash(command))
        throw new Error('Detox IPC command identity changed');
      lastCommandId = command.commandId;
      return command;
    }
    if (performance.now() >= deadline)
      throw new Error('Detox IPC child command wait deadline elapsed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function saveRetryCancellation(command) {
  try {
    const value = JSON.parse(
      (
        await connectionEvidence.readOwnedDetoxConnectionFile(
          artifactRoot,
          `detox-save-retry-cancel-${command.commandId}.private.json`,
          16 * 1024,
        )
      ).toString('utf8'),
    );
    if (
      value.schemaVersion !== 1 ||
      value.kind !== 'private-detox-save-retry-cancel' ||
      value.commandId !== command.commandId ||
      value.commandHash !== command.commandHash
    )
      throw new Error('Detox save/retry cancellation identity changed');
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function monitorSaveRetryCancellation(command, controller) {
  while (!controller.signal.aborted) {
    if (await saveRetryCancellation(command)) {
      controller.abort(new Error('Detox save/retry action cancelled'));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function saveRetryResponse(command, status, startedMonotonicMs, fields = {}) {
  return {
    schemaVersion: 1,
    kind: 'private-detox-save-retry-response',
    commandId: command.commandId,
    commandHash: command.commandHash,
    commandKind: command.commandKind,
    runId: command.runId,
    attemptId: command.attemptId,
    platform: command.platform,
    status,
    childIdentity: ownedChildIdentity,
    startedMonotonicMs,
    finishedMonotonicMs: performance.now(),
    ...fields,
  };
}

async function publishSaveRetryResponse(command, response) {
  await connectionEvidence.writeAtomicDetoxConnectionBytes(
    artifactRoot,
    `detox-save-retry-response-${command.commandId}.private.json`,
    Buffer.from(JSON.stringify(response) + '\n'),
    2 * 1024 * 1024,
  );
}

async function executeSaveRetryCommand(command) {
  const startedMonotonicMs = performance.now();
  const controller = new AbortController();
  const runtime = {
    artifactRoot,
    platform: command.platform,
    childIdentity: ownedChildIdentity,
    signal: controller.signal,
    deadlineAt: startedMonotonicMs + 600_000,
    device,
    element,
    by,
    waitFor,
    parseHierarchy: (xml, currentPlatform) => {
      if (currentPlatform !== platform)
        throw new Error('Detox save/retry runtime platform changed');
      return require('../scripts/testing/detox-native-hierarchy.ts').parseDetoxViewHierarchyXml(
        xml,
        currentPlatform,
      );
    },
    shutdown: async () => undefined,
  };
  const monitor = monitorSaveRetryCancellation(command, controller);
  try {
    let response = await runDetoxSaveRetryChildCommand(command, runtime);
    if (
      response.status === 'completed' &&
      (controller.signal.aborted || (await saveRetryCancellation(command)))
    )
      response = saveRetryResponse(command, 'cancelled', startedMonotonicMs);
    await publishSaveRetryResponse(command, response);
    return command.commandKind === 'shutdown';
  } finally {
    controller.abort();
    await monitor;
  }
}

async function nextSaveRetryCommand() {
  const protocol = await saveRetryProtocolPromise;
  const deadlineAt = performance.now() + 600_000;
  for (;;) {
    const names = await readdir(artifactRoot);
    const ids = names
      .filter((name) => /^detox-save-retry-command-[1-9][0-9]*\.private\.json$/.test(name))
      .map((name) => Number(name.match(/(\d+)/)[1]))
      .filter((id) => id > lastSaveRetryCommandId)
      .sort((a, b) => a - b);
    if (ids.length) {
      const command = protocol.assertDetoxSaveRetryCommand(
        JSON.parse(
          (
            await connectionEvidence.readOwnedDetoxConnectionFile(
              artifactRoot,
              `detox-save-retry-command-${ids[0]}.private.json`,
              128 * 1024,
            )
          ).toString('utf8'),
        ),
      );
      if (command.platform !== platform) throw new Error('Detox save/retry platform changed');
      lastSaveRetryCommandId = command.commandId;
      return command;
    }
    if (performance.now() >= deadlineAt)
      throw new Error('Detox save/retry child command wait deadline elapsed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function nextOwnedCommand(protocol) {
  const deadlineAt = performance.now() + 600_000;
  for (;;) {
    const names = await readdir(artifactRoot);
    const connectionIds = names
      .filter((name) => /^detox-connection-command-\d+\.private\.json$/.test(name))
      .map((name) => Number(name.match(/(\d+)/)[1]))
      .filter((id) => id > lastCommandId)
      .sort((a, b) => a - b);
    if (connectionIds.length) return { kind: 'connection', command: await nextCommand() };
    const trainingIds = names
      .filter((name) => /^detox-training-command-[1-9][0-9]*\.private\.json$/.test(name))
      .map((name) => Number(name.match(/(\d+)/)[1]))
      .filter((id) => id > lastTrainingCommandId)
      .sort((a, b) => a - b);
    if (trainingIds.length)
      return { kind: 'training', command: await nextTrainingCommand(protocol) };
    const saveRetryIds = names
      .filter((name) => /^detox-save-retry-command-[1-9][0-9]*\.private\.json$/.test(name))
      .map((name) => Number(name.match(/(\d+)/)[1]))
      .filter((id) => id > lastSaveRetryCommandId)
      .sort((a, b) => a - b);
    if (saveRetryIds.length) return { kind: 'save-retry', command: await nextSaveRetryCommand() };
    if (performance.now() >= deadlineAt)
      throw new Error('Detox owned child command wait deadline elapsed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

module.exports = {
  runDedicatedAction,
  screenshotSourceReceipt,
  publishConnectionTerminalError,
};

describe('owned integrated Detox connection journey', () => {
  test('runs the actual SDK bridge and publishes only owned observations', async () => {
    await verifyRunnerSourceIdentity();
    await connectionEvidence.ensureDetoxConnectionArtifactRoot(artifactRoot);
    await readOwnedChildIdentity();
    await launchFresh();
    await privateWrite('detox-connection-ready.private.json', {
      kind: 'private-detox-connection-ready',
      platform,
      childIdentity: ownedChildIdentity,
      launchCount,
      synchronizationDisabled: true,
    });
    const trainingProtocol = await trainingProtocolPromise;
    let shutdown = false;
    while (!shutdown) {
      const owned = await nextOwnedCommand(trainingProtocol);
      if (owned.kind === 'training') {
        shutdown = await executeTrainingCommand(owned.command, trainingProtocol);
        continue;
      }
      if (owned.kind === 'save-retry') {
        shutdown = await executeSaveRetryCommand(owned.command);
        continue;
      }
      const command = owned.command;
      activeCommand = command;
      activeCommandDeadlineAt = performance.now() + 600_000;
      const startedMonotonicMs = performance.now();
      let observations;
      try {
        if (command.kind !== 'shutdown' && (await commandCancelled(command))) {
          await publishResponse(
            command,
            cancelledResponse(
              command,
              startedMonotonicMs,
              [],
              command.action ? { status: 'not-started', files: [] } : undefined,
            ),
          );
          continue;
        }
        if (command.kind === 'shutdown') {
          shutdown = true;
          await publishResponse(command, {
            schemaVersion: 1,
            kind: 'private-detox-connection-response',
            commandId: command.commandId,
            commandHash: command.commandHash,
            commandKind: command.kind,
            status: 'completed',
            actor: currentActor,
            platform,
            observations: [],
            ...childIdentityFields(),
            startedMonotonicMs,
            finishedMonotonicMs: performance.now(),
          });
          continue;
        }
        if (command.kind === 'bootstrap') {
          await signIn(coachEmail, coachPassword, profile.coachHome);
          currentActor = 'coach';
          observations = [await capture(command)];
        } else if (command.kind === 'observe') observations = [await executeObserve(command)];
        else if (command.kind === 'switch-account') {
          const observation = await executeSwitch(command);
          observations = [observation];
        } else throw new Error(`Unsupported Detox command: ${command.kind}`);
        if (await commandCancelled(command)) {
          const actionCleanup = await terminalActionCleanup(
            command,
            observations,
            new Error('Detox parent cancelled after action evidence publication'),
          );
          await publishResponse(
            command,
            cancelledResponse(command, startedMonotonicMs, observations, actionCleanup),
          );
          continue;
        }
        await publishResponse(command, {
          schemaVersion: 1,
          kind: 'private-detox-connection-response',
          commandId: command.commandId,
          commandHash: command.commandHash,
          commandKind: command.kind,
          status: 'completed',
          actor: currentActor,
          platform,
          observations,
          ...(command.action
            ? {
                actionCleanup: observations[0]?.action
                  ? actionCleanupForPublishedFiles(observations[0].action.publishedFiles)
                  : { status: 'not-started', files: [] },
              }
            : {}),
          ...(command.kind === 'switch-account'
            ? { accountSwitch: { actor: currentActor, navigation: command.navigation } }
            : {}),
          ...childIdentityFields(),
          startedMonotonicMs,
          finishedMonotonicMs: performance.now(),
        });
      } catch (error) {
        const terminal = await publishConnectionTerminalError(
          command,
          startedMonotonicMs,
          observations,
          error,
        );
        if (terminal.status === 'cancelled') continue;
        throw error;
      } finally {
        activeCommand = undefined;
        activeCommandDeadlineAt = undefined;
      }
    }
  }, 600_000);
});
