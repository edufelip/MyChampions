/**
 * Plan builder Data Connect source — nutrition and training plan CRUD,
 * starter template library, and food search stub.
 *
 * All Data Connect calls are intentionally stubbed — endpoints are not yet live.
 * Food search (fatsecret) returns an empty array stub (D-113).
 * Starter template operations are wired to Data Connect generated SDK (D-114).
 *
 * Deferred wiring tracked in docs/discovery/pending-wiring-checklist-v1.md.
 * Refs: D-111–D-114, FR-240–FR-248, BR-291–BR-296
 */

import Constants from 'expo-constants';
import type { User } from 'firebase/auth';
import {
  getNutritionTemplates as _getNutritionTemplates,
  getTrainingTemplates as _getTrainingTemplates,
  cloneAsNutritionPlan as _cloneAsNutritionPlan,
  cloneAsTrainingPlan as _cloneAsTrainingPlan,
  type GetNutritionTemplatesData,
  type GetTrainingTemplatesData,
  type CloneAsNutritionPlanData,
  type CloneAsNutritionPlanVariables,
  type CloneAsTrainingPlanData,
  type CloneAsTrainingPlanVariables,
} from '@mychampions/dataconnect-generated';
import type { DataConnect } from 'firebase/data-connect';
import { getDataConnectInstance as _getDataConnectInstance } from '../dataconnect';

import type {
  NutritionPlanInput,
  NutritionMealItem,
  NutritionMealItemInput,
  TrainingPlanInput,
  TrainingSession,
  TrainingSessionInput,
  TrainingSessionItem,
  TrainingSessionItemInput,
  StarterTemplate,
} from './plan-builder.logic';
import {
  deriveStarterTemplatePlanType,
  coalesceTemplateDescription,
} from './plan-builder.logic';
import type { PlanType } from './plan-change-request.logic';

// ─── Transport helpers (mirrors plan-source.ts pattern) ───────────────────────

type DataConnectExtraConfig = {
  graphqlEndpoint?: string;
  apiKey?: string;
};

type DataConnectGraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type PlanBuilderSourceErrorCode =
  | 'configuration'
  | 'network'
  | 'graphql'
  | 'invalid_response';

export class PlanBuilderSourceError extends Error {
  code: PlanBuilderSourceErrorCode;

  constructor(code: PlanBuilderSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'PlanBuilderSourceError';
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
    throw new PlanBuilderSourceError(
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
    throw new PlanBuilderSourceError(
      'network',
      `Data Connect request failed with status ${response.status}.`
    );
  }

  const payload = (await response.json()) as DataConnectGraphQLResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    throw new PlanBuilderSourceError(
      'graphql',
      payload.errors[0]?.message ?? 'Data Connect operation failed.'
    );
  }

  if (!payload.data) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'Data Connect operation returned no data payload.'
    );
  }

  return payload.data;
}

// ─── Nutrition plan result types ──────────────────────────────────────────────

export type NutritionPlanDetail = {
  id: string;
  name: string;
  caloriesTarget: number;
  carbsTarget: number;
  proteinsTarget: number;
  fatsTarget: number;
  items: NutritionMealItem[];
  createdAt: string;
  updatedAt: string;
};

// ─── Training plan result types ───────────────────────────────────────────────

export type TrainingPlanDetail = {
  id: string;
  name: string;
  sessions: TrainingSession[];
  createdAt: string;
  updatedAt: string;
};

// ─── Food search types ────────────────────────────────────────────────────────

export type FoodSearchResult = {
  id: string;
  name: string;
  caloriesPer100g: number;
  carbsPer100g: number;
  proteinsPer100g: number;
  fatsPer100g: number;
};

// ─── Nutrition plan CRUD ──────────────────────────────────────────────────────

/**
 * Creates a new named predefined nutrition plan in the professional's library.
 * Stub: endpoint wiring deferred per pending-wiring-checklist-v1.md.
 * Refs: FR-240, FR-241, BR-291, BR-292
 */
export async function createNutritionPlan(
  user: User,
  input: NutritionPlanInput
): Promise<NutritionPlanDetail> {
  const mutation = `
    mutation CreateNutritionPlan(
      $name: String!
      $calories_target: Float!
      $carbs_target: Float!
      $proteins_target: Float!
      $fats_target: Float!
    ) {
      createNutritionPlan(
        name: $name
        calories_target: $calories_target
        carbs_target: $carbs_target
        proteins_target: $proteins_target
        fats_target: $fats_target
      ) {
        id
        name
        calories_target
        carbs_target
        proteins_target
        fats_target
        created_at
        updated_at
      }
    }
  `;

  const data = await gql<{
    createNutritionPlan?: {
      id?: string | null;
      name?: string | null;
      calories_target?: number | null;
      carbs_target?: number | null;
      proteins_target?: number | null;
      fats_target?: number | null;
      created_at?: string | null;
      updated_at?: string | null;
    } | null;
  }>(user, mutation, {
    name: input.name.trim(),
    calories_target: parseFloat(input.caloriesTarget) || 0,
    carbs_target: parseFloat(input.carbsTarget) || 0,
    proteins_target: parseFloat(input.proteinsTarget) || 0,
    fats_target: parseFloat(input.fatsTarget) || 0,
  });

  const raw = data.createNutritionPlan;
  if (!raw?.id || !raw.name || !raw.created_at || !raw.updated_at) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'createNutritionPlan returned incomplete data.'
    );
  }

  return {
    id: raw.id,
    name: raw.name,
    caloriesTarget: raw.calories_target ?? 0,
    carbsTarget: raw.carbs_target ?? 0,
    proteinsTarget: raw.proteins_target ?? 0,
    fatsTarget: raw.fats_target ?? 0,
    items: [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * Updates an existing nutrition plan's metadata (name, calorie/macro targets).
 * Stub: endpoint wiring deferred.
 */
export async function updateNutritionPlan(
  user: User,
  planId: string,
  input: NutritionPlanInput
): Promise<void> {
  const mutation = `
    mutation UpdateNutritionPlan(
      $plan_id: UUID!
      $name: String!
      $calories_target: Float!
      $carbs_target: Float!
      $proteins_target: Float!
      $fats_target: Float!
    ) {
      updateNutritionPlan(
        plan_id: $plan_id
        name: $name
        calories_target: $calories_target
        carbs_target: $carbs_target
        proteins_target: $proteins_target
        fats_target: $fats_target
      ) {
        id
      }
    }
  `;

  await gql<{ updateNutritionPlan?: { id?: string | null } | null }>(user, mutation, {
    plan_id: planId,
    name: input.name.trim(),
    calories_target: parseFloat(input.caloriesTarget) || 0,
    carbs_target: parseFloat(input.carbsTarget) || 0,
    proteins_target: parseFloat(input.proteinsTarget) || 0,
    fats_target: parseFloat(input.fatsTarget) || 0,
  });
}

/**
 * Fetches full nutrition plan detail including items.
 * Stub: endpoint wiring deferred.
 */
export async function getNutritionPlanDetail(
  user: User,
  planId: string
): Promise<NutritionPlanDetail> {
  const query = `
    query GetNutritionPlanDetail($plan_id: UUID!) {
      getNutritionPlanDetail(plan_id: $plan_id) {
        id
        name
        calories_target
        carbs_target
        proteins_target
        fats_target
        created_at
        updated_at
        items {
          id
          name
          quantity
          notes
        }
      }
    }
  `;

  const data = await gql<{
    getNutritionPlanDetail?: {
      id?: string | null;
      name?: string | null;
      calories_target?: number | null;
      carbs_target?: number | null;
      proteins_target?: number | null;
      fats_target?: number | null;
      created_at?: string | null;
      updated_at?: string | null;
      items?: Array<{
        id?: string | null;
        name?: string | null;
        quantity?: string | null;
        notes?: string | null;
      }> | null;
    } | null;
  }>(user, query, { plan_id: planId });

  const raw = data.getNutritionPlanDetail;
  if (!raw?.id || !raw.name || !raw.created_at || !raw.updated_at) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'getNutritionPlanDetail returned incomplete data.'
    );
  }

  const items: NutritionMealItem[] = (raw.items ?? []).flatMap((item) => {
    if (!item.id || !item.name) return [];
    return [{ id: item.id, name: item.name, quantity: item.quantity ?? '', notes: item.notes ?? '' }];
  });

  return {
    id: raw.id,
    name: raw.name,
    caloriesTarget: raw.calories_target ?? 0,
    carbsTarget: raw.carbs_target ?? 0,
    proteinsTarget: raw.proteins_target ?? 0,
    fatsTarget: raw.fats_target ?? 0,
    items,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * Adds a food item to an existing nutrition plan.
 * Stub: endpoint wiring deferred.
 * Refs: FR-242
 */
export async function addNutritionMealItem(
  user: User,
  planId: string,
  item: NutritionMealItemInput
): Promise<NutritionMealItem> {
  const mutation = `
    mutation AddNutritionMealItem($plan_id: UUID!, $name: String!, $quantity: String!, $notes: String!) {
      addNutritionMealItem(plan_id: $plan_id, name: $name, quantity: $quantity, notes: $notes) {
        id
        name
        quantity
        notes
      }
    }
  `;

  const data = await gql<{
    addNutritionMealItem?: {
      id?: string | null;
      name?: string | null;
      quantity?: string | null;
      notes?: string | null;
    } | null;
  }>(user, mutation, {
    plan_id: planId,
    name: item.name.trim(),
    quantity: item.quantity.trim(),
    notes: item.notes.trim(),
  });

  const raw = data.addNutritionMealItem;
  if (!raw?.id || !raw.name) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'addNutritionMealItem returned incomplete data.'
    );
  }

  return { id: raw.id, name: raw.name, quantity: raw.quantity ?? '', notes: raw.notes ?? '' };
}

/**
 * Removes a food item from a nutrition plan.
 * Stub: endpoint wiring deferred.
 */
export async function removeNutritionMealItem(
  user: User,
  planId: string,
  itemId: string
): Promise<void> {
  const mutation = `
    mutation RemoveNutritionMealItem($plan_id: UUID!, $item_id: UUID!) {
      removeNutritionMealItem(plan_id: $plan_id, item_id: $item_id) {
        success
      }
    }
  `;

  await gql<{ removeNutritionMealItem?: { success?: boolean | null } | null }>(
    user,
    mutation,
    { plan_id: planId, item_id: itemId }
  );
}

// ─── Training plan CRUD ───────────────────────────────────────────────────────

/**
 * Creates a new named predefined training plan in the professional's library.
 * Stub: endpoint wiring deferred.
 * Refs: FR-244, BR-293
 */
export async function createTrainingPlan(
  user: User,
  input: TrainingPlanInput
): Promise<TrainingPlanDetail> {
  const mutation = `
    mutation CreateTrainingPlan($name: String!) {
      createTrainingPlan(name: $name) {
        id
        name
        created_at
        updated_at
      }
    }
  `;

  const data = await gql<{
    createTrainingPlan?: {
      id?: string | null;
      name?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
    } | null;
  }>(user, mutation, { name: input.name.trim() });

  const raw = data.createTrainingPlan;
  if (!raw?.id || !raw.name || !raw.created_at || !raw.updated_at) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'createTrainingPlan returned incomplete data.'
    );
  }

  return {
    id: raw.id,
    name: raw.name,
    sessions: [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * Updates an existing training plan's name.
 * Stub: endpoint wiring deferred.
 */
export async function updateTrainingPlan(
  user: User,
  planId: string,
  input: TrainingPlanInput
): Promise<void> {
  const mutation = `
    mutation UpdateTrainingPlan($plan_id: UUID!, $name: String!) {
      updateTrainingPlan(plan_id: $plan_id, name: $name) {
        id
      }
    }
  `;

  await gql<{ updateTrainingPlan?: { id?: string | null } | null }>(user, mutation, {
    plan_id: planId,
    name: input.name.trim(),
  });
}

/**
 * Fetches full training plan detail including sessions and session items.
 * Stub: endpoint wiring deferred.
 */
export async function getTrainingPlanDetail(
  user: User,
  planId: string
): Promise<TrainingPlanDetail> {
  const query = `
    query GetTrainingPlanDetail($plan_id: UUID!) {
      getTrainingPlanDetail(plan_id: $plan_id) {
        id
        name
        created_at
        updated_at
        sessions {
          id
          name
          notes
          items {
            id
            name
            quantity
            notes
          }
        }
      }
    }
  `;

  const data = await gql<{
    getTrainingPlanDetail?: {
      id?: string | null;
      name?: string | null;
      created_at?: string | null;
      updated_at?: string | null;
      sessions?: Array<{
        id?: string | null;
        name?: string | null;
        notes?: string | null;
        items?: Array<{
          id?: string | null;
          name?: string | null;
          quantity?: string | null;
          notes?: string | null;
        }> | null;
      }> | null;
    } | null;
  }>(user, query, { plan_id: planId });

  const raw = data.getTrainingPlanDetail;
  if (!raw?.id || !raw.name || !raw.created_at || !raw.updated_at) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'getTrainingPlanDetail returned incomplete data.'
    );
  }

  const sessions: TrainingSession[] = (raw.sessions ?? []).flatMap((s) => {
    if (!s.id || !s.name) return [];
    const items: TrainingSessionItem[] = (s.items ?? []).flatMap((item) => {
      if (!item.id || !item.name) return [];
      return [{ id: item.id, name: item.name, quantity: item.quantity ?? '', notes: item.notes ?? '' }];
    });
    return [{ id: s.id, name: s.name, notes: s.notes ?? '', items }];
  });

  return {
    id: raw.id,
    name: raw.name,
    sessions,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

/**
 * Adds a session to a training plan.
 * Stub: endpoint wiring deferred.
 * Refs: FR-245
 */
export async function addTrainingSession(
  user: User,
  planId: string,
  session: TrainingSessionInput
): Promise<TrainingSession> {
  const mutation = `
    mutation AddTrainingSession($plan_id: UUID!, $name: String!, $notes: String!) {
      addTrainingSession(plan_id: $plan_id, name: $name, notes: $notes) {
        id
        name
        notes
      }
    }
  `;

  const data = await gql<{
    addTrainingSession?: {
      id?: string | null;
      name?: string | null;
      notes?: string | null;
    } | null;
  }>(user, mutation, {
    plan_id: planId,
    name: session.name.trim(),
    notes: session.notes.trim(),
  });

  const raw = data.addTrainingSession;
  if (!raw?.id || !raw.name) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'addTrainingSession returned incomplete data.'
    );
  }

  return { id: raw.id, name: raw.name, notes: raw.notes ?? '', items: [] };
}

/**
 * Removes a session from a training plan.
 * Stub: endpoint wiring deferred.
 */
export async function removeTrainingSession(
  user: User,
  planId: string,
  sessionId: string
): Promise<void> {
  const mutation = `
    mutation RemoveTrainingSession($plan_id: UUID!, $session_id: UUID!) {
      removeTrainingSession(plan_id: $plan_id, session_id: $session_id) {
        success
      }
    }
  `;

  await gql<{ removeTrainingSession?: { success?: boolean | null } | null }>(
    user,
    mutation,
    { plan_id: planId, session_id: sessionId }
  );
}

/**
 * Adds a custom item to a training session.
 * Stub: endpoint wiring deferred.
 * Refs: FR-246, BR-294
 */
export async function addTrainingSessionItem(
  user: User,
  sessionId: string,
  item: TrainingSessionItemInput
): Promise<TrainingSessionItem> {
  const mutation = `
    mutation AddTrainingSessionItem($session_id: UUID!, $name: String!, $quantity: String!, $notes: String!) {
      addTrainingSessionItem(session_id: $session_id, name: $name, quantity: $quantity, notes: $notes) {
        id
        name
        quantity
        notes
      }
    }
  `;

  const data = await gql<{
    addTrainingSessionItem?: {
      id?: string | null;
      name?: string | null;
      quantity?: string | null;
      notes?: string | null;
    } | null;
  }>(user, mutation, {
    session_id: sessionId,
    name: item.name.trim(),
    quantity: item.quantity.trim(),
    notes: item.notes.trim(),
  });

  const raw = data.addTrainingSessionItem;
  if (!raw?.id || !raw.name) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'addTrainingSessionItem returned incomplete data.'
    );
  }

  return { id: raw.id, name: raw.name, quantity: raw.quantity ?? '', notes: raw.notes ?? '' };
}

/**
 * Removes a custom item from a training session.
 * Stub: endpoint wiring deferred.
 */
export async function removeTrainingSessionItem(
  user: User,
  sessionId: string,
  itemId: string
): Promise<void> {
  const mutation = `
    mutation RemoveTrainingSessionItem($session_id: UUID!, $item_id: UUID!) {
      removeTrainingSessionItem(session_id: $session_id, item_id: $item_id) {
        success
      }
    }
  `;

  await gql<{ removeTrainingSessionItem?: { success?: boolean | null } | null }>(
    user,
    mutation,
    { session_id: sessionId, item_id: itemId }
  );
}

// ─── Starter templates ────────────────────────────────────────────────────────

/**
 * Injectable dependencies for starter template operations.
 * Production code uses real SDK defaults; tests inject mocks.
 * Uses explicit single-overload signatures to avoid TypeScript overload-resolution
 * issues when mocking in tests.
 * Refs: D-114
 */
export type StarterTemplateDeps = {
  getNutritionTemplates: (dc: DataConnect) => Promise<{ data: GetNutritionTemplatesData }>;
  getTrainingTemplates: (dc: DataConnect) => Promise<{ data: GetTrainingTemplatesData }>;
  cloneAsNutritionPlan: (dc: DataConnect, vars: CloneAsNutritionPlanVariables) => Promise<{ data: CloneAsNutritionPlanData }>;
  cloneAsTrainingPlan: (dc: DataConnect, vars: CloneAsTrainingPlanVariables) => Promise<{ data: CloneAsTrainingPlanData }>;
  getDataConnectInstance: () => DataConnect;
};

const defaultStarterTemplateDeps: StarterTemplateDeps = {
  getNutritionTemplates: _getNutritionTemplates,
  getTrainingTemplates: _getTrainingTemplates,
  cloneAsNutritionPlan: _cloneAsNutritionPlan,
  cloneAsTrainingPlan: _cloneAsTrainingPlan,
  getDataConnectInstance: _getDataConnectInstance,
};

/**
 * Returns starter templates for a given plan type from Data Connect.
 * Refs: D-114, FR-247, BR-270, BR-295
 */
export async function getStarterTemplates(
  planType: PlanType,
  deps: StarterTemplateDeps = defaultStarterTemplateDeps
): Promise<StarterTemplate[]> {
  const dc = deps.getDataConnectInstance();
  const { data } = await (planType === 'nutrition'
    ? deps.getNutritionTemplates(dc)
    : deps.getTrainingTemplates(dc));

  return data.starterTemplates.map((t) => ({
    id: t.id,
    planType: planType,
    name: t.name,
    description: coalesceTemplateDescription(t.description),
  }));
}

/**
 * Clones a starter template into a new editable plan draft via Data Connect.
 * Dispatches to CloneAsNutritionPlan or CloneAsTrainingPlan based on templateId prefix.
 * Refs: D-114, FR-247, BR-270, BR-295, TC-280
 */
export async function cloneStarterTemplate(
  user: User,
  templateId: string,
  name: string,
  deps: StarterTemplateDeps = defaultStarterTemplateDeps
): Promise<{ id: string; planType: PlanType; name: string }> {
  // Derive planType from the starter template ID prefix via pure helper (testable separately)
  const planType = deriveStarterTemplatePlanType(templateId);

  if (!planType) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      `Cannot derive planType from templateId: ${templateId}`
    );
  }

  const dc = deps.getDataConnectInstance();
  const professionalId = user.uid;

  const { data } = await (planType === 'nutrition'
    ? deps.cloneAsNutritionPlan(dc, { professionalId, sourceTemplateId: templateId, name })
    : deps.cloneAsTrainingPlan(dc, { professionalId, sourceTemplateId: templateId, name }));

  const key = planType === 'nutrition'
    ? (data as { nutritionPlan_insert: { id: string } }).nutritionPlan_insert
    : (data as { trainingPlan_insert: { id: string } }).trainingPlan_insert;

  if (!key?.id) {
    throw new PlanBuilderSourceError(
      'invalid_response',
      'cloneStarterTemplate returned no plan ID.'
    );
  }

  return { id: key.id, planType, name };
}

// ─── Food search stub ─────────────────────────────────────────────────────────

/**
 * Searches fatsecret food database for matching items.
 * Stub: always returns empty array. Fatsecret wiring is deferred (D-113).
 * Refs: FR-243
 */
export async function searchFoods(
  _query: string
): Promise<FoodSearchResult[]> {
  // Fatsecret API wiring deferred — tracked in pending-wiring-checklist-v1.md
  return [];
}
