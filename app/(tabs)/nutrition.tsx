/**
 * Tab: nutrition
 * Pro     → Professional nutrition placeholder (SC-207 not yet implemented)
 * Student → SC-209 Student Nutrition Tracking
 *
 * Professional nutrition plan builder (SC-207) is deferred.
 * Tracked in docs/discovery/pending-wiring-checklist-v1.md.
 */
import { useAuthSession } from '@/features/auth/auth-session';
import StudentNutritionScreen from '@/app/student/nutrition';
import ProNutritionPlaceholder from '@/app/professional/nutrition';

export default function NutritionTab() {
  const { lockedRole } = useAuthSession();
  return lockedRole === 'professional' ? <ProNutritionPlaceholder /> : <StudentNutritionScreen />;
}
