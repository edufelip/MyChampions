import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

export const androidInputReaderPackage = 'com.edufelip.mychampions.qa.inputreader';
const app = 'com.edufelip.mychampions.dev';
const titleId = 'pro.training_plan.name';
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function requireAndroidInputReaderBadging(badging: string) {
  const lines = badging.split(/\r?\n/);
  const packages = lines.filter((line) => line.startsWith('package:'));
  assert.equal(packages.length, 1, 'Reader package metadata missing or ambiguous');
  assert.match(
    packages[0],
    new RegExp(`^package: name='${androidInputReaderPackage.replaceAll('.', '\\.')}'(?:\\s|$)`),
  );
  assert.deepEqual(
    lines.filter((line) => /^(?:minSdkVersion|sdkVersion):/.test(line)),
    ["minSdkVersion:'26'"],
    'Reader minimum SDK differs or is ambiguous',
  );
  assert.deepEqual(
    lines.filter((line) => line.startsWith('targetSdkVersion:')),
    ["targetSdkVersion:'36'"],
    'Reader target SDK differs or is ambiguous',
  );
  assert(
    !lines.some((line) => line.startsWith('uses-permission:')),
    'Reader must not request permissions',
  );
}
export type AndroidNativeInputObservation = {
  schemaVersion: 1;
  kind: 'read-only-owned-android-input-observation';
  captureRunId: string;
  label: string;
  matchingFields: 1;
  packageName: typeof app;
  selectorId: string;
  className: 'android.widget.EditText';
  enabled: true;
  editable: true;
  visible: true;
  isShowingHintText: boolean;
  nativeText: string;
  hintText: string;
  bounds: [number, number, number, number];
  apiLevel: number;
  readOnly: true;
};
function request(captureRunId: string, label: string) {
  assert.match(captureRunId, /^[a-f0-9]{24}$/);
  assert.match(label, /^[a-z0-9-]{1,80}$/);
}

/** Original instrument result only; shell exit zero or hint equality cannot substitute for it. */
export function parseAndroidNativeInputObservation(
  log: string,
  captureRunId: string,
  label: string,
) {
  request(captureRunId, label);
  const results = log
    .split(/\r?\n/)
    .filter((line) => line.startsWith('INSTRUMENTATION_RESULT: nativeInput='));
  const codes = log.split(/\r?\n/).filter((line) => line.startsWith('INSTRUMENTATION_CODE:'));
  assert.equal(results.length, 1, 'Raw Android input result missing or ambiguous');
  assert.deepEqual(codes, ['INSTRUMENTATION_CODE: -1'], 'Raw Android input instrument failed');
  assert(
    !log.includes('INSTRUMENTATION_RESULT: nativeInputError='),
    'Raw Android input instrument failed',
  );
  const value = JSON.parse(
    results[0].slice('INSTRUMENTATION_RESULT: nativeInput='.length),
  ) as AndroidNativeInputObservation;
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(
    Object.keys(value).sort(),
    [
      'schemaVersion',
      'kind',
      'captureRunId',
      'label',
      'matchingFields',
      'packageName',
      'selectorId',
      'className',
      'enabled',
      'editable',
      'visible',
      'isShowingHintText',
      'nativeText',
      'hintText',
      'bounds',
      'apiLevel',
      'readOnly',
    ].sort(),
  );
  assert.equal(value.schemaVersion, 1);
  assert.equal(value.kind, 'read-only-owned-android-input-observation');
  assert.equal(value.captureRunId, captureRunId);
  assert.equal(value.label, label);
  assert.equal(value.matchingFields, 1);
  assert.equal(value.packageName, app);
  assert([titleId, `${app}:id/${titleId}`].includes(value.selectorId));
  assert.equal(value.className, 'android.widget.EditText');
  for (const state of [value.enabled, value.editable, value.visible, value.readOnly])
    assert.equal(state, true);
  assert.equal(typeof value.isShowingHintText, 'boolean');
  assert.equal(typeof value.nativeText, 'string');
  assert.equal(typeof value.hintText, 'string');
  assert(Number.isSafeInteger(value.apiLevel) && value.apiLevel >= 26);
  assert(
    Array.isArray(value.bounds) &&
      value.bounds.length === 4 &&
      value.bounds.every(Number.isSafeInteger),
  );
  assert(
    value.bounds[2] > value.bounds[0] &&
      value.bounds[3] > value.bounds[1] &&
      value.bounds[0] >= 0 &&
      value.bounds[1] >= 0,
  );
  return structuredClone(value);
}

/** Android's OS flag disambiguates displayed hint from an actually entered matching string. */
export function requireAndroidNativeInputValue(
  value: AndroidNativeInputObservation,
  expected: string,
  expectedHint: string,
) {
  // Revalidate programmatic inputs through the same literal wire boundary.
  parseAndroidNativeInputObservation(
    `INSTRUMENTATION_RESULT: nativeInput=${JSON.stringify(value)}\nINSTRUMENTATION_CODE: -1`,
    value.captureRunId,
    value.label,
  );
  assert.equal(value.hintText, expectedHint, 'Raw Android title hint differs');
  if (value.isShowingHintText) {
    assert.equal(expected, '', 'Raw Android title still displays a hint instead of its value');
    assert(expectedHint.length > 0);
    assert.equal(value.nativeText, expectedHint, 'Raw Android hint flag/text disagree');
  } else
    assert.equal(
      value.nativeText,
      expected,
      'Raw Android title value differs or remains partially filled',
    );
}

type Run = (
  label: string,
  command: string,
  argv: string[],
  env: NodeJS.ProcessEnv,
  deadlineMs: number,
  input?: string,
) => Promise<string>;
type Adb = (label: string, argv: string[]) => Promise<string>;

/** Auxiliary read-only tool; resources and deadlines belong entirely to the existing Android capture. */
export function createOwnedAndroidInputReader(options: {
  repositoryRoot: string;
  artifactRoot: string;
  sdkRoot: string;
  javaHome: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  run: Run;
  adb: Adb;
}) {
  assert(options && typeof options === 'object' && !Array.isArray(options));
  assert.deepEqual(
    Object.keys(options).sort(),
    ['repositoryRoot', 'artifactRoot', 'sdkRoot', 'javaHome', 'env', 'signal', 'run', 'adb'].sort(),
  );
  for (const value of [
    options.repositoryRoot,
    options.artifactRoot,
    options.sdkRoot,
    options.javaHome,
  ])
    assert(typeof value === 'string' && path.isAbsolute(value) && path.resolve(value) === value);
  assert(options.env && typeof options.env === 'object' && !Array.isArray(options.env));
  assert(options.signal instanceof AbortSignal);
  assert.equal(typeof options.run, 'function');
  assert.equal(typeof options.adb, 'function');
  options.signal.throwIfAborted();
  const captureRunId = path.basename(options.artifactRoot);
  request(captureRunId, 'reader');
  assert.equal(
    path.dirname(options.artifactRoot),
    path.join(options.repositoryRoot, '.qa/artifacts/native-pilot'),
  );
  let buildPromise: Promise<{ binaryHash: string }> | undefined;
  let busy = false;
  const build = async () => {
    const setupStarted = performance.now();
    options.signal.throwIfAborted();
    for (const root of [options.repositoryRoot, options.sdkRoot, options.javaHome])
      assert.equal(await realpath(root), root);
    const output = await realpath(options.artifactRoot);
    const metadata = await lstat(output);
    assert.equal(output, path.resolve(options.artifactRoot));
    assert(
      metadata.isDirectory() &&
        metadata.uid === process.getuid?.() &&
        (metadata.mode & 0o777) === 0o700,
    );
    const work = path.join(output, 'android-input-reader');
    await mkdir(work, { mode: 0o700 });
    for (const child of ['classes', 'dex', 'scratch'])
      await mkdir(path.join(work, child), { mode: 0o700 });
    const toolEnv: NodeJS.ProcessEnv = {
      ...options.env,
      TMPDIR: path.join(work, 'scratch'),
      JAVA_TOOL_OPTIONS: `-Djava.io.tmpdir=${path.join(work, 'scratch')}`,
    };
    const source = path.join(
      options.repositoryRoot,
      'scripts/testing/android-input-reader/InputReader.java',
    );
    const manifest = path.join(
      options.repositoryRoot,
      'scripts/testing/android-input-reader/AndroidManifest.xml',
    );
    const tools = path.join(options.sdkRoot, 'build-tools/36.0.0');
    const androidJar = path.join(options.sdkRoot, 'platforms/android-36/android.jar');
    const sources = [];
    for (const file of [
      source,
      manifest,
      androidJar,
      ...['aapt2', 'd8', 'zipalign', 'apksigner'].map((name) => path.join(tools, name)),
      ...['javac', 'jar', 'keytool'].map((name) => path.join(options.javaHome, 'bin', name)),
    ]) {
      assert.equal(await realpath(file), file);
      assert((await lstat(file)).isFile());
      sources.push({ path: file, sha256: hash(await readFile(file)) });
    }
    const run = (label: string, command: string, argv: string[], env = toolEnv) =>
      options.run(`android-input-reader-${label}`, command, argv, env, 60000);
    await run('compile', path.join(options.javaHome, 'bin/javac'), [
      '--release',
      '8',
      '-classpath',
      androidJar,
      '-d',
      path.join(work, 'classes'),
      source,
    ]);
    const classes = path.join(work, 'classes.jar');
    await run('jar', path.join(options.javaHome, 'bin/jar'), [
      '--create',
      '--file',
      classes,
      '-C',
      path.join(work, 'classes'),
      '.',
    ]);
    await run('dex', path.join(tools, 'd8'), [
      '--lib',
      androidJar,
      '--min-api',
      '26',
      '--output',
      path.join(work, 'dex'),
      classes,
    ]);
    const unsigned = path.join(work, 'unsigned.apk');
    await run('manifest', path.join(tools, 'aapt2'), [
      'link',
      '-I',
      androidJar,
      '--manifest',
      manifest,
      '-o',
      unsigned,
    ]);
    await run('apk-dex', path.join(options.javaHome, 'bin/jar'), [
      '--update',
      '--file',
      unsigned,
      '-C',
      path.join(work, 'dex'),
      'classes.dex',
    ]);
    const aligned = path.join(work, 'aligned.apk'),
      binary = path.join(work, 'input-reader.apk');
    await run('align', path.join(tools, 'zipalign'), ['-f', '4', unsigned, aligned]);
    const key = path.join(work, 'disposable-signing.p12');
    const signer: NodeJS.ProcessEnv = {
      ...toolEnv,
      MYCHAMPIONS_QA_INPUT_SIGNER_PASS: randomBytes(24).toString('hex'),
    };
    try {
      await run(
        'key',
        path.join(options.javaHome, 'bin/keytool'),
        [
          '-genkeypair',
          '-keystore',
          key,
          '-storetype',
          'PKCS12',
          '-storepass:env',
          'MYCHAMPIONS_QA_INPUT_SIGNER_PASS',
          '-keypass:env',
          'MYCHAMPIONS_QA_INPUT_SIGNER_PASS',
          '-alias',
          'qa-input-reader',
          '-keyalg',
          'RSA',
          '-keysize',
          '2048',
          '-validity',
          '1',
          '-dname',
          'CN=Disposable QA input reader',
        ],
        signer,
      );
      await run(
        'sign',
        path.join(tools, 'apksigner'),
        [
          'sign',
          '--ks',
          key,
          '--ks-key-alias',
          'qa-input-reader',
          '--ks-pass',
          'env:MYCHAMPIONS_QA_INPUT_SIGNER_PASS',
          '--key-pass',
          'env:MYCHAMPIONS_QA_INPUT_SIGNER_PASS',
          '--out',
          binary,
          aligned,
        ],
        signer,
      );
    } finally {
      delete signer.MYCHAMPIONS_QA_INPUT_SIGNER_PASS;
      await rm(key, { force: true });
    }
    await chmod(binary, 0o600);
    await run('verify', path.join(tools, 'apksigner'), ['verify', binary]);
    const badging = await readFile(
      await run('badging', path.join(tools, 'aapt2'), ['dump', 'badging', binary]),
      'utf8',
    );
    requireAndroidInputReaderBadging(badging);
    const binaryHash = hash(await readFile(binary));
    await options.adb('android-input-reader-install', ['install', binary]);
    const installed = (
      await readFile(
        await options.adb('android-input-reader-package', [
          'shell',
          'pm',
          'path',
          androidInputReaderPackage,
        ]),
        'utf8',
      )
    ).trim();
    const installedPath = /^package:(\/data\/app\/[A-Za-z0-9_~+=/.-]+\/base\.apk)$/.exec(
      installed,
    )?.[1];
    assert(installedPath, 'Raw Android input reader installed path differs');
    const checksum = await readFile(
      await options.adb('android-input-reader-installed-hash', [
        'shell',
        'sha256sum',
        installedPath,
      ]),
      'utf8',
    );
    assert.equal(
      checksum.trim().split(/\s+/)[0],
      binaryHash,
      'Raw Android input reader installed bytes differ',
    );
    for (const input of sources)
      assert.equal(
        hash(await readFile(input.path)),
        input.sha256,
        'Raw input reader tool/source changed during build',
      );
    await writeFile(
      path.join(output, 'android-input-reader-identity.private.json'),
      JSON.stringify({
        kind: 'read-only auxiliary Android input reader identity',
        captureRunId,
        packageName: androidInputReaderPackage,
        sources,
        binaryPath: binary,
        binaryHash,
        installedPath,
        installedBinaryHash: binaryHash,
        disposableSigningKeyDeleted: true,
        setupElapsedMs: performance.now() - setupStarted,
      }),
      { flag: 'wx', mode: 0o600 },
    );
    return { binaryHash };
  };
  return async (label: string) => {
    request(captureRunId, label);
    options.signal.throwIfAborted();
    assert.equal(busy, false, 'Raw Android input readers cannot overlap');
    busy = true;
    try {
      buildPromise ??= build();
      const identity = await buildPromise;
      // Only the owned guest's test driver is stopped; app/runtime state is preserved.
      await options.adb(`android-input-reader-${label}-stop-maestro`, [
        'shell',
        'am',
        'force-stop',
        'dev.mobile.maestro',
      ]);
      const logPath = await options.adb(`android-input-reader-${label}-read`, [
        'shell',
        'am',
        'instrument',
        '-w',
        '-e',
        'captureRunId',
        captureRunId,
        '-e',
        'label',
        label,
        `${androidInputReaderPackage}/${androidInputReaderPackage}.InputReader`,
      ]);
      const observation = parseAndroidNativeInputObservation(
        await readFile(logPath, 'utf8'),
        captureRunId,
        label,
      );
      options.signal.throwIfAborted();
      await writeFile(
        path.join(options.artifactRoot, `${label}-native-input.private.json`),
        JSON.stringify({
          kind: 'private original Android raw input observation binding',
          observation,
          readerBinaryHash: identity.binaryHash,
          originalLogPath: path.basename(logPath),
        }),
        { flag: 'wx', mode: 0o600 },
      );
      return observation;
    } finally {
      busy = false;
    }
  };
}
