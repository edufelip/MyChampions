/**
 * The only current-Q boundary for the Android Detox route. Every export below
 * resolves to a checked-in sibling module in the composed current-Q replay;
 * the packet carries only the route delta and does not copy a helper tree.
 */
export {
  ANDROID_CAMERA_ASSERTION_IDS,
  ANDROID_CAMERA_SCENARIO,
  androidCameraSelectionHash,
} from './native-camera-android-contract';
export { requireNativePilotAssertions, type NativePilotSelection } from './native-pilot-contract';
export type { AndroidCameraSqlSourceReceipt } from './native-camera-android-observation';
export { requireAndroidCameraSqlEvidence } from './native-camera-android-observation';
export type { ProxyObservation } from './owned-api-proxy';
export { writeAndroidCameraSqlSourceReceipts } from './native-camera-android-sql-source';
export {
  requireConnectionSnapshot,
  type ConnectionSnapshotExpectedIdentity,
} from './native-connection-snapshot';
export type { NativeRequestBodyCaptureReceipt } from './owned-api-proxy';
export type { OwnedFixtures } from './owned-session';
export { readOwnedAndroidBoundedFile } from './native-android-session-adapter';
export { androidMetroPreference, assertAndroidReverseMappings } from './android-build-identity';
export { inspectProcessIdentity } from './owned-process-group';
export type {
  DetoxAndroidSessionStorageBinding,
  DetoxAndroidSessionStorageTarget,
} from './detox-android-session-storage-producer';
export {
  createOwnedAndroidDetoxConnectionProducer,
  requireAndroidDetoxCleanupResult,
  type AndroidDetoxConnectionProducer,
  type AndroidDetoxCameraOwnedTarget,
} from './detox-android-connection-producer';
export {
  createAndroidDetoxSessionOwnedChildDirectory,
  type AndroidDetoxSessionDirectoryIdentity,
} from './native-detox-android-session-public-staging';
export {
  buildDetoxVerifiedBinaryEnvironment,
  runDetoxConnectionDriverCleanup,
  type DriverReport,
} from './detox-integrated-connection-driver';
export {
  loadAndroidDetoxQualifiedBuild,
  type DetoxAndroidBuildLoaderInput,
} from './native-detox-connection-android-public-dispatch';
export {
  ownedDetoxBaselineFactories,
  requireDetoxBuildInstrumentation,
  type DetoxBaselineBuildInstrumentation,
  type DetoxBaselineFactories,
} from './detox-integrated-session-baseline';
export { startOwnedNativeCommand } from './owned-native-command';
export {
  readOwnedDetoxConnectionFile,
  readOwnedDetoxConnectionEvidence,
  writeAtomicDetoxConnectionBytes,
  ensureDetoxConnectionArtifactRoot,
} from './detox-connection-evidence';
export {
  writeAndroidCameraAnchoredFile,
  type AndroidCameraAnchoredPrivateFile,
} from './native-android-camera-public-staging';
export { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';
export type { ColdResetPreparationExpectation } from './t15-cold-ios-reset-producer';
