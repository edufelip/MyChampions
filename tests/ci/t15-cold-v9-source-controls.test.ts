import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = process.cwd();

async function readSource(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), 'utf8');
}

void test('normal native producers publish the protected capture namespace consumed by T15', async () => {
  const android = await readSource('scripts/testing/capture-android-testability.ts');
  const ios = await readSource('scripts/testing/capture-native-testability.ts');
  for (const [platform, source] of [
    ['android', android],
    ['ios', ios],
  ] as const) {
    const reportStart = source.indexOf('const report: Record<string, unknown> = {');
    assert.notEqual(reportStart, -1, `${platform} capture report initializer is missing`);
    assert.match(
      source.slice(reportStart, reportStart + 3000),
      new RegExp(
        `platform: ['"]${platform}['"][\\s\\S]{0,900}?captureRunId,\\s+captureRoot: output,`,
        'u',
      ),
      `${platform} capture report must bind JSON identity to its protected root`,
    );
  }
  const childReader = await readSource('scripts/testing/t15-cold-reset-child-consumption.ts');
  assert.match(
    childReader,
    /capture\.captureRoot !== captureRoot \|\| capture\.captureRunId !== expectedCaptureRunId/u,
  );
  const runner = await readSource('scripts/testing/run-native-pilot.ts');
  assert.match(runner, /readChildCaptureFromOwnedRoot\(\{/u);
});

void test('all iOS adapters preserve the cold binding into the owned capture call', async () => {
  for (const relative of [
    'scripts/testing/run-ios-connection-attempt.ts',
    'scripts/testing/run-ios-training-attempt.ts',
    'scripts/testing/run-ios-save-retry-attempt.ts',
    'scripts/testing/run-ios-camera-attempt.ts',
  ]) {
    const source = await readSource(relative);
    assert.match(source, /coldReset\?: ColdResetPreparationExpectation/u, relative);
    assert.match(
      source,
      /runOwnedIosNativeSession\(\{[\s\S]{0,260}?requestedRunId: options\.requestedRunId,[\s\S]{0,120}?coldReset: options\.coldReset,/u,
      relative,
    );
  }
  const runner = await readSource('scripts/testing/run-native-pilot.ts');
  assert.match(runner, /coldReset: coldResetPreparation \?\? undefined,/u);
  assert.match(
    runner,
    /coldResetExpectation &&[\s\S]{0,160}?executionAdapter === 'ios-session'[\s\S]{0,240}?Cold reset consumption requires/u,
  );
  assert.match(runner, /Cold reset consumption requires an iOS Maestro callback adapter/u);
  assert.match(runner, /target: deferredColdResetBinding\.target,/u);
  assert.match(runner, /sourceIdentity: deferredColdResetBinding\.sourceIdentity,/u);
});

void test('cold handoff requires independent target/backend and producer descriptor identities', async () => {
  const handoff = await readSource('scripts/testing/t15-cold-reset-handoff.ts');
  assert.match(handoff, /asRecord\(row\.target, 'cold reset subprocess target row'\)/u);
  assert.match(handoff, /asRecord\(row\.backend, 'cold reset subprocess backend row'\)/u);
  assert.match(handoff, /binding\.sourceIdentity/u);
  const dispatcher = await readSource('scripts/testing/t15-cold-dispatcher.ts');
  assert.match(dispatcher, /ColdResetOriginalReceiptBinding/u);
  assert.match(dispatcher, /identity\?: NativeEvidenceIdentity/u);
  assert.match(dispatcher, /const boundIdentity = binding\.identity/u);
  const child = await readSource('scripts/testing/t15-cold-reset-child-consumption.ts');
  assert.match(child, /assertSelectedRowIdentity\(target, expected\.target/u);
  assert.match(child, /assertIdentityEqual\(sourceIdentity, expected\.sourceIdentity/u);
  const invocation = await readSource('scripts/testing/native-pilot-invocation.ts');
  assert.match(invocation, /sourceIdentity: NativeEvidenceIdentity;/u);
  assert.match(invocation, /requireSourceIdentity\(row\.sourceIdentity\)/u);
});

void test('quiescence and final receipt naming remain bounded and immutable', async () => {
  const producer = await readSource('scripts/testing/t15-cold-ios-reset-producer.ts');
  assert.match(producer, /waitForQuiescence\(\s*5000,\s*context\.signal\s*\)/u);
  assert.match(producer, /readNativeEvidenceObservation\(/u);
  const proxy = await readSource('scripts/testing/owned-api-proxy.ts');
  assert.match(proxy, /waitForQuiescence\(deadlineMs = 5000, signal\?: AbortSignal\)/u);
  assert.match(proxy, /signal\?\.throwIfAborted\(\)/u);
  const runtime = await readSource('scripts/testing/t15-cold-runtime-link.ts');
  assert.match(runtime, /finalRelativePath !== coldResetFinalReceiptName/u);
});
