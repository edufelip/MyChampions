import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseIntegrationArguments,
  assertRunnableIntegrationSelection,
  INTEGRATION_SCENARIOS,
} from '../../scripts/testing/integration-registry';
import {
  selectedReportCases,
  verifyRequestedCases,
  validateAssertionProof,
} from '../../scripts/testing/integration-results';
import type { IntegrationCase } from '../../scripts/testing/integration-context';

void test('integration selection preserves the full five-scenario objective and rejects unfinished cases', () => {
  const full = parseIntegrationArguments([]);
  assert.equal(full.scenarios.length, 5);
  assert.equal(full.projects.length, 9);
  assert.doesNotThrow(() => assertRunnableIntegrationSelection(full));
  // Keep the fail-closed contract after the last placeholder is implemented.
  // This is an independent selection copy, never a mutated global registry.
  assert.throws(
    () =>
      assertRunnableIntegrationSelection({
        ...full,
        scenarios: full.scenarios.map((scenario, index) =>
          index === 0 ? { ...scenario, implemented: false } : scenario,
        ),
      }),
    /not implemented/,
  );
  assert.doesNotThrow(() =>
    assertRunnableIntegrationSelection(
      parseIntegrationArguments(['--scenario=auth-session', '--project=chromium']),
    ),
  );
});
void test('unknown, duplicate, empty and arbitrary Playwright arguments cannot select partial integration coverage', () => {
  for (const argv of [
    ['--scenario=missing'],
    ['--project=constructor'],
    ['--scenario='],
    ['--scenario=auth-session,auth-session'],
    ['--project=chromium,chromium'],
    ['--project=chromium', '--project=webkit'],
    ['--grep=auth'],
    ['--list'],
    ['--config=playwright.config.ts'],
    ['--deadline-ms=0'],
  ])
    assert.throws(() => parseIntegrationArguments(argv));
});
function report(project = 'chromium') {
  return {
    suites: [
      {
        specs: [
          {
            title: '@integration:auth-session persisted auth',
            tests: [
              {
                projectName: project,
                status: 'expected',
                results: [{ status: 'passed', startTime: '2026-09-28T00:00:00.000Z', duration: 1 }],
              },
            ],
          },
        ],
      },
    ],
  };
}
void test('report selection checks actual exact identities, rejects zero/missing/duplicate tests and only establishes discovery', () => {
  const rows = selectedReportCases(report());
  assert.doesNotThrow(() => verifyRequestedCases([{ attemptId: 'auth-session--chromium' }], rows));
  assert.throws(() => verifyRequestedCases([], []));
  assert.throws(() => verifyRequestedCases([{ attemptId: 'auth-session--webkit' }], rows));
  assert.throws(() =>
    verifyRequestedCases([{ attemptId: 'auth-session--chromium' }], [...rows, ...rows]),
  );
  assert.throws(() =>
    verifyRequestedCases(
      [{ attemptId: 'auth-session--chromium' }, { attemptId: 'auth-session--chromium' }],
      [...rows, ...selectedReportCases(report('webkit'))],
    ),
  );
  assert.throws(() =>
    selectedReportCases({ suites: [{ specs: [{ title: 'wrong scenario', tests: [] }] }] }),
  );
  assert.throws(() => selectedReportCases({ suites: 'not an array' }));
});
void test('passing proof requires every declared assertion with exact traceability and owner identity', () => {
  const selected = {
    attemptId: 'auth-session--chromium',
    scenarioId: 'auth-session',
    project: 'chromium',
  } as IntegrationCase;
  const runId = 'a'.repeat(24);
  const proof = {
    schemaVersion: 1,
    runId,
    ...selected,
    browserVersion: '1',
    assertions: INTEGRATION_SCENARIOS[0].assertions.map((row) => ({
      id: row.id,
      requirementRefs: row.refs,
      outcome: 'passed',
      evidencePaths: ['attempts/proof.json'],
    })),
  };
  assert(validateAssertionProof(proof, selected, runId).complete);
  assert(
    !validateAssertionProof({ ...proof, assertions: proof.assertions.slice(1) }, selected, runId)
      .complete,
  );
  assert(
    !validateAssertionProof(
      { ...proof, assertions: proof.assertions.map((row) => ({ ...row, outcome: 'failed' })) },
      selected,
      runId,
    ).complete,
  );
  assert.throws(() => validateAssertionProof({ ...proof, runId: 'b'.repeat(24) }, selected, runId));
  assert.throws(() =>
    validateAssertionProof(
      { ...proof, assertions: [...proof.assertions, proof.assertions[0]] },
      selected,
      runId,
    ),
  );
  assert.throws(() =>
    validateAssertionProof(
      {
        ...proof,
        assertions: proof.assertions.map((row) => ({ ...row, requirementRefs: ['invented'] })),
      },
      selected,
      runId,
    ),
  );
});
