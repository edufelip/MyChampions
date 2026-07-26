export type SafeExternalUrlOptions = {
  allowInsecureLocalhost?: boolean;
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function resolveSafeExternalUrl(
  value: string | null | undefined,
  options: SafeExternalUrlOptions = {}
): string | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.username || parsed.password) return null;
  if (parsed.protocol === 'https:') return candidate;
  if (
    parsed.protocol === 'http:' &&
    options.allowInsecureLocalhost === true &&
    LOCAL_HOSTNAMES.has(parsed.hostname)
  ) {
    return candidate;
  }
  return null;
}

export function allowInsecureLocalhostForDevelopment(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}
