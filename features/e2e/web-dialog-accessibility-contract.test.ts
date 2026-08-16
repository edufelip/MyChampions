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
  assert.match(source, /if \(isWriteLockedRef\.current\)[\s\S]*?t\('offline\.write_lock'\)/);
  assert.match(source, /useLayoutEffect\(\(\) => \{[\s\S]*?isWriteLockedRef\.current/);
});

test('web dialog fallback focus restores its prior tabindex attribute', () => {
  const source = readFileSync(join(root, 'hooks', 'use-web-dialog-accessibility.ts'), 'utf8');

  assert.match(source, /const previousTabIndex = fallback\.getAttribute\('tabindex'\)/);
  assert.match(source, /fallback\.removeAttribute\('tabindex'\)/);
  assert.match(source, /fallback\.setAttribute\('tabindex', previousTabIndex\)/);
});

test('E2E network override events remain dev-only and ignore invalid values', () => {
  const source = readFileSync(join(root, 'features', 'offline', 'use-network-status.ts'), 'utf8');

  // Dev-only gating and value validation live in resolveE2ENetworkStatusOverride
  // (covered behaviorally by network-status-override.logic.test.ts); this hook must
  // route every override read through it rather than re-deriving dev/variant checks
  // inline.
  assert.match(source, /resolveE2ENetworkStatusOverride\(\{/);
  assert.match(source, /isDev: typeof __DEV__ !== 'undefined' && __DEV__/);
  assert.match(source, /if \(nextOverride\) setStatus\(nextOverride\)/);
});
