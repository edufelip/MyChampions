import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;

const reactNativePath = require.resolve('react-native');
require.cache[reactNativePath] = {
  id: reactNativePath,
  filename: reactNativePath,
  loaded: true,
  exports: { Platform: { OS: 'web' } },
} as any;

const asyncStoragePath = require.resolve('@react-native-async-storage/async-storage');
require.cache[asyncStoragePath] = {
  id: asyncStoragePath,
  filename: asyncStoragePath,
  loaded: true,
  exports: {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  },
} as any;

const expoConstantsPath = require.resolve('expo-constants');
require.cache[expoConstantsPath] = {
  id: expoConstantsPath,
  filename: expoConstantsPath,
  loaded: true,
  exports: {
    default: {
      expoConfig: {
        extra: {},
      },
    },
    expoConfig: {
      extra: {},
    },
  },
} as any;

describe('plan-builder source server-first module loading', () => {
  it('imports and reads server-backed nutrition detail without loading Firestore fallbacks', async () => {
    const originalLoad = (Module as any)._load;
    const blockedRequests: string[] = [];
    (Module as any)._load = function patchedLoad(
      request: string,
      parent: unknown,
      isMain: boolean,
    ) {
      if (request === 'firebase/firestore' || request === '../firestore') {
        blockedRequests.push(request);
        throw new Error(`blocked eager Firebase import: ${request}`);
      }
      return originalLoad.apply(this, arguments as any);
    };

    try {
      const { getNutritionPlanDetail } =
        require('./plan-builder-source') as typeof import('./plan-builder-source');

      const plan = await getNutritionPlanDetail('nutrition-plan-1', {
        getServerBaseUrl: () => 'http://server.test',
        getCurrentAccessToken: async () => 'server-token',
        fetchFn: (async (input, init) => {
          assert.equal(String(input), 'http://server.test/plans/nutrition/nutrition-plan-1');
          assert.equal(init?.method, 'GET');
          return new Response(
            JSON.stringify({
              plan: {
                id: 'nutrition-plan-1',
                sourceKind: 'assigned',
                ownerProfessionalUid: 'professional-1',
                studentAuthUid: 'student-1',
                isArchived: false,
                isDraft: false,
                name: 'Server Nutrition',
                hydrationGoalMl: 2400,
                caloriesTarget: 2000,
                carbsTarget: 200,
                proteinsTarget: 150,
                fatsTarget: 70,
                meals: [],
                createdAt: '2026-07-01T09:00:00.000Z',
                updatedAt: '2026-07-01T09:30:00.000Z',
              },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }) as AppFetch,
      });

      assert.equal(plan.id, 'nutrition-plan-1');
      assert.equal(plan.name, 'Server Nutrition');
      assert.deepEqual(blockedRequests, []);
    } finally {
      (Module as any)._load = originalLoad;
    }
  });
});
