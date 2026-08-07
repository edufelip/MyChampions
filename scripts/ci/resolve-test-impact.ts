import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  buildGitRefGraph,
  buildWorkingTreeGraph,
  changedFilesFromGit,
  formatImpactMarkdown,
  loadManifest,
  mergeBaseFromGit,
  resolveImpact,
  type ChangedFile,
  type ImportGraph,
  validateManifest,
} from './test-impact';

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const root = resolve(process.cwd());
const manifest = loadManifest(root);
const base = valueAfter('--base');
const head = valueAfter('--head') ?? 'HEAD';
const forceFull =
  process.argv.includes('--all') ||
  process.env.CI_FORCE_FULL === 'true' ||
  process.env.CI_FORCE_FULL === '1';
const outputPath = valueAfter('--output') ?? '.artifacts/test-impact/impact.json';
const markdownPath = valueAfter('--markdown') ?? '.artifacts/test-impact/summary.md';

let changes: ChangedFile[] = [];
let graphs: ImportGraph[] = [];
let resolutionError: string | null = null;

try {
  if (!base && !forceFull) throw new Error('--base is required unless --all is used');
  if (base) {
    const mergeBase = mergeBaseFromGit(root, base, head);
    changes = changedFilesFromGit(root, mergeBase, head);
    graphs = [buildGitRefGraph(root, mergeBase), buildWorkingTreeGraph(root)];
  }
} catch (error) {
  resolutionError = error instanceof Error ? error.message : String(error);
}

const validationErrors = validateManifest(manifest);
if (resolutionError) validationErrors.push(`impact resolution failed: ${resolutionError}`);
const result = resolveImpact(manifest, changes, graphs, {
  forceFull: forceFull || Boolean(resolutionError),
  validationErrors,
});

mkdirSync(dirname(resolve(root, outputPath)), { recursive: true });
mkdirSync(dirname(resolve(root, markdownPath)), { recursive: true });
writeFileSync(resolve(root, outputPath), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
writeFileSync(resolve(root, markdownPath), formatImpactMarkdown(result), 'utf8');

const githubOutput = process.env.GITHUB_OUTPUT;
if (githubOutput) {
  const output = {
    mode: result.mode,
    has_web: String(result.webSuites.length > 0),
    has_detox_ios: String(result.detoxIosSuites.length > 0),
    has_detox_android: String(result.detoxAndroidSuites.length > 0),
    full_fallback: String(result.mode === 'full-fallback'),
    web_matrix: JSON.stringify({ include: result.webSuites.map((suite) => ({ suite })) }),
    detox_ios_matrix: JSON.stringify({
      include: result.detoxIosSuites.map((suite) => ({
        suite,
        fixtureProfile: manifest.suites[suite]?.fixtureProfile ?? 'default',
      })),
    }),
    detox_android_matrix: JSON.stringify({
      include: result.detoxAndroidSuites.map((suite) => ({
        suite,
        fixtureProfile: manifest.suites[suite]?.fixtureProfile ?? 'default',
      })),
    }),
  };
  appendFileSync(
    githubOutput,
    Object.entries(output)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n') + '\n',
    'utf8'
  );
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, formatImpactMarkdown(result), 'utf8');
}

console.log(formatImpactMarkdown(result));
