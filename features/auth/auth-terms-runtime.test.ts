import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const flowDirectory = join(process.cwd(), '.maestro/suite/auth-terms');
const flows = readdirSync(flowDirectory)
  .filter((name) => name.endsWith('.yaml'))
  .map((name) => readFileSync(join(flowDirectory, name), 'utf8'));

test('auth terms launches one fresh native app instance per case', () => {
  assert.ok(flows.length > 0);
  for (const flow of flows) {
    assert.equal(flow.match(/runFlow: \.\.\/common\/launch-fresh\.yaml/g)?.length, 1);
    assert.doesNotMatch(flow, /launchApp|relaunch\.yaml/);
  }
});
