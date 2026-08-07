import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('selective workflow always resolves impact without top-level path filtering', () => {
  const workflow = readFileSync(
    join(root, '.github', 'workflows', 'pr-selective-tests.yml'),
    'utf8'
  );

  assert.match(workflow, /name: Selective test impact \(shadow\)/);
  assert.match(workflow, /pull_request:[\s\S]*?branches:[\s\S]*?- develop/);
  assert.match(workflow, /push:[\s\S]*?branches:[\s\S]*?- develop/);
  assert.match(workflow, /merge_group:/);
  assert.doesNotMatch(workflow, /^\s{4}paths:/m);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /test:impact:resolve --base "\$base_sha" --head "\$head_sha"/);
  assert.match(workflow, /contains\(github\.event\.pull_request\.labels\.\*\.name, 'ci:full'\)/);
  assert.match(workflow, /vars\.CI_FORCE_FULL/);
});

test('shadow workflow preserves universal fast checks and a stable final gate', () => {
  const workflow = readFileSync(
    join(root, '.github', 'workflows', 'pr-selective-tests.yml'),
    'utf8'
  );

  assert.match(workflow, /fast-quality:/);
  assert.match(workflow, /yarn test:unit/);
  assert.match(workflow, /yarn lint/);
  assert.match(workflow, /yarn tsc --noEmit/);
  assert.match(workflow, /selective-ci-gate:/);
  assert.match(workflow, /if: always\(\)/);
  assert.match(workflow, /"\$result" != "success" && "\$result" != "skipped"/);
  assert.match(workflow, /Web UI selection \(shadow\)/);
  assert.match(workflow, /Detox iOS selection \(shadow\)/);
});
