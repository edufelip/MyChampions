import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parseWebPort } from '../../scripts/ci/parse-web-port';

const root = process.cwd();
const playwrightConfigs = [
  'playwright.config.ts',
  'playwright.training.config.ts',
  'playwright.professional-roster-error.config.ts',
  'playwright.custom-meal-error.config.ts',
] as const;

test('web port parsing defaults and accepts the full valid range', () => {
  assert.equal(parseWebPort('WEB_PORT', undefined, 8081), 8081);
  assert.equal(parseWebPort('WEB_PORT', '1', 8081), 1);
  assert.equal(parseWebPort('WEB_PORT', '65535', 8081), 65535);
});

test('web port parsing rejects malformed and out-of-range values', () => {
  for (const value of ['8081x', 'abc', '', ' 8081', '8081 ']) {
    assert.throws(
      () => parseWebPort('WEB_PORT', value, 8081),
      /WEB_PORT must contain only decimal digits/,
    );
  }

  for (const value of ['0', '65536', '999999999999999999999999']) {
    assert.throws(
      () => parseWebPort('WEB_PORT', value, 8081),
      /WEB_PORT must be an integer from 1 to 65535/,
    );
  }
});

test('all Playwright web configurations use strict port parsing', () => {
  for (const config of playwrightConfigs) {
    const source = readFileSync(join(root, config), 'utf8');
    assert.match(source, /parseWebPort/);
    assert.doesNotMatch(source, /Number\.parseInt\(process\.env/);
  }
});
