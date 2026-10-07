import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
  link,
} from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const compositionRoot = path.resolve(process.env.V13_COMPOSITION_ROOT ?? process.cwd());
const runnerPath = path.join(compositionRoot, 'scripts/testing/run-native-pilot.ts');
const evidencePath = path.join(compositionRoot, 'scripts/testing/detox-connection-evidence.ts');

async function source(file: string): Promise<string> {
  return readFile(file, 'utf8');
}

function publicationCall(sourceText: string, marker: string): string {
  const markerIndex = sourceText.indexOf(marker);
  assert(markerIndex >= 0, `publication marker is missing: ${marker}`);
  const callStart = sourceText.lastIndexOf('writeNativePilotPrivateFile({', markerIndex);
  assert(callStart >= 0, `publication call is missing: ${marker}`);
  const callEnd = sourceText.indexOf('\n', markerIndex);
  const closingCall = sourceText.slice(callEnd).match(/\n\s*\}\);/u);
  assert(closingCall?.index !== undefined, `publication call terminator is missing: ${marker}`);
  const end = callEnd + closingCall.index;
  return sourceText.slice(callStart, end);
}

void test('Android session staging and terminal aliases carry the original whole-run lifecycle', async () => {
  const text = await source(runnerPath);
  for (const marker of [
    "relative: 'detox-android-session-staging-link.private.json'",
    'relative: androidDetoxSessionVerifiedTerminalEvidenceName',
  ]) {
    const call = publicationCall(text, marker);
    assert.match(call, /signal: controller\.signal/);
    assert.match(call, /deadlineAtMonotonicMs: runStarted \+ deadlines\.wholeRunMs/);
  }
  const aliasStart = text.indexOf('for (const relative of terminalAliases)');
  assert(aliasStart >= 0, 'Android terminal alias loop is missing');
  const aliasCall = text.slice(aliasStart, text.indexOf('\n      } else if', aliasStart));
  assert.match(aliasCall, /writeNativePilotPrivateFile\(\{/);
  assert.match(aliasCall, /signal: controller\.signal/);
  assert.match(aliasCall, /deadlineAtMonotonicMs: runStarted \+ deadlines\.wholeRunMs/);
  assert.equal(
    (text.match(/relative: ["']detox-android-session-staging-link\.private\.json["']/g) ?? [])
      .length,
    1,
  );
});

void test('protected inventory selects the descriptor reader with the original absolute deadline', async () => {
  const text = await source(runnerPath);
  assert.match(
    text,
    /import \{ readDetoxConnectionPath \} from ["']\.\/detox-connection-evidence["'];/,
  );
  const start = text.indexOf('async function readProtectedInventory(');
  const end = text.indexOf('\ntype NativePilotAttempt', start);
  assert(start >= 0 && end > start, 'protected inventory helper is missing');
  const helper = text.slice(start, end);
  assert.match(helper, /readDetoxConnectionPath\(file, 16 \* 1024 \* 1024/);
  assert.match(helper, /deadlineAt: lifecycle\.deadlineAtMs/);
  assert.doesNotMatch(helper, /readFile\(file\)/);
  assert.doesNotMatch(helper, /lstat\(file\)/);
});

void test('V15 actual inventory helper rejects before, at, and after parse expiry and aborts', async () => {
  Reflect.set(process.env, 'NODE_ENV', 'test');
  const runner = (await import(pathToFileURL(runnerPath).href)) as {
    readProtectedInventory: (
      root: string,
      lifecycle: {
        signal?: AbortSignal;
        deadlineAtMs: number;
        fixtureNow?: () => number;
      },
    ) => Promise<unknown>;
  };
  assert.equal(typeof runner.readProtectedInventory, 'function');

  const root = await realpath(await mkdtemp(path.join('/tmp', 'android-session-v15-helper-')));
  try {
    await mkdir(path.join(root, 'docs/qa/native-pilot'), { recursive: true });
    await writeFile(
      path.join(root, 'docs/qa/native-pilot/inventory.json'),
      JSON.stringify({ schemaVersion: '1.0', scenarios: [] }) + '\n',
      { mode: 0o600 },
    );
    const deadlineAtMs = performance.now() + 5_000;
    const parsed = await runner.readProtectedInventory(root, {
      deadlineAtMs,
      fixtureNow: () => deadlineAtMs - 1,
    });
    assert.deepEqual(parsed, { schemaVersion: '1.0', scenarios: [] });

    await assert.rejects(
      runner.readProtectedInventory(root, {
        deadlineAtMs,
        fixtureNow: () => deadlineAtMs,
      }),
      /parse exceeded the original deadline/,
    );
    await assert.rejects(
      runner.readProtectedInventory(root, {
        deadlineAtMs,
        fixtureNow: () => deadlineAtMs + 1,
      }),
      /parse exceeded the original deadline/,
    );

    const controller = new AbortController();
    controller.abort(new Error('v15 helper cancelled'));
    await assert.rejects(
      runner.readProtectedInventory(root, {
        signal: controller.signal,
        deadlineAtMs,
        fixtureNow: () => deadlineAtMs - 1,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('V14 generic private publications retain the original absolute deadline', async () => {
  const text = await source(runnerPath);
  const publications = [
    {
      marker: "relative: 'attempt-identity.private.json'",
      deadline: 'deadlineAtMonotonicMs: preflight.deadlineAtMs',
    },
    {
      marker: "relative: 'execution-deadlines.private.json'",
      deadline: 'deadlineAtMonotonicMs: preflight.deadlineAtMs',
    },
    {
      marker: "relative: 'cold-reset-handoff.private.json'",
      deadline: 'deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs',
    },
    {
      marker: "relative: 'detox-staging-link.private.json'",
      deadline: 'deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs',
    },
  ] as const;
  for (const publication of publications) {
    const call = publicationCall(text, publication.marker);
    assert.match(call, /signal: (?:preflight\.)?controller\.signal/);
    assert.match(call, new RegExp(publication.deadline.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal((text.match(/deadlineAtMonotonicMs: preflight\.deadlineAtMs/g) ?? []).length, 2);
  assert.equal(
    (text.match(/deadlineAtMonotonicMs: runStarted \+ deadlines\.wholeRunMs/g) ?? []).length >= 2,
    true,
  );
});

void test('descriptor inventory reads reject expiry, cancellation, symlink and hardlink substitution', async () => {
  const module = (await import(pathToFileURL(evidencePath).href)) as {
    readDetoxConnectionPath: (
      file: string,
      maxBytes: number,
      options?: { signal?: AbortSignal; deadlineAt?: number },
    ) => Promise<{ bytes: Buffer; metadata: { nlink: number } }>;
  };
  const root = await realpath(await mkdtemp(path.join('/tmp', 'android-session-v13-reader-')));
  try {
    await chmod(root, 0o700);
    const file = path.join(root, 'inventory.json');
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, scenarios: [] }) + '\n');
    await writeFile(file, bytes, { mode: 0o600 });
    const read = await module.readDetoxConnectionPath(file, 16 * 1024 * 1024, {
      deadlineAt: performance.now() + 5_000,
    });
    assert.deepEqual(read.bytes, bytes);
    assert.equal(read.metadata.nlink, 1);

    await assert.rejects(
      module.readDetoxConnectionPath(file, 16 * 1024 * 1024, {
        deadlineAt: performance.now() - 1,
      }),
      /deadline elapsed/,
    );

    const controller = new AbortController();
    controller.abort(new Error('v13 reader cancelled'));
    await assert.rejects(
      module.readDetoxConnectionPath(file, 16 * 1024 * 1024, {
        signal: controller.signal,
        deadlineAt: performance.now() + 5_000,
      }),
      /cancelled/,
    );

    const symlinkPath = path.join(root, 'inventory-symlink.json');
    await symlink(file, symlinkPath);
    await assert.rejects(
      module.readDetoxConnectionPath(symlinkPath, 16 * 1024 * 1024, {
        deadlineAt: performance.now() + 5_000,
      }),
      /owned bounded immutable|canonical|no-follow/,
    );

    const hardlinkPath = path.join(root, 'inventory-hardlink.json');
    await link(file, hardlinkPath);
    await assert.rejects(
      module.readDetoxConnectionPath(file, 16 * 1024 * 1024, {
        deadlineAt: performance.now() + 5_000,
      }),
      /owned bounded immutable|identity changed/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
