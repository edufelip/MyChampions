import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');

const workflowFiles = [
  '.github/workflows/android-pr.yml',
  '.github/workflows/android-release.yml',
  '.github/workflows/ios-pr.yml',
  '.github/workflows/ios-release.yml',
];

test('mobile CI workflows install dependencies without Actions-backed caches', () => {
  assert.equal(existsSync(join(root, 'yarn.lock')), true, 'mobile package should keep yarn.lock');
  assert.equal(
    existsSync(join(root, 'package-lock.json')),
    false,
    'mobile package should not keep package-lock.json',
  );

  for (const workflowFile of workflowFiles) {
    const workflow = readFileSync(join(root, workflowFile), 'utf8');

    assert.doesNotMatch(
      workflow,
      /^\s+cache:/m,
      `${workflowFile} should not configure setup caches`,
    );
    assert.doesNotMatch(
      workflow,
      /cache-dependency-path:/,
      `${workflowFile} should not configure cache keys`,
    );
    assert.doesNotMatch(
      workflow,
      /actions\/cache@/,
      `${workflowFile} should not use the Actions cache`,
    );
    assert.doesNotMatch(
      workflow,
      /gradle\/gradle-build-action@/,
      `${workflowFile} should not use the legacy Gradle cache action`,
    );
    assert.doesNotMatch(
      workflow,
      /gradle\/actions\/setup-gradle@/,
      `${workflowFile} should not use the Gradle cache action`,
    );
    assert.match(
      workflow,
      /yarn install --frozen-lockfile/,
      `${workflowFile} should install through Yarn`,
    );
    assert.equal(workflow.includes('npm ci'), false, `${workflowFile} should not run npm ci`);
    assert.equal(workflow.includes('cache: npm'), false, `${workflowFile} should not cache npm`);
    assert.equal(
      workflow.includes('package-lock.json'),
      false,
      `${workflowFile} should not reference package-lock.json`,
    );
  }
});

test('mobile package scripts do not route through npm-run wrappers', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };

  for (const [scriptName, command] of Object.entries(packageJson.scripts ?? {})) {
    assert.equal(
      command.includes('npm run'),
      false,
      `${scriptName} should call Yarn scripts directly`,
    );
  }
});

test('mobile unit tests include root-level and nested feature test files', () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const unitTestScript = packageJson.scripts?.['test:unit'] ?? '';

  assert.match(
    unitTestScript,
    /features\/\*\.test\.ts/,
    'test:unit should include features/*.test.ts',
  );
  assert.match(
    unitTestScript,
    /features\/\*\*\/\*\.test\.ts/,
    'test:unit should include nested feature tests',
  );
});
