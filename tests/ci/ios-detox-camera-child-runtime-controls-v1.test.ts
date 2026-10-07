import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import type tsTypes from 'typescript';

const ts = createRequire(path.resolve(process.cwd(), 'package.json'))(
  'typescript',
) as typeof tsTypes;
const sourcePath =
  process.env.IOS_CAMERA_CHILD_SOURCE ??
  path.resolve(process.cwd(), 'e2e/detox-ios-camera-route.e2e.test.js');

async function sourceTree() {
  return ts.createSourceFile(
    sourcePath,
    await readFile(sourcePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

function declarations(source: tsTypes.SourceFile, names: readonly string[]): string {
  return names
    .map((name) => {
      const declaration = source.statements.find(
        (node): node is tsTypes.FunctionDeclaration =>
          ts.isFunctionDeclaration(node) && node.name?.text === name,
      );
      assert.ok(declaration, `source function ${name} must exist`);
      return declaration.getText(source);
    })
    .join('\n');
}

function evaluate<T>(text: string, globals: Record<string, unknown>): T {
  return vm.runInNewContext(text, globals) as T;
}

void test('actual child actionability waits for enabled visible hittable state and two stable frames', async () => {
  const source = await sourceTree();
  const tapId = source.statements.find(
    (node): node is tsTypes.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'tapId',
  );
  assert.ok(tapId);
  assert.match(tapId.getText(source), /waitForActionableId/);
  const code = `${declarations(source, [
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'attributeCandidates',
    'remainingDeadlineMs',
    'sleepWithinDeadline',
    'waitForActionableId',
  ])}\nwaitForActionableId;`;
  const observed = [
    {
      elements: [
        {
          enabled: true,
          visible: true,
          hittable: false,
          frame: { x: 0, y: 0 },
        },
      ],
    },
    {
      elements: [{ enabled: true, visible: true, hittable: true, frame: { x: 0, y: 0 } }],
    },
    {
      elements: [{ enabled: true, visible: true, hittable: true, frame: { x: 4, y: 0 } }],
    },
    {
      elements: [{ enabled: true, visible: true, hittable: true, frame: { x: 4, y: 0 } }],
    },
  ];
  let reads = 0;
  let clearedTimers = 0;
  const wait = evaluate<(id: string, timeout?: number) => Promise<Record<string, unknown>>>(code, {
    Date,
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout: (timer: ReturnType<typeof setTimeout>) => {
      clearedTimers += 1;
      clearTimeout(timer);
    },
    deadlineAt: Date.now() + 2_000,
    element: () => ({
      getAttributes: () => Promise.resolve(observed[Math.min(reads++, observed.length - 1)]),
    }),
    by: { id: (id: string) => id },
    assertLive: () => undefined,
  });
  const result = await wait('student.home.accountButton', 1_500);
  assert.equal(result.hittable, true);
  assert.deepEqual(result.frame, { x: 4, y: 0 });
  assert.equal(reads, 4, 'the moving frame must not satisfy the two-sample stability gate');
  assert.ok(clearedTimers > 0, 'bounded operation timers must be cleared in finally');
});

void test('actual child actionability honors the original absolute deadline instead of renewing a timeout', async () => {
  const source = await sourceTree();
  const code = `${declarations(source, [
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'attributeCandidates',
    'remainingDeadlineMs',
    'sleepWithinDeadline',
    'waitForActionableId',
  ])}\nwaitForActionableId;`;
  const deadlineAt = Date.now() + 35;
  const wait = evaluate<(id: string, timeout?: number) => Promise<unknown>>(code, {
    Date,
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    deadlineAt,
    element: () => ({
      getAttributes: () =>
        Promise.resolve({
          enabled: true,
          visible: true,
          hittable: false,
          frame: { x: 0, y: 0 },
        }),
    }),
    by: { id: (id: string) => id },
    assertLive: () => {
      if (Date.now() >= deadlineAt) throw new Error('original deadline exceeded');
    },
  });
  await assert.rejects(
    wait('student.home.accountButton', 10_000),
    /original deadline exceeded|Detox camera child deadline exceeded|did not become enabled, visible, hittable and stable/,
  );
  assert.ok(Date.now() < deadlineAt + 250, 'the helper must not renew the caller deadline');
});

void test('actual child actionability rejects a late getAttributes completion instead of returning stale state', async () => {
  const source = await sourceTree();
  const code = `${declarations(source, [
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'attributeCandidates',
    'remainingDeadlineMs',
    'sleepWithinDeadline',
    'waitForActionableId',
  ])}\nwaitForActionableId;`;
  let releaseLate: (() => void) | undefined;
  const lateAttributes = new Promise((resolve) => {
    releaseLate = () =>
      resolve({
        enabled: true,
        visible: true,
        hittable: true,
        frame: { x: 0, y: 0 },
      });
  });
  const deadlineAt = Date.now() + 35;
  const wait = evaluate<(id: string, timeout?: number) => Promise<unknown>>(code, {
    Date,
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    deadlineAt,
    element: () => ({ getAttributes: async () => lateAttributes }),
    by: { id: (id: string) => id },
    assertLive: () => {
      if (Date.now() >= deadlineAt) throw new Error('original deadline exceeded');
    },
  });
  const startedAt = Date.now();
  await assert.rejects(wait('student.home.accountButton', 10_000), /deadline exceeded/);
  assert.ok(Date.now() - startedAt < 250, 'a hanging SDK read must be fenced');
  releaseLate?.();
  await Promise.resolve();
});

void test('actual child system prompt polling uses supported toExist and supports the iOS label variants', async () => {
  const source = await sourceTree();
  const sourceText = await readFile(sourcePath, 'utf8');
  const systemWait = declarations(source, [
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'remainingDeadlineMs',
    'sleepWithinDeadline',
    'systemPromptDeadlineAt',
    'systemErrorDetails',
    'systemErrorChain',
    'createSystemObservation',
    'combineSystemObservations',
    'recordSystemObservationAttempt',
    'attachSystemObservation',
    'isOptionalSystemPromptAbsent',
    'waitForSystemElementExists',
  ]);
  const cameraObserve = source.statements.find(
    (node): node is tsTypes.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'cameraObserve',
  );
  const denyCamera = source.statements.find(
    (node): node is tsTypes.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'denyCamera',
  );
  assert.ok(cameraObserve);
  assert.ok(denyCamera);
  assert.match(sourceText, /const SYSTEM_PROMPT_BUDGET_MS = 120_000/);
  assert.match(sourceText, /systemPromptDeadlineAt\(\)/);
  assert.doesNotMatch(cameraObserve.getText(source), /15_000/);
  assert.doesNotMatch(denyCamera.getText(source), /15_000/);
  assert.match(
    cameraObserve.getText(source),
    /waitForSystemElementExists\(\s*['"]Allow['"],\s*SYSTEM_PROMPT_BUDGET_MS/,
  );
  assert.match(
    denyCamera.getText(source),
    /waitForSystemElementExists\(\s*\[['"]Don’t Allow['"], ['"]Don't Allow['"]\]/,
  );
  assert.doesNotMatch(sourceText, /device\.system/);
  assert.match(sourceText, /detoxSystem\.element\(by\.system\.label\(label\)\)/);
  const attempts: string[] = [];
  const wait = evaluate<
    (labels: string | string[], timeout?: number) => Promise<{ label: string; target: unknown }>
  >(`${systemWait}\nwaitForSystemElementExists;`, {
    Date,
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    deadlineAt: Date.now() + 2_000,
    SYSTEM_PROMPT_BUDGET_MS: 120_000,
    SYSTEM_OBSERVATION_MAX_ATTEMPTS: 16,
    SYSTEM_OBSERVATION_ERROR_MAX_CHARS: 512,
    device: Object.freeze({}),
    detoxSystem: {
      element: (value: string) => ({ value }),
    },
    by: { system: { label: (label: string) => label } },
    expect: (target: { value: string }) => ({
      toExist: () => {
        attempts.push(target.value);
        if (target.value === 'Don’t Allow')
          return Promise.reject(new Error("Expected element to exist, but it doesn't"));
        return Promise.resolve();
      },
    }),
    assertLive: () => undefined,
  });
  const result = await wait(['Don’t Allow', "Don't Allow"], 1_500);
  assert.equal(result.label, "Don't Allow");
  assert.deepEqual(attempts, ['Don’t Allow', "Don't Allow"]);
});

void test('actual child system prompt polling rejects a late toExist completion at the original deadline', async () => {
  const source = await sourceTree();
  const systemWait = declarations(source, [
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'remainingDeadlineMs',
    'sleepWithinDeadline',
    'systemPromptDeadlineAt',
    'systemErrorDetails',
    'systemErrorChain',
    'createSystemObservation',
    'combineSystemObservations',
    'recordSystemObservationAttempt',
    'attachSystemObservation',
    'isOptionalSystemPromptAbsent',
    'waitForSystemElementExists',
  ]);
  let releaseLate: (() => void) | undefined;
  const lateExistence = new Promise<void>((resolve) => {
    releaseLate = resolve;
  });
  const deadlineAt = Date.now() + 35;
  const wait = evaluate<(labels: string | string[], timeout?: number) => Promise<unknown>>(
    `${systemWait}\nwaitForSystemElementExists;`,
    {
      Date,
      JSON,
      Math,
      Promise,
      setTimeout,
      clearTimeout,
      deadlineAt,
      SYSTEM_PROMPT_BUDGET_MS: 120_000,
      SYSTEM_OBSERVATION_MAX_ATTEMPTS: 16,
      SYSTEM_OBSERVATION_ERROR_MAX_CHARS: 512,
      device: Object.freeze({}),
      detoxSystem: { element: (value: string) => ({ value }) },
      by: { system: { label: (label: string) => label } },
      expect: () => ({ toExist: () => lateExistence }),
      assertLive: () => {
        if (Date.now() >= deadlineAt) throw new Error('original deadline exceeded');
      },
    },
  );
  const startedAt = Date.now();
  await assert.rejects(wait('Allow', 10_000), /deadline exceeded/);
  assert.ok(Date.now() - startedAt < 250, 'a hanging system expectation must be fenced');
  releaseLate?.();
  await Promise.resolve();
});

void test('actual child system prompt budget covers two 45-second logical XCUITest operations under one phase anchor', async () => {
  const source = await sourceTree();
  const code = `${declarations(source, [
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'remainingDeadlineMs',
    'sleepWithinDeadline',
    'systemPromptDeadlineAt',
    'systemErrorDetails',
    'systemErrorChain',
    'createSystemObservation',
    'combineSystemObservations',
    'recordSystemObservationAttempt',
    'attachSystemObservation',
    'isOptionalSystemPromptAbsent',
    'waitForSystemElementExists',
    'denyCamera',
  ])}\ndenyCamera;`;
  let now = 0;
  const calls: string[] = [];
  const target = {
    tap: () => {
      now += 45_000;
      calls.push('tap');
      return Promise.resolve();
    },
  };
  const deny = evaluate<() => Promise<Record<string, unknown>>>(code, {
    Date: { now: () => now },
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    deadlineAt: 180_000,
    SYSTEM_PROMPT_BUDGET_MS: 120_000,
    SYSTEM_OBSERVATION_MAX_ATTEMPTS: 16,
    SYSTEM_OBSERVATION_ERROR_MAX_CHARS: 512,
    device: Object.freeze({}),
    detoxSystem: {
      element: (matcher: string) => {
        calls.push(`element:${matcher}`);
        return target;
      },
    },
    by: { system: { label: (label: string) => label } },
    expect: () => ({
      toExist: () => {
        now += 45_000;
        calls.push('toExist');
        return Promise.resolve();
      },
    }),
  });
  const result = await deny();
  assert.equal(result.permission, 'denied');
  assert.deepEqual(calls, ['element:Don’t Allow', 'toExist', 'tap']);
  assert.equal(now, 90_000);
});

void test('actual child denial tap consumes the remaining shared prompt budget instead of renewing it', async () => {
  const source = await sourceTree();
  const code = `${declarations(source, [
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'remainingDeadlineMs',
    'sleepWithinDeadline',
    'systemPromptDeadlineAt',
    'systemErrorDetails',
    'systemErrorChain',
    'createSystemObservation',
    'combineSystemObservations',
    'recordSystemObservationAttempt',
    'attachSystemObservation',
    'isOptionalSystemPromptAbsent',
    'waitForSystemElementExists',
    'denyCamera',
  ])}\ndenyCamera;`;
  let now = 0;
  const target = {
    tap: () => {
      now += 45_000;
      return Promise.resolve();
    },
  };
  const deny = evaluate<() => Promise<Record<string, unknown>>>(code, {
    Date: { now: () => now },
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    deadlineAt: 300_000,
    SYSTEM_PROMPT_BUDGET_MS: 120_000,
    SYSTEM_OBSERVATION_MAX_ATTEMPTS: 16,
    SYSTEM_OBSERVATION_ERROR_MAX_CHARS: 512,
    device: Object.freeze({}),
    detoxSystem: { element: () => target },
    by: { system: { label: (label: string) => label } },
    expect: () => ({
      toExist: () => {
        now += 90_000;
        return Promise.resolve();
      },
    }),
  });
  await assert.rejects(deny(), /camera permission denial tap deadline exceeded/);
  assert.equal(now, 135_000);
});

void test('actual child system prompt budget does not renew after local or original deadline exhaustion and propagates cancellation or unknown errors', async () => {
  const source = await sourceTree();
  const code = `${declarations(source, [
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'remainingDeadlineMs',
    'sleepWithinDeadline',
    'systemPromptDeadlineAt',
    'systemErrorDetails',
    'systemErrorChain',
    'createSystemObservation',
    'combineSystemObservations',
    'recordSystemObservationAttempt',
    'attachSystemObservation',
    'isOptionalSystemPromptAbsent',
    'waitForSystemElementExists',
  ])}\nwaitForSystemElementExists;`;
  const runWait = async (options: {
    deadlineAt: number;
    budgetLimitAt?: number;
    error?: Error;
    advanceMs: number;
  }) => {
    let now = 0;
    const wait = evaluate<
      (labels: string | string[], timeout?: number, budgetLimitAt?: number) => Promise<unknown>
    >(code, {
      Date: { now: () => now },
      JSON,
      Math,
      Promise,
      setTimeout,
      clearTimeout,
      deadlineAt: options.deadlineAt,
      SYSTEM_PROMPT_BUDGET_MS: 120_000,
      SYSTEM_OBSERVATION_MAX_ATTEMPTS: 16,
      SYSTEM_OBSERVATION_ERROR_MAX_CHARS: 512,
      device: Object.freeze({}),
      detoxSystem: { element: (value: string) => ({ value }) },
      by: { system: { label: (label: string) => label } },
      expect: () => ({
        toExist: () => {
          if (options.error) return Promise.reject(options.error);
          now += options.advanceMs;
          return Promise.resolve();
        },
      }),
    });
    return wait('Allow', 120_000, options.budgetLimitAt);
  };

  await assert.rejects(
    runWait({ deadlineAt: 1_000_000, budgetLimitAt: 45_000, advanceMs: 45_000 }),
    /deadline exceeded|did not exist/,
  );
  await assert.rejects(runWait({ deadlineAt: 45_000, advanceMs: 45_000 }), /deadline exceeded/);
  for (const error of [
    new Error('camera prompt cancelled'),
    new Error('system bridge unavailable'),
  ])
    await assert.rejects(
      runWait({ deadlineAt: 1_000_000, error, advanceMs: 0 }),
      (actual) => actual === error,
    );
});

void test('actual child failure evidence captures private hierarchy and PNG while retaining the original error', async () => {
  const source = await sourceTree();
  const code = `${declarations(source, [
    'sha256',
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'failureErrorDetails',
    'captureFailureEvidence',
  ])}\ncaptureFailureEvidence;`;
  const writes: { name: string; bytes: Buffer }[] = [];
  const screenshotBytes = Buffer.from('89504e470d0a1a0aactual-png', 'hex');
  const capture = evaluate<
    (command: Record<string, string>, error: Error) => Promise<Record<string, unknown>>
  >(code, {
    Buffer,
    createHash,
    Date,
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    deadlineAt: Date.now() + 2_000,
    device: {
      generateViewHierarchyXml: () => Promise.resolve('<hierarchy/>' as string),
      takeScreenshot: () => Promise.resolve('/private/actual-failure.png'),
    },
    readFile: () => Promise.resolve(screenshotBytes),
    privateWrite: (name: string, bytes: Buffer) => {
      writes.push({ name, bytes });
      return Promise.resolve({
        path: `/private/${name}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        mode: 0o600,
      });
    },
    assertLive: () => undefined,
  });
  const original = new Error('original UITransitionView actionability failure');
  const result = await capture(
    { commandId: 'camera-command-7', commandHash: 'b'.repeat(64) },
    original,
  );
  assert.equal(result.status, 'complete');
  assert.equal((result.originalError as { name: string }).name, 'Error');
  assert.equal(
    (result.originalError as { message: string }).message,
    'Error: original UITransitionView actionability failure',
  );
  assert.deepEqual(
    writes.map((write) => write.name),
    [
      'detox-camera-failure-734e253a9eb23f00862af0e7.private.xml',
      'detox-camera-failure-734e253a9eb23f00862af0e7.private.png',
    ],
  );
  assert.equal(writes[0].bytes.toString('utf8'), '<hierarchy/>');
  assert.equal(writes[1].bytes, screenshotBytes);
});

void test('actual child failure evidence writes bounded system observation diagnostics privately', async () => {
  const source = await sourceTree();
  const code = `${declarations(source, [
    'sha256',
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'systemErrorDetails',
    'systemErrorChain',
    'failureErrorDetails',
    'captureFailureEvidence',
  ])}\ncaptureFailureEvidence;`;
  const writes: { name: string; bytes: Buffer; mode: number }[] = [];
  const screenshotBytes = Buffer.from('89504e470d0a1a0aactual-png', 'hex');
  const capture = evaluate<
    (command: Record<string, string>, error: Error) => Promise<Record<string, unknown>>
  >(code, {
    Buffer,
    createHash,
    Date,
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    deadlineAt: Date.now() + 2_000,
    device: {
      generateViewHierarchyXml: () => Promise.resolve('<hierarchy/>' as string),
      takeScreenshot: () => Promise.resolve('/private/actual-failure.png'),
    },
    readFile: () => Promise.resolve(screenshotBytes),
    privateWrite: (name: string, bytes: Buffer) => {
      writes.push({ name, bytes, mode: 0o600 });
      return Promise.resolve({
        path: `/private/${name}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        mode: 0o600,
      });
    },
    assertLive: () => undefined,
  });
  const original = new Error('optional password prompt deadline exceeded');
  Object.defineProperty(original, 'detoxCameraSystemObservation', {
    value: {
      schema: 'detox-ios-camera-system-observation-v2',
      lookups: [
        {
          lookup: { namespace: 'app-under-test' },
          attempts: [{ elapsedMs: 11, outcome: 'recognized-absent' }],
          lastNativeError: null,
        },
        {
          lookup: { namespace: 'springboard' },
          attempts: [{ elapsedMs: 17000, outcome: 'recognized-absent' }],
          lastNativeError: { message: 'XCUITest runner failure', errorChain: [] },
        },
      ],
    },
  });
  const result = await capture(
    { commandId: 'camera-command-diagnostic', commandHash: 'f'.repeat(64) },
    original,
  );
  assert.ok(result.systemObservation);
  const diagnosticWrite = writes.find((write) =>
    write.name.startsWith('detox-camera-system-observation-'),
  );
  assert.ok(diagnosticWrite);
  if (!diagnosticWrite) throw new Error('system observation diagnostic was not written');
  assert.equal(diagnosticWrite.mode, 0o600);
  const diagnosticPayload = JSON.parse(diagnosticWrite.bytes.toString('utf8')) as {
    lookups: { lookup: { namespace: string } }[];
  };
  assert.equal(diagnosticPayload.lookups[1].lookup.namespace, 'springboard');
});

void test('actual child failure evidence stays partial when native capture fails and never fabricates a frame', async () => {
  const source = await sourceTree();
  const code = `${declarations(source, [
    'sha256',
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'failureErrorDetails',
    'captureFailureEvidence',
  ])}\ncaptureFailureEvidence;`;
  const capture = evaluate<
    (command: Record<string, string>, error: Error) => Promise<Record<string, unknown>>
  >(code, {
    Buffer,
    createHash,
    Date,
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    deadlineAt: Date.now() + 2_000,
    device: {
      generateViewHierarchyXml: () => Promise.resolve('<hierarchy/>' as string),
      takeScreenshot: () => Promise.resolve('/private/actual-failure.png'),
    },
    readFile: () => Promise.resolve(Buffer.from('not-a-png')),
    privateWrite: (name: string, bytes: Buffer) =>
      Promise.resolve({
        path: `/private/${name}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: bytes.length,
        mode: 0o600,
      }),
    assertLive: () => undefined,
  });
  const result = await capture(
    { commandId: 'camera-command-8', commandHash: 'c'.repeat(64) },
    new Error('original native capture failure'),
  );
  assert.equal(result.status, 'partial');
  assert.ok(result.hierarchy);
  assert.equal(result.screenshot, null);
  assert.match(JSON.stringify(result.errors), /was not PNG bytes/);
});

void test('actual child failure diagnostics are bounded and retain unknown evidence after a late hierarchy read', async () => {
  const source = await sourceTree();
  const code = `${declarations(source, [
    'sha256',
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'failureErrorDetails',
    'captureFailureEvidence',
  ])}\ncaptureFailureEvidence;`;
  let releaseLate: (() => void) | undefined;
  const lateHierarchy = new Promise((resolve) => {
    releaseLate = () => resolve('<late-hierarchy/>');
  });
  let screenshotCalls = 0;
  const deadlineAt = Date.now() + 45;
  const capture = evaluate<
    (command: Record<string, string>, error: Error) => Promise<Record<string, unknown>>
  >(code, {
    Buffer,
    createHash,
    Date,
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    deadlineAt,
    device: {
      generateViewHierarchyXml: () => lateHierarchy,
      takeScreenshot: () => {
        screenshotCalls += 1;
        return Promise.resolve('/private/late.png');
      },
    },
    readFile: () => Promise.resolve(Buffer.from('89504e470d0a1a0a', 'hex')),
    privateWrite: () =>
      Promise.reject(new Error('private write must not be reached after the diagnostics deadline')),
    assertLive: () => {
      if (Date.now() >= deadlineAt) throw new Error('original deadline exceeded');
    },
  });
  const startedAt = Date.now();
  const result = await capture(
    { commandId: 'camera-command-9', commandHash: 'd'.repeat(64) },
    new Error('original delayed hierarchy failure'),
  );
  assert.ok(Date.now() - startedAt < 300, 'diagnostics must use one bounded capture anchor');
  assert.equal(result.status, 'unknown');
  assert.equal(result.hierarchy, null);
  assert.equal(result.screenshot, null);
  assert.equal(screenshotCalls, 0);
  assert.match(JSON.stringify(result.originalError), /original delayed hierarchy failure/);
  releaseLate?.();
  await Promise.resolve();
});

void test('actual child failure diagnostics fence late screenshot, read and private-write operations', async () => {
  const source = await sourceTree();
  const code = `${declarations(source, [
    'sha256',
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'failureErrorDetails',
    'captureFailureEvidence',
  ])}\ncaptureFailureEvidence;`;
  const runCase = async (stage: 'screenshot' | 'read' | 'write') => {
    let releaseLate: (() => void) | undefined;
    const late = new Promise<unknown>((resolve) => {
      releaseLate = () => resolve(stage === 'screenshot' ? '/late.png' : Buffer.from('late'));
    });
    let screenshotCalls = 0;
    const deadlineAt = Date.now() + 45;
    const capture = evaluate<
      (command: Record<string, string>, error: Error) => Promise<Record<string, unknown>>
    >(code, {
      Buffer,
      createHash,
      Date,
      JSON,
      Math,
      Promise,
      setTimeout,
      clearTimeout,
      deadlineAt,
      device: {
        generateViewHierarchyXml: () => Promise.resolve('<hierarchy/>'),
        takeScreenshot: () => {
          screenshotCalls += 1;
          return stage === 'screenshot' ? late : Promise.resolve('/private/late.png');
        },
      },
      readFile: () =>
        stage === 'read' ? late : Promise.resolve(Buffer.from('89504e470d0a1a0a', 'hex')),
      privateWrite: (name: string, bytes: Buffer) =>
        stage === 'write'
          ? late
          : Promise.resolve({
              path: `/private/${name}`,
              sha256: createHash('sha256').update(bytes).digest('hex'),
              bytes: bytes.length,
              mode: 0o600,
            }),
      assertLive: () => {
        if (Date.now() >= deadlineAt) throw new Error('original deadline exceeded');
      },
    });
    const startedAt = Date.now();
    const result = await capture(
      { commandId: `camera-${stage}`, commandHash: 'e'.repeat(64) },
      new Error(`original delayed ${stage} failure`),
    );
    assert.ok(Date.now() - startedAt < 300, `${stage} diagnostics must be fenced`);
    assert.ok(JSON.stringify(result.originalError).includes(`original delayed ${stage} failure`));
    assert.equal(result.status, stage === 'write' ? 'unknown' : 'partial');
    if (stage === 'write') assert.equal(screenshotCalls, 0);
    releaseLate?.();
    await Promise.resolve();
  };
  await runCase('screenshot');
  await runCase('read');
  await runCase('write');
});
