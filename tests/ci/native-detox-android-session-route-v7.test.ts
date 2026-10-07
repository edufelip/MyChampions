import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(process.env.V7_CANDIDATE_ROOT ?? process.cwd());

async function source(relative: string): Promise<string> {
  return readFile(path.join(root, 'scripts/testing', relative), 'utf8');
}

function has(text: string, pattern: string, label: string): void {
  assert(text.includes(pattern), `${label}: missing ${pattern}`);
}

void test('V7 baseline registers one owned Android producer before acquisition and cleanup', async () => {
  const text = await source('detox-integrated-session-baseline.ts');
  has(text, 'androidProducer?: DetoxAndroidSessionProducerRegistration', 'option registration');
  has(text, 'requireDetoxAndroidProducerBeforeAcquisition(', 'pre-acquisition gate');
  has(text, 'options.androidProducer', 'producer gate input');
  has(text, 'options.androidProducer.acquireOwnedTarget', 'owned target acquisition');
  has(text, 'options.androidProducer.verifyOwnedAndroidCleanup', 'independent cleanup');
  has(text, 'android-native-engine-pending', 'missing capability remains blocked');
});

void test('V11 baseline report publication keeps the original lifecycle and owned root identity', async () => {
  const text = await source('detox-integrated-session-baseline.ts');
  has(text, 'const reportBytes = Buffer.from', 'bounded report bytes');
  has(text, 'signal: runSignal', 'report publication abort signal');
  has(text, 'deadlineAt: deadlineAtMonotonicMs', 'report publication deadline');
  has(text, 'expectedRootIdentity: artifactBinding.identity', 'report publication root identity');
  has(text, 'Detox baseline report path changed during publication', 'report path fence');
  assert(
    !text.includes('writeFile(reportPath'),
    'baseline report must not use path-based wx write',
  );
  has(text, 'assertSessionArtifactRootIdentity', 'session artifact-root identity fence');
  has(text, 'observedSessionArtifactRoot', 'stored session artifact-root path');
  has(text, 'observedSessionArtifactRootIdentity', 'stored session artifact-root identity');
  has(text, 'sessionArtifactRoot: sessionArtifactRoot!', 'snapshot source-root path binding');
  has(
    text,
    'sessionArtifactRootIdentity: sessionArtifactRootIdentity!',
    'snapshot stored identity binding',
  );
  has(text, 'captureExactOwnedSnapshotForTest', 'private snapshot race control');
  has(text, 'onAfterSourceDiscovery', 'post-discovery race control');
  has(text, 'onAfterSourceRead', 'post-read race control');
});

void test('V12 terminal fallback stays on the protected writer and run-bound fences', async () => {
  const text = await source('detox-integrated-session-baseline.ts');
  assert(
    !text.includes('defaultWriteTerminalEvidence'),
    'terminal fallback must not retain the raw path-based writer',
  );
  has(text, 'writeTerminalFallbackForTest', 'private fallback control export');
  has(text, 'writeTerminalFallbackForRun', 'run-bound fallback writer');
  has(text, 'writeAtomicDetoxConnectionBytes', 'protected fallback writer');
  has(text, 'signal: publication.signal', 'fallback abort signal');
  has(text, 'deadlineAt: publication.deadlineAt', 'fallback absolute deadline');
  has(text, 'expectedRootIdentity: publication.expectedRootIdentity', 'fallback root identity');
  has(text, 'beforePublish: publication.beforePublish', 'fallback pre-publication fence');
  has(text, 'afterPublish: publication.afterPublish', 'fallback post-publication fence');
  has(text, 'Detox terminal fallback publication after', 'fallback final lifecycle fence');
});

void test('V7 producer delegates to the existing owned Android connection owner', async () => {
  const text = await source('detox-android-session-producer.ts');
  has(text, 'createOwnedAndroidDetoxConnectionProducer', 'sole Android owner');
  has(text, `kind: 'owned-android-detox-session-producer'`, 'session capability identity');
  has(text, 'requireAndroidDetoxCleanupResult', 'cleanup receipt validation');
  has(text, 'deadlineAt: input.deadlineAtMonotonicMs', 'caller deadline binding');
});

void test('V7 Android adapter requires the complete local-clear and protected UI evidence', async () => {
  const text = await source('native-detox-android-session-public-adapter.ts');
  has(text, `platform: 'android'`, 'Android adapter platform');
  has(text, `scenario: 'SCN-session-android'`, 'Android session cell');
  has(text, 'androidProducer: createOwnedAndroidDetoxSessionProducer(', 'producer registration');
  has(text, `cache.afterSignout.status, 'session-absent'`, 'local clear after sign-out');
  has(text, `cache.afterSignedOutRelaunch.status, 'session-absent'`, 'signed-out relaunch');
  has(
    text,
    `ownedProducerKind: 'owned-android-detox-session-producer'`,
    'owned producer provenance',
  );
  has(text, 'independentCleanup: report.cleanup.independent', 'cleanup provenance');
  has(text, 'report.ui.launchCount, 3', 'protected UI launch count');
  has(
    text,
    'detox-android-session-checkpoints.private.json',
    'Android storage checkpoint evidence',
  );
  has(text, `serverRevocation: 'decision-needed'`, 'bearer revocation boundary');
  has(text, 'options.sourceOnlyControl === true', 'injected resource provenance gate');
});

void test('V7 Android route binds qualified build, adapter, target and exact selection', async () => {
  const text = await source('native-detox-android-session-native-pilot-route.ts');
  has(text, 'loadAndroidDetoxQualifiedBuild', 'Android qualified build loader');
  has(text, 'runAndroidDetoxSessionPublicAdapter', 'Android session adapter');
  has(text, `nativePilotTargetFromCapture('android')`, 'Android target projection');
  has(text, `scenario: 'SCN-session-android'`, 'exact Android selection');
  has(
    text,
    'private-owned-android-detox-session-attempt-not-public-receipt',
    'private attempt boundary',
  );
});

void test('V7 finalization uses V6 descriptor-bound namespace and preserves source-only counts', async () => {
  const text = await source('native-detox-android-session-public-finalization.ts');
  has(text, 'prepareAndroidDetoxSessionPublicOutputRoot', 'V6 namespace preparation');
  has(text, 'writeAtomicDetoxConnectionBytes', 'descriptor-bound publication');
  has(text, 'verifyStagedAndroidDetoxSessionEvidence', 'post-copy reread');
  has(
    text,
    `kind: 'private-detox-android-session-evidence-copy-not-public-receipt'`,
    'Android manifest identity',
  );
  has(text, 'nativePassingCases: 0', 'native pass boundary');
  has(text, 'publicPromotionEligible: false', 'promotion boundary');
});

void test('V7 default runner has one Android Detox session route and protected staging branch', async () => {
  const text = await source('run-native-pilot.ts');
  has(text, "| 'android-detox-session'", 'execution adapter enum');
  has(text, "return 'android-detox-session'", 'default route selection');
  has(text, 'runAndroidDetoxSessionAttemptForNativePilot', 'route dispatch');
  has(text, 'stageAndroidDetoxSessionPublicEvidence', 'protected staging');
  has(text, 'verifyStagedAndroidDetoxSessionEvidence', 'protected final reread');
  has(text, 'detox-android-session-staging-link.private.json', 'staging link receipt');
  has(text, 'androidDetoxSessionVerifiedTerminalEvidenceName', 'verified outer-terminal evidence');
  has(text, 'mapAndroidDetoxSessionAssertionsToOuterTerminal', 'outer-terminal assertion binding');
  has(text, 'terminalAliases', 'unique outer evidence aliases');
  has(text, 'assertNativePilotCompletion', 'canonical outer completion check');
});

void test('V8 runner attaches Android staging recovery and gates source-only promotion', async () => {
  const text = await source('run-native-pilot.ts');
  has(text, 'AndroidDetoxSessionStagingError', 'Android staging error import and catch');
  has(text, 'attachAndroidDetoxSessionStagingRecovery', 'outer recovery attachment');
  has(text, 'shouldBlockAndroidDetoxSessionOuterTerminal', 'source-only outer gate');
  has(text, 'detoxRuntime.nativeExecution', 'runtime provenance gate');
  const route = await source('native-detox-android-session-native-pilot-route.ts');
  has(route, 'hasAndroidDetoxSessionNativeExecution', 'completed command provenance');
  has(route, 'nativeExecution', 'attempt provenance field');
});

void test('V7 declaration and helper closure bind every Android Detox session source', async () => {
  const generator = await source('generate-native-declaration.py');
  for (const relative of [
    'scripts/testing/detox-android-session-producer.ts',
    'scripts/testing/native-detox-android-session-public-adapter.ts',
    'scripts/testing/native-detox-android-session-native-pilot-route.ts',
    'scripts/testing/native-detox-android-session-public-finalization.ts',
    'scripts/testing/native-detox-android-session-public-staging.ts',
  ])
    has(generator, relative, 'generator closure');
  const ledger = await source('native-session-helper-ledger.ts');
  for (const relative of [
    'scripts/testing/detox-android-session-producer.ts',
    'scripts/testing/native-detox-android-session-native-pilot-route.ts',
    'scripts/testing/native-detox-android-session-public-adapter.ts',
    'scripts/testing/native-detox-android-session-public-finalization.ts',
    'scripts/testing/native-detox-android-session-public-staging.ts',
  ])
    has(ledger, relative, 'helper ledger');
});

void test('V9 binds the caller deadline, protected inventory reads, and child recovery', async () => {
  const baseline = await source('detox-integrated-session-baseline.ts');
  has(baseline, 'writeAtomicDetoxConnectionBytes', 'descriptor-bound baseline evidence');
  has(baseline, 'readNativeEvidenceObservation', 'descriptor-bound snapshot source read');
  has(baseline, 'artifactRootIdentity', 'snapshot artifact-root identity binding');
  assert(
    !baseline.includes('writeFile(stagedFile'),
    'snapshot staging must not use path-based writes',
  );
  has(baseline, 'deadlineAtMonotonicMs', 'caller deadline reaches the Android owner');
  const producer = await source('detox-android-connection-producer.ts');
  has(producer, 'createAndroidDetoxSessionOwnedChildDirectory', 'descriptor-bound runtime child');
  has(
    producer,
    'deadlineAtMonotonicMs: options.deadlineAtMonotonicMs',
    'producer preserves the caller deadline',
  );
  const emulator = await source('owned-android-emulator.ts');
  has(emulator, 'boundedPhaseDeadline', 'outer deadline caps acquisition');
  const adapter = await source('native-detox-android-session-public-adapter.ts');
  has(adapter, 'readProtectedInventory', 'adapter inventory provenance');
  has(
    adapter,
    'Android Detox inventory changed during protected read',
    'adapter inventory identity fence',
  );
  const runner = await source('run-native-pilot.ts');
  has(runner, 'readDetoxConnectionPath', 'descriptor-bound inventory reader');
  has(runner, 'deadlineAt: lifecycle.deadlineAtMs', 'runner inventory deadline');
  has(runner, 'recoveryPublication', 'outer recovery publication provenance');
  const staging = await source('native-detox-android-session-public-staging.ts');
  has(staging, 'SIGKILL', 'bounded child escalation');
  has(staging, 'reapStatus', 'child reap status');
  has(staging, 'testWorkerDelayMs', 'timeout regression control');
});
