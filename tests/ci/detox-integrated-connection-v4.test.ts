import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  isDetoxConnectionPublicationPending,
  readOwnedDetoxConnectionFile,
  writeAtomicDetoxConnectionBytes,
} from '../../scripts/testing/detox-connection-evidence';
import {
  DetoxConnectionIpcClient,
  publishDetoxConnectionResponse,
  requireDetoxConnectionCommand,
  requireDetoxConnectionObservation,
  requireStableDetoxElementAttributes,
  type DetoxConnectionCommand,
  waitForDetoxConnectionCommand,
  type DetoxConnectionOwnedProcessIdentity,
  type DetoxConnectionObservationReceipt,
} from '../../scripts/testing/detox-connection-ipc';
import { createDetoxConnectionRuntimeContext } from '../../scripts/testing/detox-integrated-connection-baseline';
import {
  buildDetoxConnectionLedgerFromActualReport,
  createDetoxConnectionProducerReport,
  validateDetoxConnectionRunnerPaths,
} from '../../scripts/testing/detox-integrated-connection-driver';
import {
  applyDetoxElementAttributeEvidence,
  parseDetoxViewHierarchyXml,
} from '../../scripts/testing/detox-native-hierarchy';

const validIosAttributes = (identifier: string, frame = { x: 0, y: 0, width: 100, height: 40 }) =>
  ({
    identifier,
    enabled: true,
    visible: true,
    hittable: true,
    frame,
  }) as unknown as DetoxConnectionObservationReceipt['selectors'][number]['before'];

const fixtureChild: DetoxConnectionOwnedProcessIdentity = {
  pid: process.pid,
  pgid: process.pid,
  started: 'fixture-child-start',
};

const canonicalValue = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonicalValue).join(',')}]`
    : value && typeof value === 'object'
      ? `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, child]) => `${JSON.stringify(key)}:${canonicalValue(child)}`)
          .join(',')}}`
      : JSON.stringify(value);

const hashJson = (value: unknown): string =>
  createHash('sha256').update(canonicalValue(value)).digest('hex');

const hashBytes = (value: Buffer): string => createHash('sha256').update(value).digest('hex');

const fixtureRepositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function validPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
}

void test('Detox actionability requires visible, iOS hittable and stable owned frames', () => {
  const result = requireStableDetoxElementAttributes({
    platform: 'ios',
    selector: 'pro.home.screen',
    before: validIosAttributes('pro.home.screen'),
    after: validIosAttributes('pro.home.screen'),
  });
  assert.equal(result.frameStable, true);
  assert.throws(
    () =>
      requireStableDetoxElementAttributes({
        platform: 'ios',
        selector: 'pro.home.screen',
        before: validIosAttributes('pro.home.screen'),
        after: validIosAttributes('pro.home.screen', { x: 1, y: 0, width: 100, height: 40 }),
      }),
    /Expected values|frame|stable/i,
  );
  assert.throws(
    () =>
      requireStableDetoxElementAttributes({
        platform: 'ios',
        selector: 'pro.home.screen',
        before: validIosAttributes('pro.home.screen'),
        after: { ...validIosAttributes('pro.home.screen'), visible: false },
      }),
    /visible/i,
  );
  assert.throws(
    () =>
      requireStableDetoxElementAttributes({
        platform: 'ios',
        selector: 'pro.home.screen',
        before: validIosAttributes('pro.home.screen'),
        after: { ...validIosAttributes('pro.home.screen'), hittable: false },
      }),
    /hittable/i,
  );
});

void test('Detox IPC command hash binds the full actor/action/selector contract', () => {
  const base = {
    schemaVersion: 1 as const,
    commandId: 1,
    kind: 'observe' as const,
    platform: 'ios' as const,
    actor: 'coach' as const,
    navigation: 'none' as const,
    label: 'connection-coach-invite',
    semanticActions: 'scroll to the owned invite control',
    viewId: 'SCR-pro-home',
    selectors: 'pro.home.inviteCodeValue',
    selectorKind: 'id' as const,
  };
  const canonical = (value: unknown): string =>
    Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : value && typeof value === 'object'
        ? `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
            .join(',')}}`
        : JSON.stringify(value);
  const command = {
    ...base,
    commandHash: createHash('sha256')
      .update(canonical({ ...base, commandHash: undefined }))
      .digest('hex'),
  };
  assert.deepEqual(requireDetoxConnectionCommand(command), command);
  assert.throws(
    () => requireDetoxConnectionCommand({ ...command, selectors: 'tabs.account' }),
    /hash/i,
  );
  const duplicateSelectors = {
    ...base,
    selectors: ['pro.home.screen', 'pro.home.screen'],
    commandHash: createHash('sha256')
      .update(
        canonical({
          ...base,
          selectors: ['pro.home.screen', 'pro.home.screen'],
          commandHash: undefined,
        }),
      )
      .digest('hex'),
  };
  assert.throws(() => requireDetoxConnectionCommand(duplicateSelectors), /duplicate/i);
});

const ipcInput = {
  kind: 'observe' as const,
  actor: 'coach' as const,
  navigation: 'none' as const,
  label: 'connection-ipc-fixture',
  semanticActions: 'read the controlled fixture command',
  viewId: 'SCR-pro-home',
  selectors: 'pro.home.screen',
  selectorKind: 'id' as const,
};

void test('Detox IPC binds a real command envelope to the child response', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-connection-ipc-')));
  await chmod(root, 0o700);
  const client = new DetoxConnectionIpcClient({
    artifactRoot: root,
    platform: 'ios',
    signal: new AbortController().signal,
    deadlineMs: 2_000,
    expectedChild: fixtureChild,
  });
  let responder: Promise<DetoxConnectionCommand> | undefined;
  try {
    responder = (async () => {
      const command = await waitForDetoxConnectionCommand({
        artifactRoot: root,
        platform: 'ios',
        afterCommandId: 0,
      });
      await publishDetoxConnectionResponse(root, {
        schemaVersion: 1,
        kind: 'private-detox-connection-response',
        commandId: command.commandId,
        commandHash: command.commandHash,
        commandKind: command.kind,
        status: 'completed',
        actor: command.actor,
        platform: command.platform,
        observations: [{} as DetoxConnectionObservationReceipt],
        childPid: fixtureChild.pid,
        childPgid: fixtureChild.pgid,
        childStarted: fixtureChild.started,
        startedMonotonicMs: 1,
        finishedMonotonicMs: 2,
      });
      return command;
    })();
    const response = await client.request(ipcInput);
    const command = await responder;
    assert.equal(response.status, 'completed');
    assert.equal(response.commandId, command.commandId);
    assert.equal(response.commandHash, command.commandHash);
    assert.equal(response.commandKind, 'observe');
  } finally {
    client.close();
    await Promise.allSettled(responder ? [responder] : []);
    await rm(root, { recursive: true, force: true });
  }
});

void test(
  'Detox IPC waits for an owned final inode to finish publication',
  { concurrency: false },
  async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-connection-publish-')));
    await chmod(root, 0o700);
    const commandBase = {
      schemaVersion: 1 as const,
      commandId: 1,
      kind: 'observe' as const,
      platform: 'ios' as const,
      actor: 'coach' as const,
      navigation: 'none' as const,
      label: 'connection-publication-fixture',
      semanticActions: 'wait for the owned publication inode',
      viewId: 'SCR-pro-home',
      selectors: 'pro.home.screen',
      selectorKind: 'id' as const,
    };
    const command = {
      ...commandBase,
      commandHash: hashJson({ ...commandBase, commandHash: undefined }),
    };
    const name = 'detox-connection-command-1.private.json';
    let release: () => void = () => undefined;
    let linked: () => void = () => undefined;
    const linkedPromise = new Promise<void>((resolve) => {
      linked = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    let commandPromise: Promise<DetoxConnectionCommand> | undefined;
    const publication = writeAtomicDetoxConnectionBytes(
      root,
      name,
      Buffer.from(JSON.stringify(command) + '\n'),
      64 * 1024,
      {
        beforePublish: async () => {
          commandPromise = waitForDetoxConnectionCommand({
            artifactRoot: root,
            platform: 'ios',
            afterCommandId: 0,
          });
          await new Promise((resolve) => setImmediate(resolve));
        },
        afterPublish: async () => {
          linked();
          await releasePromise;
        },
      },
    );
    try {
      await linkedPromise;
      assert.equal(await isDetoxConnectionPublicationPending(root, name), true);
      await new Promise((resolve) => setTimeout(resolve, 250));
      release();
      await publication;
      assert.deepEqual(await commandPromise, command);
    } finally {
      release();
      await Promise.allSettled(
        [publication, commandPromise].filter((value) => value !== undefined),
      );
      await rm(root, { recursive: true, force: true });
    }
  },
);

void test('Detox IPC does not classify a foreign hardlink as publication', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-connection-hardlink-')));
  await chmod(root, 0o700);
  const name = 'detox-connection-command-1.private.json';
  const file = path.join(root, name);
  const foreign = path.join(root, `${name}.foreign`);
  try {
    await writeFile(file, '{"foreign":true}\n', { mode: 0o600 });
    await link(file, foreign);
    assert.equal(await isDetoxConnectionPublicationPending(root, name), false);
    await assert.rejects(
      () => readOwnedDetoxConnectionFile(root, name, 64 * 1024),
      /owned bounded immutable/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Detox IPC publishes cancellation and never accepts a late completed response', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-connection-cancel-')));
  await chmod(root, 0o700);
  const controller = new AbortController();
  const client = new DetoxConnectionIpcClient({
    artifactRoot: root,
    platform: 'ios',
    signal: controller.signal,
    deadlineMs: 2_000,
    expectedChild: fixtureChild,
  });
  let commandPromise: Promise<DetoxConnectionCommand> | undefined;
  let responsePromise: ReturnType<DetoxConnectionIpcClient['request']> | undefined;
  try {
    commandPromise = waitForDetoxConnectionCommand({
      artifactRoot: root,
      platform: 'ios',
      afterCommandId: 0,
    });
    responsePromise = client.request(ipcInput);
    const command = await commandPromise;
    controller.abort(new Error('fixture cancellation'));
    let cancellation: Record<string, unknown> | undefined;
    const deadline = Date.now() + 1_000;
    while (!cancellation && Date.now() < deadline) {
      try {
        cancellation = JSON.parse(
          await readFile(
            path.join(root, `detox-connection-cancel-${command.commandId}.private.json`),
            'utf8',
          ),
        ) as Record<string, unknown>;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    assert(cancellation, 'Detox cancellation envelope was not published');
    assert.equal(cancellation.commandId, command.commandId);
    assert.equal(cancellation.commandHash, command.commandHash);
    await publishDetoxConnectionResponse(root, {
      schemaVersion: 1,
      kind: 'private-detox-connection-response',
      commandId: command.commandId,
      commandHash: command.commandHash,
      commandKind: command.kind,
      status: 'cancelled',
      actor: command.actor,
      platform: command.platform,
      observations: [],
      error: { name: 'AbortError', message: 'fixture cancelled' },
      childPid: fixtureChild.pid,
      childPgid: fixtureChild.pgid,
      childStarted: fixtureChild.started,
      startedMonotonicMs: 1,
      finishedMonotonicMs: 2,
    });
    const response = await responsePromise;
    assert.equal(response.status, 'cancelled');
  } finally {
    client.close();
    await Promise.allSettled(
      [commandPromise, responsePromise].filter((value) => value !== undefined),
    );
    await rm(root, { recursive: true, force: true });
  }
});

void test('Detox observation receipt re-reads owned XML/screenshot/attributes and rejects stale frames', async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-connection-observation-')),
  );
  await chmod(root, 0o700);
  try {
    const command = {
      schemaVersion: 1 as const,
      commandId: 1,
      kind: 'observe' as const,
      platform: 'ios' as const,
      actor: 'coach' as const,
      navigation: 'none' as const,
      label: 'connection-coach-invite',
      semanticActions: 'scroll',
      viewId: 'SCR-pro-home',
      selectors: 'pro.home.inviteCodeValue',
      selectorKind: 'id' as const,
    };
    const canonical = (value: unknown): string =>
      Array.isArray(value)
        ? `[${value.map(canonical).join(',')}]`
        : value && typeof value === 'object'
          ? `{${Object.entries(value)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
              .join(',')}}`
          : JSON.stringify(value);
    const commandHash = createHash('sha256')
      .update(canonical({ ...command, commandHash: undefined }))
      .digest('hex');
    const boundCommand = { ...command, commandHash };
    const xml = Buffer.from(
      '<ViewHierarchy><View class="View" width="100" height="100" visibility="visible" alpha="1" focused="false" x="0" y="0" id="pro.home.inviteCodeValue" label="ABCDEF12" /></ViewHierarchy>',
    );
    const screenshot = validPng();
    const attrs = [validIosAttributes('pro.home.inviteCodeValue')];
    const files = {
      xmlFile: 'connection-coach-invite.private.xml',
      screenshotFile: 'connection-coach-invite.private.png',
      attributesBeforeFile: 'connection-coach-invite-attributes-before.private.json',
      attributesAfterFile: 'connection-coach-invite-attributes-after.private.json',
    };
    await writeFile(path.join(root, files.xmlFile), xml, { mode: 0o600 });
    await writeFile(path.join(root, files.screenshotFile), screenshot, { mode: 0o600 });
    const beforeBytes = Buffer.from(JSON.stringify(attrs) + '\n');
    const afterBytes = Buffer.from(JSON.stringify(attrs) + '\n');
    await writeFile(path.join(root, files.attributesBeforeFile), beforeBytes, { mode: 0o600 });
    await writeFile(path.join(root, files.attributesAfterFile), afterBytes, { mode: 0o600 });
    const observation: Record<string, unknown> = {
      schemaVersion: 1,
      kind: 'private-detox-connection-observation',
      commandId: 1,
      commandHash,
      label: command.label,
      actor: 'coach',
      platform: 'ios',
      viewId: command.viewId,
      ...files,
      xmlSha256: createHash('sha256').update(xml).digest('hex'),
      screenshotSha256: createHash('sha256').update(screenshot).digest('hex'),
      attributesBeforeSha256: createHash('sha256').update(beforeBytes).digest('hex'),
      attributesAfterSha256: createHash('sha256').update(afterBytes).digest('hex'),
      selectors: [
        {
          selector: command.selectors,
          kind: 'id',
          before: attrs[0],
          after: attrs[0],
          frameStable: true,
        },
      ],
      startedMonotonicMs: 1,
      finishedMonotonicMs: 2,
      actionCompleted: true,
      hierarchyCaptured: true,
      screenshotCaptured: true,
    };
    const sourceRoot = path.join(root, 'detox-artifacts');
    await mkdir(sourceRoot, { recursive: true, mode: 0o700 });
    const sourceScreenshot = path.join(sourceRoot, 'original.private.png');
    await writeFile(sourceScreenshot, screenshot, { mode: 0o600 });
    const sourceStat = await lstat(sourceScreenshot);
    const sourceSnapshotPath = 'connection-observation-source.private.png';
    await writeFile(path.join(root, sourceSnapshotPath), screenshot, { mode: 0o600 });
    const sourceReceipt = {
      producer: 'detox.device.takeScreenshot',
      sourceKind: 'file',
      processPid: fixtureChild.pid,
      processPgid: fixtureChild.pgid,
      processStarted: fixtureChild.started,
      sourceBytes: screenshot.byteLength,
      sourceSha256: createHash('sha256').update(screenshot).digest('hex'),
      sourcePath: sourceScreenshot,
      sourceRealpath: sourceScreenshot,
      producerPath: sourceScreenshot,
      producerRealpath: sourceScreenshot,
      sourceMode: sourceStat.mode & 0o777,
      sourceUid: sourceStat.uid,
      sourceDev: sourceStat.dev,
      sourceIno: sourceStat.ino,
      sourceGid: sourceStat.gid,
      sourceNlink: sourceStat.nlink,
      sourceSnapshotPath,
      sourceSnapshotBytes: screenshot.byteLength,
      sourceSnapshotSha256: hashBytes(screenshot),
      sourceCommandId: command.commandId,
      sourceCommandHash: commandHash,
      sourceLabel: command.label,
    };
    observation.sourceReceipts = {
      xml: {
        producer: 'detox.device.generateViewHierarchyXml',
        sourceKind: 'memory',
        processPid: fixtureChild.pid,
        processPgid: fixtureChild.pgid,
        processStarted: fixtureChild.started,
        sourceBytes: xml.byteLength,
        sourceSha256: observation.xmlSha256,
        sourceCommandId: command.commandId,
        sourceCommandHash: commandHash,
        sourceLabel: command.label,
      },
      screenshot: sourceReceipt,
      attributesBefore: {
        producer: 'detox.element.getAttributes',
        sourceKind: 'memory',
        processPid: fixtureChild.pid,
        processPgid: fixtureChild.pgid,
        processStarted: fixtureChild.started,
        sourceBytes: beforeBytes.byteLength,
        sourceSha256: observation.attributesBeforeSha256,
        sourceCommandId: command.commandId,
        sourceCommandHash: commandHash,
        sourceLabel: command.label,
      },
      attributesAfter: {
        producer: 'detox.element.getAttributes',
        sourceKind: 'memory',
        processPid: fixtureChild.pid,
        processPgid: fixtureChild.pgid,
        processStarted: fixtureChild.started,
        sourceBytes: afterBytes.byteLength,
        sourceSha256: observation.attributesAfterSha256,
        sourceCommandId: command.commandId,
        sourceCommandHash: commandHash,
        sourceLabel: command.label,
      },
    };
    const result = await requireDetoxConnectionObservation(
      root,
      boundCommand,
      observation,
      fixtureChild,
    );
    assert.equal(result.observation.screenshotSha256, observation.screenshotSha256);
    assert.equal(result.hierarchy, xml.toString('utf8'));
    const attrsRecord = attrs[0] as unknown as Record<string, unknown>;
    const staleAfterBytes = Buffer.from(
      JSON.stringify([
        {
          ...attrsRecord,
          frame: { ...(attrsRecord.frame as Record<string, unknown>), x: 9 },
        },
      ]) + '\n',
    );
    await writeFile(path.join(root, files.attributesAfterFile), staleAfterBytes, { mode: 0o600 });
    await assert.rejects(
      () =>
        requireDetoxConnectionObservation(
          root,
          boundCommand,
          {
            ...observation,
            attributesAfterSha256: createHash('sha256').update(staleAfterBytes).digest('hex'),
            sourceReceipts: {
              ...(observation.sourceReceipts as Record<string, unknown>),
              attributesAfter: {
                ...(observation.sourceReceipts as Record<string, Record<string, unknown>>)
                  .attributesAfter,
                sourceBytes: staleAfterBytes.byteLength,
                sourceSha256: createHash('sha256').update(staleAfterBytes).digest('hex'),
              },
            },
          },
          fixtureChild,
        ),
      /frame|stable/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Detox IPC rejects a completed response that arrives after cancellation even with the owned identity', async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-connection-late-complete-')),
  );
  await chmod(root, 0o700);
  const controller = new AbortController();
  const client = new DetoxConnectionIpcClient({
    artifactRoot: root,
    platform: 'ios',
    signal: controller.signal,
    deadlineMs: 2_000,
    expectedChild: fixtureChild,
  });
  let commandPromise: Promise<DetoxConnectionCommand> | undefined;
  let responsePromise: ReturnType<DetoxConnectionIpcClient['request']> | undefined;
  try {
    commandPromise = waitForDetoxConnectionCommand({
      artifactRoot: root,
      platform: 'ios',
      afterCommandId: 0,
    });
    responsePromise = client.request(ipcInput);
    const command = await commandPromise;
    controller.abort(new Error('late completion fixture cancellation'));
    await publishDetoxConnectionResponse(root, {
      schemaVersion: 1,
      kind: 'private-detox-connection-response',
      commandId: command.commandId,
      commandHash: command.commandHash,
      commandKind: command.kind,
      status: 'completed',
      actor: command.actor,
      platform: command.platform,
      observations: [{} as DetoxConnectionObservationReceipt],
      childPid: fixtureChild.pid,
      childPgid: fixtureChild.pgid,
      childStarted: fixtureChild.started,
      startedMonotonicMs: 1,
      finishedMonotonicMs: 2,
    });
    await assert.rejects(responsePromise, /after cancellation|cancel/i);
  } finally {
    client.close();
    await Promise.allSettled(
      [commandPromise, responsePromise].filter((value) => value !== undefined),
    );
    await rm(root, { recursive: true, force: true });
  }
});

void test('Detox ledger producer rejects the old synthetic positive shape', async () => {
  await assert.rejects(
    () =>
      buildDetoxConnectionLedgerFromActualReport(
        {
          connectionJourneyPreparation: {
            nativePassingCases: 0,
            connectionId: '11111111-1111-1111-1111-111111111111',
            snapshots: {},
            transportWindows: [],
          },
          detoxConnectionObservations: [],
        },
        'ios',
      ),
    /snapshot|transport|observation|producer/i,
  );
});

void test('Detox ledger producer accepts only a writer-backed seven-purpose source pipeline', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-connection-ledger-')));
  const root = path.join(parent, '0123456789abcdef01234567');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  const artifactsRoot = path.join(root, 'detox-artifacts');
  await mkdir(artifactsRoot, { recursive: true, mode: 0o700 });
  const labels = [
    'connection-coach-invite',
    'connection-normal-coach-pending',
    'connection-normal-coach-roster',
    'connection-student-entry',
    'connection-submit',
    'connection-student-pending',
    'connection-coach-pending-roster',
    'connection-coach-no-active-roster',
    'connection-coach-return-home',
    'connection-coach-pending',
    'connection-confirm',
    'connection-student-active',
    'connection-coach-roster',
  ];
  const commands: Record<string, unknown>[] = [];
  const observations: Record<string, unknown>[] = [];
  const selector = 'pro.home.screen';
  for (const [index, label] of labels.entries()) {
    const commandBase = {
      schemaVersion: 1 as const,
      commandId: index + 1,
      kind: 'observe' as const,
      platform: 'ios' as const,
      actor: 'coach' as const,
      navigation: 'none' as const,
      label,
      semanticActions: `writer-backed Detox action ${label}`,
      viewId: 'SCR-pro-home',
      selectors: selector,
      selectorKind: 'id' as const,
    };
    const command = {
      ...commandBase,
      commandHash: hashJson({ ...commandBase, commandHash: undefined }),
    };
    const xml = Buffer.from(
      `<ViewHierarchy><View class="View" width="100" height="40" visibility="visible" alpha="1" focused="false" x="0" y="0" id="${selector}" label="owned" /></ViewHierarchy>`,
    );
    const screenshot = validPng();
    const attrs = [validIosAttributes(selector)];
    const parsedHierarchy = parseDetoxViewHierarchyXml(xml.toString('utf8'), 'ios');
    applyDetoxElementAttributeEvidence(parsedHierarchy, attrs);
    assert.equal(parsedHierarchy.children[0]?.attributes['resource-id'], selector);
    assert.equal(parsedHierarchy.children[0]?.enabled, true);
    const beforeBytes = Buffer.from(JSON.stringify(attrs) + '\n');
    const afterBytes = Buffer.from(JSON.stringify(attrs) + '\n');
    const files = {
      xmlFile: `${label}.private.xml`,
      screenshotFile: `${label}.private.png`,
      attributesBeforeFile: `${label}-attributes-before.private.json`,
      attributesAfterFile: `${label}-attributes-after.private.json`,
    };
    await writeFile(path.join(root, files.xmlFile), xml, { mode: 0o600 });
    await writeFile(path.join(root, files.screenshotFile), screenshot, { mode: 0o600 });
    await writeFile(path.join(root, files.attributesBeforeFile), beforeBytes, { mode: 0o600 });
    await writeFile(path.join(root, files.attributesAfterFile), afterBytes, { mode: 0o600 });
    const originalScreenshot = path.join(artifactsRoot, `${label}.original.private.png`);
    await writeFile(originalScreenshot, screenshot, { mode: 0o600 });
    const sourceMetadata = await lstat(originalScreenshot);
    const sourceSnapshotPath = `${label}-source.private.png`;
    await writeFile(path.join(root, sourceSnapshotPath), screenshot, { mode: 0o600 });
    const sourceReceipt = {
      producer: 'detox.device.takeScreenshot' as const,
      sourceKind: 'file' as const,
      processPid: fixtureChild.pid,
      processPgid: fixtureChild.pgid,
      processStarted: fixtureChild.started,
      sourceBytes: screenshot.byteLength,
      sourceSha256: hashBytes(screenshot),
      sourcePath: originalScreenshot,
      sourceRealpath: originalScreenshot,
      producerPath: originalScreenshot,
      producerRealpath: originalScreenshot,
      sourceMode: sourceMetadata.mode & 0o777,
      sourceUid: sourceMetadata.uid,
      sourceDev: sourceMetadata.dev,
      sourceIno: sourceMetadata.ino,
      sourceGid: sourceMetadata.gid,
      sourceNlink: sourceMetadata.nlink,
      sourceSnapshotPath,
      sourceSnapshotBytes: screenshot.byteLength,
      sourceSnapshotSha256: hashBytes(screenshot),
      sourceCommandId: command.commandId,
      sourceCommandHash: command.commandHash,
      sourceLabel: command.label,
    };
    const observation = {
      schemaVersion: 1 as const,
      kind: 'private-detox-connection-observation' as const,
      commandId: command.commandId,
      commandHash: command.commandHash,
      label,
      actor: 'coach' as const,
      platform: 'ios' as const,
      viewId: command.viewId,
      ...files,
      xmlSha256: hashBytes(xml),
      screenshotSha256: hashBytes(screenshot),
      attributesBeforeSha256: hashBytes(beforeBytes),
      attributesAfterSha256: hashBytes(afterBytes),
      sourceReceipts: {
        xml: {
          producer: 'detox.device.generateViewHierarchyXml' as const,
          sourceKind: 'memory' as const,
          processPid: fixtureChild.pid,
          processPgid: fixtureChild.pgid,
          processStarted: fixtureChild.started,
          sourceBytes: xml.byteLength,
          sourceSha256: hashBytes(xml),
          sourceCommandId: command.commandId,
          sourceCommandHash: command.commandHash,
          sourceLabel: command.label,
        },
        screenshot: sourceReceipt,
        attributesBefore: {
          producer: 'detox.element.getAttributes' as const,
          sourceKind: 'memory' as const,
          processPid: fixtureChild.pid,
          processPgid: fixtureChild.pgid,
          processStarted: fixtureChild.started,
          sourceBytes: beforeBytes.byteLength,
          sourceSha256: hashBytes(beforeBytes),
          sourceCommandId: command.commandId,
          sourceCommandHash: command.commandHash,
          sourceLabel: command.label,
        },
        attributesAfter: {
          producer: 'detox.element.getAttributes' as const,
          sourceKind: 'memory' as const,
          processPid: fixtureChild.pid,
          processPgid: fixtureChild.pgid,
          processStarted: fixtureChild.started,
          sourceBytes: afterBytes.byteLength,
          sourceSha256: hashBytes(afterBytes),
          sourceCommandId: command.commandId,
          sourceCommandHash: command.commandHash,
          sourceLabel: command.label,
        },
      },
      selectors: [
        {
          selector,
          kind: 'id' as const,
          before: attrs[0],
          after: attrs[0],
          frameStable: true as const,
        },
      ],
      startedMonotonicMs: index + 1,
      finishedMonotonicMs: index + 2,
      actionCompleted: true as const,
      hierarchyCaptured: true as const,
      screenshotCaptured: true as const,
    };
    commands.push(command);
    observations.push(observation);
  }
  const connectionId = '11111111-1111-1111-1111-111111111111';
  const sourceRows = Array.from({ length: 9 }, (_, index) => ({
    requestId: index + 1,
    method: index === 2 || index === 7 ? 'POST' : 'GET',
    pathHash: hashBytes(
      Buffer.from(
        index === 2
          ? '/connections/invite-submissions'
          : index === 7
            ? `/connections/${connectionId}/confirm`
            : index === 4 || index === 6
              ? '/professional/students'
              : '/connections',
      ),
    ),
    requestOrigin: null,
    requestProfile: 'native' as const,
    targetOrigin: 'http://127.0.0.1:4101',
    status: index === 2 ? 201 : index === 7 ? 200 : 200,
    outcome: 'forwarded' as const,
    faultAttemptId: null,
    elapsedMs: 1,
  }));
  const transportWindows = [
    {
      method: 'GET',
      route: '/professional/invite-codes/fitness_coach',
      status: 200,
      afterRequestId: 0,
      throughRequestId: 1,
      unique: false,
    },
    {
      method: 'GET',
      route: '/connections',
      status: 200,
      afterRequestId: 1,
      throughRequestId: 2,
      unique: false,
    },
    {
      method: 'POST',
      route: '/connections/invite-submissions',
      status: 201,
      afterRequestId: 2,
      throughRequestId: 3,
      unique: true,
    },
    {
      method: 'GET',
      route: '/connections',
      status: 200,
      afterRequestId: 3,
      throughRequestId: 4,
      unique: false,
    },
    {
      method: 'GET',
      route: '/professional/students',
      status: 200,
      afterRequestId: 4,
      throughRequestId: 5,
      unique: false,
    },
    {
      method: 'GET',
      route: '/connections',
      status: 200,
      afterRequestId: 5,
      throughRequestId: 6,
      unique: false,
    },
    {
      method: 'GET',
      route: '/professional/students',
      status: 200,
      afterRequestId: 6,
      throughRequestId: 7,
      unique: false,
    },
    {
      method: 'POST',
      route: `/connections/${connectionId}/confirm`,
      status: 200,
      afterRequestId: 7,
      throughRequestId: 8,
      unique: true,
    },
    {
      method: 'GET',
      route: '/connections',
      status: 200,
      afterRequestId: 8,
      throughRequestId: 9,
      unique: false,
    },
  ];
  const snapshots: Record<string, { path: string; sha256: string }> = {};
  for (let index = 0; index < 12; index += 1) {
    const bytes = Buffer.from(`writer-backed-snapshot-${index}`);
    const snapshotPath = `snapshot-${index}.private.json`;
    await writeFile(path.join(root, snapshotPath), bytes, { mode: 0o600 });
    snapshots[`snapshot-${index}`] = { path: snapshotPath, sha256: hashBytes(bytes) };
  }
  const report = createDetoxConnectionProducerReport({
    platform: 'ios',
    artifactRoot: root,
    childIdentity: fixtureChild,
    sourceTreeHash: 'a'.repeat(64),
    helperInputsHash: 'b'.repeat(64),
    transportSource: sourceRows,
  });
  const transportSourceBytes = Buffer.from(JSON.stringify(sourceRows));
  await writeFile(
    path.join(root, 'detox-connection-transport-source.private.json'),
    transportSourceBytes,
    { flag: 'wx', mode: 0o600 },
  );
  report.detoxTransportSourceReceipt = {
    path: 'detox-connection-transport-source.private.json',
    sourceBytes: transportSourceBytes.byteLength,
    sourceSha256: hashBytes(transportSourceBytes),
  };
  report.connectionApiIdentity = {
    apiPid: fixtureChild.pid,
    targetOrigin: 'http://127.0.0.1:4101',
  };
  report.detoxConnectionCommands = commands as never;
  report.detoxConnectionObservations = observations as never;
  report.connectionJourneyPreparation = {
    nativePassingCases: 0,
    connectionId,
    transportSourceHash: createHash('sha256').update(JSON.stringify(sourceRows)).digest('hex'),
    snapshots,
    transportWindows,
  };
  const ledger = await buildDetoxConnectionLedgerFromActualReport(report, 'ios');
  assert.equal(ledger.length, 7);
  assert(ledger.every((row) => row.status === 'passed' && row.bound === true));
  const tamperedSource = sourceRows.map((row, index) =>
    index === 2 ? { ...row, outcome: 'injected' as const } : row,
  );
  const tamperedSourceBytes = Buffer.from(JSON.stringify(tamperedSource));
  await writeFile(
    path.join(root, 'detox-connection-transport-source.private.json'),
    tamperedSourceBytes,
  );
  report.detoxTransportSource = tamperedSource;
  report.detoxTransportSourceHash = createHash('sha256')
    .update(JSON.stringify(tamperedSource))
    .digest('hex');
  (report.connectionJourneyPreparation as Record<string, unknown>).transportSourceHash =
    report.detoxTransportSourceHash;
  report.detoxTransportSourceReceipt = {
    path: 'detox-connection-transport-source.private.json',
    sourceBytes: tamperedSourceBytes.byteLength,
    sourceSha256: hashBytes(tamperedSourceBytes),
  };
  await assert.rejects(
    () => buildDetoxConnectionLedgerFromActualReport(report, 'ios'),
    /owned forward|successful|transport/i,
  );
  await rm(parent, { recursive: true, force: true });
});

void test('Detox IPC rejects an elapsed request before writing a worker command', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-connection-deadline-')));
  await chmod(root, 0o700);
  const client = new DetoxConnectionIpcClient({
    artifactRoot: root,
    platform: 'ios',
    signal: new AbortController().signal,
    deadlineMs: 2_000,
    expectedChild: fixtureChild,
  });
  try {
    await assert.rejects(
      () => client.request(ipcInput, { deadlineAt: performance.now() - 1 }),
      /deadline elapsed before request/i,
    );
    assert.deepEqual(await (await import('node:fs/promises')).readdir(root), []);
  } finally {
    client.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test('Detox IPC rejects a completed response from a foreign child identity after abort', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-connection-foreign-')));
  await chmod(root, 0o700);
  const controller = new AbortController();
  const client = new DetoxConnectionIpcClient({
    artifactRoot: root,
    platform: 'ios',
    signal: controller.signal,
    deadlineMs: 2_000,
    expectedChild: fixtureChild,
  });
  let commandPromise: Promise<DetoxConnectionCommand> | undefined;
  let responsePromise: ReturnType<DetoxConnectionIpcClient['request']> | undefined;
  try {
    commandPromise = waitForDetoxConnectionCommand({
      artifactRoot: root,
      platform: 'ios',
      afterCommandId: 0,
    });
    responsePromise = client.request(ipcInput);
    const command = await commandPromise;
    controller.abort(new Error('fixture cancellation'));
    await publishDetoxConnectionResponse(root, {
      schemaVersion: 1,
      kind: 'private-detox-connection-response',
      commandId: command.commandId,
      commandHash: command.commandHash,
      commandKind: command.kind,
      status: 'completed',
      actor: command.actor,
      platform: command.platform,
      observations: [{} as DetoxConnectionObservationReceipt],
      childPid: fixtureChild.pid + 1,
      childPgid: fixtureChild.pgid,
      childStarted: fixtureChild.started,
      startedMonotonicMs: 1,
      finishedMonotonicMs: 2,
    });
    await assert.rejects(responsePromise, /identity|foreign|cancel|response/i);
  } finally {
    client.close();
    await Promise.allSettled(
      [commandPromise, responsePromise].filter((value) => value !== undefined),
    );
    await rm(root, { recursive: true, force: true });
  }
});

void test('Detox runner paths require canonical regular files and bind their source hashes', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-connection-runner-')));
  await chmod(root, 0o700);
  const config = path.join(root, 'jest.config.js');
  const runner = path.join(root, 'runner.e2e.test.js');
  await writeFile(config, 'module.exports = {}\n', { mode: 0o600 });
  await writeFile(runner, 'module.exports = {}\n', { mode: 0o600 });
  const actionability = path.join(root, 'scripts/testing/detox-connection-actionability.ts');
  const hierarchy = path.join(root, 'scripts/testing/detox-native-hierarchy.ts');
  const saveRetryActions = path.join(root, 'scripts/testing/detox-save-retry-child-actions.js');
  const saveRetryProtocol = path.join(root, 'scripts/testing/detox-save-retry-child-protocol.mjs');
  await mkdir(path.dirname(actionability), { recursive: true, mode: 0o700 });
  for (const [destination, source] of [
    [
      actionability,
      path.join(fixtureRepositoryRoot, 'scripts/testing/detox-connection-actionability.ts'),
    ],
    [hierarchy, path.join(fixtureRepositoryRoot, 'scripts/testing/detox-native-hierarchy.ts')],
    [
      saveRetryActions,
      path.join(fixtureRepositoryRoot, 'scripts/testing/detox-save-retry-child-actions.js'),
    ],
    [
      saveRetryProtocol,
      path.join(fixtureRepositoryRoot, 'scripts/testing/detox-save-retry-child-protocol.mjs'),
    ],
  ] as const) {
    const bytes = await readFile(source);
    await writeFile(destination, bytes, { mode: 0o600 });
    await chmod(destination, 0o600);
  }
  try {
    const validated = await validateDetoxConnectionRunnerPaths(root, {
      jestConfigPath: config,
      testPath: runner,
    });
    assert.equal(validated.jestConfig.sha256, hashBytes(Buffer.from('module.exports = {}\n')));
    const symlink = path.join(root, 'runner-link.js');
    await (await import('node:fs/promises')).symlink(runner, symlink);
    await assert.rejects(
      () => validateDetoxConnectionRunnerPaths(root, { jestConfigPath: config, testPath: symlink }),
      /canonical|regular|owned|immutable|nlink/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Detox runtime context waits for an in-flight SDK action to settle before cancellation', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'detox-connection-fence-')));
  await chmod(root, 0o700);
  let releaseAction: (() => void) | undefined;
  let actionSettled = false;
  const action = new Promise<{ xml: string }>((resolve) => {
    releaseAction = () => {
      actionSettled = true;
      resolve({ xml: '<ViewHierarchy><View id="pro.home.screen" /></ViewHierarchy>' });
    };
  });
  const base = {
    output: root,
    fixtures: { scope: 'native-entry-ios' },
    proxy: { observations: [], nativeAuthIdentities: [] },
    apiIdentity: { apiPid: process.pid, targetOrigin: 'http://127.0.0.1:4101' },
    report: {},
  } as never;
  const controller = new AbortController();
  const context = createDetoxConnectionRuntimeContext(
    base,
    {
      observeStep: async () => action,
      switchAccount: () => Promise.resolve({}) as never,
    },
    controller.signal,
  );
  const operation = context.observe(
    'connection-fence',
    'owned action',
    'SCR-pro-home',
    'pro.home.screen',
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort(new Error('fixture cancellation'));
  assert.equal(actionSettled, false);
  releaseAction?.();
  await assert.rejects(operation, /cancellation/i);
  assert.equal(actionSettled, true);
  await rm(root, { recursive: true, force: true });
});

void test('Detox runtime context bounds a non-cooperative SDK action after cancellation', async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), 'detox-connection-non-cooperative-')),
  );
  await chmod(root, 0o700);
  let releaseAction: (() => void) | undefined;
  let actionSettled = false;
  const action = new Promise<{ xml: string }>((resolve) => {
    releaseAction = () => {
      actionSettled = true;
      resolve({ xml: '<ViewHierarchy><View id="pro.home.screen" /></ViewHierarchy>' });
    };
  });
  const base = {
    output: root,
    fixtures: { scope: 'native-entry-ios' },
    proxy: { observations: [], nativeAuthIdentities: [] },
    apiIdentity: { apiPid: process.pid, targetOrigin: 'http://127.0.0.1:4101' },
    report: {},
  } as never;
  const controller = new AbortController();
  const context = createDetoxConnectionRuntimeContext(
    base,
    {
      observeStep: async () => action,
      switchAccount: () => Promise.resolve({}) as never,
    },
    controller.signal,
    { nonCooperativeDrainMs: 20 },
  );
  try {
    const operation = context.observe(
      'connection-non-cooperative',
      'owned action',
      'SCR-pro-home',
      'pro.home.screen',
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    const abortedAt = performance.now();
    controller.abort(new Error('fixture cancellation'));
    await assert.rejects(operation, (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.name, 'DetoxConnectionNonCooperativeError');
      assert.match(error.message, /did not settle within 20ms/);
      return true;
    });
    assert(performance.now() - abortedAt < 500);
    assert.equal(actionSettled, false);
  } finally {
    releaseAction?.();
    await action;
    await rm(root, { recursive: true, force: true });
  }
});
