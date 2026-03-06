/**
 * React hook for Firebase Cloud Storage image upload with progress tracking.
 * Manages the full pick → compress → upload state machine (BL-007, D-053, D-057, D-073).
 *
 * Wires expo-image-picker (camera + library via Alert action sheet),
 * expo-image-manipulator for client-side JPEG compression, and
 * Firebase uploadBytesResumable for progress-aware upload.
 *
 * Exposes pickAndUpload(mealId), retry(), and clear() for SC-214.
 *
 * Refs: BL-007, D-050, D-053, D-057, D-061, D-073, FR-213, AC-424, AC-425
 *       BR-261, BR-271, TC-287
 */

import { Alert } from 'react-native';
import { useCallback, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import type { User } from 'firebase/auth';

import { getFirebaseStorage } from '@/features/auth/firebase';
import {
  normalizeImageUploadError,
  type ImageUploadState,
} from './image-upload.logic';
import {
  pickAndUploadMealImage,
  ImageUploadSourceError,
  type ImageUploadSourceDeps,
  type UploadProgressCallback,
} from './image-upload-source';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_DIMENSION_PX = 1600;
const JPEG_QUALITY = 0.75;

// ─── Production picker ────────────────────────────────────────────────────────

/**
 * Presents an action sheet (Alert) and opens the appropriate native picker.
 * Returns the selected asset info or null on cancellation.
 */
function productionPickImage(): Promise<{ uri: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Upload Image',
      'Choose a photo source',
      [
        {
          text: 'Take Photo',
          onPress: async () => {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) {
              resolve(null);
              return;
            }
            const result = await ImagePicker.launchCameraAsync({
              mediaTypes: 'images',
              quality: 1,
            });
            if (result.canceled || !result.assets[0]) {
              resolve(null);
              return;
            }
            const asset = result.assets[0];
            resolve({
              uri: asset.uri,
              width: asset.width ?? MAX_DIMENSION_PX,
              height: asset.height ?? MAX_DIMENSION_PX,
            });
          },
        },
        {
          text: 'Choose from Library',
          onPress: async () => {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
              resolve(null);
              return;
            }
            const result = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: 'images',
              quality: 1,
            });
            if (result.canceled || !result.assets[0]) {
              resolve(null);
              return;
            }
            const asset = result.assets[0];
            resolve({
              uri: asset.uri,
              width: asset.width ?? MAX_DIMENSION_PX,
              height: asset.height ?? MAX_DIMENSION_PX,
            });
          },
        },
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => resolve(null),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

/**
 * Compresses a local image URI and returns a Blob.
 * Resizes to ≤ 1600 px longest side, compresses at 0.75 JPEG quality (D-061, BR-261).
 */
async function productionCompressImage(
  uri: string,
  width: number,
  height: number
): Promise<Blob> {
  const longestSide = Math.max(width, height);
  const actions: ImageManipulator.Action[] = [];

  if (longestSide > MAX_DIMENSION_PX) {
    const scale = MAX_DIMENSION_PX / longestSide;
    actions.push({
      resize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
    });
  }

  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: JPEG_QUALITY,
    format: ImageManipulator.SaveFormat.JPEG,
    base64: false,
  });

  const response = await fetch(result.uri);
  return response.blob();
}

/**
 * Uploads a Blob to Firebase Storage with progress tracking.
 * Uses uploadBytesResumable so progress events are emitted during transfer.
 */
async function productionUploadBlob(
  storagePath: string,
  blob: Blob,
  onProgress: UploadProgressCallback
): Promise<string> {
  const storage = getFirebaseStorage();
  const storageRef = ref(storage, storagePath);

  return new Promise<string>((resolve, reject) => {
    const uploadTask = uploadBytesResumable(storageRef, blob, { contentType: 'image/jpeg' });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        onProgress(Math.round(progress));
      },
      (error) => {
        reject(error);
      },
      async () => {
        try {
          const url = await getDownloadURL(uploadTask.snapshot.ref);
          resolve(url);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

/** Generates a simple unique filename (timestamp + random suffix). */
function generateFilename(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${random}.jpg`;
}

// ─── Production deps ──────────────────────────────────────────────────────────

const productionDeps: ImageUploadSourceDeps = {
  pickImage: productionPickImage,
  compressImage: productionCompressImage,
  uploadBlob: productionUploadBlob,
  generateFilename,
};

// ─── Hook result ──────────────────────────────────────────────────────────────

export type UseImageUploadResult = {
  /** Current upload state (idle | uploading | done | failed). */
  uploadState: ImageUploadState;
  /**
   * Opens the image picker action sheet and uploads the selected image.
   * Transitions: idle → uploading → done | failed.
   * No-op if user is not authenticated.
   */
  pickAndUpload: (mealId: string) => Promise<void>;
  /**
   * Retries the last upload if the current state is 'failed' and retryable.
   * No-op in other states.
   */
  retry: () => Promise<void>;
  /**
   * Resets upload state back to idle (removes photo).
   */
  clear: () => void;
  /**
   * Hydrates upload state from an already persisted remote image URL.
   * Used by edit flows so image UI reflects existing meal image.
   */
  hydrateExisting: (url: string | null | undefined) => void;
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param user - Firebase Auth User from useAuthSession().currentUser.
 *   Upload is blocked when user is null.
 * @param deps - Injectable deps (override in tests). Defaults to production deps.
 */
export function useImageUpload(
  user: User | null,
  deps: ImageUploadSourceDeps = productionDeps
): UseImageUploadResult {
  const [uploadState, setUploadState] = useState<ImageUploadState>({ kind: 'idle' });
  // Store last mealId so retry can re-run the same upload
  const lastMealIdRef = useRef<string | null>(null);

  const doUpload = useCallback(
    async (mealId: string) => {
      if (!user) {
        setUploadState({ kind: 'failed', reason: 'unauthorized' });
        return;
      }

      lastMealIdRef.current = mealId;
      setUploadState({ kind: 'uploading', progressPercent: 0 });

      const onProgress = (progressPercent: number) => {
        setUploadState({ kind: 'uploading', progressPercent });
      };

      try {
        const result = await pickAndUploadMealImage(user.uid, mealId, deps, onProgress);

        if (result.kind === 'cancelled') {
          setUploadState({ kind: 'idle' });
          return;
        }

        setUploadState({ kind: 'done', url: result.downloadUrl });
      } catch (err: unknown) {
        const reason = err instanceof ImageUploadSourceError
          ? err.code
          : normalizeImageUploadError(err);
        setUploadState({ kind: 'failed', reason });
      }
    },
    [user, deps]
  );

  const pickAndUpload = useCallback(
    async (mealId: string) => {
      await doUpload(mealId);
    },
    [doUpload]
  );

  const retry = useCallback(async () => {
    if (uploadState.kind !== 'failed') return;
    const mealId = lastMealIdRef.current ?? 'new';
    await doUpload(mealId);
  }, [uploadState.kind, doUpload]);

  const clear = useCallback(() => {
    setUploadState({ kind: 'idle' });
    lastMealIdRef.current = null;
  }, []);

  const hydrateExisting = useCallback((url: string | null | undefined) => {
    if (typeof url !== 'string' || url.trim().length === 0) {
      setUploadState({ kind: 'idle' });
      return;
    }

    setUploadState({ kind: 'done', url });
  }, []);

  return { uploadState, pickAndUpload, retry, clear, hydrateExisting };
}
