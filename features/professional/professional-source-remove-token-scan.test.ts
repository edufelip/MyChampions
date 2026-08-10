import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('professional specialty removal source does not contain provider token fallback', () => {
  const source = readFileSync(join(__dirname, 'professional-source.ts'), 'utf8');

  assert.equal(source.includes(['get', 'Current', 'Id', 'Token'].join('')), false);
  assert.equal(source.includes(['get', 'Remove', 'Specialty', 'Function', 'Url'].join('')), false);
  assert.equal(
    source.includes(['EXPO_PUBLIC', 'REMOVE_SPECIALTY', 'FUNCTION_URL'].join('_')),
    false,
  );
  assert.equal(source.includes(['get', 'Firebase', 'Auth'].join('')), false);
  assert.equal(source.includes(['request', 'Remove', 'Specialty'].join('')), false);
});
