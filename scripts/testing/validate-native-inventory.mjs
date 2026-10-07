import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(directory, "vendor/app-flow-maestro");
const provenance = JSON.parse(
  readFileSync(path.join(vendor, "provenance.json"), "utf8"),
);
for (const copy of provenance.copies) {
  if (path.basename(copy.path) !== copy.path)
    throw new Error("Invalid vendor path");
  const actual = createHash("sha256")
    .update(readFileSync(path.join(vendor, copy.path)))
    .digest("hex");
  if (actual !== copy.sha256)
    throw new Error("Native inventory vendor provenance mismatch");
}
const ajv = new Ajv2020({ allErrors: true, strict: false });
ajv.addFormat("date-time", (value) => Number.isFinite(Date.parse(value)));
const schema = ajv.compile(
  JSON.parse(readFileSync(path.join(vendor, "inventory.schema.json"), "utf8")),
);
const families = [
  "session",
  "training",
  "connection",
  "camera-denied",
  "save-retry",
];

/**
 * @returns {Promise<{
 * byPlatform: Record<string, {views: {captured: string[], denominator: string[]}, transitions: {captured: string[], denominator: string[]}, behavior: {passing: string[], denominator: string[]}}>,
 * views: {captured: string[], denominator: string[]},
 * transitions: {captured: string[], denominator: string[]},
 * behavior: {passing: string[], readyDenominator: string[], coverage: string},
 * disposition: {passing: number, denominator: number, untested: number}
 * }>}
 */
export async function validateNativeInventory(value, repositoryRoot) {
  if (!schema(value))
    throw new Error("Native inventory schema rejected document");
  const root = realpathSync(repositoryRoot);
  const maps = {};
  for (const key of [
    "sources",
    "views",
    "transitions",
    "flows",
    "scenarios",
    "receipts",
  ]) {
    maps[key] = new Map();
    for (const row of value[key]) {
      if (maps[key].has(row.id)) throw new Error(`Duplicate ${key} identity`);
      maps[key].set(row.id, row);
    }
  }
  const links = (ids, target) => {
    if (!ids?.length) throw new Error(`Missing ${target} links`);
    for (const id of ids)
      if (!maps[target].has(id)) throw new Error(`Unknown ${target} link`);
  };
  const ownerPath = (relative) => {
    if (!relative || path.isAbsolute(relative))
      throw new Error("Native owner path must be relative");
    const candidate = path.resolve(root, relative);
    if (
      !candidate.startsWith(root + path.sep) ||
      !existsSync(candidate) ||
      realpathSync(candidate) !== candidate
    )
      throw new Error(
        "Native owner path missing, escaped or contains a symlink",
      );
  };
  for (const source of value.sources)
    for (const file of source.paths ?? []) ownerPath(file);
  for (const view of value.views) {
    links(view.sourceRefs, "sources");
    for (const file of view.ownerPaths ?? []) ownerPath(file);
    if (view.captureStatus === "runtime-captured")
      links(view.receiptIds, "receipts");
  }
  for (const transition of value.transitions) {
    links(
      [
        transition.fromViewId,
        ...(transition.toViewId ? [transition.toViewId] : []),
      ],
      "views",
    );
    links(transition.sourceRefs, "sources");
    if (transition.status === "captured")
      links(transition.receiptIds, "receipts");
  }
  for (const flow of value.flows) {
    links([flow.entryViewId], "views");
    links(flow.transitionIds, "transitions");
    links(flow.sourceRefs, "sources");
    let current = flow.entryViewId;
    for (const id of flow.transitionIds) {
      const transition = maps.transitions.get(id);
      if (transition.fromViewId !== current)
        throw new Error("Native flow path is disconnected");
      current = transition.toViewId;
    }
  }
  for (const family of families)
    for (const platform of ["ios", "android"]) {
      if (!maps.scenarios.has(`SCN-${family}-${platform}`))
        throw new Error("Required native pilot cell missing");
    }
  for (const scenario of value.scenarios) {
    links([scenario.flowId], "flows");
    links(scenario.transitionIds, "transitions");
    links(scenario.freshnessInputs?.sourceIds, "sources");
    if (
      !scenario.requirementRefs?.length ||
      !scenario.fixtureRef ||
      !scenario.roles?.length ||
      !["ios", "android"].includes(scenario.platform)
    )
      throw new Error("Native scenario lacks scope or requirements");
    if (
      !["ready", "remediation", "blocked", "not-applicable"].includes(
        scenario.readiness,
      )
    )
      throw new Error("Native scenario lacks testability disposition");
    for (const file of [
      ...(scenario.ownerPaths ?? []),
      ...(scenario.freshnessInputs?.requirementPaths ?? []),
    ])
      ownerPath(file);
    if (scenario.maestroFlow) ownerPath(scenario.maestroFlow);
    if (scenario.behaviorStatus === "tested") {
      links(scenario.receiptIds, "receipts");
      if (scenario.freshness !== "current" || scenario.readiness !== "ready")
        throw new Error("Tested native cell is not current and ready");
      const receipts = scenario.receiptIds.map((id) => maps.receipts.get(id));
      if (
        !receipts.some(
          (row) =>
            row.result === "passed" &&
            row.scenarioIds.includes(scenario.id) &&
            /^[a-f0-9]{64}$/.test(row.inputFingerprint ?? "") &&
            row.platform === scenario.platform &&
            row.build &&
            row.build !== "unknown" &&
            row.device &&
            row.device !== "unknown" &&
            row.evidencePaths?.length,
        )
      )
        throw new Error(
          "Tested native cell lacks exact target passing evidence",
        );
    }
  }
  for (const receipt of value.receipts) links(receipt.scenarioIds, "scenarios");
  const qualifiedViews = new Map();
  for (const receipt of value.receipts) {
    if (
      value.views.some(
        (row) =>
          row.captureStatus === "runtime-captured" &&
          row.receiptIds?.includes(receipt.id),
      )
    ) {
      const require = createRequire(import.meta.url);
      const {
        validateNativeViewReceipt,
      } = require("./native-view-evidence.ts");
      qualifiedViews.set(
        receipt.id,
        await validateNativeViewReceipt(receipt, root, value),
      );
    }
  }
  for (const view of value.views) {
    if (
      view.captureStatus === "runtime-captured" &&
      !view.receiptIds.some((id) => qualifiedViews.get(id)?.includes(view.id))
    )
      throw new Error(
        "Captured native view lacks its actual qualified observation",
      );
  }
  // View observations cannot qualify actions or behavior. Those need the T13
  // executed assertion/transition receipt contract, which is not delivered yet.
  if (value.transitions.some((row) => row.status === "captured"))
    throw new Error(
      "Captured native transition lacks executed transition evidence",
    );
  if (value.scenarios.some((row) => row.behaviorStatus === "tested"))
    throw new Error(
      "Tested native behavior lacks validated native runner evidence",
    );
  const inBoundary = value.views.filter(
    (row) => row.captureStatus !== "out-of-scope",
  );
  const transitions = value.transitions.filter(
    (row) => row.status !== "out-of-scope",
  );
  const scenarios = value.scenarios.filter(
    (row) => row.behaviorStatus !== "not-applicable",
  );
  const ready = scenarios.filter((row) => row.readiness === "ready");
  const passed = scenarios.filter(
    (row) => row.behaviorStatus === "tested" && row.freshness === "current",
  );
  const applies = (row, platform) =>
    !row.conditions?.platforms || row.conditions.platforms.includes(platform);
  for (const row of [...value.views, ...value.transitions])
    if (
      row.conditions?.platforms &&
      (!Array.isArray(row.conditions.platforms) ||
        !row.conditions.platforms.length ||
        row.conditions.platforms.some(
          (p) => !value.boundary.platforms.includes(p),
        ))
    )
      throw new Error("Native row has invalid platform scope");
  const observedOn = (row, platform) =>
    row.receiptIds?.some((id) => maps.receipts.get(id)?.platform === platform);
  return {
    byPlatform: Object.fromEntries(
      value.boundary.platforms.map((platform) => [
        platform,
        {
          views: {
            captured: inBoundary
              .filter(
                (row) =>
                  applies(row, platform) &&
                  row.captureStatus === "runtime-captured" &&
                  observedOn(row, platform),
              )
              .map((row) => row.id),
            denominator: inBoundary
              .filter((row) => applies(row, platform))
              .map((row) => row.id),
          },
          transitions: {
            captured: transitions
              .filter(
                (row) =>
                  applies(row, platform) &&
                  row.status === "captured" &&
                  observedOn(row, platform),
              )
              .map((row) => row.id),
            denominator: transitions
              .filter((row) => applies(row, platform))
              .map((row) => row.id),
          },
          behavior: {
            passing: passed
              .filter((row) => row.platform === platform)
              .map((row) => row.id),
            denominator: scenarios
              .filter((row) => row.platform === platform)
              .map((row) => row.id),
          },
        },
      ]),
    ),
    views: {
      captured: inBoundary
        .filter((row) => row.captureStatus === "runtime-captured")
        .map((row) => row.id),
      denominator: inBoundary.map((row) => row.id),
    },
    transitions: {
      captured: transitions
        .filter((row) => row.status === "captured")
        .map((row) => row.id),
      denominator: transitions.map((row) => row.id),
    },
    behavior: {
      passing: passed.map((row) => row.id),
      readyDenominator: ready.map((row) => row.id),
      coverage: ready.length ? `${passed.length}/${ready.length}` : "n/a",
    },
    disposition: {
      passing: passed.length,
      denominator: scenarios.length,
      untested: scenarios.filter((row) => row.behaviorStatus === "untested")
        .length,
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const root = path.resolve(directory, "../..");
  const value = JSON.parse(
    readFileSync(
      path.join(root, "docs/qa/native-pilot/inventory.json"),
      "utf8",
    ),
  );
  void validateNativeInventory(value, root)
    .then((metrics) =>
      process.stdout.write(JSON.stringify(metrics, null, 2) + "\n"),
    )
    .catch((error) => {
      process.stderr.write(
        `Native inventory validation blocked: ${error.message}\n`,
      );
      process.exitCode = 2;
    });
}
