import { rm, mkdir } from 'node:fs/promises';
import path from 'node:path';

export const flowAtlasArtifactBase = path.join(
  '.artifacts',
  'web-e2e',
  'complete-flow-atlas-verified',
);

export function resolveFlowAtlasArtifactRoot({
  cwd = process.cwd(),
  configuredRoot = process.env.WEB_E2E_ARTIFACT_ROOT,
  runId,
} = {}) {
  const artifactBase = path.resolve(cwd, flowAtlasArtifactBase);
  const artifactRoot = path.resolve(
    cwd,
    configuredRoot ?? path.join(flowAtlasArtifactBase, runId ?? ''),
  );
  const relativeRoot = path.relative(artifactBase, artifactRoot);

  if (
    relativeRoot.length === 0 ||
    relativeRoot.startsWith(`..${path.sep}`) ||
    relativeRoot === '..' ||
    path.isAbsolute(relativeRoot)
  ) {
    throw new Error(
      `Flow-atlas artifact root must be a per-run directory inside ${artifactBase}: ${artifactRoot}`,
    );
  }

  return artifactRoot;
}

export async function prepareFlowAtlasArtifactRoot(artifactRoot) {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
}
