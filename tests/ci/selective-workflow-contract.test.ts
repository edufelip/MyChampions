import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const workflowDirectory = join(root, '.github', 'workflows');
const workflowNames = readdirSync(workflowDirectory)
  .filter((name) => /\.ya?ml$/.test(name))
  .sort();
const workflows = new Map(
  workflowNames.map((name) => [name, readFileSync(join(workflowDirectory, name), 'utf8')]),
);
const detoxConfigSource = readFileSync(join(root, '.detoxrc.js'), 'utf8');
const androidRunnerSlotSource = readFileSync(
  join(root, 'scripts', 'ci', 'android-runner-slot.ts'),
  'utf8',
);
const androidGradleSource = readFileSync(join(root, 'android', 'app', 'build.gradle'), 'utf8');
const androidDetoxTestSource = readFileSync(
  join(
    root,
    'android',
    'app',
    'src',
    'androidTest',
    'java',
    'com',
    'eduardo880',
    'mychampions',
    'DetoxTest.java',
  ),
  'utf8',
);
const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  packageManager?: unknown;
};

function workflow(name: string): string {
  const source = workflows.get(name);
  assert.ok(source, `Missing workflow: ${name}`);
  return source;
}

function iOSTestsEnabled(repositoryVariable: string | undefined): boolean {
  return repositoryVariable !== 'false';
}

function authorizationPythonSource(): string {
  const source = workflow('trusted-selective-tests.yml');
  const startMarker = "          /usr/bin/python3 - <<'PY'\n";
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, 'Trusted workflow is missing its authorization script');
  const bodyStart = start + startMarker.length;
  const end = source.indexOf('\n          PY', bodyStart);
  assert.notEqual(end, -1, 'Trusted workflow authorization script is unterminated');
  return source
    .slice(bodyStart, end)
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
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

function namedStepBlock(source: string, name: string): string {
  const marker = `\n      - name: ${name}\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Workflow is missing step: ${name}`);

  const remaining = source.slice(start + marker.length);
  const nextStep = remaining.search(/\n      - /);
  return nextStep === -1 ? remaining : remaining.slice(0, nextStep);
}

function shellFunctionSource(source: string, name: string): string {
  const marker = `          ${name}() {\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Shell step is missing function: ${name}`);
  const endMarker = '\n          }\n';
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Shell function is unterminated: ${name}`);
  return source
    .slice(start, end + endMarker.length)
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for fixture');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Timed out waiting for supervised shell exit'));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function portIsOpen(port: number): Promise<boolean> {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(200);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
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
    if (block.includes(`uses: ${action}@`)) {
      blocks.push(block);
    }

    index = end - 1;
  }

  return blocks;
}

function eventFingerprintPythonSource(source: string, endMarker: string): string {
  const startMarker = '          def event_fingerprint(event: object) -> str:\n';
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, 'Workflow is missing its event fingerprint function');
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'Workflow event fingerprint function is unterminated');
  return source
    .slice(start, end)
    .trimEnd()
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n');
}

function fingerprintEvents(events: unknown[]): string[] {
  const preflight = eventFingerprintPythonSource(
    workflow('pr-selective-tests.yml'),
    '\n\n          try:',
  );
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import hashlib
import json
import sys
${preflight}
events = json.load(sys.stdin)
print(json.dumps([event_fingerprint(event) for event in events]))
`,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      input: JSON.stringify(events),
    },
  );
  assert.equal(
    result.status,
    0,
    `Event fingerprint fixture failed:\n${result.stderr || result.stdout}`,
  );
  return JSON.parse(result.stdout) as string[];
}

test('candidate preflight is hosted-only and cannot receive secrets or a write token', () => {
  const source = workflow('pr-selective-tests.yml');
  const triggers = triggerBlock(source);

  assert.match(source, /^name: Selective feature CI preflight$/m);
  assert.match(
    triggers,
    /pull_request:[\s\S]*?branches:[\s\S]*?- main[\s\S]*?- release\/\*\*[\s\S]*?- hotfix\/\*\*/,
  );
  assert.match(triggers, /^  merge_group:$/m);
  assert.doesNotMatch(
    triggers,
    /^  (?:pull_request_target|workflow_run|push|schedule|workflow_dispatch):/m,
  );
  assert.match(triggers, /^permissions: \{\}$/m);
  assert.doesNotMatch(source, /runs-on: \[self-hosted,/);
  assert.doesNotMatch(source, /\bsecrets\./);
  assert.doesNotMatch(source, /\bstatuses:\s*write\b/);
  assert.doesNotMatch(source, /\bactions\/checkout@/);
  assert.doesNotMatch(source, /^    name: Selective CI gate$/m);
  assert.match(triggers, /^      - edited$/m);
  assert.match(jobBlock(source, 'hosted-preflight'), /^    runs-on: ubuntu-latest$/m);
  assert.match(jobBlock(source, 'hosted-preflight'), /^      statuses: read$/m);
  assert.match(
    jobBlock(source, 'hosted-preflight'),
    /Await trusted stale-status invalidation[\s\S]*?latest\.get\("state"\) == "pending"/,
  );
  assert.match(
    jobBlock(source, 'hosted-preflight'),
    /latest\.get\("description"\) == expected_description/,
  );
  assert.doesNotMatch(
    jobBlock(source, 'hosted-preflight'),
    /allowed_descriptions|Trusted selective validation is in progress/,
  );
});

test('default-branch freshness invalidates stale PR-head success without candidate code', () => {
  const source = workflow('trusted-selective-freshness.yml');
  const triggers = triggerBlock(source);
  const invalidator = jobBlock(source, 'invalidate-stale-status');

  assert.match(source, /^name: Trusted selective CI freshness$/m);
  assert.match(
    triggers,
    /pull_request_target:[\s\S]*?branches:[\s\S]*?- main[\s\S]*?- release\/\*\*[\s\S]*?- hotfix\/\*\*/,
  );
  for (const action of [
    'opened',
    'synchronize',
    'reopened',
    'ready_for_review',
    'converted_to_draft',
    'edited',
    'labeled',
    'unlabeled',
  ]) {
    assert.match(triggers, new RegExp(`^      - ${action}$`, 'm'));
  }
  assert.match(triggers, /^permissions: \{\}$/m);
  assert.match(
    triggers,
    /group: trusted-selective-freshness-\$\{\{ github\.event\.pull_request\.number \}\}[\s\S]*?cancel-in-progress: true/,
  );
  assert.match(invalidator, /^    runs-on: ubuntu-latest$/m);
  assert.match(
    invalidator,
    /^    concurrency:\n      group: mychampions-selective-status-writer\n      queue: max$/m,
  );
  assert.match(invalidator, /^      pull-requests: read$/m);
  assert.match(invalidator, /^      statuses: write$/m);
  assert.doesNotMatch(source, /runs-on: \[self-hosted,/);
  assert.doesNotMatch(source, /\bsecrets\./);
  assert.doesNotMatch(source, /\bactions\/checkout@/);
  assert.match(
    invalidator,
    /WORKFLOW_REF[\s\S]*?TRUSTED_REF[\s\S]*?WORKFLOW_SHA[\s\S]*?GITHUB_SHA/,
  );
  assert.match(
    invalidator,
    /"state": "pending"[\s\S]*?"context": STATUS_CONTEXT[\s\S]*?Freshness event \{fingerprint\} awaits trusted validation/,
  );
  assert.match(
    invalidator,
    /event\.pull_request\.user[\s\S]*?pull_request\.user[\s\S]*?is not the trusted repository owner/,
  );
  assert.match(
    invalidator,
    /upstream_repository\(event_head\.get\("repo"\)[\s\S]*?upstream_repository\(live_head\.get\("repo"\)/,
  );
});

test('freshness and preflight bind pending status to one exact PR event', () => {
  const preflight = workflow('pr-selective-tests.yml');
  const freshness = workflow('trusted-selective-freshness.yml');
  assert.equal(
    eventFingerprintPythonSource(preflight, '\n\n          try:'),
    eventFingerprintPythonSource(freshness, '\n\n\n          def post_pending'),
  );

  const base = {
    action: 'labeled',
    number: 4,
    label: { id: 1, node_id: 'LABEL_1', name: 'ci:full' },
    sender: { id: 34727187, node_id: 'USER_1', login: 'edufelip' },
    pull_request: {
      id: 4,
      node_id: 'PR_4',
      number: 4,
      updated_at: '2026-07-28T23:59:58Z',
      state: 'open',
      merged: false,
      merge_commit_sha: null,
      draft: true,
      title: 'Selective CI',
      body: 'Trusted candidate',
      user: { id: 34727187, node_id: 'USER_1', login: 'edufelip' },
      labels: [
        { id: 2, node_id: 'LABEL_2', name: 'documentation' },
        { id: 1, node_id: 'LABEL_1', name: 'ci:full' },
      ],
      head: {
        label: 'edufelip:codex/selective-feature-ci-runners',
        ref: 'codex/selective-feature-ci-runners',
        sha: 'a'.repeat(40),
        repo: {
          id: 1,
          node_id: 'REPO_1',
          full_name: 'edufelip/MyChampions',
          owner: { id: 34727187, node_id: 'USER_1', login: 'edufelip' },
        },
        user: { id: 34727187, node_id: 'USER_1', login: 'edufelip' },
      },
      base: {
        label: 'edufelip:main',
        ref: 'main',
        sha: 'b'.repeat(40),
        repo: {
          id: 1,
          node_id: 'REPO_1',
          full_name: 'edufelip/MyChampions',
          owner: { id: 34727187, node_id: 'USER_1', login: 'edufelip' },
        },
        user: { id: 34727187, node_id: 'USER_1', login: 'edufelip' },
      },
    },
  };
  const reordered = structuredClone(base);
  reordered.pull_request.labels.reverse();
  const rapidUnlabel = structuredClone(base);
  rapidUnlabel.action = 'unlabeled';
  rapidUnlabel.pull_request.labels = rapidUnlabel.pull_request.labels.filter(
    (label) => label.name !== 'ci:full',
  );
  type FingerprintFixtureEvent = typeof base & {
    before?: string;
    after?: string;
    changes?: {
      body?: {
        from: string;
      };
    };
  };
  const synchronize: FingerprintFixtureEvent = structuredClone(base);
  synchronize.action = 'synchronize';
  synchronize.before = 'a'.repeat(40);
  synchronize.after = 'c'.repeat(40);
  synchronize.pull_request.head.sha = 'c'.repeat(40);
  const synchronizeReversal = structuredClone(synchronize);
  synchronizeReversal.before = 'c'.repeat(40);
  synchronizeReversal.after = 'a'.repeat(40);
  synchronizeReversal.pull_request.head.sha = 'a'.repeat(40);
  const edited: FingerprintFixtureEvent = structuredClone(base);
  edited.action = 'edited';
  edited.changes = { body: { from: 'Trusted candidate' } };
  edited.pull_request.body = 'Updated trusted candidate';

  const [
    originalFingerprint,
    reorderedFingerprint,
    unlabelFingerprint,
    synchronizeFingerprint,
    reversalFingerprint,
    editedFingerprint,
  ] = fingerprintEvents([base, reordered, rapidUnlabel, synchronize, synchronizeReversal, edited]);
  assert.match(originalFingerprint, /^[0-9a-f]{24}$/);
  assert.equal(originalFingerprint, reorderedFingerprint);
  assert.notEqual(originalFingerprint, unlabelFingerprint);
  assert.notEqual(synchronizeFingerprint, reversalFingerprint);
  assert.notEqual(originalFingerprint, editedFingerprint);
});

test('trusted workflow is default-branch sourced and authorizes exact candidates before checkout', () => {
  const source = workflow('trusted-selective-tests.yml');
  const triggers = triggerBlock(source);
  const authorization = jobBlock(source, 'authorize-candidate');

  assert.match(source, /^name: Trusted selective feature CI$/m);
  assert.match(
    triggers,
    /workflow_run:[\s\S]*?workflows:[\s\S]*?- Selective feature CI preflight[\s\S]*?types:[\s\S]*?- completed/,
  );
  assert.match(triggers, /push:[\s\S]*?branches:[\s\S]*?- main/);
  assert.match(triggers, /^  workflow_dispatch:$/m);
  assert.match(triggers, /pull_request_number:[\s\S]*?required: true[\s\S]*?type: number/);
  assert.doesNotMatch(triggers, /^  (?:pull_request|pull_request_target|merge_group|schedule):/m);
  assert.match(triggers, /^permissions: \{\}$/m);

  assert.match(authorization, /^    runs-on: ubuntu-latest$/m);
  assert.match(authorization, /^      actions: read$/m);
  assert.match(authorization, /^      contents: read$/m);
  assert.match(authorization, /^      pull-requests: read$/m);
  assert.match(authorization, /^      statuses: write$/m);
  assert.match(
    authorization,
    /TRUSTED_REF = f"\{REPOSITORY\}\/\{TRUSTED_PATH\}@refs\/heads\/main"/,
  );
  assert.match(authorization, /env\("ACTOR"\) != OWNER or env\("TRIGGERING_ACTOR"\) != OWNER/);
  assert.match(authorization, /env\("EVENT_SENDER"\) != OWNER/);
  assert.match(authorization, /env\("GITHUB_REF_VALUE"\) != "refs\/heads\/main"/);
  assert.match(authorization, /env\("WORKFLOW_REF"\) != TRUSTED_REF/);
  assert.match(
    authorization,
    /sha\(env\("WORKFLOW_SHA"\), "WORKFLOW_SHA"\) != sha\([\s\S]*?env\("GITHUB_SHA_VALUE"\)/,
  );
  assert.match(authorization, /api\(f"\/repos\/\{REPOSITORY\}\/actions\/runs\/\{run_id\}"\)/);
  assert.match(
    authorization,
    /run\.get\("status"\) != "completed"[\s\S]*?preflight_conclusion = text\(run\.get\("conclusion"\)/,
  );
  assert.match(
    authorization,
    /api\([\s\S]*?f"\/repos\/\{REPOSITORY\}\/actions\/workflows\/\{workflow_id\}"/,
  );
  assert.match(authorization, /api\(f"\/repos\/\{REPOSITORY\}\/pulls\/\{number\}"\)/);
  assert.match(
    authorization,
    /repository_identity\(head\.get\("repo"\), "pull_request\.head\.repo"\)/,
  );
  assert.match(authorization, /actor_identity\(pull\.get\("user"\), "pull_request\.user"\)/);
  assert.match(authorization, /live pull-request head no longer matches the triggering run/);
  assert.match(
    authorization,
    /MERGE_QUEUE_QUERY = """[\s\S]*?mergeQueueEntry[\s\S]*?entries\(first: 100\)[\s\S]*?pageInfo[\s\S]*?hasNextPage/,
  );
  assert.match(
    authorization,
    /graphql\([\s\S]*?MERGE_QUEUE_QUERY[\s\S]*?"number": queue_pull_number/,
  );
  assert.doesNotMatch(authorization, /commits\/\{head_sha\}\/pulls/);
  assert.match(
    authorization,
    /max\(matching_run_ids\) != run_id[\s\S]*?triggering preflight is stale/,
  );
  assert.match(
    authorization,
    /preflight_conclusion != "success"[\s\S]*?post_status\([\s\S]*?"failure"/,
  );
  assert.match(
    authorization,
    /event_name == "workflow_dispatch"[\s\S]*?validate_live_pr\(int\(input_value\)\)[\s\S]*?force_full = True/,
  );
  assert.match(
    authorization,
    /output\.write\(f"base_sha=\{base_sha\}\\n"\)[\s\S]*?output\.write\(f"head_sha=\{head_sha\}\\n"\)[\s\S]*?output\.write\(f"force_full=/,
  );

  const impact = jobBlock(source, 'impact');
  assert.match(impact, /^    needs: authorize-candidate$/m);
  assert.ok(
    source.indexOf('\n  authorize-candidate:\n') < source.indexOf('uses: actions/checkout@'),
    'candidate authorization must precede every checkout',
  );

  const checkoutSteps = actionStepBlocks(source, 'actions/checkout');
  assert.ok(checkoutSteps.length >= 5);
  for (const checkout of checkoutSteps) {
    assert.match(checkout, /persist-credentials: false/);
    if (checkout.includes('repository: edufelip/mychampions-api')) {
      assert.match(checkout, /ref: \$\{\{ steps\.backend-contract-ref\.outputs\.sha \}\}/);
      continue;
    }

    assert.match(
      checkout,
      /ref: \$\{\{ (?:needs\.authorize-candidate|needs\.impact)\.outputs\.head_sha \}\}/,
      `Repository checkout must use the resolved exact head:\n${checkout}`,
    );
  }
});

test('merge-group authorization proves one complete owner-controlled queue chain', () => {
  const authorization = jobBlock(workflow('trusted-selective-tests.yml'), 'authorize-candidate');

  assert.match(
    authorization,
    /re\.fullmatch\([\s\S]*?gh-readonly-queue\/\(\?P<base>\.\+\)\/[\s\S]*?pr-\(\?P<number>\[1-9\]\[0-9\]\*\)-[\s\S]*?\(\?P<base_sha>\[0-9a-f\]\{40\}\)/,
  );
  assert.match(authorization, /has_next_page is not False:[\s\S]*?entry list may be truncated/);
  assert.match(
    authorization,
    /len\(set\(positions\)\) != len\(positions\):[\s\S]*?duplicate entry positions/,
  );
  assert.match(
    authorization,
    /len\(set\(entry_heads\)\) != len\(entry_heads\):[\s\S]*?ambiguous candidate heads/,
  );
  assert.match(
    authorization,
    /target\["head_sha"\] != expected_head_sha[\s\S]*?target\["base_sha"\] != expected_queue_base_sha/,
  );
  assert.match(
    authorization,
    /merge_parent_sha != target\["base_sha"\]:[\s\S]*?commit parent does not match its queue entry/,
  );
  assert.match(authorization, /current\["head_sha"\] in seen_chain_heads:[\s\S]*?candidate cycle/);
  assert.match(
    authorization,
    /current\["position"\] != minimum_position:[\s\S]*?candidate chain is incomplete/,
  );
  assert.match(
    authorization,
    /predecessor\["position"\] != current\["position"\] - 1:[\s\S]*?candidate chain is not consecutive/,
  );
  assert.match(
    authorization,
    /len\(chain\) != target\["position"\] - minimum_position \+ 1:[\s\S]*?candidate chain is incomplete/,
  );
  assert.match(
    authorization,
    /root_base_sha != expected_protected_base_sha:[\s\S]*?does not start at the live protected base/,
  );
  assert.match(
    authorization,
    /entry\["state"\] == "UNMERGEABLE"[\s\S]*?entry\["enqueuer"\] != OWNER[\s\S]*?graphql_pull_request\([\s\S]*?validate_live_pr\(number\)/,
  );
  assert.match(
    authorization,
    /queued_pull\["head_sha"\] != live_head_sha[\s\S]*?live pull request disagrees with its merge-queue entry/,
  );
  assert.match(
    authorization,
    /run_numbers\.issubset\(seen_numbers\)[\s\S]*?outside the merge queue chain/,
  );
});

test('merge-group queue-chain resolver rejects hostile and incomplete fixtures', () => {
  const harness = String.raw`
import ast
import sys
import typing

source = sys.stdin.read()
tree = ast.parse(source)
wanted = {"fail", "resolve_queue_chain"}
definitions = [
    node
    for node in tree.body
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    and node.name in wanted
]
if {node.name for node in definitions} != wanted:
    raise AssertionError("queue resolver functions were not extracted")
module = ast.fix_missing_locations(ast.Module(body=definitions, type_ignores=[]))
namespace = {"Any": typing.Any}
exec(compile(module, "<trusted-selective-tests.yml>", "exec"), namespace)
resolve = namespace["resolve_queue_chain"]

a = "a" * 40
b = "b" * 40
c = "c" * 40
d = "d" * 40
e = "e" * 40

def entry(position, base_sha, head_sha, number):
    return {
        "position": position,
        "state": "QUEUED",
        "solo": False,
        "base_sha": base_sha,
        "head_sha": head_sha,
        "enqueuer": "edufelip",
        "pull_request_number": number,
        "pull_request": {"number": number},
    }

def reject(
    label,
    entries,
    target,
    expected_head,
    expected_queue_base,
    expected_protected_base,
    number,
    truncated=False,
):
    try:
        resolve(
            entries,
            target,
            expected_head,
            expected_queue_base,
            expected_protected_base,
            number,
            truncated,
        )
    except RuntimeError:
        return
    raise AssertionError(f"{label} fixture was authorized")

first = entry(1, a, b, 101)
target = entry(2, b, c, 102)
resolved_target, chain, root = resolve(
    [first, target],
    target,
    c,
    b,
    a,
    102,
    False,
)
assert resolved_target == target
assert [item["pull_request_number"] for item in chain] == [101, 102]
assert root == a

missing = entry(3, d, e, 103)
reject("missing predecessor", [first, missing], missing, e, d, a, 103)

duplicate_head = entry(2, b, b, 102)
reject(
    "ambiguous duplicate head",
    [first, duplicate_head],
    duplicate_head,
    b,
    b,
    a,
    102,
)

duplicate_position = entry(1, b, c, 102)
reject(
    "duplicate position",
    [first, duplicate_position],
    duplicate_position,
    c,
    b,
    a,
    102,
)

cycle_first = entry(1, c, b, 101)
cycle_target = entry(2, b, c, 102)
reject("cycle", [cycle_first, cycle_target], cycle_target, c, b, a, 102)

reject("truncated pagination", [first, target], target, c, b, a, 102, True)
reject("target ref", [first, target], target, d, b, a, 102)
reject("target PR", [first, target], target, c, b, a, 999)

suffix_first = entry(2, d, e, 103)
suffix_target = entry(3, e, "f" * 40, 104)
reject(
    "arbitrary minimum position",
    [suffix_first, suffix_target],
    suffix_target,
    "f" * 40,
    e,
    a,
    104,
)

listed_mismatch = dict(target)
listed_mismatch["state"] = "MERGEABLE"
reject(
    "target listing mismatch",
    [first, listed_mismatch],
    target,
    c,
    b,
    a,
    102,
)

print("queue resolver hostile fixtures passed")
`;
  const result = spawnSync('python3', ['-c', harness], {
    encoding: 'utf8',
    input: authorizationPythonSource(),
  });

  assert.equal(
    result.status,
    0,
    `Queue resolver fixture harness failed:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /queue resolver hostile fixtures passed/);
});

test('ordinary PR authorization rejects SHA-global collisions behaviorally', () => {
  const harness = String.raw`
import ast
import re
import sys
import typing

source = sys.stdin.read()
tree = ast.parse(source)
wanted = {
    "fail",
    "mapping",
    "sequence",
    "text",
    "positive_integer",
    "sha",
    "branch",
    "require_unique_open_pull_request",
}
definitions = [
    node
    for node in tree.body
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    and node.name in wanted
]
if {node.name for node in definitions} != wanted:
    raise AssertionError("unique-head authorization functions were not extracted")
module = ast.fix_missing_locations(ast.Module(body=definitions, type_ignores=[]))

head = "a" * 40
statuses = []
open_pulls = []

def api_payload(_path):
    return open_pulls

def repository_identity(value, field):
    if value.get("full_name") != "edufelip/MyChampions":
        raise RuntimeError(f"{field} is not upstream")

def post_status(candidate, state, description):
    statuses.append((candidate, state, description))

namespace = {
    "Any": typing.Any,
    "BRANCH_RE": re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$"),
    "OWNER": "edufelip",
    "REPOSITORY": "edufelip/MyChampions",
    "SHA_RE": re.compile(r"^[0-9a-f]{40}$"),
    "api_payload": api_payload,
    "post_status": post_status,
    "repository_identity": repository_identity,
}
exec(compile(module, "<trusted-selective-tests.yml>", "exec"), namespace)
require_unique = namespace["require_unique_open_pull_request"]

def pull(number, candidate=head, base="main", draft=False):
    return {
        "number": number,
        "state": "open",
        "merged_at": None,
        "draft": draft,
        "user": {"login": "edufelip"},
        "head": {
            "sha": candidate,
            "repo": {"full_name": "edufelip/MyChampions"},
        },
        "base": {
            "ref": base,
            "repo": {"full_name": "edufelip/MyChampions"},
        },
    }

open_pulls[:] = [pull(4)]
require_unique(head, 4)
assert statuses == []

open_pulls[:] = [pull(4), pull(9)]
try:
    require_unique(head, 4)
except RuntimeError:
    pass
else:
    raise AssertionError("shared candidate head was authorized")
assert statuses == [
    (
        head,
        "failure",
        "Candidate head is shared by multiple eligible pull requests.",
    )
]

statuses.clear()
open_pulls[:] = [pull(4), pull(9, draft=True), pull(10, base="develop")]
require_unique(head, 4)
assert statuses == []

external = pull(11)
external["user"] = {"login": "external"}
external["head"]["repo"] = {"full_name": "external/MyChampions"}
open_pulls[:] = [pull(4), external]
require_unique(head, 4)
assert statuses == []

print("unique-head collision fixtures passed")
`;
  const result = spawnSync('python3', ['-c', harness], {
    encoding: 'utf8',
    input: authorizationPythonSource(),
  });

  assert.equal(
    result.status,
    0,
    `Unique-head fixture harness failed:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /unique-head collision fixtures passed/);
});

test('coordinated backend checkout resolves, records, and verifies one exact commit', () => {
  const webLane = jobBlock(workflow('trusted-selective-tests.yml'), 'web-selected');

  assert.match(webLane, /git ls-remote[\s\S]*?--heads[\s\S]*?"refs\/heads\/\$\{backend_ref\}"/);
  assert.match(
    webLane,
    /if \[\[ -z "\$remote_line" \|\| "\$remote_line" == \*\$'\\n'\* \]\]; then/,
  );
  assert.match(webLane, /"\$backend_sha" =~ \^\[0-9a-f\]\{40\}\$/);
  assert.match(webLane, /"\$resolved_ref" != "refs\/heads\/\$\{backend_ref\}"/);
  assert.match(webLane, /echo "sha=\$backend_sha" >> "\$GITHUB_OUTPUT"/);
  assert.match(webLane, /- SHA: \\`\$backend_sha\\`/);
  assert.match(
    webLane,
    /EXPECTED_BACKEND_SHA: \$\{\{ steps\.backend-contract-ref\.outputs\.sha \}\}/,
  );
  assert.match(
    webLane,
    /checked_out_sha="\$\(git -C "\$MYCHAMPIONS_SERVER_ROOT" rev-parse HEAD\)"/,
  );
  assert.match(webLane, /if \[\[ "\$checked_out_sha" != "\$EXPECTED_BACKEND_SHA" \]\]; then/);
  assert.match(webLane, /- Checked out SHA: \\`\$checked_out_sha\\`/);
});

test('selective workflow keeps universal checks and conservative full fallbacks', () => {
  const source = workflow('trusted-selective-tests.yml');
  const fastQuality = jobBlock(source, 'fast-quality');
  const authorization = jobBlock(source, 'authorize-candidate');
  const impact = jobBlock(source, 'impact');

  assert.match(fastQuality, /yarn test:impact/);
  assert.match(fastQuality, /yarn test:unit/);
  assert.match(fastQuality, /yarn lint/);
  assert.match(fastQuality, /yarn tsc --noEmit/);
  assert.match(fastQuality, /git merge-base "\$BASE_SHA" "\$HEAD_SHA"/);
  assert.match(fastQuality, /git diff --check "\$merge_base" "\$HEAD_SHA"/);

  assert.match(authorization, /run_event == "merge_group"/);
  assert.match(authorization, /event_name == "workflow_dispatch"/);
  assert.match(authorization, /force_full = True/);
  assert.match(authorization, /== "ci:full"/);
  assert.doesNotMatch(authorization, /FORCE_FULL_REPOSITORY|vars\.CI_FORCE_FULL/);
  assert.match(impact, /args\+=\(--all\)/);
  assert.match(
    source,
    /group: trusted-selective-feature-ci-\$\{\{ github\.event\.workflow_run\.pull_requests\[0\]\.number \|\| inputs\.pull_request_number \|\| github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/,
  );
  assert.match(
    source,
    /cancel-in-progress: \$\{\{ github\.event_name == 'workflow_run' \|\| github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'push' \}\}/,
  );
});

test('iOS test toggle is default-on, exact-false opt-out, and gate-safe', () => {
  const legacyIos = workflow('ios-pr.yml');
  const trusted = workflow('trusted-selective-tests.yml');
  const legacyToggle = jobBlock(legacyIos, 'resolve-ios-tests');
  const legacyBuild = jobBlock(legacyIos, 'build');
  const authorization = jobBlock(trusted, 'authorize-candidate');
  const iosLane = jobBlock(trusted, 'detox-ios-selected');
  const gate = jobBlock(trusted, 'publish-selective-status');
  const release = workflow('ios-release.yml');
  const protectedFull = workflow('detox-protected-full.yml');
  const protectedResolver = jobBlock(protectedFull, 'resolve-ios-tests');
  const protectedIosLane = jobBlock(protectedFull, 'detox-ios-full');
  const provider = workflow('provider-validation.yml');
  const providerResolver = jobBlock(provider, 'resolve-ios-tests');
  const providerIosLane = jobBlock(provider, 'ios-test-store');

  assert.match(legacyToggle, /IOS_TESTS_VALUE: \$\{\{ vars\.MYCHAMPIONS_ENABLE_IOS_TESTS \}\}/);
  assert.match(legacyToggle, /os\.environ\.get\("IOS_TESTS_VALUE", ""\) != "false"/);
  assert.match(legacyBuild, /^    needs: resolve-ios-tests$/m);
  assert.match(
    legacyBuild,
    /^    if: \$\{\{ needs\.resolve-ios-tests\.outputs\.enabled == 'true' \}\}$/m,
  );
  assert.match(authorization, /IOS_TESTS_VALUE: \$\{\{ vars\.MYCHAMPIONS_ENABLE_IOS_TESTS \}\}/);
  assert.match(authorization, /os\.environ\.get\("IOS_TESTS_VALUE", ""\) != "false"/);
  assert.match(authorization, /ios_tests_enabled=\{'true' if ios_tests_enabled else 'false'\}/);
  assert.match(iosLane, /needs\.authorize-candidate\.outputs\.ios_tests_enabled == 'true'/);
  for (const resolver of [protectedResolver, providerResolver]) {
    assert.match(resolver, /IOS_TESTS_VALUE: \$\{\{ vars\.MYCHAMPIONS_ENABLE_IOS_TESTS \}\}/);
    assert.match(resolver, /os\.environ\.get\("IOS_TESTS_VALUE", ""\) != "false"/);
    assert.match(resolver, /enabled=\{'true' if enabled else 'false'\}/);
  }
  assert.match(protectedIosLane, /^    needs: resolve-ios-tests$/m);
  assert.match(protectedIosLane, /needs\.resolve-ios-tests\.outputs\.enabled == 'true'/);
  assert.match(protectedIosLane, /github\.event_name == 'release'/);
  assert.match(providerIosLane, /^    needs: resolve-ios-tests$/m);
  assert.match(providerIosLane, /needs\.resolve-ios-tests\.outputs\.enabled == 'true'/);
  assert.match(providerIosLane, /github\.ref == 'refs\/heads\/main'/);
  assert.match(
    gate,
    /IOS_TESTS_ENABLED: \$\{\{ needs\.authorize-candidate\.outputs\.ios_tests_enabled \}\}/,
  );
  assert.match(
    gate,
    /def selected_lane\(\n\s+name: str,\n\s+selected: str,\n\s+result: str,\n\s+enabled: str = "true",\n\s+\) -> None:/,
  );
  assert.match(gate, /if name == "ios" and enabled == "false":\s+expected = "skipped"/);
  assert.match(
    gate,
    /selected_lane\(\n\s+"ios",[\s\S]*?os\.environ\["IOS_TESTS_ENABLED"\],\n\s+\)/,
  );

  assert.equal(iOSTestsEnabled(undefined), true);
  assert.equal(iOSTestsEnabled('true'), true);
  assert.equal(iOSTestsEnabled('TRUE'), true);
  assert.equal(iOSTestsEnabled('False'), true);
  assert.equal(iOSTestsEnabled('FALSE'), true);
  assert.equal(iOSTestsEnabled(''), true);
  assert.equal(iOSTestsEnabled('false'), false);

  const expectedIosResult = (
    selected: boolean,
    result: 'success' | 'skipped',
    repositoryVariable: string | undefined,
  ): boolean => {
    const expected = iOSTestsEnabled(repositoryVariable)
      ? selected
        ? 'success'
        : 'skipped'
      : 'skipped';
    return result === expected;
  };

  assert.equal(expectedIosResult(true, 'success', undefined), true);
  assert.equal(expectedIosResult(false, 'skipped', 'true'), true);
  assert.equal(expectedIosResult(true, 'skipped', 'false'), true);
  assert.equal(expectedIosResult(false, 'skipped', 'false'), true);
  assert.equal(expectedIosResult(true, 'success', 'false'), false);
  assert.equal(expectedIosResult(true, 'skipped', 'true'), false);

  assert.match(gate, /selected_lane\("web"/);
  assert.match(gate, /selected_lane\(\n\s+"android"/);
  assert.doesNotMatch(release, /MYCHAMPIONS_ENABLE_IOS_TESTS/);
  assert.doesNotMatch(protectedFull, /ios-release\.yml/);
});

test('self-hosted selected lanes require authorization and selected skips fail publication', () => {
  const source = workflow('trusted-selective-tests.yml');

  for (const name of ['web-selected', 'detox-ios-selected', 'detox-android-selected']) {
    const lane = jobBlock(source, name);
    assert.match(lane, /^      - authorize-candidate$/m);
    assert.match(lane, /needs\.authorize-candidate\.result == 'success'/);
    assert.match(lane, /runs-on: \[self-hosted,/);
    assert.match(lane, /^    permissions:\s+contents: read$/m);
    assert.doesNotMatch(lane, /statuses:\s*write/);
  }

  const gate = jobBlock(source, 'publish-selective-status');
  const iosLane = jobBlock(source, 'detox-ios-selected');
  const androidLane = jobBlock(source, 'detox-android-selected');
  assert.match(
    iosLane,
    /for candidate in \/Applications\/Xcode_"\$\{XCODE_REQUIRED_MAJOR\}"\*\.app/,
  );
  assert.doesNotMatch(iosLane, /find \/Applications -maxdepth/);
  assert.match(androidLane, /emulator_serial="\$\{MYCHAMPIONS_ANDROID_EMULATOR_SERIAL:\?/);
  assert.match(
    androidLane,
    /android_state_file="\$recovery_root\/android-emulator-\$\{emulator_port\}\.state"/,
  );
  assert.match(
    androidLane,
    /MYCHAMPIONS_ANDROID_RECOVERY_ROOT must name an absolute real directory/,
  );
  assert.match(
    androidLane,
    /actual_mode="\$\(stat -c '%a' "\$recovery_root"\)"[\s\S]*?"\$actual_mode" != "700"/,
  );
  assert.match(
    androidLane,
    /expected_launcher_parent="\$BASHPID"[\s\S]*?os\.getppid\(\) != expected_parent[\s\S]*?libc\.prctl\(1, signal\.SIGKILL\)[\s\S]*?os\.getppid\(\) != expected_parent/,
  );
  assert.match(
    androidLane,
    /values = \{[\s\S]*?"pid": str\(pid\)[\s\S]*?"uid": str\(os\.getuid\(\)\)[\s\S]*?"start": stat_fields\[19\][\s\S]*?"avd": avd[\s\S]*?"port": port[\s\S]*?"serial": serial[\s\S]*?"executable": emulator_path[\s\S]*?"flags": flags/,
  );
  assert.ok(
    androidLane.indexOf('os.fsync(directory_fd)') <
      androidLane.indexOf('os.execv(emulator_path, arguments)'),
    'Android ownership state must be durable before emulator exec',
  );
  assert.match(
    androidLane,
    /closing = text\.rfind\("\)"\)[\s\S]*?fields = text\[closing \+ 2:\]\.split\(\)[\s\S]*?fields\[19\]/,
  );
  assert.match(
    androidLane,
    /load_android_state\(\)[\s\S]*?os\.O_NOFOLLOW[\s\S]*?stat\.S_IMODE\(metadata\.st_mode\) != 0o600/,
  );
  assert.match(
    androidLane,
    /if emulator_pid_matches; then[\s\S]*?kill -TERM "\$emulator_pid"[\s\S]*?if emulator_pid_matches; then[\s\S]*?kill -KILL "\$emulator_pid"/,
  );
  assert.match(
    androidLane,
    /remove_android_state_if_absent\(\) \{[\s\S]*?emulator_cleanup_complete \|\| return 1[\s\S]*?os\.unlink\(state_path\.name, dir_fd=directory_fd\)[\s\S]*?os\.fsync\(directory_fd\)/,
  );
  assert.match(
    androidLane,
    /boot_deadline=\$\(\(SECONDS \+ 120\)\)[\s\S]*?"\$attached_emulator" == "\$emulator_serial"/,
  );
  assert.match(
    androidLane,
    /run_supervised timeout 5s adb -P "\$adb_server_port" -s "\$emulator_serial"[\s\S]*?settings put global window_animation_scale/,
  );
  assert.match(
    androidLane,
    /timeout 10s adb -P "\$adb_server_port" -s "\$emulator_serial" emu kill/,
  );
  assert.match(
    androidLane,
    /timeout 0\.3s adb -P "\$adb_server_port" -s "\$emulator_serial" emu kill/,
  );
  assert.match(
    androidLane,
    /stop_adb_server\(\) \{[\s\S]*?timeout 5s adb -P "\$adb_server_port" kill-server/,
  );
  assert.match(androidLane, /adb_command\(\*args\)[\s\S]*?\["adb", "-P", adb_server_port/);
  assert.match(androidLane, /ADB_SERVER_PORT/);
  assert.match(androidLane, /MYCHAMPIONS_ANDROID_EMULATOR_PORT/);
  assert.match(androidLane, /MYCHAMPIONS_ANDROID_LOG_ROOT/);
  assert.match(androidLane, /MYCHAMPIONS_ANDROID_RECOVERY_ROOT/);
  assert.match(
    androidLane,
    /- id: android-slot[\s\S]*?yarn tsx scripts\/ci\/android-runner-slot\.ts/,
  );
  assert.doesNotMatch(androidLane, /GITHUB_ENV/);
  for (const outputName of [
    'ADB_SERVER_PORT',
    'ANDROID_ADB_SERVER_PORT',
    'ANDROID_AVD_HOME',
    'ANDROID_EMULATOR_HOME',
    'ANDROID_SERIAL',
    'ANDROID_TMPDIR',
    'ANDROID_USER_HOME',
    'DETOX_ANDROID_AVD',
    'DETOX_ANDROID_DEVICE',
    'DETOX_METRO_PORT',
    'MYCHAMPIONS_ANDROID_ADB_SERVER_PORT',
    'MYCHAMPIONS_ANDROID_AVD',
    'MYCHAMPIONS_ANDROID_AVD_HOME',
    'MYCHAMPIONS_ANDROID_EMULATOR_PORT',
    'MYCHAMPIONS_ANDROID_EMULATOR_SERIAL',
    'MYCHAMPIONS_ANDROID_LOCK_ROOT',
    'MYCHAMPIONS_ANDROID_LOG_ROOT',
    'MYCHAMPIONS_ANDROID_METRO_PORT',
    'MYCHAMPIONS_ANDROID_RECOVERY_ROOT',
    'MYCHAMPIONS_ANDROID_SLOT_ID',
    'MYCHAMPIONS_ANDROID_TEMP_ROOT',
    'MYCHAMPIONS_ANDROID_USER_HOME',
    'MYCHAMPIONS_NATIVE_STATE_ROOT',
    'TMPDIR',
  ]) {
    assert.match(androidLane, new RegExp(`steps\\.android-slot\\.outputs\\.${outputName}`));
  }
  assert.doesNotMatch(androidLane, /5554|5555|emulator-5554/);
  assert.match(androidLane, /Signal cleanup intentionally retains the durable ledger/);
  assert.doesNotMatch(
    androidLane,
    /owner_(?:prefix|pid_file|uid_file|start_file)|adb kill-server|pgrep -af/,
  );
  assert.doesNotMatch(androidLane, /grep -Eq '\^emulator-\[0-9\]\+\[\[:space:\]\]'/);
  assert.ok(
    androidLane.indexOf('os.execv(emulator_path, arguments)') <
      androidLane.indexOf('yarn test:impact:execute --platform android'),
    'Android lane must preboot the supported-port emulator before Detox',
  );
  assert.match(
    androidLane,
    /Validate isolated Android runner slot[\s\S]*?yarn tsx scripts\/ci\/android-runner-slot\.ts/,
  );
  assert.match(androidRunnerSlotSource, /requiredAbsolutePath\(process\.env, 'GITHUB_OUTPUT'\)/);
  assert.doesNotMatch(androidLane, /^      DETOX_ANDROID_AVD: Pixel_10$/m);
  assert.match(
    detoxConfigSource,
    /const rawMetroPort = process\.env\.DETOX_METRO_PORT \|\| '8081'/,
  );
  assert.match(detoxConfigSource, /reversePorts: \[androidMetroPort\]/);
  assert.match(
    androidGradleSource,
    /findProperty\('detoxMetroPort'\) \?: System\.getenv\('DETOX_METRO_PORT'\) \?: '8081'/,
  );
  assert.match(androidGradleSource, /DETOX_METRO_HOST/);
  assert.match(androidDetoxTestSource, /BuildConfig\.DETOX_METRO_HOST/);

  assert.match(gate, /^    if: \$\{\{ always\(\) && !cancelled\(\) \}\}$/m);
  assert.match(gate, /^      statuses: write$/m);
  assert.match(gate, /selected_lane\("web"/);
  assert.match(gate, /selected_lane\(\s+"ios"/);
  assert.match(gate, /selected_lane\(\s+"android"/);
  assert.match(gate, /expected = "success" if selected == "true" else "skipped"/);
});

test('web and Android use separate services with shared WSL load containment', () => {
  const source = workflow('trusted-selective-tests.yml');
  const webLane = jobBlock(source, 'web-selected');
  const iosLane = jobBlock(source, 'detox-ios-selected');
  const androidLane = jobBlock(source, 'detox-android-selected');

  assert.match(
    webLane,
    /^    runs-on: \[self-hosted, Linux, X64, mychampions-ci, mychampions-web-only\]$/m,
  );
  assert.match(webLane, /^      group: mychampions-wsl-ui$/m);
  assert.match(
    webLane,
    /uses: actions\/setup-node@[a-f0-9]+[\s\S]*?- name: Enable repository Yarn\n        run: corepack enable\n      - run: yarn install --frozen-lockfile --no-progress/,
  );
  assert.equal(packageManifest.packageManager, 'yarn@1.22.22');
  assert.match(androidLane, /^      group: mychampions-wsl-ui$/m);
  assert.doesNotMatch(source, /group: mychampions-web-ui/);
  assert.doesNotMatch(source, /group: mychampions-android-detox/);

  for (const lane of [webLane, iosLane, androidLane]) {
    assert.match(lane, /^      SELECTIVE_INVOCATION_TIMEOUT_MS: '600000'$/m);
  }
  assert.match(iosLane, /^    timeout-minutes: 75$/m);
  assert.match(androidLane, /^    timeout-minutes: 75$/m);
});

test('only hosted freshness, authorization, and final publication can write the stable exact-head status', () => {
  const source = workflow('trusted-selective-tests.yml');
  const freshness = jobBlock(
    workflow('trusted-selective-freshness.yml'),
    'invalidate-stale-status',
  );
  const authorization = jobBlock(source, 'authorize-candidate');
  const publisher = jobBlock(source, 'publish-selective-status');
  const statusWriteOccurrences = [...workflows.values()].flatMap(
    (workflowSource) => workflowSource.match(/statuses:\s*write/g) ?? [],
  );

  assert.equal(statusWriteOccurrences.length, 3);
  assert.match(freshness, /^    runs-on: ubuntu-latest$/m);
  assert.match(freshness, /^      statuses: write$/m);
  assert.match(authorization, /^    runs-on: ubuntu-latest$/m);
  assert.match(
    authorization,
    /^    concurrency:\n      group: mychampions-selective-status-writer\n      queue: max$/m,
  );
  assert.match(authorization, /^      statuses: write$/m);
  assert.match(publisher, /^    runs-on: ubuntu-latest$/m);
  assert.match(
    publisher,
    /^    concurrency:\n      group: mychampions-selective-status-writer\n      queue: max$/m,
  );
  assert.match(publisher, /^      statuses: write$/m);
  assert.match(publisher, /CONTEXT = "Selective CI gate"/);
  assert.match(
    authorization,
    /post_status\(\s+head_sha,\s+"pending",\s+"Trusted selective validation is in progress\.",/,
  );
  assert.match(publisher, /post_status\("failure", "Trusted selective validation failed\."\)/);
  assert.match(
    publisher,
    /post_status\("success", "Every selected trusted validation lane passed\."\)/,
  );
  assert.match(
    publisher,
    /CANDIDATE_SHA: \$\{\{ needs\.authorize-candidate\.outputs\.head_sha \}\}/,
  );
  assert.match(publisher, /revalidate_pull_request\(\)/);
  assert.match(authorization, /require_unique_open_pull_request\(head_sha, number\)/);
  assert.match(authorization, /Candidate head is shared by multiple eligible pull requests/);
  assert.match(publisher, /candidate head is not bound to exactly one eligible open pull request/);
  assert.match(publisher, /require_owned_pending_status\(\)/);
  assert.match(publisher, /current Selective CI status belongs to another validation run/);
  assert.match(
    publisher,
    /publish_required_status = os\.environ\["CANDIDATE_KIND"\] in \{[\s\S]*?"pull_request"[\s\S]*?"workflow_dispatch"[\s\S]*?"merge_group"[\s\S]*?"push"/,
  );
  assert.match(
    publisher,
    /status_requires_pull_request_ownership = os\.environ\["CANDIDATE_KIND"\] in \{[\s\S]*?"pull_request"[\s\S]*?"workflow_dispatch"[\s\S]*?"merge_group"[\s\S]*?\}/,
  );
  assert.doesNotMatch(
    publisher,
    /status_requires_pull_request_ownership = os\.environ\["CANDIDATE_KIND"\] in \{[\s\S]*?"push"/,
  );
  assert.match(publisher, /base\.get\("sha"\) != os\.environ\["CANDIDATE_BASE_SHA"\]/);
  assert.match(publisher, /or base_ref != "main"/);
  assert.doesNotMatch(source, /^    name: Selective CI gate$/m);

  for (const [name, workflowSource] of workflows) {
    for (const runner of workflowSource.matchAll(
      /\n  ([a-zA-Z0-9_-]+):\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|$)/g,
    )) {
      if (/runs-on: \[self-hosted,/.test(runner[2])) {
        assert.doesNotMatch(runner[2], /statuses:\s*write/, `${name}:${runner[1]}`);
      }
    }
  }
});

test('unsafe workflow-controlled persistent-runner hook candidates stay removed', () => {
  for (const path of [
    'scripts/ci/mychampions-runner-hook-job-started.sh',
    'scripts/ci/mychampions-runner-trust-gate.py',
    'tests/ci/test_mychampions_runner_trust_gate.py',
  ]) {
    assert.equal(existsSync(join(root, path)), false, path);
  }
});

test('selected iOS lane persists exact intent and only recovers the same simulator identity', () => {
  const iosLane = jobBlock(workflow('trusted-selective-tests.yml'), 'detox-ios-selected');
  const step = namedStepBlock(iosLane, 'Build and run selected iOS suites with trapped resources');

  assert.match(step, /expected_identifier = "com\.apple\.CoreSimulator\.SimDeviceType\.iPhone-17"/);
  assert.match(step, /runtime\.get\("version", ""\)\.split\("\.", 1\)\[0\] == "26"/);
  assert.match(step, /ios_state_file="\$recovery_root\/ios-simulator\.state"/);
  assert.match(
    step,
    /"phase": "intent"[\s\S]*?"name": sys\.argv\[2\][\s\S]*?"device_type": sys\.argv\[3\][\s\S]*?"runtime": sys\.argv\[4\][\s\S]*?"udid": ""/,
  );
  assert.ok(
    step.indexOf('persist_ios_intent') < step.indexOf('run_supervised xcrun simctl create'),
    'the exact create intent must be durable before simctl create',
  );
  assert.match(step, /same_name = devices\(\)|matching, same_uuid, same_name = devices\(\)/);
  assert.match(
    step,
    /same_name and not matching[\s\S]*?Recovered iOS intent changed runtime or device type/,
  );
  assert.match(
    step,
    /os\.unlink\(state_path\.name, dir_fd=directory_fd\)[\s\S]*?os\.fsync\(directory_fd\)/,
  );
  assert.match(
    step,
    /trap cleanup_ios_resources EXIT[\s\S]*?trap 'cleanup_ios_signal 130' INT[\s\S]*?trap 'cleanup_ios_signal 143' TERM/,
  );
  assert.match(step, /export DETOX_IOS_SIMULATOR_UDID="\$simulator_udid"/);
  assert.match(
    detoxConfigSource,
    /process\.env\.DETOX_IOS_SIMULATOR_UDID[\s\S]*?\{ id: process\.env\.DETOX_IOS_SIMULATOR_UDID \}/,
  );
  assert.doesNotMatch(iosLane, /simctl shutdown all|simctl delete (?:all|unavailable)/);
});

test('native recovery roots canonically remain outside workspace and runner temp', () => {
  const source = workflow('trusted-selective-tests.yml');
  const iosStep = namedStepBlock(
    jobBlock(source, 'detox-ios-selected'),
    'Build and run selected iOS suites with trapped resources',
  );
  const androidLane = jobBlock(source, 'detox-android-selected');
  const androidStep = namedStepBlock(
    androidLane,
    'Run selected Android suites on a supported emulator port',
  );
  const androidVerifier = namedStepBlock(androidLane, 'Verify Android emulator cleanup');
  const validators = [
    ['ios', shellFunctionSource(iosStep, 'validate_recovery_root')],
    ['android', shellFunctionSource(androidStep, 'validate_recovery_root')],
    ['android-verifier', shellFunctionSource(androidVerifier, 'validate_recovery_root')],
  ] as const;

  for (const [name, validator] of validators) {
    assert.match(validator, /canonical_workspace="\$\(cd "\$GITHUB_WORKSPACE" && pwd -P\)"/, name);
    assert.match(validator, /canonical_runner_temp="\$\(cd "\$RUNNER_TEMP" && pwd -P\)"/, name);
    assert.match(validator, /"\$canonical_workspace"\/\*/, name);
    assert.match(validator, /"\$canonical_runner_temp"\/\*/, name);
    assert.match(validator, /must remain outside GITHUB_WORKSPACE and RUNNER_TEMP/, name);
  }

  const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'mychampions-native-root-')));
  const workspace = join(fixtureRoot, 'workspace-real');
  const runnerTemp = join(fixtureRoot, 'runner-temp-real');
  const externalRoot = join(fixtureRoot, 'persistent-state');
  const workspaceNested = join(workspace, 'nested-state');
  const runnerTempNested = join(runnerTemp, 'nested-state');
  const workspaceAlias = join(fixtureRoot, 'workspace-alias');
  const runnerTempAlias = join(fixtureRoot, 'runner-temp-alias');
  const fakeBin = join(fixtureRoot, 'bin');
  const fakeStat = join(fakeBin, 'stat');

  try {
    for (const directory of [
      workspace,
      runnerTemp,
      externalRoot,
      workspaceNested,
      runnerTempNested,
      fakeBin,
    ]) {
      mkdirSync(directory, { mode: 0o700 });
      chmodSync(directory, 0o700);
    }
    symlinkSync(workspace, workspaceAlias);
    symlinkSync(runnerTemp, runnerTempAlias);
    writeFileSync(
      fakeStat,
      String.raw`#!/usr/bin/env python3
import os
import stat
import sys

if len(sys.argv) != 4 or sys.argv[1] not in {"-c", "-f"}:
    raise SystemExit("unsupported stat invocation")
metadata = os.stat(sys.argv[3], follow_symlinks=False)
if sys.argv[2] == "%u":
    print(metadata.st_uid)
elif sys.argv[2] in {"%a", "%Lp"}:
    print(format(stat.S_IMODE(metadata.st_mode), "o"))
else:
    raise SystemExit("unsupported stat format")
`,
    );
    chmodSync(fakeStat, 0o700);

    const cases = [
      ['workspace-equal', workspace, false],
      ['workspace-nested', workspaceNested, false],
      ['runner-temp-equal', runnerTemp, false],
      ['runner-temp-nested', runnerTempNested, false],
      ['external', externalRoot, true],
    ] as const;
    for (const [validatorName, validator] of validators) {
      for (const [caseName, recoveryRoot, allowed] of cases) {
        const result = spawnSync(
          'bash',
          [
            '-c',
            String.raw`
set -euo pipefail
${validator}
recovery_root="$RECOVERY_ROOT"
validate_recovery_root
`,
          ],
          {
            encoding: 'utf8',
            env: {
              ...process.env,
              GITHUB_WORKSPACE: workspaceAlias,
              PATH: `${fakeBin}:${process.env.PATH ?? '/usr/bin:/bin'}`,
              RECOVERY_ROOT: recoveryRoot,
              RUNNER_TEMP: runnerTempAlias,
            },
            timeout: 3_000,
          },
        );
        if (allowed) {
          assert.equal(result.status, 0, `${validatorName}:${caseName}\n${result.stderr}`);
        } else {
          assert.notEqual(
            result.status,
            0,
            `${validatorName}:${caseName} was unexpectedly accepted`,
          );
          assert.match(
            result.stderr,
            /must remain outside GITHUB_WORKSPACE and RUNNER_TEMP/,
            `${validatorName}:${caseName}`,
          );
        }
      }
    }
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test('native secrets use per-step mode-0600 targets and workspace symlinks', () => {
  const source = workflow('trusted-selective-tests.yml');
  const iosLane = jobBlock(source, 'detox-ios-selected');
  const androidLane = jobBlock(source, 'detox-android-selected');
  const steps = [
    namedStepBlock(iosLane, 'Build and run selected iOS suites with trapped resources'),
    namedStepBlock(androidLane, 'Run native checks and build the debug APKs once'),
    namedStepBlock(androidLane, 'Run selected Android suites on a supported emulator port'),
  ];
  const trapNames = [
    'trap cleanup_ios_resources EXIT',
    'trap cleanup_build_environment EXIT',
    'trap on_exit EXIT',
  ];

  assert.equal(source.match(/\$\{\{ secrets\.ENV_FILE \}\}/g)?.length, 3);
  for (const [index, step] of steps.entries()) {
    assert.match(step, /secret_file="\$RUNNER_TEMP\/mychampions-env-/);
    assert.match(step, /os\.O_EXCL[\s\S]*?os\.O_NOFOLLOW/);
    assert.match(step, /descriptor = os\.open\(path, flags, 0o600\)/);
    assert.match(
      step,
      /finally:\n\s+os\.close\(descriptor\)\n\s+PY\n\s+unset ENV_FILE_CONTENT\n\s+actual_mode=/,
    );
    assert.match(step, /ln -s "\$secret_file" "\$env_file"/);
    assert.match(step, /rm -f "\$secret_file"/);
    assert.match(
      step,
      /remove_secret_material\(\) \{[\s\S]{0,160}?unset ENV_FILE_CONTENT[\s\S]{0,80}?rm -f "\$secret_file"/,
    );
    assert.ok(
      step.indexOf(trapNames[index]) < step.lastIndexOf('create_secret_link'),
      'cleanup traps must precede owned secret creation',
    );
    assert.doesNotMatch(step, /printf '%s\\n' "\$ENV_FILE_CONTENT" > "\$env_file"/);
  }

  const androidVerifier = namedStepBlock(androidLane, 'Verify Android emulator cleanup');
  assert.match(
    steps[1],
    /run_supervised \.\/gradlew \\\n\s+--no-daemon \\\n[\s\S]*?app:assembleDevDebugAndroidTest/,
  );
  assert.doesNotMatch(androidVerifier, /ENV_FILE_CONTENT|secrets\.ENV_FILE|GITHUB_WORKSPACE\/.env/);
});

test('native secret bytes are absent from all post-write subprocess environments', () => {
  const androidBuildStep = namedStepBlock(
    jobBlock(workflow('trusted-selective-tests.yml'), 'detox-android-selected'),
    'Run native checks and build the debug APKs once',
  );
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'mychampions-native-secret-'));
  const secretFile = join(fixtureRoot, 'runner-temp', 'native.env');
  const envLink = join(fixtureRoot, 'workspace.env');
  mkdirSync(join(fixtureRoot, 'runner-temp'), { mode: 0o700 });
  const fixtureSecret = 'native-secret-must-not-reach-subprocesses';
  const createSecretSource = shellFunctionSource(androidBuildStep, 'create_secret_link');
  const portableCreateSecretSource = createSecretSource.replace(
    `actual_mode="$(stat -c '%a' "$secret_file")" || return 1`,
    `actual_mode="$(SECRET_FILE="$secret_file" /usr/bin/python3 -c 'import os, stat; print(format(stat.S_IMODE(os.stat(os.environ["SECRET_FILE"], follow_symlinks=False).st_mode), "o"))')" || return 1`,
  );
  assert.notEqual(portableCreateSecretSource, createSecretSource);
  const harness = String.raw`
set -euo pipefail
${shellFunctionSource(androidBuildStep, 'remove_secret_material')}
${shellFunctionSource(androidBuildStep, 'recover_stale_secret_link')}
${portableCreateSecretSource}
env_file="$ENV_LINK"
secret_file="$SECRET_FILE"
create_secret_link
! printenv ENV_FILE_CONTENT >/dev/null
/usr/bin/python3 - "$env_file" "$EXPECTED_SECRET" <<'PY'
import os
import pathlib
import sys

if "ENV_FILE_CONTENT" in os.environ:
    raise SystemExit("raw secret remained in the child environment")
if pathlib.Path(sys.argv[1]).read_text(encoding="utf-8") != sys.argv[2] + "\n":
    raise SystemExit("secret target content changed")
PY
remove_secret_material
! printenv ENV_FILE_CONTENT >/dev/null
[[ ! -e "$secret_file" && ! -L "$env_file" ]]
`;

  try {
    const result = spawnSync('bash', ['-c', harness], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ENV_FILE_CONTENT: fixtureSecret,
        ENV_LINK: envLink,
        EXPECTED_SECRET: fixtureSecret,
        RUNNER_TEMP: join(fixtureRoot, 'runner-temp'),
        SECRET_FILE: secretFile,
      },
      timeout: 5_000,
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test('all native supervisors protect the pre-$! handoff and bound signal cleanup', () => {
  const source = workflow('trusted-selective-tests.yml');
  const iosLane = jobBlock(source, 'detox-ios-selected');
  const androidLane = jobBlock(source, 'detox-android-selected');
  const steps = [
    namedStepBlock(iosLane, 'Build and run selected iOS suites with trapped resources'),
    namedStepBlock(androidLane, 'Run native checks and build the debug APKs once'),
    namedStepBlock(androidLane, 'Run selected Android suites on a supported emulator port'),
  ];

  for (const step of steps) {
    assert.match(
      step,
      /capture_last_background_pid\(\) \{[\s\S]*?set \+u[\s\S]*?captured_background_pid=\$![\s\S]*?set -u/,
    );
    assert.match(
      step,
      /supervisor_launching=true[\s\S]*?\/usr\/bin\/python3 -c[\s\S]*?' "\$@" <&0 &[\s\S]*?supervised_pid=\$![\s\S]*?supervisor_launching=false/,
    );
    assert.match(
      step,
      /"\$supervisor_launching" == "true"[\s\S]*?launch_candidate="\$captured_background_pid"[\s\S]*?supervised_pgid="\$launch_candidate"/,
    );
    assert.match(
      step,
      /sleep 0\.02[\s\S]*?kill -TERM -- "-\$supervised_pgid"[\s\S]*?for _ in \$\(seq 1 15\); do[\s\S]*?sleep 0\.1[\s\S]*?kill -KILL -- "-\$supervised_pgid"/,
    );
    assert.match(step, /terminate_supervised_child fast/);
  }
  assert.equal(source.match(/capture_last_background_pid\(\) \{/g)?.length, 3);
});

test(
  'native supervisor exits on INT/TERM within three seconds without owned descendants',
  { timeout: 25_000 },
  async () => {
    const iosStep = namedStepBlock(
      jobBlock(workflow('trusted-selective-tests.yml'), 'detox-ios-selected'),
      'Build and run selected iOS suites with trapped resources',
    );
    const processGroupSource = shellFunctionSource(iosStep, 'supervised_process_group_exists');
    const captureSource = shellFunctionSource(iosStep, 'capture_last_background_pid');
    const terminateSource = shellFunctionSource(iosStep, 'terminate_supervised_child');
    const runSource = shellFunctionSource(iosStep, 'run_supervised');
    const supervisorSource = [processGroupSource, captureSource, terminateSource, runSource].join(
      '\n',
    );
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'mychampions-native-cancel-'));
    const fixtureProgram = join(fixtureRoot, 'owned-process.py');
    const detachedFixtureProgram = join(fixtureRoot, 'detached-owned-process.py');
    const unrelatedServer = createServer();
    await new Promise<void>((resolve, reject) => {
      unrelatedServer.once('error', reject);
      unrelatedServer.listen(0, '127.0.0.1', resolve);
    });
    const portProbe = createServer();
    let detachedHarnessForCleanup: ReturnType<typeof spawn> | undefined;
    let detachedPidForCleanup: number | undefined;
    await new Promise<void>((resolve, reject) => {
      portProbe.once('error', reject);
      portProbe.listen(0, '127.0.0.1', resolve);
    });
    const address = portProbe.address();
    assert.ok(address && typeof address === 'object');
    const ownedPort = address.port;
    await new Promise<void>((resolve, reject) =>
      portProbe.close((error) => (error ? reject(error) : resolve())),
    );

    try {
      writeFileSync(
        fixtureProgram,
        String.raw`
import os
import signal
import socket
import subprocess
import sys
import time

child = r"""
import os
import signal
import socket
import sys
import time
signal.signal(signal.SIGINT, signal.SIG_IGN)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
listener = socket.socket()
listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listener.bind(("127.0.0.1", int(sys.argv[2])))
listener.listen()
with open(sys.argv[1], "w", encoding="utf-8") as ready:
    ready.write(str(os.getpid()))
while True:
    time.sleep(1)
"""
subprocess.Popen([sys.executable, "-c", child, sys.argv[1], sys.argv[2]])
while True:
    time.sleep(1)
`.trimStart(),
      );
      writeFileSync(
        detachedFixtureProgram,
        String.raw`
import os
import signal
import socket
import subprocess
import sys
import time

child = r"""
import os
import signal
import socket
import sys
import time
signal.signal(signal.SIGINT, signal.SIG_IGN)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
listener = socket.socket()
listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
listener.bind(("127.0.0.1", int(sys.argv[2])))
listener.listen()
with open(sys.argv[1], "w", encoding="utf-8") as ready:
    ready.write(str(os.getpid()))
while True:
    time.sleep(1)
"""
detached = subprocess.Popen(
    [sys.executable, "-c", child, sys.argv[1], sys.argv[2]],
    start_new_session=True,
)

def terminate(_signum, _frame):
    time.sleep(1.1)
    try:
        os.killpg(detached.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    detached.wait()
    os._exit(143)

signal.signal(signal.SIGTERM, terminate)
while True:
    time.sleep(1)
`.trimStart(),
      );

      for (const [signal, expectedCode] of [
        ['SIGINT', 130],
        ['SIGTERM', 143],
      ] as const) {
        const suffix = signal.toLowerCase();
        const secretFile = join(fixtureRoot, `${suffix}.secret`);
        const envLink = join(fixtureRoot, `${suffix}.env`);
        const readyFile = join(fixtureRoot, `${suffix}.ready`);
        const harness = String.raw`
set -euo pipefail
${supervisorSource}
supervised_pid=
supervised_pgid=
supervisor_launching=false
supervisor_previous_background_pid=
captured_background_pid=
secret_file="$SECRET_FILE"
env_file="$ENV_LINK"
cleanup_signal() {
  local code="$1"
  trap - EXIT
  trap '' INT TERM
  set +e
  rm -f "$secret_file" "$env_file"
  terminate_supervised_child fast || true
  exit "$code"
}
trap 'cleanup_signal 130' INT
trap 'cleanup_signal 143' TERM
umask 077
printf '%s\n' fixture-secret > "$secret_file"
chmod 600 "$secret_file"
ln -s "$secret_file" "$env_file"
run_supervised /usr/bin/python3 "$FIXTURE_PROGRAM" "$READY_FILE" "$OWNED_PORT"
`;
        const child = spawn('bash', ['-c', harness], {
          env: {
            ...process.env,
            ENV_LINK: envLink,
            FIXTURE_PROGRAM: fixtureProgram,
            OWNED_PORT: String(ownedPort),
            READY_FILE: readyFile,
            SECRET_FILE: secretFile,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stderr = '';
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk) => {
          stderr += chunk;
        });
        await waitUntil(() => existsSync(readyFile) && existsSync(secretFile), 3_000);
        assert.equal((await import('node:fs')).lstatSync(secretFile).mode & 0o777, 0o600);
        assert.equal(await portIsOpen(ownedPort), true);
        const grandchildPid = Number(readFileSync(readyFile, 'utf8'));
        const startedAt = Date.now();
        assert.equal(child.kill(signal), true);
        const result = await waitForExit(child, 3_000);
        assert.equal(result.code, expectedCode, stderr);
        assert.ok(Date.now() - startedAt < 3_000);
        assert.equal(existsSync(secretFile), false);
        assert.equal(existsSync(envLink), false);
        await waitUntil(() => {
          try {
            process.kill(grandchildPid, 0);
            return false;
          } catch {
            return true;
          }
        }, 1_000);
        assert.equal(await portIsOpen(ownedPort), false);
        assert.equal(unrelatedServer.listening, true);
      }

      const detachedReadyFile = join(fixtureRoot, 'detached.ready');
      const detachedHarness = String.raw`
set -euo pipefail
${supervisorSource}
supervised_pid=
supervised_pgid=
supervisor_launching=false
supervisor_previous_background_pid=
captured_background_pid=
cleanup_signal() {
  trap - EXIT
  trap '' INT TERM
  set +e
  terminate_supervised_child fast || true
  exit 143
}
trap cleanup_signal TERM
run_supervised /usr/bin/python3 \
  "$DETACHED_FIXTURE_PROGRAM" "$DETACHED_READY_FILE" "$OWNED_PORT"
`;
      const detachedHarnessProcess = spawn('bash', ['-c', detachedHarness], {
        env: {
          ...process.env,
          DETACHED_FIXTURE_PROGRAM: detachedFixtureProgram,
          DETACHED_READY_FILE: detachedReadyFile,
          OWNED_PORT: String(ownedPort),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      detachedHarnessForCleanup = detachedHarnessProcess;
      let detachedStderr = '';
      detachedHarnessProcess.stderr?.setEncoding('utf8');
      detachedHarnessProcess.stderr?.on('data', (chunk) => {
        detachedStderr += chunk;
      });
      await waitUntil(() => existsSync(detachedReadyFile), 3_000);
      const detachedPid = Number(readFileSync(detachedReadyFile, 'utf8'));
      detachedPidForCleanup = detachedPid;
      assert.equal(await portIsOpen(ownedPort), true);
      const detachedStartedAt = Date.now();
      assert.equal(detachedHarnessProcess.kill('SIGTERM'), true);
      const detachedResult = await waitForExit(detachedHarnessProcess, 3_000);
      detachedHarnessForCleanup = undefined;
      assert.equal(detachedResult.code, 143, detachedStderr);
      assert.ok(Date.now() - detachedStartedAt < 3_000);
      await waitUntil(() => {
        try {
          process.kill(detachedPid, 0);
          return false;
        } catch {
          return true;
        }
      }, 1_000);
      detachedPidForCleanup = undefined;
      assert.equal(await portIsOpen(ownedPort), false);
      assert.equal(unrelatedServer.listening, true);

      const injectedRunSource = runSource.replace(
        `' "$@" <&0 &\n  supervised_pid=$!`,
        () => `' "$@" <&0 &\n  kill -TERM "$$"\n  supervised_pid=$!`,
      );
      assert.notEqual(injectedRunSource, runSource);
      const immediateHarness = String.raw`
set -euo pipefail
${processGroupSource}
${captureSource}
${terminateSource}
${injectedRunSource}
supervised_pid=
supervised_pgid=
supervisor_launching=false
supervisor_previous_background_pid=
captured_background_pid=
cleanup_signal() {
  trap - EXIT
  trap '' INT TERM
  set +e
  terminate_supervised_child fast || true
  exit 143
}
trap cleanup_signal TERM
run_supervised /usr/bin/python3 -c 'import time; time.sleep(5)'
`;
      const immediate = spawnSync('bash', ['-c', immediateHarness], {
        encoding: 'utf8',
        timeout: 4_000,
      });
      assert.equal(immediate.status, 143, `pre-$! cancellation failed:\n${immediate.stderr}`);

      for (const exitCode of [0, 7]) {
        const result = spawnSync(
          'bash',
          [
            '-c',
            String.raw`
set -euo pipefail
${supervisorSource}
supervised_pid=
supervised_pgid=
supervisor_launching=false
supervisor_previous_background_pid=
captured_background_pid=
run_supervised /usr/bin/python3 -c \
  "import sys,time; time.sleep(0.1); sys.exit(${exitCode})"
`,
          ],
          { encoding: 'utf8', timeout: 5_000 },
        );
        assert.equal(result.status, exitCode, result.stderr);
      }
    } finally {
      detachedHarnessForCleanup?.kill('SIGKILL');
      if (detachedPidForCleanup !== undefined) {
        try {
          process.kill(-detachedPidForCleanup, 'SIGKILL');
        } catch {
          // The detached fixture was already reaped.
        }
      }
      await new Promise<void>((resolve) => unrelatedServer.close(() => resolve()));
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  },
);

test(
  'iOS durable intent survives failed cleanup and is recovered by the next run',
  { timeout: 20_000 },
  () => {
    const iosStep = namedStepBlock(
      jobBlock(workflow('trusted-selective-tests.yml'), 'detox-ios-selected'),
      'Build and run selected iOS suites with trapped resources',
    );
    const supervisorSource = [
      shellFunctionSource(iosStep, 'supervised_process_group_exists'),
      shellFunctionSource(iosStep, 'capture_last_background_pid'),
      shellFunctionSource(iosStep, 'terminate_supervised_child'),
      shellFunctionSource(iosStep, 'run_supervised'),
    ].join('\n');
    const recoveryStart = iosStep.indexOf('          recover_ios_ledger() {\n');
    const recoveryEnd = iosStep.indexOf('\n          cleanup_ios_resources() {', recoveryStart);
    assert.notEqual(recoveryStart, -1);
    assert.notEqual(recoveryEnd, -1);
    const recoverySource = iosStep
      .slice(recoveryStart, recoveryEnd)
      .split('\n')
      .map((line) => line.replace(/^ {10}/, ''))
      .join('\n');
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'mychampions-ios-recovery-'));
    const fakeBin = join(fixtureRoot, 'bin');
    const fakeXcrun = join(fakeBin, 'xcrun');
    const simulatorState = join(fixtureRoot, 'simulators.json');
    const ledger = join(fixtureRoot, 'ios-simulator.state');
    const allowDelete = join(fixtureRoot, 'allow-delete');
    const log = join(fixtureRoot, 'simctl.log');
    const runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-0';
    const name = 'mychampions-ci-42-1';
    const ownedUdid = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
    const unrelatedUdid = '11111111-2222-3333-4444-555555555555';
    const deviceType = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17';

    mkdirSync(fakeBin);
    writeFileSync(
      fakeXcrun,
      String.raw`#!/usr/bin/env python3
import json
import os
import sys

args = sys.argv[1:]
with open(os.environ["SIMCTL_LOG"], "a", encoding="utf-8") as log:
    log.write(" ".join(args) + "\n")
if args == ["simctl", "list", "devices", "--json"]:
    with open(os.environ["SIMULATOR_STATE"], encoding="utf-8") as state:
        print(state.read())
    raise SystemExit(0)
if args[:2] == ["simctl", "shutdown"]:
    raise SystemExit(0)
if args[:2] == ["simctl", "delete"]:
    if os.path.exists(os.environ["ALLOW_DELETE"]):
        with open(os.environ["SIMULATOR_STATE"], encoding="utf-8") as state:
            payload = json.load(state)
        for runtime, devices in payload["devices"].items():
            payload["devices"][runtime] = [
                device for device in devices if device.get("udid") != args[2]
            ]
        with open(os.environ["SIMULATOR_STATE"], "w", encoding="utf-8") as state:
            json.dump(payload, state)
    raise SystemExit(0)
raise SystemExit("unexpected xcrun invocation")
`,
    );
    chmodSync(fakeXcrun, 0o755);
    const writeLedger = (phase: 'intent' | 'created', udid: string) => {
      writeFileSync(
        ledger,
        [
          'version=1',
          `phase=${phase}`,
          `name=${name}`,
          `device_type=${deviceType}`,
          `runtime=${runtime}`,
          `udid=${udid}`,
          '',
        ].join('\n'),
        { mode: 0o600 },
      );
      chmodSync(ledger, 0o600);
    };
    const runRecovery = (mode: 'fast' | 'normal' = 'normal') =>
      spawnSync(
        'bash',
        [
          '-c',
          String.raw`
set -euo pipefail
${supervisorSource}
${recoverySource}
ios_state_file="$IOS_STATE_FILE"
supervised_pid=
supervised_pgid=
supervisor_launching=false
supervisor_previous_background_pid=
captured_background_pid=
recover_ios_ledger "$RECOVERY_MODE"
`,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            ALLOW_DELETE: allowDelete,
            IOS_STATE_FILE: ledger,
            PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
            RECOVERY_MODE: mode,
            SIMCTL_LOG: log,
            SIMULATOR_STATE: simulatorState,
          },
          timeout: 8_000,
        },
      );

    try {
      writeFileSync(simulatorState, JSON.stringify({ devices: { [runtime]: [] } }));
      writeLedger('intent', '');
      const interrupted = runRecovery('fast');
      assert.notEqual(interrupted.status, 0);
      assert.equal(existsSync(ledger), true);

      writeFileSync(
        simulatorState,
        JSON.stringify({
          devices: {
            [runtime]: [
              {
                name,
                udid: ownedUdid,
                deviceTypeIdentifier: deviceType,
                state: 'Shutdown',
              },
              {
                name: 'unrelated',
                udid: unrelatedUdid,
                deviceTypeIdentifier: deviceType,
                state: 'Shutdown',
              },
            ],
          },
        }),
      );
      const failed = runRecovery();
      assert.notEqual(
        failed.status,
        0,
        `unexpected successful recovery:\n${failed.stdout}\n${failed.stderr}\n${
          existsSync(log) ? readFileSync(log, 'utf8') : 'no simctl log'
        }\nstate=${readFileSync(simulatorState, 'utf8')}\nledger=${
          existsSync(ledger) ? readFileSync(ledger, 'utf8') : 'missing'
        }`,
      );
      assert.equal(existsSync(ledger), true);

      writeFileSync(allowDelete, '');
      const recovered = runRecovery();
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(existsSync(ledger), false);
      const remaining = JSON.parse(readFileSync(simulatorState, 'utf8'));
      assert.deepEqual(
        remaining.devices[runtime].map((device: { udid: string }) => device.udid),
        [unrelatedUdid],
      );

      rmSync(allowDelete);
      writeLedger('created', ownedUdid);
      writeFileSync(
        simulatorState,
        JSON.stringify({
          devices: {
            'com.apple.CoreSimulator.SimRuntime.iOS-25-0': [
              {
                name,
                udid: 'BBBBBBBB-CCCC-DDDD-EEEE-FFFFFFFFFFFF',
                deviceTypeIdentifier: deviceType,
                state: 'Shutdown',
              },
            ],
          },
        }),
      );
      const mismatch = runRecovery();
      assert.notEqual(mismatch.status, 0);
      assert.equal(existsSync(ledger), true);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  },
);

test('Android delayed-ledger cancellation retains state for exact next-run recovery', () => {
  const androidStep = namedStepBlock(
    jobBlock(workflow('trusted-selective-tests.yml'), 'detox-android-selected'),
    'Run selected Android suites on a supported emulator port',
  );
  const fastCleanup = shellFunctionSource(androidStep, 'cleanup_emulator_fast');
  const normalCleanup = shellFunctionSource(androidStep, 'cleanup_emulator');
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'mychampions-android-recovery-'));
  const fakeBin = join(fixtureRoot, 'bin');
  const ledger = join(fixtureRoot, 'android.state');
  mkdirSync(fakeBin);
  writeFileSync(join(fakeBin, 'timeout'), '#!/usr/bin/env bash\nshift\nexec "$@"\n');
  writeFileSync(
    join(fakeBin, 'adb'),
    '#!/usr/bin/env bash\nkill -TERM "$OWNED_PID" 2>/dev/null || true\n',
  );
  chmodSync(join(fakeBin, 'timeout'), 0o755);
  chmodSync(join(fakeBin, 'adb'), 0o755);

  try {
    const result = spawnSync(
      'bash',
      [
        '-c',
        String.raw`
set -euo pipefail
${fastCleanup}
${normalCleanup}
android_state_file="$STATE_FILE"
emulator_serial=emulator-5554
emulator_port=5554
adb_server_port=5038
emulator_pid=
load_count=0
load_android_state() {
  load_count=$((load_count + 1))
  if (( load_count < 4 )); then
    return 1
  fi
  emulator_pid="$OWNED_PID"
  return 0
}
emulator_pid_matches() { kill -0 "$emulator_pid" 2>/dev/null; }
emulator_pid_is_owned() { kill -0 "$emulator_pid" 2>/dev/null; }
reap_emulator_if_zombie() { wait "$emulator_pid" 2>/dev/null || true; }
emulator_cleanup_complete() {
  reap_emulator_if_zombie
  ! kill -0 "$emulator_pid" 2>/dev/null
}
emulator_identity_process_present_or_unknown() { return 1; }
emulator_device_present_or_unknown() { return 1; }
emulator_ports_present_or_unknown() { return 1; }
remove_android_state_if_absent() {
  emulator_cleanup_complete || return 1
  rm -f "$android_state_file"
}
sleep 30 &
OWNED_PID=$!
export OWNED_PID
printf '%s\n' ledger > "$android_state_file"
cleanup_emulator_fast
[[ -e "$android_state_file" ]]
sleep 30 &
OWNED_PID=$!
export OWNED_PID
load_count=100
cleanup_emulator
[[ ! -e "$android_state_file" ]]
`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          STATE_FILE: ledger,
        },
        timeout: 6_000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(ledger), false);
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
});

test(
  'Android ledger loader and verifier fail closed while preserving unrelated PID reuse',
  { timeout: 20_000 },
  () => {
    const androidLane = jobBlock(workflow('trusted-selective-tests.yml'), 'detox-android-selected');
    const androidStep = namedStepBlock(
      androidLane,
      'Run selected Android suites on a supported emulator port',
    );
    const loaderStart = androidStep.indexOf('          load_android_state() {\n');
    const loaderEnd = androidStep.indexOf('\n          proc_identity() {', loaderStart);
    assert.notEqual(loaderStart, -1);
    assert.notEqual(loaderEnd, -1);
    const loaderSource = androidStep
      .slice(loaderStart, loaderEnd)
      .split('\n')
      .map((line) => line.replace(/^ {10}/, ''))
      .join('\n');

    const verifierStep = namedStepBlock(androidLane, 'Verify Android emulator cleanup');
    const verifierMarker =
      '          /usr/bin/python3 - "$recovery_root/android-emulator-${emulator_port}.state" <<\'PY\'\n';
    const verifierStart = verifierStep.indexOf(verifierMarker);
    const verifierBodyStart = verifierStart + verifierMarker.length;
    const verifierEnd = verifierStep.indexOf('\n          PY', verifierBodyStart);
    assert.notEqual(verifierStart, -1);
    assert.notEqual(verifierEnd, -1);
    const verifierPython = verifierStep
      .slice(verifierBodyStart, verifierEnd)
      .split('\n')
      .map((line) => line.replace(/^ {10}/, ''))
      .join('\n')
      .replace(
        'path = pathlib.Path("/proc", pid)',
        'path = pathlib.Path(os.environ["PROC_ROOT"], pid)',
      )
      .replace(
        'os.path.realpath(f"/proc/{values[\'pid\']}/exe")',
        'os.path.realpath(pathlib.Path(os.environ["PROC_ROOT"], values["pid"], "exe"))',
      )
      .replace(
        'for directory in pathlib.Path("/proc").glob("[0-9]*"):',
        'for directory in pathlib.Path(os.environ["PROC_ROOT"]).glob("[0-9]*"):',
      )
      .replace(
        'os.kill(int(values["pid"]), signal.SIGTERM)',
        'pathlib.Path(os.environ["SIGNAL_LOG"]).write_text("TERM", encoding="utf-8")',
      )
      .replace(
        'os.kill(int(values["pid"]), signal.SIGKILL)',
        'pathlib.Path(os.environ["SIGNAL_LOG"]).write_text("KILL", encoding="utf-8")',
      )
      .replace('for _ in range(30):', 'for _ in range(1):')
      .replace('for _ in range(20):', 'for _ in range(1):')
      .replaceAll('time.sleep(0.2)', 'time.sleep(0.01)')
      .replaceAll('time.sleep(0.5)', 'time.sleep(0.01)')
      .replaceAll('time.sleep(0.25)', 'time.sleep(0.01)');

    const fixtureRoot = mkdtempSync(join(tmpdir(), 'mychampions-android-verifier-'));
    const fakeBin = join(fixtureRoot, 'bin');
    const procRoot = join(fixtureRoot, 'proc');
    const stateFile = join(fixtureRoot, 'android-emulator-5554.state');
    const verifierProgram = join(fixtureRoot, 'verifier.py');
    const signalLog = join(fixtureRoot, 'signals.log');
    const pidDirectory = join(procRoot, '123');
    const unrelatedDirectory = join(procRoot, '999');
    mkdirSync(fakeBin);
    mkdirSync(procRoot);
    mkdirSync(pidDirectory);
    mkdirSync(unrelatedDirectory);
    writeFileSync(join(fakeBin, 'adb'), '#!/usr/bin/env bash\nexit 0\n');
    writeFileSync(join(fakeBin, 'ss'), '#!/usr/bin/env bash\nexit 0\n');
    chmodSync(join(fakeBin, 'adb'), 0o755);
    chmodSync(join(fakeBin, 'ss'), 0o755);
    writeFileSync(verifierProgram, verifierPython);

    const sleepExecutable = spawnSync(
      'python3',
      ['-c', 'import os; print(os.path.realpath("/bin/sleep"))'],
      { encoding: 'utf8' },
    ).stdout.trim();
    const procFields = Array(20).fill('0');
    procFields[0] = 'S';
    procFields[19] = '999';
    writeFileSync(
      join(pidDirectory, 'stat'),
      `123 (fixture process with spaces) ${procFields.join(' ')}\n`,
    );
    writeFileSync(join(pidDirectory, 'cmdline'), Buffer.from('fixture\0--unrelated\0'));
    symlinkSync(sleepExecutable, join(pidDirectory, 'exe'));
    writeFileSync(join(unrelatedDirectory, 'cmdline'), Buffer.from('unrelated\0--listener\0'));

    const flags =
      '-no-audio,-no-boot-anim,-no-window,-no-snapshot,-read-only,-gpu=swiftshader_indirect';
    const writeAndroidState = (start: string) => {
      writeFileSync(
        stateFile,
        [
          'version=1',
          'phase=running',
          'pid=123',
          `uid=${process.getuid?.() ?? 0}`,
          `start=${start}`,
          'avd=Pixel_10',
          'port=5554',
          'serial=emulator-5554',
          `executable=${sleepExecutable}`,
          `qemu_executable=${sleepExecutable}`,
          `flags=${flags}`,
          '',
        ].join('\n'),
        { mode: 0o600 },
      );
      chmodSync(stateFile, 0o600);
    };
    const runLoader = () =>
      spawnSync(
        'bash',
        [
          '-c',
          String.raw`
set -euo pipefail
${loaderSource}
android_state_file="$STATE_FILE"
DETOX_ANDROID_AVD=Pixel_10
emulator_pid=
emulator_uid=
emulator_start_time=
emulator_avd=
emulator_port=
emulator_serial=
emulator_executable=
emulator_qemu_executable=
emulator_flags=
load_android_state
printf '%s\n' "$emulator_pid:$emulator_avd:$emulator_port:$emulator_serial"
`,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            DETOX_ANDROID_AVD: 'Pixel_10',
            MYCHAMPIONS_ANDROID_EMULATOR_PORT: '5554',
            MYCHAMPIONS_ANDROID_EMULATOR_SERIAL: 'emulator-5554',
            STATE_FILE: stateFile,
          },
        },
      );
    const runVerifier = () =>
      spawnSync('python3', [verifierProgram, stateFile], {
        encoding: 'utf8',
        env: {
          ...process.env,
          ADB_SERVER_PORT: '5038',
          DETOX_ANDROID_AVD: 'Pixel_10',
          MYCHAMPIONS_ANDROID_EMULATOR_PORT: '5554',
          MYCHAMPIONS_ANDROID_EMULATOR_SERIAL: 'emulator-5554',
          PATH: `${fakeBin}:${process.env.PATH ?? ''}`,
          PROC_ROOT: procRoot,
          SIGNAL_LOG: signalLog,
        },
        timeout: 5_000,
      });

    try {
      writeAndroidState('111');
      const valid = runLoader();
      assert.equal(valid.status, 0, valid.stderr);
      assert.match(valid.stdout, /^123:Pixel_10:5554:emulator-5554$/m);

      writeFileSync(stateFile, `${readFileSync(stateFile, 'utf8')}pid=124\n`);
      const duplicate = runLoader();
      assert.notEqual(duplicate.status, 0);
      assert.equal(existsSync(stateFile), true);

      writeAndroidState('111');
      chmodSync(stateFile, 0o644);
      const unsafeMode = runLoader();
      assert.notEqual(unsafeMode.status, 0);
      assert.equal(existsSync(stateFile), true);

      const symlinkTarget = join(fixtureRoot, 'symlink-target.state');
      writeAndroidState('111');
      writeFileSync(symlinkTarget, readFileSync(stateFile));
      rmSync(stateFile);
      symlinkSync(symlinkTarget, stateFile);
      const symlinkState = runLoader();
      assert.notEqual(symlinkState.status, 0);
      assert.equal(existsSync(symlinkTarget), true);
      rmSync(stateFile);

      writeAndroidState('111');
      const reusedPid = runVerifier();
      assert.equal(reusedPid.status, 0, reusedPid.stderr);
      assert.equal(existsSync(stateFile), false);
      assert.equal(existsSync(unrelatedDirectory), true);

      writeAndroidState('999');
      chmodSync(join(pidDirectory, 'cmdline'), 0o000);
      const unknownIdentity = runVerifier();
      assert.notEqual(unknownIdentity.status, 0);
      assert.equal(existsSync(stateFile), true);
      chmodSync(join(pidDirectory, 'cmdline'), 0o600);

      writeFileSync(
        join(pidDirectory, 'cmdline'),
        Buffer.from(
          [
            'fixture',
            '@Pixel_10',
            '-port',
            '5554',
            '-no-audio',
            '-no-boot-anim',
            '-no-window',
            '-no-snapshot',
            '-read-only',
            '-gpu',
            'swiftshader_indirect',
            '',
          ].join('\0'),
        ),
      );
      writeAndroidState('999');
      const failedCleanup = runVerifier();
      assert.notEqual(failedCleanup.status, 0);
      assert.equal(existsSync(stateFile), true);
      assert.equal(readFileSync(signalLog, 'utf8'), 'KILL');

      rmSync(pidDirectory, { force: true, recursive: true });
      const retriedCleanup = runVerifier();
      assert.equal(retriedCleanup.status, 0, retriedCleanup.stderr);
      assert.equal(existsSync(stateFile), false);
      assert.equal(existsSync(unrelatedDirectory), true);
    } finally {
      if (existsSync(join(pidDirectory, 'cmdline'))) {
        chmodSync(join(pidDirectory, 'cmdline'), 0o600);
      }
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  },
);

test('selected web browsers use an isolated cache and preserve user-local libraries', () => {
  const webLane = jobBlock(workflow('trusted-selective-tests.yml'), 'web-selected');

  assert.match(
    webLane,
    /run: echo "PLAYWRIGHT_BROWSERS_PATH=\$HOME\/\.cache\/ms-playwright-mychampions" >> "\$GITHUB_ENV"/,
  );
  assert.match(webLane, /^      PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: '1'$/m);
  assert.match(webLane, /find "\$PLAYWRIGHT_BROWSERS_PATH"/);
  assert.match(webLane, /-name minibrowser-wpe -o -name minibrowser-gtk/);
  assert.match(webLane, /wrapper="\$directory\/MiniBrowser"/);
  assert.ok(
    webLane.includes(
      'export LD_LIBRARY_PATH="${MYDIR}/lib:${MYDIR}/sys/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"',
    ),
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
      /^  (?:pull_request|pull_request_target|push|merge_group|schedule):/m,
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

test('all third-party workflow actions use the reviewed immutable release pins', () => {
  const expectedPins = new Map([
    ['actions/checkout', ['11d5960a326750d5838078e36cf38b85af677262', 'v4.4.0']],
    ['actions/setup-node', ['49933ea5288caeca8642d1e84afbd3f7d6820020', 'v4.4.0']],
    ['actions/setup-java', ['c1e323688fd81a25caa38c78aa6df2d33d3e20d9', 'v4.8.0']],
    ['actions/upload-artifact', ['ea165f8d65b6e75b540449e92b4886f43607fa02', 'v4.6.2']],
    ['oven-sh/setup-bun', ['0c5077e51419868618aeaa5fe8019c62421857d6', 'v2.2.0']],
    ['r0adkll/upload-google-play', ['e738b9dd8f2476ea806d921b64aacd24f34515a5', 'v1.1.5']],
  ]);
  const observedActions = new Set<string>();

  for (const [name, source] of workflows) {
    const usesLines = source.split('\n').filter((line) => /^\s+(?:-\s+)?uses:\s+/.test(line));
    for (const line of usesLines) {
      const match = line.match(
        /^\s+(?:-\s+)?uses:\s+([^@\s]+)@([0-9a-f]{40})\s+#\s+(v\d+\.\d+\.\d+)\s*$/,
      );
      assert.ok(match, `${name}: action must use a full SHA and version comment: ${line}`);

      const [, action, sha, version] = match;
      const expected = expectedPins.get(action);
      assert.ok(expected, `${name}: unreviewed third-party action: ${action}`);
      assert.deepEqual([sha, version], expected, `${name}: stale pin for ${action}`);
      observedActions.add(action);
    }

    for (const checkout of actionStepBlocks(source, 'actions/checkout')) {
      assert.match(
        checkout,
        /persist-credentials: false/,
        `${name}: checkout must not persist the workflow token`,
      );
    }
  }

  assert.deepEqual(observedActions, new Set(expectedPins.keys()));
});

test('selective artifacts are failure-only, bounded, and retained for one day', () => {
  const source = workflow('trusted-selective-tests.yml');
  const uploads = actionStepBlocks(source, 'actions/upload-artifact');

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
    const uploads = actionStepBlocks(workflow(name), 'actions/upload-artifact');
    assert.equal(uploads.length, expectedPaths.size, name);

    for (const upload of uploads) {
      assert.match(upload, /^\s+if: failure\(\)$/m, name);
      assert.match(upload, /^\s+retention-days: 1$/m, name);
      const path = upload.match(/^\s+path: (\S+)$/m)?.[1];
      assert.ok(path && expectedPaths.delete(path), `${name}: ${path}`);
    }
  }

  for (const name of ['android-release.yml', 'ios-release.yml']) {
    const uploads = actionStepBlocks(workflow(name), 'actions/upload-artifact');
    assert.equal(uploads.length, 1, name);
    assert.match(uploads[0], /^\s+retention-days: 1$/m, name);
  }
});

test('protected native full validation is manual/release-only and builds once per platform', () => {
  const workflow = readFileSync(
    join(root, '.github', 'workflows', 'detox-protected-full.yml'),
    'utf8',
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release:\s*\n\s+types: \[published\]/);
  assert.doesNotMatch(workflow, /schedule:/);
  assert.match(workflow, /mychampions-ios/);
  assert.match(workflow, /mychampions-android/);
  assert.match(workflow, /yarn test:e2e:build:ios:debug/);
  assert.match(workflow, /app:assembleDevDebugAndroidTest/);
  assert.equal((workflow.match(/DETOX_SKIP_BUILD=true yarn test:impact:execute/g) ?? []).length, 2);
  assert.equal((workflow.match(/MYCHAMPIONS_NATIVE_STATE_ROOT/g) ?? []).length >= 4, true);
  assert.equal((workflow.match(/mychampions-native-host\.lock/g) ?? []).length >= 4, true);
  assert.equal((workflow.match(/fcntl\.flock/g) ?? []).length, 2);
  assert.match(workflow, /SELECTED_SUITES_JSON:/);
  assert.match(workflow, /if: failure\(\)/);
  assert.match(workflow, /retention-days: 1/);
  assert.doesNotMatch(workflow, /detox:revenuecat-live/);
});
