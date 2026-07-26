import { CameraView, useCameraPermissions } from 'expo-camera';

export type QrScannerAdapter = {
  permissionGranted: boolean;
  isAvailable: () => Promise<boolean>;
  requestPermission: () => Promise<boolean>;
};

export function useQrScannerAdapter(): QrScannerAdapter {
  const [permission, requestPermission] = useCameraPermissions();
  return {
    permissionGranted: permission?.granted === true,
    isAvailable: () => CameraView.isAvailableAsync(),
    requestPermission: async () => (await requestPermission()).granted,
  };
}
