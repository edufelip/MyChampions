import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * ET-21: decorative MaterialIcons glyphs (leading icon + trailing chevron) inside
 * icon+label Pressable buttons were readable as literal Private-Use-Area glyph
 * characters, leaking into the button's computed accessible name on both web
 * (react-native-web maps `aria-hidden` straight to the DOM attribute) and native
 * (React Native's View/Text `aria-hidden` prop sets `accessibilityElementsHidden`
 * on iOS and `importantForAccessibility="no-hide-descendants"` on Android — see
 * node_modules/react-native/Libraries/Components/View/View.js).
 *
 * Every decorative icon inside these rows must carry `aria-hidden` so it is
 * excluded from the accessible name / accessibility tree, leaving only the
 * visible label text as the announced name.
 */

function extractFunctionSource(source: string, functionSignature: string, nextMarker: string) {
  const start = source.indexOf(functionSignature);
  const end = nextMarker ? source.indexOf(nextMarker, start) : source.length;
  assert.notEqual(start, -1, `expected to find "${functionSignature}"`);
  assert.notEqual(end, -1, `expected to find "${nextMarker}" after "${functionSignature}"`);
  return source.slice(start, end);
}

function assertEveryMaterialIconIsAriaHidden(componentSource: string, componentName: string) {
  const iconTags = componentSource.match(/<MaterialIcons\b[\s\S]*?\/>/g) ?? [];
  assert.ok(iconTags.length > 0, `expected ${componentName} to render at least one MaterialIcons`);
  for (const tag of iconTags) {
    // Match the bare JSX boolean shorthand (`aria-hidden`) or an explicit
    // `true` value, not just the attribute name — `aria-hidden={false}` (or
    // "false"/'false') must NOT satisfy this, or the test would pass while
    // the icon stays exposed to the accessibility tree.
    assert.match(
      tag,
      /\baria-hidden(?:\s*=\s*(?:\{true\}|"true"|'true'))?(?=\s|\/?>)/,
      `decorative MaterialIcons in ${componentName} must be marked aria-hidden (true) so it is ` +
        `excluded from the accessible name, got: ${tag}`,
    );
  }
}

test('professional home QuickActionCard decorative icons are hidden from the accessible name', () => {
  const source = readFileSync(join(process.cwd(), 'app/professional/home.tsx'), 'utf8');
  const quickActionCard = extractFunctionSource(
    source,
    'function QuickActionCard(',
    '\nconst styles = StyleSheet.create(',
  );
  assertEveryMaterialIconIsAriaHidden(quickActionCard, 'QuickActionCard');
});

test('professional home TaskCard decorative icons are hidden from the accessible name', () => {
  const source = readFileSync(join(process.cwd(), 'app/professional/home.tsx'), 'utf8');
  const taskCard = extractFunctionSource(source, 'function TaskCard(', 'function QuickActionCard(');
  assertEveryMaterialIconIsAriaHidden(taskCard, 'TaskCard');
});

test('professional home Subscription row decorative icons are hidden from the accessible name', () => {
  const source = readFileSync(join(process.cwd(), 'app/professional/home.tsx'), 'utf8');
  const subscriptionRowStart = source.indexOf('testID="pro.home.subscriptionCta"');
  assert.notEqual(subscriptionRowStart, -1, 'expected to find the subscription row Pressable');
  const rowStart = source.lastIndexOf('<Pressable', subscriptionRowStart);
  const rowEnd = source.indexOf('</Pressable>', subscriptionRowStart) + '</Pressable>'.length;
  const subscriptionRow = source.slice(rowStart, rowEnd);
  assertEveryMaterialIconIsAriaHidden(subscriptionRow, 'Subscription row');
});

test('professional home attention-retry icon is hidden from the accessible name', () => {
  const source = readFileSync(join(process.cwd(), 'app/professional/home.tsx'), 'utf8');
  const retryStart = source.indexOf('testID="pro.home.attentionRetry"');
  assert.notEqual(retryStart, -1, 'expected to find the attention retry Pressable');
  const rowStart = source.lastIndexOf('<Pressable', retryStart);
  const rowEnd = source.indexOf('</Pressable>', retryStart) + '</Pressable>'.length;
  const retryButton = source.slice(rowStart, rowEnd);
  assertEveryMaterialIconIsAriaHidden(retryButton, 'attention retry button');
});

test('roster empty-state share button icon is hidden from the accessible name', () => {
  const source = readFileSync(join(process.cwd(), 'app/professional/students.tsx'), 'utf8');
  const shareCtaStart = source.indexOf('testID="pro.students.empty.shareCta"');
  assert.notEqual(shareCtaStart, -1, 'expected to find the roster empty-state share Pressable');
  const rowStart = source.lastIndexOf('<Pressable', shareCtaStart);
  const rowEnd = source.indexOf('</Pressable>', shareCtaStart) + '</Pressable>'.length;
  const shareCta = source.slice(rowStart, rowEnd);
  assertEveryMaterialIconIsAriaHidden(shareCta, 'roster empty-state share button');
});

test('settings row chevron icon is hidden from the accessible name', () => {
  const source = readFileSync(join(process.cwd(), 'app/settings/account.tsx'), 'utf8');
  const settingsRow = extractFunctionSource(
    source,
    'function SettingsRow(',
    'function RowDivider(',
  );
  assertEveryMaterialIconIsAriaHidden(settingsRow, 'SettingsRow');
});
