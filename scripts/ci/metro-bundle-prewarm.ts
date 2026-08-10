export type NativeMetroPlatform = 'ios' | 'android';

export const DEFAULT_METRO_BUNDLE_PREWARM_TIMEOUT_MS = 240_000;

export type MetroBundlePrewarmOptions = {
  port: number;
  platform: NativeMetroPlatform;
  appId: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function createMetroBundlePrewarmUrl(
  options: Pick<MetroBundlePrewarmOptions, 'port' | 'platform' | 'appId'>,
): string {
  const url = new URL(`http://127.0.0.1:${options.port}/.expo/.virtual-metro-entry.bundle`);
  const searchParams = new URLSearchParams({
    platform: options.platform,
    dev: 'true',
    lazy: 'true',
    minify: 'false',
    modulesOnly: 'false',
    runModule: 'true',
    app: options.appId,
    excludeSource: 'true',
    sourcePaths: 'url-server',
  });
  if (options.platform === 'ios') {
    searchParams.set('inlineSourceMap', 'false');
  }
  url.search = searchParams.toString();
  return url.toString();
}

export async function prewarmMetroBundle(options: MetroBundlePrewarmOptions): Promise<number> {
  const url = createMetroBundlePrewarmUrl(options);
  const response = await (options.fetchImpl ?? fetch)(url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_METRO_BUNDLE_PREWARM_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Metro bundle prewarm failed with HTTP ${response.status} at ${url}`);
  }
  if (!response.body) {
    throw new Error(`Metro bundle prewarm returned no body at ${url}`);
  }

  const reader = response.body.getReader();
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
  }
  if (byteLength === 0) {
    throw new Error(`Metro bundle prewarm returned an empty body at ${url}`);
  }
  return byteLength;
}
