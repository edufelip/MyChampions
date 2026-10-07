import assert from 'node:assert/strict';
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  DetoxConnectionEvidenceRecoveryError,
  ensureDetoxConnectionArtifactRoot,
  readDetoxConnectionPath,
  readOwnedDetoxConnectionFile,
  writeAtomicDetoxConnectionBytes,
} from '../../scripts/testing/detox-connection-evidence';

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'dxa-wire-001-'));
  const canonicalParent = await realpath(parent);
  const root = path.join(canonicalParent, '0123456789abcdef01234567');
  const sourceRoot = path.join(canonicalParent, 'detox-temp-source');
  await mkdir(root, { mode: 0o700 });
  await mkdir(sourceRoot, { mode: 0o700 });
  await chmod(root, 0o700);
  await chmod(sourceRoot, 0o700);
  await ensureDetoxConnectionArtifactRoot(root);
  return { parent, root, sourceRoot };
}

async function closeFixture(parent: string) {
  await rm(parent, { recursive: true, force: true });
}

function writerDetails(error: unknown): Record<string, unknown> {
  assert(error instanceof DetoxConnectionEvidenceRecoveryError);
  return error.details;
}

function validPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
}

void test('actual OS-temp screenshot source is read by descriptor and retained as an owned snapshot', async () => {
  const { parent, root, sourceRoot } = await fixture();
  try {
    const sourcePath = path.join(sourceRoot, 'detox-screenshot.png');
    const bytes = validPng();
    await writeFile(sourcePath, bytes, { mode: 0o600 });
    const source = await readDetoxConnectionPath(sourcePath, 1024, { privateRecord: false });
    const retained = await writeAtomicDetoxConnectionBytes(
      root,
      'connection-confirm-screenshot-source.private.png',
      source.bytes,
      1024,
    );
    assert.deepEqual(retained.bytes, bytes);
    assert.equal(retained.metadata.nlink, 1);
    assert.equal(
      (
        await readOwnedDetoxConnectionFile(
          root,
          'connection-confirm-screenshot-source.private.png',
          1024,
        )
      ).toString(),
      bytes.toString(),
    );
  } finally {
    await closeFixture(parent);
  }
});

void test('source reader rejects symlinks, hardlinks, and oversize files through the actual read path', async () => {
  const { parent, sourceRoot } = await fixture();
  try {
    const sourcePath = path.join(sourceRoot, 'source.png');
    const linkPath = path.join(sourceRoot, 'link.png');
    const hardlinkPath = path.join(sourceRoot, 'hardlink.png');
    await writeFile(sourcePath, Buffer.from('bounded-source'), { mode: 0o600 });
    await symlink(sourcePath, linkPath);
    await assert.rejects(
      readDetoxConnectionPath(path.resolve(linkPath), 1024, { privateRecord: false }),
      /no-follow|canonical|owned|identity/i,
    );
    await link(sourcePath, hardlinkPath);
    await assert.rejects(
      readDetoxConnectionPath(path.resolve(hardlinkPath), 1024, { privateRecord: false }),
      /owned|immutable|nlink|identity/i,
    );
    await writeFile(path.join(sourceRoot, 'large.png'), Buffer.alloc(2049, 7), { mode: 0o600 });
    await assert.rejects(
      readDetoxConnectionPath(path.resolve(path.join(sourceRoot, 'large.png')), 1024, {
        privateRecord: false,
      }),
      /bounded|owned/i,
    );
  } finally {
    await closeFixture(parent);
  }
});

void test('no-replace publication leaves a competing sidecar and removes only its own temporary inode', async () => {
  const { parent, root } = await fixture();
  try {
    const finalName = 'connection-confirm.private.json';
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(root, finalName, Buffer.from('{"owned":true}\n'), 1024, {
        beforePublish: async ({ final }) => {
          await writeFile(final, Buffer.from('{"foreign":true}\n'), { flag: 'wx', mode: 0o600 });
        },
      }),
      /already exists|publication|temporary/i,
    );
    assert.equal((await readFile(path.join(root, finalName))).toString(), '{"foreign":true}\n');
  } finally {
    await closeFixture(parent);
  }
});

void test('late cancellation after publication retains structured recovery evidence, never a completed sidecar', async () => {
  const { parent, root } = await fixture();
  try {
    let checks = 0;
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(
        root,
        'connection-cancel.private.json',
        Buffer.from('{"cancelled":true}\n'),
        1024,
        {
          checkLive: () => {
            checks += 1;
            if (checks >= 7) throw new Error('fixture cancellation');
          },
        },
      ),
      (error: unknown) => {
        assert(error instanceof DetoxConnectionEvidenceRecoveryError);
        const details = writerDetails(error);
        assert.equal(details.stopReason, 'fixture cancellation');
        const writer = details.writer as Record<string, unknown>;
        assert.equal(writer.killed, true);
        assert.equal(writer.reaped, true);
        const protocol = details.protocol as Record<string, unknown>[];
        assert(protocol.some((row) => row.type === 'before-recovery-unlink'));
        return true;
      },
    );
    const names = await readdir(root);
    assert(!names.includes('connection-cancel.private.json'));
    assert.equal(names.filter((name) => name.includes('.tmp-')).length, 0);
    assert.equal(names.filter((name) => name.startsWith('.recovery-')).length, 1);
  } finally {
    await closeFixture(parent);
  }
});

void test('post-publication replacement is reported as blocked recovery and does not validate foreign bytes', async () => {
  const { parent, root } = await fixture();
  try {
    await assert.rejects(
      writeAtomicDetoxConnectionBytes(
        root,
        'connection-replaced.private.json',
        Buffer.from('{"owned":true}\n'),
        1024,
        {
          afterPublish: async ({ final }) => {
            await rm(final);
            await writeFile(final, Buffer.from('{"foreign":true}\n'), { flag: 'wx', mode: 0o600 });
          },
        },
      ),
      (error: unknown) =>
        error instanceof DetoxConnectionEvidenceRecoveryError || error instanceof AggregateError,
    );
    assert.equal(
      (await readFile(path.join(root, 'connection-replaced.private.json'))).toString(),
      '{"foreign":true}\n',
    );
    assert.equal(
      (await (await import('node:fs/promises')).readdir(root)).filter((name) =>
        name.includes('.tmp-'),
      ).length,
      0,
    );
  } finally {
    await closeFixture(parent);
  }
});

void test('parent validator accepts only the actual OS-temp-to-owned snapshot observation chain', async () => {
  const { parent, root, sourceRoot } = await fixture();
  try {
    const { createHash } = await import('node:crypto');
    const { requireDetoxConnectionObservation, requireDetoxConnectionCommand } =
      await import('../../scripts/testing/detox-connection-ipc');
    const child = { pid: process.pid, pgid: process.pid, started: 'owned-child-start' };
    const baseCommand = {
      schemaVersion: 1 as const,
      commandId: 1,
      kind: 'observe' as const,
      platform: 'ios' as const,
      actor: 'coach' as const,
      navigation: 'none' as const,
      label: 'connection-confirm',
      semanticActions: 'owned confirmation action',
      viewId: 'SCR-pro-pending',
      selectors: 'pro.pending.card',
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
    const command = requireDetoxConnectionCommand({
      ...baseCommand,
      commandHash: createHash('sha256')
        .update(canonical({ ...baseCommand, commandHash: undefined }))
        .digest('hex'),
    });
    const hierarchy = Buffer.from(
      '<ViewHierarchy><View class="View" width="100" height="40" visibility="visible" alpha="1" focused="false" x="0" y="0" id="pro.pending.card" label="owned" /></ViewHierarchy>',
    );
    const attrs = Buffer.from(
      JSON.stringify([
        {
          identifier: 'pro.pending.card',
          enabled: true,
          visible: true,
          hittable: true,
          frame: { x: 0, y: 0, width: 100, height: 40 },
        },
      ]) + '\n',
    );
    const screenshot = validPng();
    const sourcePath = path.join(sourceRoot, 'detox-real-screenshot.png');
    await writeFile(sourcePath, screenshot, { mode: 0o600 });
    const source = await readDetoxConnectionPath(sourcePath, 1024, { privateRecord: false });
    const sourceSnapshotName = 'connection-confirm-screenshot-source.private.png';
    await writeAtomicDetoxConnectionBytes(root, sourceSnapshotName, source.bytes, 1024);
    const files = {
      xmlFile: 'connection-confirm.private.xml',
      screenshotFile: 'connection-confirm.private.png',
      attributesBeforeFile: 'connection-confirm-attributes-before.private.json',
      attributesAfterFile: 'connection-confirm-attributes-after.private.json',
    };
    await writeAtomicDetoxConnectionBytes(root, files.xmlFile, hierarchy, 4096);
    await writeAtomicDetoxConnectionBytes(root, files.screenshotFile, screenshot, 4096);
    await writeAtomicDetoxConnectionBytes(root, files.attributesBeforeFile, attrs, 4096);
    await writeAtomicDetoxConnectionBytes(root, files.attributesAfterFile, attrs, 4096);
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    const parsedAttrs = JSON.parse(attrs.toString()) as Record<string, unknown>[];
    const observation = {
      schemaVersion: 1,
      kind: 'private-detox-connection-observation',
      commandId: command.commandId,
      commandHash: command.commandHash,
      label: command.label,
      actor: command.actor,
      platform: command.platform,
      viewId: command.viewId,
      ...files,
      xmlSha256: hash(hierarchy),
      screenshotSha256: hash(screenshot),
      attributesBeforeSha256: hash(attrs),
      attributesAfterSha256: hash(attrs),
      sourceReceipts: {
        xml: {
          producer: 'detox.device.generateViewHierarchyXml',
          sourceKind: 'memory',
          processPid: child.pid,
          processPgid: child.pgid,
          processStarted: child.started,
          sourceBytes: hierarchy.byteLength,
          sourceSha256: hash(hierarchy),
          sourceCommandId: command.commandId,
          sourceCommandHash: command.commandHash,
          sourceLabel: command.label,
        },
        screenshot: {
          producer: 'detox.device.takeScreenshot',
          sourceKind: 'file',
          processPid: child.pid,
          processPgid: child.pgid,
          processStarted: child.started,
          sourceBytes: screenshot.byteLength,
          sourceSha256: hash(screenshot),
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
          sourceSnapshotPath: sourceSnapshotName,
          sourceSnapshotBytes: screenshot.byteLength,
          sourceSnapshotSha256: hash(screenshot),
          sourceCommandId: command.commandId,
          sourceCommandHash: command.commandHash,
          sourceLabel: command.label,
        },
        attributesBefore: {
          producer: 'detox.element.getAttributes',
          sourceKind: 'memory',
          processPid: child.pid,
          processPgid: child.pgid,
          processStarted: child.started,
          sourceBytes: attrs.byteLength,
          sourceSha256: hash(attrs),
          sourceCommandId: command.commandId,
          sourceCommandHash: command.commandHash,
          sourceLabel: command.label,
        },
        attributesAfter: {
          producer: 'detox.element.getAttributes',
          sourceKind: 'memory',
          processPid: child.pid,
          processPgid: child.pgid,
          processStarted: child.started,
          sourceBytes: attrs.byteLength,
          sourceSha256: hash(attrs),
          sourceCommandId: command.commandId,
          sourceCommandHash: command.commandHash,
          sourceLabel: command.label,
        },
      },
      selectors: [
        {
          selector: 'pro.pending.card',
          kind: 'id',
          before: parsedAttrs[0],
          after: parsedAttrs[0],
          frameStable: true,
        },
      ],
      startedMonotonicMs: 1,
      finishedMonotonicMs: 2,
      actionCompleted: true,
      hierarchyCaptured: true,
      screenshotCaptured: true,
    };
    const accepted = await requireDetoxConnectionObservation(root, command, observation, child);
    assert.equal(accepted.hierarchy, hierarchy.toString());
    const invalidScreenshot = Buffer.from('invalid-detox-screenshot');
    await writeAtomicDetoxConnectionBytes(
      root,
      'connection-invalid.private.png',
      invalidScreenshot,
      4096,
    );
    await assert.rejects(
      requireDetoxConnectionObservation(
        root,
        command,
        {
          ...observation,
          screenshotFile: 'connection-invalid.private.png',
          screenshotSha256: hash(invalidScreenshot),
          sourceReceipts: {
            ...observation.sourceReceipts,
            screenshot: {
              ...observation.sourceReceipts.screenshot,
              sourceBytes: invalidScreenshot.byteLength,
              sourceSha256: hash(invalidScreenshot),
            },
          },
        },
        child,
      ),
      /PNG/i,
    );
    await assert.rejects(
      requireDetoxConnectionObservation(
        root,
        command,
        {
          ...observation,
          sourceReceipts: {
            ...observation.sourceReceipts,
            screenshot: {
              ...observation.sourceReceipts.screenshot,
              sourceSnapshotSha256: hash(Buffer.from('forged')),
            },
          },
        },
        child,
      ),
      /Expected values|snapshot|hash|bytes/i,
    );
  } finally {
    await closeFixture(parent);
  }
});

void test('artifact-root preparation rejects a symlink without chmodding its target', async () => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), 'dxa-wire-root-')));
  try {
    const target = path.join(parent, 'target');
    const linkRoot = path.join(parent, '0123456789abcdef01234567');
    await mkdir(target, { mode: 0o755 });
    await chmod(target, 0o755);
    await symlink(target, linkRoot);
    await assert.rejects(
      ensureDetoxConnectionArtifactRoot(linkRoot),
      /canonical|private owned|directory/i,
    );
    const { mode } = await (await import('node:fs/promises')).lstat(target);
    assert.equal(mode & 0o777, 0o755);
  } finally {
    await closeFixture(parent);
  }
});

void test('Detox PNG staging accepts a complete bounded image and rejects forged bytes', async () => {
  const { requireDetoxPngBytes } = await import('../../scripts/testing/detox-connection-ipc');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
  );
  requireDetoxPngBytes(png);
  assert.throws(() => requireDetoxPngBytes(Buffer.from('forged')), /PNG/i);
});

void test('blocked action cleanup requires a blocked file and bounded replacement identity', async () => {
  const { requireDetoxConnectionActionCleanup } =
    await import('../../scripts/testing/detox-connection-ipc');
  const metadata = {
    dev: 1,
    ino: 2,
    uid: 3,
    gid: 4,
    mode: 0o600,
    nlink: 1,
    size: 10,
    mtimeMs: 1,
    ctimeMs: 1,
  };
  assert.throws(
    () =>
      requireDetoxConnectionActionCleanup(
        {
          status: 'blocked-recovery',
          files: [{ name: 'action.private.xml', metadata, outcome: 'removed' }],
          ledgerPath: 'action-cleanup.private.json',
          ledgerSha256: 'a'.repeat(64),
        },
        'cancelled',
      ),
    /blocked file outcome|replacement identity/i,
  );
  assert.doesNotThrow(() =>
    requireDetoxConnectionActionCleanup(
      {
        status: 'blocked-recovery',
        files: [
          {
            name: 'action.private.xml',
            metadata,
            outcome: 'blocked',
            error: 'foreign replacement',
            replacement: {
              metadata: { ...metadata, ino: 8, size: 11 },
              bytes: 11,
              sha256: 'b'.repeat(64),
            },
          },
        ],
        ledgerPath: 'action-cleanup.private.json',
        ledgerSha256: 'a'.repeat(64),
      },
      'cancelled',
    ),
  );
});

void test('actual child action cleanup rolls back owned sidecars and preserves a foreign replacement', async () => {
  const { parent, root, sourceRoot } = await fixture();
  const previousEnvironment = {
    platform: process.env.DETOX_CONNECTION_PLATFORM,
    artifactRoot: process.env.DETOX_CONNECTION_ARTIFACT_ROOT,
    coachEmail: process.env.DETOX_CONNECTION_COACH_EMAIL,
    coachPassword: process.env.DETOX_CONNECTION_COACH_PASSWORD,
    studentEmail: process.env.DETOX_CONNECTION_STUDENT_EMAIL,
    studentPassword: process.env.DETOX_CONNECTION_STUDENT_PASSWORD,
  };
  const globalRecord = globalThis as Record<string, unknown>;
  const previousDescribe = globalRecord.describe;
  const previousTest = globalRecord.test;
  try {
    Object.assign(process.env, {
      DETOX_CONNECTION_PLATFORM: 'ios',
      DETOX_CONNECTION_ARTIFACT_ROOT: root,
      DETOX_CONNECTION_COACH_EMAIL: 'coach@example.test',
      DETOX_CONNECTION_COACH_PASSWORD: 'coach-password',
      DETOX_CONNECTION_STUDENT_EMAIL: 'student@example.test',
      DETOX_CONNECTION_STUDENT_PASSWORD: 'student-password',
    });
    globalRecord.describe = () => undefined;
    globalRecord.test = () => undefined;
    const imported = await import('../../e2e/detox-integrated-connection-baseline.e2e.test.js');
    const child = (imported.default ?? imported) as {
      runDedicatedAction: (
        command: Record<string, unknown>,
        runtime: Record<string, unknown>,
      ) => Promise<unknown>;
      screenshotSourceReceipt: (
        sourcePath: unknown,
        identity: Record<string, unknown>,
        command: Record<string, unknown>,
      ) => Promise<unknown>;
      publishConnectionTerminalError: (
        command: Record<string, unknown>,
        startedMonotonicMs: number,
        observations: unknown[] | undefined,
        error: unknown,
      ) => Promise<{ status: string }>;
    };
    const { requireDetoxConnectionActionCleanup } =
      await import('../../scripts/testing/detox-connection-ipc');
    const childIdentity = {
      kind: 'private-detox-connection-child-identity',
      pid: process.pid,
      pgid: process.pid,
      started: 'actual-child-start',
    };
    await writeAtomicDetoxConnectionBytes(
      root,
      'detox-connection-child-identity.private.json',
      Buffer.from(JSON.stringify(childIdentity) + '\n'),
      64 * 1024,
    );
    const runCancelledAction = async (commandId: number, replaceFirst: boolean) => {
      const command = {
        commandId,
        commandHash: `${commandId}`.padStart(64, 'a'),
        kind: 'observe',
        actor: 'student',
        label: `connection-action-${commandId}`,
        action: { kind: 'accept' },
      };
      const result = {
        kind: 'accept',
        selector: 'pro.pending.acceptButton.0',
        selectorKind: 'id',
        hierarchyXml: '<ViewHierarchy><Button id="pro.pending.acceptButton.0" /></ViewHierarchy>',
        attributesBefore: { identifier: 'pro.pending.acceptButton.0' },
        attributesAfter: { identifier: 'pro.pending.acceptButton.0' },
        resolution: { kind: 'accept', selector: 'pro.pending.acceptButton.0', path: [0] },
        tapCompleted: true,
      };
      let firstPublished!: (value: unknown) => void;
      const firstPublishedPromise = new Promise((resolve) => {
        firstPublished = resolve;
      });
      const pending = child.runDedicatedAction(command, {
        activateCommand: true,
        runAction: () => result,
        onPublished: firstPublished,
      });
      await firstPublishedPromise;
      const firstFile = path.join(root, `${command.label}-action.private.xml`);
      if (replaceFirst) {
        await rm(firstFile);
        await writeFile(firstFile, Buffer.from('foreign-replacement\n'), { mode: 0o600 });
      }
      await writeAtomicDetoxConnectionBytes(
        root,
        `detox-connection-cancel-${commandId}.private.json`,
        Buffer.from(
          JSON.stringify({ schemaVersion: 1, commandId, commandHash: command.commandHash }),
        ),
        16 * 1024,
      );
      let rejectedError: unknown;
      await assert.rejects(pending, (error: unknown) => {
        rejectedError = error;
        const cleanup = (error as { detoxActionCleanup?: Record<string, unknown> })
          .detoxActionCleanup;
        assert(cleanup);
        assert.equal(cleanup.status, replaceFirst ? 'blocked-recovery' : 'unknown-recovery');
        assert.equal(Array.isArray(cleanup.files), true);
        assert.equal(typeof cleanup.ledgerPath, 'string');
        const validatedCleanup = requireDetoxConnectionActionCleanup(cleanup, 'cancelled');
        assert.equal(validatedCleanup.status, cleanup.status);
        if (!replaceFirst)
          assert(validatedCleanup.files.some((file) => file.outcome === 'retained'));
        return true;
      });
      assert(rejectedError);
      return { command, error: rejectedError };
    };
    const firstCancellation = await runCancelledAction(301, false);
    assert.equal(
      await readFile(path.join(root, 'connection-action-301-action.private.xml')).then(
        () => true,
        () => false,
      ),
      true,
    );
    await runCancelledAction(302, true);
    assert.equal(
      (await readFile(path.join(root, 'connection-action-302-action.private.xml'))).toString(),
      'foreign-replacement\n',
    );
    await assert.rejects(
      child.screenshotSourceReceipt(
        'relative-detox-screenshot.png',
        { pid: process.pid, pgid: process.pid, started: 'actual-child-start' },
        { label: 'connection-action-302', commandId: 302, commandHash: 'a'.repeat(64) },
      ),
      /absolute normalized string/,
    );
    await assert.rejects(
      child.screenshotSourceReceipt(
        42,
        { pid: process.pid, pgid: process.pid, started: 'actual-child-start' },
        { label: 'connection-action-302', commandId: 302, commandHash: 'a'.repeat(64) },
      ),
      /absolute normalized string/,
    );
    const invalidSourcePath = path.join(sourceRoot, 'invalid-screenshot.png');
    await writeFile(invalidSourcePath, Buffer.from('not-a-png'), { mode: 0o600 });
    await assert.rejects(
      child.screenshotSourceReceipt(
        invalidSourcePath,
        { pid: process.pid, pgid: process.pid, started: 'actual-child-start' },
        { label: 'connection-action-302', commandId: 302, commandHash: 'a'.repeat(64) },
      ),
      /PNG/i,
    );
    const validSourcePath = path.join(sourceRoot, 'valid-screenshot.png');
    await writeFile(validSourcePath, validPng(), { mode: 0o600 });
    const validReceipt = await child.screenshotSourceReceipt(
      validSourcePath,
      { pid: process.pid, pgid: process.pid, started: 'actual-child-start' },
      { label: 'connection-action-302', commandId: 302, commandHash: 'a'.repeat(64) },
    );
    assert.equal((validReceipt as { sourceBytes: number }).sourceBytes, validPng().byteLength);
    const terminal = await child.publishConnectionTerminalError(
      firstCancellation.command,
      1,
      [],
      firstCancellation.error,
    );
    assert.equal(terminal.status, 'cancelled');
    const terminalResponse = JSON.parse(
      (await readFile(path.join(root, 'detox-connection-response-301.private.json'))).toString(
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(terminalResponse.status, 'cancelled');
    assert.equal(terminalResponse.actor, 'student');
    const terminalCleanup = requireDetoxConnectionActionCleanup(
      terminalResponse.actionCleanup,
      'cancelled',
    );
    assert.equal(terminalCleanup.status, 'unknown-recovery');
    assert(terminalCleanup.files.some((file) => file.outcome === 'retained'));
    await child.publishConnectionTerminalError(
      { ...firstCancellation.command, commandId: 303, commandHash: 'b'.repeat(64) },
      1,
      [],
      new Error('switch failed before actor transition'),
    );
    const failedResponse = JSON.parse(
      (await readFile(path.join(root, 'detox-connection-response-303.private.json'))).toString(
        'utf8',
      ),
    ) as Record<string, unknown>;
    assert.equal(failedResponse.status, 'failed');
    assert.equal(failedResponse.actor, 'student');
  } finally {
    await closeFixture(parent);
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousDescribe === undefined) delete globalRecord.describe;
    else globalRecord.describe = previousDescribe;
    if (previousTest === undefined) delete globalRecord.test;
    else globalRecord.test = previousTest;
  }
});
