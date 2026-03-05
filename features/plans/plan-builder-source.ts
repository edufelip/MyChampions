/**
 * Plan builder Data Connect source — nutrition and training plan CRUD,
 * starter template library, and food search via Cloud Function proxy.
 *
 * All Data Connect operations use the Firebase Data Connect generated SDK (D-114, D-126).
 * Food search (fatsecret) is proxied through a Firebase Cloud Function (D-113, D-127).
 *
 * Refs: D-111–D-114, D-126, D-127, FR-240–FR-248, BR-291–BR-296
 */

import {
  getNutritionTemplates as _getNutritionTemplates,
  getTrainingTemplates as _getTrainingTemplates,
  cloneAsNutritionPlan as _cloneAsNutritionPlan,
  cloneAsTrainingPlan as _cloneAsTrainingPlan,
  createNutritionPlan as _createNutritionPlan,
  updateNutritionPlan as _updateNutritionPlan,
  getNutritionPlanDetail as _getNutritionPlanDetail,
  addNutritionMealItem as _addNutritionMealItem,
  removeNutritionMealItem as _removeNutritionMealItem,
  createTrainingPlan as _createTrainingPlan,
  updateTrainingPlan as _updateTrainingPlan,
  getTrainingPlanDetail as _getTrainingPlanDetail,
  addTrainingSession as _addTrainingSession,
  removeTrainingSession as _removeTrainingSession,
  addTrainingSessionItem as _addTrainingSessionItem,
  removeTrainingSessionItem as _removeTrainingSessionItem,
  type GetNutritionTemplatesData,
  type GetTrainingTemplatesData,
  type CloneAsNutritionPlanData,
  type CloneAsNutritionPlanVariables,
  type CloneAsTrainingPlanData,
  type CloneAsTrainingPlanVariables,
  type CreateNutritionPlanData,
  type CreateNutritionPlanVariables,
  type UpdateNutritionPlanData,
  type UpdateNutritionPlanVariables,
  type GetNutritionPlanDetailData,
  type GetNutritionPlanDetailVariables,
  type AddNutritionMealItemData,
  type AddNutritionMealItemVariables,
  type RemoveNutritionMealItemData,
  type RemoveNutritionMealItemVariables,
  type CreateTrainingPlanData,
  type CreateTrainingPlanVariables,
  type UpdateTrainingPlanData,
  type UpdateTrainingPlanVariables,
  type GetTrainingPlanDetailData,
  type GetTrainingPlanDetailVariables,
  type AddTrainingSessionData,
  type AddTrainingSessionVariables,
  type RemoveTrainingSessionData,
  type RemoveTrainingSessionVariables,
  type AddTrainingSessionItemData,
  type AddTrainingSessionItemVariables,
  type RemoveTrainingSessionItemData,
  type RemoveTrainingSessionItemVariables,
} from '@mychampions/dataconnect-generated';
import type { DataConnect } from 'firebase/data-connect';
import { getDataConnectInstance as _getDataConnectInstance } from '../dataconnect';
import { getFirebaseAuth } from '../auth/firebase';
import { searchFoodsFromSource } from '../nutrition/food-search-source';

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
  FoodSearchResult,
} from './plan-builder.logic';
import {
  deriveStarterTemplatePlanType,
  coalesceTemplateDescription,
} from './plan-builder.logic';
import type { PlanType } from './plan-change-request.logic';

// ─── Error types ──────────────────────────────────────────────────────────────

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

// Re-exported from plan-builder.logic for backward-compatible consumer imports.
export type { FoodSearchResult } from './plan-builder.logic';

// ─── Injectable deps ──────────────────────────────────────────────────────────

/**
 * Injectable dependencies for all plan builder operations.
 * Production code uses real SDK defaults; tests inject mocks.
 * Refs: D-114, D-126
 */
export type PlanBuilderSourceDeps = {
  // Nutrition plan CRUD
  createNutritionPlan: (dc: DataConnect, vars: CreateNutritionPlanVariables) => Promise<{ data: CreateNutritionPlanData }>;
  updateNutritionPlan: (dc: DataConnect, vars: UpdateNutritionPlanVariables) => Promise<{ data: UpdateNutritionPlanData }>;
  getNutritionPlanDetail: (dc: DataConnect, vars: GetNutritionPlanDetailVariables) => Promise<{ data: GetNutritionPlanDetailData }>;
  addNutritionMealItem: (dc: DataConnect, vars: AddNutritionMealItemVariables) => Promise<{ data: AddNutritionMealItemData }>;
  removeNutritionMealItem: (dc: DataConnect, vars: RemoveNutritionMealItemVariables) => Promise<{ data: RemoveNutritionMealItemData }>;
  // Training plan CRUD
  createTrainingPlan: (dc: DataConnect, vars: CreateTrainingPlanVariables) => Promise<{ data: CreateTrainingPlanData }>;
  updateTrainingPlan: (dc: DataConnect, vars: UpdateTrainingPlanVariables) => Promise<{ data: UpdateTrainingPlanData }>;
  getTrainingPlanDetail: (dc: DataConnect, vars: GetTrainingPlanDetailVariables) => Promise<{ data: GetTrainingPlanDetailData }>;
  addTrainingSession: (dc: DataConnect, vars: AddTrainingSessionVariables) => Promise<{ data: AddTrainingSessionData }>;
  removeTrainingSession: (dc: DataConnect, vars: RemoveTrainingSessionVariables) => Promise<{ data: RemoveTrainingSessionData }>;
  addTrainingSessionItem: (dc: DataConnect, vars: AddTrainingSessionItemVariables) => Promise<{ data: AddTrainingSessionItemData }>;
  removeTrainingSessionItem: (dc: DataConnect, vars: RemoveTrainingSessionItemVariables) => Promise<{ data: RemoveTrainingSessionItemData }>;
  // Starter templates
  getNutritionTemplates: (dc: DataConnect) => Promise<{ data: GetNutritionTemplatesData }>;
  getTrainingTemplates: (dc: DataConnect) => Promise<{ data: GetTrainingTemplatesData }>;
  cloneAsNutritionPlan: (dc: DataConnect, vars: CloneAsNutritionPlanVariables) => Promise<{ data: CloneAsNutritionPlanData }>;
  cloneAsTrainingPlan: (dc: DataConnect, vars: CloneAsTrainingPlanVariables) => Promise<{ data: CloneAsTrainingPlanData }>;
  // DC singleton
  getDataConnectInstance: () => DataConnect;
};

/**
 * @deprecated Use PlanBuilderSourceDeps instead.
 * Kept for backward compatibility — starter template tests may reference this name.
 */
export type StarterTemplateDeps = PlanBuilderSourceDeps;

const defaultDeps: PlanBuilderSourceDeps = {
  createNutritionPlan: _createNutritionPlan,
  updateNutritionPlan: _updateNutritionPlan,
  getNutritionPlanDetail: _getNutritionPlanDetail,
  addNutritionMealItem: _addNutritionMealItem,
  removeNutritionMealItem: _removeNutritionMealItem,
  createTrainingPlan: _createTrainingPlan,
  updateTrainingPlan: _updateTrainingPlan,
  getTrainingPlanDetail: _getTrainingPlanDetail,
  addTrainingSession: _addTrainingSession,
  removeTrainingSession: _removeTrainingSession,
  addTrainingSessionItem: _addTrainingSessionItem,
  removeTrainingSessionItem: _removeTrainingSessionItem,
  getNutritionTemplates: _getNutritionTemplates,
  getTrainingTemplates: _getTrainingTemplates,
  cloneAsNutritionPlan: _cloneAsNutritionPlan,
  cloneAsTrainingPlan: _cloneAsTrainingPlan,
  getDataConnectInstance: _getDataConnectInstance,
};

// ─── Mappers ──────────────────────────────────────────────────────────────────

function mapNutritionPlanDetail(raw: GetNutritionPlanDetailData['nutritionPlan']): NutritionPlanDetail {
  if (!raw) {
    throw new PlanBuilderSourceError('invalid_response', 'getNutritionPlanDetail returned no plan.');
  }

  const items: NutritionMealItem[] = (raw.meals ?? []).map((meal) => ({
    id: meal.id,
    name: meal.foodName,
    quantity: '',
    notes: '',
  }));

  return {
    id: raw.id,
    name: raw.name,
    caloriesTarget: raw.caloriesTarget ?? 0,
    carbsTarget: raw.carbsTarget ?? 0,
    proteinsTarget: raw.proteinsTarget ?? 0,
    fatsTarget: raw.fatsTarget ?? 0,
    items,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function mapTrainingPlanDetail(raw: GetTrainingPlanDetailData['trainingPlan']): TrainingPlanDetail {
  if (!raw) {
    throw new PlanBuilderSourceError('invalid_response', 'getTrainingPlanDetail returned no plan.');
  }

  const sessions: TrainingSession[] = (raw.sessions ?? []).map((s) => {
    const items: TrainingSessionItem[] = (s.items ?? []).map((item) => ({
      id: item.id,
      name: item.exerciseName,
      quantity: '',
      notes: '',
    }));
    return { id: s.id, name: s.sessionName, notes: '', items };
  });

  return {
    id: raw.id,
    name: raw.name,
    sessions,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

// ─── Nutrition plan CRUD ──────────────────────────────────────────────────────

/**
 * Creates a new named predefined nutrition plan in the professional's library.
 * Refs: FR-240, FR-241, BR-291, BR-292
 */
export async function createNutritionPlan(
  input: NutritionPlanInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<NutritionPlanDetail> {
  const dc = deps.getDataConnectInstance();
  const { data: createData } = await deps.createNutritionPlan(dc, {
    name: input.name.trim(),
    caloriesTarget: parseFloat(input.caloriesTarget) || 0,
    carbsTarget: parseFloat(input.carbsTarget) || 0,
    proteinsTarget: parseFloat(input.proteinsTarget) || 0,
    fatsTarget: parseFloat(input.fatsTarget) || 0,
  });

  const planId = createData.nutritionPlan_insert.id;
  const { data: detailData } = await deps.getNutritionPlanDetail(dc, { planId: planId });
  return mapNutritionPlanDetail(detailData.nutritionPlan);
}

/**
 * Updates an existing nutrition plan's metadata (name, calorie/macro targets).
 */
export async function updateNutritionPlan(
  planId: string,
  input: NutritionPlanInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  const dc = deps.getDataConnectInstance();
  await deps.updateNutritionPlan(dc, {
    planId: planId,
    name: input.name.trim(),
    caloriesTarget: parseFloat(input.caloriesTarget) || 0,
    carbsTarget: parseFloat(input.carbsTarget) || 0,
    proteinsTarget: parseFloat(input.proteinsTarget) || 0,
    fatsTarget: parseFloat(input.fatsTarget) || 0,
  });
}

/**
 * Fetches full nutrition plan detail including items.
 */
export async function getNutritionPlanDetail(
  planId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<NutritionPlanDetail> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getNutritionPlanDetail(dc, { planId: planId });
  return mapNutritionPlanDetail(data.nutritionPlan);
}

/**
 * Adds a food item to an existing nutrition plan.
 * SDK vars: foodName (maps from item.name), macros as numbers.
 * NutritionMealItem.quantity and .notes are preserved as empty strings since
 * the SDK schema no longer carries those fields.
 * Refs: FR-242
 */
export async function addNutritionMealItem(
  planId: string,
  item: NutritionMealItemInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<NutritionMealItem> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.addNutritionMealItem(dc, {
    planId: planId,
    foodName: item.name.trim(),
  });

  const insertedId = data.nutritionPlanMeal_insert.id;
  return { id: insertedId, name: item.name.trim(), quantity: '', notes: '' };
}

/**
 * Removes a food item from a nutrition plan.
 * SDK only requires itemId (planId param dropped per SDK schema change).
 */
export async function removeNutritionMealItem(
  _planId: string,
  itemId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  const dc = deps.getDataConnectInstance();
  await deps.removeNutritionMealItem(dc, { itemId: itemId });
}

// ─── Training plan CRUD ───────────────────────────────────────────────────────

/**
 * Creates a new named predefined training plan in the professional's library.
 * Refs: FR-244, BR-293
 */
export async function createTrainingPlan(
  input: TrainingPlanInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<TrainingPlanDetail> {
  const dc = deps.getDataConnectInstance();
  const { data: createData } = await deps.createTrainingPlan(dc, {
    name: input.name.trim(),
  });

  const planId = createData.trainingPlan_insert.id;
  const { data: detailData } = await deps.getTrainingPlanDetail(dc, { planId: planId });
  return mapTrainingPlanDetail(detailData.trainingPlan);
}

/**
 * Updates an existing training plan's name.
 */
export async function updateTrainingPlan(
  planId: string,
  input: TrainingPlanInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  const dc = deps.getDataConnectInstance();
  await deps.updateTrainingPlan(dc, {
    planId: planId,
    name: input.name.trim(),
  });
}

/**
 * Fetches full training plan detail including sessions and session items.
 */
export async function getTrainingPlanDetail(
  planId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<TrainingPlanDetail> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getTrainingPlanDetail(dc, { planId: planId });
  return mapTrainingPlanDetail(data.trainingPlan);
}

/**
 * Adds a session to a training plan.
 * SDK var: sessionName (maps from session.name). notes field dropped per SDK schema.
 * Refs: FR-245
 */
export async function addTrainingSession(
  planId: string,
  session: TrainingSessionInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<TrainingSession> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.addTrainingSession(dc, {
    planId: planId,
    sessionName: session.name.trim(),
  });

  const insertedId = data.trainingPlanSession_insert.id;
  return { id: insertedId, name: session.name.trim(), notes: '', items: [] };
}

/**
 * Removes a session from a training plan.
 * SDK only requires sessionId (planId param dropped per SDK schema change).
 */
export async function removeTrainingSession(
  _planId: string,
  sessionId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  const dc = deps.getDataConnectInstance();
  await deps.removeTrainingSession(dc, { sessionId: sessionId });
}

/**
 * Adds a custom item to a training session.
 * SDK var: exerciseName (maps from item.name). Sets/reps/weight are omitted
 * since TrainingSessionItemInput uses name/quantity/notes for display.
 * Refs: FR-246, BR-294
 */
export async function addTrainingSessionItem(
  sessionId: string,
  item: TrainingSessionItemInput,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<TrainingSessionItem> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.addTrainingSessionItem(dc, {
    sessionId: sessionId,
    exerciseName: item.name.trim(),
  });

  const insertedId = data.trainingSessionItem_insert.id;
  return { id: insertedId, name: item.name.trim(), quantity: '', notes: '' };
}

/**
 * Removes a custom item from a training session.
 * SDK only requires itemId (sessionId param dropped per SDK schema change).
 */
export async function removeTrainingSessionItem(
  _sessionId: string,
  itemId: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<void> {
  const dc = deps.getDataConnectInstance();
  await deps.removeTrainingSessionItem(dc, { itemId: itemId });
}

// ─── Starter templates ────────────────────────────────────────────────────────

/**
 * Returns starter templates for a given plan type from Data Connect.
 * Refs: D-114, FR-247, BR-270, BR-295
 */
export async function getStarterTemplates(
  planType: PlanType,
  deps: PlanBuilderSourceDeps = defaultDeps
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
  user: { uid: string },
  templateId: string,
  name: string,
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<{ id: string; planType: PlanType; name: string }> {
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

// ─── Food search ──────────────────────────────────────────────────────────────

/**
 * Searches fatsecret food database via Firebase Cloud Function proxy.
 * Retrieves the current Firebase Auth user and delegates to food-search-source.
 * Throws FoodSearchSourceError if the Cloud Function URL is unconfigured or
 * the request fails.
 * Refs: D-113, D-127, FR-243
 */
export async function searchFoods(query: string): Promise<FoodSearchResult[]> {
  const auth = getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) {
    // User signed out mid-session — surface as configuration-like error so the
    // hook can map it to 'unknown' via normalizePlanBuilderError.
    throw new Error('No authenticated user for food search.');
  }
  return searchFoodsFromSource(user, query);
}
