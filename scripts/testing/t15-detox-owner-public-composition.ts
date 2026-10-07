import {
  runDetoxIntegratedSessionBaseline,
  type DetoxIntegratedSessionBaselineOptions,
} from './detox-integrated-session-baseline';
import { runDetoxSaveRetryOnExistingOwner } from './detox-save-retry-owned-dispatch';
import { runDetoxTrainingOnExistingOwner } from './detox-training-owned-dispatch';
import { stageNativeAndroidSaveRetryPublicEvidence } from './native-android-save-retry-public-evidence';
import { stageAndroidDetoxSessionPublicEvidence } from './native-detox-android-session-public-finalization';
import { verifyDetoxIosCameraPrivateEvidence } from './native-detox-camera-ios-verifier';
import {
  runAndroidDetoxConnectionAttemptForNativePilot,
  runAndroidDetoxConnectionPublicAttempt,
} from './native-detox-connection-android-public-dispatch';
import {
  runIosDetoxConnectionAttemptForNativePilot,
  runIosDetoxConnectionPublicAttempt,
} from './native-detox-connection-public-dispatch';
import { runIosDetoxSessionAttemptForNativePilot } from './native-detox-session-native-pilot-route';
import { runIosDetoxSessionPublicAdapter } from './native-detox-session-public-adapter';
import {
  runIosDetoxTrainingAttemptForNativePilot,
  runIosDetoxTrainingAttemptForPublicDispatch,
} from './native-detox-training-public-dispatch';
import { stageNativeSaveRetryPublicEvidence } from './native-save-retry-public-evidence';
import { runIosDetoxCameraAttemptForPublicDispatch } from './run-ios-detox-camera-attempt';
import {
  runT15AndroidDetoxSessionColdRoute,
  type T15AndroidDetoxSessionColdRouteInput,
} from './t15-detox-android-session-cold-route';
import {
  createT15DetoxSharedLifecycleProducer,
  requireT15DetoxSharedRoute,
  T15_DETOX_SHARED_ROUTE_KEYS,
  type T15DetoxCleanup,
  type T15DetoxOwner,
  type T15DetoxPublicConsumer,
  type T15DetoxResetPreparation,
  type T15DetoxSharedRouteKey,
} from './t15-detox-cold-lifecycle';

/**
 * The current route functions are deliberately retained as values here. This
 * makes a stale route name or a copied helper fail at compile time while the
 * normalized T15 adapters remain caller-owned. The current functions return
 * route-specific private candidates, so none is silently cast to a shared
 * owner/public receipt.
 */
type ActualOwnerFunction =
  | typeof runIosDetoxSessionAttemptForNativePilot
  | typeof runDetoxIntegratedSessionBaseline
  | typeof runIosDetoxTrainingAttemptForNativePilot
  | typeof runDetoxTrainingOnExistingOwner
  | typeof runIosDetoxConnectionAttemptForNativePilot
  | typeof runAndroidDetoxConnectionAttemptForNativePilot
  | typeof runIosDetoxCameraAttemptForPublicDispatch
  | typeof runDetoxSaveRetryOnExistingOwner;

type ActualPublicFunction =
  | typeof runIosDetoxSessionPublicAdapter
  | typeof stageAndroidDetoxSessionPublicEvidence
  | typeof runIosDetoxTrainingAttemptForPublicDispatch
  | typeof runDetoxTrainingOnExistingOwner
  | typeof runIosDetoxConnectionPublicAttempt
  | typeof runAndroidDetoxConnectionPublicAttempt
  | typeof verifyDetoxIosCameraPrivateEvidence
  | typeof stageNativeSaveRetryPublicEvidence
  | typeof stageNativeAndroidSaveRetryPublicEvidence;

export type T15DetoxActualRouteBinding = Readonly<{
  key: T15DetoxSharedRouteKey;
  ownerModule: string;
  ownerExport: string;
  owner: ActualOwnerFunction;
  publicModule: string;
  publicExport: string;
  publicConsumer: ActualPublicFunction;
  /** These are the actual route-specific shapes, not shared receipt claims. */
  ownerResult: string;
  publicResult: string;
  status: 'normalization-required';
  missingAdapters: readonly [
    'reset-preparation',
    'owner-normalizer',
    'public-normalizer',
    'cleanup-ledger',
  ];
}>;

/** Default Android session owner/public route for the first concrete T15 wire. */
export const t15AndroidDetoxSessionDefaultRoute = runT15AndroidDetoxSessionColdRoute;
export type T15AndroidDetoxSessionDefaultRouteInput = T15AndroidDetoxSessionColdRouteInput;

type BindingSpec = Omit<T15DetoxActualRouteBinding, 'key'>;

const route = (key: T15DetoxSharedRouteKey, spec: BindingSpec): T15DetoxActualRouteBinding => {
  const declared = requireT15DetoxSharedRoute(key);
  if (declared.ownerModule !== spec.ownerModule || declared.ownerExport !== spec.ownerExport)
    throw new Error(`T15 Detox owner declaration drifted for ${key}`);
  if (declared.publicModule !== spec.publicModule || declared.publicExport !== spec.publicExport)
    throw new Error(`T15 Detox public declaration drifted for ${key}`);
  return Object.freeze({ key, ...spec });
};

const MISSING_ADAPTERS = Object.freeze([
  'reset-preparation',
  'owner-normalizer',
  'public-normalizer',
  'cleanup-ledger',
] as const);

const BINDINGS: readonly T15DetoxActualRouteBinding[] = Object.freeze([
  route('session|ios', {
    ownerModule: 'scripts/testing/native-detox-session-native-pilot-route.ts',
    ownerExport: 'runIosDetoxSessionAttemptForNativePilot',
    owner: runIosDetoxSessionAttemptForNativePilot,
    publicModule: 'scripts/testing/native-detox-session-public-adapter.ts',
    publicExport: 'runIosDetoxSessionPublicAdapter',
    publicConsumer: runIosDetoxSessionPublicAdapter,
    ownerResult: 'IosDetoxSessionNativePilotAttempt',
    publicResult: 'IosDetoxSessionPublicAdapterResult',
    status: 'normalization-required',
    missingAdapters: MISSING_ADAPTERS,
  }),
  route('session|android', {
    ownerModule: 'scripts/testing/detox-integrated-session-baseline.ts',
    ownerExport: 'runDetoxIntegratedSessionBaseline',
    owner: runDetoxIntegratedSessionBaseline,
    publicModule: 'scripts/testing/native-detox-android-session-public-finalization.ts',
    publicExport: 'stageAndroidDetoxSessionPublicEvidence',
    publicConsumer: stageAndroidDetoxSessionPublicEvidence,
    ownerResult: 'DetoxIntegratedSessionBaseline result (inferred)',
    publicResult: 'AndroidDetoxSessionStageResult',
    status: 'normalization-required',
    missingAdapters: MISSING_ADAPTERS,
  }),
  route('training|ios', {
    ownerModule: 'scripts/testing/native-detox-training-public-dispatch.ts',
    ownerExport: 'runIosDetoxTrainingAttemptForNativePilot',
    owner: runIosDetoxTrainingAttemptForNativePilot,
    publicModule: 'scripts/testing/native-detox-training-public-dispatch.ts',
    publicExport: 'runIosDetoxTrainingAttemptForPublicDispatch',
    publicConsumer: runIosDetoxTrainingAttemptForPublicDispatch,
    ownerResult: 'DetoxIosTrainingNativePilotAttemptResult',
    publicResult: 'DetoxIosTrainingNativePilotAttemptResult (private dispatch)',
    status: 'normalization-required',
    missingAdapters: MISSING_ADAPTERS,
  }),
  route('training|android', {
    ownerModule: 'scripts/testing/detox-training-owned-dispatch.ts',
    ownerExport: 'runDetoxTrainingOnExistingOwner',
    owner: runDetoxTrainingOnExistingOwner,
    publicModule: 'scripts/testing/detox-training-owned-dispatch.ts',
    publicExport: 'runDetoxTrainingOnExistingOwner',
    publicConsumer: runDetoxTrainingOnExistingOwner,
    ownerResult: 'private owned training result (inferred)',
    publicResult: 'private owned training result (inferred)',
    status: 'normalization-required',
    missingAdapters: MISSING_ADAPTERS,
  }),
  route('connection|ios', {
    ownerModule: 'scripts/testing/native-detox-connection-public-dispatch.ts',
    ownerExport: 'runIosDetoxConnectionAttemptForNativePilot',
    owner: runIosDetoxConnectionAttemptForNativePilot,
    publicModule: 'scripts/testing/native-detox-connection-public-dispatch.ts',
    publicExport: 'runIosDetoxConnectionPublicAttempt',
    publicConsumer: runIosDetoxConnectionPublicAttempt,
    ownerResult: 'DetoxNativePilotAttemptResult',
    publicResult: 'DetoxIosConnectionPublicBridgeResult',
    status: 'normalization-required',
    missingAdapters: MISSING_ADAPTERS,
  }),
  route('connection|android', {
    ownerModule: 'scripts/testing/native-detox-connection-android-public-dispatch.ts',
    ownerExport: 'runAndroidDetoxConnectionAttemptForNativePilot',
    owner: runAndroidDetoxConnectionAttemptForNativePilot,
    publicModule: 'scripts/testing/native-detox-connection-android-public-dispatch.ts',
    publicExport: 'runAndroidDetoxConnectionPublicAttempt',
    publicConsumer: runAndroidDetoxConnectionPublicAttempt,
    ownerResult: 'DetoxAndroidNativePilotAttemptResult',
    publicResult: 'DetoxAndroidConnectionPublicBridgeResult',
    status: 'normalization-required',
    missingAdapters: MISSING_ADAPTERS,
  }),
  route('camera-denied|ios', {
    ownerModule: 'scripts/testing/run-ios-detox-camera-attempt.ts',
    ownerExport: 'runIosDetoxCameraAttemptForPublicDispatch',
    owner: runIosDetoxCameraAttemptForPublicDispatch,
    publicModule: 'scripts/testing/native-detox-camera-ios-verifier.ts',
    publicExport: 'verifyDetoxIosCameraPrivateEvidence',
    publicConsumer: verifyDetoxIosCameraPrivateEvidence,
    ownerResult: 'CameraRuntimeResult',
    publicResult: 'DetoxCameraOuterVerification',
    status: 'normalization-required',
    missingAdapters: MISSING_ADAPTERS,
  }),
  route('save-retry|ios', {
    ownerModule: 'scripts/testing/detox-save-retry-owned-dispatch.ts',
    ownerExport: 'runDetoxSaveRetryOnExistingOwner',
    owner: runDetoxSaveRetryOnExistingOwner,
    publicModule: 'scripts/testing/native-save-retry-public-evidence.ts',
    publicExport: 'stageNativeSaveRetryPublicEvidence',
    publicConsumer: stageNativeSaveRetryPublicEvidence,
    ownerResult: 'private save/retry owner result (inferred)',
    publicResult: 'native save/retry staging result (inferred)',
    status: 'normalization-required',
    missingAdapters: MISSING_ADAPTERS,
  }),
  route('save-retry|android', {
    ownerModule: 'scripts/testing/detox-save-retry-owned-dispatch.ts',
    ownerExport: 'runDetoxSaveRetryOnExistingOwner',
    owner: runDetoxSaveRetryOnExistingOwner,
    publicModule: 'scripts/testing/native-android-save-retry-public-evidence.ts',
    publicExport: 'stageNativeAndroidSaveRetryPublicEvidence',
    publicConsumer: stageNativeAndroidSaveRetryPublicEvidence,
    ownerResult: 'private save/retry owner result (inferred)',
    publicResult: 'android save/retry staging result (inferred)',
    status: 'normalization-required',
    missingAdapters: MISSING_ADAPTERS,
  }),
]);

const BY_KEY = new Map(BINDINGS.map((binding) => [binding.key, binding] as const));

export function requireT15DetoxActualRouteBinding(
  key: T15DetoxSharedRouteKey,
): T15DetoxActualRouteBinding {
  const binding = BY_KEY.get(key);
  if (!binding) throw new Error(`T15 Detox actual route binding is missing: ${key}`);
  if (typeof binding.owner !== 'function' || typeof binding.publicConsumer !== 'function')
    throw new Error(`T15 Detox actual route export is not callable: ${key}`);
  return binding;
}

export const T15_DETOX_ACTUAL_ROUTE_BINDINGS: readonly T15DetoxActualRouteBinding[] = BINDINGS;

/**
 * Every route normalizer must bind these facts before the shared producer can
 * pass a cold attempt to its public consumer. They are deliberately listed in
 * source so a future adapter cannot hide a missing owner/backend/fixture fact
 * behind a route-specific result type.
 */
export const T15_DETOX_OWNER_PUBLIC_REQUIRED_INPUTS = Object.freeze([
  'authenticated-owner',
  'backend-identity',
  'fixture-reset-id',
  'target-identity',
  'qualified-build-reuse',
  'absolute-deadline',
  'abort-signal',
  'ownership-windows',
  'cleanup-status',
] as const);

export type T15DetoxSharedAdapters = Readonly<{
  reset: T15DetoxResetPreparation;
  owner: T15DetoxOwner;
  consumePublic: T15DetoxPublicConsumer;
  cleanup: T15DetoxCleanup;
}>;

export type T15DetoxOwnerPublicComposition = Readonly<{
  route: T15DetoxActualRouteBinding;
  outputRoot: string;
  status: 'wired-with-caller-adapters';
  producer: ReturnType<typeof createT15DetoxSharedLifecycleProducer>;
}>;

/**
 * Attach real route normalizers to the sealed lifecycle. Every adapter is
 * required: this function has no fallback, synthetic receipt, or resource
 * acquisition path. The route functions above are retained for the caller's
 * adapter implementation and are never invoked by this factory.
 */
export function createT15DetoxOwnerPublicComposition(
  input: Readonly<{
    route: T15DetoxSharedRouteKey;
    outputRoot: string;
    adapters: T15DetoxSharedAdapters;
  }>,
): T15DetoxOwnerPublicComposition {
  const actual = requireT15DetoxActualRouteBinding(input.route);
  if (
    typeof input.adapters.reset !== 'function' ||
    typeof input.adapters.owner !== 'function' ||
    typeof input.adapters.consumePublic !== 'function' ||
    typeof input.adapters.cleanup !== 'function'
  )
    throw new Error(
      `T15 Detox ${input.route} requires reset-preparation, owner-normalizer, public-normalizer, and cleanup-ledger adapters`,
    );
  return Object.freeze({
    route: actual,
    outputRoot: input.outputRoot,
    status: 'wired-with-caller-adapters' as const,
    producer: createT15DetoxSharedLifecycleProducer({
      route: input.route,
      outputRoot: input.outputRoot,
      reset: input.adapters.reset,
      owner: input.adapters.owner,
      consumePublic: input.adapters.consumePublic,
      cleanup: input.adapters.cleanup,
    }),
  });
}

export const t15DetoxOwnerPublicCompositionContract = Object.freeze({
  routeCount: T15_DETOX_SHARED_ROUTE_KEYS.length,
  routes: T15_DETOX_SHARED_ROUTE_KEYS,
  androidCameraIncluded: false,
  actualRouteExportsRetained: true,
  sharedLifecycle: 't15-detox-cold-lifecycle',
  adapterStatus: 'caller-supplied-normalization-required',
  order: ['reset', 'owner', 'public-consumer', 'cleanup'] as const,
  requiredInputs: T15_DETOX_OWNER_PUBLIC_REQUIRED_INPUTS,
  nativeExecution: 'not-run',
  nativePassingCases: 0,
  coldAttemptDenominator: 400,
});

// Keep the imported baseline options in the source contract so Android session
// owner changes cannot silently stop being part of this composition inventory.
export type T15AndroidSessionOwnerInput = DetoxIntegratedSessionBaselineOptions;
