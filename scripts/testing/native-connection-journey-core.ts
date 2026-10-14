import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { writeNativeConnectionAttemptBinding } from './native-connection-attempt-binding';
import {
  verifyConnectionAuthCheckpoint,
  verifyConnectionConfirmationSnapshotTransition,
  verifyConnectionSubmissionSnapshotTransition,
  verifyNativeConnectionJourney,
} from './native-connection-checkpoints';
import {
  resolveActiveConnectionCard,
  resolvePendingConnectionTarget,
  resolvePendingStudentConnectionCard,
} from './native-connection-hierarchy';
import {
  CONNECTION_SNAPSHOT_KEYS,
  type ConnectionActor,
  type ConnectionNavigation,
  type ConnectionPlatformProfile,
} from './native-connection-platform-contract';
import {
  requireConnectionSnapshot,
  verifyConnectionSnapshotCheckpoint,
} from './native-connection-snapshot';
import { nativeHierarchyHasAttribute } from './native-hierarchy';
import { readNativeEvidence } from './native-view-evidence';
import { enUS } from '../../localization/en-US';
import type { DetoxConnectionActionRequest } from './detox-connection-actionability';
import type { NativeConnectionTargetScope } from './native-connection-hierarchy';
import type { OwnedConnectionSnapshot } from './native-connection-snapshot';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeAuthIdentityObservation, ProxyObservation } from './owned-api-proxy';
import type { OwnedDomainSnapshot, OwnedFixtures } from './owned-session';

/**
 * Candidate shared connection controller. The controller owns the seven
 * deterministic purpose transitions; the capture adapters own acquisition,
 * account authentication and platform-specific Maestro details.
 *
 * Android execution is deliberately fail-closed at the roster assignment
 * resolver until the text-based hierarchy contract is qualified. That keeps a
 * future runtime attempt useful for diagnosis without converting an
 * incomplete hierarchy into a passing connection journey.
 */

export const NATIVE_CONNECTION_SNAPSHOT_KEYS = CONNECTION_SNAPSHOT_KEYS;
export type NativeConnectionSnapshotKey = (typeof CONNECTION_SNAPSHOT_KEYS)[number];
export type NativeConnectionArtifactLabel = NativeConnectionSnapshotKey | 'fixtures';
export type NativeConnectionSnapshotReference = { path: string; sha256: string };
export type NativeConnectionSnapshotReferences = Partial<
  Record<NativeConnectionSnapshotKey, NativeConnectionSnapshotReference>
>;

const NATIVE_CONNECTION_ARTIFACT_LABELS = new Set<string>([
  ...NATIVE_CONNECTION_SNAPSHOT_KEYS,
  'fixtures',
]);

/** Read the live, uniquely identified native invite control. Never return it in a report. */
export function requireNativeConnectionInviteCode(tree: unknown): string {
  const matches: Record<string, unknown>[] = [];
  const seen = new WeakSet<object>();
  let count = 0;
  function visit(value: unknown, depth: number) {
    assert(
      value && typeof value === 'object' && !Array.isArray(value),
      'Malformed invite hierarchy',
    );
    assert(depth <= 100 && ++count <= 5000 && !seen.has(value), 'Unbounded invite hierarchy');
    seen.add(value);
    const node = value as { attributes?: unknown; children?: unknown };
    if (node.attributes !== undefined) {
      assert(
        node.attributes && typeof node.attributes === 'object' && !Array.isArray(node.attributes),
        'Malformed invite attributes',
      );
      const attributes = node.attributes as Record<string, unknown>;
      if (attributes['resource-id'] === 'pro.home.inviteCodeValue') matches.push(attributes);
    }
    if (node.children !== undefined) {
      assert(Array.isArray(node.children), 'Malformed invite children');
      for (const child of node.children) visit(child, depth + 1);
    }
  }
  visit(tree, 0);
  assert.equal(matches.length, 1, 'Native invite control is absent or duplicated');
  const text = matches[0].accessibilityText;
  assert(typeof text === 'string', 'Native invite text is absent');
  // The owned server generates eight uppercase hexadecimal characters. The
  // native Text has a localized title followed by a colon, or the exact code.
  const match = /^(?:[^\r\n:]+: )?([A-F0-9]{8})$/.exec(text);
  assert(match, 'Native invite format differs from the current owned server contract');
  return match[1];
}

export function requireNativeConnectionTransport(options: {
  observations: readonly ProxyObservation[];
  method: 'POST' | 'GET';
  route: string;
  status: number;
  targetOrigin: string;
  afterRequestId: number;
  throughRequestId: number;
  unique: boolean;
}): ProxyObservation[] {
  assert(Number.isSafeInteger(options.afterRequestId) && options.afterRequestId >= 0);
  assert(
    Number.isSafeInteger(options.throughRequestId) &&
      options.throughRequestId > options.afterRequestId,
  );
  const ids = new Set<number>();
  for (const row of options.observations) {
    assert(
      Number.isSafeInteger(row.requestId) && row.requestId > 0 && !ids.has(row.requestId),
      'Duplicate or invalid native transport ordinal',
    );
    ids.add(row.requestId);
  }
  const routeHash = createHash('sha256').update(options.route).digest('hex');
  const matching = options.observations.filter(
    (row) =>
      row.requestId > options.afterRequestId &&
      row.requestId <= options.throughRequestId &&
      row.method === options.method &&
      row.pathHash === routeHash,
  );
  assert(
    matching.length > 0 && (!options.unique || matching.length === 1),
    'Native connection transport is absent or ambiguous',
  );
  assert(
    matching.every(
      (row) =>
        row.status === options.status &&
        row.outcome === 'forwarded' &&
        row.requestProfile === 'native' &&
        row.requestOrigin === null &&
        row.faultAttemptId === null &&
        row.targetOrigin === options.targetOrigin,
    ),
    'Native connection transport was not a successful owned forward',
  );
  return matching.map((row) => structuredClone(row));
}

/** Keep semantic report keys separate from their kebab-case artifact filenames. */
export function nativeConnectionSnapshotPath(label: NativeConnectionArtifactLabel): string {
  assert(
    typeof label === 'string' && NATIVE_CONNECTION_ARTIFACT_LABELS.has(label),
    `Unknown native connection artifact label: ${String(label)}`,
  );
  return `connection-${label.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}.private.json`;
}

export function buildNativeConnectionSnapshotReference(
  label: NativeConnectionArtifactLabel,
  bytes: string | Uint8Array,
): NativeConnectionSnapshotReference {
  return {
    path: nativeConnectionSnapshotPath(label),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export function sealNativeConnectionSnapshotReferences(
  snapshots: NativeConnectionSnapshotReferences,
): Record<NativeConnectionSnapshotKey, NativeConnectionSnapshotReference> {
  assert.deepEqual(
    Object.keys(snapshots).sort(),
    [...NATIVE_CONNECTION_SNAPSHOT_KEYS].sort(),
    'Connection snapshot reference keys are incomplete or legacy-shaped',
  );

  const sealed = {} as Record<NativeConnectionSnapshotKey, NativeConnectionSnapshotReference>;
  for (const key of NATIVE_CONNECTION_SNAPSHOT_KEYS) {
    const reference = snapshots[key];
    assert(
      reference && typeof reference === 'object',
      `Connection snapshot reference is missing or malformed: ${key}`,
    );
    assert.equal(typeof reference.path, 'string');
    assert.equal(typeof reference.sha256, 'string');
    assert.equal(reference.path, nativeConnectionSnapshotPath(key));
    assert.match(reference.sha256, /^[a-f0-9]{64}$/);
    sealed[key] = { path: reference.path, sha256: reference.sha256 };
  }
  return sealed;
}

type ConnectionAccountSwitchResult = {
  actor: ConnectionActor;
  beforeRequestId: number;
  authRequestId: number;
  afterRequestId: number;
  actorAuthUid: string;
};

export type SharedConnectionRuntimeContext = {
  output: string;
  fixtures: OwnedFixtures;
  proxy: {
    observations: readonly ProxyObservation[];
    nativeAuthIdentities: readonly NativeAuthIdentityObservation[];
  };
  apiIdentity: { apiPid: number; targetOrigin: string };
  observe: (
    label: string,
    actions: string,
    viewId: string,
    selectors: string | string[],
    kind?: 'id' | 'text',
    action?: DetoxConnectionActionRequest,
  ) => Promise<void>;
  snapshot: () => Promise<OwnedDomainSnapshot>;
  connectionSnapshot: () => Promise<OwnedConnectionSnapshot>;
  isolationSnapshot: () => Promise<OwnedConnectionSnapshot>;
  report: Record<string, unknown>;
  switchAccount: (
    actor: ConnectionActor,
    navigation?: ConnectionNavigation,
  ) => Promise<ConnectionAccountSwitchResult>;
};

export type ConnectionInitialAuth = {
  actor: 'coach';
  actorAuthUid: string;
  authRequestId: number;
  afterRequestId: number;
};

export type ConnectionJourneyPolicy = Readonly<{
  profile: ConnectionPlatformProfile;
  requireInitialCoachAuth: (
    context: SharedConnectionRuntimeContext,
    target: NativeConnectionTargetScope,
  ) => ConnectionInitialAuth;
  requireInviteCode: (tree: unknown) => string;
  resolveRoster: (
    tree: unknown,
    targetStudentAuthUid: string,
    assignmentState: 'pending' | 'active',
  ) => unknown;
  frameQualification?: (input: {
    pendingRosterMatch: unknown;
    rosterMatch: unknown;
  }) => Record<string, unknown>;
}>;

export type ConnectionJourneyOptions = {
  repositoryRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  profile: ConnectionPlatformProfile;
  policy: ConnectionJourneyPolicy;
};

function tap(id: string): string {
  return `- tapOn:\n    id: ${JSON.stringify(id)}\n`;
}

const nativeConnectionPendingIdPattern = 'student\\.professionals\\.connectionPending\\..+';

/** Build the exact Maestro command body used for the one connection submission. */
export function buildNativeConnectionSubmissionActions(
  profile: Pick<ConnectionPlatformProfile, 'selectors' | 'keyboardDismissal'>,
  inviteCode: string,
): string {
  return (
    tap(profile.selectors.studentCodeInput) +
    '- eraseText: 200\n' +
    `- inputText: ${JSON.stringify(inviteCode)}\n` +
    (profile.keyboardDismissal === 'hideKeyboard' ? '- hideKeyboard\n' : '- pressKey: BACK\n') +
    tap(profile.selectors.studentConnect) +
    `- extendedWaitUntil:\n    visible:\n      id: ${JSON.stringify(nativeConnectionPendingIdPattern)}\n    timeout: 90000\n`
  );
}

function scroll(id: string, direction = 'DOWN', timeout = 30000): string {
  return `- scrollUntilVisible:\n    element:\n      id: ${JSON.stringify(id)}\n    direction: ${direction}\n    timeout: ${timeout}\n    centerElement: true\n`;
}

function readPrivateHierarchy(output: string, label: string): unknown {
  assert.match(label, /^[a-z0-9-]+$/);
  return JSON.parse(readNativeEvidence(output, `${label}-hierarchy.json`, true).toString());
}

export function requirePlatformConnectionInviteCode(
  tree: unknown,
  profile: ConnectionPlatformProfile,
): string {
  const matches: Record<string, unknown>[] = [];
  const seen = new WeakSet<object>();
  let count = 0;
  function visit(value: unknown, depth: number) {
    assert(value && typeof value === 'object' && !Array.isArray(value));
    assert(depth <= 100 && ++count <= 5000);
    const object = value as Record<string, unknown>;
    if (seen.has(object)) throw new Error('Connection invite hierarchy contains a cycle');
    seen.add(object);
    if (
      object.attributes &&
      typeof object.attributes === 'object' &&
      !Array.isArray(object.attributes)
    ) {
      const attributes = object.attributes as Record<string, unknown>;
      if (attributes['resource-id'] === profile.selectors.coachInviteCode) matches.push(attributes);
    }
    if (object.children !== undefined) {
      assert(Array.isArray(object.children));
      for (const child of object.children) visit(child, depth + 1);
    }
  }
  visit(tree, 0);
  assert.equal(matches.length, 1, 'Native invite control is absent or duplicated');
  const primary = matches[0][profile.frameTextAttribute];
  const secondary =
    matches[0][profile.frameTextAttribute === 'text' ? 'accessibilityText' : 'text'];
  const readCode = (value: unknown, label: string): string => {
    assert(typeof value === 'string' && value.trim(), `${label} is absent`);
    const match = /^(?:[^\r\n:]+: )?([A-F0-9]{8})$/.exec(value.trim());
    assert(match, 'Native invite format differs from the owned server contract');
    return match[1];
  };
  const primaryCode = readCode(primary, 'Native invite text on the platform attribute');
  if (typeof secondary === 'string' && secondary.trim()) {
    const secondaryCode = readCode(secondary, 'Native invite secondary text');
    assert.equal(secondaryCode, primaryCode, 'Native invite text attributes disagree');
  }
  return primaryCode;
}

/** Execute the shared seven-purpose controller against either owned context. */
export async function observeConnectionJourney(
  context: SharedConnectionRuntimeContext,
  options: ConnectionJourneyOptions,
): Promise<void> {
  const { profile, selection, policy } = options;
  assert.equal(
    selection.arguments.platform,
    profile.platform,
    'Connection journey platform selection differs from the runtime profile',
  );
  assert.equal(
    policy.profile.platform,
    profile.platform,
    'Connection journey policy differs from the runtime profile',
  );
  assert.equal(context.fixtures.scope, profile.fixtureScope);
  const binding = await writeNativeConnectionAttemptBinding({
    ...options,
    artifactRoot: context.output,
    backendRunId: context.fixtures.runId,
  });
  const { fixtures, proxy, output } = context;
  const target = {
    runId: fixtures.runId,
    scope: profile.fixtureScope,
    fixtureAuthUids: Object.values(fixtures.accounts)
      .map((account) => account.authUid)
      .sort(),
    professionalAuthUid: fixtures.accounts.coach.authUid,
    studentAuthUid: fixtures.accounts.student.authUid,
  } satisfies NativeConnectionTargetScope;
  const expected = {
    ...target,
    target: {
      professionalAuthUid: target.professionalAuthUid,
      studentAuthUid: target.studentAuthUid,
      specialty: 'fitness_coach' as const,
    },
  };
  const ordinal = () =>
    proxy.observations.reduce((maximum, row) => Math.max(maximum, row.requestId), 0);
  const persist = async (label: NativeConnectionArtifactLabel, value: unknown) => {
    const bytes = JSON.stringify(value);
    const reference = buildNativeConnectionSnapshotReference(label, bytes);
    await writeFile(path.join(output, reference.path), bytes, { flag: 'wx', mode: 0o600 });
    return reference;
  };
  const fixtureEvidence = await persist('fixtures', fixtures);
  assert.equal(
    fixtureEvidence.sha256,
    context.report.fixtureHash,
    'Capture fixture bytes differ from connection fixture evidence',
  );
  const snapshots: NativeConnectionSnapshotReferences = {};
  const take = async (label: NativeConnectionSnapshotKey): Promise<OwnedConnectionSnapshot> => {
    const value = requireConnectionSnapshot(await context.connectionSnapshot(), expected);
    snapshots[label] = await persist(label, value);
    return value;
  };
  const transportWindows: {
    method: 'POST' | 'GET';
    route: string;
    status: number;
    afterRequestId: number;
    throughRequestId: number;
    unique: boolean;
  }[] = [];
  const transport = (
    method: 'POST' | 'GET',
    route: string,
    status: number,
    afterRequestId: number,
    unique: boolean,
  ) => {
    const throughRequestId = ordinal();
    const window = { method, route, status, afterRequestId, throughRequestId, unique };
    const rows = requireNativeConnectionTransport({
      observations: proxy.observations,
      method,
      route,
      status,
      afterRequestId,
      throughRequestId,
      unique,
      targetOrigin: context.apiIdentity.targetOrigin,
    });
    transportWindows.push(window);
    return rows;
  };

  const initialAuth = policy.requireInitialCoachAuth(context, target);
  const normalCoachBefore = await take('normalCoachBefore');
  verifyConnectionSnapshotCheckpoint({
    snapshot: normalCoachBefore,
    checkpoint: 'unlinked',
    expected,
  });
  await context.observe(
    'connection-coach-invite',
    scroll(profile.selectors.coachInviteCode),
    'SCR-pro-home',
    profile.selectors.coachInviteCode,
  );
  const inviteReads = transport('GET', '/professional/invite-codes/fitness_coach', 200, 0, false);
  const inviteCode = policy.requireInviteCode(
    readPrivateHierarchy(output, 'connection-coach-invite'),
  );
  const normalCoachQueueStart = ordinal();
  await context.observe(
    'connection-normal-coach-pending',
    scroll(profile.selectors.coachPendingConnections, 'UP') +
      tap(profile.selectors.coachPendingConnections),
    'SCR-pro-pending',
    profile.selectors.coachPendingScreen,
    'id',
  );
  const normalCoachPendingReads = transport(
    'GET',
    '/connections',
    200,
    normalCoachQueueStart,
    false,
  );
  const normalCoachRosterStart = ordinal();
  await context.observe(
    'connection-normal-coach-roster',
    tap(profile.selectors.coachPendingBack) +
      scroll(profile.selectors.coachRoster) +
      tap(profile.selectors.coachRoster),
    'SCR-pro-roster',
    [
      profile.selectors.coachRosterScreen,
      profile.selectors.coachPendingFilter,
      profile.selectors.coachActiveFilter,
    ],
  );
  const normalCoachRosterReads = transport(
    'GET',
    '/professional/students',
    200,
    normalCoachRosterStart,
    false,
  );
  const normalCoachAfter = await take('normalCoachAfter');
  assert.deepEqual(normalCoachAfter, normalCoachBefore, 'Normal coach read-only entry changed SQL');

  const initialStudent = await context.switchAccount('student');
  const initialRelationshipsStart = ordinal();
  await context.observe(
    'connection-student-entry',
    tap(profile.selectors.studentProfessionalsEntry) +
      '- extendedWaitUntil:\n    visible:\n      id: student.professionals.codeInput\n    timeout: 90000\n- extendedWaitUntil:\n    notVisible:\n      id: student.professionals.loading\n    timeout: 90000\n',
    'SCR-student-professionals',
    [profile.selectors.studentProfessionalsScreen, profile.selectors.studentCodeInput],
  );
  const initialRelationshipReads = transport(
    'GET',
    '/connections',
    200,
    initialRelationshipsStart,
    false,
  );
  const before = await take('before');
  verifyConnectionSnapshotCheckpoint({ snapshot: before, checkpoint: 'unlinked', expected });
  const isolationBefore = await context.isolationSnapshot();
  snapshots.isolationBefore = await persist('isolationBefore', isolationBefore);
  const trainingBefore = (await context.snapshot()).trainingPlans;
  snapshots.trainingBefore = await persist('trainingBefore', trainingBefore);

  const submissionStart = ordinal();
  await context.observe(
    'connection-submit',
    buildNativeConnectionSubmissionActions(profile, inviteCode),
    'STATE-connection-pending',
    profile.selectors.studentProfessionalsScreen,
  );
  const submission = transport(
    'POST',
    '/connections/invite-submissions',
    201,
    submissionStart,
    true,
  );
  const pending = await take('pending');
  verifyConnectionSubmissionSnapshotTransition({ before, pending, fixtures });
  const connectionId = pending.rows.connections.filter(
    (row) =>
      row.professionalAuthUid === target.professionalAuthUid &&
      row.studentAuthUid === target.studentAuthUid &&
      row.specialty === 'fitness_coach',
  )[0]?.id;
  assert(typeof connectionId === 'string' && /^[a-f0-9-]{36}$/.test(connectionId));
  await context.observe(
    'connection-student-pending',
    scroll(`${profile.selectors.pendingStudentCardPrefix}${connectionId}`),
    'STATE-connection-pending',
    `${profile.selectors.pendingStudentCardPrefix}${connectionId}`,
  );
  const pendingStudentMatch = resolvePendingStudentConnectionCard({
    tree: readPrivateHierarchy(output, 'connection-student-pending'),
    snapshot: pending,
    target,
    expectedPendingGuidance: enUS['relationship.pending.helper'],
  });
  const pendingRelationshipReads = transport('GET', '/connections', 200, submissionStart, false);
  assert.deepEqual(await context.connectionSnapshot(), pending, 'Pending view changed SQL');

  const coachSwitch = await context.switchAccount('coach', 'student-professionals-back');
  const pendingAfterCoachAuth = await take('pendingAfterCoachAuth');
  verifyConnectionAuthCheckpoint({
    before: pending,
    after: pendingAfterCoachAuth,
    fixtures,
    actor: 'coach',
    checkpoint: 'pending',
    observations: proxy.observations,
    authIdentities: proxy.nativeAuthIdentities,
    expectedApiIdentity: context.apiIdentity,
    afterRequestId: coachSwitch.beforeRequestId,
    throughRequestId: coachSwitch.afterRequestId,
  });
  const pendingRosterStart = ordinal();
  const pendingRosterId = `pro.students.row.${target.studentAuthUid}`;
  await context.observe(
    'connection-coach-pending-roster',
    scroll(profile.selectors.coachRoster) +
      tap(profile.selectors.coachRoster) +
      tap(profile.selectors.coachPendingFilter) +
      scroll(pendingRosterId),
    'SCR-pro-roster',
    [profile.selectors.coachRosterScreen, pendingRosterId],
  );
  const pendingRosterMatch = policy.resolveRoster(
    readPrivateHierarchy(output, 'connection-coach-pending-roster'),
    target.studentAuthUid,
    'pending',
  );
  const pendingRosterReads = transport(
    'GET',
    '/professional/students',
    200,
    pendingRosterStart,
    false,
  );
  await context.observe(
    'connection-coach-no-active-roster',
    tap(profile.selectors.coachActiveFilter) +
      `- assertNotVisible:\n    id: ${JSON.stringify(pendingRosterId)}\n`,
    'SCR-pro-roster',
    profile.selectors.coachRosterScreen,
  );
  assert(
    !nativeHierarchyHasAttribute(
      readPrivateHierarchy(output, 'connection-coach-no-active-roster'),
      'resource-id',
      pendingRosterId,
    ),
    'Pending target is shown in the active coach roster',
  );
  assert.deepEqual(
    await context.connectionSnapshot(),
    pendingAfterCoachAuth,
    'Pending roster navigation changed SQL',
  );
  await context.observe(
    'connection-coach-return-home',
    tap('tabs.home'),
    'SCR-pro-home',
    profile.selectors.coachHome,
  );
  const coachQueueStart = ordinal();
  await context.observe(
    'connection-coach-pending',
    scroll(profile.selectors.coachPendingConnections, 'UP') +
      tap(profile.selectors.coachPendingConnections) +
      // The pending rows can sit below the hero/search cards; scroll to the
      // exact connection instead of waiting for it to appear in place.
      `- scrollUntilVisible:\n    element:\n      id: ${JSON.stringify(`pro.pending.connection.${connectionId}`)}\n    direction: DOWN\n    timeout: 90000\n`,
    'SCR-pro-pending',
    profile.selectors.coachPendingScreen,
  );
  const coachPendingReads = transport('GET', '/connections', 200, coachQueueStart, false);
  const pendingMatch = resolvePendingConnectionTarget({
    tree: readPrivateHierarchy(output, 'connection-coach-pending'),
    snapshot: pendingAfterCoachAuth,
    target,
  });
  assert.deepEqual(
    await context.connectionSnapshot(),
    pendingAfterCoachAuth,
    'Queue navigation changed SQL',
  );
  const confirmationStart = ordinal();
  await context.observe(
    'connection-confirm',
    tap(pendingMatch.acceptSelector) +
      `- extendedWaitUntil:\n    notVisible:\n      id: ${JSON.stringify(`pro.pending.connection.${connectionId}`)}\n    timeout: 90000\n`,
    'SCR-pro-pending',
    profile.selectors.coachPendingScreen,
    'id',
    { kind: 'accept', snapshot: pendingAfterCoachAuth, target },
  );
  const confirmation = transport(
    'POST',
    `/connections/${connectionId}/confirm`,
    200,
    confirmationStart,
    true,
  );
  const active = await take('active');
  verifyConnectionConfirmationSnapshotTransition({
    pending: pendingAfterCoachAuth,
    active,
    fixtures,
  });
  const rosterStart = ordinal();
  const rosterId = `pro.students.row.${target.studentAuthUid}`;
  await context.observe(
    'connection-coach-roster',
    tap(profile.selectors.coachPendingBack) +
      scroll(profile.selectors.coachRoster) +
      tap(profile.selectors.coachRoster) +
      tap(profile.selectors.coachActiveFilter) +
      scroll(rosterId),
    'SCR-pro-roster',
    [profile.selectors.coachRosterScreen, rosterId],
  );
  const rosterMatch = policy.resolveRoster(
    readPrivateHierarchy(output, 'connection-coach-roster'),
    target.studentAuthUid,
    'active',
  );
  const rosterReads = transport('GET', '/professional/students', 200, rosterStart, false);
  assert.deepEqual(await context.connectionSnapshot(), active, 'Roster navigation changed SQL');
  const studentSwitch = await context.switchAccount('student');
  const activeAfterStudentAuth = await take('activeAfterStudentAuth');
  verifyConnectionAuthCheckpoint({
    before: active,
    after: activeAfterStudentAuth,
    fixtures,
    actor: 'student',
    checkpoint: 'active',
    observations: proxy.observations,
    authIdentities: proxy.nativeAuthIdentities,
    expectedApiIdentity: context.apiIdentity,
    afterRequestId: studentSwitch.beforeRequestId,
    throughRequestId: studentSwitch.afterRequestId,
  });
  const relationshipsStart = ordinal();
  await context.observe(
    'connection-student-active',
    tap(profile.selectors.studentProfessionalsEntry) +
      scroll(`${profile.selectors.activeStudentCardPrefix}${connectionId}`),
    'STATE-connection-active',
    [
      profile.selectors.studentProfessionalsScreen,
      `${profile.selectors.activeStudentCardPrefix}${connectionId}`,
    ],
  );
  const activeMatch = resolveActiveConnectionCard({
    tree: readPrivateHierarchy(output, 'connection-student-active'),
    snapshot: activeAfterStudentAuth,
    target,
  });
  const relationshipReads = transport('GET', '/connections', 200, relationshipsStart, false);
  const final = await take('final');
  assert.deepEqual(final, activeAfterStudentAuth, 'Active student navigation changed SQL');
  const isolationAfter = await context.isolationSnapshot();
  snapshots.isolationAfter = await persist('isolationAfter', isolationAfter);
  assert.deepEqual(
    isolationAfter,
    isolationBefore,
    'Connection journey changed the separate fixture scope',
  );
  const trainingAfter = (await context.snapshot()).trainingPlans;
  snapshots.trainingAfter = await persist('trainingAfter', trainingAfter);
  assert.deepEqual(trainingAfter, trainingBefore, 'Connection journey changed training plans');
  const sealedSnapshots = sealNativeConnectionSnapshotReferences(snapshots);
  const checkpoints = verifyNativeConnectionJourney({
    before,
    pending,
    pendingAfterCoachAuth,
    active,
    activeAfterStudentAuth,
    fixtures,
    observations: proxy.observations,
    authIdentities: proxy.nativeAuthIdentities,
    expectedApiIdentity: context.apiIdentity,
    coachAuth: {
      afterRequestId: coachSwitch.beforeRequestId,
      throughRequestId: coachSwitch.afterRequestId,
    },
    studentAuth: {
      afterRequestId: studentSwitch.beforeRequestId,
      throughRequestId: studentSwitch.afterRequestId,
    },
  });
  context.report.connectionJourneyPreparation = {
    kind: 'private-native-connection-journey-not-public-receipt',
    binding,
    connectionId,
    requirementRefs: ['SC-211', 'UC-002.3', 'AC-214', 'BR-213', 'TC-213', 'TC-214'],
    target,
    fixtureEvidence,
    transportWindows,
    initialAuth,
    initialStudent,
    inviteReads,
    normalCoachPendingReads,
    normalCoachRosterReads,
    pendingStudentMatch,
    pendingRosterMatch,
    pendingRosterReads,
    coachSwitch,
    studentSwitch,
    checkpoints,
    snapshots: sealedSnapshots,
    pendingMatch,
    rosterMatch,
    activeMatch,
    submission,
    confirmation,
    initialRelationshipReads,
    pendingRelationshipReads,
    coachPendingReads,
    rosterReads,
    relationshipReads,
    ...(policy.frameQualification
      ? {
          frameQualification: policy.frameQualification({ pendingRosterMatch, rosterMatch }),
        }
      : {}),
    isolationUnchanged: true,
    trainingPlansUnchanged: true,
    nativePassingCases: 0,
    scope:
      'private UI/owned-transport/projected-SQL preparation; public staging and cleanup remain separate',
  };
}
