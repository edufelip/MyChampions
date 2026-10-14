import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  applyIosLocaleScenarioResult,
  iosNativeCharters,
  parseIosNativeCaptureArguments,
} from '../../scripts/testing/capture-native-testability';
import {
  runIosLocaleCaptureCallback,
  validateIosLocaleScenarioResult,
  type IosLocaleCaptureWiring,
} from '../../scripts/testing/ios-locale-capture-wiring';
import {
  runIosLocaleScenario,
  type IosLocaleRuntimeContext,
  type IosLocaleRuntimeTransport,
  type IosLocaleScenarioInput,
  type IosLocaleScenarioResult,
} from '../../scripts/testing/ios-locale-runtime-adapter';
import { nativeSessionHelperInputPaths } from '../../scripts/testing/native-session-helper-ledger';
import type { NativeLocaleBinding } from '../../scripts/testing/locale-native-observation';

const CAPTURE = 'a'.repeat(24);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const binding: NativeLocaleBinding = {
  captureRunId: CAPTURE,
  sourceTreeHash: hash('source'),
  helperInputsHash: hash('helpers'),
  target: {
    platform: 'ios',
    deviceId: '01234567-89AB-CDEF-0123-456789ABCDEF',
    osVersion: 'iOS 26.5',
    appId: 'com.edufelip.mychampions.dev',
    binaryHash: hash('binary'),
    apiOrigin: 'http://127.0.0.1:19002',
  },
};
const scenario: IosLocaleScenarioInput = {
  scenarioId: 'locale-selection-persistence',
  requestedLocale: 'en-US',
  baselineOsLocale: 'pt-BR',
  expectedBinding: binding,
};

function pendingResult(): IosLocaleScenarioResult {
  return {
    kind: 'private-ios-locale-runtime-scenario-result-not-runtime-proof',
    schemaVersion: 3,
    scenarioId: scenario.scenarioId,
    requestedLocale: scenario.requestedLocale,
    baselineOsLocale: scenario.baselineOsLocale!,
    expectedBinding: binding,
    status: 'blocked',
    runtimeQualification: 'pending',
    nativePassingCases: 0,
    publicLocale: null,
    freshTarget: null,
    phaseReceipts: [],
    osReadbacks: [],
    overrideReadbacks: [],
    selectionFrames: [],
    coachSignInReceipt: null,
    commandReceipts: [],
    appContainerReceipts: [],
    resetReceipts: [],
    steps: [],
    checkpoints: [],
    cleanupAttempted: false,
    cleanupObserved: false,
    cleanupOwner: 'outer-capture',
    cleanupReceipt: null,
    cleanupError: null,
    blockers: ['synthetic-source-control-only'],
  };
}

function wiring(): IosLocaleCaptureWiring {
  return {
    context: { cleanupOwner: 'outer-capture' } as IosLocaleRuntimeContext,
    run: () => Promise.resolve(pendingResult()),
    signInBoundary: {
      beforeRequestId: 0,
      expectedAuthUid: 'coach',
      expectedApiPid: 1234,
      expectedApiOrigin: 'http://127.0.0.1:19001',
    },
  };
}

function phaseReceipt(operationId: string) {
  return {
    status: 'observed' as const,
    captureRunId: CAPTURE,
    operationId,
    startedAt: '2026-10-02T12:00:00.000Z',
    finishedAt: '2026-10-02T12:00:01.000Z',
    reason: null,
    commandReceiptRefs: [],
  };
}

function realOuterWiring(cleanupCalls: { value: number }): IosLocaleCaptureWiring {
  const transport: IosLocaleRuntimeTransport = {
    platform: 'ios',
    contextCleanupOwner: 'outer-capture',
    prepareFreshTarget: () => Promise.reject(new Error('fresh-target-failed')),
    setOsLocale: () => Promise.resolve(phaseReceipt('set-os')),
    readOsLocale: () => Promise.reject(new Error('read-os-should-not-run')),
    readOverride: () => Promise.reject(new Error('override-should-not-run')),
    launch: () => Promise.resolve(phaseReceipt('launch')),
    runNormalFlow: () => Promise.resolve(phaseReceipt('flow')),
    captureHierarchy: () => Promise.reject(new Error('hierarchy-should-not-run')),
    auditSelection: () => ({
      status: 'blocked' as const,
      reason: 'language-screen-missing' as const,
    }),
    saveSelection: () => Promise.resolve(phaseReceipt('save')),
    clearOverride: () => Promise.reject(new Error('clear-should-not-run')),
    cleanup: () => {
      cleanupCalls.value += 1;
      return Promise.reject(new Error('outer capture owns cleanup'));
    },
    cleanupReceipt: () => null,
    commandReceipts: () => [],
    appContainerReceipt: () => null,
    coachSignInReceipt: () => null,
  };
  return {
    context: { cleanupOwner: 'outer-capture' } as IosLocaleRuntimeContext,
    run: (receivedScenario) => runIosLocaleScenario(receivedScenario, transport),
    signInBoundary: {
      beforeRequestId: 0,
      expectedAuthUid: 'fixture-coach',
      expectedApiPid: 1234,
      expectedApiOrigin: 'http://127.0.0.1:19001',
    },
  };
}

void test('locale charter paths require one explicit supported locale', () => {
  for (const requestedLocale of ['en-US', 'pt-BR', 'es-ES'] as const) {
    const parsed = parseIosNativeCaptureArguments([
      '--platform=ios',
      '--mode=inventory',
      '--charter=locale-selection-persistence',
      `--locale=${requestedLocale}`,
    ]);
    assert.equal(parsed.locale, requestedLocale);
    assert.equal(parsed.charter, 'locale-selection-persistence');
  }
  assert.throws(
    () =>
      parseIosNativeCaptureArguments([
        '--platform=ios',
        '--mode=inventory',
        '--charter=locale-selection-persistence',
      ]),
    /Invalid iOS native capture arguments/,
  );
  assert.throws(
    () =>
      parseIosNativeCaptureArguments([
        '--platform=ios',
        '--mode=inventory',
        '--charter=locale-selection-persistence',
        '--locale=fr-FR',
      ]),
    /Invalid iOS native capture arguments/,
  );
  assert.throws(
    () =>
      parseIosNativeCaptureArguments([
        '--platform=ios',
        '--mode=inventory',
        '--charter=entry',
        '--locale=en-US',
      ]),
    /Invalid iOS native capture arguments/,
  );
  assert.ok(iosNativeCharters.includes('locale-os-fallback-reset'));
});

void test('capture source has a real locale branch and the complete helper closure', async () => {
  const source = await readFile('scripts/testing/capture-native-testability.ts', 'utf8');
  for (const token of [
    /locale-selection-persistence/,
    /locale-os-fallback-reset/,
    /executeLocale/,
    /createIosLocaleCaptureWiring/,
    /runIosLocaleCaptureCallback/,
    /runLocaleProcessCensus/,
    /enableNativeAuthIdentityCapture/,
    /fixtureEvidence/,
    /cleanupOwner:\s*['"]outer-capture['"]/,
  ])
    assert.match(source, token, `capture branch is missing ${token}`);
  for (const helper of [
    'scripts/testing/ios-locale-capture-wiring.ts',
    'scripts/testing/ios-locale-runtime-adapter.ts',
    'scripts/testing/ios-locale-storage.ts',
    'scripts/testing/ios-locale-quiescence.ts',
  ])
    assert.equal(
      nativeSessionHelperInputPaths.includes(
        helper as (typeof nativeSessionHelperInputPaths)[number],
      ),
      true,
      `locale helper closure is missing ${helper}`,
    );
});

void test('callback is invoked once and leaves cleanup with the outer capture', async () => {
  const controller = new AbortController();
  let calls = 0;
  const result = await runIosLocaleCaptureCallback({
    wiring: wiring(),
    scenario,
    signal: controller.signal,
    readCurrentBinding: () => Promise.resolve(structuredClone(binding)),
    execute: async ({ context, run, scenario: received }) => {
      calls += 1;
      assert.equal(context.cleanupOwner, 'outer-capture');
      assert.equal(await run(received).then((value) => value.cleanupOwner), 'outer-capture');
      return pendingResult();
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.runtimeQualification, 'pending');
  assert.equal(result.nativePassingCases, 0);
});

void test('callback runs the real locale scenario and blocks outer publication', async () => {
  const cleanupCalls = { value: 0 };
  const result = await runIosLocaleCaptureCallback({
    wiring: realOuterWiring(cleanupCalls),
    scenario,
    signal: new AbortController().signal,
    readCurrentBinding: () => Promise.resolve(structuredClone(binding)),
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.cleanupOwner, 'outer-capture');
  assert.equal(cleanupCalls.value, 0);
  const report: Record<string, unknown> = { result: 'harness-blocked' };
  assert.equal(applyIosLocaleScenarioResult(report, result), false);
  assert.equal(report.result, 'harness-blocked');
  assert.equal(report.localeScenarioStatus, 'blocked');
});

void test('callback rejects a forged observed result before outer publication', async () => {
  const forged = {
    ...pendingResult(),
    status: 'observed' as const,
    blockers: [],
    steps: [],
    cleanupAttempted: false,
    cleanupObserved: false,
    cleanupReceipt: null,
  };
  await assert.rejects(
    runIosLocaleCaptureCallback({
      wiring: wiring(),
      scenario,
      signal: new AbortController().signal,
      readCurrentBinding: () => Promise.resolve(structuredClone(binding)),
      execute: () => Promise.resolve(forged),
    }),
    /observed locale callback result is incomplete or blocked/,
  );
  assert.throws(
    () => validateIosLocaleScenarioResult(forged, scenario),
    /observed locale callback/,
  );
});

void test('validator and outer projection reject cleanup failure metadata', () => {
  const forged = {
    ...pendingResult(),
    status: 'observed' as const,
    blockers: [],
    steps: [{ id: 'fresh-target', status: 'observed' as const, blocker: null }],
    checkpoints: [null],
    phaseReceipts: [null],
    commandReceipts: [null],
    cleanupAttempted: false,
    cleanupObserved: false,
    cleanupReceipt: null,
    cleanupError: 'cleanup-unproven',
  } as unknown as IosLocaleScenarioResult;
  assert.throws(
    () => validateIosLocaleScenarioResult(forged, scenario),
    /outer-capture locale callback result carries scenario cleanup state/,
  );
  const report: Record<string, unknown> = { result: 'observed' };
  assert.equal(applyIosLocaleScenarioResult(report, forged), false);
  assert.equal(report.result, 'harness-blocked');
});

void test('validator rejects outer-owned blocked results with scenario cleanup attempts', () => {
  const forged = {
    ...pendingResult(),
    cleanupAttempted: true,
    cleanupObserved: false,
    cleanupReceipt: null,
    cleanupError: null,
  } as unknown as IosLocaleScenarioResult;
  assert.throws(
    () => validateIosLocaleScenarioResult(forged, scenario),
    /outer-capture locale callback result carries scenario cleanup state/,
  );
});

void test('callback failures propagate without invoking a second cleanup owner', async () => {
  let cleanupCalls = 0;
  await assert.rejects(
    runIosLocaleCaptureCallback({
      wiring: wiring(),
      scenario,
      signal: new AbortController().signal,
      readCurrentBinding: () => Promise.resolve(structuredClone(binding)),
      execute: () => {
        cleanupCalls += 1;
        return Promise.reject(new Error('callback-failed'));
      },
    }),
    /callback-failed/,
  );
  assert.equal(cleanupCalls, 1);
});

void test('cancellation fences the callback before it can execute', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled-before-locale'));
  let calls = 0;
  await assert.rejects(
    runIosLocaleCaptureCallback({
      wiring: wiring(),
      scenario,
      signal: controller.signal,
      readCurrentBinding: () => Promise.resolve(structuredClone(binding)),
      execute: () => {
        calls += 1;
        return Promise.resolve(pendingResult());
      },
    }),
    /cancelled-before-locale/,
  );
  assert.equal(calls, 0);
});

void test('source/helper/build drift is rejected before and after callback', async () => {
  const changed = { ...binding, sourceTreeHash: hash('changed') };
  await assert.rejects(
    runIosLocaleCaptureCallback({
      wiring: wiring(),
      scenario,
      signal: new AbortController().signal,
      readCurrentBinding: () => Promise.resolve(changed),
      execute: () => Promise.resolve(pendingResult()),
    }),
    /changed before callback/,
  );
  let reads = 0;
  await assert.rejects(
    runIosLocaleCaptureCallback({
      wiring: wiring(),
      scenario,
      signal: new AbortController().signal,
      readCurrentBinding: () => Promise.resolve(reads++ === 0 ? structuredClone(binding) : changed),
      execute: () => Promise.resolve(pendingResult()),
    }),
    /changed after callback/,
  );
});
