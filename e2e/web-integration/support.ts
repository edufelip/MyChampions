import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { loadIntegrationContext } from '../../scripts/testing/integration-context';
import { INTEGRATION_SCENARIOS } from '../../scripts/testing/integration-registry';
import { readOwnedRuntimeDocument } from '../../scripts/testing/owned-session';
import { assertTestingDocument, assertArtifactPath } from '../../scripts/testing/schema-validation';
import { invokeWorkerControl } from '../../scripts/testing/worker-control';
import type { OwnedDomainSnapshot, OwnedFixtures } from '../../scripts/testing/owned-session';
import type { WorkerOperation } from '../../scripts/testing/worker-control';
import type { TestInfo, Browser } from '@playwright/test';

export async function integrationCase(scenarioId: string, info: TestInfo, browser: Browser) {
  const context = loadIntegrationContext();
  const selected = context.cases.find(
    (row) => row.scenarioId === scenarioId && row.project === info.project.name,
  );
  const scenario = INTEGRATION_SCENARIOS.find((row) => row.id === scenarioId);
  if (!selected || !scenario) throw new Error('Unrequested integration case');
  const fixtures = (await readOwnedRuntimeDocument(
    selected.fixtureRef,
    path.dirname(selected.fixtureRef),
    path.basename(selected.fixtureRef),
    'application-fixtures-v1',
  )) as OwnedFixtures;
  if (fixtures.runId !== context.runId || fixtures.scope !== selected.fixtureScope)
    throw new Error('Integration fixture scope mismatch');
  const directory = path.join(context.artifactRoot, 'attempts');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const evidence = `attempts/${selected.attemptId}.assertions.json`;
  const proof = {
    schemaVersion: 1,
    runId: context.runId,
    attemptId: selected.attemptId,
    scenarioId,
    project: info.project.name,
    browserVersion: browser.version(),
    assertions: [] as {
      id: string;
      requirementRefs: string[];
      outcome: 'passed' | 'failed';
      evidencePaths: string[];
    }[],
  };
  const persist = async () => {
    assertTestingDocument('integration-assertions-v1', proof);
    await writeFile(
      assertArtifactPath(context.artifactRoot, evidence),
      JSON.stringify(proof, null, 2),
      { mode: 0o600 },
    );
  };
  await persist();
  const controlRequest = async (operation: WorkerOperation) => {
    try {
      return await invokeWorkerControl(context, selected, operation);
    } catch (error) {
      const block = {
        schemaVersion: 1,
        runId: context.runId,
        attemptId: selected.attemptId,
        code: 'worker-control',
        operation: operation.kind,
      };
      assertTestingDocument('integration-harness-block-v1', block);
      await writeFile(
        path.join(directory, `${selected.attemptId}.harness-block.json`),
        JSON.stringify(block),
        { mode: 0o600 },
      );
      throw error;
    }
  };
  const privateEvidence: string[] = [];
  let snapshotNumber = 0;
  let observationNumber = 0;
  return {
    async recordEvidence(label: string, value: unknown) {
      if (!/^[a-z][a-z0-9-]{0,47}$/.test(label)) throw new Error('Invalid observation label');
      const file = `attempts/${selected.attemptId}.${label}-${++observationNumber}.private.json`;
      const bytes = JSON.stringify(value);
      if (Buffer.byteLength(bytes) > 1_048_576) throw new Error('Observation exceeds size limit');
      await writeFile(assertArtifactPath(context.artifactRoot, file), bytes, { mode: 0o600 });
      privateEvidence.push(file);
    },
    async snapshot() {
      const value = (await controlRequest({
        kind: 'snapshot',
      })) as OwnedDomainSnapshot;
      const file = `attempts/${selected.attemptId}.snapshot-${++snapshotNumber}.private.json`;
      await writeFile(assertArtifactPath(context.artifactRoot, file), JSON.stringify(value), {
        mode: 0o600,
      });
      privateEvidence.push(file);
      return value;
    },
    async restart() {
      return (await controlRequest({ kind: 'restart' })) as {
        apiOrigin: string;
        apiPid: number;
      };
    },
    async armSaveFault(input: { method: 'POST' | 'PATCH'; path: string; accessToken: string }) {
      return (await controlRequest({
        kind: 'arm-save-fault',
        ...input,
      })) as { attemptId: string; injectedCount: number };
    },
    async clearSaveFault() {
      return (await controlRequest({ kind: 'clear-save-fault' })) as {
        attemptId: string;
        injectedCount: number;
      };
    },
    context,
    selected,
    fixtures,
    async assert(id: string, check: () => Promise<void> | void) {
      const declared = scenario.assertions.find((row) => row.id === id);
      if (!declared || proof.assertions.some((row) => row.id === id))
        throw new Error('Unknown or duplicate integration assertion');
      const evidenceStart = privateEvidence.length;
      try {
        await check();
        proof.assertions.push({
          id,
          requirementRefs: declared.refs,
          outcome: 'passed',
          evidencePaths: [evidence, ...privateEvidence.slice(evidenceStart)],
        });
      } catch (error) {
        proof.assertions.push({
          id,
          requirementRefs: declared.refs,
          outcome: 'failed',
          evidencePaths: [evidence, ...privateEvidence.slice(evidenceStart)],
        });
        await persist();
        throw error;
      }
      await persist();
    },
  };
}
