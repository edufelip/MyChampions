import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const mobileRoot = process.cwd();
const rootServerAppPath = join(mobileRoot, '../server/src/app.ts');

function collectFeatureSourceFiles(relativeDir = 'features'): string[] {
  const absoluteDir = join(mobileRoot, relativeDir);

  return readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDir}/${entry.name}`;
    const absolutePath = join(mobileRoot, relativePath);

    if (entry.isDirectory()) {
      return collectFeatureSourceFiles(relativePath);
    }

    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      return [];
    }

    return [absolutePath];
  });
}

function normalizeRoute(route: string): string {
  return route
    .split('?')[0]
    .replace(/\s+/g, '')
    .replace(/\$\{[^}]+\}/g, ':param')
    .replace(/:[^/]+/g, ':param');
}

function registeredRootRoutes(): Set<string> {
  const source = readFileSync(rootServerAppPath, 'utf8');

  return new Set(
    [...source.matchAll(/\.(?:get|post|put|patch|delete)\(\s*['"](\/[^'"]+)['"]/g)].map(([, route]) =>
      normalizeRoute(route)
    )
  );
}

function directMobileRootRoutes(): Array<{ file: string; route: string }> {
  const baseUrlTemplate = /\$\{(?:(?:auth|source|serverConnection)\.)?baseUrl\}([^`]+)/g;

  return collectFeatureSourceFiles().flatMap((file) => {
    const source = readFileSync(file, 'utf8');

    return [...source.matchAll(baseUrlTemplate)].flatMap(([, suffix]) => {
      if (!suffix.startsWith('/') || suffix.includes('${path.')) {
        return [];
      }

      return [{ file: relative(mobileRoot, file), route: normalizeRoute(suffix) }];
    });
  });
}

test('every direct mobile root-server request resolves to a registered Elysia route', () => {
  const registeredRoutes = registeredRootRoutes();
  const directRoutes = directMobileRootRoutes();

  assert.ok(directRoutes.length >= 60, 'route scan should cover the active mobile source modules');

  for (const { file, route } of directRoutes) {
    assert.equal(
      registeredRoutes.has(route),
      true,
      `${file} calls ${route}, but server/src/app.ts does not register that route`
    );
  }
});

test('helper-built mobile requests resolve to registered Elysia routes', () => {
  const registeredRoutes = registeredRootRoutes();
  const contracts = [
    {
      file: 'features/auth/profile-source.ts',
      fragments: ["requestProfile('/me/hydrate'"],
      route: '/me/hydrate',
    },
    {
      file: 'features/auth/profile-source.ts',
      fragments: ["requestProfile('/me/role'"],
      route: '/me/role',
    },
    {
      file: 'features/auth/profile-source.ts',
      fragments: ["requestProfile('/me', deps, { method: 'DELETE' })"],
      route: '/me',
    },
    {
      file: 'features/auth/profile-source.ts',
      fragments: ["requestProfile('/me/terms'"],
      route: '/me/terms',
    },
    {
      file: 'features/nutrition/food-search-source.ts',
      fragments: ['/integrations/food/search'],
      route: '/integrations/food/search',
    },
    {
      file: 'features/nutrition/meal-photo-analysis-source.ts',
      fragments: ['/nutrition/meal-photo-analysis'],
      route: '/nutrition/meal-photo-analysis',
    },
    {
      file: 'features/plans/exercise-service-source.ts',
      fragments: ['/integrations/exercise${path.replace', '/catalog/exercises/${encodeURIComponent(id.trim())}'],
      route: '/integrations/exercise/exercises/:param',
    },
    {
      file: 'features/professional/professional-source.ts',
      fragments: ['/professional/invite-codes/${specialty}'],
      route: '/professional/invite-codes/:param',
    },
    {
      file: 'features/professional/professional-source.ts',
      fragments: ['/professional/invite-codes/${specialty}/rotate'],
      route: '/professional/invite-codes/:param/rotate',
    },
    {
      file: 'features/subscription/subscription-server-source.ts',
      fragments: ["'/subscription/entitlements/snapshot'"],
      route: '/subscription/entitlements/snapshot',
    },
  ];

  for (const { file, fragments, route } of contracts) {
    const source = readFileSync(join(mobileRoot, file), 'utf8');

    for (const fragment of fragments) {
      assert.equal(source.includes(fragment), true, `${file} no longer contains ${fragment}`);
    }

    assert.equal(
      registeredRoutes.has(normalizeRoute(route)),
      true,
      `${file} calls ${route}, but server/src/app.ts does not register that route`
    );
  }
});
