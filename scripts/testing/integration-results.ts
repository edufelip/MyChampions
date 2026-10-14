import { integrationAttemptId, INTEGRATION_SCENARIOS } from './integration-registry';
import { assertTestingDocument } from './schema-validation';
import type { IntegrationCase } from './integration-context';
import type { JSONReport, JSONReportSuite, JSONReportTest } from '@playwright/test/reporter';

export function selectedReportCases(value: unknown) {
  assertTestingDocument('playwright-report-v1', value);
  const report = value as JSONReport;
  const rows: { attemptId: string; scenarioId: string; test: JSONReportTest }[] = [];
  const visit = (suite: JSONReportSuite) => {
    for (const spec of suite.specs ?? []) {
      const id = /@integration:([a-z-]+)(?:\s|$)/.exec(spec.title)?.[1];
      if (!id || !INTEGRATION_SCENARIOS.some((row) => row.id === id))
        throw new Error('Unknown executed integration case');
      for (const test of spec.tests)
        rows.push({ attemptId: integrationAttemptId(id, test.projectName), scenarioId: id, test });
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  report.suites.forEach(visit);
  return rows;
}
export function verifyRequestedCases(
  requested: readonly Pick<IntegrationCase, 'attemptId'>[],
  executed: ReturnType<typeof selectedReportCases>,
) {
  const ids = executed.map((row) => row.attemptId);
  if (
    !ids.length ||
    new Set(requested.map((row) => row.attemptId)).size !== requested.length ||
    new Set(ids).size !== ids.length ||
    requested.length !== ids.length ||
    requested.some((row) => !ids.includes(row.attemptId))
  )
    throw new Error('Requested/executed integration selection mismatch');
}
export function validateAssertionProof(value: unknown, selected: IntegrationCase, runId: string) {
  assertTestingDocument('integration-assertions-v1', value);
  const proof = value as {
    runId: string;
    attemptId: string;
    scenarioId: string;
    project: string;
    browserVersion: string;
    assertions: {
      id: string;
      requirementRefs: string[];
      outcome: 'passed' | 'failed';
      evidencePaths: string[];
    }[];
  };
  const scenario = INTEGRATION_SCENARIOS.find((row) => row.id === selected.scenarioId)!;
  if (
    proof.runId !== runId ||
    proof.attemptId !== selected.attemptId ||
    proof.scenarioId !== selected.scenarioId ||
    proof.project !== selected.project ||
    new Set(proof.assertions.map((row) => row.id)).size !== proof.assertions.length ||
    proof.assertions.some(
      (row) =>
        JSON.stringify(row.requirementRefs) !==
        JSON.stringify(scenario.assertions.find((declared) => declared.id === row.id)?.refs),
    )
  )
    throw new Error('Integration assertion identity mismatch');
  return {
    ...proof,
    complete:
      proof.assertions.length === scenario.assertions.length &&
      proof.assertions.every((row) => row.outcome === 'passed'),
  };
}
