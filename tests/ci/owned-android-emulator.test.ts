import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, realpath, rm, symlink, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireOwnedAndroidEmulator,
  androidEmulatorLifecycleCaps,
  captureAndroidGroupBeforeDeadline,
  effectiveAndroidLifecycleDeadline,
  executeOwnedAndroidAdbRead,
  inspectPrivateAndroidDirectory,
  isExpectedPreGuestAndroidBootTransportNotFound,
  isTransientAndroidAdbReadinessError,
  localAndroidPilotEnvironment,
  readAndroidAdbWithReadinessRetry,
  resolveOwnedAndroidSystemImage,
  resolveAndroidEmulatorLifecycleDeadlines,
  PreGuestAndroidBootTransportNotFoundError,
  TransientAndroidAdbReadinessError,
  validateAndroidTargetIdentity,
  writeOwnedAndroidTargetMarker,
} from '../../scripts/testing/owned-android-emulator';
import type { AndroidRunnerSlot } from '../../scripts/ci/android-runner-slot';

void test('Android target ownership rejects another AVD, serial or guest nonce', () => {
  const identity = {
    avd: `MyChampions-Pilot-${'a'.repeat(24)}`,
    serial: 'emulator-5554',
    nonce: 'b'.repeat(48),
  };
  assert.doesNotThrow(() => validateAndroidTargetIdentity(identity, { ...identity }));
  for (const changed of [
    { ...identity, avd: 'Pixel10' },
    { ...identity, serial: 'emulator-5556' },
    { ...identity, nonce: 'c'.repeat(48) },
  ])
    assert.throws(() => validateAndroidTargetIdentity(identity, changed), /identity changed/);
  for (const serial of ['emulator-5555', 'emulator-5586', 'USB-device'])
    assert.throws(() =>
      validateAndroidTargetIdentity({ ...identity, serial }, { ...identity, serial }),
    );
});

void test('Android owner marker retries once only after the target identity is rechecked', async () => {
  let writes = 0;
  let verifications = 0;
  await writeOwnedAndroidTargetMarker({
    write: async () => {
      writes++;
      if (writes === 1) throw new Error('temporary ADB transport reset');
    },
    verifyPreGuestTarget: async () => {
      verifications++;
    },
  });
  assert.equal(writes, 2);
  assert.equal(verifications, 1);

  writes = 0;
  verifications = 0;
  await assert.rejects(
    writeOwnedAndroidTargetMarker({
      write: async () => {
        writes++;
        throw new Error('marker write failed');
      },
      verifyPreGuestTarget: async () => {
        verifications++;
      },
    }),
    /marker could not be written after identity recheck/,
  );
  assert.equal(writes, 2);
  assert.equal(verifications, 1);
});

void test('pre-guest boot transport may retry only the expected serial and preserves the original deadline', async () => {
  const expectedSerial = 'emulator-5556';
  const foreignSerial = 'emulator-5558';
  assert.equal(
    isExpectedPreGuestAndroidBootTransportNotFound(
      new Error(`adb: error: device '${expectedSerial}' not found`),
      expectedSerial,
    ),
    true,
  );
  assert.equal(
    isExpectedPreGuestAndroidBootTransportNotFound(
      new Error(`adb: error: device '${foreignSerial}' not found`),
      expectedSerial,
    ),
    false,
  );
  assert.equal(
    isExpectedPreGuestAndroidBootTransportNotFound(
      new Error('Owned worker command census unavailable'),
      expectedSerial,
    ),
    false,
  );
  for (const message of [
    'adb: error: no devices/emulators found',
    `adb: error: serial '${expectedSerial}' unknown`,
    `adb: error: device '${expectedSerial}' not present`,
    `adb: error: device '${foreignSerial}' not found`,
    `adb: error: device '${expectedSerial}' not found; device '${foreignSerial}' not found`,
  ])
    assert.equal(
      isExpectedPreGuestAndroidBootTransportNotFound(new Error(message), expectedSerial),
      false,
      message,
    );

  let now = 0;
  let calls = 0;
  const deadlines: number[] = [];
  const result = await readAndroidAdbWithReadinessRetry({
    deadlineAtMonotonicMs: 1_000,
    maxReadTimeoutMs: 250,
    retryDelayMs: 25,
    now: () => now,
    sleep: (delayMs) => {
      now += delayMs;
      return Promise.resolve();
    },
    label: 'Android boot readiness',
    allowPreGuestBootTransportNotFound: true,
    read: (_timeoutMs, deadline) => {
      calls++;
      deadlines.push(deadline);
      if (calls === 1)
        return Promise.reject(
          new PreGuestAndroidBootTransportNotFoundError(
            new Error(`adb: error: device '${expectedSerial}' not found`),
          ),
        );
      return Promise.resolve('0');
    },
  });
  assert.equal(result, '0');
  assert.equal(calls, 2);
  assert.deepEqual(deadlines, [1_000, 1_000]);
});

void test('identity missing remains fatal even when the pre-guest retry opt-in is present', async () => {
  let calls = 0;
  await assert.rejects(
    readAndroidAdbWithReadinessRetry({
      deadlineAtMonotonicMs: 1_000,
      now: () => 0,
      allowPreGuestBootTransportNotFound: true,
      label: 'Android target identity',
      read: () => {
        calls++;
        return Promise.reject(new Error("adb: error: device 'emulator-5556' not found"));
      },
    }),
    /device 'emulator-5556' not found/,
  );
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(
    readAndroidAdbWithReadinessRetry({
      deadlineAtMonotonicMs: 1_000,
      now: () => 0,
      label: 'Android target identity',
      read: () => {
        calls++;
        return Promise.reject(
          new PreGuestAndroidBootTransportNotFoundError(
            new Error("adb: error: device 'emulator-5556' not found"),
          ),
        );
      },
    }),
    /device 'emulator-5556' not found/,
  );
  assert.equal(calls, 1);
});

void test('Android acquisition lifecycle deadlines only shorten existing caps', () => {
  assert.deepEqual(resolveAndroidEmulatorLifecycleDeadlines(), androidEmulatorLifecycleCaps);
  assert.deepEqual(resolveAndroidEmulatorLifecycleDeadlines(5_000), {
    avdCreationMs: 5_000,
    adbStartupMs: 5_000,
    bootMs: 5_000,
  });
  assert.deepEqual(resolveAndroidEmulatorLifecycleDeadlines(600_000), androidEmulatorLifecycleCaps);
  assert.equal(effectiveAndroidLifecycleDeadline(1_000, 10_000), 1_000);
  assert.throws(
    () => resolveAndroidEmulatorLifecycleDeadlines(999),
    /Invalid Android lifecycle deadline/,
  );
  assert.throws(
    () => effectiveAndroidLifecycleDeadline(10_000, 999),
    /Invalid Android lifecycle deadline/,
  );
});

void test('owned Android emulator uses the reviewed local image unless a safe override is supplied', () => {
  assert.equal(
    resolveOwnedAndroidSystemImage({}),
    'system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a',
  );
  assert.equal(
    resolveOwnedAndroidSystemImage({
      MYCHAMPIONS_DETOX_ANDROID_SYSTEM_IMAGE: 'system-images;android-28;google_apis;arm64-v8a',
    }),
    'system-images;android-28;google_apis;arm64-v8a',
  );
  assert.throws(
    () => resolveOwnedAndroidSystemImage({ MYCHAMPIONS_DETOX_ANDROID_SYSTEM_IMAGE: '/unsafe' }),
    /Unsafe or unsupported/,
  );
});

void test('boot_completed alone does not qualify the target and transient offline identity reads reuse one deadline', async () => {
  const expected = {
    avd: `MyChampions-Pilot-${'a'.repeat(24)}`,
    serial: 'emulator-5554',
    nonce: 'b'.repeat(48),
  };
  const deadlineAtMonotonicMs = 1_000;
  let now = 0;
  let serialReads = 0;
  const calls: { argv: string[]; timeoutMs: number; deadline: number }[] = [];
  const probe = (argv: string[], label: string) =>
    readAndroidAdbWithReadinessRetry({
      deadlineAtMonotonicMs,
      maxReadTimeoutMs: 250,
      now: () => now,
      retryDelayMs: 25,
      sleep: (delayMs) => {
        now += delayMs;
        return Promise.resolve();
      },
      label,
      read: (timeoutMs, deadline) => {
        calls.push({ argv, timeoutMs, deadline });
        const command = argv.join(' ');
        if (command === 'shell getprop sys.boot_completed') return Promise.resolve('1');
        if (command === 'emu avd name') return Promise.resolve(expected.avd);
        if (command === 'get-serialno') {
          serialReads++;
          if (serialReads === 1) {
            const error = new Error('adb: error: device offline') as Error & {
              stderr: string;
            };
            error.stderr = 'error: device offline';
            return Promise.reject(new TransientAndroidAdbReadinessError(error));
          }
          return Promise.resolve(expected.serial);
        }
        if (command === 'shell getprop debug.mychampions.owner')
          return Promise.resolve(expected.nonce);
        return Promise.reject(new Error(`unexpected probe ${command}`));
      },
    });

  assert.equal(await probe(['shell', 'getprop', 'sys.boot_completed'], 'boot readiness'), '1');
  assert.equal(await probe(['emu', 'avd', 'name'], 'target identity'), expected.avd);
  assert.equal(await probe(['get-serialno'], 'target identity'), expected.serial);
  const nonce = await probe(['shell', 'getprop', 'debug.mychampions.owner'], 'target nonce');
  validateAndroidTargetIdentity(expected, {
    avd: expected.avd,
    serial: expected.serial,
    nonce,
  });
  assert.equal(serialReads, 2);
  assert(calls.length >= 5);
  assert(calls.every((call) => call.deadline === deadlineAtMonotonicMs));
  assert(calls.every((call) => call.timeoutMs <= 250));
  assert.equal(isTransientAndroidAdbReadinessError(new Error('error: device offline')), true);
  assert.equal(
    isTransientAndroidAdbReadinessError(new Error('adb: device still authorizing')),
    true,
  );
  assert.equal(isTransientAndroidAdbReadinessError(new Error('adb: device unauthorized')), false);
  assert.equal(isTransientAndroidAdbReadinessError(new Error('device not found')), false);
  assert.equal(isTransientAndroidAdbReadinessError(new Error('device unauthorized')), false);
});

void test('Android startup readiness rejects a wrong target without probing or retrying its nonce', async () => {
  const expected = {
    avd: `MyChampions-Pilot-${'a'.repeat(24)}`,
    serial: 'emulator-5554',
    nonce: 'b'.repeat(48),
  };
  let calls = 0;
  const probe = (argv: string[]) =>
    readAndroidAdbWithReadinessRetry({
      deadlineAtMonotonicMs: 1_000,
      now: () => 0,
      label: 'target identity',
      read: () => {
        calls++;
        return Promise.resolve(
          argv.join(' ') === 'shell getprop sys.boot_completed' ? '1' : 'Foreign-AVD',
        );
      },
    });
  assert.equal(await probe(['shell', 'getprop', 'sys.boot_completed']), '1');
  const avd = await probe(['emu', 'avd', 'name']);
  assert.throws(
    () =>
      validateAndroidTargetIdentity(expected, {
        avd,
        serial: expected.serial,
        nonce: expected.nonce,
      }),
    /identity changed/,
  );
  assert.equal(calls, 2);
});

void test('Android startup readiness does not renew an expired deadline or retry cancellation/census failures', async () => {
  let now = 0;
  let calls = 0;
  await assert.rejects(
    readAndroidAdbWithReadinessRetry({
      deadlineAtMonotonicMs: 50,
      now: () => now,
      retryDelayMs: 25,
      sleep: (delayMs) => {
        now += delayMs;
        return Promise.resolve();
      },
      label: 'boot readiness',
      read: () => {
        calls++;
        return Promise.reject(
          new TransientAndroidAdbReadinessError(new Error('error: device offline')),
        );
      },
    }),
    /deadline/,
  );
  assert.equal(calls, 2);

  calls = 0;
  await assert.rejects(
    readAndroidAdbWithReadinessRetry({
      deadlineAtMonotonicMs: 1_000,
      now: () => 0,
      label: 'boot readiness',
      read: () => {
        calls++;
        return Promise.reject(new Error('Owned worker command census unavailable: device offline'));
      },
    }),
    /census unavailable/,
  );
  assert.equal(calls, 1);

  const controller = new AbortController();
  calls = 0;
  await assert.rejects(
    readAndroidAdbWithReadinessRetry({
      deadlineAtMonotonicMs: 1_000,
      signal: controller.signal,
      now: () => 0,
      label: 'boot readiness',
      read: () => {
        calls++;
        controller.abort();
        return Promise.reject(
          new TransientAndroidAdbReadinessError(new Error('error: device offline')),
        );
      },
    }),
    /aborted/i,
  );
  assert.equal(calls, 1);

  calls = 0;
  await assert.rejects(
    readAndroidAdbWithReadinessRetry({
      deadlineAtMonotonicMs: 1_000,
      now: () => 0,
      label: 'boot readiness',
      read: () => {
        calls++;
        return Promise.reject(new Error('Owned worker command census unavailable'));
      },
    }),
    /census unavailable/,
  );
  assert.equal(calls, 1);
});

void test('Android group capture cancels the losing fast-success deadline timer', async () => {
  let timerSignal: AbortSignal | undefined;
  let captureSettled = false;
  const result = await captureAndroidGroupBeforeDeadline({
    deadlineAtMonotonicMs: 1_000,
    now: () => 0,
    sleep: async (_delayMs, signal) => {
      timerSignal = signal;
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new Error('local deadline timer disposed')),
          { once: true },
        );
      });
    },
    capture: () => {
      captureSettled = true;
      return Promise.resolve(['census']);
    },
    label: 'Android boot',
  });
  assert.deepEqual(result, ['census']);
  assert.equal(captureSettled, true);
  assert.equal(timerSignal?.aborted, true);
});

void test('Android group capture keeps timeout and caller cancellation bounded without adopting the census', async () => {
  let releaseCapture: (() => void) | undefined;
  let captureSettled = false;
  const timedOut = captureAndroidGroupBeforeDeadline({
    deadlineAtMonotonicMs: 1_000,
    now: () => 0,
    sleep: () => Promise.resolve(),
    capture: () =>
      new Promise<string[]>((resolve) => {
        releaseCapture = () => {
          captureSettled = true;
          resolve(['late-census']);
        };
      }),
    label: 'Android boot',
  });
  await assert.rejects(timedOut, /deadline/);
  assert.equal(captureSettled, false);
  releaseCapture!();
  await new Promise<void>((resolve) => queueMicrotask(resolve));

  const controller = new AbortController();
  const abortReason = new Error('caller cancellation');
  let timerDisposed = false;
  const cancelled = captureAndroidGroupBeforeDeadline({
    deadlineAtMonotonicMs: 1_000,
    signal: controller.signal,
    now: () => 0,
    sleep: async (_delayMs, signal) => {
      await new Promise<void>((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => {
            timerDisposed = true;
            reject(new Error('local deadline timer disposed'));
          },
          { once: true },
        );
      });
    },
    capture: () => new Promise<string[]>(() => undefined),
    label: 'Android boot',
  });
  queueMicrotask(() => controller.abort(abortReason));
  await assert.rejects(cancelled, (error) => error === abortReason);
  assert.equal(timerDisposed, true);
});

void test('Android ADB reads reject child launch after listener inspection exhausts the phase budget', async () => {
  let now = 0;
  let launched = false;
  let listenerTimeout = 0;
  await assert.rejects(
    executeOwnedAndroidAdbRead({
      timeoutMs: 10_000,
      phaseDeadline: 100,
      now: () => now,
      captureGroup: () => Promise.resolve([{ pid: 123 }]),
      assertListener: (_port, _processIds, timeoutMs) => {
        listenerTimeout = timeoutMs;
        now = 100;
        return Promise.resolve();
      },
      port: 31_001,
      execute: () => {
        launched = true;
        return Promise.resolve('unexpected');
      },
    }),
    /Owned Android boot deadline/,
  );
  assert.equal(listenerTimeout, 100);
  assert.equal(launched, false);
});

void test('Android ADB reads shrink the child timeout after listener inspection', async () => {
  let now = 0;
  let childTimeout = 0;
  const result = await executeOwnedAndroidAdbRead({
    timeoutMs: 1_000,
    phaseDeadline: 100,
    now: () => now,
    captureGroup: () => Promise.resolve([{ pid: 123 }]),
    assertListener: () => {
      now = 37;
      return Promise.resolve();
    },
    port: 31_001,
    execute: (timeoutMs) => {
      childTimeout = timeoutMs;
      return Promise.resolve('ok');
    },
  });
  assert.equal(result, 'ok');
  assert.equal(childTimeout, 63);
});

void test('Android ADB and listener subprocesses receive the caller cancellation signal', async () => {
  const controller = new AbortController();
  let listenerSignal: AbortSignal | undefined;
  let childSignal: AbortSignal | undefined;
  const result = await executeOwnedAndroidAdbRead({
    timeoutMs: 1_000,
    signal: controller.signal,
    captureGroup: () => Promise.resolve([{ pid: 123 }]),
    assertListener: (_port, _processIds, _timeoutMs, signal) => {
      listenerSignal = signal;
      return Promise.resolve();
    },
    port: 31_001,
    execute: (_timeoutMs, signal) => {
      childSignal = signal;
      return Promise.resolve('ok');
    },
  });
  assert.equal(result, 'ok');
  assert.equal(listenerSignal, controller.signal);
  assert.equal(childSignal, controller.signal);
});

void test('Android runtime guard rejects a symlink or public directory and accepts a private canonical directory', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-android-guard-')));
  await chmod(root, 0o700);
  const owned = path.join(root, 'owned');
  const linked = path.join(root, 'linked');
  try {
    await mkdir(owned, { mode: 0o700 });
    const birth = await inspectPrivateAndroidDirectory(owned);
    assert.equal(birth.uid, process.getuid?.());
    await symlink(owned, linked);
    await assert.rejects(inspectPrivateAndroidDirectory(linked), /canonical, private and owned/);
    await chmod(owned, 0o755);
    await assert.rejects(inspectPrivateAndroidDirectory(owned), /canonical, private and owned/);
  } finally {
    await rm(root, { recursive: true });
  }
});

void test('local Android SDK and Maestro share only run-owned debug keys without changing HOME', () => {
  const slot: AndroidRunnerSlot = {
    slotId: 'mychampions-local-test',
    avd: 'MyChampions-Pilot-' + 'a'.repeat(24),
    avdHome: '/private/mychampions-local-test/avd',
    userHome: '/private/mychampions-local-test/user',
    recoveryRoot: '/private/mychampions-local-test/recovery',
    logRoot: '/private/mychampions-local-test/logs',
    tempRoot: '/private/mychampions-local-test/tmp',
    lockRoot: '/private/mychampions-local-test/locks',
    emulatorPort: 5554,
    emulatorSerial: 'emulator-5554',
    adbServerPort: 31001,
    metroPort: 31002,
  };
  const env = localAndroidPilotEnvironment(slot, '/sdk');
  assert.equal(env.ANDROID_USER_HOME, path.join(slot.userHome, '.android'));
  assert.equal(env.ANDROID_EMULATOR_HOME, env.ANDROID_USER_HOME);
  assert.equal(env.ADB_VENDOR_KEYS, env.ANDROID_USER_HOME);
  assert.equal(env.JAVA_OPTS, `-Duser.home=${slot.userHome}`);
  assert.equal(env.HOME, process.env.HOME);
  assert.equal(env.ADB_SERVER_PORT, '31001');
  assert.throws(
    () => localAndroidPilotEnvironment({ ...slot, userHome: '/unsafe java/home' }, '/sdk'),
    /whitespace/,
  );
});

void test('Android preflight failure records exact acquisition root without creating target resources', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-android-preflight-')));
  const runtimeParent = path.join(root, 'runtime'),
    artifactRoot = path.join(root, 'a'.repeat(24));
  await mkdir(runtimeParent, { mode: 0o700 });
  await mkdir(artifactRoot, { mode: 0o700 });
  try {
    await assert.rejects(
      acquireOwnedAndroidEmulator({
        runtimeParent,
        artifactRoot,
        sdkRoot: '/no-sdk-is-read',
        systemImage: 'invalid',
      }),
      /Unsafe or unsupported/,
    );
    assert.deepEqual(await readdir(runtimeParent), []);
    const read = async (name: string) =>
      JSON.parse(await readFile(path.join(artifactRoot, name), 'utf8')) as Record<string, unknown>;
    const intent = await read('android-acquisition-owner.private.json'),
      failure = await read('android-preflight-failure.private.json');
    assert.equal(intent.captureRunId, path.basename(artifactRoot));
    assert.equal(intent.runtimeParent, runtimeParent);
    assert.equal(
      intent.runtimeRoot,
      path.join(runtimeParent, `mychampions-pilot-${String(intent.runId)}`),
    );
    assert.equal(
      failure.kind,
      'original Android preflight failure before target resource creation',
    );
    assert.equal(failure.runId, intent.runId);
    assert.equal(failure.runtimeRoot, intent.runtimeRoot);
    assert.deepEqual((await readdir(artifactRoot)).sort(), [
      'android-acquisition-owner.private.json',
      'android-preflight-failure.private.json',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
