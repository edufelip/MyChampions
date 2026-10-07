import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import {
  acquireOwnedAndroidEmulator,
  inspectPrivateAndroidDirectory,
} from './owned-android-emulator';
import { startOwnedNativeCommand } from './owned-native-command';

const execute = promisify(execFile);
const controller = new AbortController();
let cancelled: 'SIGINT' | 'SIGTERM' | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    cancelled ??= signal;
    controller.abort();
  });

async function main() {
  process.umask(0o077);
  if (process.argv.slice(2).join(' ') !== '--platform=android --mode=connectivity')
    throw new Error('Use --platform=android --mode=connectivity');
  const clientRoot = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const hostRoot = process.env.MYCHAMPIONS_NATIVE_STATE_ROOT;
  if (!hostRoot) throw new Error('Run through the shared native host-lock wrapper');
  await inspectPrivateAndroidDirectory(hostRoot);
  const sdkRoot = process.env.ANDROID_SDK_ROOT ?? '/Users/eduwaldo/Library/Android/sdk';
  const maestro = '/Users/eduwaldo/.maestro/bin/maestro';
  const version = (
    await execute(maestro, ['--version'], {
      timeout: 30_000,
      // Without the analytics opt-out the CLI can block ~55 s on a network call.
      env: {
        ...process.env,
        MAESTRO_CLI_NO_ANALYTICS: 'true',
        MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true',
      },
    })
  ).stdout.trim();
  if (version !== '2.6.1') throw new Error('Android pilot requires pinned Maestro 2.6.1');
  const runId = randomBytes(12).toString('hex');
  const output = path.join(clientRoot, '.qa/artifacts/native-pilot', runId);
  await mkdir(output, { mode: 0o700 });
  const runtimeParent = path.join(path.dirname(hostRoot), 'mychampions-android-pilot');
  try {
    await mkdir(runtimeParent, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await inspectPrivateAndroidDirectory(runtimeParent);
  const originalAvds = (
    await execute(path.join(sdkRoot, 'emulator/emulator'), ['-list-avds'], { timeout: 10_000 })
  ).stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();
  const simBefore = (
    await execute('xcrun', ['simctl', 'list', 'devices', '--json'], { timeout: 15_000 })
  ).stdout;
  await writeFile(path.join(output, 'previous-ios-devices.private.json'), simBefore, {
    flag: 'wx',
    mode: 0o600,
  });
  process.stdout.write(`Android connectivity artifacts: ${output}\n`);
  const report: Record<string, unknown> = {
    kind: 'private-android-connectivity-not-app-coverage',
    runId,
    platform: 'android',
    mode: 'connectivity',
    maestroVersion: version,
    nativePassingCases: 0,
    capturedAppViews: 0,
    exercisedAppTransitions: 0,
    startedAt: new Date().toISOString(),
    result: 'harness-blocked',
    cleanup: 'pending',
    originalAvds,
  };
  const inputPaths = [
    'scripts/testing/probe-android-connectivity.ts',
    'scripts/testing/owned-android-emulator.ts',
    'scripts/testing/owned-android-port.ts',
    'scripts/testing/owned-native-command.ts',
    'scripts/testing/owned-process-group.ts',
    'scripts/testing/owned-expo.ts',
    'scripts/ci/android-runner-slot.ts',
  ];
  const fingerprint = async () => {
    const rows = [];
    for (const relative of inputPaths)
      rows.push({
        path: relative,
        sha256: createHash('sha256')
          .update(await readFile(path.join(clientRoot, relative)))
          .digest('hex'),
      });
    return rows;
  };
  const beforeInputs = await fingerprint();
  report.inputsBefore = beforeInputs;
  report.repositorySha = (
    await execute('git', ['rev-parse', 'HEAD'], { cwd: clientRoot, timeout: 5000 })
  ).stdout.trim();
  let target: Awaited<ReturnType<typeof acquireOwnedAndroidEmulator>> | undefined;
  let command: Awaited<ReturnType<typeof startOwnedNativeCommand>> | undefined;
  const failures: string[] = [];
  try {
    target = await acquireOwnedAndroidEmulator({
      runtimeParent,
      artifactRoot: output,
      sdkRoot,
      systemImage: 'system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a',
      signal: controller.signal,
    });
    await target.verify();
    report.target = {
      identity: target.identity,
      slot: target.slot,
      osVersion: target.osVersion,
      runtimeRoot: target.runtimeRoot,
    };
    // --port is the owned emulator adbd endpoint, never the ADB server port.
    const argv = [
      '--platform',
      'android',
      '--host',
      '127.0.0.1',
      '--port',
      String(target.slot.emulatorPort + 1),
      'hierarchy',
    ];
    report.command = { executable: maestro, argv };
    command = await startOwnedNativeCommand({
      command: maestro,
      argv,
      artifactRoot: output,
      label: 'android-maestro-hierarchy',
      env: { ...target.env, MAESTRO_CLI_NO_ANALYTICS: '1' },
    });
    await command.wait(120_000, controller.signal);
    await command.stop();
    await target.verify();
    const hierarchy = await readFile(command.logPath, 'utf8');
    if (
      !/"(?:attributes|children)"\s*:/.test(hierarchy) ||
      !/(?:com\.android\.|android\.widget)/.test(hierarchy)
    )
      throw new Error('Maestro did not return an actual Android system hierarchy');
    report.hierarchy = {
      path: path.basename(command.logPath),
      sha256: createHash('sha256').update(hierarchy).digest('hex'),
    };
    report.result = 'connected';
  } catch (error) {
    report.error = (error as Error).message;
  } finally {
    try {
      await command?.stop();
    } catch (error) {
      failures.push((error as Error).message);
    }
    try {
      await target?.stop();
    } catch (error) {
      failures.push((error as Error).message);
    }
    if (!target) {
      try {
        await lstat(path.join(output, 'android-cleanup-failure.private.json'));
        failures.push('Android acquisition cleanup requires recovery');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          failures.push((error as Error).message);
      }
    }
    const afterAvds = (
      await execute(path.join(sdkRoot, 'emulator/emulator'), ['-list-avds'], { timeout: 10_000 })
    ).stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .sort();
    if (JSON.stringify(originalAvds) !== JSON.stringify(afterAvds))
      failures.push('Previously available Android AVD inventory changed');
    let acquisitionCleaned = false;
    if (!target && !failures.length) {
      try {
        await lstat(path.join(output, 'android-cleanup.private.json'));
        acquisitionCleaned = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          failures.push((error as Error).message);
      }
    }
    report.cleanup = failures.length
      ? 'failed-recovery-retained'
      : target || acquisitionCleaned
        ? 'cleaned'
        : 'not-acquired';
    report.cleanupFailures = failures;
    report.cancelled = cancelled ?? null;
    const afterInputs = await fingerprint();
    report.inputsAfter = afterInputs;
    if (JSON.stringify(beforeInputs) !== JSON.stringify(afterInputs)) {
      report.result = 'harness-blocked';
      report.error = 'Android probe inputs changed during execution';
    }
    report.finishedAt = new Date().toISOString();
    await writeFile(
      path.join(output, 'connectivity.private.json'),
      JSON.stringify(report, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
    process.exitCode =
      cancelled === 'SIGINT'
        ? 130
        : cancelled
          ? 143
          : report.result === 'connected' && report.cleanup === 'cleaned'
            ? 0
            : 2;
  }
}
void main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 2;
});
