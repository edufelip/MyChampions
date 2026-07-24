import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const screenPaths = [
  'app/professional/home.tsx',
  'app/student/home.tsx',
  'app/professional/subscription.tsx',
] as const;

test('dashboard and subscription unknown values use the shared localization key', () => {
  for (const screenPath of screenPaths) {
    const source = readFileSync(join(process.cwd(), screenPath), 'utf8');

    assert.doesNotMatch(
      source,
      /(['"])—\1/,
      `${screenPath} must not render a hard-coded unavailable-value glyph`
    );
    assert.match(
      source,
      /t\('common\.value\.unavailable'\)/,
      `${screenPath} must resolve unavailable values through localization`
    );
  }
});
