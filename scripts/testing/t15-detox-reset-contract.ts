export const T15_DETOX_RESET_FAMILIES = [
  'session',
  'training',
  'connection',
  'camera-denied',
  'save-retry',
] as const;

export const T15_DETOX_RESET_PLATFORMS = ['ios', 'android'] as const;

export type T15DetoxResetFamily = (typeof T15_DETOX_RESET_FAMILIES)[number];
export type T15DetoxResetPlatform = (typeof T15_DETOX_RESET_PLATFORMS)[number];
export type T15DetoxResetPendingReason =
  'detox-owner-public-composition-pending' | 'android-detox-camera-adapter-missing';

export const T15_DETOX_SHARED_RESET_REQUIRED_INPUTS = Object.freeze([
  'requestedRunId',
  'attemptId',
  'targetIdentity',
  'backendIdentity',
  'fixtureResetId',
  'originalReceiptBinding',
  'deadlineAtMonotonicMs',
  'ownershipWindows',
  'cleanupStatus',
] as const);

export type T15DetoxResetDependency = Readonly<{
  id: string;
  scenarioId: string;
  family: T15DetoxResetFamily;
  platform: T15DetoxResetPlatform;
  engine: 'detox';
  status: 'existing' | 'pending-composition';
  pendingReason: T15DetoxResetPendingReason;
  module: string | null;
  exportName: string | null;
  contract: string;
  requiredInputs: readonly string[];
  ownershipBoundary: string;
}>;

const SHARED_RESET_CONTRACT =
  'The shared Detox lifecycle producer composes an existing route owner with a FreshColdReset bound to the requested run and attempt, target/backend/fixture identities, a verified originalReceiptBinding, deadline and cancellation handling, ownership windows, and cleanup evidence; a replacement child cannot inherit another owner run.';

const ANDROID_CAMERA_RESET_CONTRACT =
  'The Android Detox camera adapter must provide the camera-denied native permission/manual-code route and then satisfy the shared Detox reset contract with the same target/backend/fixture/original receipt binding before execution can be enabled.';

function dependency(
  family: T15DetoxResetFamily,
  platform: T15DetoxResetPlatform,
  pendingReason: T15DetoxResetPendingReason,
  id: string,
  contract: string,
  status: T15DetoxResetDependency['status'],
  module: string | null,
  exportName: string | null,
): T15DetoxResetDependency {
  return Object.freeze({
    id,
    scenarioId: `SCN-${family}-${platform}`,
    family,
    platform,
    engine: 'detox',
    status,
    pendingReason,
    module,
    exportName,
    contract,
    requiredInputs: T15_DETOX_SHARED_RESET_REQUIRED_INPUTS,
    ownershipBoundary:
      'The reset producer, Detox owner, public consumer, and cleanup ledger must remain under the same ownerRunId; source declarations cannot authorize a runtime attempt.',
  });
}

const dependencies: T15DetoxResetDependency[] = [];
for (const family of T15_DETOX_RESET_FAMILIES)
  for (const platform of T15_DETOX_RESET_PLATFORMS) {
    const androidCamera = family === 'camera-denied' && platform === 'android';
    dependencies.push(
      dependency(
        family,
        platform,
        androidCamera
          ? 'android-detox-camera-adapter-missing'
          : 'detox-owner-public-composition-pending',
        androidCamera ? 'reset:android-detox-camera-adapter' : 'reset:shared-detox-contract',
        androidCamera ? ANDROID_CAMERA_RESET_CONTRACT : SHARED_RESET_CONTRACT,
        androidCamera ? 'pending-composition' : 'existing',
        androidCamera ? null : 'scripts/testing/t15-detox-cold-lifecycle.ts',
        androidCamera ? null : 'createT15DetoxSharedResetProducer',
      ),
    );
  }

export const T15_DETOX_SHARED_RESET_DEPENDENCIES: readonly T15DetoxResetDependency[] =
  Object.freeze(
    dependencies.filter(
      (entry) => entry.pendingReason === 'detox-owner-public-composition-pending',
    ),
  );

export const T15_ANDROID_DETOX_CAMERA_RESET_DEPENDENCY = dependencies.find(
  (entry) => entry.pendingReason === 'android-detox-camera-adapter-missing',
);

if (!T15_ANDROID_DETOX_CAMERA_RESET_DEPENDENCY)
  throw new Error('T15 Android Detox camera reset dependency is not declared');

export const T15_DETOX_RESET_DEPENDENCIES: readonly T15DetoxResetDependency[] =
  Object.freeze(dependencies);

const byRoute = new Map(
  dependencies.map((entry) => [`${entry.family}|${entry.platform}`, entry] as const),
);

export function requireT15DetoxResetDependency(
  family: T15DetoxResetFamily,
  platform: T15DetoxResetPlatform,
): T15DetoxResetDependency {
  const result = byRoute.get(`${family}|${platform}`);
  if (!result)
    throw new Error(`T15 Detox reset dependency is not declared for ${family}/${platform}`);
  return result;
}

export const T15_DETOX_RESET_CALLER_GAPS = Object.freeze([
  'The shared nine-route lifecycle contract is source-complete, but the existing Detox owner/public seams are not yet normalized into caller-supplied route bindings.',
  'No executable Detox route binding currently connects the shared producer to an existing target/backend/fixture owner and its cleanup ledger; source declarations cannot authorize a runtime attempt.',
  'The Android Detox camera owner/public adapter is missing in addition to the shared reset dependency.',
  'No native Detox cold attempt has been executed; the 20-cell/400-attempt denominator remains unchanged and receives no source-only credit.',
] as const);
