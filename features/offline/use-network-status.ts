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

/**
 * Subscribes to real device network connectivity.
 * Returns `'online'`, `'offline'`, or `'unknown'`.
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>('unknown');

  useEffect(() => {
    // Fetch current state immediately
    void NetInfo.fetch().then((state) => {
      setStatus(toNetworkStatus(state.isConnected));
    });

    // Subscribe to changes
    const unsubscribe = NetInfo.addEventListener((state) => {
      setStatus(toNetworkStatus(state.isConnected));
    });

    return unsubscribe;
  }, []);

  return status;
}

function toNetworkStatus(isConnected: boolean | null): NetworkStatus {
  if (isConnected === true) return 'online';
  if (isConnected === false) return 'offline';
  return 'unknown';
}
