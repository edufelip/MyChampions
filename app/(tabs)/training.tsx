/**
 * Tab route: /(tabs)/training
 * Pro -> SC-208 Professional Training Library
 * Student -> SC-210 Student Training Tracking
 */
import { useAuthSession } from '@/features/auth/auth-session';
import ProTrainingScreen from '@/app/professional/training';
import StudentTrainingScreen from '@/app/student/training';

export default function TrainingTab() {
  const { lockedRole } = useAuthSession();
  return lockedRole === 'professional' ? <ProTrainingScreen /> : <StudentTrainingScreen />;
}
