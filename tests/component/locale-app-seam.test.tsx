import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import {
  DEV_ANDROID_APP_ID,
  DEV_IOS_APP_ID,
  isLocaleDiagnosticAvailable,
  readLocaleDiagnosticBuildIdentity,
  type LocaleDiagnosticBuildIdentity,
} from '@/components/testing/locale-diagnostic-build-guard';
import { LocaleDiagnostic } from '@/components/testing/LocaleDiagnostic';
import {
  getEffectiveLocale,
  getLanguageOverride,
  readLanguageOverrideObservation,
} from '@/features/auth/language-storage';
import * as languageStorage from '@/features/auth/language-storage';
import { LocaleProvider, useLocale } from '@/localization/locale-context';

const mockGetItem = jest.fn<(key: string) => Promise<string | null>>();
const mockSetItem = jest.fn<(key: string, value: string) => Promise<void>>();
const mockRemoveItem = jest.fn<(key: string) => Promise<void>>();
let mockExpoConfig: {
  extra?: Record<string, unknown>;
  ios?: { bundleIdentifier?: string };
  android?: { package?: string };
} | null;

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (...args: [string]) => mockGetItem(...args),
    setItem: (...args: [string, string]) => mockSetItem(...args),
    removeItem: (...args: [string]) => mockRemoveItem(...args),
  },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));

function setDevConfig(): void {
  mockExpoConfig = {
    extra: { appVariant: 'dev' },
    ios: { bundleIdentifier: DEV_IOS_APP_ID },
    android: { package: DEV_ANDROID_APP_ID },
  };
}

function Probe() {
  const { activeLocale, diagnostic, setActiveLocale } = useLocale();
  return (
    <View>
      <Text testID="active-locale">{activeLocale}</Text>
      <Text testID="diagnostic-status">{diagnostic.hydration}</Text>
      <Pressable
        testID="set-pt-BR"
        onPress={() => {
          void setActiveLocale('pt-BR').catch(() => undefined);
        }}
      >
        <Text>set locale</Text>
      </Pressable>
      <LocaleDiagnostic />
    </View>
  );
}

function PlacementProbe() {
  const { activeLocale } = useLocale();
  return <Text testID="placement-active-locale">{activeLocale}</Text>;
}

async function renderCandidate() {
  return render(
    <LocaleProvider>
      <Probe />
    </LocaleProvider>,
  );
}

const originalDateTimeFormat = Intl.DateTimeFormat;
const originalDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
const originalVariant = process.env.APP_VARIANT;

beforeEach(() => {
  mockGetItem.mockReset();
  mockSetItem.mockReset();
  mockRemoveItem.mockReset();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
  mockRemoveItem.mockResolvedValue(undefined);
  setDevConfig();
  process.env.APP_VARIANT = 'dev';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;
  Intl.DateTimeFormat = (() => ({
    resolvedOptions: () => ({ locale: 'en-US' }),
  })) as unknown as typeof Intl.DateTimeFormat;
});

afterEach(async () => {
  await cleanup();
  Intl.DateTimeFormat = originalDateTimeFormat;
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = originalDev;
  if (originalVariant === undefined) delete process.env.APP_VARIANT;
  else process.env.APP_VARIANT = originalVariant;
});

describe('locale hydration and development diagnostic', () => {
  test('preserves product storage APIs while adding redacted classifications', async () => {
    mockGetItem.mockResolvedValue('not-a-locale');
    expect(await getLanguageOverride()).toBeNull();
    expect(await getEffectiveLocale()).toBe('en-US');
    expect(await readLanguageOverrideObservation()).toEqual({
      status: 'invalid',
      source: 'language-storage',
      value: null,
    });

    mockGetItem.mockRejectedValue(new Error('raw storage error'));
    await expect(getLanguageOverride()).rejects.toThrow('raw storage error');
    await expect(readLanguageOverrideObservation()).resolves.toEqual({
      status: 'read-error',
      source: 'language-storage',
      value: null,
    });
  });

  test('renders pending then hydrated state without using the initial device fallback as proof', async () => {
    let resolveStorage!: (value: string | null) => void;
    mockGetItem.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveStorage = resolve;
        }),
    );

    await renderCandidate();
    expect(screen.getByTestId('testing.locale.hydration.pending')).toBeTruthy();
    expect(screen.queryByTestId('testing.locale.effective.en-US')).toBeNull();
    expect(screen.getByTestId('active-locale').props.children).toBe('en-US');

    await act(async () => {
      resolveStorage(null);
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId('testing.locale.hydration.hydrated')).toBeTruthy(),
    );
    expect(screen.getByTestId('testing.locale.effective.en-US')).toBeTruthy();
    expect(screen.getByTestId('testing.locale.override.absent')).toBeTruthy();
  });

  test('renders all supported present override locales with bounded values', async () => {
    for (const locale of ['en-US', 'pt-BR', 'es-ES'] as const) {
      await cleanup();
      mockGetItem.mockResolvedValue(locale);
      await renderCandidate();
      await waitFor(() =>
        expect(screen.getByTestId(`testing.locale.effective.${locale}`)).toBeTruthy(),
      );
      expect(screen.getByTestId('testing.locale.override.present')).toBeTruthy();
      expect(screen.getByTestId(`testing.locale.overrideValue.${locale}`)).toBeTruthy();
      expect(screen.getByTestId('active-locale').props.children).toBe(locale);
      expect(JSON.stringify(screen.toJSON())).not.toContain('app.language.override');
    }
  });

  test('keeps invalid storage distinct while preserving device fallback behavior', async () => {
    mockGetItem.mockResolvedValue('secret-raw-locale');
    await renderCandidate();

    await waitFor(() => expect(screen.getByTestId('testing.locale.override.invalid')).toBeTruthy());
    expect(screen.getByTestId('testing.locale.effective.en-US')).toBeTruthy();
    expect(screen.getByTestId('active-locale').props.children).toBe('en-US');
    expect(screen.queryByTestId('testing.locale.overrideValue.secret-raw-locale')).toBeNull();
    expect(JSON.stringify(screen.toJSON())).not.toContain('secret-raw-locale');
  });

  test('keeps read-error explicit and never claims the fallback as hydrated', async () => {
    mockGetItem.mockRejectedValue(new Error('storage secret must stay private'));
    await renderCandidate();

    await waitFor(() =>
      expect(screen.getByTestId('testing.locale.hydration.read-error')).toBeTruthy(),
    );
    expect(screen.getByTestId('testing.locale.override.read-error')).toBeTruthy();
    expect(screen.queryByTestId('testing.locale.effective.en-US')).toBeNull();
    expect(screen.getByTestId('active-locale').props.children).toBe('en-US');
    expect(JSON.stringify(screen.toJSON())).not.toContain('storage secret');
  });

  test('locale changes update the existing selection API and diagnostic provenance', async () => {
    mockGetItem.mockResolvedValue(null);
    await renderCandidate();
    await waitFor(() => expect(screen.getByTestId('testing.locale.override.absent')).toBeTruthy());

    await act(async () => fireEvent.press(screen.getByTestId('set-pt-BR')));
    await waitFor(() => expect(screen.getByTestId('testing.locale.effective.pt-BR')).toBeTruthy());
    expect(screen.getByTestId('testing.locale.override.present')).toBeTruthy();
    expect(screen.getByTestId('testing.locale.overrideValue.pt-BR')).toBeTruthy();
    expect(screen.getByTestId('active-locale').props.children).toBe('pt-BR');
    expect(mockSetItem).toHaveBeenCalledWith('app.language.override', 'pt-BR');
  });

  test('failed persistence leaves the existing selection state and proof unchanged', async () => {
    mockGetItem.mockResolvedValue(null);
    mockSetItem.mockRejectedValue(new Error('storage write secret must stay private'));
    await renderCandidate();
    await waitFor(() => expect(screen.getByTestId('testing.locale.override.absent')).toBeTruthy());

    await act(async () => fireEvent.press(screen.getByTestId('set-pt-BR')));
    expect(screen.getByTestId('active-locale').props.children).toBe('en-US');
    expect(screen.getByTestId('testing.locale.override.absent')).toBeTruthy();
    expect(screen.queryByTestId('testing.locale.effective.pt-BR')).toBeNull();
  });

  test('delayed initial hydration cannot overwrite a successfully persisted locale change', async () => {
    let resolveInitialRead!: (value: string | null) => void;
    let resolveWrite!: () => void;
    mockGetItem.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveInitialRead = resolve;
        }),
    );
    mockSetItem.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );

    await renderCandidate();
    expect(screen.getByTestId('testing.locale.hydration.pending')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('set-pt-BR'));
      expect(mockSetItem).toHaveBeenCalledWith('app.language.override', 'pt-BR');
      resolveWrite();
      await Promise.resolve();
    });
    expect(screen.getByTestId('active-locale').props.children).toBe('pt-BR');

    await act(async () => {
      resolveInitialRead(null);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('testing.locale.effective.pt-BR')).toBeTruthy());
    expect(screen.getByTestId('active-locale').props.children).toBe('pt-BR');
    expect(screen.queryByTestId('testing.locale.effective.en-US')).toBeNull();
  });

  test('delayed initial hydration rejection cannot overwrite a successful locale change', async () => {
    let rejectInitialRead!: (error: unknown) => void;
    const readSpy = jest
      .spyOn(languageStorage, 'readLanguageOverrideObservation')
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectInitialRead = reject;
          }),
      );

    await renderCandidate();
    expect(screen.getByTestId('testing.locale.hydration.pending')).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByTestId('set-pt-BR')));
    await waitFor(() => expect(screen.getByTestId('testing.locale.effective.pt-BR')).toBeTruthy());
    expect(screen.getByTestId('active-locale').props.children).toBe('pt-BR');

    await act(async () => {
      rejectInitialRead(new Error('late storage failure'));
      await Promise.resolve();
    });
    await Promise.resolve();
    expect(screen.getByTestId('testing.locale.effective.pt-BR')).toBeTruthy();
    expect(screen.queryByTestId('testing.locale.hydration.read-error')).toBeNull();
    expect(screen.getByTestId('active-locale').props.children).toBe('pt-BR');
    expect(JSON.stringify(screen.toJSON())).not.toContain('late storage failure');
    readSpy.mockRestore();
  });

  test('production identity and non-development runtime are unavailable', () => {
    const base: LocaleDiagnosticBuildIdentity = {
      isDevRuntime: true,
      appVariant: 'dev',
      appId: DEV_IOS_APP_ID,
      platform: 'ios',
    };
    expect(isLocaleDiagnosticAvailable(base)).toBe(true);
    expect(isLocaleDiagnosticAvailable({ ...base, isDevRuntime: false })).toBe(false);
    expect(isLocaleDiagnosticAvailable({ ...base, appVariant: 'prod' })).toBe(false);
    expect(isLocaleDiagnosticAvailable({ ...base, appId: 'com.edufelip.mychampions' })).toBe(false);
    expect(isLocaleDiagnosticAvailable({ ...base, platform: 'other' })).toBe(false);
  });

  test('malformed or incomplete embedded config fails closed despite APP_VARIANT=dev', () => {
    const devIds = {
      ios: { bundleIdentifier: DEV_IOS_APP_ID },
      android: { package: DEV_ANDROID_APP_ID },
    };
    for (const extra of [{}, { appVariant: 42 }]) {
      mockExpoConfig = { ...devIds, extra };
      const identity = readLocaleDiagnosticBuildIdentity();
      expect(identity.appVariant).toBeNull();
      expect(isLocaleDiagnosticAvailable(identity)).toBe(false);
    }
    mockExpoConfig = null;
    const absentConfigIdentity = readLocaleDiagnosticBuildIdentity();
    expect(absentConfigIdentity.appVariant).toBe('dev');
    expect(isLocaleDiagnosticAvailable(absentConfigIdentity)).toBe(false);
  });

  test('rendered component is absent for a production embedded identity', async () => {
    mockExpoConfig = {
      extra: { appVariant: 'prod' },
      ios: { bundleIdentifier: 'com.edufelip.mychampions' },
      android: { package: 'com.edufelip.mychampions' },
    };
    await renderCandidate();
    await waitFor(() => expect(screen.getByTestId('diagnostic-status')).toBeTruthy());
    expect(screen.queryByTestId('testing.locale.diagnostic')).toBeNull();
  });

  test('canonical root aliases and placement render the guarded diagnostic subtree', async () => {
    const canonicalRoot = readFileSync(resolve(process.cwd(), 'app/_layout.tsx'), 'utf8');
    expect(canonicalRoot).toContain(
      "import { LocaleProvider, useLocale } from '@/localization/locale-context';",
    );
    const providerStart = canonicalRoot.indexOf('    <LocaleProvider>');
    const authProvider = canonicalRoot.indexOf('      <AuthSessionProvider>', providerStart);
    const stackStart = canonicalRoot.indexOf('      <Stack ', authProvider);
    const statusBar = canonicalRoot.indexOf('      <StatusBar ', stackStart);
    const diagnostic = canonicalRoot.indexOf('      <LocaleDiagnostic />', statusBar);
    expect(providerStart).toBeGreaterThanOrEqual(0);
    expect(canonicalRoot).toContain(
      "import { LocaleDiagnostic } from '@/components/testing/LocaleDiagnostic';",
    );
    expect(authProvider).toBeGreaterThan(providerStart);
    expect(stackStart).toBeGreaterThan(authProvider);
    expect(statusBar).toBeGreaterThan(stackStart);
    expect(diagnostic).toBeGreaterThan(statusBar);

    const diagnosticSource = readFileSync(
      resolve(process.cwd(), 'components/testing/LocaleDiagnostic.tsx'),
      'utf8',
    );
    expect(diagnosticSource).toContain('importantForAccessibility="yes"');
    expect(diagnosticSource).toContain('height: 8,');
    expect(diagnosticSource).toContain('width: 8,');
    expect(diagnosticSource).toContain('zIndex: 9999,');

    mockGetItem.mockResolvedValue('es-ES');
    await render(
      <LocaleProvider>
        <LocaleDiagnostic />
        <PlacementProbe />
      </LocaleProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('testing.locale.effective.es-ES')).toBeTruthy());
    expect(screen.getByTestId('testing.locale.diagnostic')).toBeTruthy();
    expect(screen.getByTestId('placement-active-locale').props.children).toBe('es-ES');
  });
});
