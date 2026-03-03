/**
 * Firebase Cloud Storage image upload source — injectable deps pattern.
 * Implements the pick → compress → upload pipeline for meal photos (BL-007, D-053, D-057).
 *
 * Storage path convention: users/{uid}/meals/{mealId}/{filename}
 * - mealId may be 'new' or a UUID during create; use the value passed by the caller.
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
   * Uploads a Blob to Firebase Storage at the given path.
   * Calls onProgress with progress 0–100 during upload.
   * Returns the public download URL on success.
   */
  uploadBlob: (
    storagePath: string,
    blob: Blob,
    onProgress: UploadProgressCallback
  ) => Promise<string>;
  /**
   * Generates a unique filename for the uploaded image (e.g. UUIDv4 + .jpg).
   */
  generateFilename: () => string;
};

// ─── Pick result ──────────────────────────────────────────────────────────────

export type PickAndUploadResult =
  | { kind: 'cancelled' }
  | { kind: 'done'; downloadUrl: string };

// ─── Core operation ───────────────────────────────────────────────────────────

/**
 * Full pick → compress → upload pipeline.
 *
 * 1. Calls deps.pickImage() — returns null on cancellation.
 * 2. Compresses the result via deps.compressImage().
 * 3. Uploads the blob to `users/{uid}/meals/{mealId}/{filename}`.
 * 4. Returns the download URL.
 *
 * Throws ImageUploadSourceError with typed ImageUploadErrorReason on all failure paths.
 * Calls onProgress(0–100) during upload.
 *
 * @param uid      - Firebase Auth UID (route: users/{uid}/meals/…)
 * @param mealId   - Meal ID or 'new' for unsaved meal
 * @param deps     - Injectable dependencies
 * @param onProgress - Progress callback (0–100)
 */
export async function pickAndUploadMealImage(
  uid: string,
  mealId: string,
  deps: ImageUploadSourceDeps,
  onProgress: UploadProgressCallback
): Promise<PickAndUploadResult> {
  if (!uid) {
    throw new ImageUploadSourceError('unauthorized', 'User UID is required for image upload.');
  }

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
  const storagePath = `users/${uid}/meals/${mealId}/${filename}`;

  let downloadUrl: string;
  try {
    downloadUrl = await deps.uploadBlob(storagePath, blob, onProgress);
  } catch (err: unknown) {
    if (err instanceof ImageUploadSourceError) throw err;
    const reason = normalizeImageUploadError(err);
    throw new ImageUploadSourceError(reason, `Upload to Firebase Storage failed: ${String(err)}`);
  }

  return { kind: 'done', downloadUrl };
}
