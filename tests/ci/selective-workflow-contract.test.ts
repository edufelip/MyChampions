import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const workflowDirectory = join(root, '.github', 'workflows');
const workflowNames = readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();
const workflows = new Map(
  workflowNames.map((name) => [
    name,
    readFileSync(join(workflowDirectory, name), 'utf8'),
  ])
);

function workflow(name: string): string {
  const source = workflows.get(name);
  assert.ok(source, `Missing workflow: ${name}`);
  return source;
}

function triggerBlock(source: string): string {
  const jobsStart = source.indexOf('\njobs:');
  assert.notEqual(jobsStart, -1, 'Workflow is missing a jobs mapping');
  return source.slice(0, jobsStart);
}

function jobBlock(source: string, name: string): string {
  const marker = `\n  ${name}:\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Workflow is missing job: ${name}`);

  const remaining = source.slice(start + marker.length);
  const nextJob = remaining.search(/\n  [a-zA-Z0-9_-]+:\n/);
  return nextJob === -1 ? remaining : remaining.slice(0, nextJob);
}

function actionStepBlocks(source: string, action: string): string[] {
  const lines = source.split('\n');
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^ {6}- /.test(lines[index])) {
      continue;
    }

    let end = index + 1;
    while (end < lines.length && !/^ {6}- /.test(lines[end])) {
      end += 1;
    }

    const block = lines.slice(index, end).join('\n');
    if (block.includes(`uses: ${action}`)) {
      blocks.push(block);
    }

    index = end - 1;
  }

  return blocks;
}

test('authoritative selective workflow targets main and checks out the exact head', () => {
  const source = workflow('pr-selective-tests.yml');
  const triggers = triggerBlock(source);

  assert.match(source, /^name: Selective feature CI$/m);
  assert.doesNotMatch(source, /\bshadow\b/i);
  assert.doesNotMatch(source, /\bdevelop\b/);
  assert.match(
    triggers,
    /pull_request:[\s\S]*?branches:[\s\S]*?- main[\s\S]*?push:[\s\S]*?branches:[\s\S]*?- main/
  );
  assert.match(triggers, /^  merge_group:$/m);
  assert.match(triggers, /^  schedule:$/m);
  assert.match(triggers, /^  workflow_dispatch:$/m);
  assert.doesNotMatch(triggers, /^ {4}paths:/m);

  assert.match(
    source,
    /PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/
  );
  assert.match(
    source,
    /head_sha="\$\{PR_HEAD_SHA:-\$\{MERGE_HEAD_SHA:-\$\{PUSH_HEAD_SHA:-\$GITHUB_SHA\}\}\}"/
  );

  const checkoutSteps = actionStepBlocks(source, 'actions/checkout@v4');
  assert.ok(checkoutSteps.length >= 5);
  for (const checkout of checkoutSteps) {
    if (checkout.includes('repository: edufelip/mychampions-api')) {
      assert.match(
        checkout,
        /ref: \$\{\{ steps\.backend-contract-ref\.outputs\.ref \}\}/
      );
      continue;
    }

    assert.match(
      checkout,
      /ref: \$\{\{ (?:steps\.refs|needs\.impact)\.outputs\.head_sha \}\}/,
      `Repository checkout must use the resolved exact head:\n${checkout}`
    );
  }
});

test('selective workflow keeps universal checks and conservative full fallbacks', () => {
  const source = workflow('pr-selective-tests.yml');
  const fastQuality = jobBlock(source, 'fast-quality');

  assert.match(fastQuality, /yarn test:impact/);
  assert.match(fastQuality, /yarn test:unit/);
  assert.match(fastQuality, /yarn lint/);
  assert.match(fastQuality, /yarn tsc --noEmit/);
  assert.match(fastQuality, /git merge-base "\$BASE_SHA" "\$HEAD_SHA"/);
  assert.match(fastQuality, /git diff --check "\$merge_base" "\$HEAD_SHA"/);

  assert.match(source, /"\$EVENT_NAME" == "merge_group"/);
  assert.match(source, /"\$EVENT_NAME" == "schedule"/);
  assert.match(source, /"\$FORCE_FULL_INPUT" == "true"/);
  assert.match(source, /"\$FORCE_FULL_LABEL" == "true"/);
  assert.match(source, /"\$FORCE_FULL_REPOSITORY" == "true"/);
  assert.match(source, /"\$BASE_REF" == release\/\*/);
  assert.match(source, /"\$BASE_REF" == hotfix\/\*/);
  assert.match(
    source,
    /if \[\[ "\$base_sha" =~ \^0\+\$ \]\]; then[\s\S]*?force_full=true/
  );
  assert.match(
    source,
    /if \[\[ -z "\$base_sha" \]\]; then[\s\S]*?force_full=true/
  );
  assert.match(source, /args\+=\(--all\)/);
  assert.match(
    source,
    /contains\(github\.event\.pull_request\.labels\.\*\.name, 'ci:full'\)/
  );
  assert.match(source, /vars\.CI_FORCE_FULL/);
  assert.match(
    source,
    /group: selective-feature-ci-\$\{\{ github\.event_name \}\}-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/
  );
  assert.match(
    source,
    /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \|\| github\.event_name == 'push' \}\}/
  );
});

test('self-hosted selected lanes are same-repository only and selected skips fail the gate', () => {
  const source = workflow('pr-selective-tests.yml');

  for (const name of [
    'web-selected',
    'detox-ios-selected',
    'detox-android-selected',
  ]) {
    const lane = jobBlock(source, name);
    assert.match(
      lane,
      /github\.event_name != 'pull_request'[\s\S]*?github\.event\.pull_request\.head\.repo\.full_name == github\.repository/
    );
    assert.match(lane, /runs-on: \[self-hosted,/);
  }

  const gate = jobBlock(source, 'selective-ci-gate');
  const iosLane = jobBlock(source, 'detox-ios-selected');
  assert.match(
    iosLane,
    /for candidate in \/Applications\/Xcode_"\$\{XCODE_REQUIRED_MAJOR\}"\*\.app/
  );
  assert.doesNotMatch(iosLane, /find \/Applications -maxdepth/);

  assert.match(gate, /^    if: always\(\)$/m);
  assert.match(
    gate,
    /if \[\[ "\$selected" == "true" && "\$result" != "success" \]\]; then/
  );
  assert.match(
    gate,
    /if \[\[ "\$selected" != "true" && "\$selected" != "false" \]\]; then/
  );
  assert.match(
    gate,
    /if \[\[ "\$selected" == "false" && "\$result" != "skipped" \]\]; then/
  );
  assert.match(gate, /require_selected_lane "\$HAS_WEB" "\$WEB_RESULT" web/);
  assert.match(gate, /require_selected_lane "\$HAS_IOS" "\$IOS_RESULT" ios/);
  assert.match(
    gate,
    /require_selected_lane "\$HAS_ANDROID" "\$ANDROID_RESULT" android/
  );
});

test('selected web browsers use an isolated cache and preserve user-local libraries', () => {
  const webLane = jobBlock(workflow('pr-selective-tests.yml'), 'web-selected');

  assert.match(
    webLane,
    /^      PLAYWRIGHT_BROWSERS_PATH: \/home\/eduardo\/\.cache\/ms-playwright-mychampions$/m
  );
  assert.match(
    webLane,
    /^      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: '1'$/m
  );
  assert.match(webLane, /find "\$PLAYWRIGHT_BROWSERS_PATH"/);
  assert.match(webLane, /-name minibrowser-wpe -o -name minibrowser-gtk/);
  assert.match(webLane, /wrapper="\$directory\/MiniBrowser"/);
  assert.ok(
    webLane.includes(
      'export LD_LIBRARY_PATH="${MYDIR}/lib:${MYDIR}/sys/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"'
    )
  );
  assert.doesNotMatch(webLane, /\/home\/eduardo\/\.cache\/ms-playwright\/webkit-/);
});

test('legacy platform workflows are manual-only and have no PR-event job guards', () => {
  for (const name of ['android-pr.yml', 'ios-pr.yml', 'web-pr.yml']) {
    const source = workflow(name);
    const triggers = triggerBlock(source);

    assert.match(triggers, /^  workflow_dispatch:$/m);
    assert.doesNotMatch(
      triggers,
      /^  (?:pull_request|pull_request_target|push|merge_group|schedule):/m
    );
    assert.doesNotMatch(source, /github\.event\.pull_request/);
    assert.match(source, /^jobs:$/m);
    assert.match(source, /^    runs-on:/m);
  }
});

test('all workflows avoid GitHub Actions-backed dependency caches', () => {
  assert.ok(workflowNames.length > 0);

  for (const [name, source] of workflows) {
    assert.doesNotMatch(source, /actions\/cache@/, name);
    assert.doesNotMatch(source, /gradle\/gradle-build-action@/, name);
    assert.doesNotMatch(source, /gradle\/actions\/setup-gradle@/, name);
    assert.doesNotMatch(source, /^\s+cache:/m, name);
    assert.doesNotMatch(source, /cache-dependency-path:/, name);
  }
});

test('selective artifacts are failure-only, bounded, and retained for one day', () => {
  const source = workflow('pr-selective-tests.yml');
  const uploads = actionStepBlocks(source, 'actions/upload-artifact@v4');

  assert.equal(uploads.length, 3);
  const expectedPaths = new Set([
    '.artifacts/ci-diagnostics/web',
    '.artifacts/ci-diagnostics/ios',
    '.artifacts/ci-diagnostics/android',
  ]);

  for (const upload of uploads) {
    assert.match(upload, /^\s+if: failure\(\)$/m);
    assert.match(upload, /^\s+retention-days: 1$/m);
    const path = upload.match(/^\s+path: (\S+)$/m)?.[1];
    assert.ok(path && expectedPaths.delete(path), `Unexpected artifact path: ${path}`);
  }

  assert.equal(expectedPaths.size, 0);
  assert.doesNotMatch(source, /actions\/download-artifact@/);
});

test('every other artifact is either bounded failure evidence or a one-day release binary', () => {
  const expectedFailurePaths = new Map([
    ['android-pr.yml', new Set(['android/app/build/reports'])],
    ['ios-pr.yml', new Set<string>()],
    ['web-pr.yml', new Set<string>()],
  ]);

  for (const [name, expectedPaths] of expectedFailurePaths) {
    const uploads = actionStepBlocks(
      workflow(name),
      'actions/upload-artifact@v4'
    );
    assert.equal(uploads.length, expectedPaths.size, name);

    for (const upload of uploads) {
      assert.match(upload, /^\s+if: failure\(\)$/m, name);
      assert.match(upload, /^\s+retention-days: 1$/m, name);
      const path = upload.match(/^\s+path: (\S+)$/m)?.[1];
      assert.ok(path && expectedPaths.delete(path), `${name}: ${path}`);
    }
  }

  for (const name of ['android-release.yml', 'ios-release.yml']) {
    const uploads = actionStepBlocks(
      workflow(name),
      'actions/upload-artifact@v4'
    );
    assert.equal(uploads.length, 1, name);
    assert.match(uploads[0], /^\s+retention-days: 1$/m, name);
  }
});
