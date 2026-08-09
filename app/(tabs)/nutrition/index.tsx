/**
 * Tab route: /(tabs)/nutrition
 * Pro -> SC-207 Professional Nutrition Library
 * Student -> SC-209 Student Nutrition Tracking
 */
import { Redirect } from 'expo-router';

import { useAuthSession } from '@/features/auth/auth-session';
import { resolveTabRouteFallback } from '@/features/auth/tab-route-fallback.logic';
import { canAccessNutritionSurface } from '@/features/professional/specialty.logic';
import { useSpecialties } from '@/features/professional/use-professional';
import ProNutritionScreen from '@/app/professional/nutrition';
import StudentNutritionScreen from '@/app/student/nutrition';

export default function NutritionTab() {
  const { currentUser, lockedRole } = useAuthSession();
  const { state: specialtiesState } = useSpecialties(
    Boolean(currentUser) && lockedRole === 'professional',
  );

  if (lockedRole === 'professional') {
    if (specialtiesState.kind === 'loading' || specialtiesState.kind === 'idle') {
      return null;
    }

    const canUseNutrition = canAccessNutritionSurface({
      role: lockedRole,
      specialties: specialtiesState.kind === 'ready' ? specialtiesState.specialties : [],
    });

    if (!canUseNutrition) {
      return <Redirect href="/(tabs)" />;
    }

    return <ProNutritionScreen />;
  }

  if (lockedRole === 'student') {
    return <StudentNutritionScreen />;
  }

  const fallbackHref = resolveTabRouteFallback(lockedRole);
  if (fallbackHref) {
    return <Redirect href={fallbackHref} />;
  }

  return <Redirect href="/auth/role-selection" />;
}
