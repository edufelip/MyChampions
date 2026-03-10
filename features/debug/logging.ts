/**
 * Shared debug logging helpers.
 *
 * Use these helpers for network/source diagnostics so logging behavior is
 * controlled by one global switch and can be reused across microservices,
 * Firebase source modules, and future integrations.
 */

function readEnvFlag(name: string): string | undefined {
  return process.env[name]?.trim().toLowerCase();
}

export function isDevLoggingEnabled(): boolean {
  const forceOn = readEnvFlag('EXPO_PUBLIC_DEBUG_LOGS') === 'true';
  const forceOff = readEnvFlag('EXPO_PUBLIC_DEBUG_LOGS') === 'false';
  if (forceOn) return true;
  if (forceOff) return false;

  const runtimeDev = (globalThis as { __DEV?: boolean }).__DEV === true;
  const variantDev = process.env['APP_VARIANT'] === 'dev';
  return runtimeDev || variantDev;
}

export function logDebug(scope: string, ...args: unknown[]): void {
  if (!isDevLoggingEnabled()) return;
  console.log(`[${scope}]`, ...args);
}

export function logNetworkDebug(scope: string, ...args: unknown[]): void {
  if (!isDevLoggingEnabled()) return;
  console.log(`[${scope}]`, ...args);
}
