import assert from 'node:assert/strict';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { requireNativePilotAssertions, type NativePilotSelection } from './native-pilot-contract';

export type AndroidSessionPublicAssertion = {
  id: string;
  requirementRefs: string[];
  outcome: 'passed';
  evidencePaths: string[];
};

const apiPaths = ['transport-observations.private.json', 'native-auth-identities.private.json'];
const checkpointRoot = 'android-session-checkpoints';

/** Each Maestro observation is staged as its screenshot plus its parsed hierarchy. */
function frames(...labels: string[]): string[] {
  return labels.flatMap((label) => [`${label}.png`, `${label}-hierarchy.json`]);
}

async function checkpointFiles(stagedRoot: string): Promise<string[]> {
  const files: string[] = [];
  const walk = async (relative: string) => {
    for (const entry of await readdir(path.join(stagedRoot, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  await walk(checkpointRoot);
  return files.sort();
}

/**
 * Bind each declared session assertion to the staged evidence that proves it,
 * mirroring the iOS session mapping. The adapter already staged and verified
 * this copy; this only refuses an assertion whose evidence is not a regular
 * staged file.
 */
export async function androidSessionPublicAssertions(input: {
  outputRoot: string;
  captureRunId: string;
  selection: NativePilotSelection;
}): Promise<AndroidSessionPublicAssertion[]> {
  assert.match(input.captureRunId, /^[a-f0-9]{24}$/);
  const stagedRelativeRoot = `evidence/${input.captureRunId}`;
  const stagedRoot = path.join(input.outputRoot, stagedRelativeRoot);
  const sqlPaths = await checkpointFiles(stagedRoot);
  assert(sqlPaths.length > 0, 'Android session checkpoint evidence is absent');
  const pathsByAssertion: Record<string, string[]> = {
    'NAT-session-login': [...frames('entry', 'coach-home'), ...apiPaths],
    'NAT-session-restore': [...frames('auth-restored-home'), ...apiPaths],
    'NAT-session-account': frames('auth-account', 'auth-account-identity'),
    'NAT-session-signout': [
      ...frames('auth-signout-open', 'auth-signout-cancelled', 'auth-signout-reopen'),
      ...frames('auth-signed-out'),
      ...apiPaths,
    ],
    'NAT-session-signed-out-relaunch': [...frames('auth-signed-out-relaunch'), ...apiPaths],
    'NAT-session-unrelated-state': sqlPaths,
  };
  const assertions: AndroidSessionPublicAssertion[] = [];
  for (const row of requireNativePilotAssertions(input.selection)) {
    const evidencePaths = [...new Set(pathsByAssertion[row.id] ?? [])];
    assert(evidencePaths.length > 0, `Session assertion has no bound evidence: ${row.id}`);
    for (const relative of evidencePaths) {
      const stat = await lstat(path.join(stagedRoot, relative));
      assert(stat.isFile(), `Staged session evidence is not a regular file: ${relative}`);
    }
    assertions.push({
      id: row.id,
      requirementRefs: [...row.requirementRefs],
      outcome: 'passed',
      evidencePaths: evidencePaths.map((relative) => `${stagedRelativeRoot}/${relative}`),
    });
  }
  return assertions;
}
