/**
 * React hook for custom meal image upload with progress tracking.
 * Manages the full pick → compress → upload state machine (BL-007, D-053, D-057, D-073).
 *
 * Wires expo-image-picker (camera + library via Alert action sheet),
 * expo-image-manipulator for client-side JPEG compression, and
 * the local MyChampions server.
 *
 * Exposes pickAndUpload(mealId), retry(), and clear() for SC-214.
 *
 * Refs: BL-007, D-050, D-053, D-057, D-061, D-073, FR-213, AC-424, AC-425
 *       BR-261, BR-271, TC-287
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import type { AuthUser } from '@/features/auth/auth-user';
import { resolveE2EAuthSessionSourceOverride } from '@/features/auth/e2e-auth-session';
import { getValidServerAccessToken } from '@/features/auth/server-auth-source';
import { defaultAppFetch } from '@/features/platform/default-app-fetch';
import { photoPickerAdapter } from '@/features/platform/photo-picker-adapter';
import { useTranslation } from '@/localization';
import {
  normalizeImageUploadError,
  type ImageUploadState,
} from './image-upload.logic';
import {
  pickAndUploadMealImage,
  ImageUploadSourceError,
  uploadMealImageToServer,
  type ImageUploadSourceDeps,
  type UploadProgressCallback,
} from './image-upload-source';

// ─── Constants ────────────────────────────────────────────────────────────────

// ─── Production picker ────────────────────────────────────────────────────────

/**
 * Presents an action sheet (Alert) and opens the appropriate native picker.
 * Returns the selected asset info or null on cancellation.
 */
/**
 * Compresses a local image URI and returns a Blob.
 * Resizes to ≤ 1600 px longest side, compresses at 0.75 JPEG quality (D-061, BR-261).
 */
async function productionCompressImage(
  uri: string,
  width: number,
  height: number
): Promise<Blob> {
  return photoPickerAdapter.compressToBlob({ uri, width, height });
}

/**
 * Uploads a Blob to the MyChampions server with progress tracking.
 */
async function productionUploadBlob(
  uploadTarget: string,
  blob: Blob,
  onProgress: UploadProgressCallback
): Promise<string> {
  return uploadMealImageToServer(uploadTarget, blob, onProgress, {
    getServerBaseUrl: resolveServerBaseUrl,
    getCurrentAccessToken: () => getValidServerAccessToken(),
    fetchFn: defaultAppFetch,
  });
}

/** Generates a simple unique filename (timestamp + random suffix). */
function generateFilename(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${random}.jpg`;
}

function resolveServerBaseUrl(): string | undefined {
  let expoExtra: unknown;
  try {
    const Constants = require('expo-constants') as {
      default?: { expoConfig?: { extra?: unknown } };
      expoConfig?: { extra?: unknown };
    };
    expoExtra = (Constants.default ?? Constants).expoConfig?.extra;
  } catch {
    expoExtra = undefined;
  }

  const extra = (expoExtra ?? {}) as {
    server?: {
      baseUrl?: string;
    };
  };
  return extra.server?.baseUrl?.trim() || process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL?.trim();
}

// ─── Production deps ──────────────────────────────────────────────────────────

const E2E_IMAGE_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAI0lEQVR4nGPQ25j9XyhowX9yaQZKNINohlEXjLpg1AWDxAUAJPQmH5CACa8AAAAASUVORK5CYII=';

const e2eImageUploadDeps: ImageUploadSourceDeps = {
  pickImage: async () => ({ uri: 'file://e2e-meal-photo.jpg', width: 800, height: 600 }),
  compressImage: async () => ({ size: 256 } as Blob),
  uploadBlob: async (_storagePath, _blob, onProgress) => {
    onProgress(35);
    onProgress(100);
    return E2E_IMAGE_DATA_URI;
  },
  generateFilename: () => 'e2e-meal-photo.jpg',
};

function getE2EImageUploadDeps(): ImageUploadSourceDeps | null {
  const override = resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });

  if (!override || process.env.EXPO_PUBLIC_E2E_IMAGE_UPLOAD_FIXTURE !== 'success') {
    return null;
  }

  return e2eImageUploadDeps;
}

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
 * @param user - Auth user from useAuthSession().currentUser.
 *   Upload is blocked when user is null.
 * @param deps - Injectable deps (override in tests). Defaults to production deps.
 */
export function useImageUpload(
  user: AuthUser | null,
  deps?: ImageUploadSourceDeps
): UseImageUploadResult {
  const { t } = useTranslation();
  const localizedProductionDeps = useMemo<ImageUploadSourceDeps>(
    () => ({
      pickImage: () =>
        photoPickerAdapter.pickPhoto({
          title: t('photo_picker.title'),
          body: t('photo_picker.body'),
          takePhoto: t('photo_picker.take_photo'),
          chooseFromLibrary: t('photo_picker.choose_from_library'),
          cancel: t('common.cta.cancel'),
        }),
      compressImage: productionCompressImage,
      uploadBlob: productionUploadBlob,
      generateFilename,
    }),
    [t]
  );
  const resolvedDeps = deps ?? getE2EImageUploadDeps() ?? localizedProductionDeps;
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
        const result = await pickAndUploadMealImage(mealId, resolvedDeps, onProgress);

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
    [user, resolvedDeps]
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
