import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

type ModuleLoad = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
type ModuleWithLoad = typeof Module & { _load: ModuleLoad };

test('server-backed image upload hook does not load Firebase Storage at module import', () => {
  const sourcePath = require.resolve('./use-image-upload');
  delete require.cache[sourcePath];

  const moduleWithLoad = Module as ModuleWithLoad;
  const originalLoad = moduleWithLoad._load;
  const blockedLoads: string[] = [];

  moduleWithLoad._load = function patchedLoad(
    this: unknown,
    request: string,
    parent: NodeModule | null,
    isMain: boolean,
  ) {
    if (request === 'firebase/storage') {
      blockedLoads.push(request);
      throw new Error('firebase/storage should not load for server-backed image upload');
    }
    if (request === 'react-native') {
      return { Alert: { alert: () => undefined } };
    }
    if (request === 'react') {
      return {
        createContext: () => ({ Provider: Symbol('Provider') }),
        useCallback: (callback: unknown) => callback,
        useRef: (current: unknown) => ({ current }),
        useState: (initial: unknown) => [initial, () => undefined],
      };
    }
    if (request === 'expo-image-picker') {
      return {};
    }
    if (request === 'expo-image-manipulator') {
      return { SaveFormat: { JPEG: 'jpeg' } };
    }
    return originalLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const { useImageUpload } = require('./use-image-upload') as typeof import('./use-image-upload');

    assert.equal(typeof useImageUpload, 'function');
    assert.deepEqual(blockedLoads, []);
  } finally {
    moduleWithLoad._load = originalLoad;
    delete require.cache[sourcePath];
  }
});
