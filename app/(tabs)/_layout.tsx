/**
 * Role-aware bottom tab navigator shell.
 * D-045: Professional tabs — Dashboard / Students / Nutrition / Training / Account
 *        Student tabs     — Home / Nutrition / Exercise / Recipes / Profile
 *
 * Tabs not belonging to the current role are hidden via `href: null`; they
 * remain registered so expo-router's file-system layout is satisfied.
 *
 * lockedRole === null means the user has not yet committed a role (or is
 * unauthenticated). In that case all product tabs are hidden; the auth guard
 * in the root _layout.tsx will redirect to sign-in or role-selection before
 * this component has a chance to show any tab UI.
 */
import { Redirect, Tabs, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { getDsTheme } from '@/constants/design-system';
import type { RoleIntent } from '@/features/auth/role-selection.logic';
import { useAuthSession } from '@/features/auth/auth-session';
import { resolveTabShellState } from '@/features/auth/tab-shell.logic';
import { canAccessNutritionSurface } from '@/features/professional/specialty.logic';
import { useSpecialties } from '@/features/professional/use-professional';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTranslation } from '@/localization';

export default function TabLayout() {
  const colorScheme = useColorScheme() ?? 'light';
  const { t } = useTranslation();
  const { isHydrated, lockedRole, needsTermsAcceptance, currentUser } = useAuthSession();
  const pathname = usePathname();
  const theme = getDsTheme(colorScheme === 'dark' ? 'dark' : 'light');
  const currentUid = currentUser?.uid ?? null;
  const establishedUidRef = useRef<string | null>(null);
  const [establishedRole, setEstablishedRole] = useState<RoleIntent | null>(null);
  const { width: viewportWidth } = useWindowDimensions();
  const usesSideNavigation = Platform.OS === 'web' && viewportWidth >= 768;
  const usesLabeledSidebar = Platform.OS === 'web' && viewportWidth >= 1024;

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    if (!currentUid) {
      establishedUidRef.current = null;
      setEstablishedRole(null);
      return;
    }

    if (needsTermsAcceptance || !lockedRole) {
      if (establishedUidRef.current && establishedUidRef.current !== currentUid) {
        establishedUidRef.current = null;
        setEstablishedRole(null);
      }
      return;
    }

    establishedUidRef.current = currentUid;
    setEstablishedRole(lockedRole);
  }, [currentUid, isHydrated, lockedRole, needsTermsAcceptance]);

  const { canUseEstablishedShell, effectiveRole } = resolveTabShellState({
    isHydrated,
    currentUid,
    lockedRole,
    needsTermsAcceptance,
    establishedUid: establishedUidRef.current,
    establishedRole,
  });
  const { state: specialtiesState } = useSpecialties(
    Boolean(currentUser) && effectiveRole === 'professional',
  );

  useEffect(() => {
    if (!__DEV__) return;
    if (!effectiveRole) return;
    console.info('[tabs][transition]', { pathname, role: effectiveRole, isHydrated });
  }, [effectiveRole, isHydrated, pathname]);

  if (!isHydrated && !canUseEstablishedShell) {
    return null;
  }

  if (isHydrated && needsTermsAcceptance) {
    return <Redirect href="/auth/accept-terms" />;
  }

  if (!effectiveRole) {
    return <Redirect href="/auth/role-selection" />;
  }

  const isPro = effectiveRole === 'professional';
  const isStudent = effectiveRole === 'student';
  const canUseNutrition = canAccessNutritionSurface({
    role: effectiveRole,
    specialties: specialtiesState.kind === 'ready' ? specialtiesState.specialties : [],
  });

  return (
    <Tabs
      screenOptions={{
        tabBarPosition: usesSideNavigation ? 'left' : 'bottom',
        tabBarVariant: usesSideNavigation ? 'material' : 'uikit',
        tabBarShowLabel: !usesSideNavigation || usesLabeledSidebar,
        tabBarLabelPosition: usesLabeledSidebar ? 'beside-icon' : 'below-icon',
        tabBarActiveTintColor: theme.color.accentPrimary,
        tabBarInactiveTintColor: theme.color.textTertiary,
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
          borderRightColor: theme.color.border,
          width: usesSideNavigation ? (usesLabeledSidebar ? 220 : 88) : undefined,
        },
        sceneStyle: {
          backgroundColor: theme.color.canvas,
        },
        lazy: true,
        animation: 'fade',
        headerShown: false,
        tabBarButton: HapticTab,
      }}
    >
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
          tabBarButtonTestID: 'tabs.home',
          // Always visible — every role has a home/dashboard tab
          href: effectiveRole ? undefined : null,
        }}
      />

      {/* ── students: Pro only ───────────────────────────────────────────── */}
      <Tabs.Screen
        name="students"
        options={{
          title: t('shell.tabs.students'),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="person.2.fill" color={color} />,
          tabBarButtonTestID: 'tabs.students',
          href: isPro ? undefined : null,
        }}
      />

      {/* ── nutrition: both roles ────────────────────────────────────────── */}
      <Tabs.Screen
        name="nutrition"
        options={{
          title: t('shell.tabs.nutrition'),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="fork.knife" color={color} />,
          tabBarButtonTestID: 'tabs.nutrition',
          href: canUseNutrition ? undefined : null,
        }}
      />

      {/* ── training: Pro = Training / Student = Exercise ───────────────── */}
      <Tabs.Screen
        name="training"
        options={{
          title: isStudent ? t('shell.tabs.exercise') : t('shell.tabs.training'),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="figure.run" color={color} />,
          tabBarButtonTestID: 'tabs.training',
          href: effectiveRole ? undefined : null,
        }}
      />

      {/* ── recipes: Student only ────────────────────────────────────────── */}
      <Tabs.Screen
        name="recipes"
        options={{
          title: t('shell.tabs.recipes'),
          tabBarLabel: t('shell.tabs.recipes'),
          tabBarIcon: ({ color }) => <IconSymbol size={26} name="book.closed.fill" color={color} />,
          tabBarButtonTestID: 'tabs.recipes',
          href: isStudent ? undefined : null,
        }}
      />

      {/* ── account: Pro = Account / Student = Profile ───────────────────── */}
      <Tabs.Screen
        name="account"
        options={{
          title: isStudent ? t('shell.tabs.profile') : t('shell.tabs.account'),
          tabBarLabel: isStudent ? t('shell.tabs.profile') : t('shell.tabs.account'),
          tabBarIcon: ({ color }) => (
            <IconSymbol size={26} name="person.crop.circle.fill" color={color} />
          ),
          tabBarButtonTestID: 'tabs.account',
          href: effectiveRole ? undefined : null,
        }}
      />
    </Tabs>
  );
}
