/**
 * Tab route: /(tabs)/index
 * Pro  -> SC-204 Professional Home
 * Student -> SC-203 Student Home
 */
import { useAuthSession } from '@/features/auth/auth-session';
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

  return null;
}
