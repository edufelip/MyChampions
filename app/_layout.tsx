import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, LogBox, View } from 'react-native';
import 'react-native-reanimated';

import { getDsTheme } from '@/constants/design-system';
import {
  normalizeAuthReturnTo,
  normalizeGuardPathname,
  resolveAuthGuardRedirect,
} from '@/features/auth/auth-route-guard.logic';
import { AuthSessionProvider, useAuthSession } from '@/features/auth/auth-session';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';
import { LocaleProvider, useLocale } from '@/localization/locale-context';

if (__DEV__ && process.env.EXPO_PUBLIC_E2E_SUPPRESS_LOGBOX === 'true') {
  // Runner output still records warnings; only the in-app overlay is disabled.
  LogBox.ignoreAllLogs();
}

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <LocaleProvider>
      <AuthSessionProvider>
        <RootLayoutContent />
      </AuthSessionProvider>
    </LocaleProvider>
  );
}

function RootLayoutContent() {
  const colorScheme = useColorScheme();
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const ds = getDsTheme(scheme);
  const { t } = useTranslation();
  const { activeLocale } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams<{
    intent?: string | string[];
    returnTo?: string | string[];
    url?: string | string[];
  }>();
  const normalizedPathname = normalizeGuardPathname(pathname);
  const authReturnTo = normalizeAuthReturnTo(searchParams.returnTo);
  const lastRedirectAttemptRef = useRef<string | null>(null);
  const {
    isHydrated,
    isAuthenticated,
    lockedRole,
    needsTermsAcceptance,
    termsUrl,
    currentUser,
    pendingRoleSelectionRole,
    completeRoleSelectionNavigation,
  } = useAuthSession();
  const currentUserUid = currentUser?.uid ?? null;

  useEffect(() => {
    if (pendingRoleSelectionRole && normalizedPathname !== '/auth/role-selection') {
      completeRoleSelectionNavigation();
    }
  }, [completeRoleSelectionNavigation, normalizedPathname, pendingRoleSelectionRole]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = activeLocale;
    document.documentElement.dir = 'ltr';
  }, [activeLocale]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const redirect = resolveAuthGuardRedirect({
      isAuthenticated,
      lockedRole,
      needsTermsAcceptance,
      pendingRoleSelectionRole,
      pathname: normalizedPathname,
      returnTo: authReturnTo,
      sharedWebviewIntent: searchParams.intent,
      sharedWebviewUrl: searchParams.url,
      termsUrl,
    });

    if (__DEV__) {
      console.info('[auth][guard] evaluated', {
        uid: currentUserUid,
        isHydrated,
        isAuthenticated,
        lockedRole,
        needsTermsAcceptance,
        pendingRoleSelectionRole,
        pathname: normalizedPathname,
        returnTo: authReturnTo,
        redirect,
      });
    }

    if (!redirect || redirect === normalizedPathname) {
      lastRedirectAttemptRef.current = null;
      return;
    }

    const redirectAttemptKey = `${normalizedPathname}->${redirect}`;
    if (lastRedirectAttemptRef.current === redirectAttemptKey) {
      return;
    }

    lastRedirectAttemptRef.current = redirectAttemptKey;
    if (redirect !== normalizedPathname) {
      router.replace(redirect as never);
    }
  }, [
    authReturnTo,
    currentUserUid,
    isAuthenticated,
    isHydrated,
    lockedRole,
    needsTermsAcceptance,
    normalizedPathname,
    pendingRoleSelectionRole,
    router,
    searchParams.intent,
    searchParams.url,
    termsUrl,
  ]);

  if (!isHydrated) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: ds.color.canvas,
        }}
      >
        <ActivityIndicator color={ds.color.accentPrimary} />
      </View>
    );
  }

  const navTheme = {
    ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      primary: ds.color.accentPrimary,
      background: ds.color.canvas,
      card: ds.color.surface,
      text: ds.color.textPrimary,
      border: ds.color.border,
      notification: ds.color.accentPrimary,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth/sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="auth/forgot-password" options={{ headerShown: false }} />
        <Stack.Screen name="auth/password-reset" options={{ headerShown: false }} />
        <Stack.Screen name="auth/create-account" options={{ headerShown: false }} />
        <Stack.Screen name="auth/accept-terms" options={{ headerShown: false }} />
        <Stack.Screen name="auth/role-selection" options={{ headerShown: false }} />
        <Stack.Screen name="student/home" options={{ headerShown: false }} />
        <Stack.Screen name="student/nutrition" options={{ headerShown: false }} />
        <Stack.Screen name="student/nutrition/today" options={{ headerShown: false }} />
        <Stack.Screen name="student/nutrition/plans/[planId]" options={{ headerShown: false }} />
        <Stack.Screen name="student/training" options={{ headerShown: false }} />
        <Stack.Screen name="student/training/today" options={{ headerShown: false }} />
        <Stack.Screen name="student/training/plans/[planId]" options={{ headerShown: false }} />
        <Stack.Screen name="student/professionals" options={{ headerShown: false }} />
        <Stack.Screen name="professional/pending" options={{ headerShown: false }} />
        <Stack.Screen name="professional/home" options={{ headerShown: false }} />
        <Stack.Screen name="professional/specialty" options={{ headerShown: false }} />
        <Stack.Screen name="professional/students" options={{ headerShown: false }} />
        <Stack.Screen name="professional/student-profile" options={{ headerShown: false }} />
        <Stack.Screen name="professional/subscription" options={{ headerShown: false }} />
        <Stack.Screen
          name="professional/nutrition/plans/[planId]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="professional/training/plans/[planId]"
          options={{ headerShown: false }}
        />
        <Stack.Screen name="settings/account" options={{ headerShown: false }} />
        <Stack.Screen name="settings/language-select" options={{ headerShown: false }} />
        <Stack.Screen name="shared/recipes/[shareToken]" options={{ headerShown: false }} />
        <Stack.Screen
          name="modal"
          options={{ presentation: 'modal', title: t('shell.modal.title'), headerShown: false }}
        />
      </Stack>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </ThemeProvider>
  );
}
