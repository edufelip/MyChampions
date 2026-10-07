import assert from 'node:assert/strict';
import { env } from 'node:process';
import test from 'node:test';
import { createWebTestConfig } from '../../e2e/web/support/create-web-test-config';
import { parseWebPort } from '../../scripts/ci/parse-web-port';

const portProfiles = [
  ['default', 'PLAYWRIGHT_WEB_PORT'],
  ['training', 'PLAYWRIGHT_TRAINING_WEB_PORT'],
  ['professional-roster-error', 'PLAYWRIGHT_ROSTER_ERROR_WEB_PORT'],
  ['custom-meal-error', 'PLAYWRIGHT_CUSTOM_MEAL_ERROR_WEB_PORT'],
] as const;

void test('web port parsing defaults and accepts the full valid range', () => {
  assert.equal(parseWebPort('WEB_PORT', undefined, 8081), 8081);
  assert.equal(parseWebPort('WEB_PORT', '1', 8081), 1);
  assert.equal(parseWebPort('WEB_PORT', '65535', 8081), 65535);
});

void test('web port parsing rejects malformed and out-of-range values', () => {
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

void test('browser profiles reject malformed overrides and resolve valid ports consistently', () => {
  for (const [profile, key] of portProfiles) {
    const original = env[key];
    try {
      env[key] = '8123x';
      assert.throws(
        () => createWebTestConfig(profile),
        new RegExp(`${key} must contain only decimal digits`),
      );
      env[key] = '8123';
      const config = createWebTestConfig(profile);
      assert.equal(config.use?.baseURL, 'http://127.0.0.1:8123');
      const server = config.webServer;
      assert.ok(server && !Array.isArray(server));
      assert.equal(server.url, config.use?.baseURL);
      assert.match(server.command, /--port 8123 --clear$/);
    } finally {
      if (original === undefined) delete env[key];
      else env[key] = original;
    }
  }
});
