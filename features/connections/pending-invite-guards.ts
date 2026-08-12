import type { ConnectionSpecialty } from './connection.logic';

export type PendingStudentOccupancy = {
  nutritionistConnectionId?: string | null;
  fitnessCoachConnectionId?: string | null;
};

export const PENDING_STUDENT_SLOT_IDS = [
  'slot_01',
  'slot_02',
  'slot_03',
  'slot_04',
  'slot_05',
  'slot_06',
  'slot_07',
  'slot_08',
  'slot_09',
  'slot_10',
] as const;

export function buildPendingInviteGuardId(
  professionalUid: string,
  studentUid: string,
  specialty: ConnectionSpecialty,
): string {
  return `${professionalUid}_${studentUid}_${specialty}`;
}

export function getPendingStudentConnectionField(
  specialty: ConnectionSpecialty,
): 'nutritionistConnectionId' | 'fitnessCoachConnectionId' {
  return specialty === 'nutritionist' ? 'nutritionistConnectionId' : 'fitnessCoachConnectionId';
}

export function shouldReleasePendingStudentSlot(
  occupancy: PendingStudentOccupancy,
  releasedConnectionId: string,
): boolean {
  const remainingConnectionIds = [
    occupancy.nutritionistConnectionId ?? null,
    occupancy.fitnessCoachConnectionId ?? null,
  ].filter(
    (connectionId): connectionId is string =>
      typeof connectionId === 'string' && connectionId !== releasedConnectionId,
  );

  return remainingConnectionIds.length === 0;
}
