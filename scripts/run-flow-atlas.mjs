import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

import {
  prepareFlowAtlasArtifactRoot,
  resolveFlowAtlasArtifactRoot,
} from './flow-atlas-artifacts.mjs';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const runId = process.env.WEB_E2E_RUN_ID ?? `${timestamp}-${process.pid}-${randomUUID()}`;
const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';
let artifactRoot;

async function run(command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WEB_E2E_ARTIFACT_ROOT: artifactRoot,
      WEB_E2E_RUN_ID: runId,
    },
    stdio: 'inherit',
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    throw new Error(`${[command, ...args].join(' ')} exited with code ${exitCode}`);
  }
}

try {
  artifactRoot = resolveFlowAtlasArtifactRoot({ runId });
  // Preparation is awaited before either capture starts. A cleanup failure therefore
  // cannot fall through to Playwright and let stale evidence satisfy verification.
  await prepareFlowAtlasArtifactRoot(artifactRoot);
  await run(yarnCommand, ['playwright', 'test', '--config=playwright.flows-auth.config.ts']);
  await run(yarnCommand, ['playwright', 'test', '--config=playwright.flows.config.ts']);
  await run(process.execPath, [path.join(process.cwd(), 'scripts', 'verify-flow-atlas.mjs')]);
  console.log(`Verified flow-atlas artifacts: ${artifactRoot}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
