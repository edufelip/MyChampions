/**
 * Custom meal Firestore source — CRUD, share link, recipe import, portion log.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
  type Firestore,
} from 'firebase/firestore';

import { getFirestoreInstance as _getFirestoreInstance, getCurrentAuthUid as _getCurrentAuthUid, nowIso, generateId } from '../firestore';
import { classifyFirestoreError } from '../firestore-error';

import type { CustomMeal, SharedMealSnapshot } from './custom-meal.logic';
import { calculatePortionNutrition } from './custom-meal.logic';

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

type FirestoreCustomMeal = {
  id: string;
  name: string;
  totalGrams: number;
  calories: number;
  carbs: number;
  proteins: number;
  fats: number;
  ingredientCost: number | null;
  imageUrl: string | null;
  ownerUid: string;
  importedFromShareToken: string | null;
  createdAt: string;
  updatedAt: string;
};

type FirestoreMealShareLink = {
  id: string;
  ownerUid: string;
  mealId: string;
  snapshot: SharedMealSnapshot;
  createdAt: string;
};

type FirestorePortionLog = {
  id: string;
  ownerUid: string;
  mealId: string;
  consumedGrams: number;
  snapshot: {
    calories: number;
    carbs: number;
    proteins: number;
    fats: number;
  };
  loggedAt: string;
};

export type CustomMealSourceDeps = {
  getFirestoreInstance: () => Firestore;
  getCurrentAuthUid: () => string;
};

const defaultDeps: CustomMealSourceDeps = {
  getFirestoreInstance: _getFirestoreInstance,
  getCurrentAuthUid: _getCurrentAuthUid,
};

function normalizeCustomMealSourceError(error: unknown): CustomMealSourceError {
  if (error instanceof CustomMealSourceError) return error;

  switch (classifyFirestoreError(error)) {
    case 'network':
      return new CustomMealSourceError('network', (error as Error)?.message ?? 'Network error.');
    case 'configuration':
      return new CustomMealSourceError('configuration', (error as Error)?.message ?? 'Configuration error.');
    default:
      return new CustomMealSourceError('invalid_response', (error as Error)?.message ?? 'Unexpected custom meal source error.');
  }
}

function mapMeal(raw: FirestoreCustomMeal): CustomMeal {
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
    ownerUid: raw.ownerUid,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export async function getMyCustomMeals(deps = defaultDeps): Promise<CustomMeal[]> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    const snapshots = await getDocs(query(collection(firestore, 'customMeals'), where('ownerUid', '==', uid)));

    return snapshots.docs
      .map((snap) => mapMeal(snap.data() as FirestoreCustomMeal))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

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
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();
    const id = generateId('meal');
    const timestamp = nowIso();

    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'customMeals', id), {
        id,
        name: input.name,
        totalGrams: input.totalGrams,
        calories: input.calories,
        carbs: input.carbs,
        proteins: input.proteins,
        fats: input.fats,
        ingredientCost: input.ingredientCost ?? null,
        imageUrl: input.imageUrl ?? null,
        ownerUid: uid,
        importedFromShareToken: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies FirestoreCustomMeal);
    });

    return {
      id,
      name: input.name,
      totalGrams: input.totalGrams,
      calories: input.calories,
      carbs: input.carbs,
      proteins: input.proteins,
      fats: input.fats,
      ingredientCost: input.ingredientCost ?? null,
      imageUrl: input.imageUrl ?? null,
      ownerUid: uid,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

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
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'customMeals', id);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new CustomMealSourceError('graphql', 'Custom meal not found.');
      }
      const current = snap.data() as FirestoreCustomMeal;
      if (current.ownerUid !== uid) {
        throw new CustomMealSourceError('graphql', 'Permission denied for meal update.');
      }

      tx.update(ref, {
        name: input.name,
        totalGrams: input.totalGrams,
        calories: input.calories,
        carbs: input.carbs,
        proteins: input.proteins,
        fats: input.fats,
        ingredientCost: input.ingredientCost ?? null,
        imageUrl: input.imageUrl ?? null,
        updatedAt: nowIso(),
      });
    });

    const updated = await getDoc(doc(firestore, 'customMeals', id));
    if (!updated.exists()) {
      throw new CustomMealSourceError('invalid_response', 'updateCustomMeal: meal not found after update.');
    }

    return mapMeal(updated.data() as FirestoreCustomMeal);
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function deleteCustomMeal(id: string, deps = defaultDeps): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    await runTransaction(firestore, async (tx) => {
      const ref = doc(firestore, 'customMeals', id);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new CustomMealSourceError('graphql', 'Custom meal not found.');
      }
      const current = snap.data() as FirestoreCustomMeal;
      if (current.ownerUid !== uid) {
        throw new CustomMealSourceError('graphql', 'Permission denied for meal delete.');
      }
      tx.delete(ref);
    });
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function createMealShareLink(
  mealId: string,
  deps = defaultDeps
): Promise<{ shareLinkId: string }> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    const mealSnap = await getDoc(doc(firestore, 'customMeals', mealId));
    if (!mealSnap.exists()) {
      throw new CustomMealSourceError('graphql', 'Custom meal not found for share link.');
    }

    const meal = mealSnap.data() as FirestoreCustomMeal;
    if (meal.ownerUid !== uid) {
      throw new CustomMealSourceError('graphql', 'Permission denied for share link generation.');
    }

    const shareLinkId = generateId('share');
    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'mealShareLinks', shareLinkId), {
        id: shareLinkId,
        ownerUid: uid,
        mealId,
        snapshot: {
          name: meal.name,
          totalGrams: meal.totalGrams,
          calories: meal.calories,
          carbs: meal.carbs,
          proteins: meal.proteins,
          fats: meal.fats,
        },
        createdAt: nowIso(),
      } satisfies FirestoreMealShareLink);
    });

    return { shareLinkId };
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function previewSharedMeal(
  shareToken: string,
  deps = defaultDeps
): Promise<SharedMealSnapshot> {
  try {
    const firestore = deps.getFirestoreInstance();
    const shareSnap = await getDoc(doc(firestore, 'mealShareLinks', shareToken));

    if (!shareSnap.exists()) {
      throw new CustomMealSourceError('graphql', 'previewSharedMeal: share link not found.');
    }

    const link = shareSnap.data() as FirestoreMealShareLink;
    return link.snapshot;
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function importSharedMeal(
  shareToken: string,
  deps = defaultDeps
): Promise<CustomMeal> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    const existing = await getDocs(query(
      collection(firestore, 'customMeals'),
      where('ownerUid', '==', uid),
      where('importedFromShareToken', '==', shareToken)
    ));

    if (!existing.empty) {
      return mapMeal(existing.docs[0].data() as FirestoreCustomMeal);
    }

    const shareSnap = await getDoc(doc(firestore, 'mealShareLinks', shareToken));
    if (!shareSnap.exists()) {
      throw new CustomMealSourceError('graphql', 'importSharedMeal: share link not found.');
    }

    const share = shareSnap.data() as FirestoreMealShareLink;
    const id = generateId('meal');
    const timestamp = nowIso();

    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'customMeals', id), {
        id,
        name: share.snapshot.name,
        totalGrams: share.snapshot.totalGrams,
        calories: share.snapshot.calories,
        carbs: share.snapshot.carbs,
        proteins: share.snapshot.proteins,
        fats: share.snapshot.fats,
        ingredientCost: null,
        imageUrl: null,
        ownerUid: uid,
        importedFromShareToken: shareToken,
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies FirestoreCustomMeal);
    });

    return {
      id,
      name: share.snapshot.name,
      totalGrams: share.snapshot.totalGrams,
      calories: share.snapshot.calories,
      carbs: share.snapshot.carbs,
      proteins: share.snapshot.proteins,
      fats: share.snapshot.fats,
      ingredientCost: null,
      imageUrl: null,
      ownerUid: uid,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}

export async function logPortionFromSource(
  mealId: string,
  grams: number,
  deps = defaultDeps
): Promise<void> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();

    const mealSnap = await getDoc(doc(firestore, 'customMeals', mealId));
    if (!mealSnap.exists()) {
      throw new CustomMealSourceError('graphql', 'logPortion: meal not found.');
    }

    const meal = mealSnap.data() as FirestoreCustomMeal;
    if (meal.ownerUid !== uid) {
      throw new CustomMealSourceError('graphql', 'Permission denied for portion log.');
    }

    const snapshot = calculatePortionNutrition(
      {
        totalGrams: meal.totalGrams,
        calories: meal.calories,
        carbs: meal.carbs,
        proteins: meal.proteins,
        fats: meal.fats,
      },
      grams
    );

    const id = generateId('portion_log');
    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'portionLogs', id), {
        id,
        ownerUid: uid,
        mealId,
        consumedGrams: grams,
        snapshot,
        loggedAt: nowIso(),
      } satisfies FirestorePortionLog);
    });
  } catch (error) {
    throw normalizeCustomMealSourceError(error);
  }
}
