import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveSafeExternalUrl } from './external-url';

describe('resolveSafeExternalUrl', () => {
  it('accepts HTTPS URLs without rewriting them', () => {
    assert.equal(
      resolveSafeExternalUrl('https://example.test/legal?language=en#terms'),
      'https://example.test/legal?language=en#terms'
    );
  });

  it('rejects executable, local-file, credential, and insecure remote URLs', () => {
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

  it('allows plain HTTP only for explicit local development hosts', () => {
    assert.equal(resolveSafeExternalUrl('http://localhost:8081', { allowInsecureLocalhost: true }), 'http://localhost:8081');
    assert.equal(resolveSafeExternalUrl('http://127.0.0.1:8081', { allowInsecureLocalhost: true }), 'http://127.0.0.1:8081');
    assert.equal(resolveSafeExternalUrl('http://localhost:8081'), null);
  });
});
