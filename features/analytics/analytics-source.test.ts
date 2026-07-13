import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  sendAnalyticsEventToServer,
  type AnalyticsSourceDeps,
} from './analytics-source';

function makeDeps(overrides: Partial<AnalyticsSourceDeps> = {}): AnalyticsSourceDeps {
  return {
    getServerBaseUrl: () => 'http://localhost:3400',
    fetchFn: async () => {
      throw new Error('fetchFn not configured');
    },
    ...overrides,
  };
}

function makeResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response;
}

test('sendAnalyticsEventToServer posts redacted analytics events to the MyChampions server', async () => {
  const requests: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const deps = makeDeps({
    fetchFn: async (input, init) => {
      requests.push({ input, init });
      return makeResponse(202, { id: 'event-1' });
    },
  });

  const result = await sendAnalyticsEventToServer(
    {
      name: 'auth.sign_in.failed',
      properties: {
        surface: 'auth_sign_in',
        step: 'submit',
        result: 'failure',
        channel: 'email_password',
        reason_code: 'invalid_password',
        email: 'person@example.test',
      },
    },
    deps
  );

  assert.equal(result, 'sent');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].input, 'http://localhost:3400/analytics/events');
  assert.equal(requests[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), {
    name: 'auth.sign_in.failed',
    properties: {
      surface: 'auth_sign_in',
      step: 'submit',
      result: 'failure',
      channel: 'email_password',
      reason_code: 'invalid_password',
    },
  });
});

test('sendAnalyticsEventToServer skips when the local server URL is unavailable', async () => {
  let fetchCalls = 0;
  const result = await sendAnalyticsEventToServer(
    {
      name: 'auth.entry.viewed',
      properties: { surface: 'auth_sign_in', step: 'view', result: 'success' },
    },
    makeDeps({
      getServerBaseUrl: () => undefined,
      fetchFn: async () => {
        fetchCalls += 1;
        return makeResponse(202, {});
      },
    })
  );

  assert.equal(result, 'skipped');
  assert.equal(fetchCalls, 0);
});

test('useAnalytics no longer keeps the console transport stub', () => {
  const source = readFileSync(join(__dirname, 'use-analytics.ts'), 'utf8');

  assert.equal(source.includes("console.log('[analytics]'"), false);
  assert.equal(source.includes('Stub transport'), false);
  assert.equal(source.includes('Real transport is deferred'), false);
});
