import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  assertResolvedIntegratedExpoConfig,
  requireIntegratedLoopbackOrigin,
} from './integration-preflight';
import { treeHash } from './native-build-identity';
import { inspectPrivateAndroidDirectory } from './owned-android-emulator';
import type { NativeSourceIdentity } from './native-build-identity';

const execute = promisify(execFile);
export const ANDROID_PILOT_APP_ID = 'com.edufelip.mychampions.dev';

/** The existing capture toolchain, resolved independently of a captured identity JSON. */
export async function resolveAndroidPilotToolchain() {
  const sdkRoot = '/Users/eduwaldo/Library/Android/sdk';
  const javaHome = (
    await execute('/usr/libexec/java_home', ['-v', '17'], { timeout: 5000 })
  ).stdout.trim();
  for (const root of [sdkRoot, javaHome]) {
    if (
      !path.isAbsolute(root) ||
      (await realpath(root)) !== root ||
      !(await lstat(root)).isDirectory()
    )
      throw new Error('Android pilot toolchain root is not canonical');
  }
  return { sdkRoot, javaHome };
}

/** Android inputs are separate; existing qualified iOS source hashes do not change. */
export async function androidSourceIdentity(root: string): Promise<NativeSourceIdentity> {
  const digest = createHash('sha256');
  for (const name of [
    'app',
    'components',
    'features',
    'constants',
    'localization',
    'assets',
    'android/app/src',
    'android/gradle',
  ])
    digest.update(name + ':' + (await treeHash(path.join(root, name))));
  for (const name of [
    'package.json',
    'yarn.lock',
    'app.config.ts',
    'android/settings.gradle',
    'android/build.gradle',
    'android/gradle.properties',
    'android/gradlew',
    'android/app/build.gradle',
    'android/app/debug.keystore',
  ])
    digest.update(name).update(await readFile(path.join(root, name)));
  return {
    sha: (await execute('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 5000 })).stdout.trim(),
    dirty: true,
    sourceTreeHash: digest.digest('hex'),
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid embedded Android config');
  return value as Record<string, unknown>;
}

export function assertAndroidPilotApkMetadata(
  input: { badging: string; signing: string; config: unknown },
  apiOrigin: string,
) {
  requireIntegratedLoopbackOrigin(apiOrigin);
  const packageMatch = /^package: name='([^']+)' /m.exec(input.badging);
  const activityMatch = /^launchable-activity: name='([^']+)' /m.exec(input.badging);
  const signerMatch = /^Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]{64})\s*$/m.exec(
    input.signing,
  );
  if (
    packageMatch?.[1] !== ANDROID_PILOT_APP_ID ||
    !/^application-debuggable\s*$/m.test(input.badging) ||
    activityMatch?.[1] !== 'com.edufelip.mychampions.MainActivity' ||
    !/^Verifies\s*$/m.test(input.signing) ||
    !signerMatch ||
    !/^Number of signers: 1\s*$/m.test(input.signing)
  )
    throw new Error('Android pilot requires a verified dev/debug APK and expected launcher');
  const config = object(input.config);
  const android = object(config.android);
  const extra = object(config.extra);
  if (config.slug !== 'my-champions' || android.package !== ANDROID_PILOT_APP_ID)
    throw new Error('Embedded Android identity differs from the pilot');
  assertResolvedIntegratedExpoConfig(extra, apiOrigin);
  return {
    appId: ANDROID_PILOT_APP_ID,
    launcher: activityMatch[1],
    debuggable: true as const,
    signingCertificateHash: signerMatch[1].toLowerCase(),
    environmentHash: createHash('sha256').update(JSON.stringify(extra)).digest('hex'),
  };
}

export function androidMetroPreference(appId: string, metroPort: number) {
  if (
    appId !== ANDROID_PILOT_APP_ID ||
    !Number.isSafeInteger(metroPort) ||
    metroPort < 1024 ||
    metroPort > 49151
  )
    throw new Error('Android Metro preference requires the dev app and valid owned port');
  return {
    relativePath: `shared_prefs/${appId}_preferences.xml`,
    xml: `<?xml version="1.0" encoding="utf-8" standalone="yes" ?>\n<map>\n    <string name="debug_http_host">localhost:${metroPort}</string>\n</map>\n`,
  };
}

export function assertAndroidReverseMappings(output: string, serial: string, ports: number[]) {
  if (!/^emulator-\d+$/.test(serial) || new Set(ports).size !== ports.length || !ports.length)
    throw new Error('Invalid Android reverse expectation');
  // `adb -s <verified serial> reverse --list` uses an internal host-N transport
  // label on this SDK. Device ownership is established by the selected ADB
  // command/target verifier, not by equating that label with the serial.
  const rows = output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/));
  if (rows.length !== ports.length || new Set(rows.map((row) => row[0])).size !== 1)
    throw new Error('Android reverse port is absent or points to an unexpected endpoint');
  for (const port of ports) {
    if (
      !Number.isSafeInteger(port) ||
      port < 1024 ||
      port > 65535 ||
      !rows.some(
        (row) =>
          row.length === 3 &&
          (row[0] === serial || /^host-\d+$/.test(row[0])) &&
          row[1] === `tcp:${port}` &&
          row[2] === `tcp:${port}`,
      )
    )
      throw new Error('Android reverse port is absent or points to an unexpected endpoint');
  }
}

/** Read real APK tooling output/config; never accept a filename as build identity. */
export async function inspectOwnedAndroidApk(options: {
  binaryPath: string;
  artifactRoot: string;
  sdkRoot: string;
  apiOrigin: string;
  writeReceipt?: boolean;
}) {
  await inspectPrivateAndroidDirectory(options.artifactRoot);
  const binaryPath = path.resolve(options.binaryPath);
  const meta = await lstat(binaryPath);
  if (
    !binaryPath.startsWith(options.artifactRoot + path.sep) ||
    (await realpath(binaryPath)) !== binaryPath ||
    !meta.isFile() ||
    meta.isSymbolicLink() ||
    meta.uid !== process.getuid?.() ||
    meta.mode & 0o022
  )
    throw new Error('APK must be owned within the private artifact root');
  const beforeHash = createHash('sha256')
    .update(await readFile(binaryPath))
    .digest('hex');
  const tools = path.join(options.sdkRoot, 'build-tools/36.0.0');
  const [badging, signing, embedded] = await Promise.all([
    execute(path.join(tools, 'aapt2'), ['dump', 'badging', binaryPath], {
      timeout: 15000,
      maxBuffer: 1024 * 1024,
    }),
    execute(path.join(tools, 'apksigner'), ['verify', '--verbose', '--print-certs', binaryPath], {
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    }),
    execute(
      '/usr/bin/python3',
      [
        '-c',
        'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); i=z.getinfo("assets/app.config"); assert i.file_size<=1048576; sys.stdout.buffer.write(z.read(i))',
        binaryPath,
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    ),
  ]);
  const config: unknown = JSON.parse(embedded.stdout);
  const verified = assertAndroidPilotApkMetadata(
    { badging: badging.stdout, signing: signing.stdout, config },
    options.apiOrigin,
  );
  const afterMeta = await lstat(binaryPath);
  const binaryHash = createHash('sha256')
    .update(await readFile(binaryPath))
    .digest('hex');
  if (beforeHash !== binaryHash || meta.dev !== afterMeta.dev || meta.ino !== afterMeta.ino)
    throw new Error('APK changed during identity inspection');
  if (options.writeReceipt !== false)
    await writeFile(
      path.join(options.artifactRoot, 'android-apk-identity.private.json'),
      JSON.stringify(
        { ...verified, binaryPath, binaryHash, apiOrigin: options.apiOrigin },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    );
  return { ...verified, binaryPath, binaryHash };
}
