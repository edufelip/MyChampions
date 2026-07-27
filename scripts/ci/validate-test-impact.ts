import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  discoverRegisteredTestFiles,
  loadManifest,
  validateFeatureBoundaries,
  validateManifest,
} from './test-impact';

const root = resolve(process.cwd());
const manifest = loadManifest(root);
const errors = validateManifest(manifest);
errors.push(...validateFeatureBoundaries(root, manifest));
const registeredSpecs = new Set(
  Object.values(manifest.suites).flatMap((suite) => suite.specs)
);

for (const spec of discoverRegisteredTestFiles(root)) {
  if (!registeredSpecs.has(spec)) errors.push(`test spec is not registered in a suite: ${spec}`);
}
for (const spec of registeredSpecs) {
  if (!existsSync(join(root, spec))) errors.push(`registered test spec does not exist: ${spec}`);
}
for (const [suiteId, suite] of Object.entries(manifest.suites)) {
  if (!suite.runner.startsWith('playwright') || !suite.ci) continue;
  if (!suite.grep) {
    errors.push(`CI Playwright suite has no grep metadata: ${suiteId}`);
    continue;
  }
  const combinedSource = suite.specs
    .filter((spec) => existsSync(join(root, spec)))
    .map((spec) => readFileSync(join(root, spec), 'utf8'))
    .join('\n');
  if (!new RegExp(suite.grep).test(combinedSource)) {
    errors.push(`CI Playwright suite grep matches none of its specs: ${suiteId}`);
  }
}

assert.deepEqual(errors, [], `test impact manifest is invalid:\n${errors.join('\n')}`);
console.log(
  `Validated ${Object.keys(manifest.features).length} features, ` +
    `${Object.keys(manifest.suites).length} suites, and ${registeredSpecs.size} UI specs.`
);
