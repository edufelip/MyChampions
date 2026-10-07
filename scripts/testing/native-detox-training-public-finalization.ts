/**
 * iOS Detox training finalization compatibility surface.
 *
 * The validation contract lives in the platform-neutral module so Android
 * training can stage its own evidence without importing the iOS dispatcher
 * boundary. Keep this re-export for existing iOS callers and tests.
 */
export * from './native-detox-training-public-finalization-contract';
