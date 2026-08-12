export type SafeExternalUrlOptions = {
  // Allows plain `http:` for `localhost`/`127.0.0.1`/`[::1]` — intended only
  // for local development (see `allowInsecureLocalhostForDevelopment` below).
  // Every other URL must be `https:`.
  allowInsecureLocalhost?: boolean;
  // Restricts accepted HTTPS URLs to this hostname and its subdomains. Omit
  // for callers whose URL is operator-configured (e.g. via an env var) rather
  // than reachable through end-user/attacker-controlled input — those callers
  // still get the protocol/credential/format checks below, just not a fixed
  // origin allowlist that would need updating per deployment.
  approvedHttpsHostname?: string;
  // Exact HTTPS URLs trusted by app configuration (for example, a legal
  // destination hosted outside the default application origin). This does
  // not broaden arbitrary deep-link input; only an exact configured value is
  // accepted.
  approvedHttpsUrls?: readonly string[];
};

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

// Shared source of truth for the shared WebView screen's approved origin, so
// the resolver's allowlist and react-native-webview's own `originWhitelist`
// prop can't drift from each other.
export const EDUWALDO_HTTPS_HOSTNAME = 'eduwaldo.com';

function isApprovedHttpsHost(hostname: string, approvedHostname: string): boolean {
  return hostname === approvedHostname || hostname.endsWith(`.${approvedHostname}`);
}

/**
 * Builds a react-native-webview `originWhitelist` array for a hostname and
 * its subdomains. `https://*.example.com`-style wildcard patterns never
 * match the bare apex domain, so both entries are required.
 */
export function buildOriginWhitelist(hostname: string): string[] {
  return [`https://${hostname}`, `https://*.${hostname}`];
}

export function buildOriginWhitelistForUrl(value: string): string[] {
  const parsed = new URL(value);
  if (parsed.protocol === 'https:') {
    return buildOriginWhitelist(parsed.hostname);
  }
  if (parsed.protocol === 'http:') {
    return [`http://${parsed.hostname}`, `http://*.${parsed.hostname}`];
  }
  return [];
}

/**
 * Validates a candidate external URL before it reaches a WebView `source` or
 * `Linking.openURL`/`window.open` sink.
 *
 * - Rejects anything that isn't a well-formed URL, and anything carrying
 *   embedded credentials (`https://user:pass@host`).
 * - Accepts `https:` URLs. If `approvedHttpsHostname` is set, the URL's host
 *   must equal that hostname or be one of its subdomains; otherwise any
 *   `https:` host is accepted (for operator-configured URLs the caller
 *   already trusts, e.g. a payment-provider handoff URL from an env var).
 * - Accepts plain `http:` only for loopback hosts, and only when
 *   `allowInsecureLocalhost` is explicitly passed (see
 *   `allowInsecureLocalhostForDevelopment`) — never in production.
 * - Rejects everything else, including `javascript:`, `data:`, `file:`, and
 *   relative paths.
 */
export function resolveSafeExternalUrl(
  value: string | string[] | null | undefined,
  options: SafeExternalUrlOptions = {},
): string | null {
  if (Array.isArray(value) || typeof value !== 'string') {
    return null;
  }

  const candidate = value.trim();
  if (!candidate) return null;

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }

  if (parsed.username || parsed.password) return null;
  if (parsed.protocol === 'https:') {
    if (options.approvedHttpsUrls?.some((approvedUrl) => approvedUrl === candidate)) {
      return candidate;
    }
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
