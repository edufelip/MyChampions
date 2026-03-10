import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearLanguageOverride,
  getEffectiveLocale,
  getLanguageOverride,
  setLanguageOverride,
} from './language-storage';

type AsyncStorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const storage = AsyncStorage as unknown as AsyncStorageLike;
const originalGetItem = storage.getItem;
const originalSetItem = storage.setItem;
const originalRemoveItem = storage.removeItem;
const originalDateTimeFormat = Intl.DateTimeFormat;

afterEach(() => {
  storage.getItem = originalGetItem;
  storage.setItem = originalSetItem;
  storage.removeItem = originalRemoveItem;
  Intl.DateTimeFormat = originalDateTimeFormat;
});

describe('language-storage', () => {
  it('getLanguageOverride returns supported locale when stored', async () => {
    storage.getItem = async () => 'pt-BR';
    const locale = await getLanguageOverride();
    assert.equal(locale, 'pt-BR');
  });

  it('getEffectiveLocale prioritizes language override over device locale', async () => {
    storage.getItem = async () => 'pt-BR';
    Intl.DateTimeFormat = (() =>
      ({
        resolvedOptions: () => ({ locale: 'en-US' }),
      })) as unknown as typeof Intl.DateTimeFormat;

    const locale = await getEffectiveLocale();
    assert.equal(locale, 'pt-BR');
  });

  it('getEffectiveLocale falls back to resolved device locale when override is missing', async () => {
    storage.getItem = async () => null;
    Intl.DateTimeFormat = (() =>
      ({
        resolvedOptions: () => ({ locale: 'es-MX' }),
      })) as unknown as typeof Intl.DateTimeFormat;

    const locale = await getEffectiveLocale();
    assert.equal(locale, 'es-ES');
  });

  it('setLanguageOverride and clearLanguageOverride call AsyncStorage with expected key', async () => {
    const calls: Array<{ fn: 'set' | 'remove'; key: string; value?: string }> = [];
    storage.setItem = async (key, value) => {
      calls.push({ fn: 'set', key, value });
    };
    storage.removeItem = async (key) => {
      calls.push({ fn: 'remove', key });
    };

    await setLanguageOverride('en-US');
    await clearLanguageOverride();

    assert.deepEqual(calls, [
      { fn: 'set', key: 'app.language.override', value: 'en-US' },
      { fn: 'remove', key: 'app.language.override' },
    ]);
  });
});
