/**
 * Plan Data Connect source — plan CRUD, predefined library, bulk assign.
 * All calls use Firebase Auth ID token in Authorization header.
 * No business logic; normalization delegates to plan-change-request.logic.
 * Refs: D-072, D-080, D-082, FR-211–FR-214, BR-269–BR-272
 */

import Constants from 'expo-constants';
import type { User } from 'firebase/auth';

import {
  normalizePlanChangeRequestStatus,
  normalizePlanType,
  type PlanType,
  type PlanChangeRequest,
  type PlanChangeRequestStatus,
} from './plan-change-request.logic';

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanSourceKind = 'predefined' | 'assigned' | 'self_managed';

export type Plan = {
  id: string;
  planType: PlanType;
  sourceKind: PlanSourceKind;
  ownerProfessionalUid: string | null;
  studentUid: string;
  isArchived: boolean;
  name: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PredefinedPlan = {
  id: string;
  planType: PlanType;
  name: string;
  ownerProfessionalUid: string;
  createdAt: string;
  updatedAt: string;
};

// ─── Transport helpers ────────────────────────────────────────────────────────

type DataConnectExtraConfig = {
  graphqlEndpoint?: string;
  apiKey?: string;
};

type DataConnectGraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type PlanSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class PlanSourceError extends Error {
  code: PlanSourceErrorCode;

  constructor(code: PlanSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PlanSourceError';
  }
}

function resolveConfig(): DataConnectExtraConfig {
  const extra = (Constants.expoConfig?.extra ?? {}) as {
    dataConnect?: DataConnectExtraConfig;
  };
  return extra.dataConnect ?? {};
}

async function gql<T>(
  user: User,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const { graphqlEndpoint, apiKey } = resolveConfig();
  if (!graphqlEndpoint) {
    throw new PlanSourceError(
      'configuration',
      'Data Connect endpoint is not configured. Set EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT.'
    );
  }

  const idToken = await user.getIdToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  };
  if (apiKey) headers['x-goog-api-key'] = apiKey;

  const response = await fetch(graphqlEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new PlanSourceError(
      'network',
      `Data Connect request failed with status ${response.status}.`
    );
  }

  const payload = (await response.json()) as DataConnectGraphQLResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    throw new PlanSourceError(
      'graphql',
      payload.errors[0]?.message ?? 'Data Connect operation failed.'
    );
  }

  if (!payload.data) {
    throw new PlanSourceError(
      'invalid_response',
      'Data Connect operation returned no data payload.'
    );
  }

  return payload.data;
}

// ─── Raw mappers ──────────────────────────────────────────────────────────────

type RawPlan = {
  id?: string | null;
  plan_type?: string | null;
  source_kind?: string | null;
  owner_professional_uid?: string | null;
  student_uid?: string | null;
  is_archived?: boolean | null;
  name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function normalizePlanSourceKind(raw: unknown): PlanSourceKind | null {
  if (raw === 'predefined' || raw === 'assigned' || raw === 'self_managed') return raw;
  return null;
}

function mapRawPlan(raw: RawPlan): Plan | null {
  const planType = normalizePlanType(raw.plan_type);
  const sourceKind = normalizePlanSourceKind(raw.source_kind);
  if (!raw.id || !planType || !sourceKind || !raw.student_uid || !raw.created_at || !raw.updated_at) {
    return null;
  }

  return {
    id: raw.id,
    planType,
    sourceKind,
    ownerProfessionalUid: raw.owner_professional_uid ?? null,
    studentUid: raw.student_uid,
    isArchived: raw.is_archived ?? false,
    name: raw.name ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

// ─── Plan CRUD ────────────────────────────────────────────────────────────────

/** Returns all plans assigned to or managed by the current user. */
export async function getMyPlans(user: User): Promise<Plan[]> {
  const query = `
    query GetMyPlans {
      getMyPlans {
        id
        plan_type
        source_kind
        owner_professional_uid
        student_uid
        is_archived
        name
        created_at
        updated_at
      }
    }
  `;

  const data = await gql<{ getMyPlans?: RawPlan[] | null }>(user, query);

  return (data.getMyPlans ?? []).flatMap((raw) => {
    const plan = mapRawPlan(raw);
    return plan ? [plan] : [];
  });
}

// ─── Predefined plan library ──────────────────────────────────────────────────

/**
 * Returns all predefined plans created by the current professional.
 * Ref: D-072, D-080
 */
export async function getMyPredefinedPlans(user: User): Promise<PredefinedPlan[]> {
  const query = `
    query GetMyPredefinedPlans {
      getMyPredefinedPlans {
        id
        plan_type
        name
        owner_professional_uid
        created_at
        updated_at
      }
    }
  `;

  const data = await gql<{
    getMyPredefinedPlans?: Array<{
      id?: string | null;
      plan_type?: string | null;
      name?: string | null;
      owner_professional_uid?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    }> | null;
  }>(user, query);

  return (data.getMyPredefinedPlans ?? []).flatMap((raw) => {
    const planType = normalizePlanType(raw.plan_type);
    if (!raw.id || !planType || !raw.name || !raw.owner_professional_uid || !raw.created_at || !raw.updated_at) {
      return [];
    }
    return [
      {
        id: raw.id,
        planType,
        name: raw.name,
        ownerProfessionalUid: raw.owner_professional_uid,
        createdAt: raw.created_at,
        updatedAt: raw.updated_at,
      } satisfies PredefinedPlan,
    ];
  });
}

/**
 * Bulk assigns a predefined plan to a list of students.
 * Each student receives an independent per-student copy (D-082).
 * Ref: D-080, D-082, FR-214
 */
export async function bulkAssignPredefinedPlan(
  user: User,
  predefinedPlanId: string,
  studentUids: string[]
): Promise<{ assignedCount: number }> {
  const mutation = `
    mutation BulkAssignPredefinedPlan($predefined_plan_id: UUID!, $student_uids: [String!]!) {
      bulkAssignPredefinedPlan(predefined_plan_id: $predefined_plan_id, student_uids: $student_uids) {
        assigned_count
      }
    }
  `;

  const data = await gql<{
    bulkAssignPredefinedPlan?: { assigned_count?: number | null } | null;
  }>(user, mutation, {
    predefined_plan_id: predefinedPlanId,
    student_uids: studentUids,
  });

  const count = data.bulkAssignPredefinedPlan?.assigned_count;
  if (count == null) {
    throw new PlanSourceError(
      'invalid_response',
      'bulkAssignPredefinedPlan returned no count.'
    );
  }

  return { assignedCount: count };
}

// ─── Plan change requests ─────────────────────────────────────────────────────

/**
 * Student submits an advisory plan change request on their assigned plan.
 * Does not mutate the plan (D-071).
 * Ref: FR-211, BR-269, AC-255
 */
export async function submitPlanChangeRequest(
  user: User,
  planId: string,
  requestText: string
): Promise<PlanChangeRequest> {
  const mutation = `
    mutation SubmitPlanChangeRequest($plan_id: UUID!, $request_text: String!) {
      submitPlanChangeRequest(plan_id: $plan_id, request_text: $request_text) {
        id
        plan_id
        plan_type
        student_uid
        request_text
        status
        created_at
      }
    }
  `;

  const data = await gql<{
    submitPlanChangeRequest?: {
      id?: string | null;
      plan_id?: string | null;
      plan_type?: string | null;
      student_uid?: string | null;
      request_text?: string | null;
      status?: string | null;
      created_at?: string | null;
    } | null;
  }>(user, mutation, { plan_id: planId, request_text: requestText });

  const raw = data.submitPlanChangeRequest;
  const planType = normalizePlanType(raw?.plan_type);
  const status = normalizePlanChangeRequestStatus(raw?.status) as PlanChangeRequestStatus;

  if (!raw?.id || !raw.plan_id || !planType || !raw.student_uid || !raw.request_text || !status || !raw.created_at) {
    throw new PlanSourceError(
      'invalid_response',
      'submitPlanChangeRequest returned incomplete request.'
    );
  }

  return {
    id: raw.id,
    planId: raw.plan_id,
    planType,
    studentUid: raw.student_uid,
    requestText: raw.request_text,
    status,
    createdAt: raw.created_at,
  };
}

/**
 * Returns all plan change requests submitted by a given student.
 * Called from professional context to triage requests in SC-206.
 * Advisory only — does not grant plan-edit rights (D-071, BR-269).
 */
export async function getStudentPlanChangeRequests(
  user: User,
  studentUid: string
): Promise<PlanChangeRequest[]> {
  const query = `
    query GetStudentPlanChangeRequests($student_uid: String!) {
      getStudentPlanChangeRequests(student_uid: $student_uid) {
        id
        plan_id
        plan_type
        student_uid
        request_text
        status
        created_at
      }
    }
  `;

  const data = await gql<{
    getStudentPlanChangeRequests?: Array<{
      id?: string | null;
      plan_id?: string | null;
      plan_type?: string | null;
      student_uid?: string | null;
      request_text?: string | null;
      status?: string | null;
      created_at?: string | null;
    }> | null;
  }>(user, query, { student_uid: studentUid });

  return (data.getStudentPlanChangeRequests ?? []).flatMap((raw) => {
    const planType = normalizePlanType(raw.plan_type);
    const status = normalizePlanChangeRequestStatus(raw.status);
    if (
      !raw.id ||
      !raw.plan_id ||
      !planType ||
      !raw.student_uid ||
      !raw.request_text ||
      !status ||
      !raw.created_at
    ) {
      return [];
    }
    return [
      {
        id: raw.id,
        planId: raw.plan_id,
        planType,
        studentUid: raw.student_uid,
        requestText: raw.request_text,
        status,
        createdAt: raw.created_at,
      } satisfies PlanChangeRequest,
    ];
  });
}

/**
 * Professional reviews (or dismisses) a plan change request.
 * Advisory only — does not modify the plan (D-071).
 */
export async function reviewPlanChangeRequest(
  user: User,
  requestId: string,
  action: 'reviewed' | 'dismissed'
): Promise<{ id: string; status: PlanChangeRequestStatus }> {
  const mutation = `
    mutation ReviewPlanChangeRequest($request_id: UUID!, $action: String!) {
      reviewPlanChangeRequest(request_id: $request_id, action: $action) {
        id
        status
      }
    }
  `;

  const data = await gql<{
    reviewPlanChangeRequest?: { id?: string | null; status?: string | null } | null;
  }>(user, mutation, { request_id: requestId, action });

  const id = data.reviewPlanChangeRequest?.id;
  const status = normalizePlanChangeRequestStatus(data.reviewPlanChangeRequest?.status);

  if (!id || !status) {
    throw new PlanSourceError(
      'invalid_response',
      'reviewPlanChangeRequest returned no result.'
    );
  }

  return { id, status };
}
