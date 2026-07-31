import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  isElementNotFoundError,
}: {
  isElementNotFoundError: (error: unknown) => boolean;
} = require('../../e2e/native-editor-actions.js');

test('recognizes Detox iOS and Android no-match failures', () => {
  assert.equal(
    isElementNotFoundError(
      new Error(
        'Test Failed: No elements found for “MATCHER(id == “removed.row”)”'
      )
    ),
    true
  );
  assert.equal(
    isElementNotFoundError({
      name: 'DetoxRuntimeError',
      message:
        'Test Failed: No elements found for “MATCHER(id == “removed.row”)”',
    }),
    true,
    'Detox marshals runtime failures across a realm where instanceof Error is false'
  );
  assert.equal(
    isElementNotFoundError(
      new Error(
        'Test Failed: androidx.test.espresso.NoMatchingViewException: No views in hierarchy found matching: with id removed.row'
      )
    ),
    true
  );
});

test('does not mistake Detox transport or app failures for element absence', () => {
  assert.equal(
    isElementNotFoundError(
      new Error('The app has unexpectedly disconnected from Detox server.')
    ),
    false
  );
  assert.equal(isElementNotFoundError(new Error('socket hang up')), false);
  assert.equal(isElementNotFoundError('No elements found for removed.row'), false);
  assert.equal(
    isElementNotFoundError({ message: 'The app has disconnected.' }),
    false
  );
});
