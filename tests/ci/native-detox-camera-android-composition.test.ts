import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePilotExecutionAdapter } from '../../scripts/testing/run-native-pilot';

const valid = {
  platform: 'android' as const,
  engine: 'detox' as const,
  scenario: 'SCN-camera-denied-android',
  mode: 'integration' as const,
};

void test('current native-pilot composition reaches the Android Detox camera owner', () => {
  assert.equal(nativePilotExecutionAdapter(valid), 'android-detox-camera');
  assert.equal(nativePilotExecutionAdapter({ ...valid, engine: 'maestro' }), 'camera');
  assert.equal(nativePilotExecutionAdapter({ ...valid, platform: 'ios' }), null);
  assert.equal(nativePilotExecutionAdapter({ ...valid, mode: 'fixture' }), null);
  assert.equal(
    nativePilotExecutionAdapter({
      ...valid,
      scenario: 'SCN-camera-denied-android-legacy',
    }),
    null,
  );
});
