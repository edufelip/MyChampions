import { useState } from 'react';

import type { QrScannerAdapter } from './qr-scanner-adapter';

type BrowserCamera = Pick<MediaDevices, 'getUserMedia'> | null | undefined;

export function isBrowserCameraAvailable(mediaDevices: BrowserCamera): boolean {
  return typeof mediaDevices?.getUserMedia === 'function';
}

export async function requestBrowserCameraPermission(
  mediaDevices: BrowserCamera,
): Promise<boolean> {
  const getUserMedia = mediaDevices?.getUserMedia?.bind(mediaDevices);
  if (!getUserMedia) return false;
  try {
    const stream = await getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
    });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}

export function useQrScannerAdapter(): QrScannerAdapter {
  const [permissionGranted, setPermissionGranted] = useState(false);
  return {
    permissionGranted,
    isAvailable: async () => isBrowserCameraAvailable(navigator.mediaDevices),
    requestPermission: async () => {
      const granted = await requestBrowserCameraPermission(navigator.mediaDevices);
      setPermissionGranted(granted);
      return granted;
    },
  };
}
