import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');

async function readCandidate(relativePath: string): Promise<string> {
  return readFile(path.join(candidateRoot, relativePath), 'utf8');
}

void test('V8 capture candidate preserves the current credential frame namespace', async () => {
  const source = await readCandidate('scripts/testing/capture-native-testability.ts');
  assert.match(
    source,
    /captureFrame\(\s*\n\s*hierarchyLabel,\s*\n\s*screenshotLabel,\s*\n\s*'credential-' \+ stage\.name,/u,
  );
  assert.doesNotMatch(source, /captureFrame\(hierarchyLabel, screenshotLabel, stage\.name\)/u);
});

void test('V8 helper and declaration candidates enumerate the cold source closure', async () => {
  const ledger = await readCandidate('scripts/testing/native-session-helper-ledger.ts');
  const declaration = await readCandidate('scripts/testing/generate-native-declaration.py');
  const androidCapture = await readCandidate('scripts/testing/capture-android-testability.ts');
  for (const relative of [
    'scripts/testing/t15-cold-ios-reset-producer.ts',
    'scripts/testing/t15-cold-reset-child-consumption.ts',
    'scripts/testing/t15-cold-reset-handoff.ts',
    'scripts/testing/t15-cold-runtime-link.ts',
  ]) {
    assert.match(ledger, new RegExp(relative.replaceAll('/', '\\/'), 'u'));
    assert.match(androidCapture, new RegExp(relative.split('/').at(-1) as string, 'u'));
  }
  for (const key of [
    'ios-cold-reset-producer-source',
    'ios-cold-reset-child-consumer-source',
    'ios-cold-reset-handoff-source',
    'ios-cold-runtime-link-source',
  ]) {
    assert.match(declaration, new RegExp(key, 'u'));
  }
});

void test('V8 durable producer and consumer tests have no packet-root dependency', async () => {
  for (const file of [
    'tests/ci/t15-cold-ios-reset-producer-durable.test.ts',
    'tests/ci/t15-cold-reset-child-consumption.test.ts',
    'tests/ci/t15-cold-runtime-composition-v7.test.ts',
  ]) {
    const source = await readCandidate(file);
    assert.doesNotMatch(source, /T15_COLD_(?:V4_)?PACKET_ROOT/u);
    assert.doesNotMatch(source, /\.qa\/artifacts\/testing-modernization/u);
    assert.match(source, /from ['"]\.\.\/\.\.\/scripts\/testing\//u);
  }
});
