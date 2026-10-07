import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';

const root = path.resolve(__dirname, '../..');
const inventoryPath = path.join(root, 'docs/qa/native-pilot/inventory.json');
const stableContractPath = 'docs/qa/native-pilot/declaration-contract.md';
const operationalLedgerPath = 'docs/qa/native-pilot/testability.md';
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

const args = {
  platform: 'ios' as const,
  engine: 'maestro' as const,
  scenario: 'SCN-session-ios',
  mode: 'integration' as const,
};

type DeclaredFileGroup = {
  paths?: string[];
  ownerPaths?: string[];
  freshnessInputs?: { ownerPaths?: string[]; requirementPaths?: string[] };
  maestroFlow?: string;
};
type Declaration = {
  sources: { id: string; paths: string[]; revision: string }[];
  views: DeclaredFileGroup[];
  transitions: DeclaredFileGroup[];
  flows: DeclaredFileGroup[];
  scenarios: DeclaredFileGroup[];
};

async function copyDeclaredFiles(declaration: Declaration, destination: string) {
  const relativePaths = new Set<string>([operationalLedgerPath]);
  for (const source of declaration.sources)
    for (const file of source.paths) relativePaths.add(file);
  for (const group of [
    ...declaration.views,
    ...declaration.transitions,
    ...declaration.flows,
    ...declaration.scenarios,
  ]) {
    for (const file of group.paths ?? []) relativePaths.add(file);
    for (const file of group.ownerPaths ?? []) relativePaths.add(file);
    for (const file of group.freshnessInputs?.ownerPaths ?? []) relativePaths.add(file);
    for (const file of group.freshnessInputs?.requirementPaths ?? []) relativePaths.add(file);
    if (group.maestroFlow) relativePaths.add(group.maestroFlow);
  }
  for (const relative of relativePaths) {
    assert.equal(path.isAbsolute(relative), false, `declared path must be relative: ${relative}`);
    const source = path.join(root, relative);
    const metadata = await lstat(source);
    assert.equal(
      metadata.isSymbolicLink(),
      false,
      `declared path must not be a symlink: ${relative}`,
    );
    assert.equal(metadata.isFile(), true, `declared path must be a file: ${relative}`);
    const target = path.join(destination, relative);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, await readFile(source), { flag: 'wx', mode: 0o600 });
  }
}

void test('stable contract edits reject while an actual operational status edit remains selectable', async () => {
  assert.ok(existsSync(inventoryPath), 'regenerated native declaration is required');
  assert.ok(existsSync(path.join(root, stableContractPath)), 'stable contract is required');
  const declaration = JSON.parse(await readFile(inventoryPath, 'utf8')) as Declaration;
  const stableSource = declaration.sources.find((source) =>
    source.paths.includes(stableContractPath),
  );
  assert.ok(stableSource, 'stable declaration contract must be a declared source');
  assert.equal(
    declaration.sources.some((source) => source.paths.includes(operationalLedgerPath)),
    false,
    'mutable operational status ledger must not be a declaration source',
  );
  const stableBytes = await readFile(path.join(root, stableContractPath));
  assert.equal(hash(stableBytes), stableSource.revision);
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'mc-native-contract-fixture-'));
  try {
    await copyDeclaredFiles(declaration, fixtureRoot);
    const before = await selectNativePilotScenario(args, declaration, fixtureRoot);

    const statusFile = path.join(fixtureRoot, operationalLedgerPath);
    await writeFile(statusFile, `${await readFile(statusFile, 'utf8')}\nstatus-only edit\n`, {
      mode: 0o600,
    });
    const afterStatus = await selectNativePilotScenario(args, declaration, fixtureRoot);
    assert.equal(afterStatus.scenarioHash, before.scenarioHash);
    assert.equal(afterStatus.requirementHash, before.requirementHash);

    const contractFile = path.join(fixtureRoot, stableContractPath);
    await writeFile(contractFile, Buffer.concat([stableBytes, Buffer.from('\ncontract edit\n')]), {
      mode: 0o600,
    });
    await assert.rejects(
      selectNativePilotScenario(args, declaration, fixtureRoot),
      /stale governing inputs/,
      'a changed stable contract at the same declared path must block selection',
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
