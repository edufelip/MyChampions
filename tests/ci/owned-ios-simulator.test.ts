import assert from 'node:assert/strict';
import test from 'node:test';
import {
  iosSimulatorBootstatusDeadline,
  parseIosSimulatorBootstatusDeadline,
  validateBootedIosDevice,
  validateIosDeviceOwnership,
} from '../../scripts/testing/owned-ios-simulator';

void test('bootstrap deadline rejects unsafe overrides before acquisition and retains its existing cap', () => {
  assert.equal(iosSimulatorBootstatusDeadline(), 180000);
  assert.equal(parseIosSimulatorBootstatusDeadline(undefined), 180000);
  for (const value of [1000, 180000]) {
    assert.equal(iosSimulatorBootstatusDeadline(value), value);
    assert.equal(parseIosSimulatorBootstatusDeadline(String(value)), value);
  }
  for (const value of [0, -1, 999, 1000.5, 180001, NaN, Infinity, '1000', null])
    assert.throws(() => iosSimulatorBootstatusDeadline(value as number), /Invalid/);
  for (const value of ['', ' 1000', '1000 ', '01000', '1e3', '1000.0', '+1000', '999', '180001'])
    assert.throws(() => parseIosSimulatorBootstatusDeadline(value), /Invalid/);
});

void test('simulator cleanup identity rejects a foreign target or changed name/type/runtime', () => {
  const expected = {
    udid: '00000000-0000-4000-8000-000000000001',
    name: `MyChampions-Pilot-${'a'.repeat(24)}`,
    deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
    runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
  };
  const observed = { ...expected, state: 'Booted', isAvailable: true };
  assert.doesNotThrow(() => validateIosDeviceOwnership(expected, observed));
  assert.throws(() => validateIosDeviceOwnership(expected, undefined));
  for (const change of [
    { udid: '00000000-0000-4000-8000-000000000002' },
    { name: 'ET-233-AdMob' },
    { deviceTypeIdentifier: 'another-device-type' },
    { runtime: 'another-runtime' },
  ])
    assert.throws(
      () => validateIosDeviceOwnership(expected, { ...observed, ...change }),
      /identity changed/,
    );
  assert.throws(() =>
    validateIosDeviceOwnership(
      { ...expected, name: 'foreign-target' },
      { ...observed, name: 'foreign-target' },
    ),
  );
});

void test('native action readiness rejects unavailable or shutting-down targets while cleanup retains their owned identity', () => {
  const expected = {
    udid: '00000000-0000-4000-8000-000000000001',
    name: `MyChampions-Pilot-${'a'.repeat(24)}`,
    deviceTypeIdentifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
    runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
  };
  const booted = { ...expected, state: 'Booted', isAvailable: true };
  assert.doesNotThrow(() => validateBootedIosDevice(expected, booted));
  for (const state of ['Shutdown', 'Shutting Down', 'Booting', 'Unknown']) {
    const value = { ...booted, state };
    assert.throws(() => validateBootedIosDevice(expected, value), /no native action/);
    assert.doesNotThrow(() => validateIosDeviceOwnership(expected, value));
  }
  assert.throws(
    () => validateBootedIosDevice(expected, { ...booted, isAvailable: false }),
    /no native action/,
  );
  assert.throws(() => validateBootedIosDevice(expected, undefined), /identity changed/);
  assert.throws(
    () =>
      validateBootedIosDevice(expected, {
        ...booted,
        udid: '00000000-0000-4000-8000-000000000002',
      }),
    /identity changed/,
  );
});

void test('bootstrap diagnostics retain bounded timeout/cancellation details without inventing a successful exit', async () => {
  const { iosSimulatorBootstrapFailure } =
    await import('../../scripts/testing/owned-ios-simulator');
  const value = iosSimulatorBootstrapFailure(
    {
      message: 'bootstatus exceeded deadline',
      killed: true,
      signal: 'SIGTERM',
      stdout: 'x'.repeat(100000),
      stderr: 'owned bootstrap error',
    },
    {
      phase: 'bootstatus',
      identity: undefined,
      elapsedMs: 180001,
      aborted: false,
      deviceState: 'Booting',
    },
  );
  assert.equal(value.exitCode, null);
  assert.equal(value.failureReason, 'deadline');
  assert.equal(value.deadlineMs, 180000);
  assert.equal(value.killed, true);
  assert.equal(value.signal, 'SIGTERM');
  assert.equal(value.deviceStateBeforeCleanup, 'Booting');
  assert.equal(value.stdout?.length, 65536);
  assert.equal(value.identity, null);
  assert.equal(
    iosSimulatorBootstrapFailure(
      {},
      {
        phase: 'bootstatus',
        identity: undefined,
        elapsedMs: 1001,
        aborted: false,
        bootstatusDeadlineMs: 1000,
      },
    ).deadlineMs,
    1000,
  );
  const cancelled = iosSimulatorBootstrapFailure(
    { code: 'ABORT_ERR' },
    {
      phase: 'bootstatus',
      identity: undefined,
      elapsedMs: 10,
      aborted: true,
    },
  );
  assert.equal(cancelled.aborted, true);
  assert.equal(cancelled.failureReason, 'cancelled');
  assert.equal(cancelled.errorCode, 'ABORT_ERR');
  assert.equal(cancelled.exitCode, null);
  assert.equal(cancelled.deviceStateBeforeCleanup, null);
  for (const [error, elapsedMs, aborted] of [
    [{ killed: false, signal: 'SIGTERM' }, 1001, false],
    [{ killed: true, signal: 'SIGTERM' }, 999, false],
    [{ killed: true, signal: 'SIGKILL' }, 1001, false],
    [{ killed: true, signal: 'SIGTERM' }, 1001, true],
  ] as const)
    assert.notEqual(
      iosSimulatorBootstrapFailure(error, {
        phase: 'bootstatus',
        identity: undefined,
        elapsedMs,
        aborted,
        bootstatusDeadlineMs: 1000,
      }).failureReason,
      'deadline',
    );
});
