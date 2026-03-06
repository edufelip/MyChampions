/**
 * Tab route: /(tabs)/training
 * Pro -> SC-208 Professional Training Library
 * Student -> SC-210 Student Training Tracking
 */
import { Redirect } from 'expo-router';

import { useAuthSession } from '@/features/auth/auth-session';
import { resolveTabRouteFallback } from '@/features/auth/tab-route-fallback.logic';
import ProTrainingScreen from '@/app/professional/training';
import StudentTrainingScreen from '@/app/student/training';

export default function TrainingTab() {
  const { lockedRole } = useAuthSession();
  if (lockedRole === 'professional') {
    return <ProTrainingScreen />;
  }

  if (lockedRole === 'student') {
    return <StudentTrainingScreen />;
  }

  const fallbackHref = resolveTabRouteFallback(lockedRole);
  if (fallbackHref) {
    return <Redirect href={fallbackHref} />;
  }

  return <Redirect href="/auth/role-selection" />;
}
