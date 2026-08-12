/**
 * useNetworkStatus — real connectivity state via @react-native-community/netinfo.
 *
 * Returns a `NetworkStatus` compatible with `resolveOfflineDisplayState`.
 * Initial state is 'unknown' until NetInfo fires its first event.
 * On platforms where NetInfo cannot determine connectivity, falls back to 'unknown'
 * which is treated as online by the write-lock logic (optimistic default, D-041).
 *
 * Refs: D-041, D-047, D-074, FR-214, BR-272, BL-008
 */

import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

import type { NetworkStatus } from './offline.logic';
import { resolveE2ENetworkStatusOverride } from './network-status-override.logic';

/**
 * Subscribes to real device network connectivity.
 * Returns `'online'`, `'offline'`, or `'unknown'`.
 */
export function useNetworkStatus(): NetworkStatus {
  const storedE2EStatus =
    process.env.EXPO_PUBLIC_E2E_AUTH_SESSION === 'true' && typeof sessionStorage !== 'undefined'
      ? (sessionStorage.getItem('mychampions.e2e.network-status') ?? undefined)
      : undefined;
  const e2eNetworkStatusOverride = resolveE2ENetworkStatusOverride({
    appVariant: process.env.APP_VARIANT,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
    status: storedE2EStatus ?? process.env.EXPO_PUBLIC_E2E_NETWORK_STATUS,
  });
  const [status, setStatus] = useState<NetworkStatus>(e2eNetworkStatusOverride ?? 'unknown');

  useEffect(() => {
    const onE2ENetworkStatusStorage = (event: StorageEvent) => {
      if (event.key !== 'mychampions.e2e.network-status') return;

      setStatus(
        resolveE2ENetworkStatusOverride({
          appVariant: process.env.APP_VARIANT,
          isDev: typeof __DEV__ !== 'undefined' && __DEV__,
          status: event.newValue ?? undefined,
        }) ?? 'unknown',
      );
    };
    const supportsE2ENetworkStatusEvents =
      process.env.EXPO_PUBLIC_E2E_AUTH_SESSION === 'true' && typeof window !== 'undefined';

    if (supportsE2ENetworkStatusEvents) {
      window.addEventListener('storage', onE2ENetworkStatusStorage);
    }

    if (e2eNetworkStatusOverride) {
      setStatus(e2eNetworkStatusOverride);
      return () => {
        if (supportsE2ENetworkStatusEvents) {
          window.removeEventListener('storage', onE2ENetworkStatusStorage);
        }
      };
    }

    // Fetch current state immediately
    void NetInfo.fetch().then((state) => {
      setStatus(toNetworkStatus(state.isConnected));
    });

    // Subscribe to changes
    const unsubscribe = NetInfo.addEventListener((state) => {
      setStatus(toNetworkStatus(state.isConnected));
    });

    return () => {
      unsubscribe();
      if (supportsE2ENetworkStatusEvents) {
        window.removeEventListener('storage', onE2ENetworkStatusStorage);
      }
    };
  }, [e2eNetworkStatusOverride]);

  return status;
}

function toNetworkStatus(isConnected: boolean | null): NetworkStatus {
  if (isConnected === true) return 'online';
  if (isConnected === false) return 'offline';
  return 'unknown';
}
