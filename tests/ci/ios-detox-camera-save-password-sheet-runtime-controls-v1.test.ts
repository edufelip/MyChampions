import assert from 'node:assert/strict';
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

function executeSource<T>(text: string, globals: Record<string, unknown>): T {
  return vm.runInNewContext(text, globals) as T;
}

function helperCode(source: tsTypes.SourceFile): string {
  return `${declarations(source, [
    'attributeCandidates',
    'assertLive',
    'assertWithinDeadline',
    'runWithinDeadline',
    'remainingDeadlineMs',
    'sleepWithinDeadline',
    'systemPromptDeadlineAt',
    'systemErrorDetails',
    'systemErrorChain',
    'createSystemObservation',
    'createAppNativeObservation',
    'combineSystemObservations',
    'recordSystemObservationAttempt',
    'attachSystemObservation',
    'isOptionalSystemPromptAbsent',
    'waitForNativePromptTarget',
    'probeAppNativeNotNow',
    'dismissOptionalPasswordSavePrompt',
  ])}\ndismissOptionalPasswordSavePrompt;`;
}

function helperGlobals(
  deadlineAt: number,
  expect: (target: unknown) => { toExist: () => Promise<void> },
  detoxSystem: { element: (matcher: unknown) => unknown },
  by: {
    system: { label: (label: string) => unknown };
    label?: (label: string) => unknown;
    text?: (label: string) => unknown;
  },
  element: (matcher: unknown) => unknown = () => ({
    getAttributes: () => Promise.resolve({ elements: [] }),
  }),
) {
  return {
    Date,
    JSON,
    Math,
    Promise,
    setTimeout,
    clearTimeout,
    deadlineAt,
    SYSTEM_PROMPT_BUDGET_MS: 120_000,
    APP_NATIVE_NOT_NOW_PROBE_MS: 2_000,
    SYSTEM_OBSERVATION_MAX_ATTEMPTS: 16,
    SYSTEM_OBSERVATION_ERROR_MAX_CHARS: 512,
    expect,
    device: Object.freeze({}),
    detoxSystem,
    by: {
      label: by.label ?? ((label) => `native-label:${label}`),
      text: by.text ?? ((label) => `native-text:${label}`),
      ...by,
    },
    element,
  };
}

void test('actual optional password sheet helper uses the exact Not Now label and installed Detox system API', async () => {
  const source = await sourceTree();
  const sourceText = await readFile(sourcePath, 'utf8');
  const helper = source.statements.find(
    (node): node is tsTypes.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'dismissOptionalPasswordSavePrompt',
  );
  const execute = source.statements.find(
    (node): node is tsTypes.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'execute',
  );
  const cameraObserve = source.statements.find(
    (node): node is tsTypes.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'cameraObserve',
  );
  assert.ok(helper);
  assert.ok(execute);
  assert.ok(cameraObserve);
  const helperText = helper.getText(source);
  const executeText = execute.getText(source);
  assert.match(helperText, /const label = 'Not Now'/);
  assert.match(helperText, /by\.system\.label\(label\)/);
  assert.match(helperText, /expect\(target\)\.toExist\(\)/);
  assert.match(helperText, /target\.tap\(\)/);
  assert.match(
    executeText,
    /await signIn\(studentEmail, studentPassword, 'student\.home\.screen'\)/,
  );
  assert.ok(
    executeText.indexOf('await signIn(') <
      executeText.indexOf('await dismissOptionalPasswordSavePrompt('),
  );
  assert.ok(
    executeText.indexOf('await dismissOptionalPasswordSavePrompt(') <
      executeText.indexOf("actor = 'student'"),
  );
  assert.doesNotMatch(cameraObserve.getText(source), /dismissOptionalPasswordSavePrompt/);
  assert.match(sourceText, /const SYSTEM_PROMPT_BUDGET_MS = 120_000/);
  assert.match(sourceText, /const APP_NATIVE_NOT_NOW_PROBE_MS = 2_000/);
  assert.match(helperText, /SYSTEM_PROMPT_BUDGET_MS/);
  assert.match(executeText, /dismissOptionalPasswordSavePrompt\(\s*SYSTEM_PROMPT_BUDGET_MS/);
  assert.match(sourceText, /by\.label\(label\)/);
  assert.match(sourceText, /by\.text\(label\)/);
  assert.match(sourceText, /rootBundleIdentifier: 'com\.apple\.springboard'/);
  assert.match(sourceText, /applicationConstraintSupported: false/);
  assert.match(sourceText, /applicationConstraintSupported: true/);
  assert.match(sourceText, /SYSTEM_OBSERVATION_MAX_ATTEMPTS = 16/);
  assert.doesNotMatch(sourceText, /device\.system/);
  assert.match(sourceText, /const \{ system: detoxSystem \} = require\('detox'\)/);
  assert.match(sourceText, /detoxSystem\.element\(by\.system\.label\(label\)\)/);

  const requireFromQ = createRequire(path.resolve(process.cwd(), 'package.json'));
  const installedSystem = requireFromQ('detox/src/ios/system.js') as {
    systemMatcher: () => { label: (label: string) => unknown };
    systemElement: (runner: unknown, matcher: unknown) => { tap: () => Promise<void> };
    systemExpect: (runner: unknown, element: unknown) => { toExist: () => Promise<void> };
  };
  const invocations: unknown[] = [];
  const runner = {
    execute: (invocation: unknown) => {
      invocations.push(invocation);
      return Promise.resolve();
    },
  };
  const matcher = installedSystem.systemMatcher().label('Not Now');
  const element = installedSystem.systemElement(runner, matcher);
  await installedSystem.systemExpect(runner, element).toExist();
  await element.tap();
  assert.deepEqual(invocations, [
    {
      type: 'systemExpectation',
      systemPredicate: { type: 'label', value: 'Not Now' },
      systemExpectation: 'toExist',
    },
    {
      type: 'systemAction',
      systemPredicate: { type: 'label', value: 'Not Now' },
      systemAction: 'tap',
    },
  ]);
});

void test('actual helper binds the installed public Detox system wrapper and fails the old device.system namespace', async () => {
  const source = await sourceTree();
  const requireFromQ = createRequire(path.resolve(process.cwd(), 'package.json'));
  const detox = requireFromQ('detox') as Record<PropertyKey, unknown>;
  const DetoxContext = requireFromQ('detox/src/realms/DetoxContext') as {
    protected: { $worker: symbol };
  };
  const workerSymbol = DetoxContext.protected.$worker;
  const previousWorker = detox[workerSymbol];
  const publicCalls: unknown[] = [];
  const target = { tap: () => Promise.resolve() };
  detox[workerSymbol] = {
    system: {
      element: (matcher: unknown) => {
        publicCalls.push(matcher);
        return target;
      },
    },
  };
  try {
    const publicSystem = detox.system as { element: (matcher: unknown) => unknown };
    const deadlineAt = Date.now() + 1_000;
    const helper = executeSource<(timeout?: number) => Promise<Record<string, unknown>>>(
      helperCode(source),
      helperGlobals(deadlineAt, () => ({ toExist: () => Promise.resolve() }), publicSystem, {
        system: { label: (label) => `matcher:${label}` },
      }),
    );
    const result = await helper(100);
    assert.equal(result.status, 'dismissed');
    assert.deepEqual(publicCalls, ['matcher:Not Now']);
  } finally {
    detox[workerSymbol] = previousWorker;
  }
});

void test('actual helper probes app-native Not Now semantics before SpringBoard and taps only stable actionable attributes', async () => {
  const source = await sourceTree();
  const calls: string[] = [];
  let attributeCalls = 0;
  const target = {
    getAttributes: () => {
      attributeCalls += 1;
      calls.push(`attributes:${attributeCalls}`);
      return Promise.resolve({
        enabled: true,
        visible: true,
        hittable: true,
        frame: { x: 10, y: 20, width: 80, height: 40 },
      });
    },
    tap: () => {
      calls.push('tap');
      return Promise.resolve();
    },
  };
  const helper = executeSource<(timeout?: number) => Promise<Record<string, unknown>>>(
    helperCode(source),
    helperGlobals(
      Date.now() + 1_000,
      () => ({ toExist: () => Promise.reject(new Error('system lookup must not run')) }),
      { element: () => ({ tap: () => Promise.reject(new Error('system lookup must not run')) }) },
      {
        system: { label: (label) => `system:${label}` },
        label: (label) => `native-label:${label}`,
        text: (label) => `native-text:${label}`,
      },
      (matcher) => {
        calls.push(`element:${String(matcher)}`);
        return target;
      },
    ),
  );
  const result = await helper(1_000);
  assert.equal(result.status, 'dismissed');
  assert.equal(result.label, 'Not Now');
  assert.equal(result.source, 'app-native');
  assert.equal(result.strategy, 'label');
  assert.equal(attributeCalls, 2, 'app-native probe must require two stable samples');
  assert.deepEqual(calls, ['element:native-label:Not Now', 'attributes:1', 'attributes:2', 'tap']);
});

void test('actual helper preserves separate app-native and SpringBoard absence diagnostics before returning optional absence', async () => {
  const source = await sourceTree();
  const systemAbsent = new Error(
    'Expectation failed, element with matcher `label == "Not Now"` does not exist',
  );
  systemAbsent.cause = new Error('XCUITest runner failed with no error message');
  const helper = executeSource<(timeout?: number) => Promise<Record<string, unknown>>>(
    helperCode(source),
    helperGlobals(
      Date.now() + 1_000,
      () => ({ toExist: () => Promise.reject(systemAbsent) }),
      { element: () => ({ tap: () => Promise.resolve() }) },
      { system: { label: (label) => `system:${label}` } },
      () => ({ getAttributes: () => Promise.resolve({ elements: [] }) }),
    ),
  );
  const result = await helper(35);
  const observation = result.systemObservation as {
    schema: string;
    lookups: {
      lookup: { namespace: string };
      attempts: unknown[];
      lastNativeError: { errorChain?: { message?: string }[] } | null;
    }[];
  };
  assert.equal(result.status, 'absent');
  assert.equal(observation.schema, 'detox-ios-camera-system-observation-v2');
  assert.equal(
    observation.lookups.map((lookup) => lookup.lookup.namespace).join('|'),
    'app-under-test|springboard',
  );
  assert.ok(observation.lookups[0].attempts.length > 0);
  assert.ok(observation.lookups[1].attempts.length > 0);
  assert.match(
    String(observation.lookups[1].lastNativeError?.errorChain?.[1]?.message),
    /XCUITest runner/,
  );
});

void test('actual helper propagates an unknown app-native probe failure with its observation scope intact', async () => {
  const source = await sourceTree();
  const unknown = new Error('native app bridge unavailable');
  const helper = executeSource<(timeout?: number) => Promise<Record<string, unknown>>>(
    helperCode(source),
    helperGlobals(
      Date.now() + 1_000,
      () => ({ toExist: () => Promise.resolve() }),
      { element: () => ({ tap: () => Promise.resolve() }) },
      { system: { label: (label) => label } },
      () => ({ getAttributes: () => Promise.reject(unknown) }),
    ),
  );
  await assert.rejects(helper(100), (error: unknown) => {
    assert.equal(error, unknown);
    const diagnosticError = error as Error & {
      detoxCameraSystemObservation: {
        lookup: { namespace: string };
        terminalError: { message: string };
      };
    };
    assert.equal(diagnosticError.detoxCameraSystemObservation.lookup.namespace, 'app-under-test');
    assert.match(
      diagnosticError.detoxCameraSystemObservation.terminalError.message,
      /native app bridge/,
    );
    return true;
  });
});

void test('actual helper dismisses a present Not Now sheet and taps only after toExist succeeds', async () => {
  const source = await sourceTree();
  const calls: string[] = [];
  const target = {
    tap: () => {
      calls.push('tap');
      return Promise.resolve();
    },
  };
  const deadlineAt = Date.now() + 1_000;
  const helper = executeSource<(timeout?: number) => Promise<Record<string, unknown>>>(
    helperCode(source),
    helperGlobals(
      deadlineAt,
      (observed) => ({
        toExist: () => {
          calls.push(`toExist:${String(observed)}`);
          return Promise.resolve();
        },
      }),
      {
        element: (matcher) => {
          calls.push(`element:${String(matcher)}`);
          return target;
        },
      },
      {
        system: {
          label: (label) => {
            calls.push(`label:${label}`);
            return `matcher:${label}`;
          },
        },
      },
    ),
  );
  const result = await helper(100);
  assert.equal(result.status, 'dismissed');
  assert.equal(result.label, 'Not Now');
  assert.deepEqual(calls, [
    'label:Not Now',
    'element:matcher:Not Now',
    'toExist:[object Object]',
    'tap',
  ]);
});

void test('actual helper returns absent only for a recognized missing system element and never taps', async () => {
  const source = await sourceTree();
  let taps = 0;
  const deadlineAt = Date.now() + 1_000;
  const helper = executeSource<(timeout?: number) => Promise<Record<string, unknown>>>(
    helperCode(source),
    helperGlobals(
      deadlineAt,
      () => ({
        toExist: () => Promise.reject(new Error("Expected element to exist, but it doesn't")),
      }),
      {
        element: () => ({
          tap: () => {
            taps += 1;
            return Promise.resolve();
          },
        }),
      },
      { system: { label: (label) => label } },
    ),
  );
  const startedAt = Date.now();
  const result = await helper(35);
  assert.equal(result.status, 'absent');
  assert.equal(result.label, 'Not Now');
  assert.equal(taps, 0);
  assert.ok(
    Date.now() - startedAt < 250,
    'optional absence polling must stay within its local cap',
  );
});

void test('actual helper propagates cancellation and unrelated system blockers instead of treating them as absence', async () => {
  const source = await sourceTree();
  for (const message of ['camera command cancelled', 'system bridge unavailable']) {
    const deadlineAt = Date.now() + 1_000;
    const helper = executeSource<(timeout?: number) => Promise<Record<string, unknown>>>(
      helperCode(source),
      helperGlobals(
        deadlineAt,
        () => ({
          toExist: () => Promise.reject(new Error(message)),
        }),
        { element: () => ({ tap: () => Promise.resolve() }) },
        { system: { label: (label) => label } },
      ),
    );
    await assert.rejects(helper(100), new RegExp(message));
  }
});

void test('actual helper propagates tap failures after a successful system existence check', async () => {
  const source = await sourceTree();
  const deadlineAt = Date.now() + 1_000;
  const helper = executeSource<(timeout?: number) => Promise<Record<string, unknown>>>(
    helperCode(source),
    helperGlobals(
      deadlineAt,
      () => ({ toExist: () => Promise.resolve() }),
      {
        element: () => ({
          tap: () => Promise.reject(new Error('system tap blocked')),
        }),
      },
      { system: { label: (label) => label } },
    ),
  );
  await assert.rejects(helper(100), /system tap blocked/);
});

void test('actual helper fences a hanging system existence read at the original absolute deadline', async () => {
  const source = await sourceTree();
  let releaseLate: (() => void) | undefined;
  const lateExistence = new Promise<void>((resolve) => {
    releaseLate = resolve;
  });
  const deadlineAt = Date.now() + 35;
  const helper = executeSource<(timeout?: number) => Promise<Record<string, unknown>>>(
    helperCode(source),
    helperGlobals(
      deadlineAt,
      () => ({ toExist: () => lateExistence }),
      { element: () => ({ tap: () => Promise.resolve() }) },
      { system: { label: (label) => label } },
    ),
  );
  const startedAt = Date.now();
  await assert.rejects(helper(10_000), /deadline exceeded/);
  assert.ok(
    Date.now() - startedAt < 250,
    'late system reads must be bounded by the caller deadline',
  );
  releaseLate?.();
  await Promise.resolve();
});
