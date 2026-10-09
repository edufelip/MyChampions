# MyChampions agent exploration playbook v1

Status: T16-A preparation contract. This document and the charter registry
define how a later bounded exploration run may be prepared. They do not prove
that a target, connector, build, fixture, or product journey has run.

The preparation command is intentionally local and side-effect limited. It
validates a checked-in charter and an optional caller-supplied context file,
then writes private templates under `.qa/artifacts/`. It does not start Expo,
Playwright, Maestro, an emulator, a simulator, a browser, a server,
Postgres, a connector, or an agent. It does not reset a device, request a
permission, make an API call, write application data, post an issue, schedule a
run, or change an external service.

## Preparation command

The package preparation alias is:

```bash
yarn qa:explore:prepare --platform <ios|android|web> \
  --locale <en-US|pt-BR|es-ES> \
  --charter <charter-id> \
  [--context <repository-relative-private-json>] \
  [--artifact-root <path-under-.qa/artifacts>]
```

The equivalent direct preparation command is:

```bash
npx tsx scripts/testing/prepare-exploration.ts \
  --platform ios \
  --locale en-US \
  --charter EXP-COMPACT-KEYBOARD-SCROLL
```

`--locale` is required so each locale is an explicit, separate selection.
Repeat preparation and later execution for `en-US`, `pt-BR`, and `es-ES`; a
single English artifact cannot stand in for the other locale paths. Native
platforms use the declared Maestro connector. The web platform uses the
declared Playwright connector. The connector name is a contract value; the
preparation command does not discover or launch it.

The command exits `0` only when the supplied context is structurally valid and
all declared prerequisites are marked available. Even then its result is
`explorationStatus: not-run`, and the scenario remains blocked with
`PREPARATION_ONLY`. It exits `2` for an invalid selection or an unknown or
unavailable prerequisite. A blocked artifact is useful for resuming work, but
it is not a failed product test and never counts as an exploration pass.

The budget in this command is a declaration and validation contract. Preparation
does not start a monotonic deadline, count UI actions, or enforce the two
unchanged-failure stop. T16-B must enforce 30 minutes or 100 actual UI actions,
whichever comes first, and must retain both attempts before classifying an
unchanged branch after two failures. Role and session proof is also pending:
available role declarations and private evidence do not prove authenticated
identity, independent sessions, or independent API/SQL read identities.

## Charter registry

The registry contains five initial bounded charters. Every charter supports all
three locales and declares its own platform, connector, role, fixture, reset,
action, evidence, and exclusion contract.

| ID                               | Surface           | Role(s)                | Scope                                                                          |
| -------------------------------- | ----------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `EXP-COMPACT-KEYBOARD-SCROLL`    | iOS, Android, web | professional           | Compact training builder keyboard, measured scroll, and search reachability    |
| `EXP-INTERRUPTED-DRAFT-RELAUNCH` | iOS, Android      | professional           | Local draft interruption, relaunch, discard guard, and saved-state distinction |
| `EXP-VALIDATION-SAVE-RECOVERY`   | iOS, Android, web | professional           | Validation, one scoped save failure, retained draft, and one retry             |
| `EXP-PERMISSION-FALLBACK`        | iOS, Android, web | student                | Camera denial and manual relationship-code fallback                            |
| `EXP-TWO-ROLE-CONSISTENCY`       | iOS, Android, web | professional + student | Pending-to-active connection across independent role sessions                  |

The charter files are machine-validated before a context is accepted. Their
requirement paths must be canonical repository files, and the scenario source
references must come from the charter requirement references. A charter must
also contain:

- exactly the T16 budget of 30 minutes or 100 UI actions, stopping at the first
  limit;
- a two unchanged-failure limit for an unchanged branch;
- explicit allowed actions and excluded external effects;
- an integration or fixture mode, a reset strategy, and declared role IDs;
- private evidence policy (`0700` directories, `0600` files, raw evidence kept
  private, and status-only public summaries); and
- source-backed preconditions, actions, and expected observations.

The registry is not a second product inventory. It points to the existing
screen, test-case, business-rule, and plan documents. If an expectation is
missing or contradictory, the later run records a documentation gap and keeps
the source facts; it does not edit the expectation merely to make an
observation pass.

## Context contract

An optional context file is an owner-supplied declaration, not a qualification
receipt. It must contain `schemaVersion: 1`, the requested `platform` and
`locale`, and these sections:

```json
{
  "schemaVersion": 1,
  "platform": "ios",
  "locale": "en-US",
  "target": {
    "status": "available",
    "id": "owned-target-id",
    "evidencePaths": [".qa/artifacts/prior-run/target.private.json"],
    "platform": "ios",
    "selector": "owned-target-selector",
    "appIdOrOrigin": "com.edufelip.mychampions.dev",
    "apiOrigin": "http://127.0.0.1:43101"
  },
  "build": {
    "status": "available",
    "id": "owned-build-id",
    "evidencePaths": [".qa/artifacts/prior-run/build.private.json"],
    "binarySha256": "<64 lowercase hex characters>"
  },
  "connector": {
    "status": "available",
    "id": "owned-connector-id",
    "evidencePaths": [".qa/artifacts/prior-run/connector.private.json"],
    "name": "maestro",
    "version": "2.6.1"
  },
  "roles": [
    {
      "status": "available",
      "id": "professional",
      "evidencePaths": [".qa/artifacts/prior-run/fixture.private.json"]
    }
  ],
  "fixture": {
    "status": "available",
    "id": "owned-postgres:exploration:compact-keyboard-scroll",
    "evidencePaths": [".qa/artifacts/prior-run/fixture.private.json"],
    "mode": "integration"
  },
  "reset": {
    "status": "available",
    "strategy": "fresh-professional-training-draft-per-attempt",
    "verified": true,
    "evidencePaths": [".qa/artifacts/prior-run/reset.private.json"]
  }
}
```

The example is a shape, not evidence. The placeholder hash is not a valid
context value. Available resources require an identity and existing canonical
evidence paths. Unknown or unavailable resources must carry no identity or
evidence, and the preparation result remains blocked. A missing context creates
an explicit unknown context so the artifact can be reviewed without pretending
that a target exists.

The context parser rejects unknown fields, path escapes, symlinked files,
credential-bearing URLs, tokens, cookies, passwords, authorization headers,
private keys, and secret-like values. A supplied context file and every supplied
context evidence file must be a canonical regular file owned by the current
user, mode `0600`, with an immediate canonical parent directory owned by the
current user and mode `0700`; public README or documentation files are not
evidence. API origins must be an HTTP(S) origin without credentials or a path.
For local `integration` preparation, the API origin must also use a loopback
host (`localhost`, `127.0.0.0/8`, or `::1`); production and shared origins are
rejected. This origin check only protects preparation input; an owned runtime
and backend still require independent T16-B qualification. Target/build/tool
IDs, roles, and fixture identities are written only to the private preparation
record; the resumable coverage summary contains availability statuses and
requirement references rather than device identities or credentials.

## Artifact contract

Each preparation creates a new empty directory below `.qa/artifacts/` and sets
its mode to `0700`. It refuses to reuse a non-empty directory, follow a
symlink, or write outside the repository's QA artifact root. It emits:

```text
<artifact-root>/
├── preparation.private.json  # full validated context and private policy
├── exploration.md            # redacted preparation summary
├── coverage.json             # resumable schema with no attempts/observations
├── bugs.md                   # explicit “none — exploration not executed”
├── doc-changes.md            # preparation-only documentation note
└── evidence/                 # empty private evidence directory
```

All emitted files are `0600`; the evidence directory is `0700`. Preparation
sets `attempts`, `observations`, `evidencePaths`, and `bugs` to empty arrays.
The coverage scenario is `blocked` with `PREPARATION_ONLY`, including when all
prerequisites are available. No screenshot, hierarchy, API response, SQL
result, or connector output is synthesized.

An `available` declaration is never a qualification receipt. The preparation
record exposes pending independent runtime requalification for the target,
build, tool, locale, roles, fixture, and reset. It also marks authenticated
role/session proof as pending and records that budget enforcement is deferred to
T16-B.

The later execution artifact must append attempts rather than overwrite this
preparation record. It must preserve the first failure, exact target/build/
fixture/locale identity, cleanup result, and raw evidence privately. A
shareable report may expose only redacted statuses, counts, hashes, and paths
that have been approved for that boundary.

## T16-B budget policy source

`scripts/testing/exploration-budget-policy.ts` provides the deterministic permit policy for the fixed budgets. The execution owner must call it before every actual UI action, including qualification navigation, and settle every result; failed, blocked and cancelled attempts count. It rejects overlapping, foreign and duplicate completions and stops immediately after two failures with unchanged semantic input/observation hashes. Changed input or observation and successful controls reset the relevant failure sequence. A monotonic deadline is inclusive at 30 minutes, and action 101 is refused. Cancellation and invalid monotonic clocks fail closed.

This policy is not an execution controller, evidence ledger, connector qualification or cleanup receipt. The execution adapter must enforce the deadline during an in-flight connector call, stop/audit owned resources and preserve recovery evidence if a call does not cooperate. A permit must never be counted as a UI observation or product pass. Actual exploration, connector wiring and T17 conversion remain Pending.

## T16-B execution gate

Before any action, the execution owner must independently verify:

1. the current target/device/browser and platform, with no foreign resource or
   competing native run;
2. the app/build binary and loopback API origin against current private evidence;
3. the pinned Maestro MCP/CLI or Playwright connector, its exact version, and
   its target-selection capability;
4. the declared locale, role(s), fixture mode, fresh reset, and independent
   authenticated role/session plus API/SQL read identities; and
5. cleanup ownership, deadlines, cancellation behavior, and the artifact root.

The owner then qualifies a read-only screenshot/hierarchy observation and one
reversible navigation action before beginning the selected charter. Connector
availability, a generated flow, a screenshot, or an agent opinion alone is not
an exploration result. The connector must be stopped and the owned target and
backend must be independently audited after the run.

For each actual UI action, append a timestamp, previous visible state, chosen
action, resulting visible state, request result when applicable, and evidence
reference. Count failed, blocked, cancelled, and cleanup-failed attempts. Stop
at 30 minutes or 100 actual UI actions, whichever comes first. If the same
branch fails without a changed input or observation, stop after two attempts;
retain both receipts and classify the branch as product, documentation,
fixture, selector, connector, or environment failure.

A suspected product finding requires two fresh reproductions and a successful
control. Compare the result with the cited requirement before calling it a
defect. A confirmed finding proceeds to T17 at the cheapest deterministic
layer, with the original observation evidence preserved. If no finding is
confirmed, record the explored and unexplored scenario IDs and use a separate
temporary controlled regression to demonstrate conversion; never invent a
customer defect.

Experimental AI screenshot assertions may assist discovery but remain outside
required pass counts. Do not auto-heal selectors, approve visual baselines,
post bugs, create schedules, or mutate external systems from the exploration
agent.

## Wiring proposed for the owning task

The owning task may add the `qa:explore:prepare` package alias and route this
playbook from `.agents/qa-project-context.md` after the focused preparation
checks pass. That wiring is intentionally left to the parent task because this
packet does not edit package scripts, context routing, inventory manifests,
schemas, CI, or the shared modernization task card. The package alias must
remain preparation-only until T16-B has a qualified execution adapter and
current target evidence.

This packet changes test infrastructure and QA documentation only. It does not
change product behavior, backend APIs, persistence schemas, authentication,
permissions, localized copy, or production/provider configuration.

### 2026-10-02 Maestro MCP v8 canonical source integration

MCP v8 is independently clear at the source boundary. Root integration is
**In progress**: retain exact reviewed stdio source in
`scripts/testing/owned-maestro-mcp-stdio.ts` and discover its generic Node controls
in `tests/ci/owned-maestro-mcp-stdio.test.ts`. Only the test import and ESM fixture
source location change for canonical paths. Current-project checks follow.
The four v7 blockers are fixed, including post-close on-disk SHA verification
and same-length mutation rejection. Worker I/O/cancellation/deadline/cap/late
response authority stays strict. This starts no Maestro/device/ADB/backend/cloud
resource and produces no native/public/exploration qualification. No product,
auth, provider or localized copy changes are needed. Full runtime/T16 remains
Pending a separate owned preflight and actual receipts. Proof:
`mcp-v8-reviewed-source-integration-2026-10-02-v1`.

### 2026-10-02 Maestro MCP v8 source qualification

Canonical integration is **Done (source, independently reviewed)**. Exact reviewed
source bytes and the two canonical test path rewrites pass full isolated TypeScript,
canonical zero-warning lint, formatting and 40/40 controls. Both test inventories
now contain 383 files (320 client, 63 server). Actual pinned Maestro server
qualification is Pending a fresh owned protocol preflight; tools/call, device
flows, native/public qualification, cold comparison and exploration stay Pending.
No source check creates a runtime pass. Proof:
`mcp-v8-reviewed-source-integration-2026-10-02-v1/root-source-validation.private.json`.

### 2026-10-02 current MCP v8 source / v9 short protocol receipt

T16-B current canonical MCP v8 source (`e8a887c8…`) has a fresh v9 **locally
qualified short protocol / cleaned / independently root-sealed** receipt. The
actual owner run uses the genuine shared host-lock wrapper, JDK 17.0.19 and
192 pinned jars. Exactly initialize, initialized notification and tools-list
produce five envelopes and nine tools; no tools/call, device, ADB, backend,
flow or exploration is invoked. Final close/drain has exit 0, null signal,
no protocol/rejected/dropped/late failure, absent owned process group and sockets.
Root verifies 25 original artifacts, 289 frozen inputs and one PID/start pair,
then reopens the actual 10,416-byte spool and transcript for exact SHA-256/bytes.
This is protocol qualification only; native/public/exploration passing cases stay
zero. Device/tool-call/flow qualification, cold comparison and protected hosted
adoption remain Pending. The historical v5 receipt remains immutable for its
older source. The initial root seal rejected an unresolved packet-relative
projected spool path; resolving it beneath the owned packet completed read-only
verification without rerunning the resource. Proof:
`t16-b-direct-stdio-runtime-2026-10-02-v9/root-sealed-terminal.private.json`.
No product, provider, auth or localized copy changed; FR/UC/AC/BR/screens need no
update for this QA protocol receipt.
