import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMetroBundlePrewarmUrl,
  DEFAULT_METRO_BUNDLE_PREWARM_TIMEOUT_MS,
  prewarmMetroBundle,
} from '@/scripts/ci/metro-bundle-prewarm';

test('Metro prewarm URLs match the native Expo development bundle contracts', () => {
  assert.equal(DEFAULT_METRO_BUNDLE_PREWARM_TIMEOUT_MS, 240_000);

  const iosUrl = new URL(
    createMetroBundlePrewarmUrl({
      port: 8081,
      platform: 'ios',
      appId: 'com.edufelip.mychampions.dev',
    })
  );
  const androidUrl = new URL(
    createMetroBundlePrewarmUrl({
      port: 8081,
      platform: 'android',
      appId: 'com.edufelip.mychampions.dev',
    })
  );

  assert.equal(iosUrl.origin, 'http://127.0.0.1:8081');
  assert.equal(iosUrl.pathname, '/.expo/.virtual-metro-entry.bundle');
  assert.deepEqual(Object.fromEntries(iosUrl.searchParams), {
    platform: 'ios',
    dev: 'true',
    lazy: 'true',
    minify: 'false',
    modulesOnly: 'false',
    runModule: 'true',
    app: 'com.edufelip.mychampions.dev',
    excludeSource: 'true',
    sourcePaths: 'url-server',
    inlineSourceMap: 'false',
  });
  assert.equal(androidUrl.origin, 'http://127.0.0.1:8081');
  assert.equal(androidUrl.pathname, '/.expo/.virtual-metro-entry.bundle');
  assert.deepEqual(Object.fromEntries(androidUrl.searchParams), {
    platform: 'android',
    dev: 'true',
    lazy: 'true',
    minify: 'false',
    modulesOnly: 'false',
    runModule: 'true',
    app: 'com.edufelip.mychampions.dev',
    excludeSource: 'true',
    sourcePaths: 'url-server',
  });
});

test('Metro prewarm waits for the complete bundle body before resolving', async () => {
  let releaseBody!: () => void;
  const bodyReleased = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  let resolved = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      await bodyReleased;
      controller.enqueue(new Uint8Array([3, 4, 5]));
      controller.close();
    },
  });
  const prewarm = prewarmMetroBundle({
    port: 8081,
    platform: 'android',
    appId: 'com.edufelip.mychampions.dev',
    fetchImpl: async () => new Response(stream, { status: 200 }),
  }).then((byteLength) => {
    resolved = true;
    return byteLength;
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(resolved, false);
  releaseBody();
  assert.equal(await prewarm, 5);
});

test('Metro prewarm fails closed on response and body errors', async () => {
  await assert.rejects(
    prewarmMetroBundle({
      port: 8081,
      platform: 'ios',
      appId: 'com.edufelip.mychampions.dev',
      fetchImpl: async () => new Response('failed', { status: 503 }),
    }),
    /HTTP 503/
  );
  await assert.rejects(
    prewarmMetroBundle({
      port: 8081,
      platform: 'android',
      appId: 'com.edufelip.mychampions.dev',
      fetchImpl: async () => new Response(null, { status: 200 }),
    }),
    /returned no body/
  );
  await assert.rejects(
    prewarmMetroBundle({
      port: 8081,
      platform: 'android',
      appId: 'com.edufelip.mychampions.dev',
      fetchImpl: async () => new Response('', { status: 200 }),
    }),
    /returned an empty body/
  );
  await assert.rejects(
    prewarmMetroBundle({
      port: 8081,
      platform: 'ios',
      appId: 'com.edufelip.mychampions.dev',
      fetchImpl: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.error(new Error('connection reset'));
            },
          }),
          { status: 200 }
        ),
    }),
    /connection reset/
  );
});

test('Metro prewarm aborts a stalled request at its bounded timeout', async () => {
  await assert.rejects(
    prewarmMetroBundle({
      port: 8081,
      platform: 'ios',
      appId: 'com.edufelip.mychampions.dev',
      timeoutMs: 10,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error('prewarm request did not receive an abort signal'));
            return;
          }
          const rejectWithAbortReason = () => reject(signal.reason);
          if (signal.aborted) {
            rejectWithAbortReason();
            return;
          }
          signal.addEventListener('abort', rejectWithAbortReason, { once: true });
        }),
    }),
    (error: unknown) =>
      error instanceof Error &&
      error.name === 'TimeoutError' &&
      /timeout/i.test(error.message)
  );
});
