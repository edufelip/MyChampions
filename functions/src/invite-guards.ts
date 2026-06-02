export type SupportedSpecialty = 'nutritionist' | 'fitness_coach';

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

export type PendingStudentSlotId = typeof PENDING_STUDENT_SLOT_IDS[number];

export type PendingStudentOccupancy = {
  slotId?: string | null;
  nutritionistConnectionId?: string | null;
  fitnessCoachConnectionId?: string | null;
};

export type PendingStudentSlot = {
  slotId: string;
  studentAuthUid?: string | null;
};

export function buildPendingInviteGuardId(
  professionalUid: string,
  studentUid: string,
  specialty: SupportedSpecialty
): string {
  return `${professionalUid}_${studentUid}_${specialty}`;
}

export function getPendingStudentConnectionField(specialty: SupportedSpecialty): 'nutritionistConnectionId' | 'fitnessCoachConnectionId' {
  return specialty === 'nutritionist' ? 'nutritionistConnectionId' : 'fitnessCoachConnectionId';
}

export function hasPendingStudentOccupancy(occupancy: PendingStudentOccupancy | null): boolean {
  return Boolean(occupancy?.nutritionistConnectionId || occupancy?.fitnessCoachConnectionId);
}

export function selectPendingStudentSlot(input: {
  currentOccupancy: PendingStudentOccupancy | null;
  slots: PendingStudentSlot[];
}): PendingStudentSlotId | null {
  const existingSlotId = input.currentOccupancy?.slotId;
  if (existingSlotId && hasPendingStudentOccupancy(input.currentOccupancy)) {
    return PENDING_STUDENT_SLOT_IDS.includes(existingSlotId as PendingStudentSlotId)
      ? existingSlotId as PendingStudentSlotId
      : null;
  }

  const emptySlot = input.slots.find((slot) => !slot.studentAuthUid);
  if (!emptySlot || !PENDING_STUDENT_SLOT_IDS.includes(emptySlot.slotId as PendingStudentSlotId)) {
    return null;
  }
  return emptySlot.slotId as PendingStudentSlotId;
}
