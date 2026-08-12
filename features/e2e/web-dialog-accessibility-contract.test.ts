import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = join(__dirname, '..', '..');

const dialogConsumers = [
  'components/ds/patterns/SupportModal.tsx',
  'components/ds/patterns/PlanPickerModal.tsx',
  'components/ds/patterns/StudentPickerModal.tsx',
  'components/ds/patterns/ExerciseSearchModal.tsx',
  'app/student/professionals.tsx',
  'app/(tabs)/nutrition/custom-meals/index.tsx',
  'app/professional/pending.tsx',
];

test('every shared web dialog consumer supplies an accessible name', () => {
  for (const relativePath of dialogConsumers) {
    const source = readFileSync(join(root, relativePath), 'utf8');
    assert.match(
      source,
      /useWebDialogAccessibility\(\{[\s\S]*?(dialogTitleTestID|dialogLabel):/,
      `${relativePath} must provide a dialog title test ID or explicit label`,
    );
  }
});

test('pending bulk deny rechecks the latest write lock on native confirmation', () => {
  const source = readFileSync(join(root, 'app', 'professional', 'pending.tsx'), 'utf8');

  assert.match(source, /const isWriteLockedRef = useRef\(isWriteLocked\)/);
  assert.match(
    source,
    /if \(isWriteLockedRef\.current\)[\s\S]*?t\('offline\.write_lock'\)/,
  );
});

test('E2E network override events remain dev-only and ignore invalid values', () => {
  const source = readFileSync(join(root, 'features', 'offline', 'use-network-status.ts'), 'utf8');

  assert.match(source, /supportsE2ENetworkStatusOverride = isDev && isDevVariant/);
  assert.match(source, /supportsE2ENetworkStatusOverride/);
  assert.match(source, /if \(override\) setStatus\(override\)/);
});
