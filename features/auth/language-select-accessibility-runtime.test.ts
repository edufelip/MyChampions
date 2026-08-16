import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const languageSelectSource = readFileSync(
  join(process.cwd(), 'app/settings/language-select.tsx'),
  'utf8'
);

test('language rows expose a browser-observable checked radio state', () => {
  const testId = 'settings.languageSelect.option.${locale}';
  const testIdIndex = languageSelectSource.indexOf(testId);
  assert.notEqual(testIdIndex, -1);

  const controlOpeningTag = languageSelectSource.slice(
    languageSelectSource.lastIndexOf('<Pressable', testIdIndex),
    testIdIndex
  );

  assert.match(controlOpeningTag, /accessibilityRole="radio"/);
  assert.match(controlOpeningTag, /accessibilityState=\{\{ checked: isSelected \}\}/);
  assert.match(controlOpeningTag, /aria-checked=\{isSelected\}/);
  assert.match(controlOpeningTag, /accessibilityLabel=\{LOCALE_DISPLAY_NAMES\[locale\]\}/);
});
