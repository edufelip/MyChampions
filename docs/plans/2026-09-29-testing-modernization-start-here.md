# Testing modernization: implementation entry point

Date: 2026-09-29; planning clarification: 2026-09-30. Scope: BL-018 / D-219,
MyChampions client and sibling server.
Status: planning guide. This change implements no runtime behavior and changes
no task status. Reuse existing work and check its evidence for freshness.

Recommended end state: Node/Bun for logic, Jest/RNTL for rendered interactions,
Playwright for browser journeys, real isolated Postgres for persistence, and
Maestro for native scenarios that pass the comparison gates. Retain Detox until
each proposed replacement qualifies. Use agents to explore and propose
regressions; saved deterministic tests decide pass/fail.

This is the execution guide for the existing BL-018 plan, not a second backlog.
The specification owns T00–T20 acceptance; the task card owns actual progress.
Read the following work order before the historical implementation handoff.

## 0. Follow this work order

The specification defines **what must pass**. This guide defines **how to
implement it**. The task card records **what has actually passed**. File
existence, a generated flow and a passing validation test are different facts.

### Bootstrap for an implementing agent with no prior context

Follow these instructions literally. This is the entry point for the existing
T00–T20 backlog; do not create another testing migration or infer that every
task is incomplete because this is your first session.

1. **Locate the owners.** The client owns components, browser/native journeys,
   inventories and client CI. The sibling `../server` owns disposable Postgres,
   migrations, seed/reset, API lifecycle and server tests. Food/exercise services
   are catalog boundaries in this pilot; changes to their product/provider
   behavior are outside BL-018. Read the applicable ancestor and repo instructions.
2. **Establish the baseline.** Record HEAD and dirty files in both repositories.
   Include untracked files when inspecting the existing implementation. Resolve
   attached worktrees and their source snapshots before choosing where to edit.
   A clean Git HEAD does not identify a dirty build's actual inputs.
3. **Select one task.** Read the task card's Status and Acceptance matrix, then
   specification Section 15's dependency row. Reconcile a stale “next” paragraph
   against original terminal receipts before acting. A prerequisite needs the
   evidence required by its exit gate, not merely its implementation files.
4. **Write one packet.** Fill Section 3's worksheet with actual paths, documented
   assertions, commands, target and cleanup. An unknown field stays unknown.
   Preparation can proceed with missing runtime prerequisites only where this
   guide permits it; execution waits for those prerequisites.
5. **Implement and prove.** Reuse the named helper, make the bounded change,
   run meaningful focused controls and required quality checks. Then execute
   the actual layer under test and its failure/restoration/cleanup controls.
   Apply the failure table in Section 3; preserve every original outcome.
6. **Record and continue.** Update the existing task card with implementation,
   local execution and hosted proof as separate facts. Select the next eligible
   packet. A single training proof does not complete T13, T14 or the migration.

Do not run a resource-acquiring command until the packet lists its exact owner,
app/API origin, fixture/reset, platform/device/build, deadline and cleanup audit.
Do not execute an interface labelled **planned** until it has an implementation,
argument validation and applicable focused controls. Section 8 lists inspected
commands; target commands in the specification describe interfaces to deliver.

Use this task-selection algorithm; the specification's dependencies prevail:

```text
read current task card and original receipts
for task in T00..T20:
  if all of task's required evidence is current:
    reuse it; do not rerun only to recreate history
  else if the next bounded packet has satisfied prerequisites:
    implement -> validate -> execute applicable controls -> document
    restart selection using the updated task card
  else:
    record the missing prerequisite and its owner
    inspect explicitly allowed independent preparation
finish only when specification Section 12 is satisfied
```

The algorithm does not permit skipped gates. A blocked session/auth decision,
unavailable native host or unapproved hosted dispatch leaves that dependent
acceptance open while eligible independent preparation continues. Do not turn
elapsed time, repeated retries or a scope reduction into approval or success.

### Deliver these six outcomes, in order

1. **Know what each test proves.** Inventory assertions and their requirements.
   Keep deliberate architecture checks; replace UI source matching only after a
   rendered behavioral test detects the same regression.
2. **Own the backend environment.** Use the sibling server's real migrations,
   isolated Postgres and deterministic fixtures. Prove guards, concurrency,
   durability and cleanup before depending on this environment in UI tests.
3. **Prove rendered and browser behavior.** Add targeted component tests;
   consolidate browser configuration without changing discovery; run the five
   integrated journey families against the owned server.
4. **Qualify native automation.** Map actual native states and selectors, prove
   the runner lifecycle, then run equivalent Maestro and Detox journeys on iOS
   and Android. Decide from measured per-cell evidence.
5. **Add bounded exploration.** Give the agent a verified target and charter;
   record actual actions and convert confirmed defects into deterministic tests.
6. **Promote proven lanes and audit.** Preserve CI trust and stable check names;
   obtain exact-revision hosted evidence; retire only individually eligible
   tests. Apply the specification's final completion checklist.

Section 4 maps these outcomes to T00–T20 and their exit evidence. Section 5
defines the five journey families. Section 3 is the work-card template and
Section 9 is the copyable implementation prompt. These are one migration,
not six alternative projects. A phase can end with a measured decision to
retain existing tooling; it cannot end with invented or missing evidence.

**First implementation packet:** read the task card's current dispatch and verify
its latest attempt against original terminal receipts, then
use Section 6. The Android training mapper, private adapter and platform-bound
staging now exist. Packet 0's owned recovery/census fixes and bounded controls
are implemented; actual full native runtime/staging qualification remains open.
Read the latest task card before reusing Packet 0 or the delivered Packets 1–3,
then choose the first unmet runtime, failure or lifecycle qualification packet.
Do not repeat Packet 4 if its required clean runtime is already qualified at
current inputs. Do not begin by installing a second test framework,
recreating the delivered backend harness, deleting Detox, or running the
comparison. Section 6 breaks this remaining work into reviewable
steps; the full T00–T20 sequence in Section 4 remains required.

Use this procedure on every new session:

1. Read the task card's first work card and Acceptance matrix. List its remaining
   acceptance checks; retain historical failures and completed work.
2. Inspect the named implementation files and applicable AGENTS instructions.
   Refresh repository identities, dirty inputs and relevant receipt fingerprints.
3. Select one ready packet. Write its fixture, action, expected assertions,
   command, failure controls and cleanup resources using Section 3's template.
4. Implement in the repository that owns the behavior. Reuse its existing
   lifecycle and data helpers. Make one reviewable change at a time.
5. Format changed source, regenerate affected declarations, then execute focused
   checks and the applicable quality commands in Section 8.
6. Freeze captured source, helpers, requirements, fixture and configuration
   inputs before a native run. Check host contention. Launch one owned attempt
   and observe that same attempt until its terminal result and cleanup audit.
7. Compare requested versus executed assertion IDs. Independently verify durable
   results and owned resource absence. Preserve the original receipt and logs.
8. Update the task card with implemented, locally verified and pending facts,
   affected docs, the first failure and next eligible packet. A blocked branch
   may leave independent preparation ready; it never becomes a passing cell.

For Android lifecycle/action packets, use
[handoff Section 14](2026-09-29-testing-modernization-implementation-handoff.md#14-current-android-lifecycle-work-order).
Recheck the task card first: this pointer is a dispatch instruction, not a
second status registry. Earlier iOS recovery recipes remain in the handoff;
reuse their delivered helpers and evidence when their prerequisites apply.

### Packet readiness and completion: evaluate these literally

Before editing, write one concrete packet with one owning repository, its existing
files, documented expected behavior, prerequisite receipts, requested assertion
IDs, execution command and cleanup checks. Use Section 3's work card. A packet
may implement several closely related files; it may not silently expand into
another product behavior or replace an existing harness.

```text
READY_TO_IMPLEMENT = owner instructions read
  AND expected behavior established from authoritative documents
  AND existing implementation inspected
  AND prerequisites identified (including missing evidence)
  AND changes bounded to one review unit

READY_TO_EXECUTE = READY_TO_IMPLEMENT
  AND applicable prerequisites have current evidence
  AND exact target, fixture, flags, locale and build established
  AND exact supported command, deadlines and failure controls reviewed
  AND owned cleanup audit prepared
  AND no conflicting live attempt uses these inputs

PACKET_VERIFIED = every requested case and assertion actually executed
  AND every required outcome matched (including expected negative controls)
  AND required independent state checks passed
  AND cleanup and input stability independently proved
  AND original outcomes and evidence retained
  AND affected documentation and task card updated
```

If an execution predicate is false, record the precise dependent blocker and
continue an eligible preparation packet. A negative control's expected nonzero
exit verifies that control; it never becomes a passing product journey. A packet
can be implemented without being locally verified; local verification does not
establish hosted enforcement. Full completion still requires every specification
Section 12 gate, including the comparison and authorized hosted evidence.

### Implementation checkpoints: choose the next task mechanically

Use this table to turn a phase into a small change. Existing files are reuse
targets, not proof of completion. All paths below are relative to the owning
repository. The Section 4 task table and specification remain authoritative.

| Task group | Inspect and reuse before editing                                                             | First bounded action                                                                                                | Evidence required before progressing                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| T00–T01    | `scripts/testing/inventory-tests.mjs`, `docs/qa/test-inventory-v1.json`, impact registry     | Review one assertion family and link each expectation to its requirement; refresh the complete inventory            | File completeness plus reviewed purpose and explicit unmapped rows; a source scan alone is insufficient                                            |
| T02–T04    | Server `infra/docker-compose.test.yml`, `scripts/testing/`, `tests/helpers/test-database.ts` | Verify ownership rejection before running a real migrated/seeded DB attempt                                         | Safe-target rejection, independent concurrent identities, durability and terminal cleanup controls                                                 |
| T05–T08    | `jest.component.config.cjs`, `tests/component/`, replacement ledger                          | Exercise one rendered control through its real handler; mock only native/transport boundaries                       | Controlled regression fails, exact restored source passes, replacement IDs account for each retired assertion                                      |
| T09–T11    | `e2e/web/support/test-profiles.ts`, profile factory, integration runner/specs                | Compare discovery/config before and after one alias migration; then run one real-server journey                     | Same selected cases/settings; correct API origin, no bypass, independent SQL and terminal cleanup                                                  |
| T12        | `docs/qa/native-pilot/`, declaration generator, platform capture helpers                     | Inspect one actual platform/state tree and link its selectors to a documented branch                                | Current screenshot/tree/target inputs; unresolved and stale states remain in the denominator                                                       |
| T13        | `run-native-pilot.ts`, Android/iOS attempt adapters, owned-resource helpers                  | Qualify the earliest unmet normal/failure/cancellation boundary in one adapter                                      | Original engine outcome, complete required assertions, independent ownership/cleanup; synthetic controls do not close runtime gates                |
| T14        | Training driver/evidence helpers, canonical native inventory and retained Detox specs        | Implement one missing family/branch with the same UI/API/SQL assertion IDs in both engines                          | Both platforms and engines execute equivalent integrated outcomes; negative mutation detected and exact restore passes                             |
| T15        | Native receipts and comparison contract                                                      | Freeze a cohort, then collect balanced cold attempts per cell                                                       | Complete 400-attempt minimum cohort, at least 19/20 first passes in each eligible cell, zero unexplained failures/leaks                            |
| T16–T17    | `.agents/qa-project-context.md`, exploration playbook/charters when implemented              | Verify an actual connector target, run one charter, reproduce/classify a finding and add a deterministic regression | Actual actions and evidence; two fresh reproductions/control; regression detects before fix and passes afterward                                   |
| T18–T20    | Trusted workflows, `config/test-impact.json`, migration ledger and task card                 | Wire only a locally qualified lane, verify exact-revision hosted runs, then audit retirement eligibility            | Trust/status contracts unchanged; exact client/server revisions; three protected successes over two app revisions before eligible Detox retirement |

For every row, split implementation, runtime verification and promotion into
separate reported facts. A path in the table that does not exist yet is a
deliverable; inspect for an equivalent before creating it. Do not call a planned
command or duplicate an existing helper.

### A concrete test recipe every agent must write before coding

Use the training family as the model; substitute each family's documented
preconditions and assertion IDs. Obtain canonical quantities/IDs from the
inventory and fixture contract, rather than inventing new test data.

1. **Arrange:** owned disposable backend; authenticated coach; known catalog
   exercise; fixed locale/flags; no pre-existing target plan. Record a scoped
   SQL snapshot, including unrelated rows that must remain unchanged.
2. **Act:** normal UI create, choose exercise, enter the canonical quantity,
   save, edit, save again, terminate/relaunch and reopen from the library. A
   seed may establish the starting account/catalog; it may not perform the
   create/edit action being tested.
3. **Assert:** exact UI title, exercise and quantity at each required step;
   authenticated API reads and independent SQL agree; one intended plan exists;
   ownership and unrelated rows remain correct. Preserve all seven canonical
   training assertion IDs rather than replacing them with a success toast.
4. **Detect:** in an isolated revision, temporarily change the quantity render
   while leaving expected assertions fixed. The original engine assertion must
   fail. Record native target/health and complete cleanup to distinguish this
   deliberate product failure from a broken environment.
5. **Restore:** restore exact pre-mutation source bytes, build under the normal
   freshness rules, then rerun against fresh app/data state. Retain both failed
   and restored receipts. Do not carry mutation inputs into comparison samples.
6. **Release:** independently check owned processes, ports, DB/Compose, device,
   temporary directories and preserved foreign resources. A passing UI sequence
   with unknown cleanup cannot pass the packet.

Translate this recipe into the chosen test layer. Component tests verify
rendered interactions; integrated browser/native tests add real transport and
durability. Do not claim SQL or native proof from a component mock.

### Comparison collection and tool decision

The minimum cohort is **5 families × 2 platforms × 2 engines × 20 attempts =
400 integrated attempts**. Additional branches, locales or data modes create
additional cells. Never pool them to meet the minimum. Reusing a build is allowed
only where the existing byte/input qualification permits it; cold attempts
still require fresh app and fixture state.

Before collecting samples, freeze source/build/helper/requirements/fixture/tool
inputs and write the complete planned cell list. Alternate Maestro/Detox order
within each platform/scenario cohort to reduce ordering effects. If an input
changes, retain the old cohort and start a new one; do not merge their samples.

For each attempt, retain the requested and executed assertion IDs, first child
outcome, failure classification, duration by phase, verification and cleanup.
A diagnostic retry is a new linked attempt and does not improve the original
first-pass count. Report every requested attempt, including blocked/cancelled
ones. Twenty greens selected from a larger failed history do not qualify.

Decide per scenario:

- **Migrate:** equivalent assertions; at least 19/20 first passes; no unexplained
  failure or leak; measured setup/maintenance benefit. Explain a duration
  difference above 20%. Retirement additionally waits for the hosted gate.
- **Retain Detox:** measured capability/reliability/maintenance favors the
  existing test. Record the evidence and keep its CI selection.
- **Blocked:** missing or incompatible inputs, unresolved behavior, insufficient
  samples or unmet acceptance. Name the exact dependent task and next action.

### Resume safely when a historical handoff says a process is live

An old tool session number is not a transferable process handle. Check immutable
terminal snapshots and capture/adapter receipts first, then current PID/start
identity and resource ownership. Observe a verified live attempt; never launch
a duplicate merely because a previous message is old. Once terminal, preserve
its original failure and qualify cleanup before a changed-condition attempt.

For the current isolated Android failure packet, distinguish application
readiness from build/install success. Inspect the original readiness screenshot,
Metro output and dependency layout before editing selectors or deadlines.
Verify bootstrap can resolve the Expo Router entry from the isolated project
root before another expensive native qualification. Any repair must preserve
the original dependency/source provenance and be recorded as changed inputs.
Then complete detecting/restored failure qualification and the remaining public
runner/lifecycle gates; do not recreate the delivered assertion mapper.

## 1. Target architecture and tooling decision

| Question                                        | Tool / lane                                         | Passing evidence                                                           |
| ----------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| Is domain logic or architecture policy correct? | Existing client Node/tsx and server Bun             | The asserted logic or prohibition                                          |
| Does a rendered control behave correctly?       | Existing Jest/Expo/React Native Testing Library     | Component state and interaction under declared boundary mocks              |
| Does the server persist and enforce ownership?  | Real server + disposable Postgres                   | API outcomes and independent durable state                                 |
| Do browser journeys work?                       | Existing Playwright fixture and integrated profiles | Declared browser behavior; durable state only in integrated mode           |
| Do native journeys work?                        | Maestro pilot compared with retained Detox          | Equivalent simulator/emulator UI/API/SQL assertions                        |
| What unexpected problems exist?                 | Bounded agent exploration                           | Actual observations; confirmed findings converted into deterministic tests |

Keep Node/Bun and Playwright. Extend the existing rendered/integration harnesses.
Adopt Maestro only where measured correctness, reliability and maintenance
justify it; retaining Detox is an acceptable final decision. Agents supplement
regressions and do not decide CI passes.

Keep three mechanisms separate: `maestro test` executes saved deterministic
flows; an agent uses Maestro MCP to choose exploratory actions; Maestro's AI
commands send screenshots for model analysis. The initial design uses the
first two. MCP capability and exact device targeting must be qualified before
exploration; installing the server does not perform an exploration run. Do not
enable AI analysis/upload commands as part of deterministic test setup.

Maestro supports React Native through native accessibility and offers an MCP
server for coding agents. Pin and verify actual CLI/MCP capabilities before use;
documentation alone does not establish a connected target. Sources:
[React Native support](https://docs.maestro.dev/get-started/supported-platform/react-native),
[Maestro MCP](https://docs.maestro.dev/get-started/maestro-mcp).
Required outcomes use deterministic assertions. AI assertions remain exploratory
aids: [assertWithAI reference](https://docs.maestro.dev/reference/commands-available/assertwithai).

## 2. Authority and reading order

This guide dispatches work; it creates no second specification or progress registry.
If documents conflict, stop the affected packet and reconcile them first.

1. Read applicable `AGENTS.md` instructions in each owning repository.
2. Read [the task card](../qa/testing-modernization-task-card.md), especially
   Status and Acceptance matrix. Recheck receipt source, requirements, fixture,
   build and flag fingerprints before treating historical results as current.
3. Read [the specification](2026-09-28-testing-structure-and-maestro-plan.md),
   Sections 2–3, 15–17 and the chosen task's phase.
4. Read [the implementation handoff](2026-09-29-testing-modernization-implementation-handoff.md),
   Sections 0, 10–13 for reuse paths, decisions, work cards and detailed recipes.
5. Read the behavior's linked screen, FR, UC, BR, AC and TC documents, then code
   and tests. Qualify duplicated TC IDs with their document path.

Client: `/Users/eduwaldo/Projects/MyChampions/mychampions`.
Server: `/Users/eduwaldo/Projects/MyChampions/server`.
Current backend is the MyChampions server with Postgres/Drizzle and server-managed
storage. Firebase runtime terminology is retired context. Do not create a
replacement backend inside the client.

## 3. Mechanical execution procedure

1. Record both HEADs and dirty paths; preserve unrelated changes and live runs.
2. Inspect actual package scripts, existing helpers and receipt freshness.
3. Choose the earliest unmet task with current prerequisites. Independent
   preparation is allowed only where the handoff permits it; preparation cannot
   close runtime acceptance.
4. Fill the work card below. Implement one bounded review unit using existing
   owner helpers; record justified path substitutions.
5. Execute required acceptance and negative controls. Retain the first failure
   and every attempted case. Fix or classify failures before progressing.
6. Update the existing task card and affected docs, then choose the next ready
   packet. Do not restart P0 because a new agent takes over.

```text
Task / packet:
Owning repo and paths to reuse:
Current prerequisites and receipt paths:
Requirement IDs AND document paths:
Fixture, role, locale, flags, platform, build:
Action under test:
Required UI / API / SQL assertions:
Failure controls, commands and deadlines:
Acquired resources and cleanup proof:
Requested / executed cases and first-attempt outcomes:
Affected docs or reason no update is needed:
Blocker, owner, and next eligible packet:
```

### Diagnose the first failure before selecting the next action

| Observed condition                                          | Required next action                                                                                                              | Evidence that permits progression                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Requirement missing or documents contradict each other      | Retain expected/observed facts; create the decision entry in the existing task card and discovery docs; continue independent work | Authoritative decision plus updated affected contracts; code behavior alone cannot decide the expectation                  |
| Test command is absent or selects zero cases                | Inspect package scripts and discovery; implement or repair the declared interface in its owning task                              | Exact requested cases discovered and actually executed; zero selected tests is not success                                 |
| Application assertion fails on a healthy owned target       | Keep the original child outcome, screenshot/tree and API/SQL state; reproduce or qualify the deliberate regression                | Documented expectation and decisive original evidence; a fix must have its own fresh detecting/restored receipts           |
| App bootstrap, API origin, device or tool identity is wrong | Inspect original readiness logs, configuration, entry resolution and binary identity before editing tests                         | Correct target/health and current inputs; build/install success alone cannot prove readiness                               |
| Selector cannot see a control                               | Inspect the actual hierarchy/state; use the existing selector or a narrowly documented testability fix                            | Current native/browser observation and a test of the actual interaction; no coordinate fallback or weaker assertion        |
| Foreign native job or resource occupies the host            | Do not acquire conflicting resources; retain the blocked attempt and recheck before a changed-condition attempt                   | Uncontended acquisition with a newly recorded baseline; never terminate the foreign resource                               |
| Cleanup fails or resource ownership is uncertain            | Preserve the failure and recovery ledger; inspect recorded identity before any owned recovery                                     | Independent proof of owned resource absence; recovery does not rewrite the original failed attempt or foreign-state result |
| Focused checks pass but full quality fails                  | Record both outcomes and the exact failing case; diagnose in the owning scope                                                     | The required quality gate passes or remains explicitly pending; no silent skip or hidden exclusion                         |
| Local lane passes but hosted receipts are absent            | Prepare reviewable CI wiring and the exact revision/run request under T18                                                         | Authorized hosted execution at the required client/server revisions; checked-in workflow YAML is insufficient              |

This table is operational guidance, not a replacement for the wrapper result
schema. Public wrappers preserve child outcomes and distinguish application
failure from invalid-input/harness blocks. Keep requested/executed assertion IDs,
first-attempt status, diagnostic retries and cleanup results in every report.

### Contract changes and rollback belong to the owning task

Keep existing public product APIs, database schemas, auth/ownership rules and
locale behavior unchanged unless a separately established decision authorizes
the behavior change. Use canonical server migrations and fixtures, not a new
public seed/reset endpoint. Boundary mocks must not replace the action or
durability being asserted.

For each review unit, list the old command/config/test that remains available,
its replacement and the rollback action. Preserve browser aliases until callers
are migrated. Keep Detox selectable during the pilot and comparison. Introduce
CI lanes separately so an unqualified lane can be disabled without weakening
existing required checks, selection or trust rules. T19 alone determines which
individual Detox scenarios can retire; keeping Detox is a valid measured result.

Planning has no product rollback: this document changes no executable behavior.
Implementation packets must document their actual rollback before promotion.

## 4. Implementation sequence and exit gates

Use existing T00–T20 IDs. The task card owns progress; this table defines work.

| Tasks                 | Concrete implementation                                                                                                                                                                                         | Required exit evidence                                                                                                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T00–T01: baseline     | Refresh identities; reuse `scripts/testing/inventory-tests.mjs` and `docs/qa/test-inventory-v1.json`. Classify assertions individually by purpose/layer.                                                        | Complete fresh inventory; unmapped requirements explicit; no test deleted merely because it reads source                                                                                                          |
| T02–T04: backend      | Reuse server `scripts/testing/`, `infra/docker-compose.test.yml`, `tests/helpers/test-database.ts`. Guard destructive entrypoints; acquire, migrate, seed, verify, reset and release owned DB/API resources.    | Unsafe/default/remote/mismatched target rejected before writes; concurrent isolation; real writes, denial, restart, SIGINT/SIGTERM and cleanup                                                                    |
| T05–T08: components   | Reuse `jest.component.config.cjs` and `tests/component/`. Exercise support, role selection, exercise search and theme via rendered interactions. Mock transport/native boundaries, not asserted state/output.   | Actual execution; controlled regressions fail; restored source passes; removed assertions mapped to detecting replacements in ledger                                                                              |
| T09–T11: browser      | Reuse profile factory/aliases, `run-web-integration.ts`, owned session/proxy and `e2e/web-integration/`. Keep fixture, memory HTTP and Postgres claims separate.                                                | Config/discovery equivalence; actual correct API origin/no bypass; required browser/locale cells and fresh repeats; independent SQL; denial unchanged; cleanup                                                    |
| T12: native inventory | Reuse capture helpers, hierarchy parser, qualifier and canonical `docs/qa/native-pilot/` inventory/manifest. Observe iOS AND Android normal/error/retry/permission states and scoped locales.                   | Reviewed screenshots/hierarchy with current inputs; deterministic reset; stable selectors; unresolved rows retained; observations do not count as behavior passes                                                 |
| T13: native runtime   | Extend `run-native-pilot.ts`; reuse `owned-*.ts`, server lifecycle and host locks. Add build/install/reset/network/action/assertion adapters for both engines.                                                  | Actual smoke on both platforms; bad selection/target, child failure, deadline, cancellation and recovery controls; skipped assertions cannot pass                                                                 |
| T14: journeys         | Add focused `.maestro/flows/` and invariant subflows; retain equivalent Detox cases. Add requirement-linked assertion ledgers to canonical inventory and generate manifest.                                     | Equivalent source/fixture/flags/mode/assertion IDs; all UI/API/SQL outcomes on both platforms/engines; instrumentation-only binary differences documented                                                         |
| T15: comparison       | Collect immutable attempt receipts with `compare-native-pilot` or recorded equivalent; balance engine order; introduce/revert one detecting regression per family.                                              | Minimum 400 integrated cold attempts; each promoted cell ≥19/20 first passes, zero unexplained failures/leaks and equivalent assertions; migrate/retain/blocked decision                                          |
| T16–T17: exploration  | Add playbook, charters and prepare command using existing `.agents/qa-project-context.md` and QA artifact convention. Observe a real target, then convert a confirmed finding at the cheapest sufficient layer. | Action log; two fresh reproductions plus control for confirmed bugs; regression fails before fix/passes after; no-finding allowed with controlled-regression conversion demonstration                             |
| T18–T20: CI/audit     | Extend trusted workflows and impact registry after applicable local gates. Wire server integration, integrated browser and protected manual native lane. Audit docs, selection and migration ledger.            | Exact client/server SHA hosted receipts; stable trust/status names; requested cases actually executed; three protected successes across two revisions before eligible Detox retirement; final checklist satisfied |

Comparison baseline: five families × two platforms × two engines × 20 cold
attempts = 400 integrated attempts, before additional branches/modes/locales.
Count failed, blocked and cancelled attempts; never conceal retries or pool cells.
Report p50/p95 scenario time separately from build/install/reset/cleanup,
maintenance effort and diagnosis effort. Explain duration differences above 20%.
Adoption thresholds do not establish universal reliability.

Create the planned comparison cells before starting measurement. For each cell,
record scenario/branch ID, platform, engine, mode, locale, source and requirement
fingerprints, fixture/flags, target/build, assertion IDs and 20 requested attempt
slots. A blocked session decision stays in the matrix. Extra promoted branches,
modes or locales create extra cells; the 400-attempt figure covers only the
five-family integrated baseline. A code/fixture/requirement change starts a new
cohort for affected cells. Do not merge incompatible cohorts to reach 20.

## 5. Five journey recipes

Integrated cases use normal sign-in and the owned real server. Seed prerequisites
outside the action under test. Verify writes independently through fixed scoped
SQL snapshots; a success toast is insufficient.

| Family        | Arrange and act                                                                                                    | Decisive assertions                                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Session       | Signed-out completed-onboarding account → sign-in → terminate/relaunch → logout → relaunch                         | Same identity/role restored before logout; persisted local identity removed afterward; revocation remains decision-gated below      |
| Training      | Coach + canonical exercise → UI create → exact exercise/quantity → save → edit/save → relaunch/reopen from library | Exact UI/API/SQL values and ownership; no duplicate/unrelated mutation; use handoff Section 13-B's full action recipe               |
| Connection    | Unlinked supported student/professional → code → request → approval → inspect both roles                           | Pending before confirmation; both lists active afterward; exactly one durable connection; unrelated account denied without mutation |
| Camera denial | Established fresh permission state → OS request → deny → manual fallback → valid code                              | Actual native denial; usable fallback; real documented request outcome; mocked permission separately labelled                       |
| Save retry    | Valid unsaved draft → exact account-scoped pre-forward one-request fault → save/error → clear fault → retry/reopen | Failure leaves SQL unchanged; exact draft retained; retry yields one intended final durable result; UI/API/SQL agree                |

Initial-load, empty, offline, validation, discard and interrupted-navigation
branches come from the canonical inventory and linked requirements. Use stable
IDs/accessibility selectors, supported scrolling and bounded visible-state waits.
No coordinate/index fallback, arbitrary sleeps, optional core assertions,
secure-storage injection or fixture interception in integration mode.

## 6. First remaining work: Android recovery and training qualification

This is a work recipe, not a second progress registry. The task card's current
dispatch supersedes this section when work moves forward. The 2026-09-30
planning inspection found these interfaces and retained original execution
records; no native runtime was executed by this planning refresh:

- `run-native-pilot.ts` dispatches only integrated iOS/Maestro training.
- The Android capture, action driver, original-reader evidence validators,
  runtime-frame writer and independent cleanup inspector already exist.
- `prepareAndroidTrainingPilotEvidence`, `run-android-training-attempt.ts` and
  platform-bound staging now exist. Keep the strict iOS entry point. Android
  application-failure qualification and public dispatch remain unfinished.
- Retained focused logs show 68 passing controls, typecheck and scoped lint.
  Those controls validate harness contracts, not a native journey. The full
  unit command retains the missing password-reset confirmation route failure.
- Fresh bound attempts `d0253c91be01223dd242b770` and
  `251536411176d3e44c6e71cf` both stopped before the training callback.
  The second recorded entry-hierarchy child zero but parent harness-blocked,
  original cleanup failed and recovery retained. No Android assertion passed.
  Its private runtime root still existed at this planning inspection. An exact
  check of the recorded emulator/entry PIDs found none live; that is not a full
  resource-absence audit. Start with Packet 0, not another unchanged attempt.

Use [handoff Section 14-D](2026-09-29-testing-modernization-implementation-handoff.md#d-next-packet-android-public-training-after-the-lifecycle-gate)
for the retained Android prerequisites and
[specification Section 16](2026-09-28-testing-structure-and-maestro-plan.md#16-machine-readable-runner-and-resource-contracts)
for schemas. Reuse the same helpers; do not build a parallel runner.

### Packet 0 — Resolve retained ownership and command census

**Owner:** client. **Reuse:** `scripts/testing/owned-process-group.ts`,
`native-cleanup-evidence.ts`, `owned-android-emulator.ts`,
`verify-owned-android-cleanup.ts`, `owned-android-port.ts`, and their existing
`tests/ci/` suites. Read the capture's owner records and the server manifest
before touching resources. This packet changes harness behavior only.

**Original evidence:** `.qa/artifacts/native-pilot/251536411176d3e44c6e71cf/`
and the original controller's `bound-training-v2/` under
`.qa/artifacts/testing-modernization/android-lifecycle-extraction-2026-09-29/`.
Do not edit these receipts, ledgers or controller source before preserving its
bytes against the original intent. Use a fresh exclusive recovery record.

1. Inspect every ownership ledger, including controller, commands, emulator,
   ADB, backend, proxy and Expo. Collect all observed PID/start pairs from both
   `processes` and `commandCensusRequeries.unavailable/current`. Diagnostic
   observations expand absence checks; they do not authorize signals. Keep two
   different starts for a reused PID separate. Inspect all declared directories,
   reserved ports, devices, cache and Docker resources independently.
2. If a resource survives, re-establish its recorded ownership using current
   identity and its existing owner helper before releasing it. An unavailable
   command, changed UID/start/command, changed root inode or unknown manifest
   keeps that branch blocked. Never signal an unverified group or delete from
   a path prefix alone. If processes are absent, separately validate canonical
   root, nonce, UID, recorded directory dev/inode and manifest before removing
   only the six owned directories. Preserve the owner ledger and original
   failure; prove absence after removal. Check the borrowed ADB and foreign
   device/AVD boundaries without altering them.
3. Diagnose the two censuses in `owned-process-group.ts`. Darwin parenthesized
   command output represents unavailable argv, not proven process exit or a
   verified executable. Preserve bounded one-requery behavior. Check caller,
   UID, PID/start and ownership constraints on both observations before either
   can influence authority. A disappearing diagnostic row must remain in
   historical cleanup evidence. A persistent unavailable row remains blocked.
   Do not suppress it, increase deadlines, add open-ended retries or treat a
   placeholder hash as a legitimate executable transition.
4. Extend `ownershipProcesses` to conservatively validate and include every
   historical diagnostic PID/start pair, while retaining old-ledger support.
   Malformed present diagnostics reject; missing diagnostics in an older
   record do not fabricate processes. Preserve iOS cleanup compatibility.
5. Add meaningful controls: transient unavailable row remains in history;
   persistent unavailability blocks; diagnostic-only live pair fails absence;
   foreign UID/caller cannot become owned after requery; reused PID/new start
   is a distinct process; malformed diagnostics reject; genuine changed
   executable still rejects; borrowed ADB and foreign groups stay untouched.
   Exercise retained cleanup and fresh owned cleanup independently. Synthetic
   ledger controls do not qualify the failed native attempt retroactively.

Run the existing affected suites after editing:

```bash
node --import tsx --test tests/ci/owned-process-group.test.ts tests/ci/owned-android-emulator.test.ts tests/ci/verify-owned-android-cleanup.test.ts tests/ci/verify-owned-ios-cleanup.test.ts
yarn typecheck
yarn lint
yarn test:impact
git diff --check
```

Run any newly added recovery suite explicitly too. Execute the full client unit
gate and retain the known route failure. **Exit:** independent recovery ledger
accounts for every acquired/observed resource; original failed result stays
failed; census and absence controls pass with iOS preservation; a fresh owned
cleanup control passes. Then refresh helper/declaration fingerprints and resume
Packets 1–3. Public Android dispatch stays blocked until Packets 4–5 qualify.

### Packet 1 — Map all seven Android assertions

Delivered in the current tree; inspect and verify these requirements instead
of implementing a duplicate mapper. Rerun affected controls after Packet 0.

**Files:** `scripts/testing/native-training-pilot-evidence.ts`,
`native-view-evidence.ts`, `android-build-identity.ts`, existing
`tests/ci/native-training-pilot-evidence.test.ts` and
`native-android-saved-evidence.test.ts`. Paths without a prefix above are
relative to the first named file's directory.

1. Keep the existing strict iOS entry point and diagnostic behavior. Add an
   explicit Android runtime entry point; share only platform-independent checks.
2. Require the current canonical `SCN-training-android` / `maestro` /
   `integration` selection and the exact seven assertion IDs below. Resolve
   requirement references and evidence kinds from the canonical ledger; never
   create a second hand-written requirements list.
3. Verify the fresh requested/capture/backend binding and runtime metadata,
   completed successful child commands, unchanged before/after source/helpers,
   current Android source identity, owned APK hash/config/launcher/signing,
   and exact current reader source/tool/installed-binary identities. Use
   `androidSourceIdentity` and `inspectOwnedAndroidApk` for Android; an iOS
   directory hash is not an APK identity check. Reinspection must not overwrite
   the original exclusive build receipt.
   Reader inputs are exactly the existing Java/XML sources, Android 36 jar,
   build-tools 36.0.0 `aapt2`/`d8`/`zipalign`/`apksigner`, and the selected JDK's
   `javac`/`jar`/`keytool`. Require canonical paths and current hashes for all ten;
   a well-shaped identity JSON is insufficient. Permit the two established
   nested Java/XML helper paths explicitly; do not broadly allow arbitrary
   nested helper paths when extending the current top-level TypeScript guard.
4. Reuse `validateAndroidSavedTrainingJourneyPreparation`,
   `validateAndroidSavedTrainingTitleEvidence` and
   `writeAndroidTrainingRuntimeFrames`. Require nine original runtime frame
   pairs, six scoped SQL checkpoints, three authenticated API reads and normal
   native create/update/read transport. Keep runtime frames unreviewed.
5. Android edit evidence uses the actual OS `Select all` menu and native text
   attributes. Bind original reader identity, reader APK, input binding and raw
   successful reader log as references in the edit-draft proof. Preserve iOS's
   paragraph-selection/accessibility handling.
6. Require full independently verified Android cleanup: all five acquisition
   steps, original clean release, no owned PID/start survivors, six temporary
   directories and five reserved ports clear, Expo cache absent, no owned
   Compose containers/networks/volumes, borrowed ADB preserved, and foreign
   device/AVD states unchanged. An early timeout's partial proof cannot qualify
   a completed journey. Keep outer-controller terminal proof separate.
7. Validate everything before creating exclusive assertion files. Reject stale,
   crossed, duplicate, missing or tampered evidence; retain original failures.

| Assertion ID                   | Required meaning                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------------------- |
| `NAT-training-normal-entry`    | Normal sign-in reaches coach home, library and a fresh builder using the owned API              |
| `NAT-training-local-draft`     | UI draft contains the canonical exercise at `3x8`; SQL remains at baseline                      |
| `NAT-training-first-save`      | UI save/reopen, authenticated API and SQL agree on one new owned plan/session at `3x8`          |
| `NAT-training-edit-draft`      | Actual clear/replace title and removal/re-add yield `4x10` locally; saved SQL remains unchanged |
| `NAT-training-edited-save`     | UI second save updates the same plan/session; UI/API/SQL agree on exact title and `4x10`        |
| `NAT-training-relaunch-read`   | Restart owned app/API, reopen normally, and obtain the same durable UI/API/SQL result           |
| `NAT-training-unrelated-state` | Checkpoint comparison shows no duplicate plan/session or unrelated mutation                     |

**Exit:** meaningful missing/duplicate/wrong-platform/tampered/stale/partial-cleanup
controls pass; existing iOS mapper controls remain valid. This qualifies mapper
implementation, not an actual Android pass.

### Packet 2 — Add the Android attempt adapter

Delivered as a private adapter in the current tree. Preserve its original child
outcomes and verification diagnostics; public qualification remains pending.

**Files:** new `scripts/testing/run-android-training-attempt.ts`; reuse
`run-ios-training-attempt.ts`, `capture-android-testability.ts`,
`native-training-attempt-binding.ts`, `verify-owned-android-cleanup.ts` and the
shared saved-journey observer. Add focused adapter tests under `tests/ci/`.

1. Reject invalid/stale selection, absent private runtime roots and already
   aborted execution before native acquisition. Accept only the exact bounded
   Android training cell; keep other cells unsupported.
2. Use the existing owned capture and original lifecycle/deadline controls.
   Resolve the SDK/runtime-parent paths through the capture's established
   configuration. Do not introduce a fallback to a shared/default emulator.
3. In exactly one callback, write the exclusive requested/capture/backend binding
   before the journey. Run normal native actions; write exact runtime metadata
   only after all required journey checkpoints complete.
4. After capture teardown, invoke the Android read-only cleanup verifier. On
   success, write frames and invoke Packet 1's mapper. A failed callback, child,
   capture, verification or cleanup cannot become a success.
5. Return the same information contract as iOS: distinct requested/capture/fixture
   IDs, callback counts, actual child exit, verification/cleanup result, assertion
   bindings, fixture/config/tool fingerprints and monotonic phase timings. Use
   an explicit Android adapter kind. Preserve cancellation and parent exit
   separately from the original engine child outcome.
6. Include every new helper in captured helper fingerprints and generated
   declaration ownership. Format first, regenerate second, validate third.

**Exit:** inert imports and wrong/stale/aborted inputs perform no acquisition;
callback duplication/incompletion, child failure and cleanup rejection cannot
produce success. Both platforms retain their strict input and result contracts.

### Packet 3 — Stage verified Android evidence

Platform-bound implementation and synthetic controls exist. Actual successful
Android staging is still pending a fresh fully qualified capture.

**Files:** extend `scripts/testing/native-training-public-evidence.ts` and its
existing tests. Do not enable public Android dispatch yet.

1. Match adapter kind and `capture.platform` to the selected platform. Require
   fresh exact attempt binding, one completed callback, original child zero,
   all seven assertion bindings, and full cleanup/verification success.
2. Copy the verified original references plus binding, runtime metadata, frame
   ledger, cleanup, adapter and capture evidence beneath the requested root.
   Use directories `0700`, files `0600`, exclusive writes and per-file hashes.
   Preserve bounded reads; do not copy a large app APK through a small evidence
   reader merely to avoid writing an explicit binary-identity check.
3. Reject symlinks, traversal, crossed identities, missing/changed references,
   duplicate assertions and existing output. Validate copied bytes again before
   public completion. Synthetic records test the validator, not the app.

**Exit:** both platform staging controls pass; no public receipt or native pass
is emitted by the staging helper itself.

### Packet 4 — Qualify a fresh full owned Android attempt

**Resources:** the existing shared host lock, private state root, owned target,
ADB ownership policy, backend fixture, proxy, Expo and immutable artifact roots.

1. Read host contention/recovery records. Preserve foreign processes/devices
   and borrowed ADB. Freeze all source/helper/fixture/requirement/config inputs.
2. Give the controller a new output name and archive its original bytes against
   the prior intent before extending it. Never reuse an attempt ID or modify
   source while an attempt is live. Use the new adapter's exact documented
   invocation, not an imagined package script.
3. Run the full native training recipe: create `3x8`, save/reopen, clear/replace
   title, remove/re-add `4x10`, second save, restart owned app/API and reopen.
   Seed only prerequisites; the app must create and edit the asserted plan.
4. Inspect all seven mapped proofs and staged original references. Independently
   verify full cleanup and outer-controller termination. Record actual timings,
   first outcomes and target/source/build identities.

**Exit:** one fresh bound Android runtime/staging result with exact UI/API/SQL
and full cleanup proof. Never retrofit requested binding into a historical
private capture. This is one cell's positive path, not T13/T14 completion.

### Packet 5 — Qualify failure paths and public finalization

**Files:** `run-native-pilot.ts`, existing completion/schema/runner tests, and
original control executors. Enable only the qualified Android training cell.

1. Use the existing final completion validator and immutable receipt path.
   Derive exit/result from original execution, complete assertion evidence,
   cancellation, input stability and cleanup. Keep unsupported selections blocked.
2. Prove invalid selection, wrong target/build/source/fixture, missing/duplicate
   assertion, duplicate callback and tampered staged evidence cannot pass.
3. On actual owned paths qualify child failure, bounded step/build/whole deadlines,
   SIGINT, SIGTERM and cleanup failure. Missing runtime evidence remains pending;
   mocked signal tests cannot close native lifecycle acceptance.
4. Obtain fresh actual public clean, detecting-regression and restored controls.
   Temporary regression changes belong in an isolated owned revision. The exact
   quantity assertion must fail; restore exact inputs and rebuild when required.
   Preserve original nonzero outcomes and recovery records independently.

**Exit:** actual Android public completion and required rejection/lifecycle
receipts, all requested assertions executed, and independently verified cleanup.
Report only the qualified scope; no Detox retirement or hosted claim follows.

### Packet 6 — Continue the complete migration

Refresh the task card, then finish missing T12 states/locales and T13 platform/
engine lifecycle gates. Implement T14's other families with equivalent retained
Detox coverage; collect T15 comparison; execute T16 exploration and T17 regression
conversion; qualify T18 hosted lanes, T19 eligible retirement and T20 audit.
The detailed task order and exit gates remain in Section 4 and the specification.

### Decisions and defects that block only dependent work

| Gap                                                                             | Required handling                                                                                                                                                                 |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native logout local clearing versus server revocation                           | Handoff Section 10 owns the decision. Keep session comparison decision-needed until resolved; continue independent families and retain its matrix cells.                          |
| Client-used `POST /auth/password-reset/confirm` missing in the inspected server | Preserve the failing route contract and establish the intended server revision/behavior in a separate auth packet. Do not weaken the scanner or report the full unit suite green. |
| Training removal dialog says “meals and items”                                  | Retain the observed copy finding. Any correction requires the documented localized copy and all three bundles; do not fold it silently into runner work.                          |
| Host contention, stale inputs, unavailable census or unknown cleanup            | Retain a blocked receipt with owner/next action; continue independent preparation. Two unchanged failures require diagnosis or changed conditions before another attempt.         |

## 7. Runner, exploration and completion contracts

Specification Section 16 owns schemas/resource contracts. Receipts bind exact
repositories/build/target, fixture/flags, requested/executed assertions, raw child
outcome, timings and cleanup. Keep credentials/sensitive artifacts private.
Missing evidence is unknown. Exit 0 requires every requested outcome and verified
cleanup; application failure is 1, input/harness block is 2, cancellation is
nonzero with cleanup. Cleanup failure prevents a passing result.

Reject wrong origin/build/device, bypasses, missing/duplicate IDs, absent cells,
mixed fingerprints and invalid/missing evidence. Stop only verified owned
resources. Preserve foreign processes and recovery ledgers; never broad-kill.

Exploration budget: 30 minutes OR 100 actions, whichever first; at most two
unchanged failing branch attempts. Record target/data/locale and actions. Missing
connector means blocked preparation. Confirmed bugs require documented expected
versus actual behavior, two fresh reproductions, control, evidence and established
owner; otherwise record suspected bug/doc gap. No automatic external posting.

For each packet run applicable unit/component, lint, typecheck, impact, formatting
and diff checks plus real-layer/lifecycle acceptance. Never run unsafe DB tests
or guessed scripts. Preserve aliases and Detox throughout rollout. If Maestro
fails its gate, retain the proven lane and record why.

Finish only when specification Section 12 passes. Update affected test/strategy,
backlog/decision/wiring docs. Behavior changes also update affected FR/UC/BR/AC/
screen artifacts; new copy requires all three locale bundles. This planning-only
change needs no product/localization update.

## 8. Commands for an implementing agent

Run from the client repository. These interfaces were inspected in the current
working tree; recheck them before use. Commands are validation/implementation
instructions and were not executed by this planning refresh.

```bash
git status --short
git rev-parse HEAD
git -C ../server status --short
git -C ../server rev-parse HEAD

# Run after editing and formatting declaration inputs, in this order.
python3 scripts/testing/generate-native-declaration.py
node scripts/testing/validate-native-inventory.mjs
node scripts/testing/inventory-tests.mjs

# Required client quality checks; record failures without waiving them.
yarn test:unit
yarn test:component
yarn typecheck
yarn lint
yarn test:impact
git diff --check

# Requires the existing private state root and an uncontended owned host.
MYCHAMPIONS_NATIVE_STATE_ROOT=/Users/eduwaldo/.local/state/github-actions/mychampions-native-recovery yarn test:e2e:native:pilot --platform=ios --engine=maestro --scenario=SCN-training-ios --mode=integration
```

Format/check only touched files with the installed formatter; avoid repository-
wide mutation of unrelated dirty files. Choose existing focused native tests
from `tests/ci/` for each work order. Read the server's current package scripts
and guards before invoking its validation. Exploration/comparison interfaces
remain planned until implemented; never execute a guessed command.

## 9. Copyable implementation prompt

> Implement BL-018 using `docs/plans/2026-09-29-testing-modernization-start-here.md`,
> the linked specification and handoff. Deliver all T00–T20 acceptance gates;
> the next Android packet is a bounded step within the complete migration.
> Read applicable AGENTS and the current task card. Preserve dirty work/live runs.
> Refresh evidence, choose the earliest unmet ready packet, fill its work card
> and reuse existing owner helpers. Implement bounded review units and execute
> required real-layer, negative and cleanup controls. Update the existing task
> card and affected docs with commands, requested/executed assertions, first
> failures, receipts, identities, blockers and next packet. Continue independent
> work when a branch is blocked. Do not invent product behavior, weaken
> expectations, substitute fixture proof, hide retries or claim wiring as hosted
> success. Retain Detox until comparison and retirement gates pass. Do not commit,
> push, dispatch, merge, deploy, schedule, purchase or use production/providers
> without separate authorization. Full completion requires specification Section 12.

> Before each packet, state its task ID, owner, existing files, exact requested
> assertions, current prerequisite receipts, commands and cleanup checks. Read
> the matching governing requirements and inspect code/tests before editing.
> After each packet, report implemented versus locally verified versus hosted
> verified, retain the first failure, and choose the next ready packet. Do not
> substitute a new plan for implementation after implementation is requested.

> Current resume: read the latest task-card dispatch and its prerequisite receipts.
> Reconcile historical “next” instructions with original terminal outcomes and
> current ownership before executing. Reuse Section 6 Packet 0 only when a new
> retained-resource recovery is necessary. Choose the first unmet Android
> runtime/staging, detecting/restored or public lifecycle acceptance from current
> evidence; do not repeat a qualified private packet merely to recreate it.
> Preserve original failed outcomes and never retrofit a historical binding.

Completed recovery and census controls do not satisfy the fresh runtime/staging
gate. The latest task card determines the next ready packet.

Historical lifecycle/capture details remain in the task card and handoff.
Use the latest task-card work card for current dispatch; Section 6 supplies
reusable recipes only.

### Mandatory handoff for every implementation packet

Before leaving a packet, record this compact result in the existing task card:

```text
Task ID / owning repository:
Changed files and what each change proves:
Requirement references and requested assertion IDs:
Actual commands, terminal outcomes and immutable receipt paths:
Original failures, diagnosis, correction and linked new attempt:
Requested versus executed cases; independently verified cleanup:
Docs updated, or why product/localization docs need no change:
Implemented / locally verified / hosted verified / still pending:
Next eligible packet and its exact remaining acceptance checks:
```

If an assertion is undocumented, preserve the observation and open a decision
row; do not invent its expectation. If a runner fails, diagnose that runner
before adding more journeys. If a selector is invisible, inspect the actual
accessibility tree before editing it. If cleanup is rejected, retain the failed
receipt and recovery identity; never stop unrelated resources. A later recovery
or successful retry does not rewrite the original attempt. When prerequisites
change, start a new evidence cohort instead of mixing results.

This planning clarification changes no product behavior, API, database schema,
locale bundle, CI enforcement or acceptance threshold. Existing BL-018/D-219
backlog and wiring statuses remain authoritative and unchanged. Validation for
the clarification is touched-document formatting, local link resolution and
consistency with the specification and task card; runtime checks belong to the
implementation packet whose behavior they qualify.

### 2026-10-03 camera attempt terminal and source hold released

Public iOS/Maestro camera attempt `4ec7ad29687c4e52febb9124` (capture `ab30ddf9ad2c26cf75f12bc1`) ended with exit 2, `harness-blocked`, before the camera callback: `Camera frame source identity is unavailable`. No camera permission/fallback qualification or passing native case is claimed. Independent cleanup passed for 68 PID/start pairs, with no survivors or unknown queries; owned simulator and cache were absent. All 184 frozen source hashes matched before release of the source hold. Cold attempts and automatic retries remain zero. The authenticated camera provenance/prelude separation requires a private repair and fresh qualification. Evidence: `.qa/artifacts/testing-modernization/ios-camera-current-source-public-live-2026-10-03-v1/TERMINAL.private.json`.

### 2026-10-03 camera provenance V2 source integration

Root integrated two reviewed source/test paths in the qualified worktree. Generic login and account-switch observations no longer request authenticated camera provenance before a verified sign-in boundary. Capture-only camera observations remain generic; integrated camera observations still require the verified current actor/auth request and original frame bytes. The actual prior `password-save-prompt` failure is retained under attempt `4ec7ad29687c4e52febb9124` / capture `ab30ddf9ad2c26cf75f12bc1`. This repair does not establish permission/fallback qualification.

Canonical validation passes 14/14 focused controls, full TypeScript, zero-warning lint, formatting, declaration generation and both inventory checks. The unit inventory contains 455 files (391 client, 64 server); native declaration remains 23 views, 40 transitions and ten scenarios with no generated runtime passes. Evidence: `ios-camera-provenance-v2-root-integration-2026-10-03-v1/CANONICAL-RESULT.private.json`. Fresh native qualification is the next action, owned by the client/server maintainer. No product behavior, auth policy, provider baseline or localized copy changed; product artifacts need no update. Native/cold/hosted counts are unchanged, and full-plan completion remains Pending.

### 2026-10-03 repaired-camera fresh attempt terminal

Fresh public iOS/Maestro camera attempt `7ef23a63e46fd52748571677`, capture `c7d1c3810f6e27bd8babcc7c`, ended with outer exit 2, original Maestro child exit 1 and `harness-blocked`. All three sign-in readiness assertions passed. During the `password-save-prompt` login prelude, email tap and input reported completion, then the exact fixture-email visibility assertion failed; the screenshot retains the original email placeholder. No completed sign-in, authenticated camera frame or camera callback was observed, so native validation of the provenance repair remains Pending. This failure does not establish its cause; no selector weakening, coordinate fallback, product change or automatic retry follows.

Independent cleanup passed over 50 PID/start pairs: no survivors, unknown queries, missing foreign devices or remaining owned simulator/cache/Docker resources. All 185 frozen source hashes matched before release of the hold. Evidence: `ios-camera-provenance-v2-public-live-2026-10-03-v1/TERMINAL.private.json`, `READINESS-TERMINAL.private.json` and `ROOT-CLEANUP.private.json`. Native passing cases and cold attempts are unchanged; full T14–T20 acceptance remains Pending. The client/server maintainer must investigate actual native input delivery against the retained target, hierarchy and command evidence. This QA checkpoint changes no product/auth/provider/localization contract.
