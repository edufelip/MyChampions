const STORAGE_PREFIX = 'mychampions.e2e.plan-fixtures.v1.';

function getStorage(): Storage | null {
  try {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return null;
    }

    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function storageKey(scope: string, collection: string): string {
  return `${STORAGE_PREFIX}${scope}.${collection}`;
}

export function readE2EPlanFixtureList<T>(scope: string, collection: string): T[] {
  const storage = getStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(storageKey(scope, collection));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export function writeE2EPlanFixtureList<T>(scope: string, collection: string, values: T[]): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(storageKey(scope, collection), JSON.stringify(values));
  } catch {
    // Fixture persistence is best effort; native and non-browser tests keep in-memory state.
  }
}
