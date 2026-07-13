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
