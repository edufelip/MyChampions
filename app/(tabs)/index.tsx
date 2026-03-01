/**
 * Tab: index
 * Pro  → Dashboard (SC-204 professional home)
 * Student → Home (SC-203 student home)
 *
 * Delegates to the role-specific product screen component.
 * The root auth guard ensures only authenticated, role-locked users reach here.
 */
import { useAuthSession } from '@/features/auth/auth-session';
import ProfessionalHomeScreen from '@/app/professional/home';
import StudentHomeScreen from '@/app/student/home';

export default function IndexTab() {
  const { lockedRole } = useAuthSession();
  return lockedRole === 'professional' ? <ProfessionalHomeScreen /> : <StudentHomeScreen />;
}
