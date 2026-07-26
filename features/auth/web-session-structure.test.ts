import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('web auth session structure', () => {
  it('uses cookie mode with credentialed refresh and no browser persistence', () => {
    const source = readFileSync(new URL('./auth-session-runtime.web.ts', import.meta.url).pathname, 'utf8');
    assert.match(source, /sessionMode: 'cookie'/);
    assert.match(source, /credentials: 'include'/);
    assert.match(source, /persistsSession: false/);
    assert.doesNotMatch(source, /AsyncStorage|localStorage|sessionStorage/);
  });

  it('keeps native bearer mode as the default module contract', () => {
    const source = readFileSync(new URL('./auth-session-runtime.ts', import.meta.url).pathname, 'utf8');
    assert.match(source, /sessionMode: 'bearer'/);
    assert.match(source, /persistsSession: true/);
  });
});
