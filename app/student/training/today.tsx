/**
 * SC-210 Student Training Tracking
 * Route: /student/training/today
 *
 * Documented deep-link alias (ET-109/TC-210) for the canonical /student/training
 * tab route. Reuses the same screen component so bookmarks, notifications, and
 * shared links that target the spec'd nested route resolve to the real Student
 * Training Tracking surface instead of Expo Router's Unmatched Route page.
 * Role guarding is handled by the shared auth route guard (features/auth/auth-route-guard.logic.ts),
 * which already fails closed for any /student/* path on a non-student session.
 */
import StudentTrainingScreen from '@/app/student/training';

export default function StudentTrainingTodayRoute() {
  return <StudentTrainingScreen />;
}
