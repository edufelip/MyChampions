import assert from 'node:assert/strict';
import test from 'node:test';

import { getDsTheme, type DsColorScheme } from './design-system';

function relativeLuminance(hex: string): number {
  const channels = hex
    .match(/[a-f\d]{2}/gi)
    ?.slice(0, 3)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );

  assert.equal(channels?.length, 3, `Expected a six-digit hex color, received ${hex}`);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function expectReadable(
  scheme: DsColorScheme,
  name: string,
  foreground: string,
  background: string
): void {
  const ratio = contrastRatio(foreground, background);
  assert.ok(ratio >= 4.5, `${scheme} ${name} contrast ${ratio.toFixed(2)}:1 is below 4.5:1`);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme} design-system text and control pairs meet WCAG AA contrast`, () => {
    const { color } = getDsTheme(scheme);

    expectReadable(scheme, 'primary action label', color.onAccent, color.accentPrimary);
    expectReadable(scheme, 'accent link on canvas', color.accentPrimary, color.canvas);
    expectReadable(scheme, 'accent link on surface', color.accentPrimary, color.surface);
    expectReadable(scheme, 'tertiary text on canvas', color.textTertiary, color.canvas);
    expectReadable(scheme, 'tertiary text on surface', color.textTertiary, color.surface);
    expectReadable(scheme, 'tertiary text on muted surface', color.textTertiary, color.surfaceMuted);
    expectReadable(scheme, 'disabled label', color.disabledText, color.disabledSurface);
  });
}
