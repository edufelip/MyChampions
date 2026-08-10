import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const files = [
  'features/nutrition/use-image-upload.ts',
  'features/nutrition/use-meal-photo-analysis.ts',
  'features/nutrition/meal-photo-analysis-source.ts',
];

test('nutrition upload and photo-analysis boundaries do not import firebase/auth types', () => {
  const root = join(__dirname, '..', '..');
  const offenders = files.filter((file) =>
    readFileSync(join(root, file), 'utf8').includes('firebase/auth'),
  );

  assert.deepEqual(offenders, []);
});
