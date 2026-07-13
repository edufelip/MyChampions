import assert from 'node:assert/strict';
import test from 'node:test';
import Module from 'node:module';

test('generateLocalId creates prefixed IDs without loading Firebase modules', () => {
  const originalLoad = (Module as any)._load;
  const blockedRequests: string[] = [];
  (Module as any)._load = function patchedLoad(request: string, parent: unknown, isMain: boolean) {
    if (request.startsWith('firebase/') || request === './firestore' || request === '@/features/firestore') {
      blockedRequests.push(request);
      throw new Error(`blocked Firebase import: ${request}`);
    }
    return originalLoad.apply(this, arguments as any);
  };

  try {
    const { generateLocalId } = require('./id-source') as typeof import('./id-source');

    const first = generateLocalId('training_session_local');
    const second = generateLocalId('training_session_local');

    assert.match(first, /^training_session_local_\d+_[a-z0-9]+$/);
    assert.match(second, /^training_session_local_\d+_[a-z0-9]+$/);
    assert.notEqual(first, second);
    assert.deepEqual(blockedRequests, []);
  } finally {
    (Module as any)._load = originalLoad;
  }
});
