# Native comparison collector contract v1

Status: **preparation and receipt-order guard implemented locally; native
comparison and adoption remain pending**.

This document defines the T15-A comparison-collector packet. It records what the
collector can prove from public receipt artifacts and the evidence that still
requires the native runner, owned devices, the integrated backend lane, T16
regression probes, and T18/T19 review. It does not establish Maestro adoption,
Detox retirement, hosted promotion, or store/device acceptance.

## Owner and entry point

The collector is implemented in
[`scripts/testing/compare-native-pilot.ts`](../../scripts/testing/compare-native-pilot.ts).
Focused contract tests are in
[`tests/ci/compare-native-pilot.test.ts`](../../tests/ci/compare-native-pilot.test.ts).
The stable Node entry point is
[`scripts/testing/compare-native-pilot.mjs`](../../scripts/testing/compare-native-pilot.mjs),
which delegates to the typed collector. This packet does not add a second
harness or alter shared package/config/schema files.

The CLI accepts one reviewed specification and one or more receipt files:

```text
node scripts/testing/compare-native-pilot.mjs \
  --spec <reviewed-matrix.json> \
  --receipt <canonical-receipt-1.json> \
  --receipt <canonical-receipt-2.json> \
  [--output <new-private-report.json>]
```

Exit `0` means every requested cell is locally eligible under the collector's
checks. Exit `2` means the input, evidence, or a cell is blocked. A partial
scope can therefore exit `0` for its selected cells while its report keeps
`comparisonEligible: false`. The output report always uses
`adoptionDecision: "blocked"`; a local collector result is not a migration or
retirement authorization.

## Immutable input rules

The specification seals a reviewed `cohort` with `id`, `sourceFingerprint` and
`fixtureResetFingerprint`; both fingerprints are SHA-256 values. Each expected
attempt binds `cohortId` to that ID and declares a unique `fixtureResetId` across
the entire matrix. Reports retain these reviewed identities. They describe
expected inputs; receipt/runtime reset freshness and capture provenance still
need independent evidence before T15 completion.

The specification is the reviewed request matrix. Each cell declares its
scenario, platform, engine, data mode, explicit locale, required assertion IDs, and exactly one
expected fingerprint per requested trial ordinal. Each expected trial binds an
immutable `runId`, `attemptId`, and ordinal from 1 through the cell's requested
attempt count. The 20 full-scope ordinals therefore represent 20 independent
cold trial firsts; a retry is a new linked attempt and cannot replace the
failed original pair. Once a reader has sealed a path/hash pair, an overwrite
is hash-blocked; the runner must retain the original receipt with exclusive
creation so a pre-intake overwrite cannot erase history. The collector never
infers equivalence between
run-specific fixture hashes, binaries, repositories, or tool versions. A
changed value needs a new independent expectation or the cell is blocked.
For the current public runner, every expected and complete receipt must encode
the first attempt exactly by setting `attemptId` to the `runId` followed by
`:first`. A requested
`retry` identity is rejected from this v1 matrix. If a future engine emits a
different identity format, it requires an explicit reviewed schema adapter
before comparison; this collector does not guess or normalize it.

`readNativeComparisonReceipts` is the CLI intake boundary. For every receipt it:

- resolves the file to its canonical path and rejects a missing path;
- rejects a receipt symlink and any non-regular file;
- requires the canonical file and artifact root to be owned by the current
  process user, with receipt mode `0600` and artifact-root mode `0700`;
- parses the exact bytes once and records their SHA-256 as `receiptHash`;
- uses the canonical parent as the artifact root before public-receipt validation.

The collector reopens every supplied path before comparison and revalidates its
canonical path, owner, modes, artifact-root binding, current byte hash, and
parsed payload against the supplied receipt object. Inputs that cannot be
bound to an immutable canonical file are rejected. A malformed but parseable
receipt with a valid requested `attemptId` remains an invalid row in the
requested denominator; a receipt with no bindable identity, an unknown ID, or a
duplicate ID is rejected at intake. Credentials and private fixture bodies
remain outside the public receipt/report contract.

Receipt rows must identify the native execution phase (`P4`) and `native`
layer. Integration expectations and receipts must carry a non-null HTTP
`target.apiOrigin`; fixture rows remain distinct. Tool-version maps are
compared as exact canonical maps, including key presence, so an extra, missing,
or changed tool entry blocks the row while different declared engine/platform
expectations remain allowed.

Duplicate receipt attempt IDs, unknown IDs, malformed receipt shapes, missing
requested attempts, cell/data-mode mismatches, repository/target/input
fingerprint mismatches, invalid artifact references, and incomplete passed
assertions are blocked. Missing and invalid attempts remain represented in the
requested denominator where an attempt identity can be bound.

Every cell, expected trial and receipt must bind the same supported locale
(`en-US`, `pt-BR`, or `es-ES`). Unknown, null or mismatched locales block that
row. A full 400-attempt cohort uses one explicit locale; locale variants require
separate cohorts. Schema-invalid bindable receipts return immediately as invalid
rows before any typed metadata is read, preserving their denominator entry.

### Reviewed engine order

When both engines are requested for the same scenario, platform, mode and
locale, the specification must include one explicit `executionOrder` pair. The
pair seals a reviewed `pairId`, its identity, the starting engine and one
first/second immutable expected `attemptId` for every trial ordinal. Pair
identity is exact; an omitted, duplicate, swapped or cross-locale/platform/
scenario/mode pair is rejected before receipt intake. Every expected attempt in
the two cells is bound exactly once. Full scope therefore requires ten pairs of
twenty trials (400 expected attempts total), and the declared starting engine
alternates on each ordinal so each pair has ten trials starting with each
engine. A partial specification that contains a complete engine pair must also
declare this order; a partial specification without a complete pair reports
order as not required but remains non-promotable.

The collector reads `startedAt` and `finishedAt` from each schema-valid,
expected receipt. It does not infer order from receipt-array order or fill a
missing timestamp. A trial is order-verified only when both receipt intervals
are valid, the declared first receipt starts before the second, and the first
finishes no later than the second starts. Trial ordinals are also strictly
sequential: the next trial's declared first receipt must start after the
previous trial's second receipt finishes. Missing or invalid receipts/times,
equal starts or boundaries, overlapping intervals and reversed starts block the
trial and both involved cells while retaining every expected attempt in the
denominator. A schema-valid receipt with exact identity and timestamps can
still prove chronology when its application outcome is failed or cancelled;
incompatible or malformed receipts are rejected distinctly. The report exposes
the pair/trial status and actual timestamp strings for review. This source gate
proves receipt chronology; it does not prove cold fixture reset freshness or
direct capture/cleanup provenance, which still need native/runtime evidence.

## Matrix and outcome rules

The full scope is fixed at five integrated journey families × two platforms ×
two engines × 20 cold attempts: exactly 20 cells and 400 requested attempts.
The full scope threshold is at least 19 first-attempt passes per cell; an
explicit threshold below 19 is rejected. Platforms, engines, modes, and cells
are reported independently. No pooled count can make an ineligible cell pass.
`allCellsEligible` reports those local per-cell checks; `comparisonEligible` is
true only for the complete full matrix when those checks and the reviewed
execution-order gate both pass. A partial report can have all of its selected
cells locally eligible while `comparisonEligible` remains false.

Every requested attempt remains counted, including:

- `application-failed`, `harness-blocked`, and `cancelled` outcomes;
- cleanup failures with a retained recovery ledger;
- missing, invalid, or incompatible evidence where the request identity is
  still known.

Passed attempts additionally require every declared assertion to be passed with
evidence paths, a zero child exit, and cleaned resources. Per-cell reports
include requested/received/missing/pass and failure counts plus p50/p95 timing
statistics for each lifecycle phase.

The current collector deliberately marks any non-passing outcome as blocked.
The report labels the limitation as `not-modeled` for failure explanation,
controlled-regression detection, and maintenance evidence. The plan allows a
19/20 cell only when there is no unexplained failure and no stable defect or
cleanup leak; this preparation packet does not yet collect the evidence needed
to make that distinction. It therefore must not silently turn an explained
failure into a pass or claim T15 completion.

## Required evidence before a decision

The collector preparation is locally testable, but the following evidence is
still pending before a T15-A decision:

1. A reviewed matrix with stable scenario/assertion IDs, 20 independent trial
   ordinals per full cell, immutable expected `runId`/`attemptId` pairs, and
   explicit repository, target, build, fixture, flags, and tool-version
   expectations for all requested attempts.
2. Fresh owned iOS and Android smoke/debug receipts for both engines, with
   integrated cells using the owned Postgres/API lane. Fixture and integration
   modes must remain separate.
3. The complete 20-cell/400-attempt cold matrix, receipts satisfying every
   reviewed pair/order row, unique attempt IDs, and retained original receipts,
   including failures,
   cancellations, blocks, and cleanup ledgers.
4. A recorded explanation/classification for each failure, zero unresolved
   cleanup leaks, stable-defect review, and the per-family controlled
   regression/control evidence required by T15 and T16.
5. A separate migration/retain/blocked review, then the hosted protected-run
   evidence required by T18/T19 before any Detox scenario retirement.

## T15 source-hardening additions in this preparation packet

The request matrix now carries a generated assertion ledger for every cell.
The ledger binds the canonical inventory path and source hash, the generated
contract and semantic hashes, required assertion IDs, requirement references,
evidence kinds, starting state, action, expected result, and private evidence
path templates. A receipt assertion whose requirement references differ from
the sealed ledger is blocked. The collector never substitutes a hand-written
assertion description for the generated inventory contract. The packet includes
one resource-free positive control against the current Expo connection ledger;
that control validates source-shaped inventory bytes only and is not native
execution evidence.

The cohort also seals a flags fingerprint and explicit instrumentation notes.
All cold attempts must retain the same repository/source fingerprints. Each
resource identity carries its owner run, process-start identity when it is a
process, a closed acquisition/release window, and an original receipt binding.
Sequential reuse of an OS PID or fixed API port is legal only after the prior
owned window is closed; overlapping windows and foreign owner identities are
blocked. A numeric PID or port slot by itself is only a reviewed expectation,
never runtime freshness proof. Within a cell, scenario, requirement, fixture,
tool, target and build inputs remain stable across trial ordinals. Paired
engines must bind equivalent assertion ledgers, source/requirement/fixture
hashes, and the stable device/API identity. Platform-specific targets and
binaries remain legal, and build or binary differences are accepted only when
the cohort contains an explicit instrumentation-only note for that platform;
iOS and Android binaries are never required to have identical hashes.

The focused suite exercises a complete synthetic 20-cell, 400-receipt matrix
through the real collector, including reviewed alternating order, sequential
reuse of realistic PID/start identities and fixed ports, and exact denominator
accounting. It also rejects engine assertion-ledger drift, repository/source
drift, sealed flags drift, fixture-cohort drift, foreign or overlapping
resource ownership, same-process-start reuse, pending receipt bindings, and
receipt requirement-reference drift. The 400-receipt result is synthetic unit
evidence only: native resources, cold resets, owned targets, real process/port
receipts, and public qualification remain unobserved
(`nativePassingCases = 0`).

An expected attempt with `originalReceiptBinding.status = "pending"` remains
in the denominator but is blocked by the collector even when a valid receipt
row is supplied. A verified binding must match the canonical receipt path,
artifact root and original receipt-byte hash exactly. This prevents reviewed
PID/port fields from being mistaken for actual resource or artifact ownership.

Controlled regression and restoration are intentionally not modeled by this
collector. The next bounded dependency is T17's deterministic regression
validator. It must bind each family and cell to source-before, controlled
mutation, restored-source, fail-before, after-fix, and clean-control receipts,
with exact artifact hashes and the same build/locale/data/assertion cohort
identity. Regression diagnostics must remain outside the 400-attempt numerator;
this T15 packet does not infer restoration or explain a 19/20 result from
collector rows alone.

## Focused validation

```text
node --import tsx --test tests/ci/compare-native-pilot.test.ts
yarn -s eslint scripts/testing/compare-native-pilot.ts tests/ci/compare-native-pilot.test.ts
yarn -s prettier --check scripts/testing/compare-native-pilot.ts tests/ci/compare-native-pilot.test.ts docs/qa/native-comparison-contract-v1.md
```

Full repository typecheck, integration execution, native execution, hosted
verification, and task-card reconciliation remain owned by the integrating
agent. No native/backend acquisition or external action is performed by this
packet.

## T15 locale contract source integration — 2026-10-01

**Done (source)**: 22 canonical node-runner controls pass within the 92 focused controls; isolated full typecheck, zero-warning scoped lint and formatting also pass. Standalone `scripts/testing/locale-native-observation.ts` and `locale-context-validator.ts` with node-runner controls. The generic diagnostic parser accepts a coach/home subtree; the separate language-selection audit retains its option/checkmark requirements. The preparation producer binds expected capture/source/helper/build/target/OS/tree metadata and rejects stale, malformed or unsafe inputs. Source-shaped runtime metadata cannot qualify hydration, reset, relaunch or cleanup: preparation always keeps those boundaries Pending, public locale null and native passing cases zero. Actual file-backed collector wiring and qualified runtime evidence remain **Pending**. This contract changes no user copy, authorization, backend provider or product screen requirement.

### Locale hierarchy file boundary — 2026-10-01

BL-018/D-219 adds a bounded file adapter over the existing private evidence reader and preparation-only LocaleContext parser. It reads a canonical owner-only hierarchy, hashes exact bytes before parsing, and keeps read/parse/provenance failures blocked. Runtime metadata is ignored; raw hierarchy bytes are not returned. This source helper does not qualify OS locale, hydration/reset/relaunch/cleanup or a public locale. Capture adapter binding/wiring and actual native qualification remain **Pending**.
