import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
  // Detox left the PR path (Step 7): a PR targeting release/**|hotfix/** no
  // longer auto-forces the complete matrix by virtue of its base branch —
  // only an explicit ci:full label or an already-forced upstream signal
  // does. Full Detox validation for those branches now comes exclusively
  // from detox-protected-full.yml's push trigger.
  assert.match(authorization, /^\s+force_full = force_full or label_force_full$/m);
  assert.doesNotMatch(authorization, /force_full or label_force_full or base_ref/);

  const impact = jobBlock(source, 'impact');
  assert.match(impact, /^    needs: authorize-candidate$/m);
  assert.ok(
    source.indexOf('\n  authorize-candidate:\n') < source.indexOf('uses: actions/checkout@'),
    'candidate authorization must precede every checkout',
  );

  const checkoutSteps = actionStepBlocks(source, 'actions/checkout');
  assert.ok(checkoutSteps.length >= 4);
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
  // The MYCHAMPIONS_ENABLE_IOS_TESTS toggle no longer has any presence in
  // trusted-selective-tests.yml: Detox left the PR path entirely (Step 7 of
  // the CI web-primary redesign), so authorize-candidate/publish-selective-
  // status no longer read, thread, or gate on it. The toggle itself is
  // unchanged and still governs ios-pr.yml, detox-protected-full.yml, and
  // provider-validation.yml, which this test still covers below.
  const legacyIos = workflow('ios-pr.yml');
  const legacyToggle = jobBlock(legacyIos, 'resolve-ios-tests');
  const legacyBuild = jobBlock(legacyIos, 'build');
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

  assert.equal(iOSTestsEnabled(undefined), true);
  assert.equal(iOSTestsEnabled('true'), true);
  assert.equal(iOSTestsEnabled('TRUE'), true);
  assert.equal(iOSTestsEnabled('False'), true);
  assert.equal(iOSTestsEnabled('FALSE'), true);
  assert.equal(iOSTestsEnabled(''), true);
  assert.equal(iOSTestsEnabled('false'), false);

  assert.doesNotMatch(release, /MYCHAMPIONS_ENABLE_IOS_TESTS/);
  assert.doesNotMatch(protectedFull, /ios-release\.yml/);

  const trusted = workflow('trusted-selective-tests.yml');
  assert.doesNotMatch(trusted, /ios_tests_enabled/);
  assert.doesNotMatch(trusted, /MYCHAMPIONS_ENABLE_IOS_TESTS/);
  assert.doesNotMatch(trusted, /detox-ios-selected/);
});

test('web-selected lane is authorized, self-hosted, and per-PR-scoped', () => {
  // Detox left the PR path (Step 7 of the CI web-primary redesign):
  // detox-ios-selected/detox-android-selected (and their host-capacity
  // waiting, native runner-slot allocation, PID-safe supervisors, and
  // per-lane secrets handling) were deleted outright, not relocated — that
  // machinery existed specifically to let concurrent PRs share a limited
  // pool of emulator slots safely, which release/hotfix pushes to
  // detox-protected-full.yml don't need (infrequent, not concurrent PR
  // volume). web-selected is the only self-hosted selected lane left here.
  const source = workflow('trusted-selective-tests.yml');
  const webLane = jobBlock(source, 'web-selected');

  assert.match(webLane, /^      - authorize-candidate$/m);
  assert.match(webLane, /needs\.authorize-candidate\.result == 'success'/);
  assert.match(webLane, /runs-on: \[self-hosted,/);
  assert.match(webLane, /^    permissions:\s+contents: read$/m);
  assert.doesNotMatch(webLane, /statuses:\s*write/);

  // Note: prior to fix(ci): scope selective-CI concurrency groups per PR/run
  // (#44), the web and Android lanes shared one literal `mychampions-wsl-ui`
  // concurrency group so they always serialized against each other on this
  // runner. #44 rescoped every lane to its own `<lane>-${{ pull request or
  // sha }}` group to stop unrelated PRs from queuing behind each other; web
  // now only self-serializes across reruns of its own PR/branch.
  assert.match(
    webLane,
    /^    runs-on: \[self-hosted, Linux, X64, mychampions-ci, mychampions-web-only\]$/m,
  );
  assert.match(webLane, /^      group: mychampions-wsl-ui-/m);
  assert.match(
    webLane,
    /\$\{\{ needs\.authorize-candidate\.outputs\.pull_request_number \|\| needs\.authorize-candidate\.outputs\.head_sha \}\}$/m,
  );
  assert.match(
    webLane,
    /uses: actions\/setup-node@[a-f0-9]+[\s\S]*?- name: Enable repository Yarn\n        run: corepack enable\n      - run: yarn install --frozen-lockfile --no-progress/,
  );
  assert.equal(packageManifest.packageManager, 'yarn@1.22.22');
  assert.match(webLane, /^      SELECTIVE_INVOCATION_TIMEOUT_MS: '600000'$/m);

  assert.doesNotMatch(source, /detox-ios-selected|detox-android-selected/);
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
  // Detox left the PR path (Step 7): force_full no longer auto-broadens on
  // release/hotfix base branches (authorize-candidate's `force_full =
  // force_full or label_force_full` dropped ` or base_ref != "main"`), so
  // revalidate_pull_request()'s TOCTOU mirror must match exactly — otherwise
  // a release/hotfix PR would spuriously fail as "broadened after impact
  // resolution" even though nothing broadened it.
  assert.match(publisher, /broadened = ci_full$/m);
  assert.doesNotMatch(publisher, /or base_ref != "main"/);
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

  // Detox left the PR path (Step 7): only the web lane's diagnostics upload
  // remains here now; iOS/Android diagnostics uploads live in
  // detox-protected-full.yml instead.
  assert.equal(uploads.length, 1);
  const expectedPaths = new Set(['.artifacts/ci-diagnostics/web']);

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

test('protected native full validation is manual/release/protected-branch-push-only and builds once per platform', () => {
  const workflow = readFileSync(
    join(root, '.github', 'workflows', 'detox-protected-full.yml'),
    'utf8',
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release:\s*\n\s+types: \[published\]/);
  assert.match(workflow, /push:\s*\n\s+branches:\s*\n\s+-\s+release\/\*\*\s*\n\s+-\s+hotfix\/\*\*/);
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

  // No new authorization job is introduced for push — push events to
  // release/**|hotfix/** can't be spoofed/forked (same trust basis already
  // relied on by android-release.yml/ios-release.yml), so both jobs must
  // stay reachable on a push event and must not depend on the manual
  // workflow_dispatch `inputs.platform` choice (undefined on push).
  const iosCondition = workflow.match(
    /detox-ios-full:[\s\S]*?if: >-\n([\s\S]*?)\n\s+runs-on:/,
  )?.[1];
  const androidCondition = workflow.match(
    /detox-android-full:[\s\S]*?if: >-\n([\s\S]*?)\n\s+runs-on:/,
  )?.[1];
  assert.ok(iosCondition, 'detox-ios-full if: condition not found');
  assert.ok(androidCondition, 'detox-android-full if: condition not found');
  for (const condition of [iosCondition, androidCondition]) {
    assert.match(condition, /github\.event_name == 'push'/);
    // The ref-guard clause must accept push without requiring main.
    assert.match(
      condition,
      /github\.event_name == 'release' \|\| github\.event_name == 'push' \|\| github\.ref == 'refs\/heads\/main'/,
    );
    // The platform-guard clause must short-circuit before inputs.platform.
    assert.match(
      condition,
      /github\.event_name == 'release' \|\| github\.event_name == 'push' \|\| inputs\.platform ==/,
    );
  }

  // Push events to release/**|hotfix/** rely on the same push-can't-be-
  // spoofed trust basis as android-release.yml/ios-release.yml — no new
  // authorization/identity-check job should be introduced for this trigger.
  assert.doesNotMatch(workflow, /authoriz/i);
});
