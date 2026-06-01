import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, type Firestore } from 'firebase/firestore';

export const rulesProjectId = 'demo-mychampions';

export async function setupRulesTestEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: rulesProjectId,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  });
}

export async function clearRulesData(testEnv: RulesTestEnvironment): Promise<void> {
  await testEnv.clearFirestore();
}

export function authedDb(testEnv: RulesTestEnvironment, uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}

export async function seedDoc(
  testEnv: RulesTestEnvironment,
  path: string,
  data: Record<string, unknown>
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context: RulesTestContext) => {
    await setDoc(doc(context.firestore() as unknown as Firestore, path), data);
  });
}

export function nutritionPlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'nutrition-plan-id',
    studentAuthUid: 'student-uid',
    ownerProfessionalUid: null,
    sourceKind: 'self_managed',
    isDraft: false,
    isArchived: false,
    lifecycleConnectionId: null,
    title: 'Nutrition Plan',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export async function seedActiveNutritionistAccess(
  testEnv: RulesTestEnvironment,
  studentUid: string,
  professionalUid: string
): Promise<void> {
  const connectionId = `${studentUid}-${professionalUid}-nutritionist`;
  await seedDoc(testEnv, `connections/${connectionId}`, {
    id: connectionId,
    studentAuthUid: studentUid,
    professionalAuthUid: professionalUid,
    specialty: 'nutritionist',
    sourceInviteCodeId: 'invite-code-id',
    status: 'active',
    canceledReason: null,
    endedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await seedDoc(testEnv, `trackingAccess/${studentUid}/nutritionists/${professionalUid}`, {
    studentAuthUid: studentUid,
    professionalAuthUid: professionalUid,
    specialty: 'nutritionist',
    connectionId,
    status: 'active',
  });
}

export async function seedActiveNutritionistSpecialty(
  testEnv: RulesTestEnvironment,
  studentUid: string,
  professionalUid = 'nutritionist-uid'
): Promise<void> {
  await seedDoc(testEnv, `trackingAccess/${studentUid}/activeSpecialties/nutritionist`, {
    studentAuthUid: studentUid,
    professionalAuthUid: professionalUid,
    specialty: 'nutritionist',
    connectionId: `${studentUid}-${professionalUid}-nutritionist`,
    status: 'active',
  });
}

export async function seedProfessionalRoleAndSpecialty(
  testEnv: RulesTestEnvironment,
  professionalUid: string,
  specialty: 'nutritionist' | 'fitness_coach'
): Promise<void> {
  await seedDoc(testEnv, `userProfiles/${professionalUid}`, {
    authUid: professionalUid,
    lockedRole: 'professional',
  });
  await seedDoc(testEnv, `specialties/${professionalUid}_${specialty}`, {
    id: `${professionalUid}_${specialty}`,
    professionalAuthUid: professionalUid,
    specialty,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}
