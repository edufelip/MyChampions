import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { defaultAppFetch } from './default-app-fetch';

const auditedSourceFiles = [
  'features/connections/connection-source.ts',
  'features/training/workout-log-source.ts',
  'features/nutrition/water-tracking-source.ts',
  'features/nutrition/custom-meal-source.ts',
  'features/nutrition/use-image-upload.ts',
  'features/nutrition/image-upload-source.ts',
  'features/nutrition/meal-photo-analysis-source.ts',
  'features/nutrition/food-search-source.ts',
  'features/professional/professional-source.ts',
  'features/professional/student-tracking-review-source.ts',
  'features/plans/exercise-service-source.ts',
] as const;

describe('default application fetch', () => {
  it('late-binds global fetch and preserves its browser global receiver', async () => {
    const originalFetch = globalThis.fetch;
    let observedReceiver: unknown;
    let observedInput: unknown;

    globalThis.fetch = (async function (
      this: unknown,
      input: string | URL | Request
    ): Promise<Response> {
      observedReceiver = this;
      observedInput = input;
      return new Response(null, { status: 204 });
    }) as typeof globalThis.fetch;

    try {
      const response = await defaultAppFetch('https://example.test/receiver');

      assert.equal(response.status, 204);
      assert.equal(observedReceiver, globalThis);
      assert.equal(observedInput, 'https://example.test/receiver');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps audited production boundaries off raw or method-bound fetch dependencies', () => {
    for (const relativePath of auditedSourceFiles) {
      const source = readFileSync(join(process.cwd(), relativePath), 'utf8');

      assert.doesNotMatch(
        source,
        /\bfetchFn\s*:\s*(?:globalThis\.)?fetch\b/,
        `${relativePath} must use the shared receiver-safe default`
      );
      assert.doesNotMatch(
        source,
        /\?\?\s*(?:globalThis\.)?fetch\b/,
        `${relativePath} must not fall back to a detached global fetch`
      );
      assert.doesNotMatch(
        source,
        /\bdeps\.fetchFn\s*\(/,
        `${relativePath} must invoke injected fetch functions standalone`
      );
    }
  });
});
