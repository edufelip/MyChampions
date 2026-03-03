/**
 * TC-287: Image upload source unit tests.
 * All native calls (picker, compressor, uploader) are replaced with injectable fakes.
 *
 * Coverage:
 *   - ImageUploadSourceError constructor and name
 *   - pickAndUploadMealImage: missing uid throws unauthorized
 *   - pickAndUploadMealImage: picker returns null → cancelled
 *   - pickAndUploadMealImage: picker throws → unknown error
 *   - pickAndUploadMealImage: compressor throws → normalized error
 *   - pickAndUploadMealImage: compressed blob exceeds 1.5 MB → file_too_large
 *   - pickAndUploadMealImage: upload happy path → done with downloadUrl
 *   - pickAndUploadMealImage: upload throws → normalized error
 *   - pickAndUploadMealImage: upload throws ImageUploadSourceError → passthrough
 *   - pickAndUploadMealImage: progress callbacks called during upload
 *   - pickAndUploadMealImage: storage path includes uid/mealId/filename
 *   - pickAndUploadMealImage: filename comes from generateFilename()
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  pickAndUploadMealImage,
  ImageUploadSourceError,
  type ImageUploadSourceDeps,
  type UploadProgressCallback,
} from './image-upload-source';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBlob(sizeBytes: number): Blob {
  // Blob can't be constructed easily in Node — use a duck-typed object
  return { size: sizeBytes } as Blob;
}

function makeDeps(overrides: Partial<ImageUploadSourceDeps> = {}): ImageUploadSourceDeps {
  return {
    pickImage: async () => ({ uri: 'file://photo.jpg', width: 800, height: 600 }),
    compressImage: async () => makeBlob(500_000), // 500 KB — within limit
    uploadBlob: async (_path, _blob, onProgress) => {
      onProgress(50);
      onProgress(100);
      return 'https://storage.example.com/photo.jpg';
    },
    generateFilename: () => 'test-uuid.jpg',
    ...overrides,
  };
}

// ─── ImageUploadSourceError ───────────────────────────────────────────────────

describe('ImageUploadSourceError', () => {
  it('has correct name and code', () => {
    const err = new ImageUploadSourceError('network', 'test message');
    assert.equal(err.name, 'ImageUploadSourceError');
    assert.equal(err.code, 'network');
    assert.equal(err.message, 'test message');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof ImageUploadSourceError);
  });

  it('stores all error reason codes', () => {
    const codes = ['network', 'storage_quota', 'file_too_large', 'unauthorized', 'unknown'] as const;
    for (const code of codes) {
      const err = new ImageUploadSourceError(code, `error: ${code}`);
      assert.equal(err.code, code);
    }
  });
});

// ─── pickAndUploadMealImage ───────────────────────────────────────────────────

describe('pickAndUploadMealImage — uid guard', () => {
  it('throws unauthorized when uid is empty string', async () => {
    const deps = makeDeps();
    await assert.rejects(
      pickAndUploadMealImage('', 'meal-1', deps, () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ImageUploadSourceError);
        assert.equal(err.code, 'unauthorized');
        return true;
      }
    );
  });
});

describe('pickAndUploadMealImage — picker outcomes', () => {
  it('returns cancelled when pickImage returns null', async () => {
    const deps = makeDeps({ pickImage: async () => null });
    const result = await pickAndUploadMealImage('user-123', 'meal-1', deps, () => {});
    assert.deepEqual(result, { kind: 'cancelled' });
  });

  it('throws unknown when pickImage throws', async () => {
    const deps = makeDeps({ pickImage: async () => { throw new Error('picker crashed'); } });
    await assert.rejects(
      pickAndUploadMealImage('user-123', 'meal-1', deps, () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ImageUploadSourceError);
        assert.equal(err.code, 'unknown');
        return true;
      }
    );
  });
});

describe('pickAndUploadMealImage — compression outcomes', () => {
  it('throws normalized error when compressImage throws with network code', async () => {
    const deps = makeDeps({
      compressImage: async () => { throw { code: 'network_error', message: 'network' }; },
    });
    await assert.rejects(
      pickAndUploadMealImage('user-123', 'meal-1', deps, () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ImageUploadSourceError);
        assert.equal(err.code, 'network');
        return true;
      }
    );
  });

  it('throws unknown when compressImage throws unrecognized error', async () => {
    const deps = makeDeps({
      compressImage: async () => { throw { weirdProp: true }; },
    });
    await assert.rejects(
      pickAndUploadMealImage('user-123', 'meal-1', deps, () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ImageUploadSourceError);
        assert.equal(err.code, 'unknown');
        return true;
      }
    );
  });

  it('throws file_too_large when compressed blob exceeds 1.5 MB', async () => {
    const deps = makeDeps({ compressImage: async () => makeBlob(2_000_000) }); // 2 MB
    await assert.rejects(
      pickAndUploadMealImage('user-123', 'meal-1', deps, () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ImageUploadSourceError);
        assert.equal(err.code, 'file_too_large');
        return true;
      }
    );
  });

  it('passes when compressed blob is exactly at limit (1.5 MB)', async () => {
    const deps = makeDeps({ compressImage: async () => makeBlob(1.5 * 1024 * 1024) });
    const result = await pickAndUploadMealImage('user-123', 'meal-1', deps, () => {});
    assert.equal(result.kind, 'done');
  });

  it('passes when compressed blob is just under limit', async () => {
    const deps = makeDeps({ compressImage: async () => makeBlob(1.5 * 1024 * 1024 - 1) });
    const result = await pickAndUploadMealImage('user-123', 'meal-1', deps, () => {});
    assert.equal(result.kind, 'done');
  });
});

describe('pickAndUploadMealImage — upload outcomes', () => {
  it('returns done with downloadUrl on success', async () => {
    const deps = makeDeps();
    const result = await pickAndUploadMealImage('user-123', 'meal-1', deps, () => {});
    assert.deepEqual(result, {
      kind: 'done',
      downloadUrl: 'https://storage.example.com/photo.jpg',
    });
  });

  it('throws normalized error when uploadBlob throws with storage/quota-exceeded', async () => {
    const deps = makeDeps({
      uploadBlob: async () => { throw { code: 'storage/quota-exceeded', message: 'quota exceeded' }; },
    });
    await assert.rejects(
      pickAndUploadMealImage('user-123', 'meal-1', deps, () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ImageUploadSourceError);
        assert.equal(err.code, 'storage_quota');
        return true;
      }
    );
  });

  it('throws normalized error when uploadBlob throws with storage/unauthorized', async () => {
    const deps = makeDeps({
      uploadBlob: async () => { throw { code: 'storage/unauthorized', message: 'unauthorized' }; },
    });
    await assert.rejects(
      pickAndUploadMealImage('user-123', 'meal-1', deps, () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ImageUploadSourceError);
        assert.equal(err.code, 'unauthorized');
        return true;
      }
    );
  });

  it('passes through ImageUploadSourceError from uploadBlob directly', async () => {
    const original = new ImageUploadSourceError('network', 'upload network fail');
    const deps = makeDeps({
      uploadBlob: async () => { throw original; },
    });
    await assert.rejects(
      pickAndUploadMealImage('user-123', 'meal-1', deps, () => {}),
      (err: unknown) => {
        assert.ok(err === original);
        return true;
      }
    );
  });

  it('throws unknown for unrecognized upload error', async () => {
    const deps = makeDeps({
      uploadBlob: async () => { throw { randomProp: 42 }; },
    });
    await assert.rejects(
      pickAndUploadMealImage('user-123', 'meal-1', deps, () => {}),
      (err: unknown) => {
        assert.ok(err instanceof ImageUploadSourceError);
        assert.equal(err.code, 'unknown');
        return true;
      }
    );
  });
});

describe('pickAndUploadMealImage — progress callbacks', () => {
  it('receives progress events during upload', async () => {
    const progressEvents: number[] = [];
    const deps = makeDeps({
      uploadBlob: async (_path, _blob, onProgress) => {
        onProgress(10);
        onProgress(50);
        onProgress(100);
        return 'https://storage.example.com/photo.jpg';
      },
    });
    await pickAndUploadMealImage('user-123', 'meal-1', deps, (p) => progressEvents.push(p));
    assert.deepEqual(progressEvents, [10, 50, 100]);
  });
});

describe('pickAndUploadMealImage — storage path', () => {
  it('constructs correct storage path with uid, mealId, and filename', async () => {
    const capturedPaths: string[] = [];
    const deps = makeDeps({
      generateFilename: () => 'my-uuid.jpg',
      uploadBlob: async (path, _blob, onProgress) => {
        capturedPaths.push(path);
        onProgress(100);
        return 'https://storage.example.com/photo.jpg';
      },
    });
    await pickAndUploadMealImage('user-abc', 'meal-xyz', deps, () => {});
    assert.equal(capturedPaths.length, 1);
    assert.equal(capturedPaths[0], 'users/user-abc/meals/meal-xyz/my-uuid.jpg');
  });

  it('uses new as mealId when meal is not yet saved', async () => {
    const capturedPaths: string[] = [];
    const deps = makeDeps({
      generateFilename: () => 'new-photo.jpg',
      uploadBlob: async (path, _blob, onProgress) => {
        capturedPaths.push(path);
        onProgress(100);
        return 'https://storage.example.com/photo.jpg';
      },
    });
    await pickAndUploadMealImage('user-abc', 'new', deps, () => {});
    assert.equal(capturedPaths[0], 'users/user-abc/meals/new/new-photo.jpg');
  });

  it('uses filename from generateFilename()', async () => {
    const capturedPaths: string[] = [];
    const deps = makeDeps({
      generateFilename: () => 'specific-uuid-123.jpg',
      uploadBlob: async (path, _blob, onProgress) => {
        capturedPaths.push(path);
        onProgress(100);
        return 'https://example.com/photo.jpg';
      },
    });
    await pickAndUploadMealImage('uid', 'mid', deps, () => {});
    assert.ok(capturedPaths[0]?.endsWith('specific-uuid-123.jpg'));
  });
});
