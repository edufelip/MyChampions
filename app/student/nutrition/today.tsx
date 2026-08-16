/**
 * SC-209 Student Nutrition Tracking
 * Route: /student/nutrition/today
 *
 * Documented deep-link alias (ET-109/TC-209) for the canonical /student/nutrition
 * tab route. Reuses the same screen component so bookmarks, notifications, and
 * shared links that target the spec'd nested route resolve to the real Student
 * Nutrition Tracking surface instead of Expo Router's Unmatched Route page.
 * Role guarding is handled by the shared auth route guard (features/auth/auth-route-guard.logic.ts),
 * which already fails closed for any /student/* path on a non-student session.
 */
import StudentNutritionScreen from '@/app/student/nutrition';

export default function StudentNutritionTodayRoute() {
  return <StudentNutritionScreen />;
}
