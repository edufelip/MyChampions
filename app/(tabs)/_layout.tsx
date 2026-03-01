/**
 * Role-aware bottom tab navigator shell.
 * D-045: Professional tabs — Dashboard / Students / Nutrition / Training / Account
 *        Student tabs     — Home / Nutrition / Training / Recipes / Account
 *
 * Tabs not belonging to the current role are hidden via `href: null`; they
 * remain registered so expo-router's file-system layout is satisfied.
 *
 * lockedRole === null means the user has not yet committed a role (or is
 * unauthenticated). In that case all product tabs are hidden; the auth guard
 * in the root _layout.tsx will redirect to sign-in or role-selection before
 * this component has a chance to show any tab UI.
 */
import { Tabs } from 'expo-router';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useAuthSession } from '@/features/auth/auth-session';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const { t } = useTranslation();
  const { lockedRole } = useAuthSession();
  const tint = Colors[colorScheme ?? 'light'].tint;

  const isPro = lockedRole === 'professional';
  const isStudent = lockedRole === 'student';

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      {/* ── index: Pro = Dashboard / Student = Home ─────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: isPro ? t('shell.tabs.dashboard') : t('shell.tabs.home'),
          tabBarIcon: ({ color }) => (
            <IconSymbol
              size={26}
              name={isPro ? 'square.grid.2x2.fill' : 'house.fill'}
              color={color}
            />
          ),
          // Always visible — every role has a home/dashboard tab
          href: lockedRole ? undefined : null,
        }}
      />

      {/* ── students: Pro only ───────────────────────────────────────────── */}
      <Tabs.Screen
        name="students"
        options={{
          title: t('shell.tabs.students'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="person.2.fill" color={color} />
          ),
          href: isPro ? undefined : null,
        }}
      />

      {/* ── nutrition: both roles ────────────────────────────────────────── */}
      <Tabs.Screen
        name="nutrition"
        options={{
          title: t('shell.tabs.nutrition'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="fork.knife" color={color} />
          ),
          href: lockedRole ? undefined : null,
        }}
      />

      {/* ── training: both roles ─────────────────────────────────────────── */}
      <Tabs.Screen
        name="training"
        options={{
          title: t('shell.tabs.training'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="figure.run" color={color} />
          ),
          href: lockedRole ? undefined : null,
        }}
      />

      {/* ── recipes: Student only ────────────────────────────────────────── */}
      <Tabs.Screen
        name="recipes"
        options={{
          title: t('shell.tabs.recipes'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="book.closed.fill" color={color} />
          ),
          href: isStudent ? undefined : null,
        }}
      />

      {/* ── account: both roles ──────────────────────────────────────────── */}
      <Tabs.Screen
        name="account"
        options={{
          title: t('shell.tabs.account'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="person.crop.circle.fill" color={color} />
          ),
          href: lockedRole ? undefined : null,
        }}
      />

      {/* ── Legacy Expo starter screens — hidden from product nav ────────── */}
      <Tabs.Screen name="explore" options={{ href: null }} />
    </Tabs>
  );
}
