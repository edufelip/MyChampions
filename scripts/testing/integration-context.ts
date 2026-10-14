import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  realpathSync,
  statSync,
  lstatSync,
} from 'node:fs';
import path from 'node:path';
import { requireIntegratedLoopbackOrigin } from './integration-preflight';
import {
  INTEGRATION_SCENARIOS,
  INTEGRATION_PROJECTS,
  integrationAttemptId,
  integrationFixtureScope,
} from './integration-registry';
import { assertTestingDocument } from './schema-validation';
import type { IntegrationProject } from './integration-registry';

export type IntegrationCase = {
  scenarioId: string;
  project: IntegrationProject;
  attemptId: string;
  fixtureScope: string;
  fixtureRef: string;
  fixtureHash: string;
  controlToken: string;
  scenarioHash: string;
  requirementHash: string;
};
export type IntegrationContext = {
  schemaVersion: 1;
  runId: string;
  clientRoot: string;
  serverRoot: string;
  artifactRoot: string;
  appOrigin: string;
  apiOrigin: string;
  parentPid: number;
  parentStarted: string;
  flagsHash: string;
  control: { root: string; socket: string } | null;
  cases: IntegrationCase[];
};
function readPrivateFile(file: string): Buffer {
  if (!path.isAbsolute(file) || realpathSync(file) !== file)
    throw new Error('Integration private file path is not canonical');
  const handle = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(handle);
    if (
      !metadata.isFile() ||
      (metadata.mode & 0o777) !== 0o600 ||
      (process.getuid && metadata.uid !== process.getuid()) ||
      metadata.size > 1_048_576
    )
      throw new Error('Integration file must be private');
    return readFileSync(handle);
  } finally {
    closeSync(handle);
  }
}
export function loadIntegrationContext(
  file = process.env.MC_WEB_INTEGRATION_CONTEXT,
): IntegrationContext {
  if (
    !file ||
    !path.isAbsolute(file) ||
    path.basename(file) !== 'integration-context.private.json' ||
    realpathSync(file) !== file
  )
    throw new Error('Integration requires an owned private context');
  const value: unknown = JSON.parse(readPrivateFile(file).toString('utf8'));
  assertTestingDocument('integration-context-v1', value);
  const context = value as IntegrationContext;
  requireIntegratedLoopbackOrigin(context.appOrigin);
  requireIntegratedLoopbackOrigin(context.apiOrigin);
  if (
    context.appOrigin === context.apiOrigin ||
    realpathSync(context.clientRoot) !== context.clientRoot ||
    realpathSync(context.serverRoot) !== context.serverRoot ||
    realpathSync(context.artifactRoot) !== context.artifactRoot ||
    !context.artifactRoot.startsWith(path.join(context.clientRoot, '.qa/artifacts') + path.sep) ||
    file !== path.join(context.artifactRoot, 'integration-context.private.json') ||
    (statSync(context.artifactRoot).mode & 0o777) !== 0o700
  )
    throw new Error('Integration context root or origin mismatch');
  if (
    execFileSync('ps', ['-p', String(context.parentPid), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim() !== context.parentStarted
  )
    throw new Error('Integration context parent identity changed');
  const listeners = execFileSync(
    'lsof',
    ['-nP', `-iTCP:${new URL(context.apiOrigin).port}`, '-sTCP:LISTEN', '-t'],
    { encoding: 'utf8', timeout: 5000 },
  )
    .trim()
    .split(/\s+/)
    .map(Number);
  if (!listeners.length || listeners.some((pid) => pid !== context.parentPid))
    throw new Error('Integration proxy listener is not owned by the parent');
  if (
    !context.control ||
    realpathSync(context.control.root) !== context.control.root ||
    path.dirname(context.control.root) !== realpathSync('/tmp') ||
    !path.basename(context.control.root).startsWith(`mc-web-control-${context.runId}-`) ||
    context.control.socket !== path.join(context.control.root, 'control.sock')
  )
    throw new Error('Integration worker control identity mismatch');
  for (const [file, directory] of [
    [context.control.root, true],
    [context.control.socket, false],
  ] as const) {
    const metadata = lstatSync(file);
    if (
      (directory ? !metadata.isDirectory() : !metadata.isSocket()) ||
      (metadata.mode & 0o777) !== (directory ? 0o700 : 0o600) ||
      (process.getuid && metadata.uid !== process.getuid())
    )
      throw new Error('Integration worker control is not private');
  }
  if (new Set(context.cases.map((row) => row.attemptId)).size !== context.cases.length)
    throw new Error('Duplicate integration attempt');
  for (const row of context.cases) {
    const scenario = INTEGRATION_SCENARIOS.find((scenario) => scenario.id === row.scenarioId);
    if (
      !scenario?.implemented ||
      !Object.hasOwn(INTEGRATION_PROJECTS, row.project) ||
      row.attemptId !== integrationAttemptId(row.scenarioId, row.project) ||
      row.fixtureScope !== integrationFixtureScope(row.scenarioId, row.project) ||
      row.fixtureRef !==
        path.join(
          context.serverRoot,
          '.qa/runtime',
          context.runId,
          `fixtures-${row.fixtureScope}.private.json`,
        ) ||
      createHash('sha256').update(readPrivateFile(row.fixtureRef)).digest('hex') !== row.fixtureHash
    )
      throw new Error('Integration case identity or fixture fingerprint mismatch');
  }
  return context;
}
