import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { before, after } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as vm from 'node:vm';
import * as TypeScript from 'typescript';
import YAML from 'yaml';
import { enUS } from '../../localization/en-US';
import {
  buildIosConnectionAccountSwitchActions,
  buildIosCredentialEntryActions,
  buildIosCredentialEntryDiagnosticAssertionActions,
  buildIosCredentialEntryDiagnosticInputActions,
  buildIosCredentialEntryDiagnosticTapActions,
  buildIosCredentialEntryPasswordContinuationWithOriginalEmailAssertionActions,
  buildIosPasswordOfferDismissalActions,
  observeIosConnectionSignOutWithDiagnostic,
} from '../../scripts/testing/capture-native-testability';
import {
  observeIosCameraDeniedManualSubmit,
  observeIosCameraDenial,
  type IosCameraCommandExecution,
} from '../../scripts/testing/native-camera-observation';
import { buildNativeConnectionSubmissionActions } from '../../scripts/testing/native-connection-journey-core';
import { buildIosConnectionPasswordOfferActions } from '../../scripts/testing/native-connection-password-offer-witness';
import { IOS_CONNECTION_PLATFORM } from '../../scripts/testing/native-connection-platform-contract';
import type { OwnedConnectionSnapshot } from '../../scripts/testing/native-connection-snapshot';
import type { ProxyObservation } from '../../scripts/testing/owned-api-proxy';
import type { OwnedDomainSnapshot } from '../../scripts/testing/owned-session';

// Resolve the producer source from this test's own candidate root. The test
// must never read a differently rooted capture module while exercising the
// candidate imports.
const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const captureSourcePath = path.join(candidateRoot, 'scripts/testing/capture-native-testability.ts');
const captureSource = readFileSync(captureSourcePath, 'utf8');
const captureSourceFile = TypeScript.createSourceFile(
  captureSourcePath,
  captureSource,
  TypeScript.ScriptTarget.Latest,
  true,
);
let PRIVATE_ROOT = '';
before(async () => {
  PRIVATE_ROOT = await realpath(await mkdtemp(path.join(tmpdir(), 'mychampions-camera-parser-')));
});
after(async () => {
  if (PRIVATE_ROOT) await rm(PRIVATE_ROOT, { recursive: true, force: true });
});
const PLACEHOLDER_EMAIL = 'qa@example.invalid';
const PLACEHOLDER_PASSWORD = 'QA-PASS';
const TARGET_ORIGIN = 'http://127.0.0.1:1';
const timestamp = '2026-10-01T00:00:00.000Z';
const runId = 'a'.repeat(24);
const coach = 'auth-coach';
const student = 'auth-student';
const peerStudents = ['auth-peer-student-1', 'auth-peer-student-2'];
const isolationAuthUidMap = new Map([
  [coach, 'auth-isolation-coach'],
  [student, 'auth-isolation-student'],
  ['auth-new', 'auth-isolation-new'],
  ['auth-pending', 'auth-isolation-pending'],
  ['auth-active', 'auth-isolation-active'],
  ['auth-unrelated-coach', 'auth-isolation-unrelated-coach'],
  ['auth-unrelated-student', 'auth-isolation-unrelated-student'],
  [peerStudents[0], 'auth-isolation-peer-student-1'],
  [peerStudents[1], 'auth-isolation-peer-student-2'],
]);
const connectionId = 'connection-target';

function parseMaestroActions(actions: string): unknown[] {
  const document = YAML.parseDocument(actions);
  assert.equal(document.errors.length, 0, document.errors.map((error) => error.message).join('; '));
  const parsed = document.toJS() as unknown;
  assert(Array.isArray(parsed), 'generated action body is not a command list');
  for (const command of parsed) {
    if (typeof command === 'string') {
      assert.equal(
        command,
        'hideKeyboard',
        `unsupported scalar command leaked into Maestro actions: ${command}`,
      );
      continue;
    }
    assert(command && typeof command === 'object' && !Array.isArray(command));
    const entries = Object.entries(command as Record<string, unknown>);
    assert.equal(entries.length, 1, 'Maestro command must have one kind');
    assert.notEqual(entries[0][1], null, 'Maestro command cannot have a null body');
  }
  return parsed;
}

async function writePrivateResult(name: string, value: unknown) {
  await writeFile(path.join(PRIVATE_ROOT, name), JSON.stringify(value, null, 2) + '\n', {
    mode: 0o600,
  });
}

function commandSignature(commands: unknown[]): string[] {
  return commands.map((command) => {
    if (typeof command === 'string') return command;
    assert(command && typeof command === 'object' && !Array.isArray(command));
    const [kind, value] = Object.entries(command as Record<string, unknown>)[0];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const id = (value as Record<string, unknown>).id;
      return typeof id === 'string' ? `${kind}:${id}` : kind;
    }
    return kind.replace(/:$/, '');
  });
}

function assertRecursiveCommandBody(value: unknown, pathLabel: string): void {
  assert.notEqual(value, null, `${pathLabel} has a null nested value`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertRecursiveCommandBody(item, `${pathLabel}[${index}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>))
      assertRecursiveCommandBody(nested, `${pathLabel}.${key}`);
  }
}

function parseFullProductionFlow(
  label: string,
  flow: string,
  expectedName = `Native inventory ${label}`,
): {
  header: Record<string, unknown>;
  commands: unknown[];
} {
  const documents = YAML.parseAllDocuments(flow);
  assert.equal(documents.length, 2, `${label} must contain config and commands documents`);
  for (const [index, document] of documents.entries())
    assert.equal(document.errors.length, 0, `${label} document ${index} has YAML errors`);
  const header = documents[0].toJS() as unknown;
  assert(header && typeof header === 'object' && !Array.isArray(header));
  const headerRecord = header as Record<string, unknown>;
  assert.deepEqual(Object.keys(headerRecord).sort(), ['appId', 'name']);
  assert.equal(headerRecord.appId, 'com.edufelip.mychampions.dev');
  assert.equal(headerRecord.name, expectedName);
  const parsed = documents[1].toJS() as unknown;
  assert(Array.isArray(parsed), `${label} commands document is not a list`);
  assert(parsed.length > 0, `${label} commands document is empty`);
  for (const [index, command] of parsed.entries()) {
    if (typeof command === 'string') {
      assert.equal(command, 'hideKeyboard', `${label} leaked scalar command ${command}`);
      continue;
    }
    assert(command && typeof command === 'object' && !Array.isArray(command));
    const entries = Object.entries(command as Record<string, unknown>);
    assert.equal(entries.length, 1, `${label} command ${index} has multiple kinds`);
    assert.notEqual(entries[0][1], null, `${label} command ${index} has a null body`);
    assertRecursiveCommandBody(entries[0][1], `${label}[${index}]`);
  }
  return { header: headerRecord, commands: parsed };
}

function currentSerializerExpression(variableName: string): string {
  const matches: string[] = [];
  const walk = (node: TypeScript.Node): void => {
    if (
      TypeScript.isVariableDeclaration(node) &&
      node.name.getText(captureSourceFile) === variableName &&
      node.initializer
    ) {
      const findWriteFile = (nested: TypeScript.Node): void => {
        if (
          TypeScript.isCallExpression(nested) &&
          nested.expression.getText(captureSourceFile) === 'writeFile' &&
          nested.arguments[1]?.getText(captureSourceFile).includes('appId:')
        )
          matches.push(nested.arguments[1].getText(captureSourceFile));
        TypeScript.forEachChild(nested, findWriteFile);
      };
      findWriteFile(node.initializer);
    }
    TypeScript.forEachChild(node, walk);
  };
  walk(captureSourceFile);
  assert.equal(matches.length, 1, `expected one ${variableName} serializer expression`);
  return matches[0];
}

function renderCurrentSerializer(variableName: string, values: Record<string, unknown>): string {
  const expression = TypeScript.transpileModule(`(${currentSerializerExpression(variableName)})`, {
    compilerOptions: { target: TypeScript.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(expression, { ...values, JSON }, { timeout: 1000 }) as string;
}

function currentWriteFileExpression(fragment: string): string {
  const matches: string[] = [];
  const walk = (node: TypeScript.Node): void => {
    if (
      TypeScript.isCallExpression(node) &&
      node.expression.getText(captureSourceFile) === 'writeFile' &&
      node.arguments[1]?.getText(captureSourceFile).includes(fragment)
    )
      matches.push(node.arguments[1].getText(captureSourceFile));
    TypeScript.forEachChild(node, walk);
  };
  walk(captureSourceFile);
  assert.equal(matches.length, 1, `expected one serializer containing ${fragment}`);
  return matches[0];
}

function renderCurrentWriteFileExpression(
  fragment: string,
  values: Record<string, unknown>,
): string {
  const expression = TypeScript.transpileModule(`(${currentWriteFileExpression(fragment)})`, {
    compilerOptions: { target: TypeScript.ScriptTarget.ES2022 },
  }).outputText;
  return vm.runInNewContext(expression, { ...values, JSON }, { timeout: 1000 }) as string;
}

function renderCurrentCredentialStage(stage: string, actions: string): string {
  return renderCurrentWriteFileExpression('stage.actions', {
    bundleId: 'com.edufelip.mychampions.dev',
    stage: { name: stage, actions },
  });
}

function renderCurrentEntryReadiness(): string {
  return renderCurrentWriteFileExpression('Native entry readiness observation', {
    bundleId: 'com.edufelip.mychampions.dev',
  });
}

function renderCurrentEmailAssertion(expectedEmail: string): string {
  return renderCurrentWriteFileExpression('Owned credential exact email assertion', {
    bundleId: 'com.edufelip.mychampions.dev',
    expectedEmail,
    buildIosCredentialEntryDiagnosticAssertionActions,
  });
}

function renderCurrentObservePostTapFlow(label: string, actions: string): string {
  return renderCurrentSerializer('observePostTapDiagnostic', {
    bundleId: 'com.edufelip.mychampions.dev',
    label,
    actions,
  });
}

function renderCurrentConnectionFlow(
  label: string,
  credentialActions: string,
  homeSelector: string,
): string {
  return renderCurrentSerializer('observeConnectionPasswordOffer', {
    bundleId: 'com.edufelip.mychampions.dev',
    label,
    credentialActions,
    promptScreenshotName: `${label}-password-offer`,
    homeSelector,
    buildIosConnectionPasswordOfferActions,
  });
}

function renderCurrentObserveFlow(
  label: string,
  actions: string,
  selectorKind: 'id' | 'text',
  selectors: string | string[],
  notVisibleSelectors: readonly string[] = [],
): string {
  const selectorList = typeof selectors === 'string' ? [selectors] : selectors;
  return renderCurrentSerializer('observe', {
    bundleId: 'com.edufelip.mychampions.dev',
    label,
    actions,
    selectorKind,
    primary: selectorList[0],
    selectors: selectorList,
    notVisibleSelectors,
  });
}

function node(attributes: Record<string, unknown>, children: unknown[] = [], enabled = true) {
  return { attributes, children, enabled };
}

function baseRows(): OwnedConnectionSnapshot['rows'] {
  return {
    userProfiles: [
      {
        authUid: coach,
        lockedRole: 'professional' as const,
        acceptedTermsVersion: 'v1',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        authUid: student,
        lockedRole: 'student' as const,
        acceptedTermsVersion: 'v1',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      ...peerStudents.map((authUid) => ({
        authUid,
        lockedRole: 'student' as const,
        acceptedTermsVersion: 'v1',
        createdAt: timestamp,
        updatedAt: timestamp,
      })),
    ].sort((left, right) => left.authUid.localeCompare(right.authUid)),
    professionalSpecialties: [
      {
        id: 'coach-fitness',
        professionalAuthUid: coach,
        specialty: 'fitness_coach' as const,
        isActive: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    inviteCodes: [
      {
        id: 'invite-fitness',
        professionalAuthUid: coach,
        specialty: 'fitness_coach' as const,
        status: 'active' as const,
        createdAt: timestamp,
        updatedAt: timestamp,
        rotatedAt: null,
      },
    ],
    connections: structuredClone(baselineConnections),
    connectionInviteGuards: [],
    pendingStudents: [],
    pendingStudentSlots: [
      {
        id: 'coach_slot-target',
        professionalAuthUid: coach,
        slotId: 'slot-target',
        studentAuthUid: null,
        updatedAt: timestamp,
      },
    ],
    trackingAccess: [],
    activeSpecialties: [],
  };
}

const pendingConnection = {
  id: connectionId,
  professionalAuthUid: coach,
  studentAuthUid: student,
  status: 'pending_confirmation' as const,
  specialty: 'fitness_coach' as const,
  canceledReason: null,
  sourceInviteCodeId: 'invite-fitness',
  createdAt: timestamp,
  updatedAt: timestamp,
  endedAt: null,
};
const baselineConnections = peerStudents.map((studentAuthUid, index) => ({
  ...pendingConnection,
  id: `preserved-connection-${index + 1}`,
  studentAuthUid,
  status: 'ended' as const,
  endedAt: timestamp,
}));
const pendingGuard = {
  id: 'guard-target',
  connectionId,
  professionalAuthUid: coach,
  studentAuthUid: student,
  specialty: 'fitness_coach' as const,
  status: 'pending_confirmation' as const,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const pendingStudent = {
  id: 'pending-target',
  professionalAuthUid: coach,
  studentAuthUid: student,
  slotId: 'slot-target',
  nutritionistConnectionId: null,
  fitnessCoachConnectionId: connectionId,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const pendingSlot = {
  id: 'coach_slot-target',
  professionalAuthUid: coach,
  slotId: 'slot-target',
  studentAuthUid: student,
  updatedAt: timestamp,
};

function connectionSnapshot(pending = false) {
  const rows = baseRows();
  if (pending) {
    rows.connections.push(pendingConnection);
    rows.connectionInviteGuards = [pendingGuard];
    rows.pendingStudents = [pendingStudent];
    rows.pendingStudentSlots = [pendingSlot];
  }
  rows.connections.sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    kind: 'connection-snapshot-v1' as const,
    runId,
    scope: 'native-entry-ios',
    readOnly: true as const,
    fixtureAuthUids: [coach, student, ...peerStudents].sort(),
    target: {
      professionalAuthUid: coach,
      studentAuthUid: student,
      specialty: 'fitness_coach' as const,
    },
    rowCounts: Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, value.length])),
    rows,
  };
}

const fixtures = {
  runId,
  scope: 'native-entry-ios',
  accounts: {
    ...Object.fromEntries(
      peerStudents.map((authUid, index) => [
        `peerStudent${index + 1}`,
        {
          email: `peer${index + 1}@example.invalid`,
          password: PLACEHOLDER_PASSWORD,
          authUid,
          role: 'student',
        },
      ]),
    ),
    coach: {
      email: PLACEHOLDER_EMAIL,
      password: PLACEHOLDER_PASSWORD,
      authUid: coach,
      role: 'professional',
    },
    student: {
      email: 'student@example.invalid',
      password: 'STUDENT-PASS',
      authUid: student,
      role: 'student',
    },
  },
  pendingConnectionId: connectionId,
  activeConnectionId: 'active-connection',
  savedPlanId: 'plan-placeholder',
  draft: { name: 'Placeholder draft', sessions: [] },
};

function isolationFixturesFor<T extends typeof fixtures>(primary: T) {
  return {
    ...primary,
    scope: 'native-connection-isolation-ios',
    accounts: Object.fromEntries(
      Object.entries(primary.accounts).map(([name, account]) => [
        name,
        {
          ...account,
          email: `isolation-${account.email}`,
          authUid: isolationAuthUidMap.get(account.authUid) ?? `isolation-${account.authUid}`,
        },
      ]),
    ),
  };
}

async function writePrivate(root: string, relative: string, content: string | Buffer) {
  await writeFile(path.join(root, relative), content, { flag: 'wx', mode: 0o600 });
}

async function runCameraDenialPreflight(
  flows: Map<string, string>,
  fullFlows?: Map<string, string>,
) {
  const output = await mkdtemp(path.join(PRIVATE_ROOT, 'denial-'));
  await mkdir(output, { recursive: true, mode: 0o700 });
  const prompt = node({}, [
    node({ accessibilityText: 'Allow' }),
    node({ accessibilityText: "Don't Allow" }),
    node({ accessibilityText: '"Placeholder App" would like to access the Camera.' }),
  ]);
  const guidance = node({ accessibilityText: enUS['relationship.qr.permission_denied'] });
  const manual = node({ text: 'QA-MANUAL-ONLY' });
  for (const [label, tree] of [
    ['camera-relationships', node({})],
    ['camera-prompt', prompt],
    ['camera-guidance', guidance],
    ['camera-manual', manual],
  ] as const) {
    await writePrivate(output, `${label}-hierarchy.json`, JSON.stringify(tree));
    await writePrivate(output, `${label}.png`, Buffer.from('placeholder-png'));
  }
  const before = { runId, scope: 'native-entry-ios', connections: [] };
  const observation = (requestId: number, method: string, route: string, status: number) => ({
    requestId,
    method,
    pathHash: createHash('sha256').update(route).digest('hex'),
    status,
    outcome: 'forwarded' as const,
    requestProfile: 'native' as const,
    requestOrigin: null,
    targetOrigin: TARGET_ORIGIN,
    faultAttemptId: null,
    elapsedMs: 0,
  });
  const observations = [
    observation(1, 'POST', '/analytics/events', 202),
    observation(2, 'POST', '/analytics/events', 202),
    observation(3, 'POST', '/auth/email/sign-in', 201),
  ];
  const seen: string[] = [];
  let denialDrainCompleted = false;
  const report: Record<string, unknown> = {
    cameraInitialAuth: {
      actor: 'student',
      actorAuthUid: student,
      beforeRequestId: 0,
      authRequestId: 3,
      afterRequestId: 3,
    },
  };
  await observeIosCameraDenial({
    output,
    report,
    studentAuthUid: student,
    displayName: 'Placeholder App',
    permission: () =>
      Promise.resolve({
        source: 'owned-simulator-tcc-read-only' as const,
        deviceUdid: 'device',
        bundleId: 'com.edufelip.mychampions.dev',
        rows:
          seen.length === 0
            ? []
            : [
                {
                  service: 'kTCCServiceCamera',
                  client: 'com.edufelip.mychampions.dev',
                  client_type: 0,
                  auth_value: 0,
                  auth_reason: 1,
                },
              ],
      }),
    snapshot: () => Promise.resolve(structuredClone(before) as never),
    observations: () => observations as never,
    ...{
      preludeRequestIdFence: 3,
      preludeObservationCount: 3,
      preludeObservationPrefixSha256: createHash('sha256')
        .update(JSON.stringify(observations))
        .digest('hex'),
      cameraInitialAuthAfterRequestId: 3,
      waitForQuiescence: (deadlineMs: number) => {
        assert.equal(deadlineMs, 5_000);
        assert.deepEqual(seen, [
          'camera-relationships',
          'camera-prompt',
          'camera-guidance',
          'camera-manual',
        ]);
        denialDrainCompleted = true;
        return Promise.resolve();
      },
      requestIdFence: () => {
        assert.equal(denialDrainCompleted, true);
        return Math.max(...observations.map((row) => row.requestId));
      },
    },
    observe: (label, actions, _viewId, selectors, selectorKind = 'id') => {
      if (label === 'camera-relationships')
        observations.push(observation(4, 'GET', '/connections', 200));
      seen.push(label);
      flows.set(label, actions);
      fullFlows?.set(label, renderCurrentObserveFlow(label, actions, selectorKind, selectors));
      return Promise.resolve();
    },
  });
  assert.deepEqual(seen, [
    'camera-relationships',
    'camera-prompt',
    'camera-guidance',
    'camera-manual',
  ]);
  const preparation = report.cameraPreparation as {
    transportStartRequestId: number;
    transportEndRequestId: number;
    transportRequestIds: number[];
    transportPreludeRequestIdFence: number;
    transportPreludeObservationCount: number;
    transportPreludeObservationPrefixSha256: string;
    transportPreludeMarkerSource: string;
    transportEndObservationCount: number;
    transportEndObservationPrefixSha256: string;
    transportEndMarkerSource: string;
  };
  assert.equal(preparation.transportPreludeRequestIdFence, 3);
  assert.equal(preparation.transportPreludeObservationCount, 3);
  assert.equal(
    preparation.transportPreludeMarkerSource,
    'owned-api-proxy.requestIdFence+observations',
  );
  assert.equal(
    preparation.transportPreludeObservationPrefixSha256,
    createHash('sha256')
      .update(JSON.stringify(observations.slice(0, 3)))
      .digest('hex'),
  );
  assert.equal(denialDrainCompleted, true);
  assert.equal(preparation.transportEndObservationCount, 4);
  assert.equal(
    preparation.transportEndObservationPrefixSha256,
    createHash('sha256').update(JSON.stringify(observations)).digest('hex'),
  );
  assert.equal(
    preparation.transportEndMarkerSource,
    'owned-api-proxy.waitForQuiescence+requestIdFence+observations',
  );
  assert.equal(preparation.transportStartRequestId, 4);
  assert.equal(preparation.transportEndRequestId, 4);
  assert.deepEqual(preparation.transportRequestIds, [4]);
  assert.deepEqual(
    observations.map((row) => row.requestId),
    [1, 2, 3, 4],
  );
}

async function runCameraManualSubmitPreflight(
  flows: Map<string, string>,
  fullFlows?: Map<string, string>,
  mutateDomainAfter?: (snapshot: OwnedDomainSnapshot) => void,
  observeOutput?: (output: string) => void,
) {
  const output = await mkdtemp(path.join(PRIVATE_ROOT, 'manual-'));
  await mkdir(output, { recursive: true, mode: 0o700 });
  observeOutput?.(output);
  const isolationFixtures = isolationFixturesFor(fixtures);
  const commandExecutions: IosCameraCommandExecution[] = [];
  const observations: ProxyObservation[] = [
    {
      method: 'GET',
      pathHash: createHash('sha256').update('/connections').digest('hex'),
      status: 200,
      outcome: 'forwarded',
      requestProfile: 'native',
      requestOrigin: null,
      targetOrigin: TARGET_ORIGIN,
      faultAttemptId: null,
      requestId: 1,
      elapsedMs: 0,
    },
  ];
  let submitted = false;
  let switchOrdinal = 0;
  const report: Record<string, unknown> = { fixtureHash: 'placeholder-fixture-hash' };
  const isolationFixtureBytes = Buffer.from(JSON.stringify(isolationFixtures));
  await writePrivate(
    output,
    'fixtures-native-connection-isolation-ios.private.json',
    isolationFixtureBytes,
  );
  report.connectionIsolationFixtureEvidence = {
    path: 'fixtures-native-connection-isolation-ios.private.json',
    bytes: isolationFixtureBytes.length,
    sha256: createHash('sha256').update(isolationFixtureBytes).digest('hex'),
    source: 'owned-session.fixtures',
    runId,
    scope: 'native-connection-isolation-ios',
  };
  const flowsSeen: string[] = [];
  const observe = async (
    label: string,
    actions: string,
    _viewId?: string,
    selectors?: string | string[],
    selectorKind: 'id' | 'text' = 'id',
  ) => {
    flowsSeen.push(label);
    flows.set(label, actions);
    if (fullFlows && selectors !== undefined)
      fullFlows.set(label, renderCurrentObserveFlow(label, actions, selectorKind, selectors));
    if (label === 'camera-coach-invite') {
      await writePrivate(
        output,
        'camera-coach-invite-hierarchy.json',
        JSON.stringify(
          node({ enabled: false, bounds: '[0,0][0,0]' }, [
            node(
              {
                'resource-id': 'pro.home.screen',
                enabled: true,
                bounds: '[0,0][402,791]',
              },
              [
                node({
                  'resource-id': 'pro.home.inviteCodeValue',
                  accessibilityText: 'ABCDEF12',
                  enabled: true,
                  bounds: '[36,541][366,575]',
                }),
              ],
            ),
          ]),
        ),
      );
      await writePrivate(output, 'camera-coach-invite.png', Buffer.from('placeholder-png'));
      await writePrivate(
        output,
        'camera-coach-invite.yaml',
        `appId: com.edufelip.mychampions.dev\nname: Native inventory camera-coach-invite\n---\n${actions}\n- extendedWaitUntil:\n    visible:\n      id: pro.home.screen\n    timeout: 90000\n`,
      );
      commandExecutions.push({
        label: 'camera-coach-invite',
        command: 'maestro',
        argv: [
          '--no-ansi',
          '--udid',
          'owned',
          'test',
          '--debug-output',
          path.join(output, 'camera-coach-invite-debug'),
          '--test-output-dir',
          path.join(output, 'camera-coach-invite-artifacts'),
          path.join(output, 'camera-coach-invite.yaml'),
        ],
        phase: 'step',
        execution: 'completed',
        cleanup: 'cleaned',
        childExitCode: 0,
        childSignal: null,
        deadlineMs: 30000,
        logPath: path.join(output, 'camera-coach-invite.log'),
        ownershipPath: path.join(output, 'camera-coach-invite.owner.json'),
      });
    }
    if (label === 'camera-live-manual-submit') {
      await writePrivate(
        output,
        'camera-live-manual-submit.yaml',
        `appId: com.edufelip.mychampions.dev\nname: camera live manual submit\n---\n${actions}\n`,
      );
      await writePrivate(
        output,
        'camera-live-manual-submit-hierarchy.json',
        JSON.stringify(node({ 'resource-id': 'student.professionals.screen' })),
      );
      await writePrivate(output, 'camera-live-manual-submit.png', Buffer.from('placeholder-png'));
      observations.push({
        method: 'POST',
        pathHash: createHash('sha256').update('/connections/invite-submissions').digest('hex'),
        status: 201,
        outcome: 'forwarded',
        requestProfile: 'native',
        requestOrigin: null,
        targetOrigin: TARGET_ORIGIN,
        faultAttemptId: null,
        requestId: 2,
        elapsedMs: 0,
      });
      submitted = true;
    }
    if (label === 'camera-pending') {
      const marker = node({
        'resource-id': `student.professionals.connectionPending.${connectionId}`,
        accessibilityText: enUS['relationship.pending.helper'],
      });
      await writePrivate(
        output,
        'camera-pending-hierarchy.json',
        JSON.stringify(
          node({ 'resource-id': 'student.professionals.screen' }, [
            node({ 'resource-id': 'student.professionals.connectionCard.0' }, [marker]),
          ]),
        ),
      );
      await writePrivate(output, 'camera-pending.png', Buffer.from('placeholder-png'));
    }
  };
  const signOutInitialActions =
    '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutCta';
  const signOutConfirmationActions =
    '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutConfirmCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutConfirmCta';
  const switchAccount = async (actor: 'coach' | 'student', backActions = '') => {
    const ordinal = ++switchOrdinal;
    const label = `connection-switch-${ordinal}-${actor}`;
    await observe(
      `${label}-account`,
      buildIosConnectionAccountSwitchActions(
        backActions || (actor === 'coach' ? 'student-professionals-back' : ''),
      ),
      'SCR-account',
      'settings.account.screen',
    );
    await observeIosConnectionSignOutWithDiagnostic({
      label,
      initialActions: signOutInitialActions,
      confirmationActions: signOutConfirmationActions,
      report,
      observe: async (nextLabel, actions, viewId, selectors, selectorKind) =>
        observe(nextLabel, actions, viewId, selectors, selectorKind),
      observePostTapDiagnostic: async (nextLabel, actions) => {
        await observe(nextLabel, actions);
        fullFlows?.set(nextLabel, renderCurrentObservePostTapFlow(nextLabel, actions));
        return Promise.resolve({ status: 'observed' });
      },
    });
    await observe(
      `${label}-home`,
      buildIosCredentialEntryActions(
        fixtures.accounts[actor].email,
        fixtures.accounts[actor].password,
      ),
      'SCR-home',
    );
    return {
      actor,
      actorAuthUid: fixtures.accounts[actor].authUid,
      beforeRequestId: 1,
      authRequestId: 2 + ordinal,
      afterRequestId: 2 + ordinal,
    };
  };
  await observeIosCameraDeniedManualSubmit({
    output,
    report,
    fixtures: fixtures as never,
    connectionIsolationFixtures: isolationFixtures as never,
    commandExecutions,
    proxy: { observations },
    apiIdentity: { apiPid: 123, targetOrigin: TARGET_ORIGIN },
    snapshot: () => {
      const domain: OwnedDomainSnapshot = {
        schemaVersion: 1,
        runId,
        scope: 'native-entry-ios',
        readOnly: true,
        trainingPlans: [
          {
            id: 'preserved-training-plan',
            studentAuthUid: student,
            ownerProfessionalUid: null,
            sourceKind: 'self_managed',
            name: 'Preserved training',
            isArchived: false,
            isDraft: false,
            lifecycleConnectionId: null,
            createdAt: timestamp,
            updatedAt: timestamp,
            sessions: [{ id: 'preserved-session', items: [] }],
          },
        ],
        connections: connectionSnapshot(submitted).rows.connections.map((row) => ({
          ...row,
          sourceInviteCodeValue: 'ABCDEF12',
        })),
      };
      if (submitted) mutateDomainAfter?.(domain);
      return Promise.resolve(domain);
    },
    connectionSnapshot: () =>
      Promise.resolve((submitted ? connectionSnapshot(true) : connectionSnapshot(false)) as never),
    isolationSnapshot: () =>
      Promise.resolve({
        ...connectionSnapshot(false),
        scope: 'native-connection-isolation-ios',
      } as never),
    observe,
    switchAccount,
    signal: new AbortController().signal,
  });
  assert.deepEqual(flowsSeen, [
    'connection-switch-1-coach-account',
    'connection-switch-1-coach-signout-post-tap',
    'connection-switch-1-coach-signed-out',
    'connection-switch-1-coach-home',
    'camera-coach-invite',
    'connection-switch-2-student-account',
    'connection-switch-2-student-signout-post-tap',
    'connection-switch-2-student-signed-out',
    'connection-switch-2-student-home',
    'camera-student-entry',
    'camera-live-manual-submit',
    'camera-pending',
  ]);
}

void test('semantic and legacy account navigation lower to parser-safe command lists', () => {
  assert.deepEqual(
    parseMaestroActions(buildIosConnectionAccountSwitchActions('student-professionals-back')),
    [
      'hideKeyboard',
      { tapOn: { id: 'student.professionals.backButton' } },
      { extendedWaitUntil: { visible: { id: 'student.home.screen' }, timeout: 90000 } },
      { tapOn: { id: 'tabs.account' } },
    ],
  );
  assert.deepEqual(parseMaestroActions(buildIosConnectionAccountSwitchActions('none')), [
    { tapOn: { id: 'tabs.account' } },
  ]);
  assert.deepEqual(
    parseMaestroActions(
      buildIosConnectionAccountSwitchActions('- tapOn:\n    id: student.professionals.backButton'),
    ),
    [{ tapOn: { id: 'student.professionals.backButton' } }, { tapOn: { id: 'tabs.account' } }],
  );
  assert.throws(() => buildIosConnectionAccountSwitchActions('unsupported-navigation'), /Invalid/);
  assert.throws(() => buildIosConnectionAccountSwitchActions('- launchApp: anything'), /Invalid/);
  assert.throws(() => parseMaestroActions('- student-professionals-back'), /unsupported scalar/);
  assert.throws(() => parseMaestroActions('- extendedWaitUntil:'), /null body/);
});

void test('actual credential, diagnostic, post-login, and submission helpers all parse', async () => {
  const flows: Record<string, string> = {
    'entry-readiness':
      '- extendedWaitUntil:\n    visible:\n      id: auth.signIn.emailInput\n    timeout: 90000\n- assertVisible:\n    id: auth.signIn.passwordInput\n- assertVisible:\n    id: auth.signIn.submitButton',
    'email-after-tap': buildIosCredentialEntryDiagnosticTapActions(),
    'email-after-input': buildIosCredentialEntryDiagnosticInputActions(PLACEHOLDER_EMAIL),
    'email-after-input-assertion':
      buildIosCredentialEntryDiagnosticAssertionActions(PLACEHOLDER_EMAIL),
    'credential-diagnostic-home':
      buildIosCredentialEntryPasswordContinuationWithOriginalEmailAssertionActions(
        PLACEHOLDER_PASSWORD,
        PLACEHOLDER_EMAIL,
      ),
    'credential-entry': buildIosCredentialEntryActions(PLACEHOLDER_EMAIL, PLACEHOLDER_PASSWORD),
    'password-offer-dismissal': buildIosPasswordOfferDismissalActions(),
    'camera-live-manual-submit': buildNativeConnectionSubmissionActions(
      IOS_CONNECTION_PLATFORM,
      'TEST-CODE',
    ),
  };
  const signatures = Object.fromEntries(
    Object.entries(flows).map(([label, actions]) => [
      label,
      commandSignature(parseMaestroActions(actions)),
    ]),
  );
  assert.equal(signatures['email-after-tap'][0], 'tapOn:auth.signIn.emailInput');
  assert.equal(signatures['camera-live-manual-submit'].length, 6);
  assert.equal(signatures['credential-diagnostic-home'][0], 'hideKeyboard');
  assert.equal(signatures['password-offer-dismissal'][0], 'extendedWaitUntil');
  await writePrivateResult('conditional-flow-matrix.private.json', {
    branch: 'shared-builder-conditionals',
    checked: Object.entries(signatures).map(([id, actions]) => ({ id, actions })),
    count: Object.keys(signatures).length,
  });
});

void test('actual production wrappers render complete two-document Maestro flows', async () => {
  const originalFlowPath = path.resolve(
    __dirname,
    '../fixtures/native-camera/malformed-account-switch.yaml',
  );
  const originalFlow = await readFile(originalFlowPath, 'utf8');
  const originalActions = 'student-professionals-back\n- tapOn:\n    id: tabs.account';
  const renderedOriginal = renderCurrentObserveFlow(
    'connection-switch-1-coach-account',
    originalActions,
    'id',
    'settings.account.screen',
  );
  assert.equal(renderedOriginal, originalFlow);
  const repairedFlow = renderCurrentObserveFlow(
    'connection-switch-1-coach-account',
    buildIosConnectionAccountSwitchActions('student-professionals-back'),
    'id',
    'settings.account.screen',
  );
  const repairedParsed = parseFullProductionFlow('connection-switch-1-coach-account', repairedFlow);
  assert.equal(repairedParsed.commands.length, 5);
  await writeFile(
    path.join(PRIVATE_ROOT, 'repaired-connection-switch-1-coach-account.yaml'),
    repairedFlow,
    { mode: 0o600 },
  );
  await writePrivateResult('serializer-expression-control.private.json', {
    sourcePath: captureSourcePath,
    sourceSha256: createHash('sha256').update(captureSource).digest('hex'),
    serializerExpressions: {
      observe: createHash('sha256').update(currentSerializerExpression('observe')).digest('hex'),
      observePostTapDiagnostic: createHash('sha256')
        .update(currentSerializerExpression('observePostTapDiagnostic'))
        .digest('hex'),
      observeConnectionPasswordOffer: createHash('sha256')
        .update(currentSerializerExpression('observeConnectionPasswordOffer'))
        .digest('hex'),
      credentialStage: createHash('sha256')
        .update(currentWriteFileExpression('stage.actions'))
        .digest('hex'),
      entryReadiness: createHash('sha256')
        .update(currentWriteFileExpression('Native entry readiness observation'))
        .digest('hex'),
      emailAssertion: createHash('sha256')
        .update(currentWriteFileExpression('Owned credential exact email assertion'))
        .digest('hex'),
    },
    originalFlowPath,
    originalFlowSha256: createHash('sha256').update(originalFlow).digest('hex'),
    originalByteEquivalent: renderedOriginal === originalFlow,
    repairedDocuments: 2,
    repairedCommandCount: repairedParsed.commands.length,
    resourcesAcquired: false,
  });

  const homeFlows = [
    {
      label: 'connection-switch-1-coach-home',
      credentialActions: buildIosCredentialEntryActions(
        fixtures.accounts.coach.email,
        fixtures.accounts.coach.password,
      ),
      promptScreenshotName: 'connection-switch-1-coach-home-password-offer',
      homeSelector: 'pro.home.screen',
    },
    {
      label: 'connection-switch-2-student-home',
      credentialActions: buildIosCredentialEntryActions(
        fixtures.accounts.student.email,
        fixtures.accounts.student.password,
      ),
      promptScreenshotName: 'connection-switch-2-student-home-password-offer',
      homeSelector: 'student.home.screen',
    },
    {
      label: 'credential-diagnostic-home',
      credentialActions:
        buildIosCredentialEntryPasswordContinuationWithOriginalEmailAssertionActions(
          fixtures.accounts.student.password,
          fixtures.accounts.student.email,
        ),
      promptScreenshotName: 'credential-diagnostic-home-password-offer',
      homeSelector: 'student.home.screen',
    },
  ] as const;
  const fullFlowRows = homeFlows.map((input) => {
    const actions = buildIosConnectionPasswordOfferActions(
      input.credentialActions,
      input.promptScreenshotName,
      input.homeSelector,
    );
    const flow = renderCurrentConnectionFlow(
      input.label,
      input.credentialActions,
      input.homeSelector,
    );
    const parsed = parseFullProductionFlow(input.label, flow, `Native connection ${input.label}`);
    assert.deepEqual(parsed.commands, parseMaestroActions(actions));
    const signatures = commandSignature(parsed.commands);
    assert(signatures.includes('takeScreenshot'));
    assert(
      parsed.commands.some(
        (command) =>
          command &&
          typeof command === 'object' &&
          !Array.isArray(command) &&
          (command as Record<string, unknown>).takeScreenshot === input.promptScreenshotName,
      ),
    );
    assert.equal(signatures.at(-1), `extendedWaitUntil`);
    return {
      label: input.label,
      documentCount: 2,
      commandCount: parsed.commands.length,
      signatures,
      headerName: parsed.header.name,
    };
  });

  const signOutInitialActions =
    '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutCta';
  const signOutConfirmationActions =
    '- scrollUntilVisible:\n    element:\n      id: settings.account.signOutConfirmCta\n    direction: DOWN\n    timeout: 30000\n- tapOn:\n    id: settings.account.signOutConfirmCta';
  const signOutRows: Record<string, unknown>[] = [];
  for (const label of ['connection-switch-1-coach', 'connection-switch-2-student']) {
    await observeIosConnectionSignOutWithDiagnostic({
      label,
      initialActions: signOutInitialActions,
      confirmationActions: signOutConfirmationActions,
      report: {},
      observe: (nextLabel, actions) => {
        const flow = renderCurrentObserveFlow(nextLabel, actions, 'id', 'auth.signIn.emailInput');
        const parsed = parseFullProductionFlow(nextLabel, flow);
        const signatures = commandSignature(parsed.commands);
        assert.equal(signatures.at(-1), 'extendedWaitUntil');
        assert.match(flow, /timeout: 90000/);
        signOutRows.push({
          label: nextLabel,
          kind: 'signed-out',
          documentCount: 2,
          commandCount: parsed.commands.length,
          signatures,
          headerName: parsed.header.name,
        });
        return Promise.resolve();
      },
      observePostTapDiagnostic: (nextLabel, actions) => {
        const flow = renderCurrentObservePostTapFlow(nextLabel, actions);
        const parsed = parseFullProductionFlow(nextLabel, flow);
        const signatures = commandSignature(parsed.commands);
        assert.equal(
          signatures.some((signature) => signature === 'extendedWaitUntil'),
          false,
        );
        signOutRows.push({
          label: nextLabel,
          kind: 'signout-post-tap',
          documentCount: 2,
          commandCount: parsed.commands.length,
          signatures,
          headerName: parsed.header.name,
        });
        return Promise.resolve({ status: 'observed' });
      },
    });
  }
  assert.deepEqual(
    signOutRows.map((row) => row.label),
    [
      'connection-switch-1-coach-signout-post-tap',
      'connection-switch-1-coach-signed-out',
      'connection-switch-2-student-signout-post-tap',
      'connection-switch-2-student-signed-out',
    ],
  );
  await writePrivateResult('full-production-flow-matrix.private.json', {
    branch: 'actual-connection-password-offer-and-signout-wrappers',
    homeFlows: fullFlowRows,
    signOutFlows: signOutRows,
    completeTwoDocumentFlowCount: fullFlowRows.length + signOutRows.length,
    postTapHasNoSyntheticWait: true,
    signedOutWaitTimeoutMs: 90000,
  });
});

void test('actual camera denial and manual-submit callbacks render every reachable callback label', async () => {
  const flows = new Map<string, string>();
  const fullFlows = new Map<string, string>();
  await runCameraDenialPreflight(flows, fullFlows);
  await runCameraManualSubmitPreflight(flows, fullFlows);
  const expected = [
    'camera-relationships',
    'camera-prompt',
    'camera-guidance',
    'camera-manual',
    'connection-switch-1-coach-account',
    'connection-switch-1-coach-signout-post-tap',
    'connection-switch-1-coach-signed-out',
    'connection-switch-1-coach-home',
    'camera-coach-invite',
    'connection-switch-2-student-account',
    'connection-switch-2-student-signout-post-tap',
    'connection-switch-2-student-signed-out',
    'connection-switch-2-student-home',
    'camera-student-entry',
    'camera-live-manual-submit',
    'camera-pending',
  ];
  assert.deepEqual([...flows.keys()], expected);
  const checked = [...flows].map(([id, actions]) => ({
    id,
    actions: commandSignature(parseMaestroActions(actions)),
  }));
  for (const row of checked) assert(row.actions.length > 0, `${row.id} emitted no commands`);

  fullFlows.set(
    'connection-switch-1-coach-home',
    renderCurrentConnectionFlow(
      'connection-switch-1-coach-home',
      buildIosCredentialEntryActions(
        fixtures.accounts.coach.email,
        fixtures.accounts.coach.password,
      ),
      'pro.home.screen',
    ),
  );
  fullFlows.set(
    'connection-switch-2-student-home',
    renderCurrentConnectionFlow(
      'connection-switch-2-student-home',
      buildIosCredentialEntryActions(
        fixtures.accounts.student.email,
        fixtures.accounts.student.password,
      ),
      'student.home.screen',
    ),
  );
  fullFlows.set(
    'credential-diagnostic-home',
    renderCurrentConnectionFlow(
      'credential-diagnostic-home',
      buildIosCredentialEntryPasswordContinuationWithOriginalEmailAssertionActions(
        fixtures.accounts.student.password,
        fixtures.accounts.student.email,
      ),
      'student.home.screen',
    ),
  );
  fullFlows.set('entry-readiness', renderCurrentEntryReadiness());
  fullFlows.set(
    'email-after-tap',
    renderCurrentCredentialStage('email-after-tap', buildIosCredentialEntryDiagnosticTapActions()),
  );
  fullFlows.set(
    'email-after-input',
    renderCurrentCredentialStage(
      'email-after-input',
      buildIosCredentialEntryDiagnosticInputActions(fixtures.accounts.student.email),
    ),
  );
  fullFlows.set(
    'email-after-input-assertion',
    renderCurrentEmailAssertion(fixtures.accounts.student.email),
  );
  const exactFullFlowLabels = [
    'entry-readiness',
    'email-after-tap',
    'email-after-input',
    'email-after-input-assertion',
    'credential-diagnostic-home',
    ...expected,
  ];
  assert.equal(new Set(exactFullFlowLabels).size, 21);
  assert.deepEqual([...fullFlows.keys()].sort(), [...exactFullFlowLabels].sort());
  const fullFlowRows = exactFullFlowLabels.map((label) => {
    const flow = fullFlows.get(label);
    assert.equal(typeof flow, 'string', `${label} full flow was not captured`);
    const expectedName =
      label === 'entry-readiness'
        ? 'Native entry readiness observation'
        : label === 'email-after-input-assertion'
          ? 'Owned credential exact email assertion'
          : label === 'email-after-tap' || label === 'email-after-input'
            ? `Owned credential diagnostic ${label}`
            : label === 'credential-diagnostic-home' || label.endsWith('-home')
              ? `Native connection ${label}`
              : `Native inventory ${label}`;
    const parsed = parseFullProductionFlow(label, flow!, expectedName);
    return {
      label,
      documentCount: 2,
      commandCount: parsed.commands.length,
      signatures: commandSignature(parsed.commands),
      headerName: parsed.header.name,
    };
  });
  await writePrivateResult('full-camera-flow-matrix.private.json', {
    branch: 'all-exact-camera-checkpoint-production-flow-documents',
    exactCameraCheckpointCount: 21,
    fullFlowRows,
    fullFlowCount: fullFlowRows.length,
    nonEmptyCommandLists: fullFlowRows.every((row) => row.commandCount > 0),
    resourcesAcquired: false,
  });
  await writePrivateResult('camera-flow-matrix.private.json', {
    branch: 'camera-denied-executeCamera-callback',
    checked,
    count: checked.length,
  });
  await writePrivateResult('reachable-flow-matrix.private.json', {
    coreExactCameraCheckpointCount: 21,
    coreExactCameraCheckpointIds: [
      'entry-readiness',
      'email-after-tap',
      'email-after-input',
      'email-after-input-assertion',
      'credential-diagnostic-home',
      ...checked.map((row) => row.id),
    ],
    conditionalBuilderCount: 2,
    conditionalBuilderIds: ['credential-entry', 'password-offer-dismissal'],
    checkedCommandFlows: 23,
    reachableCommandFlows: 23,
    note: '21 exact credential-diagnostic camera callback labels plus two shared non-diagnostic conditional builders; camera-live-manual-submit is deduplicated.',
  });
});

void test('actual camera producer rejects unrelated training and snapshot identity mutations', async () => {
  const mutations: { name: string; mutate: (snapshot: OwnedDomainSnapshot) => void }[] = [
    {
      name: 'plan name',
      mutate: (snapshot) => {
        snapshot.trainingPlans[0].name = 'Changed';
      },
    },
    {
      name: 'session items',
      mutate: (snapshot) => {
        snapshot.trainingPlans[0].sessions[0].items = [{ id: 'unexpected-item' }];
      },
    },
    {
      name: 'owner',
      mutate: (snapshot) => {
        snapshot.trainingPlans[0].ownerProfessionalUid = coach;
      },
    },
    {
      name: 'plan deletion',
      mutate: (snapshot) => {
        snapshot.trainingPlans = [];
      },
    },
    {
      name: 'plan insertion',
      mutate: (snapshot) => {
        snapshot.trainingPlans.push({
          ...structuredClone(snapshot.trainingPlans[0]),
          id: 'unexpected-plan',
        });
      },
    },
    {
      name: 'run identity',
      mutate: (snapshot) => {
        snapshot.runId = 'b'.repeat(24);
      },
    },
    {
      name: 'scope identity',
      mutate: (snapshot) => {
        snapshot.scope = 'unexpected-scope';
      },
    },
    {
      name: 'read-only identity',
      mutate: (snapshot) => {
        snapshot.readOnly = false as never;
      },
    },
  ];
  for (const { name, mutate } of mutations) {
    let output = '';
    let expectedAfter: OwnedDomainSnapshot | undefined;
    await assert.rejects(
      runCameraManualSubmitPreflight(
        new Map(),
        undefined,
        (snapshot) => {
          mutate(snapshot);
          expectedAfter = structuredClone(snapshot);
        },
        (directory) => {
          output = directory;
        },
      ),
      /camera submit changed unrelated training state/,
      `${name} must be rejected by the actual camera producer`,
    );
    const retainedAfter: unknown = JSON.parse(
      await readFile(path.join(output, 'camera-training-after.private.json'), 'utf8'),
    );
    assert.deepEqual(
      retainedAfter,
      expectedAfter,
      `${name} must retain the complete raw after snapshot`,
    );
  }
});
