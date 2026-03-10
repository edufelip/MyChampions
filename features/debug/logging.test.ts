import test from 'node:test';
import assert from 'node:assert/strict';

import { isDevLoggingEnabled } from './logging';

test('isDevLoggingEnabled returns true when __DEV is true', () => {
  const previousDev = (globalThis as { __DEV?: boolean }).__DEV;
  const previousVariant = process.env['APP_VARIANT'];
  const previousFlag = process.env['EXPO_PUBLIC_DEBUG_LOGS'];

  (globalThis as { __DEV?: boolean }).__DEV = true;
  process.env['APP_VARIANT'] = 'prod';
  delete process.env['EXPO_PUBLIC_DEBUG_LOGS'];

  assert.equal(isDevLoggingEnabled(), true);

  (globalThis as { __DEV?: boolean }).__DEV = previousDev;
  process.env['APP_VARIANT'] = previousVariant;
  if (previousFlag === undefined) delete process.env['EXPO_PUBLIC_DEBUG_LOGS'];
  else process.env['EXPO_PUBLIC_DEBUG_LOGS'] = previousFlag;
});

test('isDevLoggingEnabled returns true when APP_VARIANT is dev', () => {
  const previousDev = (globalThis as { __DEV?: boolean }).__DEV;
  const previousVariant = process.env['APP_VARIANT'];
  const previousFlag = process.env['EXPO_PUBLIC_DEBUG_LOGS'];

  (globalThis as { __DEV?: boolean }).__DEV = false;
  process.env['APP_VARIANT'] = 'dev';
  delete process.env['EXPO_PUBLIC_DEBUG_LOGS'];

  assert.equal(isDevLoggingEnabled(), true);

  (globalThis as { __DEV?: boolean }).__DEV = previousDev;
  process.env['APP_VARIANT'] = previousVariant;
  if (previousFlag === undefined) delete process.env['EXPO_PUBLIC_DEBUG_LOGS'];
  else process.env['EXPO_PUBLIC_DEBUG_LOGS'] = previousFlag;
});

test('isDevLoggingEnabled respects EXPO_PUBLIC_DEBUG_LOGS=false override', () => {
  const previousDev = (globalThis as { __DEV?: boolean }).__DEV;
  const previousVariant = process.env['APP_VARIANT'];
  const previousFlag = process.env['EXPO_PUBLIC_DEBUG_LOGS'];

  (globalThis as { __DEV?: boolean }).__DEV = true;
  process.env['APP_VARIANT'] = 'dev';
  process.env['EXPO_PUBLIC_DEBUG_LOGS'] = 'false';

  assert.equal(isDevLoggingEnabled(), false);

  (globalThis as { __DEV?: boolean }).__DEV = previousDev;
  process.env['APP_VARIANT'] = previousVariant;
  if (previousFlag === undefined) delete process.env['EXPO_PUBLIC_DEBUG_LOGS'];
  else process.env['EXPO_PUBLIC_DEBUG_LOGS'] = previousFlag;
});
