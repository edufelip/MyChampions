import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const batches = {
  smoke: ['--grep', '@smoke', '--project=chromium'],
  functional: ['--grep', '@functional'],
  accessibility: ['--grep', '@accessibility'],
  'critical-paths': ['--grep', '@critical'],
  evidence: ['--grep', '@evidence', '--project=chromium'],
  server: ['--config=playwright.server.config.ts'],
  full: [],
};

const batch = process.argv[2] ?? 'full';
const extraArgs = process.argv.slice(3);

if (!(batch in batches)) {
  console.error(`Unknown web E2E batch: ${batch}`);
  console.error(`Expected one of: ${Object.keys(batches).join(', ')}`);
  process.exit(2);
}

const now = new Date();
const timestamp = now
  .toISOString()
  .replace(/\.\d{3}Z$/, 'Z')
  .replace(/[:]/g, '-');
const runId = process.env.WEB_E2E_RUN_ID ?? `${timestamp}-${batch}`;
const artifactRoot = path.resolve(
  process.env.WEB_E2E_ARTIFACT_ROOT ?? path.join('.artifacts', 'web-e2e', runId),
);
const playwrightArgs = ['playwright', 'test', ...batches[batch], ...extraArgs];
const command = ['yarn', ...playwrightArgs].join(' ');
const gitSha = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const gitStatus = spawnSync('git', ['status', '--short'], { encoding: 'utf8' }).stdout.trim();

await mkdir(artifactRoot, { recursive: true });

const metadata = {
  schemaVersion: 1,
  runId,
  batch,
  startedAt: now.toISOString(),
  completedAt: null,
  status: 'running',
  command,
  artifactRoot,
  git: {
    sha: gitSha || null,
    dirty: Boolean(gitStatus),
  },
};

await writeFile(
  path.join(artifactRoot, 'run-metadata.json'),
  `${JSON.stringify(metadata, null, 2)}\n`,
  'utf8',
);

const child = spawn(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', playwrightArgs, {
  cwd: process.cwd(),
  env: {
    ...process.env,
    WEB_E2E_ARTIFACT_ROOT: artifactRoot,
    WEB_E2E_BATCH: batch,
  },
  stdio: 'inherit',
});

const exitCode = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', (code) => resolve(code ?? 1));
});

async function collectPngs(directory) {
  const paths = [];
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) paths.push(...(await collectPngs(entryPath)));
      if (entry.isFile() && entry.name.endsWith('.png')) paths.push(entryPath);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return paths.sort();
}

const completedAt = new Date().toISOString();
const screenshots = await collectPngs(path.join(artifactRoot, 'screenshots'));
metadata.completedAt = completedAt;
metadata.status = exitCode === 0 ? 'passed' : 'failed';
metadata.exitCode = exitCode;
metadata.screenshotCount = screenshots.length;

await writeFile(
  path.join(artifactRoot, 'run-metadata.json'),
  `${JSON.stringify(metadata, null, 2)}\n`,
  'utf8',
);

const screenshotRows = screenshots.length
  ? screenshots
      .map((screenshotPath) => {
        const relativePath = path.relative(artifactRoot, screenshotPath);
        return `| \`${relativePath}\` | Pending | Pending | |`;
      })
      .join('\n')
  : '| No explicit evidence screenshots in this batch | N/A | N/A | |';

const manualReview = `# Web E2E manual validation\n\n## Run\n\n- Run ID: \`${runId}\`\n- Batch: \`${batch}\`\n- Automated status: **${metadata.status}**\n- Started: ${metadata.startedAt}\n- Completed: ${completedAt}\n- Git SHA: \`${metadata.git.sha ?? 'unavailable'}\`\n- Dirty tree at start: ${metadata.git.dirty ? 'yes' : 'no'}\n- Command: \`${command}\`\n- HTML report: \`html-report/index.html\`\n- JSON report: \`results.json\`\n- JUnit report: \`results.xml\`\n\n## Reviewer decision\n\n- Reviewer:\n- Review date:\n- Result: Pending / Accepted / Rejected\n- Browser and OS used to inspect the report:\n\n## Screenshot review\n\n| Screenshot | Layout and content | Responsive or interaction state | Notes |\n|---|---|---|---|\n${screenshotRows}\n\n## Required manual checks\n\n- [ ] No clipped, overlapping, or horizontally overflowing content.\n- [ ] Navigation mode matches the captured viewport.\n- [ ] Focus indicators and modal layering remain visible where captured.\n- [ ] Copy is readable and no untranslated keys or fixture/debug labels are visible.\n- [ ] Subscription surfaces show mobile handoff and no browser restore/purchase flow.\n- [ ] Manual invite entry remains understandable without camera access.\n- [ ] Any failure screenshot, trace, or retry in the HTML report has been reviewed.\n- [ ] Rejected checkpoints have an issue/task reference and reproduction note.\n\n## Notes and follow-up\n\n-\n`;

await writeFile(path.join(artifactRoot, 'manual-validation.md'), manualReview, 'utf8');

console.log(`Web E2E artifacts: ${artifactRoot}`);
console.log(`Manual validation checklist: ${path.join(artifactRoot, 'manual-validation.md')}`);
process.exitCode = exitCode;
