import { requireT15DetoxResetDependency } from './t15-detox-reset-contract';
import type {
  NativeComparisonAttemptExpectation,
  NativeComparisonCell,
  NativeComparisonCellIdentity,
  NativeComparisonEngine,
  NativeComparisonLocale,
  NativeComparisonMode,
  NativeComparisonPlatform,
} from './compare-native-pilot';
import type { NativePilotSelection } from './native-pilot-contract';
import type {
  ColdComparisonAttemptProducer,
  ColdComparisonOwnedAttemptProducer,
  ColdComparisonResetProducer,
} from './t15-cold-dispatcher';

export const T15_MATRIX_FAMILIES = [
  'session',
  'training',
  'connection',
  'camera-denied',
  'save-retry',
] as const;
export const T15_MATRIX_PLATFORMS = ['ios', 'android'] as const;
export const T15_MATRIX_ENGINES = ['maestro', 'detox'] as const;
export const T15_MATRIX_MODE: NativeComparisonMode = 'integration';
export const T15_MATRIX_LOCALE: NativeComparisonLocale = 'en-US';
export const T15_MATRIX_CELL_COUNT = 20;
export const T15_MATRIX_ATTEMPTS_PER_CELL = 20;
export const T15_MATRIX_ATTEMPT_COUNT = 400;

export type T15MatrixFamily = (typeof T15_MATRIX_FAMILIES)[number];

export type T15MatrixRouteStatus = 'wired' | 'pending';
export type T15MatrixAdapterStatus = 'existing' | 'pending-composition' | 'missing';
export type T15MatrixPendingReason =
  | 'android-detox-camera-adapter-missing'
  | 'detox-owner-public-composition-pending'
  | 'android-maestro-owner-current-q-composition-pending'
  | 'ios-maestro-session-current-q-composition-pending'
  | 'shared-reset-contract-pending';

export type T15MatrixDependency = Readonly<{
  id: string;
  role: 'owner' | 'reset' | 'public' | 'build' | 'fixture';
  status: T15MatrixAdapterStatus;
  module: string | null;
  exportName: string | null;
  contract: string;
}>;

/**
 * These are executable seams only when the caller binds a real producer. The
 * registry never manufactures an adapter or promotes a source fixture to a
 * runtime attempt.
 */
export type T15MatrixRouteBinding = Readonly<{
  ownedAttempt?: ColdComparisonOwnedAttemptProducer;
  reset?: ColdComparisonResetProducer;
  produce?: ColdComparisonAttemptProducer;
}>;

export type T15MatrixRoute = Readonly<{
  key: string;
  scenarioId: string;
  family: T15MatrixFamily;
  platform: NativeComparisonPlatform;
  engine: NativeComparisonEngine;
  mode: NativeComparisonMode;
  locale: NativeComparisonLocale;
  status: T15MatrixRouteStatus;
  pendingReason: T15MatrixPendingReason | null;
  owner: T15MatrixDependency;
  reset: T15MatrixDependency;
  public: T15MatrixDependency;
  build: T15MatrixDependency;
  fixture: T15MatrixDependency;
  binding: T15MatrixRouteBinding | null;
}>;

export type T15MatrixRouteInput = Readonly<{
  expected: NativeComparisonAttemptExpectation;
  cell: NativeComparisonCell;
  selection: NativePilotSelection;
}>;

export type T15MatrixRouteErrorCode =
  'unknown-cell' | 'selection-mismatch' | 'pending-route' | 'route-binding-missing';

export class T15MatrixRouteError extends Error {
  readonly code: T15MatrixRouteErrorCode;
  readonly key: string;

  constructor(code: T15MatrixRouteErrorCode, key: string, message: string) {
    super(message);
    this.name = 'T15MatrixRouteError';
    this.code = code;
    this.key = key;
  }
}

export function t15MatrixRouteKey(identity: NativeComparisonCellIdentity): string {
  return JSON.stringify([
    identity.scenarioId,
    identity.platform,
    identity.engine,
    identity.mode,
    identity.locale,
  ]);
}

export function t15MatrixDisplayKey(identity: NativeComparisonCellIdentity): string {
  return [
    identity.scenarioId,
    identity.platform,
    identity.engine,
    identity.mode,
    identity.locale,
  ].join('|');
}

function dependency(
  role: T15MatrixDependency['role'],
  status: T15MatrixAdapterStatus,
  module: string | null,
  exportName: string | null,
  contract: string,
  idOverride?: string,
): T15MatrixDependency {
  return Object.freeze({
    id: idOverride ?? `${role}:${module ?? 'missing'}`,
    role,
    status,
    module,
    exportName,
    contract,
  });
}

function scenarioId(family: T15MatrixFamily, platform: NativeComparisonPlatform): string {
  return `SCN-${family}-${platform}`;
}

function descriptor(input: {
  family: T15MatrixFamily;
  platform: NativeComparisonPlatform;
  engine: NativeComparisonEngine;
  status: T15MatrixRouteStatus;
  pendingReason: T15MatrixPendingReason | null;
  owner: T15MatrixDependency;
  reset: T15MatrixDependency;
  public: T15MatrixDependency;
  build: T15MatrixDependency;
  fixture: T15MatrixDependency;
}): T15MatrixRoute {
  const identity: NativeComparisonCellIdentity = {
    scenarioId: scenarioId(input.family, input.platform),
    platform: input.platform,
    engine: input.engine,
    mode: T15_MATRIX_MODE,
    locale: T15_MATRIX_LOCALE,
  };
  return {
    ...identity,
    key: t15MatrixRouteKey(identity),
    family: input.family,
    status: input.status,
    pendingReason: input.pendingReason,
    owner: input.owner,
    reset: input.reset,
    public: input.public,
    build: input.build,
    fixture: input.fixture,
    binding: null,
  };
}

function maestroDescriptor(
  family: T15MatrixFamily,
  platform: NativeComparisonPlatform,
): T15MatrixRoute {
  const android = platform === 'android';
  const currentIosFamily = !android && family !== 'session';
  const maestroOwnerComposition = android || family === 'session';
  const extensionPending: T15MatrixPendingReason | null =
    family === 'session' && !android
      ? 'ios-maestro-session-current-q-composition-pending'
      : android
        ? 'android-maestro-owner-current-q-composition-pending'
        : null;
  const status: T15MatrixRouteStatus =
    currentIosFamily || maestroOwnerComposition ? 'wired' : 'pending';
  const ownerStatus: T15MatrixAdapterStatus =
    currentIosFamily || maestroOwnerComposition ? 'existing' : 'pending-composition';
  const resetStatus: T15MatrixAdapterStatus =
    currentIosFamily || maestroOwnerComposition ? 'existing' : 'pending-composition';
  const publicStatus: T15MatrixAdapterStatus = 'existing';
  const buildStatus: T15MatrixAdapterStatus = 'existing';
  const fixtureStatus: T15MatrixAdapterStatus = resetStatus;
  const ownerModule = currentIosFamily
    ? 'scripts/testing/t15-cold-owned-lifecycle.ts'
    : 'scripts/testing/t15-cold-maestro-owner-extension.ts';
  const ownerExport = currentIosFamily
    ? 'createT15OwnedLifecycleProducer'
    : 'runT15MaestroOwnerExtension';
  const familyModules: Record<T15MatrixFamily, string> = {
    session: android
      ? 'scripts/testing/run-android-session-attempt.ts'
      : 'scripts/testing/run-ios-session-attempt.ts',
    training: android
      ? 'scripts/testing/run-android-training-attempt.ts'
      : 'scripts/testing/run-ios-training-attempt.ts',
    connection: android
      ? 'scripts/testing/run-android-connection-attempt.ts'
      : 'scripts/testing/run-ios-connection-attempt.ts',
    'camera-denied': android
      ? 'scripts/testing/run-android-camera-public-attempt.ts'
      : 'scripts/testing/run-ios-camera-attempt.ts',
    'save-retry': android
      ? 'scripts/testing/run-android-save-retry-attempt.ts'
      : 'scripts/testing/run-ios-save-retry-attempt.ts',
  };
  const familyExports: Record<T15MatrixFamily, string> = {
    session: android ? 'runAndroidSessionAttempt' : 'runIosSessionAttempt',
    training: android ? 'runAndroidTrainingAttempt' : 'runIosTrainingAttempt',
    connection: android ? 'runAndroidConnectionAttempt' : 'runIosConnectionAttempt',
    'camera-denied': android ? 'runAndroidCameraPublicAttempt' : 'runIosCameraAttempt',
    'save-retry': android ? 'runAndroidSaveRetryAttempt' : 'runIosSaveRetryAttempt',
  };
  return descriptor({
    family,
    platform,
    engine: 'maestro',
    status,
    pendingReason: currentIosFamily || maestroOwnerComposition ? null : extensionPending,
    owner: dependency(
      'owner',
      ownerStatus,
      ownerModule,
      ownerExport,
      'ColdComparisonOwnedAttemptProducer',
    ),
    reset: dependency(
      'reset',
      resetStatus,
      android
        ? 'scripts/testing/t15-cold-android-reset-producer.ts'
        : 'scripts/testing/t15-cold-ios-reset-producer.ts',
      android ? 'produceAndroidColdReset' : 'produceIosColdReset',
      'FreshColdReset with verified originalResetBinding',
    ),
    public: dependency(
      'public',
      publicStatus,
      currentIosFamily ? 'scripts/testing/t15-cold-owned-lifecycle.ts' : familyModules[family],
      currentIosFamily ? 'createT15OwnedPublicConsumer' : familyExports[family],
      'NativeComparisonReceiptInput bound to the same attempt',
    ),
    build: dependency(
      'build',
      buildStatus,
      android
        ? 'scripts/testing/detox-android-qualified-build.ts'
        : 'scripts/testing/native-build-reuse.ts',
      android ? 'requireAndroidDetoxBuildDescriptor' : 'loadReusableIosBuild',
      'QualifiedBuildReuse; bytes may be reused, state may not',
    ),
    fixture: dependency(
      'fixture',
      fixtureStatus,
      android
        ? 'scripts/testing/t15-cold-android-reset-producer.ts'
        : 'scripts/testing/t15-cold-ios-reset-producer.ts',
      android ? 'produceAndroidColdReset' : 'produceIosColdReset',
      'Fresh fixture/reset identity per attempt',
    ),
  });
}

function detoxDescriptor(
  family: T15MatrixFamily,
  platform: NativeComparisonPlatform,
): T15MatrixRoute {
  const android = platform === 'android';
  const camera = family === 'camera-denied';
  const missingCamera = android && camera;
  const resetDependency = requireT15DetoxResetDependency(family, platform);
  const pendingReason: T15MatrixPendingReason = missingCamera
    ? 'android-detox-camera-adapter-missing'
    : 'detox-owner-public-composition-pending';
  const ownerModules: Record<T15MatrixFamily, [string, string]> = {
    session: [
      android
        ? 'scripts/testing/detox-integrated-session-baseline.ts'
        : 'scripts/testing/native-detox-session-native-pilot-route.ts',
      android ? 'runDetoxIntegratedSessionBaseline' : 'runIosDetoxSessionAttemptForNativePilot',
    ],
    training: [
      'scripts/testing/detox-training-owned-dispatch.ts',
      'runDetoxTrainingOnExistingOwner',
    ],
    connection: [
      android
        ? 'scripts/testing/native-detox-connection-android-public-dispatch.ts'
        : 'scripts/testing/native-detox-connection-public-dispatch.ts',
      android
        ? 'runAndroidDetoxConnectionAttemptForNativePilot'
        : 'runIosDetoxConnectionAttemptForNativePilot',
    ],
    'camera-denied': [
      'scripts/testing/run-ios-detox-camera-attempt.ts',
      'runIosDetoxCameraAttemptForPublicDispatch',
    ],
    'save-retry': [
      'scripts/testing/detox-save-retry-owned-dispatch.ts',
      'runDetoxSaveRetryOnExistingOwner',
    ],
  };
  const [ownerModule, ownerExport] = ownerModules[family];
  const ownerStatus: T15MatrixAdapterStatus = missingCamera
    ? 'missing'
    : android && family === 'session'
      ? 'pending-composition'
      : 'existing';
  const publicStatus: T15MatrixAdapterStatus = missingCamera ? 'missing' : 'existing';
  return descriptor({
    family,
    platform,
    engine: 'detox',
    status: 'pending',
    pendingReason,
    owner: dependency(
      'owner',
      ownerStatus,
      missingCamera ? null : ownerModule,
      missingCamera ? null : ownerExport,
      'ColdComparisonOwnedAttemptProducer',
    ),
    reset: dependency(
      'reset',
      resetDependency.status,
      resetDependency.module,
      resetDependency.exportName,
      resetDependency.contract,
      resetDependency.id,
    ),
    public: dependency(
      'public',
      publicStatus,
      missingCamera ? null : ownerModule,
      missingCamera ? null : ownerExport,
      'NativeComparisonReceiptInput bound to the same attempt',
    ),
    build: dependency(
      'build',
      'existing',
      android
        ? 'scripts/testing/detox-android-qualified-build.ts'
        : 'scripts/testing/native-build-reuse.ts',
      android ? 'requireAndroidDetoxBuildDescriptor' : 'loadReusableIosBuild',
      'QualifiedBuildReuse; bytes may be reused, state may not',
    ),
    fixture: dependency(
      'fixture',
      resetDependency.status,
      resetDependency.module,
      resetDependency.exportName,
      `Fresh fixture/reset identity per attempt; ${resetDependency.contract}`,
    ),
  });
}

function buildDescriptors(): T15MatrixRoute[] {
  const result: T15MatrixRoute[] = [];
  for (const family of T15_MATRIX_FAMILIES)
    for (const platform of T15_MATRIX_PLATFORMS) {
      result.push(maestroDescriptor(family, platform));
      result.push(detoxDescriptor(family, platform));
    }
  return result;
}

const descriptors = buildDescriptors();

export const T15_REGISTERED_MATRIX_ROUTES: readonly T15MatrixRoute[] = Object.freeze(
  descriptors.map((route) => Object.freeze(route)),
);

export const T15_REGISTERED_MATRIX_KEYS: readonly string[] = Object.freeze(
  T15_REGISTERED_MATRIX_ROUTES.map((route) => route.key),
);

function assertExpectedBinding(
  route: T15MatrixRoute,
  expected: NativeComparisonAttemptExpectation,
  cell: NativeComparisonCell,
  selection: NativePilotSelection,
): void {
  if (
    expected.locale !== route.locale ||
    cell.scenarioId !== route.scenarioId ||
    cell.platform !== route.platform ||
    cell.engine !== route.engine ||
    cell.mode !== route.mode ||
    cell.locale !== route.locale ||
    selection.arguments.platform !== route.platform ||
    selection.arguments.engine !== route.engine ||
    selection.arguments.mode !== route.mode ||
    selection.arguments.scenario !== route.scenarioId ||
    selection.scenario.id !== route.scenarioId ||
    selection.scenario.platform !== route.platform ||
    selection.scenarioHash !== expected.inputs.scenarioHash ||
    selection.requirementHash !== expected.inputs.requirementHash
  )
    throw new T15MatrixRouteError(
      'selection-mismatch',
      route.key,
      `T15 selection is not bound to ${route.key}`,
    );
}

export class T15MatrixRouteRegistry {
  readonly entries: readonly T15MatrixRoute[];
  private readonly byKey: ReadonlyMap<string, T15MatrixRoute>;

  constructor(
    entries: readonly T15MatrixRoute[] = T15_REGISTERED_MATRIX_ROUTES,
    bindings: Readonly<Record<string, T15MatrixRouteBinding>> = {},
  ) {
    if (entries.length !== T15_MATRIX_CELL_COUNT)
      throw new Error(`T15 route registry requires exactly ${T15_MATRIX_CELL_COUNT} routes`);
    const keys = entries.map((entry) => entry.key);
    if (new Set(keys).size !== keys.length)
      throw new Error('T15 route registry contains duplicate keys');
    const expectedKeys = new Set(T15_REGISTERED_MATRIX_KEYS);
    if (entries.some((entry) => !expectedKeys.has(entry.key)))
      throw new Error('T15 route registry contains a key outside the reviewed 20-cell matrix');
    this.entries = Object.freeze(
      entries.map((entry) =>
        Object.freeze({ ...entry, binding: bindings[entry.key] ?? entry.binding ?? null }),
      ),
    );
    this.byKey = new Map(this.entries.map((entry) => [entry.key, entry]));
  }

  get(key: string): T15MatrixRoute | undefined {
    return this.byKey.get(key);
  }

  withBindings(bindings: Readonly<Record<string, T15MatrixRouteBinding>>): T15MatrixRouteRegistry {
    return new T15MatrixRouteRegistry(this.entries, bindings);
  }

  requireSelection(input: T15MatrixRouteInput): T15MatrixRoute {
    const key = t15MatrixRouteKey(input.cell);
    const route = this.byKey.get(key);
    if (!route)
      throw new T15MatrixRouteError('unknown-cell', key, `T15 cell is not registered: ${key}`);
    assertExpectedBinding(route, input.expected, input.cell, input.selection);
    return route;
  }

  requireExecutable(input: T15MatrixRouteInput): T15MatrixRoute {
    const route = this.requireSelection(input);
    if (route.status !== 'wired') {
      throw new T15MatrixRouteError(
        'pending-route',
        route.key,
        `T15 route ${t15MatrixDisplayKey(route)} is pending: ${route.pendingReason}`,
      );
    }
    const binding = route.binding;
    if (!binding || (!binding.ownedAttempt && (!binding.reset || !binding.produce))) {
      throw new T15MatrixRouteError(
        'route-binding-missing',
        route.key,
        `T15 route ${t15MatrixDisplayKey(route)} lacks an executable owner or reset/producer binding`,
      );
    }
    return route;
  }

  keys(): readonly string[] {
    return this.entries.map((entry) => entry.key);
  }
}

export function createT15MatrixRouteRegistry(
  bindings: Readonly<Record<string, T15MatrixRouteBinding>> = {},
): T15MatrixRouteRegistry {
  return new T15MatrixRouteRegistry(T15_REGISTERED_MATRIX_ROUTES, bindings);
}
