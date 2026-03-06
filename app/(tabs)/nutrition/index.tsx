/**
 * Tab route: /(tabs)/nutrition
 * Pro -> SC-207 Professional Nutrition Library
 * Student -> SC-209 Student Nutrition Tracking
 */
import { Redirect } from 'expo-router';

import { useAuthSession } from '@/features/auth/auth-session';
import { resolveTabRouteFallback } from '@/features/auth/tab-route-fallback.logic';
import ProNutritionScreen from '@/app/professional/nutrition';
import StudentNutritionScreen from '@/app/student/nutrition';

export default function NutritionTab() {
  const { lockedRole } = useAuthSession();
  if (lockedRole === 'professional') {
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
