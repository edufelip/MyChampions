import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import type tsTypes from 'typescript';

const ts = createRequire(path.resolve(process.cwd(), 'package.json'))(
  'typescript',
) as typeof tsTypes;
const ownerPath =
  process.env.IOS_OWNER_SOURCE ??
  path.resolve(process.cwd(), 'scripts/testing/native-detox-camera-ios-current-owner.ts');

async function sourceTree() {
  return ts.createSourceFile(
    ownerPath,
    await readFile(ownerPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
}

function evaluate<T>(text: string, globals: Record<string, unknown>): T {
  const js = ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return vm.runInNewContext(js, globals) as T;
}

void test('actual camera snapshot projection preserves exact primary/isolation scopes and rejects wrong run or scope', async () => {
  const source = await sourceTree();
  const declaration = source.statements.find(
    (node): node is tsTypes.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'snapshotProjection',
  );
  assert.ok(declaration);
  const project = evaluate<
    (
      value: Record<string, unknown>,
      receipt: Record<string, unknown>,
      phase: string,
      owner: Record<string, unknown>,
      scope: string,
    ) => Record<string, unknown>
  >(`${declaration.getText(source)}\nsnapshotProjection;`, {
    hashJson: (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  });
  const owner = { runId: 'owned-run', backend: { apiOrigin: 'http://127.0.0.1:63312' } };
  const receipt = {
    path: '/private/snapshot',
    sha256: 'a'.repeat(64),
    sizeBytes: 100,
    mode: 0o600,
  };
  for (const scope of ['native-entry-ios', 'native-connection-isolation-ios']) {
    const value = {
      kind: 'connection-snapshot-v1',
      readOnly: true,
      runId: 'owned-run',
      scope,
      rows: { connections: [] },
    };
    const result = project(value, receipt, 'before', owner, scope);
    assert.equal(result.scope, scope);
    assert.equal(result.runId, 'owned-run');
    assert.equal(result.apiOrigin, owner.backend.apiOrigin);
    assert.throws(
      () => project({ ...value, runId: 'foreign-run' }, receipt, 'before', owner, scope),
      /snapshot identity/,
    );
    assert.throws(
      () => project({ ...value, scope: 'foreign-scope' }, receipt, 'before', owner, scope),
      /snapshot identity/,
    );
    assert.throws(
      () => project({ ...value, readOnly: false }, receipt, 'before', owner, scope),
      /snapshot identity/,
    );
  }
});

void test('actual proxy cleanup callback respects its cap, shorter original remainder, and cancellation', async () => {
  const source = await sourceTree();
  let operation: tsTypes.ArrowFunction | undefined;
  const visit = (node: tsTypes.Node) => {
    if (
      ts.isObjectLiteralExpression(node) &&
      node.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText(source) === 'label' &&
          ts.isStringLiteral(property.initializer) &&
          property.initializer.text === 'proxy-quiescence',
      )
    ) {
      const property = node.properties.find(
        (row): row is tsTypes.PropertyAssignment =>
          ts.isPropertyAssignment(row) && row.name.getText(source) === 'operation',
      );
      if (property && ts.isArrowFunction(property.initializer)) operation = property.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(operation);
  const observations: { budget: number; signal: AbortSignal }[] = [];
  const wait = evaluate<(remaining: number, signal: AbortSignal) => Promise<void>>(
    `(${operation.getText(source)});`,
    {
      acquiredProxy: {
        waitForQuiescence: async (budget: number, signal: AbortSignal) => {
          await Promise.resolve();
          signal.throwIfAborted();
          assert.ok(Number.isSafeInteger(budget) && budget > 0 && budget <= 30_000);
          observations.push({ budget, signal });
        },
      },
    },
  );
  const controller = new AbortController();
  await wait(1_800_000, controller.signal);
  await wait(749.9, controller.signal);
  assert.deepEqual(
    observations.map((row) => row.budget),
    [30_000, 749],
  );
  assert.ok(observations.every((row) => row.signal === controller.signal));
  assert.throws(() => wait(0.9, controller.signal), /deadline elapsed/);
  assert.equal(observations.length, 2);
  const reason = new Error('original cleanup cancelled');
  controller.abort(reason);
  assert.throws(
    () => wait(10_000, controller.signal),
    (error) => error === reason,
  );
  assert.equal(observations.length, 2);
});

void test('actual fixture preparation seeds independent scopes and keeps credential bodies in private writes', async () => {
  const source = await sourceTree();
  let seedStatements: readonly tsTypes.Statement[] | undefined;
  const visit = (node: tsTypes.Node) => {
    if (
      ts.isVariableStatement(node) &&
      node.getText(source).includes("session!.fixtures('native-entry-ios')") &&
      ts.isBlock(node.parent)
    ) {
      const statements = node.parent.statements;
      const start = statements.indexOf(node);
      const end = statements.findIndex(
        (statement, index) =>
          index > start &&
          ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some(
            (declaration) =>
              ts.isIdentifier(declaration.name) && declaration.name.text === 'fixtureAuthUids',
          ),
      );
      assert.ok(end > start);
      seedStatements = statements.slice(start, end);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(seedStatements);
  const code = `(async () => { let fixtureEvidence, connectionIsolationFixtureEvidence; ${seedStatements.map((statement) => statement.getText(source)).join('\n')} return {fixtureEvidence, connectionIsolationFixtureEvidence}; })();`;
  const names = [
    'new',
    'student',
    'coach',
    'unrelated-student',
    'unrelated-coach',
    'pending-student',
    'active-student',
  ];
  const makeFixture = (scope: string) => ({
    runId: 'owned-run',
    scope,
    accounts: Object.fromEntries(
      names.map((name) => [
        name,
        {
          authUid: `${scope}-${name}`,
          email: `${name}@example.test`,
          password: 'PRIVATE-CREDENTIAL-CANARY',
          role: name === 'new' ? null : name.includes('coach') ? 'professional' : 'student',
        },
      ]),
    ),
  });
  const run = async (change?: (fixtures: ReturnType<typeof makeFixture>[]) => void) => {
    const fixtures = [
      makeFixture('native-entry-ios'),
      makeFixture('native-connection-isolation-ios'),
    ];
    change?.(fixtures);
    const writes: { name: string; bytes: Buffer }[] = [];
    const calls: string[] = [];
    const controller = new AbortController();
    const globals = {
      Buffer,
      options: {
        artifactRoot: '/private/owned-camera',
        signal: controller.signal,
        deadlineAtMonotonicMs: 12345,
      },
      validateResource: async (_resource: string, operation: () => Promise<unknown>) => operation(),
      session: {
        manifest: { runId: 'owned-run' },
        fixtures: async (scope: string) => {
          await Promise.resolve();
          calls.push(scope);
          return fixtures[scope === 'native-entry-ios' ? 0 : 1];
        },
        probeApiLifetime: async () => {
          await Promise.resolve();
          calls.push('probe');
          return { runId: 'owned-run', backendAttemptId: 'original-api-attempt' };
        },
      },
      writeOwnedExclusive: async (
        root: string,
        name: string,
        bytes: Buffer,
        lifecycle: { signal: AbortSignal; deadlineAtMonotonicMs: number },
      ) => {
        await Promise.resolve();
        assert.equal(root, '/private/owned-camera');
        assert.equal(lifecycle.signal, controller.signal);
        assert.equal(lifecycle.deadlineAtMonotonicMs, 12345);
        writes.push({ name, bytes });
        return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      },
    };
    const result = await evaluate<Promise<Record<string, unknown>>>(code, globals);
    assert.deepEqual(calls, ['native-entry-ios', 'native-connection-isolation-ios', 'probe']);
    assert.deepEqual(
      writes.map((write) => write.name),
      ['fixtures.private.json', 'fixtures-native-connection-isolation-ios.private.json'],
    );
    assert.ok(writes.every((write) => write.bytes.includes('PRIVATE-CREDENTIAL-CANARY')));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-CREDENTIAL-CANARY|password|@example/);
    return result;
  };
  await run();
  await assert.rejects(
    run((fixtures) => {
      fixtures[1].runId = 'foreign-run';
    }),
    /fixture identity/,
  );
  await assert.rejects(
    run((fixtures) => {
      fixtures[0].scope = 'foreign-scope';
    }),
    /fixture identity/,
  );
  await assert.rejects(
    run((fixtures) => {
      fixtures[0].accounts.student.role = 'professional';
    }),
    /fixture identity/,
  );
  await assert.rejects(
    run((fixtures) => {
      fixtures[1].accounts.student.role = 'professional';
    }),
    /fixture identity/,
  );
  await assert.rejects(
    run((fixtures) => {
      fixtures[1].accounts.student.authUid = fixtures[0].accounts.student.authUid;
    }),
    /fixture identity/,
  );
  await assert.rejects(
    run((fixtures) => {
      fixtures[0].accounts.coach.authUid = fixtures[0].accounts.student.authUid;
    }),
    /fixture identity/,
  );
});
