import assert from 'node:assert/strict';

/** Shared binding/staging rule: Detox is added only for Android. */
export function requireNativeConnectionEngineForPlatform(
  platform: 'ios' | 'android',
  engine: 'maestro' | 'detox',
): 'maestro' | 'detox' {
  assert(
    engine === 'maestro' || engine === 'detox',
    'Connection evidence engine is outside the supported native engines',
  );
  if (engine === 'detox' && platform !== 'android')
    throw new Error('Detox connection evidence is not enabled for iOS');
  return engine;
}
