import { spawn, execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL, URL } from 'node:url';
import { promisify } from 'node:util';
import { chromium, firefox, webkit } from '@playwright/test';
import { assertNoIntegratedBypasses } from './integration-preflight';
import {
  INTEGRATION_PROJECTS,
  parseIntegrationArguments,
  integrationAttemptId,
  integrationFixtureScope,
  assertRunnableIntegrationSelection,
} from './integration-registry';
import {
  selectedReportCases,
  verifyRequestedCases,
  validateAssertionProof,
} from './integration-results';
import { startOwnedApiProxy } from './owned-api-proxy';
import { reserveOwnedAppPort, startOwnedExpo } from './owned-expo';
import { trackOwnedProcessGroup } from './owned-process-group';
import { startOwnedSession, OwnedSessionAcquisitionError } from './owned-session';
import { assertTestingDocument, assertPublicReceipt } from './schema-validation';
import { repositoryIdentity } from './testing-repository-identity';
import { startWorkerControl } from './worker-control';
import type { IntegrationContext } from './integration-context';
import type { OwnedFixtures } from './owned-session';

const execute = promisify(execFile);
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function resolveIntegrationServerRoot(
  clientRoot: string,
  configuredRoot = process.env.MYCHAMPIONS_SERVER_ROOT,
): Promise<string> {
  if (!configuredRoot?.trim()) {
    throw new Error('MYCHAMPIONS_SERVER_ROOT is required for integrated browser execution');
  }
  if (!path.isAbsolute(configuredRoot)) {
    throw new Error('MYCHAMPIONS_SERVER_ROOT must be an absolute owning checkout path');
  }

  let serverRoot: string;
  try {
    serverRoot = await realpath(configuredRoot);
  } catch {
    throw new Error('MYCHAMPIONS_SERVER_ROOT does not resolve to an owning checkout');
  }
  if (serverRoot === clientRoot)
    throw new Error('MYCHAMPIONS_SERVER_ROOT must be the server checkout');

  let packageJson: { name?: string };
  try {
    packageJson = JSON.parse(await readFile(path.join(serverRoot, 'package.json'), 'utf8')) as {
      name?: string;
    };
  } catch {
    throw new Error('MYCHAMPIONS_SERVER_ROOT package metadata is unreadable');
  }
  if (packageJson.name !== 'mychampions-server') {
    throw new Error('MYCHAMPIONS_SERVER_ROOT is not the MyChampions server checkout');
  }

  let gitRoot: string;
  try {
    gitRoot = (
      await execute('git', ['rev-parse', '--show-toplevel'], {
        cwd: serverRoot,
        timeout: 5000,
      })
    ).stdout.trim();
  } catch {
    throw new Error('MYCHAMPIONS_SERVER_ROOT is not a readable Git checkout');
  }
  if (!gitRoot || (await realpath(gitRoot)) !== serverRoot) {
    throw new Error('MYCHAMPIONS_SERVER_ROOT Git root does not match its canonical path');
  }
  try {
    await access(path.join(serverRoot, 'scripts/testing/session.ts'));
  } catch {
    throw new Error('MYCHAMPIONS_SERVER_ROOT is missing the owned session entrypoint');
  }
  return serverRoot;
}

async function main() {
  process.umask(0o077);
  const root = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
  const clientRunId = randomBytes(12).toString('hex');
  const configuredOutputRoot = process.env.WEB_INTEGRATION_ARTIFACT_ROOT?.trim();
  const output = path.resolve(
    root,
    configuredOutputRoot ?? path.join('.qa/artifacts/web-integration', clientRunId),
  );
  await mkdir(output, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const controller = new AbortController();
  let signalCode: number | undefined;
  const onInt = () => {
    signalCode = 130;
    controller.abort();
  };
  const onTerm = () => {
    signalCode = 143;
    controller.abort();
  };
  process.once('SIGINT', onInt);
  process.once('SIGTERM', onTerm);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let step = 'selection';
  let selection: ReturnType<typeof parseIntegrationArguments> | undefined;
  let serverRoot: string | undefined;
  let reservation: Awaited<ReturnType<typeof reserveOwnedAppPort>> | undefined;
  let session: Awaited<ReturnType<typeof startOwnedSession>> | undefined;
  let acquisitionFailure: OwnedSessionAcquisitionError | undefined;
  let proxy: Awaited<ReturnType<typeof startOwnedApiProxy>> | undefined;
  let app: Awaited<ReturnType<typeof startOwnedExpo>> | undefined;
  let context: IntegrationContext | undefined;
  let control: Awaited<ReturnType<typeof startWorkerControl>> | undefined;
  const scopeFixtures = new Map<string, OwnedFixtures>();
  let report: ReturnType<typeof selectedReportCases> | undefined;
  let childExitCode: number | null = null;
  let failure: string | undefined;
  let acquisitionAttempted = false;
  let cleanupFailed = false;
  let cleanupMs = 0;
  let buildMs = 0;
  const fixtureMs = new Map<string, number>();
  const privateValues: string[] = [];
  const ownedResourceIds: string[] = [];
  let source: { name: string; sha: string; dirty: boolean; workingTreeHash: string | null }[] = [];
  const runPlaywright = async (args: string[], file: string) => {
    controller.signal.throwIfAborted();
    const require = createRequire(path.join(root, 'package.json'));
    const child = spawn(
      process.execPath,
      [
        require.resolve('@playwright/test/cli'),
        'test',
        '--config=playwright.integration.config.ts',
        ...args,
      ],
      {
        cwd: root,
        detached: true,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          CI: '1',
          NODE_ENV: 'test',
          MC_WEB_INTEGRATION_CONTEXT: path.join(output, 'integration-context.private.json'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let log = '';
    let finished = false;
    let code = 2;
    let workerError: Error | undefined;
    child.once('error', (error) => {
      workerError = error;
      finished = true;
    });
    child.once('close', (value, signal) => {
      code = value ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 2);
      if (!args.length) childExitCode = code;
      finished = true;
    });
    for (const stream of [child.stdout, child.stderr])
      stream?.on('data', (bytes: Buffer) => {
        log = (log + bytes.toString()).slice(-2_097_152);
      });
    const group = await trackOwnedProcessGroup(
      child,
      path.join(output, `${file}.ownership.json`),
    ).catch((error: unknown) => {
      cleanupFailed = true;
      child.stdout?.destroy();
      child.stderr?.destroy();
      throw error;
    });
    ownedResourceIds.push(`worker-group:${group.pgid}`);
    try {
      while (!finished) {
        controller.signal.throwIfAborted();
        if (workerError) throw workerError;
        await group.capture();
        await delay(250, undefined, { signal: controller.signal });
      }
      if (workerError) throw workerError;
      return code;
    } finally {
      try {
        await group.stop();
      } catch (error) {
        cleanupFailed = true;
        throw error;
      } finally {
        child.stdout?.destroy();
        child.stderr?.destroy();
        const closeDeadline = performance.now() + 1000;
        while (!finished && performance.now() < closeDeadline) await delay(25);
        if (!finished) cleanupFailed = true;
        await writeFile(path.join(output, file), log, { mode: 0o600 });
      }
    }
  };
  try {
    selection = parseIntegrationArguments(process.argv.slice(2));
    assertRunnableIntegrationSelection(selection);
    assertNoIntegratedBypasses(process.env);
    if (process.env.APP_VARIANT && process.env.APP_VARIANT !== 'dev')
      throw new Error('Invalid app variant');
    // A fresh proxy cannot reuse an inherited API; reject before acquiring anything.
    if (process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL?.trim())
      throw new Error('Inherited API origin forbidden');
    step = 'prerequisites';
    serverRoot = await resolveIntegrationServerRoot(root);
    timeout = setTimeout(() => controller.abort(), selection.deadlineMs);
    await execute('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15_000 });
    for (const scenario of selection.scenarios) {
      await access(path.join(root, 'e2e/web-integration', scenario.spec));
      for (const file of scenario.requirements) await access(path.join(root, file));
    }
    const browsers = { chromium, firefox, webkit };
    for (const project of selection.projects)
      await access(browsers[INTEGRATION_PROJECTS[project].browser].executablePath());
    controller.signal.throwIfAborted();
    step = 'backend-acquisition';
    reservation = await reserveOwnedAppPort();
    acquisitionAttempted = true;
    session = await startOwnedSession({
      serverRoot,
      appOrigin: reservation.origin,
      deadlineMs: Math.max(selection.deadlineMs, 120_000),
      signal: controller.signal,
      async onAcquired(manifest) {
        await writeFile(
          path.join(output, 'backend-acquired.private.json'),
          JSON.stringify({
            runId: manifest.runId,
            artifactRoot: manifest.artifactRoot,
            composeProject: manifest.composeProject,
            parentPid: process.pid,
            orchestratorPid: manifest.orchestratorPid,
            started: manifest.processes.find((row) => row.role === 'orchestrator')?.started,
          }),
          { mode: 0o600 },
        );
      },
    });
    ownedResourceIds.push(session.manifest.composeProject, `api:${session.apiPid}`);
    source = Object.entries(session.manifest.repositories).map(([name, value]) => ({
      name,
      ...value,
    }));
    controller.signal.throwIfAborted();
    proxy = await startOwnedApiProxy({ session, appOrigin: reservation.origin });
    ownedResourceIds.push(`proxy:${proxy.origin}`);
    context = {
      schemaVersion: 1,
      runId: session.manifest.runId,
      clientRoot: root,
      serverRoot,
      artifactRoot: output,
      appOrigin: reservation.origin,
      apiOrigin: proxy.origin,
      parentPid: process.pid,
      parentStarted: (
        await execute('ps', ['-p', String(process.pid), '-o', 'lstart='], { timeout: 5000 })
      ).stdout.trim(),
      flagsHash: hash(
        JSON.stringify({
          noDotenv: true,
          bypasses: false,
          apiOrigin: proxy.origin,
          appVariant: 'dev',
        }),
      ),
      control: null,
      cases: [],
    };
    step = 'fixtures';
    for (const scenario of selection.scenarios)
      for (const project of selection.projects) {
        controller.signal.throwIfAborted();
        const began = performance.now();
        const fixtureScope = integrationFixtureScope(scenario.id, project);
        const fixture = await session.fixtures(fixtureScope);
        for (const account of Object.values(fixture.accounts))
          privateValues.push(account.password, account.email);
        const fixtureRef = path.join(
          session.manifest.artifactRoot,
          `fixtures-${fixtureScope}.private.json`,
        );
        const requirements: Buffer[] = [];
        for (const file of scenario.requirements)
          requirements.push(Buffer.from(file), await readFile(path.join(root, file)));
        const scenarioParts: Buffer[] = [];
        for (const file of [
          `e2e/web-integration/${scenario.spec}`,
          'e2e/web-integration/support.ts',
          'playwright.integration.config.ts',
          'scripts/testing/integration-context.ts',
          'scripts/testing/integration-registry.ts',
          'scripts/testing/worker-control.ts',
          'scripts/testing/owned-session.ts',
          'scripts/testing/owned-api-proxy.ts',
          'scripts/testing/owned-expo.ts',
        ])
          scenarioParts.push(Buffer.from(file), await readFile(path.join(root, file)));
        const attemptId = integrationAttemptId(scenario.id, project);
        scopeFixtures.set(attemptId, fixture);
        const controlToken = randomBytes(32).toString('hex');
        privateValues.push(controlToken);
        context.cases.push({
          controlToken,
          scenarioId: scenario.id,
          project,
          attemptId,
          fixtureScope,
          fixtureRef,
          fixtureHash: hash(await readFile(fixtureRef)),
          scenarioHash: hash(Buffer.concat(scenarioParts)),
          requirementHash: hash(Buffer.concat(requirements)),
        });
        fixtureMs.set(attemptId, performance.now() - began);
      }
    control = await startWorkerControl({
      context,
      fixtures: scopeFixtures,
      session,
      proxy,
      signal: controller.signal,
    });
    context.control = control.endpoint;
    ownedResourceIds.push(`worker-control:${context.runId}`);
    await writeFile(
      path.join(output, 'worker-control-owner.private.json'),
      JSON.stringify({
        runId: context.runId,
        parentPid: context.parentPid,
        parentStarted: context.parentStarted,
        ...control.endpoint,
      }),
      { mode: 0o600 },
    );
    assertTestingDocument('integration-context-v1', context);
    await writeFile(
      path.join(output, 'integration-context.private.json'),
      JSON.stringify(context),
      { mode: 0o600 },
    );
    step = 'expo';
    const beganBuild = performance.now();
    app = await startOwnedExpo({
      clientRoot: root,
      artifactRoot: output,
      reservation,
      apiOrigin: proxy.origin,
      signal: controller.signal,
    });
    buildMs = performance.now() - beganBuild;
    ownedResourceIds.push(`expo-group:${app.pgid}`);
    const resolvedApp = { environment: app.environment, configExtra: app.configExtra };
    context.flagsHash = hash(JSON.stringify(resolvedApp));
    await writeFile(path.join(output, 'resolved-app.private.json'), JSON.stringify(resolvedApp), {
      mode: 0o600,
    });
    assertTestingDocument('integration-context-v1', context);
    await writeFile(
      path.join(output, 'integration-context.private.json'),
      JSON.stringify(context),
      { mode: 0o600 },
    );
    step = 'discovery';
    const discovered = await runPlaywright(['--list'], 'discovery.private.log');
    if (discovered !== 0) throw new Error('Integrated discovery failed');
    verifyRequestedCases(
      context.cases,
      selectedReportCases(
        JSON.parse(await readFile(path.join(output, 'playwright-results.private.json'), 'utf8')),
      ),
    );
    step = 'scenarios';
    childExitCode = await runPlaywright([], 'playwright.private.log');
    controller.signal.throwIfAborted();
    step = 'verify';
    report = selectedReportCases(
      JSON.parse(await readFile(path.join(output, 'playwright-results.private.json'), 'utf8')),
    );
    verifyRequestedCases(context.cases, report);
    if (
      childExitCode !== 0 &&
      report.every(
        (row) => row.test.status === 'expected' && row.test.results[0]?.status === 'passed',
      )
    )
      throw new Error('Playwright global failure outside a reported scenario');
    if (proxy.observations.some((row) => row.outcome === 'upstream-failed'))
      throw new Error('Owned proxy transport failed');
    await writeFile(
      path.join(output, 'transport.json'),
      JSON.stringify(proxy.observations, null, 2),
      { mode: 0o600 },
    );
  } catch (error) {
    if (error instanceof OwnedSessionAcquisitionError) {
      acquisitionFailure = error;
      childExitCode = error.childExitCode;
      if (error.pid) ownedResourceIds.push(`backend:${error.pid}`);
      if (error.manifest) {
        ownedResourceIds.push(error.manifest.composeProject);
        source = Object.entries(error.manifest.repositories).map(([name, value]) => ({
          name,
          ...value,
        }));
      }
      await writeFile(
        path.join(output, 'backend-acquisition.private.json'),
        JSON.stringify({
          cleanup: error.cleanup,
          childExitCode: error.childExitCode,
          manifest: error.manifest ?? null,
          closed: error.closed ?? null,
        }),
        { mode: 0o600 },
      );
      await writeFile(path.join(output, 'backend-acquisition.private.log'), error.diagnostics, {
        mode: 0o600,
      });
    }
    await writeFile(
      path.join(output, 'harness-error.private.log'),
      error instanceof Error ? (error.stack ?? error.message) : 'Integration harness failed',
      { mode: 0o600 },
    );
    failure = controller.signal.aborted ? 'run-cancelled-or-deadline' : `harness-${step}`;
  } finally {
    clearTimeout(timeout);
    const began = performance.now();
    if (control)
      await writeFile(
        path.join(output, 'worker-control.json'),
        JSON.stringify({ runId: context?.runId, observations: control.observations }, null, 2),
        { mode: 0o600 },
      );
    for (const cleanup of [
      () => control?.stop(),
      () => app?.stop(),
      () => proxy?.stop(),
      () =>
        session
          ? signalCode
            ? session.cancel(signalCode === 130 ? 'SIGINT' : 'SIGTERM')
            : session.stop()
          : undefined,
      () => reservation?.release(),
    ]) {
      try {
        await cleanup();
      } catch {
        cleanupFailed = true;
      }
    }
    if (
      acquisitionAttempted &&
      !session &&
      (!acquisitionFailure || acquisitionFailure.cleanup === 'failed-recovery-ledger-retained')
    )
      cleanupFailed = true;
    cleanupMs = performance.now() - began;
    await unlink(path.join(output, 'integration-context.private.json')).catch(() => {});
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
  }
  const require = createRequire(path.join(root, 'package.json'));
  const version = (
    JSON.parse(await readFile(require.resolve('@playwright/test/package.json'), 'utf8')) as {
      version: string;
    }
  ).version;
  if (!source.length) {
    source = [await repositoryIdentity(root)];
  }
  const recovery = cleanupFailed ? 'recovery.json' : null;
  if (recovery)
    await writeFile(
      path.join(output, recovery),
      JSON.stringify({
        clientRoot: root,
        serverRoot: serverRoot ?? null,
        backendRunId: session?.manifest.runId ?? acquisitionFailure?.manifest?.runId ?? null,
        backendPid: acquisitionFailure?.pid ?? null,
        workerControlRoot: control?.endpoint.root ?? null,
        ownedResourceIds,
        detail:
          'Verify the retained owner ledgers before recovery. Backend acquisition status may be unknown.',
      }),
      { mode: 0o600 },
    );
  const cases =
    context?.cases ??
    (selection
      ? selection.scenarios.flatMap((scenario) =>
          selection.projects.map((project) => ({
            scenarioId: scenario.id,
            attemptId: integrationAttemptId(scenario.id, project),
            project,
            scenarioHash: null,
            requirementHash: null,
            fixtureHash: null,
          })),
        )
      : [
          {
            scenarioId: 'selection-invalid',
            attemptId: 'selection-invalid',
            project: 'chromium' as const,
            scenarioHash: null,
            requirementHash: null,
            fixtureHash: null,
          },
        ]);
  const counts = {
    requested: selection ? selection.scenarios.length * selection.projects.length : null,
    started:
      report?.filter(
        (row) => row.test.results.length > 0 && row.test.results[0].status !== 'skipped',
      ).length ?? 0,
    passed: 0,
    applicationFailed: 0,
    blocked: 0,
    cancelled: 0,
  };
  let exitCode = signalCode ?? (failure || cleanupFailed ? 2 : (childExitCode ?? 2));
  for (const selected of cases) {
    const proofStarted = performance.now();
    const executed = report?.find((row) => row.attemptId === selected.attemptId)?.test;
    let proof: ReturnType<typeof validateAssertionProof> | undefined;
    let invalidProof = false;
    if (context)
      try {
        proof = validateAssertionProof(
          JSON.parse(
            await readFile(
              path.join(output, 'attempts', `${selected.attemptId}.assertions.json`),
              'utf8',
            ),
          ),
          selected as IntegrationContext['cases'][number],
          context.runId,
        );
      } catch {
        invalidProof = true;
      }
    if (!report && proof) counts.started++;
    const proofMs = performance.now() - proofStarted;
    const missing = !executed || executed.status === 'skipped' || executed.results.length !== 1;
    const applicationPassed =
      executed?.status === 'expected' && executed.results[0]?.status === 'passed';
    let controlBlocked =
      control?.observations.some(
        (row) => row.attemptId === selected.attemptId && row.outcome !== 'completed',
      ) ?? false;
    try {
      const controlFailure = JSON.parse(
        await readFile(
          path.join(output, 'attempts', `${selected.attemptId}.harness-block.json`),
          'utf8',
        ),
      ) as { runId: string; attemptId: string };
      assertTestingDocument('integration-harness-block-v1', controlFailure);
      if (
        controlFailure.runId !== context?.runId ||
        controlFailure.attemptId !== selected.attemptId
      )
        throw new Error('Worker block identity mismatch');
      controlBlocked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') controlBlocked = true;
    }
    const blocked =
      controlBlocked ||
      failure ||
      cleanupFailed ||
      missing ||
      invalidProof ||
      (applicationPassed && !proof?.complete);
    const result = signalCode
      ? 'cancelled'
      : blocked
        ? 'harness-blocked'
        : applicationPassed
          ? 'passed'
          : 'application-failed';
    const attemptCode =
      result === 'cancelled'
        ? signalCode!
        : result === 'harness-blocked'
          ? 2
          : result === 'passed'
            ? 0
            : 1;
    if (attemptCode === 2) exitCode = 2;
    if (result === 'passed') counts.passed++;
    else if (result === 'application-failed') counts.applicationFailed++;
    else if (result === 'cancelled') counts.cancelled++;
    else counts.blocked++;
    const artifacts = [
      'playwright-results.private.json',
      'transport.json',
      'backend-acquisition.private.json',
      'worker-control.json',
      `attempts/${selected.attemptId}.harness-block.json`,
      `attempts/${selected.attemptId}.assertions.json`,
    ];
    const available: string[] = [];
    for (const artifact of artifacts)
      if (
        await access(path.join(output, artifact))
          .then(() => true)
          .catch(() => false)
      )
        available.push(artifact);
    const receipt = {
      schemaVersion: 1,
      runId: context?.runId ?? clientRunId,
      attemptId: selected.attemptId,
      scenarioId: selected.scenarioId,
      phase: 'P3',
      layer: 'postgres-ui',
      engine: 'playwright',
      dataMode: 'postgres',
      platform: 'web',
      locale: INTEGRATION_PROJECTS[selected.project].locale,
      repositories: source,
      target: {
        deviceId: null,
        osVersion: null,
        appId: null,
        buildProfile: null,
        binaryHash: null,
        apiOrigin: context?.apiOrigin ?? null,
      },
      inputs: {
        scenarioHash: selected.scenarioHash,
        requirementHash: selected.requirementHash,
        fixtureHash: selected.fixtureHash,
        flagsHash: context?.flagsHash ?? null,
        toolVersions: {
          node: process.version,
          playwright: version,
          ...(proof ? { browser: proof.browserVersion } : {}),
          project: selected.project,
        },
      },
      command: {
        executable: 'node',
        argv: [
          'scripts/testing/run-web-integration.ts',
          ...(selection
            ? [
                `--scenario=${selection.scenarios.map((row) => row.id).join(',')}`,
                `--project=${selection.projects.join(',')}`,
              ]
            : []),
        ],
      },
      startedAt: executed?.results[0]?.startTime ?? startedAt,
      finishedAt: new Date().toISOString(),
      result,
      exitCode: attemptCode,
      childExitCode: childExitCode ?? acquisitionFailure?.childExitCode ?? null,
      assertions: proof?.assertions ?? [],
      timingsMs: {
        build: buildMs,
        install: 0,
        reset: fixtureMs.get(selected.attemptId) ?? 0,
        scenario: executed?.results[0]?.duration ?? 0,
        verify: proofMs,
        cleanup: cleanupMs,
      },
      cleanup: {
        status: cleanupFailed
          ? 'failed-recovery-ledger-retained'
          : session || acquisitionFailure?.cleanup === 'cleaned'
            ? 'cleaned'
            : 'not-acquired',
        ownedResourceIds,
        recoveryRecordPath: recovery,
      },
      artifacts: available,
      blocker:
        result === 'harness-blocked'
          ? {
              code: controlBlocked ? 'WORKER_CONTROL' : (failure ?? 'INCOMPLETE_ATTEMPT'),
              detail: `Integration blocked during ${step}; private diagnostics and ownership are retained.`,
              owner: 'client/server maintainer',
              nextAction:
                'Inspect this attempt and owner ledgers before retrying; no coverage promotion.',
            }
          : null,
    };
    assertPublicReceipt(receipt, output, privateValues);
    await writeFile(
      path.join(output, `${selected.attemptId}.receipt.json`),
      JSON.stringify(receipt, null, 2),
      { mode: 0o600 },
    );
  }
  await writeFile(
    path.join(output, 'batch-summary.json'),
    JSON.stringify(
      {
        kind: 'aggregate; per-attempt receipts are authoritative',
        counts,
        exitCode,
        childExitCode,
        cleanupFailed,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Integrated browser artifacts: ${output}`);
  process.exitCode = exitCode;
}
const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
  void main().catch(() => {
    console.error('Integrated runner receipt validation failed; private owner evidence retained.');
    process.exitCode = 2;
  });
}
