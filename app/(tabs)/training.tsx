/**
 * Tab: training
 * Pro     → Professional training placeholder (SC-208 not yet implemented)
 * Student → SC-210 Student Training Tracking
 *
 * Professional training plan builder (SC-208) is deferred.
 * Tracked in docs/discovery/pending-wiring-checklist-v1.md.
 */
import { useAuthSession } from '@/features/auth/auth-session';
import StudentTrainingScreen from '@/app/student/training';
import ProTrainingPlaceholder from '@/app/professional/training';

export default function TrainingTab() {
  const { lockedRole } = useAuthSession();
  return lockedRole === 'professional' ? <ProTrainingPlaceholder /> : <StudentTrainingScreen />;
}
