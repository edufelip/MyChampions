import type { NetworkStatus } from './offline.logic';

type ResolveE2ENetworkStatusOverrideInput = {
  appVariant: string | undefined;
  isDev: boolean;
  status: string | undefined;
};

function normalizeNetworkStatus(value: string | undefined): NetworkStatus | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'online' || normalized === 'offline' || normalized === 'unknown') {
    return normalized;
  }
  return null;
}

export function resolveE2ENetworkStatusOverride({
  appVariant,
  isDev,
  status,
}: ResolveE2ENetworkStatusOverrideInput): NetworkStatus | null {
  const isDevVariant = appVariant === undefined || appVariant === '' || appVariant === 'dev';
  if (!isDev || !isDevVariant) return null;
  return normalizeNetworkStatus(status);
}

type E2ENetworkStatusEventTarget = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

/**
 * Returns `candidate` narrowed to a usable DOM-style event target only when it is a real
 * browser `window` (has function-typed `addEventListener`/`removeEventListener`), otherwise
 * `null`. Native runtimes that expose a non-DOM `window` global (or none at all) must stay on
 * the NetInfo subscription path instead of attempting to bridge E2E network-status overrides.
 */
export function resolveE2ENetworkStatusEventTarget(
  candidate: unknown,
): E2ENetworkStatusEventTarget | null {
  if (candidate === null || typeof candidate !== 'object') return null;
  const maybeTarget = candidate as Partial<E2ENetworkStatusEventTarget>;
  if (
    typeof maybeTarget.addEventListener === 'function' &&
    typeof maybeTarget.removeEventListener === 'function'
  ) {
    return maybeTarget as E2ENetworkStatusEventTarget;
  }
  return null;
}
