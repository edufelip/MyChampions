import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { submitSupportMessage, type SupportSourceDeps } from './support-source';
import { SupportSourceError } from './support.logic';

function makeDeps(fetch: SupportSourceDeps['fetch']): SupportSourceDeps {
  return {
    fetch,
    getCurrentAccessToken: async () => 'access-token',
    getServerBaseUrl: () => 'https://api.example.test/',
    getAppVersion: () => '1.0.0',
    getPlatform: () => 'web',
  };
}

describe('submitSupportMessage', () => {
  it('sends the client-generated idempotency key to the server boundary', async () => {
    let request: RequestInit | undefined;
    const result = await submitSupportMessage(
      {
        subject: 'Login issue',
        body: 'I cannot sign in.',
        idempotencyKey: 'support-request-key-0001',
      },
      makeDeps(async (_url, init) => {
        request = init;
        return new Response(JSON.stringify({ id: 'support-1' }), { status: 201 });
      }),
    );

    assert.equal(result, 'support-1');
    assert.equal(new Headers(request?.headers).get('idempotency-key'), 'support-request-key-0001');
  });

  it('maps the typed server rate limit and Retry-After into a typed client error', async () => {
    const error = await submitSupportMessage(
      {
        subject: 'Login issue',
        body: 'I cannot sign in.',
        idempotencyKey: 'support-request-key-0002',
      },
      makeDeps(
        async () =>
          new Response(JSON.stringify({ error: { code: 'support_rate_limited' } }), {
            status: 429,
            headers: { 'retry-after': '873' },
          }),
      ),
    ).catch((caught) => caught);

    assert.ok(error instanceof SupportSourceError);
    assert.deepEqual(error, new SupportSourceError('rate_limited', 873));
  });
});
