/**
 * Tab route: /(tabs)/index
 * Pro  -> SC-204 Professional Home
 * Student -> SC-203 Student Home
 */
import { Redirect } from 'expo-router';

import { useAuthSession } from '@/features/auth/auth-session';
import { resolveTabRouteFallback } from '@/features/auth/tab-route-fallback.logic';
import ProfessionalHomeScreen from '@/app/professional/home';
import StudentHomeScreen from '@/app/student/home';

export default function IndexTab() {
  const { lockedRole } = useAuthSession();
  if (lockedRole === 'professional') {
    return <ProfessionalHomeScreen />;
  }

  if (lockedRole === 'student') {
    return <StudentHomeScreen />;
  }

  const fallbackHref = resolveTabRouteFallback(lockedRole);
  if (fallbackHref) {
    return <Redirect href={fallbackHref} />;
  }

  return <Redirect href="/auth/role-selection" />;
}
