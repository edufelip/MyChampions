/**
 * Tab route: /(tabs)/students
 * Professional only -> SC-205 Student Roster
 */
import { Redirect } from 'expo-router';

import { useAuthSession } from '@/features/auth/auth-session';
import { resolveTabRouteFallback } from '@/features/auth/tab-route-fallback.logic';
import ProfessionalStudentsScreen from '@/app/professional/students';

export default function StudentsTab() {
  const { lockedRole } = useAuthSession();

  if (lockedRole === 'professional') {
    return <ProfessionalStudentsScreen />;
  }

  const fallbackHref = resolveTabRouteFallback(lockedRole);
  if (fallbackHref) {
    return <Redirect href={fallbackHref} />;
  }

  return <Redirect href="/(tabs)" />;
}
