import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import YAML from 'yaml';
import { androidCameraSelectionHash } from '../../scripts/testing/native-camera-android-contract';
import {
  loadAndroidCameraSavedFlow,
  setAndroidCameraInviteCode,
} from '../../scripts/testing/native-camera-android-saved-flow';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';

type InventoryScenario = NativePilotSelection['scenario'] & {
  behaviorStatus: string;
  freshness: string;
  receiptIds: string[];
};
type Inventory = { scenarios: InventoryScenario[] };

const root = path.resolve(__dirname, '../..');

function commands(actions: string): Record<string, unknown>[] {
  const document = YAML.parseDocument(actions);
  assert.equal(document.errors.length, 0, document.errors.map((error) => error.message).join('; '));
  const value = document.toJS() as unknown;
  assert(Array.isArray(value) && value.length > 0);
  return value as Record<string, unknown>[];
}

async function selection() {
  const inventory = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as Inventory;
  return selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-camera-denied-android',
      mode: 'integration',
    },
    inventory,
    root,
  );
}

void test('production Android camera callback binds the saved flow, fixture and exact selectors', async () => {
  const inventory = JSON.parse(
    await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as Inventory;
  assert.deepEqual(
    inventory.scenarios.filter((scenario) => scenario.maestroFlow).map((scenario) => scenario.id),
    ['SCN-camera-denied-android'],
  );
  const current = await selection();
  const currentScenario = current.scenario as InventoryScenario;
  assert.equal(currentScenario.behaviorStatus, 'untested');
  assert.equal(currentScenario.freshness, 'unknown');
  assert.deepEqual(currentScenario.receiptIds, []);
  const flow = await loadAndroidCameraSavedFlow({
    repositoryRoot: root,
    selection: current,
    deadlineAtMonotonicMs: performance.now() + 30_000,
  });
  assert.equal(current.scenario.maestroFlow, '.maestro/flows/camera-denied-android.yaml');
  assert.equal(flow.selectors.entryHome, 'student.home.accountButton');
  assert(current.scenario.freshnessInputs.ownerPaths?.includes(flow.binding.path));
  assert(
    current.scenario.freshnessInputs.sourceIds?.includes('SRC-android-camera-saved-route-source'),
  );
  assert.equal(flow.binding.fixtureRef, current.scenario.fixtureRef);
  assert.equal(flow.binding.scenarioId, current.scenario.id);
  assert.equal(flow.binding.flowId, current.scenario.flowId);
  assert.equal(
    flow.binding.sha256,
    '47c06ed1bfab1245f0a042433e4bdf6f74697af0a2c674f13f523bc744515e78',
  );
  assert.match(androidCameraSelectionHash(current), /^[a-f0-9]{64}$/u);

  const source = await readFile(
    path.join(root, 'scripts/testing/capture-android-testability.ts'),
    'utf8',
  );
  assert.match(source, /loadAndroidCameraSavedFlow\(/u);
  assert.match(
    source,
    /androidCameraSavedFlowModulePath\s*=\s*'\.\/native-camera-android-saved-flow'/u,
  );
  assert.match(source, /savedFlow:\s*savedFlow!/u);
  assert.match(source, /setInviteCode:\s*setCameraInviteCode/u);
  assert.match(source, /androidCameraSavedFlow:\s*savedFlow\?\.binding/u);
  assert.match(source, /runtimeFixtureRef:\s*report\.fixtureRef/u);
  assert.match(source, /runtimeFixtureRunId:\s*fixtures\.runId/u);
  assert.match(source, /runtimeFixtureScope:\s*fixtures\.scope/u);
  assert.match(source, /'native-camera-android-saved-flow\.ts'/u);
  assert.match(source, /'\.maestro\/flows\/camera-denied-android\.yaml'/u);
  assert.match(source, /file\.startsWith\('\.maestro\/'\)/u);
  assert.match(source, /run\([\s\S]*?maestroEnv,[\s\S]*?180000/u);
  assert.match(source, /signal:\s*controller\.signal/u);

  const entry = commands(flow.renderEntry());
  assert.equal((entry[0] as { tapOn: { id: string } }).tapOn.id, 'student.home.accountButton');
  assert.equal(
    (entry[1] as { extendedWaitUntil: { visible: { id: string } } }).extendedWaitUntil.visible.id,
    'student.professionals.screen',
  );
  assert.equal(
    (entry[2] as { assertVisible: { id: string } }).assertVisible.id,
    'student.professionals.scanQrButton',
  );
  const prompt = commands(flow.renderPrompt());
  assert.equal(
    (prompt[0] as { tapOn: { id: string } }).tapOn.id,
    'student.professionals.scanQrButton',
  );
  assert.equal(
    (prompt[1] as { extendedWaitUntil: { visible: { id: string } } }).extendedWaitUntil.visible.id,
    flow.selectors.promptMessage,
  );
  const denied = commands(
    flow.renderDenied('com.android.permissioncontroller:id/permission_deny_button'),
  );
  assert.equal(
    (denied[0] as { tapOn: { id: string } }).tapOn.id,
    'com.android.permissioncontroller:id/permission_deny_button',
  );
  const manual = commands(flow.renderManual());
  assert.equal((manual[2] as { inputText: string }).inputText, '${MAESTRO_CAMERA_INVITE_CODE}');
  const submit = commands(flow.renderSubmit());
  assert.equal(
    (submit[0] as { tapOn: { id: string } }).tapOn.id,
    'student.professionals.connectButton',
  );
  const pending = commands(flow.renderPending('pending-123'));
  assert.equal(
    (pending[0] as { scrollUntilVisible: { element: { id: string } } }).scrollUntilVisible.element
      .id,
    'student.professionals.connectionPending.pending-123',
  );
  assert.equal(
    (pending[2] as { assertVisible: { id: string } }).assertVisible.id,
    'student.professionals.connectionPending.pending-123',
  );
  assert.doesNotMatch(JSON.stringify(flow), /pending-123/u);
});

void test('invite injection is child-environment-only, single-use and cancellation-safe', async () => {
  const env: Record<string, string> = { MAESTRO_CLI_NO_ANALYTICS: 'true' };
  setAndroidCameraInviteCode(env, 'LIVE-CODE-123');
  assert.equal(env.MAESTRO_CAMERA_INVITE_CODE, 'LIVE-CODE-123');
  assert.throws(() => setAndroidCameraInviteCode(env, 'SECOND-CODE'));
  assert.throws(() => setAndroidCameraInviteCode({}, 'bad code with spaces'));

  const current = await selection();
  const controller = new AbortController();
  controller.abort(new Error('cancel before saved-flow read'));
  await assert.rejects(
    loadAndroidCameraSavedFlow({
      repositoryRoot: root,
      selection: current,
      deadlineAtMonotonicMs: performance.now() + 30_000,
      signal: controller.signal,
    }),
  );
});

void test('saved-flow reader rejects expired reads, route replacement and descriptor races', async () => {
  const current = await selection();
  const routeBytes = await readFile(path.join(root, '.maestro/flows/camera-denied-android.yaml'));
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'android-saved-flow-reader-'));
  const canonicalTemporaryRoot = await realpath(temporaryRoot);
  const routePath = path.join(temporaryRoot, '.maestro/flows/camera-denied-android.yaml');
  try {
    await mkdir(path.dirname(routePath), { recursive: true });
    await writeFile(routePath, routeBytes, { mode: 0o644 });

    await assert.rejects(
      loadAndroidCameraSavedFlow({
        repositoryRoot: canonicalTemporaryRoot,
        selection: current,
        deadlineAtMonotonicMs: performance.now() - 1,
      }),
      /deadline expired/u,
    );

    await writeFile(routePath, Buffer.concat([routeBytes, Buffer.from('\n# replaced\n')]));
    await assert.rejects(
      loadAndroidCameraSavedFlow({
        repositoryRoot: canonicalTemporaryRoot,
        selection: current,
        deadlineAtMonotonicMs: performance.now() + 30_000,
      }),
      /declared route revision/u,
    );

    await writeFile(routePath, routeBytes, { mode: 0o644 });
    const hardlinkPath = path.join(temporaryRoot, '.maestro/flows/camera-denied-android-copy.yaml');
    await link(routePath, hardlinkPath);
    await assert.rejects(
      loadAndroidCameraSavedFlow({
        repositoryRoot: canonicalTemporaryRoot,
        selection: current,
        deadlineAtMonotonicMs: performance.now() + 30_000,
      }),
      /one link/u,
    );
    await rm(hardlinkPath);

    const externalRoute = path.join(temporaryRoot, 'route-outside-root.yaml');
    await writeFile(externalRoute, routeBytes, { mode: 0o644 });
    await rm(routePath);
    await symlink(externalRoute, routePath);
    await assert.rejects(
      loadAndroidCameraSavedFlow({
        repositoryRoot: canonicalTemporaryRoot,
        selection: current,
        deadlineAtMonotonicMs: performance.now() + 30_000,
      }),
      /regular file|canonical/u,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
