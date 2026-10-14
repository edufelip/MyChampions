import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertTestingDocument } from './schema-validation';
import { enUS } from '../../localization/en-US';
import type { startOwnedApiProxy, ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot } from './owned-session';

export const nativeLoadSnapshotPaths = [
  'load-before.private.json',
  'load-after-failure.private.json',
  'load-after-retry.private.json',
];
const hash = (route: string) => createHash('sha256').update(route).digest('hex');
type NativePlatform = 'ios' | 'android';
function matchingId(value: unknown, id: string, platform: NativePlatform) {
  return (
    value === id || (platform === 'android' && value === `com.edufelip.mychampions.dev:id/${id}`)
  );
}
function has(tree: unknown, id: string, platform: NativePlatform): boolean {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return false;
  const node = tree as { attributes?: Record<string, unknown>; children?: unknown[] };
  return (
    matchingId(node.attributes?.['resource-id'], id, platform) ||
    Boolean(node.children?.some((child) => has(child, id, platform)))
  );
}
function find(
  tree: unknown,
  id: string,
  attribute: string,
  value: string,
  platform: NativePlatform,
): boolean {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return false;
  const node = tree as { attributes?: Record<string, unknown>; children?: unknown[] };
  return (
    (matchingId(node.attributes?.['resource-id'], id, platform) &&
      node.attributes?.[attribute] === value) ||
    Boolean(node.children?.some((child) => find(child, id, attribute, value, platform)))
  );
}
function sessionHasQuantity(tree: unknown, platform: NativePlatform): boolean {
  if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return false;
  const node = tree as { attributes?: Record<string, unknown>; children?: unknown[] };
  return (
    (matchingId(node.attributes?.['resource-id'], 'pro.training_plan.sessionRow.Upper', platform) &&
      find(
        tree,
        'pro.training_plan.itemRow.QA_Exercise.quantity',
        platform === 'ios' ? 'accessibilityText' : 'text',
        '3x8',
        platform,
      )) ||
    Boolean(node.children?.some((child) => sessionHasQuantity(child, platform)))
  );
}

/** Separate scrolled frame: full-name recovery remains required in the original frame. */
export function requireNativeRecoveredQuantityFrame(platform: NativePlatform, tree: unknown) {
  assert(['ios', 'android'].includes(platform));
  const nodes = (
    value: unknown,
  ): { attributes?: Record<string, unknown>; children?: unknown[] }[] => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as { attributes?: Record<string, unknown>; children?: unknown[] };
    return [row, ...(row.children ?? []).flatMap(nodes)];
  };
  const all = nodes(tree);
  const sessions = all.filter((row) =>
    matchingId(row.attributes?.['resource-id'], 'pro.training_plan.sessionRow.Upper', platform),
  );
  assert.equal(sessions.length, 1, 'Recovered quantity session is missing or ambiguous');
  const quantities = all.filter((row) =>
    matchingId(
      row.attributes?.['resource-id'],
      'pro.training_plan.itemRow.QA_Exercise.quantity',
      platform,
    ),
  );
  assert.equal(quantities.length, 1, 'Recovered quantity is missing or ambiguous');
  assert(
    nodes(sessions[0]).includes(quantities[0]),
    'Recovered quantity is detached from its session',
  );
  assert.equal(
    quantities[0].attributes?.[platform === 'ios' ? 'accessibilityText' : 'text'],
    '3x8',
  );
  assert.equal(quantities[0].attributes?.enabled, 'true');
  assert(!has(tree, 'pro.training_plan.error', platform));
}

/** Evidence validation only; synthetic callers establish no native execution. */
export function requireNativeLoadObservation(input: {
  platform: NativePlatform;
  backendRunId: string;
  savedPlanId: string;
  accountUid: string;
  attemptId: string;
  snapshots: OwnedDomainSnapshot[];
  errorTree: unknown;
  recoveredTree: unknown;
  transport: readonly ProxyObservation[];
}) {
  assert(['ios', 'android'].includes(input.platform));
  const platform = input.platform;
  assert.equal(input.snapshots.length, 3);
  assert.equal(input.attemptId, `native-load-${input.backendRunId}`);
  for (const snapshot of input.snapshots) {
    assertTestingDocument('domain-snapshot-v1', snapshot);
    assert.equal(snapshot.runId, input.backendRunId);
    assert.equal(snapshot.scope, `native-entry-${platform}`);
    assert.deepEqual(snapshot, input.snapshots[0], 'Load observation changed owned SQL');
  }
  const seeded = input.snapshots[0].trainingPlans.find((row) => row.id === input.savedPlanId);
  assert(seeded && seeded.ownerProfessionalUid === input.accountUid);
  assert.equal(seeded.name, `QA native-entry-${platform} Training`);
  assert.deepEqual(seeded.sessions, [
    {
      id: 'qa-session',
      name: 'Upper',
      notes: 'Controlled',
      items: [
        {
          id: 'qa-item',
          name: 'QA Exercise',
          quantity: '3x8',
          notes: 'RPE 7',
          exerciseId: '00000000-0000-4000-8000-000000000001',
        },
      ],
    },
  ]);
  for (const id of [
    'pro.training_plan.error',
    'pro.training_plan.error.retry',
    'pro.training_plan.error.backToLibrary',
  ])
    assert(has(input.errorTree, id, platform));
  for (const id of ['pro.training_plan.error.retry', 'pro.training_plan.error.backToLibrary'])
    assert(find(input.errorTree, id, 'enabled', 'true', platform));
  assert(
    find(
      input.errorTree,
      'pro.training_plan.error',
      platform === 'ios' ? 'accessibilityText' : 'text',
      enUS['pro.plan.error.load'],
      platform,
    ),
  );
  for (const id of [
    'pro.training_plan.name',
    'pro.training_plan.addSession',
    'pro.training_plan.saveButton',
  ])
    assert(!has(input.errorTree, id, platform), 'Load error still mounts form controls');
  assert(
    find(
      input.recoveredTree,
      'pro.training_plan.name',
      platform === 'ios' ? 'value' : 'text',
      seeded.name,
      platform,
    ),
  );
  assert(has(input.recoveredTree, 'pro.training_plan.sessionRow.Upper', platform));
  assert(
    sessionHasQuantity(input.recoveredTree, platform),
    'Recovered quantity is not in the seeded session',
  );
  assert(
    find(
      input.recoveredTree,
      'pro.training_plan.itemRow.QA_Exercise.quantity',
      platform === 'ios' ? 'accessibilityText' : 'text',
      '3x8',
      platform,
    ),
  );
  assert(!has(input.recoveredTree, 'pro.training_plan.error', platform));
  const route = hash(`/plans/training/${input.savedPlanId}`);
  const reads = input.transport.filter((row) => row.pathHash === route);
  assert.equal(reads.length, 2, 'Load observation needs exactly failure and retry detail reads');
  for (const row of reads) {
    assert.equal(row.method, 'GET');
    assert.equal(row.requestProfile, 'native');
    assert.equal(row.requestOrigin, null);
  }
  assert.equal(reads[0].status, 503);
  assert.equal(reads[0].outcome, 'injected');
  assert.equal(reads[0].faultAttemptId, input.attemptId);
  assert.equal(reads[1].status, 200);
  assert.equal(reads[1].outcome, 'forwarded');
  assert.equal(reads[1].faultAttemptId, null);
  assert(reads[1].requestId > reads[0].requestId);
  assert.equal(reads[0].targetOrigin, reads[1].targetOrigin);
  assert.equal(input.transport.filter((row) => row.outcome === 'injected').length, 1);
  assert(
    !input.transport.some(
      (row) =>
        ['POST', 'PATCH', 'DELETE'].includes(row.method) &&
        [route, hash('/plans/training')].includes(row.pathHash),
    ),
    'Load observation attempts a plan write',
  );
  // Professional library uses getPredefinedPlansFromSource; training detail is
  // checked above. GET /plans/training is not its supported list contract.
  for (const route of ['/plans/predefined'])
    assert(
      input.transport.some(
        (row) =>
          row.method === 'GET' &&
          row.pathHash === hash(route) &&
          row.status === 200 &&
          row.outcome === 'forwarded' &&
          row.requestProfile === 'native',
      ),
    );
}

/** Compatibility for existing iOS callers and immutable evidence controls. */
export function requireIosLoadObservation(
  input: Omit<Parameters<typeof requireNativeLoadObservation>[0], 'platform'>,
) {
  requireNativeLoadObservation({ ...input, platform: 'ios' });
}

/** T12 inventory charter, not a T14 native behavior pass. */
export async function observeNativeTrainingLoad({
  platform,
  output,
  savedPlanId,
  accountUid,
  report,
  snapshot,
  proxy,
  observe,
}: {
  platform: NativePlatform;
  output: string;
  savedPlanId: string;
  accountUid: string;
  report: Record<string, unknown>;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  proxy: Awaited<ReturnType<typeof startOwnedApiProxy>>;
  observe: (label: string, actions: string, viewId: string, selectors: string[]) => Promise<void>;
}) {
  const before = await snapshot();
  await writeFile(path.join(output, nativeLoadSnapshotPaths[0]), JSON.stringify(before), {
    flag: 'wx',
    mode: 0o600,
  });
  const tap = (id: string) => `- tapOn:\n    id: ${id}\n`;
  const scroll = (id: string) =>
    `- scrollUntilVisible:\n    element:\n      id: ${id}\n    direction: DOWN\n    timeout: 20000\n${platform === 'android' ? '    centerElement: true\n' : ''}`;
  await observe(
    'training-library',
    scroll('pro.home.trainingCta') + tap('pro.home.trainingCta'),
    'SCR-training-library',
    ['pro.library.training.create', `pro.library.training.row.${savedPlanId}`],
  );
  const attemptId = `native-load-${before.runId}`;
  await proxy.armObservedNativeLoadFault({
    attemptId,
    path: `/plans/training/${savedPlanId}`,
    accountUid,
    fixtureScope: `native-entry-${platform}`,
  });
  await observe(
    'load-error',
    tap(`pro.library.training.row.${savedPlanId}`) +
      '- extendedWaitUntil:\n    visible:\n      id: pro.training_plan.error\n    timeout: 30000\n' +
      '- assertNotVisible:\n    id: pro.training_plan.name\n- assertNotVisible:\n    id: pro.training_plan.addSession\n- assertNotVisible:\n    id: pro.training_plan.saveButton',
    'STATE-training-load-error',
    [
      'pro.training_plan.error',
      'pro.training_plan.error.retry',
      'pro.training_plan.error.backToLibrary',
    ],
  );
  const failed = await snapshot();
  await writeFile(path.join(output, nativeLoadSnapshotPaths[1]), JSON.stringify(failed), {
    flag: 'wx',
    mode: 0o600,
  });
  assert.deepEqual(proxy.clearFault(attemptId), { attemptId, injectedCount: 1 });
  await observe(
    'load-recovered',
    tap('pro.training_plan.error.retry') +
      (platform === 'android'
        ? '- extendedWaitUntil:\n    visible:\n      id: pro.training_plan.name\n    timeout: 30000\n' +
          scroll('pro.training_plan.itemRow.QA_Exercise.quantity')
        : '') +
      '- extendedWaitUntil:\n    visible:\n      id: pro.training_plan.itemRow.QA_Exercise.quantity\n    timeout: 30000\n',
    'SCR-training-builder',
    [
      'pro.training_plan.name',
      'pro.training_plan.sessionRow.Upper',
      'pro.training_plan.itemRow.QA_Exercise.quantity',
    ],
  );
  if (platform === 'android')
    await observe(
      'load-recovered-quantity',
      '- swipe:\n    from:\n      text: \"^Upper$\"\n    direction: UP\n',
      'SCR-training-builder',
      ['pro.training_plan.sessionRow.Upper', 'pro.training_plan.itemRow.QA_Exercise.quantity'],
    );
  const after = await snapshot();
  await writeFile(path.join(output, nativeLoadSnapshotPaths[2]), JSON.stringify(after), {
    flag: 'wx',
    mode: 0o600,
  });
  requireNativeLoadObservation({
    platform,
    backendRunId: before.runId,
    savedPlanId,
    accountUid,
    attemptId,
    snapshots: [before, failed, after],
    errorTree: JSON.parse(await readFile(path.join(output, 'load-error-hierarchy.json'), 'utf8')),
    recoveredTree: JSON.parse(
      await readFile(path.join(output, 'load-recovered-hierarchy.json'), 'utf8'),
    ),
    transport: proxy.observations,
  });
  if (platform === 'android')
    requireNativeRecoveredQuantityFrame(
      platform,
      JSON.parse(
        await readFile(path.join(output, 'load-recovered-quantity-hierarchy.json'), 'utf8'),
      ),
    );
  report.loadPreparation = {
    savedPlanId,
    accountUid,
    attemptId,
    ...(platform === 'android' ? { quantityFrame: 'load-recovered-quantity' } : {}),
    snapshotPaths: nativeLoadSnapshotPaths,
    requirementRefs: ['SC-208'],
    ownedSqlBeforeFailureRetryUnchanged: true,
    scope: 'native-initial-load-error-and-retry-views-only; no behavior pass',
  };
}

/** Existing iOS capture API; platform setup remains owned by its caller. */
export async function observeIosTrainingLoad(
  input: Omit<Parameters<typeof observeNativeTrainingLoad>[0], 'platform'>,
) {
  await observeNativeTrainingLoad({ ...input, platform: 'ios' });
}
