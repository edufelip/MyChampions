import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createWebProviderScriptLoader } from './web-provider-script-loader';

function makeDocument() {
  const scripts = new Map<string, any>();
  const appended: any[] = [];
  const documentRef = {
    createElement: () => ({
      async: false,
      dataset: {},
      defer: false,
      id: '',
      onerror: null,
      onload: null,
      remove() {
        scripts.delete(this.id);
      },
      src: '',
    }),
    getElementById: (id: string) => scripts.get(id) ?? null,
    head: {
      appendChild: (script: any) => {
        scripts.set(script.id, script);
        appended.push(script);
      },
    },
  };
  return { appended, documentRef };
}

describe('web provider script loader', () => {
  it('single-flights concurrent requests and resolves only after load', async () => {
    const { appended, documentRef } = makeDocument();
    const load = createWebProviderScriptLoader(documentRef);
    const first = load('https://provider.test/sdk.js', 'provider-sdk');
    const second = load('https://provider.test/sdk.js', 'provider-sdk');

    assert.equal(first, second);
    assert.equal(appended.length, 1);
    appended[0].onload();
    await Promise.all([first, second]);
    assert.equal(appended[0].dataset.loaded, 'true');
  });

  it('removes a failed script so a later request can retry', async () => {
    const { appended, documentRef } = makeDocument();
    const load = createWebProviderScriptLoader(documentRef);
    const first = load('https://provider.test/sdk.js', 'provider-sdk');
    appended[0].onerror();
    await assert.rejects(first, /provider_script_failed/);

    const retry = load('https://provider.test/sdk.js', 'provider-sdk');
    assert.equal(appended.length, 2);
    appended[1].onload();
    await retry;
  });
});
