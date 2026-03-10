import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { getDsTheme } from '@/constants/design-system';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';
import { LocaleProvider } from '@/localization/locale-context';
import { normalizeGuardPathname, resolveAuthGuardRedirect } from '@/features/auth/auth-route-guard.logic';
import { AuthSessionProvider, useAuthSession } from '@/features/auth/auth-session';

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
  const router = useRouter();
  const pathname = usePathname();
  const normalizedPathname = normalizeGuardPathname(pathname);
  const lastRedirectAttemptRef = useRef<string | null>(null);
  const { isHydrated, isAuthenticated, lockedRole, needsTermsAcceptance, currentUser } = useAuthSession();
  const currentUserUid = currentUser?.uid ?? null;

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const redirect = resolveAuthGuardRedirect({
      isAuthenticated,
      lockedRole,
      needsTermsAcceptance,
      pathname: normalizedPathname,
    });

    if (__DEV__) {
      console.info('[auth][guard] evaluated', {
        uid: currentUserUid,
        isHydrated,
        isAuthenticated,
        lockedRole,
        needsTermsAcceptance,
        pathname: normalizedPathname,
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
  }, [currentUserUid, isAuthenticated, isHydrated, lockedRole, needsTermsAcceptance, normalizedPathname, router]);

  if (!isHydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: ds.color.canvas }}>
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
        <Stack.Screen name="auth/create-account" options={{ headerShown: false }} />
        <Stack.Screen name="auth/accept-terms" options={{ headerShown: false }} />
        <Stack.Screen name="auth/role-selection" options={{ headerShown: false }} />
        <Stack.Screen name="student/home" options={{ headerShown: false }} />
        <Stack.Screen name="student/nutrition" options={{ headerShown: false }} />
        <Stack.Screen name="student/nutrition/plans/[planId]" options={{ headerShown: false }} />
        <Stack.Screen name="student/training" options={{ headerShown: false }} />
        <Stack.Screen name="student/training/plans/[planId]" options={{ headerShown: false }} />
        <Stack.Screen name="student/professionals" options={{ headerShown: false }} />
        <Stack.Screen name="professional/pending" options={{ headerShown: false }} />
        <Stack.Screen name="professional/home" options={{ headerShown: false }} />
        <Stack.Screen name="professional/specialty" options={{ headerShown: false }} />
        <Stack.Screen name="professional/students" options={{ headerShown: false }} />
        <Stack.Screen name="professional/student-profile" options={{ headerShown: false }} />
        <Stack.Screen name="professional/subscription" options={{ headerShown: false }} />
        <Stack.Screen name="professional/nutrition/plans/[planId]" options={{ headerShown: false }} />
        <Stack.Screen name="professional/training/plans/[planId]" options={{ headerShown: false }} />
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
