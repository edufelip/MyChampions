import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const DEV_IOS_APP_ID = 'com.edufelip.mychampions.dev';
export const DEV_ANDROID_APP_ID = 'com.edufelip.mychampions.dev';

export type LocaleDiagnosticPlatform = 'ios' | 'android' | 'other';

export type LocaleDiagnosticBuildIdentity = {
  isDevRuntime: boolean;
  appVariant: string | null;
  appId: string | null;
  platform: LocaleDiagnosticPlatform;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function runtimeAppId(platform: LocaleDiagnosticPlatform): string | null {
  if (platform === 'ios') return Constants.expoConfig?.ios?.bundleIdentifier ?? null;
  if (platform === 'android') return Constants.expoConfig?.android?.package ?? null;
  return null;
}

/** Resolve the same variant/app IDs that app.config.ts embeds for native builds. */
export function readLocaleDiagnosticBuildIdentity(): LocaleDiagnosticBuildIdentity {
  const platform: LocaleDiagnosticPlatform =
    Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'other';
  const expoConfig = Constants.expoConfig;
  const embeddedConfigPresent = expoConfig !== null && expoConfig !== undefined;
  const embeddedVariant = record(expoConfig?.extra)?.['appVariant'];
  const appVariant = embeddedConfigPresent
    ? typeof embeddedVariant === 'string'
      ? embeddedVariant
      : null
    : typeof process.env.APP_VARIANT === 'string'
      ? process.env.APP_VARIANT
      : null;
  return {
    isDevRuntime: typeof __DEV__ !== 'undefined' && __DEV__ === true,
    appVariant,
    appId: runtimeAppId(platform),
    platform,
  };
}

/**
 * Fail-closed availability guard. No diagnostic flag is consulted: the
 * existing dev runtime, embedded variant and platform app ID are sufficient.
 */
export function isLocaleDiagnosticAvailable(
  identity: LocaleDiagnosticBuildIdentity = readLocaleDiagnosticBuildIdentity(),
): boolean {
  if (!identity.isDevRuntime || identity.appVariant !== 'dev') return false;
  if (identity.platform === 'ios') return identity.appId === DEV_IOS_APP_ID;
  if (identity.platform === 'android') return identity.appId === DEV_ANDROID_APP_ID;
  return false;
}
