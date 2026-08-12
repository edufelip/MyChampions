import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const trainingScreenSource = readFileSync(
  join(process.cwd(), 'app/student/training.tsx'),
  'utf8'
);

test('assigned workout details control exposes a browser-observable accessible state', () => {
  const testId = 'student.training.expandBtn-${session.id}';
  const testIdIndex = trainingScreenSource.indexOf(testId);
  assert.notEqual(testIdIndex, -1);

  const controlOpeningTag = trainingScreenSource.slice(
    trainingScreenSource.lastIndexOf('<Pressable', testIdIndex),
    testIdIndex
  );

  assert.match(controlOpeningTag, /accessibilityLabel=\{/);
  assert.match(controlOpeningTag, /student\.training\.session\.expand/);
  assert.match(controlOpeningTag, /student\.training\.session\.collapse/);
  assert.match(controlOpeningTag, /accessibilityState=\{\{ expanded: isExpanded \}\}/);
  assert.match(controlOpeningTag, /aria-expanded=\{isExpanded\}/);
  assert.match(controlOpeningTag, /style=\{styles\.expandButton\}/);
  assert.equal(
    trainingScreenSource.match(/toggleSessionExpand\(session\.id\)/g)?.length,
    1,
    'the session card must expose one interactive expand/collapse action'
  );
  assert.match(trainingScreenSource, /expandButton:\s*\{[\s\S]*?minHeight: 44,[\s\S]*?minWidth: 44,/);
});
