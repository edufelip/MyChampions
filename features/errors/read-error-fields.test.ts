import assert from 'node:assert/strict';
import test from 'node:test';

import { isSafeInstanceOf, readBoundedString, readOwnField } from './read-error-fields';

test('reads own data fields without coercing arbitrary values', () => {
  const field = readOwnField({ code: 20 }, 'code');
  assert.deepEqual(field, { present: true, readable: true, value: 20 });
  assert.equal(readBoundedString(20), null);
});

test('does not invoke a throwing getter', () => {
  let calls = 0;
  const value = Object.defineProperty({}, 'code', {
    get() {
      calls += 1;
      throw new Error('getter should not run');
    },
  });

  assert.deepEqual(readOwnField(value, 'code'), { present: true, readable: false });
  assert.equal(calls, 0);
});

test('rejects arrays and caps large inspected strings', () => {
  assert.equal(readOwnField(['code'], '0').present, false);
  assert.equal(readBoundedString('x'.repeat(128)), 'x'.repeat(128));
  assert.equal(readBoundedString('x'.repeat(129)), null);
});

test('survives a proxy that throws while exposing descriptors', () => {
  const value = new Proxy(
    {},
    {
      getOwnPropertyDescriptor() {
        throw new Error('descriptor unavailable');
      },
    },
  );

  assert.deepEqual(readOwnField(value, 'code'), { present: true, readable: false });
});

test('survives a revoked proxy during instance checks', () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(isSafeInstanceOf(revoked.proxy, Error), false);
});
