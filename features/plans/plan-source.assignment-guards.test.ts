import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bulkAssignPredefinedPlan,
  createDraftAssignedPlan,
  getMyPlans,
  getMyPredefinedPlans,
  getProfessionalPlanChangeRequests,
  getStudentPlanChangeRequests,
  reviewPlanChangeRequest,
  submitPlanChangeRequest,
  validatePlanAssignmentTargets,
  PlanSourceError,
  type PlanSourceDeps,
} from './plan-source';

test('nutrition draft assignment requires an active nutritionist connection', () => {
  const result = validatePlanAssignmentTargets({
    planType: 'nutrition',
    targetStudentUids: ['student-a'],
    activeStudentUids: [],
  });

  assert.deepEqual(result, {
    isValid: false,
    requiredSpecialty: 'nutritionist',
    invalidStudentUids: ['student-a'],
  });
});

test('nutrition bulk assignment rejects targets without active nutritionist connection', () => {
  const result = validatePlanAssignmentTargets({
    planType: 'nutrition',
    targetStudentUids: ['student-a', 'student-b', 'student-c'],
    activeStudentUids: ['student-a', 'student-c'],
  });

  assert.deepEqual(result, {
    isValid: false,
    requiredSpecialty: 'nutritionist',
    invalidStudentUids: ['student-b'],
  });
});

test('training assignment remains fitness-coach scoped', () => {
  const result = validatePlanAssignmentTargets({
    planType: 'training',
    targetStudentUids: ['student-a', 'student-b'],
    activeStudentUids: ['student-a'],
  });

  assert.deepEqual(result, {
    isValid: false,
    requiredSpecialty: 'fitness_coach',
    invalidStudentUids: ['student-b'],
  });
});

test('E2E auth source can load predefined plans and bulk assign through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousPlansFixture = process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE = 'basic';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const predefinedPlans = await getMyPredefinedPlans();

    assert.deepEqual(
      predefinedPlans.map((plan) => ({ id: plan.id, name: plan.name, planType: plan.planType })),
      [
        {
          id: 'e2e-nutrition-predefined-plan',
          name: 'Balanced Nutrition Template',
          planType: 'nutrition',
        },
        {
          id: 'e2e-training-predefined-plan',
          name: 'Strength Training Template',
          planType: 'training',
        },
      ]
    );

    assert.deepEqual(
      await bulkAssignPredefinedPlan('e2e-nutrition-predefined-plan', [
        'e2e-active-student',
        'e2e-active-student',
        'e2e-dual-student',
      ]),
      { assignedCount: 2 }
    );
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousPlansFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE = previousPlansFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('E2E auth source treats an omitted professional-plan fixture as an empty library', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousPlansFixture = process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  delete process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    assert.deepEqual(await getMyPredefinedPlans(), []);
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousPlansFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE = previousPlansFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('E2E auth source can create a draft assigned plan through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousPlansFixture = process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE = 'basic';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const result = await createDraftAssignedPlan('e2e-nutrition-predefined-plan', 'e2e-dual-student');
    assert.match(result.id, /^e2e-nutrition-predefined-plan-draft-\d+$/);

    const plans = await getMyPlans();
    const draft = plans.find((plan) => plan.id === result.id);

    assert.deepEqual(
      draft && {
        id: draft.id,
        name: draft.name,
        planType: draft.planType,
        sourceKind: draft.sourceKind,
        studentUid: draft.studentUid,
        isArchived: draft.isArchived,
        isDraft: draft.isDraft,
      },
      {
        id: result.id,
        name: 'Balanced Nutrition Template',
        planType: 'nutrition',
        sourceKind: 'assigned',
        studentUid: 'e2e-dual-student',
        isArchived: false,
        isDraft: true,
      }
    );

  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousPlansFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE = previousPlansFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('E2E auth source can review a deterministic plan change request through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const requests = await getStudentPlanChangeRequests('e2e-dual-student');

    assert.deepEqual(
      requests.map((request) => ({
        id: request.id,
        planType: request.planType,
        status: request.status,
        requestText: request.requestText,
      })),
      [
        {
          id: 'e2e-plan-change-request-nutrition',
          planType: 'nutrition',
          status: 'pending',
          requestText: 'Please add one more high-protein breakfast option.',
        },
      ]
    );

    assert.deepEqual(
      await reviewPlanChangeRequest('e2e-plan-change-request-nutrition', 'reviewed'),
      { id: 'e2e-plan-change-request-nutrition', status: 'reviewed' }
    );
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('E2E assigned nutrition fixture exposes an assigned plan and change request write through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousPlansFixture = process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
  const previousStudentNutritionFixture = process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE = 'basic';
  process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE = 'assigned';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const assignedPlan = (await getMyPlans()).find((plan) => plan.id === 'e2e-assigned-nutrition-plan');
    assert.deepEqual(
      assignedPlan && {
        id: assignedPlan.id,
        planType: assignedPlan.planType,
        sourceKind: assignedPlan.sourceKind,
        studentUid: assignedPlan.studentUid,
        isDraft: assignedPlan.isDraft,
      },
      {
        id: 'e2e-assigned-nutrition-plan',
        planType: 'nutrition',
        sourceKind: 'assigned',
        studentUid: 'e2e-auth-session-user',
        isDraft: false,
      }
    );

    const request = await submitPlanChangeRequest(
      'e2e-assigned-nutrition-plan',
      'nutrition',
      'Please add more breakfast variety this week.'
    );
    assert.deepEqual(
      {
        planId: request.planId,
        planType: request.planType,
        studentUid: request.studentUid,
        status: request.status,
        requestText: request.requestText,
      },
      {
        planId: 'e2e-assigned-nutrition-plan',
        planType: 'nutrition',
        studentUid: 'e2e-auth-session-user',
        status: 'pending',
        requestText: 'Please add more breakfast variety this week.',
      }
    );
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousPlansFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE = previousPlansFixture;

    if (previousStudentNutritionFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE = previousStudentNutritionFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

test('E2E assigned training fixture exposes an assigned plan and change request write through provider-free paths', async () => {
  const previousAppVariant = process.env.APP_VARIANT;
  const previousE2EFlag = process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
  const previousPlansFixture = process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
  const previousStudentTrainingFixture = process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE;
  const previousDev = (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;

  process.env.APP_VARIANT = 'dev';
  process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = 'true';
  process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE = 'basic';
  process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE = 'assigned';
  (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

  try {
    const assignedPlan = (await getMyPlans()).find((plan) => plan.id === 'e2e-assigned-training-plan');
    assert.deepEqual(
      assignedPlan && {
        id: assignedPlan.id,
        planType: assignedPlan.planType,
        sourceKind: assignedPlan.sourceKind,
        studentUid: assignedPlan.studentUid,
        isDraft: assignedPlan.isDraft,
      },
      {
        id: 'e2e-assigned-training-plan',
        planType: 'training',
        sourceKind: 'assigned',
        studentUid: 'e2e-auth-session-user',
        isDraft: false,
      }
    );

    const request = await submitPlanChangeRequest(
      'e2e-assigned-training-plan',
      'training',
      'Please adjust leg day volume this week.'
    );
    assert.deepEqual(
      {
        planId: request.planId,
        planType: request.planType,
        studentUid: request.studentUid,
        status: request.status,
        requestText: request.requestText,
      },
      {
        planId: 'e2e-assigned-training-plan',
        planType: 'training',
        studentUid: 'e2e-auth-session-user',
        status: 'pending',
        requestText: 'Please adjust leg day volume this week.',
      }
    );
  } finally {
    if (previousAppVariant === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = previousAppVariant;

    if (previousE2EFlag === undefined) delete process.env.EXPO_PUBLIC_E2E_AUTH_SESSION;
    else process.env.EXPO_PUBLIC_E2E_AUTH_SESSION = previousE2EFlag;

    if (previousPlansFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE = previousPlansFixture;

    if (previousStudentTrainingFixture === undefined) delete process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE;
    else process.env.EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE = previousStudentTrainingFixture;

    if (previousDev === undefined) delete (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__;
    else (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = previousDev;
  }
});

function makeServerPlanSourceDeps(
  fetchImpl: PlanSourceDeps['fetchFn']
): PlanSourceDeps {
  return {
    getServerBaseUrl: () => 'http://server.test/',
    getCurrentAccessToken: async () => 'server-token',
    fetchFn: fetchImpl,
  };
}

async function assertRejectsWithConfiguration(
  operation: Promise<unknown>,
  messageSnippet: string
) {
  await assert.rejects(
    operation,
    (error: unknown) =>
      error instanceof PlanSourceError &&
      error.code === 'configuration' &&
      error.message.includes(messageSnippet)
  );
}

function makeJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

test('submitPlanChangeRequest uses the MyChampions server', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deps = makeServerPlanSourceDeps(async (input, init) => {
    calls.push({ url: String(input), init });
    return makeJsonResponse(201, {
      request: {
        id: 'request-1',
        planId: 'nutrition-plan-1',
        planType: 'nutrition',
        studentUid: 'student-1',
        requestText: 'Please add more breakfast variety.',
        status: 'pending',
        createdAt: '2026-06-29T10:00:00.000Z',
      },
    });
  });

  const request = await submitPlanChangeRequest(
    'nutrition-plan-1',
    'nutrition',
    'Please add more breakfast variety.',
    deps
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://server.test/plans/change-requests');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer server-token');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    planId: 'nutrition-plan-1',
    planType: 'nutrition',
    requestText: 'Please add more breakfast variety.',
  });
  assert.deepEqual(request, {
    id: 'request-1',
    planId: 'nutrition-plan-1',
    planType: 'nutrition',
    studentUid: 'student-1',
    requestText: 'Please add more breakfast variety.',
    status: 'pending',
    createdAt: '2026-06-29T10:00:00.000Z',
  });
});

test('getStudentPlanChangeRequests uses the MyChampions server', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deps = makeServerPlanSourceDeps(async (input, init) => {
    calls.push({ url: String(input), init });
    return makeJsonResponse(200, {
      requests: [
        {
          id: 'request-1',
          planId: 'training-plan-1',
          planType: 'training',
          studentUid: 'student-1',
          requestText: 'Please swap squats for leg press.',
          status: 'pending',
          createdAt: '2026-06-29T10:00:00.000Z',
        },
      ],
    });
  });

  const requests = await getStudentPlanChangeRequests('student-1', deps);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://server.test/professional/students/student-1/plan-change-requests');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer server-token');
  assert.deepEqual(requests.map((request) => request.id), ['request-1']);
});

test('getProfessionalPlanChangeRequests uses the MyChampions server pending request endpoint', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deps = makeServerPlanSourceDeps(async (input, init) => {
    calls.push({ url: String(input), init });
    return makeJsonResponse(200, {
      requests: [
        {
          id: 'request-1',
          planId: 'training-plan-1',
          planType: 'training',
          studentUid: 'student-1',
          requestText: 'Please swap squats for leg press.',
          status: 'pending',
          createdAt: '2026-06-29T10:00:00.000Z',
        },
      ],
    });
  });

  const requests = await getProfessionalPlanChangeRequests(deps);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://server.test/professional/plan-change-requests?status=pending');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer server-token');
  assert.deepEqual(requests.map((request) => request.id), ['request-1']);
});

test('reviewPlanChangeRequest uses the MyChampions server', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deps = makeServerPlanSourceDeps(async (input, init) => {
    calls.push({ url: String(input), init });
    return makeJsonResponse(200, { id: 'request-1', status: 'dismissed' });
  });

  const result = await reviewPlanChangeRequest('request-1', 'dismissed', deps);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://server.test/plans/change-requests/request-1/review');
  assert.equal(calls[0].init?.method, 'PATCH');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer server-token');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { status: 'dismissed' });
  assert.deepEqual(result, { id: 'request-1', status: 'dismissed' });
});

test('getMyPlans uses the MyChampions server', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deps = makeServerPlanSourceDeps(async (input, init) => {
    calls.push({ url: String(input), init });
    return makeJsonResponse(200, {
      plans: [
        {
          id: 'nutrition-plan-1',
          planType: 'nutrition',
          sourceKind: 'assigned',
          ownerProfessionalUid: 'professional-1',
          studentUid: 'student-1',
          isArchived: false,
          isDraft: false,
          name: 'High Protein Plan',
          hydrationGoalMl: 2800,
          caloriesTarget: 2200,
          carbsTarget: 210,
          proteinsTarget: 160,
          fatsTarget: 70,
          createdAt: '2026-06-28T10:00:00.000Z',
          updatedAt: '2026-06-29T10:00:00.000Z',
        },
        {
          id: 'training-plan-1',
          planType: 'training',
          sourceKind: 'self_managed',
          ownerProfessionalUid: null,
          studentUid: 'student-1',
          isArchived: false,
          isDraft: false,
          name: 'Upper Strength',
          createdAt: '2026-06-27T10:00:00.000Z',
          updatedAt: '2026-06-28T10:00:00.000Z',
        },
      ],
    });
  });

  const plans = await getMyPlans(deps);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://server.test/plans/my');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer server-token');
  assert.deepEqual(plans.map((plan) => ({ id: plan.id, planType: plan.planType, name: plan.name })), [
    { id: 'nutrition-plan-1', planType: 'nutrition', name: 'High Protein Plan' },
    { id: 'training-plan-1', planType: 'training', name: 'Upper Strength' },
  ]);
});

test('getMyPredefinedPlans uses the MyChampions server', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deps = makeServerPlanSourceDeps(async (input, init) => {
    calls.push({ url: String(input), init });
    return makeJsonResponse(200, {
      plans: [
        {
          id: 'training-template-1',
          planType: 'training',
          name: 'Strength Template',
          ownerProfessionalUid: 'professional-1',
          createdAt: '2026-06-27T10:00:00.000Z',
          updatedAt: '2026-06-29T10:00:00.000Z',
        },
        {
          id: 'nutrition-template-1',
          planType: 'nutrition',
          name: 'Nutrition Template',
          ownerProfessionalUid: 'professional-1',
          createdAt: '2026-06-26T10:00:00.000Z',
          updatedAt: '2026-06-28T10:00:00.000Z',
        },
      ],
    });
  });

  const plans = await getMyPredefinedPlans(deps);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://server.test/plans/predefined');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer server-token');
  assert.deepEqual(plans, [
    {
      id: 'training-template-1',
      planType: 'training',
      name: 'Strength Template',
      ownerProfessionalUid: 'professional-1',
      createdAt: '2026-06-27T10:00:00.000Z',
      updatedAt: '2026-06-29T10:00:00.000Z',
    },
    {
      id: 'nutrition-template-1',
      planType: 'nutrition',
      name: 'Nutrition Template',
      ownerProfessionalUid: 'professional-1',
      createdAt: '2026-06-26T10:00:00.000Z',
      updatedAt: '2026-06-28T10:00:00.000Z',
    },
  ]);
});

test('bulkAssignPredefinedPlan uses the MyChampions server', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deps = makeServerPlanSourceDeps(async (input, init) => {
    calls.push({ url: String(input), init });
    return makeJsonResponse(200, { assignedCount: 2 });
  });

  const result = await bulkAssignPredefinedPlan('template-1', ['student-1', 'student-2'], deps);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://server.test/plans/predefined/template-1/bulk-assign');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer server-token');
  assert.equal((calls[0].init?.headers as Record<string, string>)['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { studentUids: ['student-1', 'student-2'] });
  assert.deepEqual(result, { assignedCount: 2 });
});

test('bulkAssignPredefinedPlan maps subscription-required server responses to a domain source error', async () => {
  const deps = makeServerPlanSourceDeps(async () =>
    makeJsonResponse(402, {
      error: {
        code: 'professional_subscription_required',
        message: 'Professional subscription required.',
      },
    })
  );

  await assert.rejects(
    () => bulkAssignPredefinedPlan('template-1', ['student-1'], deps),
    (error: unknown) =>
      error instanceof PlanSourceError &&
      error.code === 'graphql' &&
      error.message === 'Professional subscription required.'
  );
});

test('createDraftAssignedPlan uses the MyChampions server', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const deps = makeServerPlanSourceDeps(async (input, init) => {
    calls.push({ url: String(input), init });
    return makeJsonResponse(201, {
      plan: {
        id: 'nutrition-draft-1',
        planType: 'nutrition',
        sourceKind: 'assigned',
        ownerProfessionalUid: 'professional-1',
        studentUid: 'student-1',
        isArchived: false,
        isDraft: true,
        name: 'Draft Nutrition',
        hydrationGoalMl: 2800,
        caloriesTarget: 2200,
        carbsTarget: 210,
        proteinsTarget: 160,
        fatsTarget: 70,
        createdAt: '2026-06-29T10:00:00.000Z',
        updatedAt: '2026-06-29T10:00:00.000Z',
      },
    });
  });

  const result = await createDraftAssignedPlan('template-1', 'student-1', deps);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://server.test/plans/predefined/template-1/draft-assignments');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer server-token');
  assert.equal((calls[0].init?.headers as Record<string, string>)['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { studentUid: 'student-1' });
  assert.deepEqual(result, { id: 'nutrition-draft-1' });
});

test('plan source operations fail closed without local server auth outside E2E fixtures', async () => {
  const deps: PlanSourceDeps = {
    getServerBaseUrl: () => 'http://server.test',
    getCurrentAccessToken: async () => null,
    fetchFn: async () => {
      throw new Error('fetch should not be called without a server token');
    },
  };

  await assertRejectsWithConfiguration(getMyPlans(deps), 'Plan list reads');
  await assertRejectsWithConfiguration(getMyPredefinedPlans(deps), 'Predefined plan reads');
  await assertRejectsWithConfiguration(
    bulkAssignPredefinedPlan('template-1', ['student-1'], deps),
    'Predefined bulk assignment'
  );
  await assertRejectsWithConfiguration(
    createDraftAssignedPlan('template-1', 'student-1', deps),
    'Predefined draft assignment'
  );
  await assertRejectsWithConfiguration(
    submitPlanChangeRequest('plan-1', 'nutrition', 'Please adjust this plan.', deps),
    'Plan change request submission'
  );
  await assertRejectsWithConfiguration(
    getStudentPlanChangeRequests('student-1', deps),
    'Plan change request reads'
  );
  await assertRejectsWithConfiguration(
    getProfessionalPlanChangeRequests(deps),
    'Professional plan change request reads'
  );
  await assertRejectsWithConfiguration(
    reviewPlanChangeRequest('request-1', 'dismissed', deps),
    'Plan change request review'
  );
});
