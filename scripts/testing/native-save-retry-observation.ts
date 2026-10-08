import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeHierarchyHasAttribute } from './native-hierarchy';
import { assertTestingDocument } from './schema-validation';
import { enUS } from '../../localization/en-US';
import type { startOwnedApiProxy } from './owned-api-proxy';
import type { OwnedDomainSnapshot } from './owned-session';

const draftName = 'Native QA Draft';
const quantityId = 'pro.training_plan.itemRow.en_QA_Exercise_1.quantity';
const exerciseId = '00000000-0000-4000-8000-000000000001';
export type NativeSaveRetryPlatform = 'ios' | 'android';
export type NativeSaveRetryScope = `native-entry-${NativeSaveRetryPlatform}`;
export const nativeSaveRetryFaultTarget = Object.freeze({
  method: 'POST' as const,
  path: '/plans/training' as const,
});
export type NativeSaveRetryObserve = (
  label: string,
  actions: string,
  viewId: string,
  selectors: string | string[],
  kind?: 'id' | 'text',
) => Promise<void>;
export type NativeSaveRetryObservationOptions = {
  platform: NativeSaveRetryPlatform;
  output: string;
  accountUid: string;
  report: Record<string, unknown>;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>;
  observe: NativeSaveRetryObserve;
  snapshotScope?: NativeSaveRetryScope;
};

function nativeSaveRetryScope(platform: NativeSaveRetryPlatform): NativeSaveRetryScope {
  return `native-entry-${platform}`;
}

function nativeResourceIdMatches(
  platform: NativeSaveRetryPlatform,
  attributes: Record<string, unknown>,
  id: string,
) {
  return (
    attributes['resource-id'] === id ||
    (platform === 'android' &&
      attributes['resource-id'] === `com.edufelip.mychampions.dev:id/${id}`)
  );
}

function find(tree: unknown, predicate: (attributes: Record<string, unknown>) => boolean): boolean {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return false;
  const row = tree as { attributes?: Record<string, unknown>; children?: unknown[] };
  return (
    Boolean(row.attributes && predicate(row.attributes)) ||
    Boolean(row.children?.some((child) => find(child, predicate)))
  );
}
/** Validate the retained draft using the platform's actual hierarchy value attributes. */
export function requireNativeRetryDraft(
  platform: NativeSaveRetryPlatform,
  tree: unknown,
  saveEnabled: boolean,
) {
  assert(platform === 'ios' || platform === 'android', 'Native save/retry platform is invalid');
  const fieldAttribute = platform === 'ios' ? 'value' : 'text';
  const quantityAttribute = platform === 'ios' ? 'accessibilityText' : 'text';
  assert(
    find(
      tree,
      (a) =>
        nativeResourceIdMatches(platform, a, 'pro.training_plan.name') &&
        a[fieldAttribute] === draftName &&
        a.enabled === 'true',
    ),
    'Retry draft name is absent or not editable',
  );
  // A retained unsaved draft must offer an enabled Save. An unchanged reopened
  // plan must offer no enabled Save; its disabled footer may be off-screen.
  const enabledSave = find(
    tree,
    (a) =>
      nativeResourceIdMatches(platform, a, 'pro.training_plan.saveButton') && a.enabled === 'true',
  );
  assert(enabledSave === saveEnabled, 'Retry draft Save state is wrong');
  const sessionHasQuantity = (node: unknown): boolean => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
    const row = node as { attributes?: Record<string, unknown>; children?: unknown[] };
    return (
      (row.attributes &&
        nativeResourceIdMatches(
          platform,
          row.attributes,
          'pro.training_plan.sessionRow.Strength',
        ) &&
        find(
          node,
          (a) => nativeResourceIdMatches(platform, a, quantityId) && a[quantityAttribute] === '3x8',
        )) ||
      Boolean(row.children?.some(sessionHasQuantity))
    );
  };
  assert(sessionHasQuantity(tree), 'Retry draft lost the exact session/quantity');
}

/** Existing iOS callers retain the original default platform contract. */
export function requireIosRetryDraft(tree: unknown, saveEnabled: boolean) {
  requireNativeRetryDraft('ios', tree, saveEnabled);
}

export function validateNativeRetrySnapshots(
  before: OwnedDomainSnapshot,
  failed: OwnedDomainSnapshot,
  after: OwnedDomainSnapshot,
  accountUid: string,
  platform: NativeSaveRetryPlatform = 'ios',
) {
  assert(platform === 'ios' || platform === 'android', 'Native save/retry platform is invalid');
  const baseline = requireNativeRetrySnapshot(before, platform);
  requireNativeRetrySnapshot(failed, platform, baseline.runId);
  requireNativeRetrySnapshot(after, platform, baseline.runId);
  assert.deepEqual(failed, baseline, 'Failed native save mutated domain SQL');
  assert.deepEqual(after.connections, baseline.connections);
  const created = after.trainingPlans.filter(
    (p) => !baseline.trainingPlans.some((old) => old.id === p.id),
  );
  assert.equal(created.length, 1, 'Native retry must create exactly one new plan');
  assert.deepEqual(
    after.trainingPlans.filter((p) => p.id !== created[0].id),
    baseline.trainingPlans,
  );
  const plan = created[0];
  assert.equal(plan.ownerProfessionalUid, accountUid);
  assert.equal(plan.name, draftName);
  assert.equal(plan.sourceKind, 'predefined');
  assert.equal(plan.isArchived, false);
  assert.equal(plan.isDraft, false);
  assert.equal(plan.sessions.length, 1);
  const session = plan.sessions[0] as { name?: string; items?: Record<string, unknown>[] };
  assert.equal(session.name, 'Strength');
  assert.equal(session.items?.length, 1);
  assert.equal(session.items[0].name, 'en QA Exercise 1');
  assert.equal(session.items[0].exerciseId, exerciseId);
  assert.equal(session.items[0].quantity, '3x8');
  return plan.id;
}

function requireNativeRetrySnapshot(
  value: OwnedDomainSnapshot,
  platform: NativeSaveRetryPlatform,
  expectedRunId?: string,
) {
  assertTestingDocument('domain-snapshot-v1', value);
  assert.match(value.runId, /^[a-f0-9]{24}$/, 'Native save/retry snapshot runId is invalid');
  assert.equal(value.scope, nativeSaveRetryScope(platform));
  assert.equal(value.readOnly, true);
  if (expectedRunId !== undefined) assert.equal(value.runId, expectedRunId);
  return value;
}

/** Raw T12 observation; independent review/qualification and T14 remain separate. */
export async function observeNativeSaveRetry(options: NativeSaveRetryObservationOptions) {
  const { platform, output, accountUid, report, snapshot, proxy, observe } = options;
  assert(platform === 'ios' || platform === 'android', 'Native save/retry platform is invalid');
  const snapshotScope = options.snapshotScope ?? nativeSaveRetryScope(platform);
  assert.equal(snapshotScope, nativeSaveRetryScope(platform));
  const writeSnapshot = async (label: string, expectedRunId?: string) => {
    const value = requireNativeRetrySnapshot(await snapshot(), platform, expectedRunId);
    await writeFile(path.join(output, `${label}.private.json`), JSON.stringify(value), {
      mode: 0o600,
      flag: 'wx',
    });
    return value;
  };
  const tree = async (label: string) =>
    JSON.parse(await readFile(path.join(output, `${label}-hierarchy.json`), 'utf8')) as unknown;
  const tapSave =
    '- scrollUntilVisible:\n    element:\n      id: pro.training_plan.saveButton\n    direction: DOWN\n    timeout: 20000\n    centerElement: true\n- tapOn:\n    id: pro.training_plan.saveButton';
  const before = await writeSnapshot('save-retry-before');
  const attemptId = `native-save-${before.runId}`;
  await proxy.armObservedNativeSaveFault({
    attemptId,
    ...nativeSaveRetryFaultTarget,
    accountUid,
  });
  try {
    await observe(
      'save-error',
      tapSave,
      'STATE-training-save-error',
      enUS['pro.plan.error.save'],
      'text',
    );
    const errorTree = await tree('save-error');
    assert(
      nativeHierarchyHasAttribute(
        errorTree,
        platform === 'ios' ? 'accessibilityText' : 'text',
        enUS['pro.plan.error.save'],
      ) ||
        (platform === 'android' &&
          nativeHierarchyHasAttribute(errorTree, 'accessibilityText', enUS['pro.plan.error.save'])),
      'Native save error is absent from the platform hierarchy',
    );
    assert.deepEqual(proxy.faultState, { attemptId, injectedCount: 1 });
    const failed = await writeSnapshot('save-retry-after-failure', before.runId);
    assert.deepEqual(failed, before, 'Injected save changed SQL');
    // Alert.alert with no custom buttons uses the platform's normal OK action.
    // Capture this exact OS branch; do not fall back to coordinates/indexes.
    await observe(
      'save-retained',
      '- tapOn: "^OK$"\n- scrollUntilVisible:\n    element:\n      id: pro.training_plan.itemRow.en_QA_Exercise_1.quantity\n    direction: UP\n    timeout: 20000',
      'SCR-training-builder',
      ['pro.training_plan.screen', quantityId],
    );
    requireNativeRetryDraft(platform, await tree('save-retained'), true);
    assert.deepEqual(proxy.clearFault(attemptId), { attemptId, injectedCount: 1 });
    await observe(
      'save-retry-library',
      tapSave,
      'SCR-training-library',
      'pro.library.training.create',
    );
    const after = await writeSnapshot('save-retry-after-success', before.runId);
    const createdId = validateNativeRetrySnapshots(before, failed, after, accountUid, platform);
    await observe(
      'save-retry-reopened',
      `- scrollUntilVisible:\n    element:\n      id: pro.library.training.row.${createdId}\n    direction: DOWN\n    timeout: 20000\n- tapOn:\n    id: pro.library.training.row.${createdId}\n- scrollUntilVisible:\n    element:\n      id: ${quantityId}\n    direction: DOWN\n    timeout: 20000`,
      'SCR-training-builder',
      ['pro.training_plan.screen', quantityId],
    );
    requireNativeRetryDraft(platform, await tree('save-retry-reopened'), false);
    const final = await writeSnapshot('save-retry-after-reopen', before.runId);
    assert.deepEqual(final, after, 'Reopening retry plan changed SQL');
    const routeHash = createHash('sha256').update('/plans/training').digest('hex');
    const writes = proxy.observations.filter(
      (r) => r.method === 'POST' && r.pathHash === routeHash,
    );
    assert.equal(writes.length, 2);
    assert.equal(writes[0].outcome, 'injected');
    assert.equal(writes[0].status, 503);
    assert.equal(writes[1].outcome, 'forwarded');
    assert.equal(writes[1].status, 201);
    for (const row of writes) assert.equal(row.requestProfile, 'native');
    const readHash = createHash('sha256').update(`/plans/training/${createdId}`).digest('hex');
    assert(
      proxy.observations.some(
        (r) =>
          r.method === 'GET' &&
          r.pathHash === readHash &&
          r.status === 200 &&
          r.outcome === 'forwarded' &&
          r.requestProfile === 'native',
      ),
    );
    report.saveRetryPreparation = {
      platform,
      snapshotScope,
      faultTarget: nativeSaveRetryFaultTarget,
      requirementRefs: ['SC-208', 'TC-278', 'BR-293', 'BR-294', 'UC-002.7', 'BL-018/P4-save-retry'],
      createdId,
      accountUid,
      faultAttemptId: attemptId,
      attemptId,
      injectedCount: 1,
      snapshotPaths: [
        'save-retry-before.private.json',
        'save-retry-after-failure.private.json',
        'save-retry-after-success.private.json',
        'save-retry-after-reopen.private.json',
      ],
      scope:
        'raw-native-save-error-retained-draft-and-retry-observation; no qualified behavior pass',
    };
  } catch (error) {
    // Preserve the original UI failure. A successful response alone is not
    // durable SQL proof, so retain a scoped snapshot before owned teardown.
    try {
      await writeSnapshot('save-retry-on-failure', before.runId);
      report.saveRetryFailureSnapshot = 'save-retry-on-failure.private.json';
    } catch {
      report.saveRetryFailureSnapshotUnavailable = true;
    }
    throw error;
  } finally {
    if (proxy.faultState?.attemptId === attemptId) proxy.clearFault(attemptId);
  }
}

/** Existing iOS capture keeps its original public function and iOS defaults. */
export function observeIosSaveRetry(options: Omit<NativeSaveRetryObservationOptions, 'platform'>) {
  return observeNativeSaveRetry({ ...options, platform: 'ios' });
}

/** Android adapter seam; execution wiring remains owned by the capture/runner task. */
export function observeAndroidSaveRetry(
  options: Omit<NativeSaveRetryObservationOptions, 'platform'>,
) {
  return observeNativeSaveRetry({ ...options, platform: 'android' });
}
