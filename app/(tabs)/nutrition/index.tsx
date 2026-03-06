/**
 * Tab route: /(tabs)/nutrition
 * Pro -> SC-207 Professional Nutrition Library
 * Student -> SC-209 Student Nutrition Tracking
 */
import { useAuthSession } from '@/features/auth/auth-session';
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

  return null;
}
