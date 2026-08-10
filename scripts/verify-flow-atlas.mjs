import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveFlowAtlasArtifactRoot } from './flow-atlas-artifacts.mjs';
import { flowAtlasManifest, flowAtlasPlatforms } from './flow-atlas-manifest.mjs';

if (!process.env.WEB_E2E_ARTIFACT_ROOT) {
  throw new Error(
    'WEB_E2E_ARTIFACT_ROOT is required; run yarn test:e2e:web:flow-atlas to verify a fresh capture',
  );
}

const artifactRoot = resolveFlowAtlasArtifactRoot();
const screenshotRoot = path.join(artifactRoot, 'screenshots');
const failures = [];
const inventory = [];

async function listPngs(directory) {
  try {
    return (await readdir(directory)).filter((name) => name.endsWith('.png')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

for (const flow of flowAtlasManifest) {
  for (const platform of flowAtlasPlatforms) {
    const directory = path.join(screenshotRoot, flow.id, platform);
    const screenshots = await listPngs(directory);
    const expectedScreenshots = flow.checkpoints.map((checkpoint) => `${checkpoint}.png`).sort();
    const missingScreenshots = expectedScreenshots.filter((name) => !screenshots.includes(name));
    const unexpectedScreenshots = screenshots.filter((name) => !expectedScreenshots.includes(name));
    inventory.push({
      flow: flow.id,
      platform,
      expected: flow.checkpointCount,
      actual: screenshots.length,
      screenshots,
      expectedScreenshots,
      missingScreenshots,
      unexpectedScreenshots,
      useCases: flow.useCases,
      screens: flow.screens,
    });
    if (missingScreenshots.length > 0 || unexpectedScreenshots.length > 0) {
      failures.push(
        `${flow.id}/${platform}: missing [${missingScreenshots.join(', ')}], unexpected [${unexpectedScreenshots.join(', ')}]`,
      );
    }
  }
}

const expectedTotal = flowAtlasManifest.reduce(
  (total, flow) => total + flow.checkpointCount * flowAtlasPlatforms.length,
  0,
);
const actualTotal = inventory.reduce((total, row) => total + row.actual, 0);
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: failures.length === 0 && actualTotal === expectedTotal ? 'complete' : 'incomplete',
  expectedTotal,
  actualTotal,
  flowCount: flowAtlasManifest.length,
  platforms: flowAtlasPlatforms,
  failures,
  inventory,
};

await mkdir(artifactRoot, { recursive: true });
await writeFile(
  path.join(artifactRoot, 'flow-coverage.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);

const rows = inventory
  .map((row) => `| ${row.flow} | ${row.platform} | ${row.actual}/${row.expected} | Pending | |`)
  .join('\n');
const checklist = `# Complete flow atlas manual validation

## Coverage

- Status: **${summary.status}**
- Flows: ${summary.flowCount}
- Platforms per flow: ${flowAtlasPlatforms.join(', ')}
- Screenshots: ${actualTotal}/${expectedTotal}
- Generated: ${summary.generatedAt}

## Reviewer decision

- Reviewer:
- Review date:
- Result: Pending / Accepted / Rejected
- Browser and OS used for review:

## Flow review

| Flow | Platform | Screenshots | Review | Notes |
|---|---|---:|---|---|
${rows}

## Required checks

- [ ] Every screenshot matches its checkpoint and contains no loading/error state unless named.
- [ ] No content clips, overlaps, or creates horizontal overflow.
- [ ] Mobile uses bottom navigation; tablet uses the compact rail; web uses the labeled sidebar.
- [ ] Sensitive credentials, tokens, personal health data, and production identifiers are absent.
- [ ] Dialogs, write locks, provider fallbacks, and entitlement states are understandable.
- [ ] Rejected rows include a reproducible issue reference.
`;
await writeFile(path.join(artifactRoot, 'manual-validation.md'), checklist, 'utf8');

if (failures.length > 0 || actualTotal !== expectedTotal) {
  console.error(`Flow atlas incomplete: ${actualTotal}/${expectedTotal} screenshots.`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Flow atlas complete: ${actualTotal}/${expectedTotal} screenshots.`);
}
