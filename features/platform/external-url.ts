export type SafeExternalUrlOptions = {
  allowInsecureLocalhost?: boolean;
  // Restricts accepted HTTPS URLs to this hostname and its subdomains. Omit
  // for callers whose URL is operator-configured (e.g. via an env var) rather
  // than reachable through end-user/attacker-controlled input — those callers
  // still get the protocol/credential/format checks below, just not a fixed
  // origin allowlist that would need updating per deployment.
  approvedHttpsHostname?: string;
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

// Shared source of truth for the shared WebView screen's approved origin, so
// the resolver's allowlist and react-native-webview's own `originWhitelist`
// prop can't drift from each other.
export const EDUWALDO_HTTPS_HOSTNAME = 'eduwaldo.com';

function isApprovedHttpsHost(hostname: string, approvedHostname: string): boolean {
  return hostname === approvedHostname || hostname.endsWith(`.${approvedHostname}`);
}

export function resolveSafeExternalUrl(
  value: string | null | undefined,
  options: SafeExternalUrlOptions = {},
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
  if (parsed.protocol === 'https:') {
    if (
      options.approvedHttpsHostname &&
      !isApprovedHttpsHost(parsed.hostname, options.approvedHttpsHostname)
    ) {
      return null;
    }
    return candidate;
  }
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
