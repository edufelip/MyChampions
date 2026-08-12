import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOriginWhitelist, resolveSafeExternalUrl } from './external-url';

describe('resolveSafeExternalUrl', () => {
  it('accepts HTTPS URLs without rewriting them when no origin is enforced', () => {
    // No approvedHttpsHostname: callers with an operator-configured URL (not
    // reachable through end-user/attacker input) get the format/credential
    // checks only, same as before this option existed.
    assert.equal(
      resolveSafeExternalUrl('https://example.test/legal?language=en#terms'),
      'https://example.test/legal?language=en#terms',
    );
  });

  it('rejects executable, local-file, credential, and insecure remote URLs regardless of origin enforcement', () => {
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,unsafe',
      'file:///tmp/private',
      'https://user:secret@example.test',
      'http://example.test',
      '/relative/path',
    ]) {
      assert.equal(resolveSafeExternalUrl(value), null, value);
    }
  });

  describe('with approvedHttpsHostname (e.g. the shared WebView screen)', () => {
    it('accepts HTTPS URLs on the approved origin and its subdomains without rewriting them', () => {
      assert.equal(
        resolveSafeExternalUrl('https://eduwaldo.com/legal?language=en#terms', {
          approvedHttpsHostname: 'eduwaldo.com',
        }),
        'https://eduwaldo.com/legal?language=en#terms',
      );
      assert.equal(
        resolveSafeExternalUrl(
          'https://portfolio.eduwaldo.com/projects/my-champions/terms_of_use',
          { approvedHttpsHostname: 'eduwaldo.com' },
        ),
        'https://portfolio.eduwaldo.com/projects/my-champions/terms_of_use',
      );
    });

    it('rejects HTTPS URLs on any other origin, including prefix/suffix tricks', () => {
      for (const value of [
        // Not the approved origin — this is the vector a crafted
        // mychampions://shared/webview?url=... deep link would exploit.
        'https://evil.example',
        // Prefix/suffix tricks that must not be treated as the approved origin.
        'https://eduwaldo.com.evil.example',
        'https://evileduwaldo.com',
      ]) {
        assert.equal(
          resolveSafeExternalUrl(value, { approvedHttpsHostname: 'eduwaldo.com' }),
          null,
          value,
        );
      }
    });
  });

  it('allows plain HTTP only for explicit local development hosts', () => {
    assert.equal(
      resolveSafeExternalUrl('http://localhost:8081', { allowInsecureLocalhost: true }),
      'http://localhost:8081',
    );
    assert.equal(
      resolveSafeExternalUrl('http://127.0.0.1:8081', { allowInsecureLocalhost: true }),
      'http://127.0.0.1:8081',
    );
    assert.equal(resolveSafeExternalUrl('http://localhost:8081'), null);
  });
});

describe('buildOriginWhitelist', () => {
  it('includes both the apex domain and a subdomain wildcard', () => {
    // A bare `https://*.example.com` wildcard pattern never matches the apex
    // origin `https://example.com` in react-native-webview — both entries
    // are required, or the resolver and the WebView's own originWhitelist
    // prop would silently disagree on the apex domain.
    assert.deepEqual(buildOriginWhitelist('eduwaldo.com'), [
      'https://eduwaldo.com',
      'https://*.eduwaldo.com',
    ]);
  });
});
