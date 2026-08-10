import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const screenPath = join(process.cwd(), 'app/student/home.tsx');
const source = readFileSync(screenPath, 'utf8');

test('student home retains the completed initial-load state across source-specific retries', () => {
  assert.match(source, /const \[initialLoadHistory, setInitialLoadHistory\] = useState\(\{/);
  assert.match(
    source,
    /hasCompletedInitialLoad:\s*accountChanged \? false : initialLoadHistory\.hasCompleted/,
  );
  assert.match(source, /!current\.hasCompleted && displayState\.hasCompletedInitialLoad/);
});

test('student home resets retained load completion when the authenticated account changes', () => {
  assert.match(source, /const accountChanged = initialLoadHistory\.accountId !== accountId/);
  assert.match(source, /if \(current\.accountId !== accountId\)/);
  assert.match(source, /connections:\s*accountChanged \? 'idle' : connectionsState\.kind/);
  assert.match(source, /plans:\s*accountChanged \? 'idle' : plansState\.kind/);
  assert.match(source, /water:\s*accountChanged \? 'idle' : waterState\.kind/);
});
