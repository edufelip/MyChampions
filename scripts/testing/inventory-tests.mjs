import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { format, resolveConfig } from 'prettier';

const root = process.cwd();
const repos = [
  { name: 'client', root },
  { name: 'server', root: path.resolve(root, '../server') },
];
const inventoryPath = path.join(root, 'docs/qa/test-inventory-v1.json');
const check = process.argv.includes('--check');
const testPattern = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const policyPattern = /firebase|secret|release-contract|localization|locale.*contract|tests\/ci\//i;
const rows = [];
for (const repo of repos) {
  const files = [
    ...new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: repo.root,
        encoding: 'utf8',
      })
        .trim()
        .split('\n'),
    ),
  ]
    .filter(
      (file) =>
        testPattern.test(file) && !/^(?:\.qa|artifacts|test-results|node_modules)\//.test(file),
    )
    .sort();
  for (const file of files) {
    const text = readFileSync(path.join(repo.root, file), 'utf8');
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const cases = [];
    const assertions = [];
    const owners = new Set();
    function visit(node) {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        if (specifier.startsWith('.') || (repo.name === 'client' && specifier.startsWith('@/'))) {
          const stem = specifier.startsWith('@/')
            ? path.resolve(repo.root, specifier.slice(2))
            : path.resolve(repo.root, path.dirname(file), specifier);
          const owner = [
            stem,
            `${stem}.ts`,
            `${stem}.tsx`,
            `${stem}.js`,
            path.join(stem, 'index.ts'),
          ].find((candidate) => existsSync(candidate));
          if (owner) owners.add(path.relative(repo.root, owner));
        }
      }
      if (ts.isCallExpression(node)) {
        const expression = node.expression.getText(source);
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        if (
          (/^(?:it|test)(?:\.(?:only|skip|each))?$/.test(expression) ||
            (ts.isCallExpression(node.expression) &&
              /^(?:it|test)\.each$/.test(node.expression.expression.getText(source)))) &&
          node.arguments[0] &&
          ts.isStringLiteralLike(node.arguments[0])
        )
          cases.push({ purpose: node.arguments[0].text, line });
        if (/^(?:assert\.|expect\()/.test(expression))
          assertions.push({
            line,
            expression: node.getText(source).replace(/\s+/g, ' ').slice(0, 220),
          });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const match of text.matchAll(
      /['"`]((?:app|components|features|localization|scripts|config|\.github)\/[^'"`]+\.(?:tsx?|mjs|json|yml))['"`]/g,
    ))
      owners.add(match[1]);
    const sourceReading = /readFileSync|readFile\(|readSource|source\.slice/.test(text);
    const provider = /revenuecat.*(?:live|store)/i.test(file);
    const native = file.startsWith('e2e/') && file.includes('.e2e.test.');
    const browser = file.startsWith('e2e/') && !native;
    const db = repo.name === 'server' && file.startsWith('tests/postgres-');
    const component = repo.name === 'client' && file.startsWith('tests/component/');
    const categories = provider
      ? ['provider']
      : native
        ? ['native']
        : browser
          ? [file.includes('server') ? 'memory-http' : 'fixture-ui']
          : db
            ? ['postgres-integration']
            : component
              ? ['rendered-component']
              : sourceReading
                ? [
                    policyPattern.test(file)
                      ? 'architectural-prohibition'
                      : 'source-shape-coupling',
                    'logic-review-needed',
                  ]
                : ['logic'];
    const command = db
      ? 'bun run test:integration'
      : repo.name === 'server'
        ? 'bun run test:unit'
        : native
          ? 'yarn test:e2e:ios:debug / yarn test:e2e:android'
          : browser
            ? 'yarn test:e2e:web (see config/batch mapping)'
            : component
              ? 'yarn test:component'
              : 'yarn test:unit';
    rows.push({
      id: `TST-${createHash('sha256').update(`${repo.name}:${file}`).digest('hex').slice(0, 12)}`,
      repo: repo.name,
      path: file,
      contentHash: createHash('sha256').update(text).digest('hex'),
      command,
      ownerPaths: [...owners].sort(),
      requirementReferences: [
        ...new Set(text.match(/\b(?:FR|UC|AC|BR|TC|D|BL)-\d+(?:\.\d+)?[A-Z]?\b/g) ?? []),
      ].sort(),
      requirementStatus: /\b(?:FR|UC|AC|BR|TC)-\d+/.test(text)
        ? 'source-reference-needs-review'
        : 'unmapped-review-required',
      layers: categories,
      dataMode: db
        ? 'postgres'
        : browser
          ? file.includes('server')
            ? 'memory-http'
            : 'fixture'
          : native
            ? 'fixture-or-provider-review-required'
            : 'in-process',
      platforms: native ? ['ios', 'android'] : browser ? ['web'] : ['host'],
      selectors: [
        ...new Set(
          [...text.matchAll(/(?:by\.id|getByTestId)\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]),
        ),
      ],
      hazards: {
        sleeps: (text.match(/\bsleep\(|waitForTimeout\(|setTimeout\(/g) ?? []).length,
        coordinates: (text.match(/device\.tap\(|\.(?:tap|click)\(\{\s*[xy]:/g) ?? []).length,
        synchronizationBypasses: (text.match(/disableSynchronization\(/g) ?? []).length,
      },
      disposition: sourceReading ? (policyPattern.test(file) ? 'retain' : 'investigate') : 'retain',
      dispositionReason: sourceReading
        ? 'Assertion purposes below require review; retain policy assertions, replace UI/source-shape assertions only after passing behavioral evidence.'
        : 'Retain until overlapping coverage and execution evidence justify a change.',
      replacementIds: [],
      evidenceStatus: 'unverified',
      assertionPurposes: cases,
      assertions,
    });
  }
}
const previous = existsSync(inventoryPath) ? JSON.parse(readFileSync(inventoryPath, 'utf8')) : null;
for (const row of rows) {
  const old = previous?.tests.find((entry) => entry.id === row.id);
  if (old?.contentHash === row.contentHash)
    for (const key of ['disposition', 'dispositionReason', 'replacementIds', 'evidenceStatus'])
      row[key] = old[key];
}
const pilotScenarios = ['ios', 'android'].flatMap((platform) =>
  [
    { family: 'session', references: ['SC-217', 'SC-213', 'TC-296', 'BL-018/P4-session'] },
    { family: 'training', references: ['SC-208', 'TC-278', 'TC-303', 'BL-018/P4-training'] },
    { family: 'connection', references: ['FR-120', 'FR-121', 'TC-213', 'TC-214'] },
    { family: 'camera-denied', references: ['SC-211', 'UC-002.9', 'BL-018/P4-camera-denied'] },
    { family: 'save-retry', references: ['SC-208', 'TC-303', 'BL-018/P4-save-retry'] },
  ].map(({ family, references }) => ({
    id: `SCN-${family}-${platform}`,
    family,
    platform,
    requirementReferences: references,
    dataModes: ['fixture', 'integration'],
    status: 'unverified',
    blocker:
      'P4 native runtime/testability receipts pending; validate P1 fixture scope and branch-specific assertions from cited docs before authoring flow.',
  })),
);
const output = {
  schemaVersion: 1,
  method:
    'TypeScript AST test labels/assertion expressions plus source references. Unmapped or mixed assertions require review; this is not runtime coverage.',
  tests: rows,
  pilotScenarios,
};
const serialized = await format(`${JSON.stringify(output, null, 2)}\n`, {
  ...(await resolveConfig(inventoryPath)),
  filepath: inventoryPath,
});
if (check) {
  if (!previous || readFileSync(inventoryPath, 'utf8') !== serialized) {
    console.error('Test inventory is stale; run node scripts/testing/inventory-tests.mjs');
    process.exitCode = 1;
  }
} else writeFileSync(inventoryPath, serialized);
console.log(
  `Inventoried ${rows.length} test files (${rows.filter((r) => r.repo === 'client').length} client, ${rows.filter((r) => r.repo === 'server').length} server).`,
);
