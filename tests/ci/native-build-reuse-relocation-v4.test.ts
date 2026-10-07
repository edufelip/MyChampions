import assert from 'node:assert/strict';
import {
  cp,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { treeHash } from '../../scripts/testing/native-build-identity';
import { loadReusableIosBuild } from '../../scripts/testing/native-build-reuse';

const RUN_ID = 'a'.repeat(24);
const SOURCE = { sha: 'a'.repeat(40), dirty: true, sourceTreeHash: 'b'.repeat(64) };
const BUNDLE_RELATIVE = 'ios-build/Build/Products/Debug-iphonesimulator/mychampions.app';

async function createRun(root: string): Promise<{
  run: string;
  bundle: string;
}> {
  const run = path.join(root, '.qa/artifacts/native-pilot', RUN_ID);
  const bundle = path.join(run, BUNDLE_RELATIVE);
  await mkdir(path.join(bundle, 'EXConstants.bundle'), { recursive: true, mode: 0o700 });
  const extra = {
    appVariant: 'dev',
    server: { baseUrl: 'http://127.0.0.1:50000' },
    e2e: {
      acceptedTermsVersion: '',
      authSession: '',
      createAccount: '',
      emailPasswordSignIn: '',
      socialAuth: '',
    },
  };
  await writeFile(path.join(bundle, 'EXConstants.bundle/app.config'), JSON.stringify({ extra }), {
    mode: 0o600,
  });
  await writeFile(path.join(run, 'bootstrap.private.log'), 'Bundled native entry', {
    mode: 0o600,
  });
  const binaryHash = await treeHash(bundle);
  const build = {
    bundleId: 'com.edufelip.mychampions.dev',
    binaryPath: bundle,
    binaryHash,
    profile: 'Metro-attached Debug; not bundled release qualification',
    apiOrigin: 'http://127.0.0.1:50000',
    metroOrigin: 'http://127.0.0.1:50001',
    environmentHash: 'c'.repeat(64),
  };
  await writeFile(
    path.join(run, 'capture.private.json'),
    JSON.stringify({
      result: 'observed',
      cleanup: 'cleaned',
      source: SOURCE,
      sourceAfter: SOURCE,
      build,
    }),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(run, 'entry-qualification.private.json'),
    JSON.stringify({
      result: 'qualified-entry-observation',
      sourceTreeHash: SOURCE.sourceTreeHash,
      binaryHash,
      cleanupVerified: true,
      screenshotReviewed: true,
    }),
    { mode: 0o600 },
  );
  return { run, bundle };
}

void test('the production reuse loader validates a copied run after protected restore', async () => {
  const sourceRoot = await fsTempRoot('mc-native-reuse-v4-source-');
  const destinationRoot = await fsTempRoot('mc-native-reuse-v4-destination-');
  try {
    const source = await createRun(sourceRoot);
    await cp(path.join(sourceRoot, '.qa'), path.join(destinationRoot, '.qa'), {
      recursive: true,
      force: false,
    });
    const destination = {
      run: path.join(destinationRoot, '.qa/artifacts/native-pilot', RUN_ID),
      bundle: path.join(destinationRoot, '.qa/artifacts/native-pilot', RUN_ID, BUNDLE_RELATIVE),
    };
    const restored = await loadReusableIosBuild(destinationRoot, RUN_ID, SOURCE, {
      sourceRoot,
    });
    assert.equal('sourceRoot' in restored, true);
    assert.equal('destinationRoot' in restored, true);
    if (!('sourceRoot' in restored) || !('destinationRoot' in restored))
      throw new Error('relocation loader did not return its source/destination binding');
    assert.equal(restored.binaryPath, destination.bundle);
    assert.equal(restored.sourceRoot, sourceRoot);
    assert.equal(restored.destinationRoot, destinationRoot);
    assert.equal(restored.binaryHash, await treeHash(source.bundle));
    await assert.rejects(
      loadReusableIosBuild(destinationRoot, RUN_ID, SOURCE, { sourceRoot: 'relative-cache-root' }),
      /absolute path/,
    );

    const capturePath = path.join(destination.run, 'capture.private.json');
    const capture = JSON.parse((await readFile(capturePath)).toString()) as {
      build: { binaryPath: string };
    };
    capture.build.binaryPath = path.join(sourceRoot, 'foreign.app');
    await writeFile(capturePath, JSON.stringify(capture), { mode: 0o600 });
    await assert.rejects(
      loadReusableIosBuild(destinationRoot, RUN_ID, SOURCE, { sourceRoot }),
      /relocation .*bytes changed/,
    );
    await rm(capturePath);
    await symlink(path.join(source.run, 'capture.private.json'), capturePath);
    await assert.rejects(
      loadReusableIosBuild(destinationRoot, RUN_ID, SOURCE, { sourceRoot }),
      /private owned file/,
    );
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(destinationRoot, { recursive: true, force: true });
  }
});

void test('relocation rejects a changed copied bundle rather than accepting source metadata', async () => {
  const sourceRoot = await fsTempRoot('mc-native-reuse-v4-source-');
  const destinationRoot = await fsTempRoot('mc-native-reuse-v4-destination-');
  try {
    await createRun(sourceRoot);
    await cp(path.join(sourceRoot, '.qa'), path.join(destinationRoot, '.qa'), {
      recursive: true,
      force: false,
    });
    const destinationBundle = path.join(
      destinationRoot,
      '.qa/artifacts/native-pilot',
      RUN_ID,
      BUNDLE_RELATIVE,
    );
    await writeFile(path.join(destinationBundle, 'unexpected'), 'changed', { mode: 0o600 });
    await assert.rejects(
      loadReusableIosBuild(destinationRoot, RUN_ID, SOURCE, { sourceRoot }),
      /bundle bytes changed/,
    );
  } finally {
    await rm(sourceRoot, { recursive: true, force: true });
    await rm(destinationRoot, { recursive: true, force: true });
  }
});

void test('all production loader callers and the helper ledger expose relocation freshness', async () => {
  const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const expectedCallers = [
    'scripts/testing/capture-native-testability.ts',
    'scripts/testing/native-view-evidence.ts',
    'scripts/testing/native-detox-connection-public-dispatch.ts',
    'scripts/testing/run-native-pilot.ts',
  ];
  for (const relative of expectedCallers) {
    const source = await readFile(path.join(candidateRoot, relative), 'utf8');
    assert.match(source, /loadReusableIosBuild/);
    assert.match(source, /sourceRoot:/);
  }
  const ledger = await readFile(
    path.join(candidateRoot, 'scripts/testing/native-session-helper-ledger.ts'),
    'utf8',
  );
  for (const relative of expectedCallers)
    assert.match(ledger, new RegExp(relative.replaceAll('/', '\\/')));
});

async function fsTempRoot(prefix: string): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
  await chmod(root, 0o700);
  return root;
}
