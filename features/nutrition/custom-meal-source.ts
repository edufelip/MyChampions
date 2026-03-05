/**
 * Custom meal Data Connect source — CRUD, share link, recipe import.
 * Uses Firebase Data Connect generated SDK (D-114, D-126).
 * Auth handled internally by SDK via Firebase Auth current user.
 * No business logic; normalization delegates to custom-meal.logic.
 * Refs: D-017–D-029, FR-137–FR-162, BR-301–BR-327
 */

import { type DataConnect } from 'firebase/data-connect';

import { getDataConnectInstance as _getDataConnectInstance } from '../dataconnect';
import {
  getMyCustomMeals as _getMyCustomMeals,
  createCustomMeal as _createCustomMeal,
  updateCustomMeal as _updateCustomMeal,
  deleteCustomMeal as _deleteCustomMeal,
  createMealShareLink as _createMealShareLink,
  previewSharedMeal as _previewSharedMeal,
  importSharedMeal as _importSharedMeal,
  logPortion as _logPortion,
  type GetMyCustomMealsData,
  type CreateCustomMealData,
  type CreateCustomMealVariables,
  type UpdateCustomMealData,
  type UpdateCustomMealVariables,
  type DeleteCustomMealData,
  type DeleteCustomMealVariables,
  type CreateMealShareLinkData,
  type CreateMealShareLinkVariables,
  type PreviewSharedMealData,
  type PreviewSharedMealVariables,
  type ImportSharedMealData,
  type ImportSharedMealVariables,
  type LogPortionData,
  type LogPortionVariables,
} from '@mychampions/dataconnect-generated';

import type { CustomMeal, SharedMealSnapshot } from './custom-meal.logic';

// ─── Error class ──────────────────────────────────────────────────────────────

type CustomMealSourceErrorCode =
  | 'configuration'
  | 'network'
  | 'graphql'
  | 'invalid_response';

export class CustomMealSourceError extends Error {
  code: CustomMealSourceErrorCode;

  constructor(code: CustomMealSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'CustomMealSourceError';
  }
}

// ─── Injectable deps (D-114 pattern) ─────────────────────────────────────────

export type CustomMealSourceDeps = {
  getDataConnectInstance: () => DataConnect;
  getMyCustomMeals: (dc: DataConnect) => Promise<{ data: GetMyCustomMealsData }>;
  createCustomMeal: (
    dc: DataConnect,
    vars: CreateCustomMealVariables
  ) => Promise<{ data: CreateCustomMealData }>;
  updateCustomMeal: (
    dc: DataConnect,
    vars: UpdateCustomMealVariables
  ) => Promise<{ data: UpdateCustomMealData }>;
  deleteCustomMeal: (
    dc: DataConnect,
    vars: DeleteCustomMealVariables
  ) => Promise<{ data: DeleteCustomMealData }>;
  createMealShareLink: (
    dc: DataConnect,
    vars: CreateMealShareLinkVariables
  ) => Promise<{ data: CreateMealShareLinkData }>;
  previewSharedMeal: (
    dc: DataConnect,
    vars: PreviewSharedMealVariables
  ) => Promise<{ data: PreviewSharedMealData }>;
  importSharedMeal: (
    dc: DataConnect,
    vars: ImportSharedMealVariables
  ) => Promise<{ data: ImportSharedMealData }>;
  logPortion: (
    dc: DataConnect,
    vars: LogPortionVariables
  ) => Promise<{ data: LogPortionData }>;
};

const defaultDeps: CustomMealSourceDeps = {
  getDataConnectInstance: _getDataConnectInstance,
  getMyCustomMeals: _getMyCustomMeals,
  createCustomMeal: _createCustomMeal,
  updateCustomMeal: _updateCustomMeal,
  deleteCustomMeal: _deleteCustomMeal,
  createMealShareLink: _createMealShareLink,
  previewSharedMeal: _previewSharedMeal,
  importSharedMeal: _importSharedMeal,
  logPortion: _logPortion,
};

// ─── Raw meal mapper ──────────────────────────────────────────────────────────

function mapSdkMeal(
  raw: GetMyCustomMealsData['customMeals'][number]
): CustomMeal {
  return {
    id: raw.id,
    name: raw.name,
    totalGrams: raw.totalGrams,
    calories: raw.calories,
    carbs: raw.carbs,
    proteins: raw.proteins,
    fats: raw.fats,
    ingredientCost: raw.ingredientCost ?? null,
    imageUrl: raw.imageUrl ?? null,
    ownerUid: raw.ownerAuthUid,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/** Returns all custom meals owned by the current user. */
export async function getMyCustomMeals(deps = defaultDeps): Promise<CustomMeal[]> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getMyCustomMeals(dc);
  return data.customMeals.map(mapSdkMeal);
}

/**
 * Creates a new custom meal.
 * SDK returns only a key; re-fetches meals to return the created meal.
 */
export async function createCustomMeal(
  input: {
    name: string;
    totalGrams: number;
    calories: number;
    carbs: number;
    proteins: number;
    fats: number;
    ingredientCost?: number | null;
    imageUrl?: string | null;
  },
  deps = defaultDeps
): Promise<CustomMeal> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.createCustomMeal(dc, {
    name: input.name,
    totalGrams: input.totalGrams,
    calories: input.calories,
    carbs: input.carbs,
    proteins: input.proteins,
    fats: input.fats,
    ingredientCost: input.ingredientCost ?? null,
    imageUrl: input.imageUrl ?? null,
  });

  const insertedId = data.customMeal_insert.id;

  // Re-fetch to get full meal data
  const { data: listData } = await deps.getMyCustomMeals(dc);
  const found = listData.customMeals.find((m) => m.id === insertedId);
  if (!found) {
    throw new CustomMealSourceError('invalid_response', 'createCustomMeal: meal not found after insert.');
  }
  return mapSdkMeal(found);
}

/**
 * Updates an existing custom meal.
 * SDK returns only a key; re-fetches meals to return the updated meal.
 */
export async function updateCustomMeal(
  id: string,
  input: {
    name: string;
    totalGrams: number;
    calories: number;
    carbs: number;
    proteins: number;
    fats: number;
    ingredientCost?: number | null;
    imageUrl?: string | null;
  },
  deps = defaultDeps
): Promise<CustomMeal> {
  const dc = deps.getDataConnectInstance();
  await deps.updateCustomMeal(dc, {
    id,
    name: input.name,
    totalGrams: input.totalGrams,
    calories: input.calories,
    carbs: input.carbs,
    proteins: input.proteins,
    fats: input.fats,
    ingredientCost: input.ingredientCost ?? null,
    imageUrl: input.imageUrl ?? null,
  });

  // Re-fetch to get full updated meal data
  const { data: listData } = await deps.getMyCustomMeals(dc);
  const found = listData.customMeals.find((m) => m.id === id);
  if (!found) {
    throw new CustomMealSourceError('invalid_response', 'updateCustomMeal: meal not found after update.');
  }
  return mapSdkMeal(found);
}

/** Deletes a custom meal by id. */
export async function deleteCustomMeal(id: string, deps = defaultDeps): Promise<void> {
  const dc = deps.getDataConnectInstance();
  await deps.deleteCustomMeal(dc, { id });
}

// ─── Share link ───────────────────────────────────────────────────────────────

/**
 * Generates a share link for a custom meal.
 * SDK returns MealShareLink_Key only (no shareToken/shareUrl fields).
 * Returns the inserted record id; callers should construct deep-link from id.
 * Rate-limited server-side (D-028).
 */
export async function createMealShareLink(
  mealId: string,
  deps = defaultDeps
): Promise<{ shareLinkId: string }> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.createMealShareLink(dc, { mealId: mealId });
  return { shareLinkId: data.mealShareLink_insert.id };
}

// ─── Recipe import ────────────────────────────────────────────────────────────

/**
 * Previews the shared meal data for a given share token before importing.
 * Returns the SharedMealSnapshot without creating a local copy.
 * Ref: D-022, D-023
 */
export async function previewSharedMeal(
  shareToken: string,
  deps = defaultDeps
): Promise<SharedMealSnapshot> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.previewSharedMeal(dc, { shareToken: shareToken });

  const link = data.mealShareLinks[0];
  if (!link) {
    throw new CustomMealSourceError('invalid_response', 'previewSharedMeal: share link not found.');
  }

  const meal = link.meal;

  return {
    name: meal.name,
    totalGrams: meal.totalGrams,
    calories: meal.calories,
    carbs: meal.carbs,
    proteins: meal.proteins,
    fats: meal.fats,
  };
}

/**
 * Imports a shared meal as a recipient-owned copy.
 * Idempotent: same token + same recipient returns existing copy (D-021).
 * SDK returns only a key; re-fetches meals to return the imported meal.
 * Ref: D-018, D-019, D-021, D-023
 */
export async function importSharedMeal(
  shareToken: string,
  deps = defaultDeps
): Promise<CustomMeal> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.importSharedMeal(dc, { shareToken: shareToken });

  const insertedId = data.customMeal_insert.id;

  // Re-fetch to get full meal data
  const { data: listData } = await deps.getMyCustomMeals(dc);
  const found = listData.customMeals.find((m) => m.id === insertedId);
  if (!found) {
    throw new CustomMealSourceError('invalid_response', 'importSharedMeal: meal not found after import.');
  }
  return mapSdkMeal(found);
}

// ─── Portion log ──────────────────────────────────────────────────────────────

/**
 * Logs a consumed portion of a custom meal.
 * Ref: UC-003.3, FR-150, BR-316
 */
export async function logPortionFromSource(
  mealId: string,
  grams: number,
  deps = defaultDeps
): Promise<void> {
  const dc = deps.getDataConnectInstance();
  await deps.logPortion(dc, { mealId: mealId, grams });
}
