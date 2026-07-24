/**
 * Custom meal image upload source — injectable deps pattern.
 * Implements the pick → compress → upload pipeline for meal photos (BL-007, D-053, D-057).
 *
 * Upload target convention: meals/{mealId}/{filename}
 * - mealId may be 'new' or a UUID during create; use the value passed by the caller.
 * - authenticated owner identity is derived by the MyChampions server from the bearer token.
 * - filename is generated as a UUID + .jpg (D-029: UUIDv7; we use uuid v4 here
 *   as UUIDv7 requires an additional dependency — acceptable in this context).
 *
 * Compression is performed by expo-image-manipulator before upload (D-057, D-061):
 *   ≤ 1.5 MB, ≤ 1600 px longest side (BR-261, FR-213).
 *
 * This source is pure of Expo/RN dependencies at the function signature level —
 * all native calls are injected via deps for full unit-test coverage (TC-287).
 *
 * Refs: BL-007, D-050, D-053, D-057, D-061, D-073, FR-213, AC-424, AC-425
 *       BR-261, BR-271, TC-287
 */

import { normalizeImageUploadError, type ImageUploadErrorReason } from './image-upload.logic';

// ─── Error type ───────────────────────────────────────────────────────────────

export class ImageUploadSourceError extends Error {
  code: ImageUploadErrorReason;

  constructor(code: ImageUploadErrorReason, message: string) {
    super(message);
    this.code = code;
    this.name = 'ImageUploadSourceError';
  }
}

// ─── Progress callback ────────────────────────────────────────────────────────

/** Called with upload progress percentage (0–100) during upload. */
export type UploadProgressCallback = (progressPercent: number) => void;

// ─── Injectable deps ──────────────────────────────────────────────────────────

/**
 * All native platform calls are injected for testability.
 * Production deps are provided by makeProductionImageUploadDeps().
 */
export type ImageUploadSourceDeps = {
  /**
   * Picks an image (camera or library) and returns a local URI with
   * width and height, or null if cancelled.
   */
  pickImage: () => Promise<{ uri: string; width: number; height: number } | null>;
  /**
   * Compresses a local image URI and returns a Blob suitable for upload.
   * Target: ≤ 1.5 MB, ≤ 1600 px longest side (D-061, BR-261).
   */
  compressImage: (uri: string, width: number, height: number) => Promise<Blob>;
  /**
   * Uploads a Blob at the given server-owned upload target.
   * Calls onProgress with progress 0–100 during upload.
   * Returns the public download URL on success.
   */
  uploadBlob: (
    uploadTarget: string,
    blob: Blob,
    onProgress: UploadProgressCallback
  ) => Promise<string>;
  /**
   * Generates a unique filename for the uploaded image (e.g. UUIDv4 + .jpg).
   */
  generateFilename: () => string;
};

export type ServerImageUploadDeps = {
  getServerBaseUrl?: () => string | undefined;
  getCurrentAccessToken?: () => Promise<string | null>;
  fetchFn?: AppFetch;
};

// ─── Pick result ──────────────────────────────────────────────────────────────

export type PickAndUploadResult =
  | { kind: 'cancelled' }
  | { kind: 'done'; downloadUrl: string };

function parseMealImageUploadTarget(uploadTarget: string): { mealId: string; filename: string } {
  const match = uploadTarget.match(/^meals\/([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new ImageUploadSourceError('unknown', 'Meal image upload target is invalid.');
  }
  return {
    mealId: match[1],
    filename: match[2],
  };
}

function uploadErrorForStatus(status: number): ImageUploadErrorReason {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 413) return 'file_too_large';
  if (status === 507) return 'storage_quota';
  if (status >= 500) return 'network';
  return 'unknown';
}

export async function uploadMealImageToServer(
  uploadTarget: string,
  blob: Blob,
  onProgress: UploadProgressCallback,
  deps: ServerImageUploadDeps
): Promise<string> {
  const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
  const accessToken = await deps.getCurrentAccessToken?.();
  if (!baseUrl) {
    throw new ImageUploadSourceError('configuration', 'MyChampions server URL is required for image upload.');
  }
  if (!accessToken) {
    throw new ImageUploadSourceError('unauthorized', 'Local server auth is required for image upload.');
  }

  const { mealId, filename } = parseMealImageUploadTarget(uploadTarget);
  const requestUrl = `${baseUrl}/nutrition/custom-meal-images/${encodeURIComponent(
    mealId
  )}?filename=${encodeURIComponent(filename)}`;
  const fetchFn = deps.fetchFn ?? fetch;

  onProgress(0);

  let response: Response;
  try {
    response = await fetchFn(requestUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': blob.type || 'image/jpeg',
      },
      body: blob,
    });
  } catch (error) {
    throw new ImageUploadSourceError(
      'network',
      `Network request to upload meal image failed: ${String(error)}`
    );
  }

  if (!response.ok) {
    throw new ImageUploadSourceError(
      uploadErrorForStatus(response.status),
      `MyChampions server image upload failed with status ${response.status}.`
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ImageUploadSourceError(
      'unknown',
      `MyChampions server image upload returned invalid JSON: ${String(error)}`
    );
  }

  const url = (payload as { url?: unknown }).url;
  if (typeof url !== 'string' || url.trim().length === 0) {
    throw new ImageUploadSourceError('unknown', 'MyChampions server image upload response is missing url.');
  }

  onProgress(100);
  return url;
}

// ─── Core operation ───────────────────────────────────────────────────────────

/**
 * Full pick → compress → upload pipeline.
 *
 * 1. Calls deps.pickImage() — returns null on cancellation.
 * 2. Compresses the result via deps.compressImage().
 * 3. Uploads the blob to `meals/{mealId}/{filename}`.
 * 4. Returns the download URL.
 *
 * Throws ImageUploadSourceError with typed ImageUploadErrorReason on all failure paths.
 * Calls onProgress(0–100) during upload.
 *
 * @param mealId   - Meal ID or 'new' for unsaved meal
 * @param deps     - Injectable dependencies
 * @param onProgress - Progress callback (0–100)
 */
export async function pickAndUploadMealImage(
  mealId: string,
  deps: ImageUploadSourceDeps,
  onProgress: UploadProgressCallback
): Promise<PickAndUploadResult> {
  // Step 1: Pick image
  let picked: { uri: string; width: number; height: number } | null;
  try {
    picked = await deps.pickImage();
  } catch (err: unknown) {
    throw new ImageUploadSourceError('unknown', `Image picker failed: ${String(err)}`);
  }

  if (!picked) {
    return { kind: 'cancelled' };
  }

  // Step 2: Compress
  let blob: Blob;
  try {
    blob = await deps.compressImage(picked.uri, picked.width, picked.height);
  } catch (err: unknown) {
    const reason = normalizeImageUploadError(err);
    throw new ImageUploadSourceError(reason, `Image compression failed: ${String(err)}`);
  }

  // Check compressed size (BR-261: ≤ 1.5 MB post-compression)
  const MAX_BYTES = 1.5 * 1024 * 1024;
  if (blob.size > MAX_BYTES) {
    throw new ImageUploadSourceError(
      'file_too_large',
      `Compressed image exceeds 1.5 MB limit (${blob.size} bytes).`
    );
  }

  // Step 3: Upload
  const filename = deps.generateFilename();
  const uploadTarget = `meals/${mealId}/${filename}`;

  let downloadUrl: string;
  try {
    downloadUrl = await deps.uploadBlob(uploadTarget, blob, onProgress);
  } catch (err: unknown) {
    if (err instanceof ImageUploadSourceError) throw err;
    const reason = normalizeImageUploadError(err);
    throw new ImageUploadSourceError(reason, `Image upload failed: ${String(err)}`);
  }

  return { kind: 'done', downloadUrl };
}
