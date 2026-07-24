import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('professional home task icons use the scheme-aware accent foreground', () => {
  const source = readFileSync(
    join(process.cwd(), 'app/professional/home.tsx'),
    'utf8'
  );
  const taskCardStart = source.indexOf('function TaskCard(');
  const taskCardEnd = source.indexOf('function QuickActionCard(', taskCardStart);

  assert.notEqual(taskCardStart, -1);
  assert.notEqual(taskCardEnd, -1);

  const taskCardSource = source.slice(taskCardStart, taskCardEnd);

  assert.match(
    taskCardSource,
    /backgroundColor: theme\.color\.accentPrimary/
  );
  assert.match(
    taskCardSource,
    /<MaterialIcons name=\{iconName\} size=\{20\} color=\{theme\.color\.onAccent\} \/>/
  );
  assert.doesNotMatch(
    taskCardSource,
    /color=["']#[\da-f]{3,8}["']/i
  );
});
