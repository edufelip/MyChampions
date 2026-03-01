import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';
import { resolveAuthGuardRedirect } from '@/features/auth/auth-route-guard.logic';
import { AuthSessionProvider, useAuthSession } from '@/features/auth/auth-session';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <AuthSessionProvider>
      <RootLayoutContent />
    </AuthSessionProvider>
  );
}

function RootLayoutContent() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { isHydrated, isAuthenticated, lockedRole } = useAuthSession();

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    const redirect = resolveAuthGuardRedirect({
      isAuthenticated,
      lockedRole,
      pathname,
    });

    if (redirect && redirect !== pathname) {
      router.replace(redirect);
    }
  }, [isAuthenticated, isHydrated, lockedRole, pathname, router]);

  if (!isHydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="auth/sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="auth/create-account" options={{ headerShown: false }} />
        <Stack.Screen name="auth/role-selection" options={{ headerShown: false }} />
        <Stack.Screen name="student/home" options={{ headerShown: true }} />
        <Stack.Screen name="student/nutrition" options={{ headerShown: true }} />
        <Stack.Screen name="student/training" options={{ headerShown: true }} />
        <Stack.Screen name="student/professionals" options={{ headerShown: true }} />
        <Stack.Screen name="professional/pending" options={{ headerShown: true }} />
        <Stack.Screen name="professional/home" options={{ headerShown: true }} />
        <Stack.Screen name="professional/specialty" options={{ headerShown: true }} />
        <Stack.Screen name="professional/students" options={{ headerShown: true }} />
        <Stack.Screen name="professional/student-profile" options={{ headerShown: true }} />
        <Stack.Screen name="professional/subscription" options={{ headerShown: true }} />
        <Stack.Screen name="professional/nutrition/plans/[planId]" options={{ headerShown: true }} />
        <Stack.Screen name="professional/training/plans/[planId]" options={{ headerShown: true }} />
        <Stack.Screen name="settings/account" options={{ headerShown: true }} />
        <Stack.Screen name="nutrition/custom-meals/index" options={{ headerShown: true }} />
        <Stack.Screen name="nutrition/custom-meals/[mealId]" options={{ headerShown: true }} />
        <Stack.Screen name="shared/recipes/[shareToken]" options={{ headerShown: true }} />
        <Stack.Screen
          name="modal"
          options={{ presentation: 'modal', title: t('shell.modal.title') }}
        />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
