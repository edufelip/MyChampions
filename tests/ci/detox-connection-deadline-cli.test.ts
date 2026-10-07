import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { requireDetoxConnectionDeadlineMs } from '../../scripts/run-detox-integrated-connection-baseline';

void test('CLI deadline accepts the driver-compatible inclusive bounds', () => {
  assert.equal(requireDetoxConnectionDeadlineMs(undefined), 600_000);
  assert.equal(requireDetoxConnectionDeadlineMs(''), 600_000);
  assert.equal(requireDetoxConnectionDeadlineMs('30000'), 30_000);
  assert.equal(requireDetoxConnectionDeadlineMs('600000'), 600_000);
});

void test('CLI deadline rejects values below or above the driver range', () => {
  assert.throws(() => requireDetoxConnectionDeadlineMs('29999'));
  assert.throws(() => requireDetoxConnectionDeadlineMs('600001'));
});

void test('CLI deadline rejects non-decimal and non-integral values', () => {
  for (const value of ['NaN', '1.5', '-1', ' 30000', '30000 ', '0x7530']) {
    assert.throws(() => requireDetoxConnectionDeadlineMs(value), value);
  }
});

void test('deadline validation is before artifact-root acquisition', async () => {
  const source = await readFile(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../scripts/run-detox-integrated-connection-baseline.ts',
    ),
    'utf8',
  );
  const parserCall = source.indexOf(
    'requireDetoxConnectionDeadlineMs(\n    process.env.DETOX_CONNECTION_DEADLINE_MS',
  );
  const acquisition = source.indexOf(
    'const artifactLease = await acquireDetoxConnectionArtifactRoot({',
  );
  assert.ok(parserCall >= 0, 'deadline parser call must remain in runMain');
  assert.ok(acquisition > parserCall, 'artifact acquisition must follow deadline validation');
});
