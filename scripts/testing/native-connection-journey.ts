import assert from 'node:assert/strict';
import {
  requireAndroidConnectionActorIdentity,
  requireAndroidConnectionSignInBoundary,
} from './capture-android-testability';
import {
  requireIosConnectionActorIdentity,
  requireIosConnectionSignInBoundary,
} from './capture-native-testability';
import { resolveProfessionalRosterTarget } from './native-connection-hierarchy';
import { resolveAndroidProfessionalRosterTarget } from './native-connection-hierarchy-android';
import {
  observeConnectionJourney,
  requireNativeConnectionInviteCode,
  requirePlatformConnectionInviteCode,
  type ConnectionInitialAuth,
  type ConnectionJourneyOptions,
  type ConnectionJourneyPolicy,
  type SharedConnectionRuntimeContext,
} from './native-connection-journey-core';
import {
  ANDROID_CONNECTION_PLATFORM,
  IOS_CONNECTION_PLATFORM,
  type ConnectionActor,
  type ConnectionNavigation,
} from './native-connection-platform-contract';
import type { AndroidConnectionRuntimeContext } from './capture-android-testability';
import type { IosConnectionRuntimeContext } from './capture-native-testability';
import type { NativeConnectionTargetScope } from './native-connection-hierarchy';

export {
  buildNativeConnectionSnapshotReference,
  nativeConnectionSnapshotPath,
  requireNativeConnectionInviteCode,
  requireNativeConnectionTransport,
  sealNativeConnectionSnapshotReferences,
  type ConnectionInitialAuth,
  type ConnectionJourneyOptions,
  type ConnectionJourneyPolicy,
  type SharedConnectionRuntimeContext,
} from './native-connection-journey-core';
export {
  NATIVE_CONNECTION_SNAPSHOT_KEYS,
  type NativeConnectionArtifactLabel,
  type NativeConnectionSnapshotKey,
  type NativeConnectionSnapshotReference,
  type NativeConnectionSnapshotReferences,
} from './native-connection-journey-core';

function requireIosInitialCoachAuth(
  context: SharedConnectionRuntimeContext,
  target: NativeConnectionTargetScope,
): ConnectionInitialAuth {
  const boundary = requireIosConnectionSignInBoundary(context.proxy.observations, 0);
  const actorAuthUid = requireIosConnectionActorIdentity(context.proxy.nativeAuthIdentities, {
    actorAuthUid: target.professionalAuthUid,
    authRequestId: boundary.authRequestId,
    apiIdentity: context.apiIdentity,
    fixtureAuthUids: target.fixtureAuthUids,
  });
  const captured = context.report.connectionInitialAuth as { afterRequestId?: unknown } | undefined;
  assert(captured && Number.isSafeInteger(captured.afterRequestId));
  const afterRequestId = Number(captured.afterRequestId);
  assert(
    afterRequestId >= boundary.authRequestId && afterRequestId <= boundary.afterRequestId,
    'Captured iOS initial auth boundary is outside the observed sign-in window',
  );
  const initialAuth: ConnectionInitialAuth = {
    actor: 'coach',
    actorAuthUid,
    authRequestId: boundary.authRequestId,
    afterRequestId,
  };
  assert.deepEqual(
    context.report.connectionInitialAuth,
    initialAuth,
    'Capture and controller initial principal boundaries differ',
  );
  return initialAuth;
}

function requireAndroidInitialCoachAuth(
  context: SharedConnectionRuntimeContext,
  target: NativeConnectionTargetScope,
): ConnectionInitialAuth {
  const boundary = requireAndroidConnectionSignInBoundary(
    context.proxy.observations,
    context.proxy.nativeAuthIdentities,
    { beforeRequestId: 0, apiIdentity: context.apiIdentity },
  );
  const actorAuthUid = requireAndroidConnectionActorIdentity(context.proxy.nativeAuthIdentities, {
    actorAuthUid: target.professionalAuthUid,
    authRequestId: boundary.authRequestId,
    apiIdentity: context.apiIdentity,
    fixtureAuthUids: target.fixtureAuthUids,
  });
  const initialAuth: ConnectionInitialAuth = {
    actor: 'coach',
    actorAuthUid,
    ...boundary,
  };
  assert.deepEqual(
    context.report.connectionInitialAuth,
    initialAuth,
    'Capture and controller initial principal boundaries differ',
  );
  return initialAuth;
}

/**
 * The shared journey has an optional Detox action channel in its sixth
 * argument.  Maestro's iOS observer uses that position for its private
 * not-visible selector list, so pass only the five Maestro arguments through
 * this adapter.  The shared controller has already resolved and embedded the
 * owned Accept selector in `actions`; an unsupported action kind still fails
 * closed instead of being mistaken for a selector list.
 */
export function adaptIosConnectionObserve(
  observe: IosConnectionRuntimeContext['observe'],
): SharedConnectionRuntimeContext['observe'] {
  return async (label, actions, viewId, selectors, kind = 'id', action) => {
    if (action !== undefined) assert.equal(action.kind, 'accept');
    await observe(label, actions, viewId, selectors, kind);
  };
}

/**
 * Keep the shared semantic navigation enum intact for both the Maestro
 * lowering boundary and the Detox IPC boundary.  Maestro converts this value
 * to actions in its runtime context; Detox validates and transports the enum.
 */
export function adaptIosContext(
  context: IosConnectionRuntimeContext,
): SharedConnectionRuntimeContext {
  return {
    ...context,
    observe: adaptIosConnectionObserve(context.observe),
    switchAccount: async (actor: ConnectionActor, navigation: ConnectionNavigation = 'none') => {
      assert(actor === 'coach' || actor === 'student');
      return context.switchAccount(actor, navigation);
    },
  };
}

function adaptAndroidContext(
  context: AndroidConnectionRuntimeContext,
): SharedConnectionRuntimeContext {
  return context;
}

const iosPolicy: ConnectionJourneyPolicy = Object.freeze({
  profile: IOS_CONNECTION_PLATFORM,
  requireInitialCoachAuth: requireIosInitialCoachAuth,
  requireInviteCode: requireNativeConnectionInviteCode,
  resolveRoster: (tree, targetStudentAuthUid, assignmentState) =>
    resolveProfessionalRosterTarget({ tree, targetStudentAuthUid, assignmentState }),
});

const androidPolicy: ConnectionJourneyPolicy = Object.freeze({
  profile: ANDROID_CONNECTION_PLATFORM,
  requireInitialCoachAuth: requireAndroidInitialCoachAuth,
  requireInviteCode: (tree) =>
    requirePlatformConnectionInviteCode(tree, ANDROID_CONNECTION_PLATFORM),
  resolveRoster: (tree, targetStudentAuthUid, assignmentState) =>
    resolveAndroidProfessionalRosterTarget({ tree, targetStudentAuthUid, assignmentState }),
  frameQualification: ({ pendingRosterMatch, rosterMatch }) => {
    const pendingEvidence = (pendingRosterMatch as { assignmentStateEvidence?: { path?: string } })
      .assignmentStateEvidence;
    const activeEvidence = (rosterMatch as { assignmentStateEvidence?: { path?: string } })
      .assignmentStateEvidence;
    return {
      platform: 'android',
      frameTextAttribute: 'accessibilityText',
      status: 'qualified',
      pendingAssignmentState: 'pending',
      activeAssignmentState: 'active',
      pendingRosterPath: pendingEvidence?.path,
      activeRosterPath: activeEvidence?.path,
    };
  },
});

export async function observeIosConnectionJourney(
  context: IosConnectionRuntimeContext,
  options: Omit<ConnectionJourneyOptions, 'profile' | 'policy'>,
): Promise<void> {
  assert.equal(options.selection.arguments.platform, 'ios');
  assert.equal(context.fixtures.scope, IOS_CONNECTION_PLATFORM.fixtureScope);
  await observeConnectionJourney(adaptIosContext(context), {
    ...options,
    profile: IOS_CONNECTION_PLATFORM,
    policy: iosPolicy,
  });
}

export async function observeAndroidConnectionJourney(
  context: AndroidConnectionRuntimeContext,
  options: Omit<ConnectionJourneyOptions, 'profile' | 'policy'>,
): Promise<void> {
  assert.equal(options.selection.arguments.platform, 'android');
  assert.equal(context.fixtures.scope, ANDROID_CONNECTION_PLATFORM.fixtureScope);
  await observeConnectionJourney(adaptAndroidContext(context), {
    ...options,
    profile: ANDROID_CONNECTION_PLATFORM,
    policy: androidPolicy,
  });
}

export function requireAndroidRosterFrameQualification(value: unknown): void {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const record = value as Record<string, unknown>;
  assert.equal(record.platform, 'android');
  assert.equal(record.frameTextAttribute, 'accessibilityText');
  assert.equal(record.status, 'qualified');
  assert.equal(record.pendingAssignmentState, 'pending');
  assert.equal(record.activeAssignmentState, 'active');
}
