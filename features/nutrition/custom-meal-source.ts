/**
 * Custom meal Data Connect source — CRUD, share link, recipe import.
 * All calls use Firebase Auth ID token in Authorization header.
 * No business logic; normalization delegates to custom-meal.logic.
 * Refs: D-017–D-029, FR-137–FR-162, BR-301–BR-327
 */

import Constants from 'expo-constants';
import type { User } from 'firebase/auth';

import type { CustomMeal, SharedMealSnapshot } from './custom-meal.logic';

// ─── Transport helpers ────────────────────────────────────────────────────────

type DataConnectExtraConfig = {
  graphqlEndpoint?: string;
  apiKey?: string;
};

type DataConnectGraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

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
    throw new CustomMealSourceError(
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
    throw new CustomMealSourceError(
      'network',
      `Data Connect request failed with status ${response.status}.`
    );
  }

  const payload = (await response.json()) as DataConnectGraphQLResponse<T>;
  if (payload.errors && payload.errors.length > 0) {
    throw new CustomMealSourceError(
      'graphql',
      payload.errors[0]?.message ?? 'Data Connect operation failed.'
    );
  }

  if (!payload.data) {
    throw new CustomMealSourceError(
      'invalid_response',
      'Data Connect operation returned no data payload.'
    );
  }

  return payload.data;
}

// ─── Raw meal mapper ──────────────────────────────────────────────────────────

type RawMeal = {
  id?: string | null;
  name?: string | null;
  total_grams?: number | null;
  calories?: number | null;
  carbs?: number | null;
  proteins?: number | null;
  fats?: number | null;
  ingredient_cost?: number | null;
  image_url?: string | null;
  owner_uid?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function mapRawMeal(raw: RawMeal): CustomMeal | null {
  if (
    !raw.id ||
    !raw.name ||
    raw.total_grams == null ||
    raw.calories == null ||
    raw.carbs == null ||
    raw.proteins == null ||
    raw.fats == null ||
    !raw.owner_uid ||
    !raw.created_at ||
    !raw.updated_at
  ) {
    return null;
  }

  return {
    id: raw.id,
    name: raw.name,
    totalGrams: raw.total_grams,
    calories: raw.calories,
    carbs: raw.carbs,
    proteins: raw.proteins,
    fats: raw.fats,
    ingredientCost: raw.ingredient_cost ?? null,
    imageUrl: raw.image_url ?? null,
    ownerUid: raw.owner_uid,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/** Returns all custom meals owned by the current user. */
export async function getMyCustomMeals(user: User): Promise<CustomMeal[]> {
  const query = `
    query GetMyCustomMeals {
      getMyCustomMeals {
        id
        name
        total_grams
        calories
        carbs
        proteins
        fats
        ingredient_cost
        image_url
        owner_uid
        created_at
        updated_at
      }
    }
  `;

  const data = await gql<{ getMyCustomMeals?: RawMeal[] | null }>(user, query);

  return (data.getMyCustomMeals ?? []).flatMap((raw) => {
    const meal = mapRawMeal(raw);
    return meal ? [meal] : [];
  });
}

/** Creates a new custom meal. Returns the created meal with server-assigned id. */
export async function createCustomMeal(
  user: User,
  input: {
    name: string;
    totalGrams: number;
    calories: number;
    carbs: number;
    proteins: number;
    fats: number;
    ingredientCost?: number | null;
    imageUrl?: string | null;
  }
): Promise<CustomMeal> {
  const mutation = `
    mutation CreateCustomMeal(
      $name: String!
      $total_grams: Float!
      $calories: Float!
      $carbs: Float!
      $proteins: Float!
      $fats: Float!
      $ingredient_cost: Float
      $image_url: String
    ) {
      createCustomMeal(
        name: $name
        total_grams: $total_grams
        calories: $calories
        carbs: $carbs
        proteins: $proteins
        fats: $fats
        ingredient_cost: $ingredient_cost
        image_url: $image_url
      ) {
        id
        name
        total_grams
        calories
        carbs
        proteins
        fats
        ingredient_cost
        image_url
        owner_uid
        created_at
        updated_at
      }
    }
  `;

  const data = await gql<{ createCustomMeal?: RawMeal | null }>(user, mutation, {
    name: input.name,
    total_grams: input.totalGrams,
    calories: input.calories,
    carbs: input.carbs,
    proteins: input.proteins,
    fats: input.fats,
    ingredient_cost: input.ingredientCost ?? null,
    image_url: input.imageUrl ?? null,
  });

  const meal = mapRawMeal(data.createCustomMeal ?? {});
  if (!meal) {
    throw new CustomMealSourceError('invalid_response', 'createCustomMeal returned no meal.');
  }
  return meal;
}

/** Updates an existing custom meal. Returns updated meal. */
export async function updateCustomMeal(
  user: User,
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
  }
): Promise<CustomMeal> {
  const mutation = `
    mutation UpdateCustomMeal(
      $id: UUID!
      $name: String!
      $total_grams: Float!
      $calories: Float!
      $carbs: Float!
      $proteins: Float!
      $fats: Float!
      $ingredient_cost: Float
      $image_url: String
    ) {
      updateCustomMeal(
        id: $id
        name: $name
        total_grams: $total_grams
        calories: $calories
        carbs: $carbs
        proteins: $proteins
        fats: $fats
        ingredient_cost: $ingredient_cost
        image_url: $image_url
      ) {
        id
        name
        total_grams
        calories
        carbs
        proteins
        fats
        ingredient_cost
        image_url
        owner_uid
        created_at
        updated_at
      }
    }
  `;

  const data = await gql<{ updateCustomMeal?: RawMeal | null }>(user, mutation, {
    id,
    name: input.name,
    total_grams: input.totalGrams,
    calories: input.calories,
    carbs: input.carbs,
    proteins: input.proteins,
    fats: input.fats,
    ingredient_cost: input.ingredientCost ?? null,
    image_url: input.imageUrl ?? null,
  });

  const meal = mapRawMeal(data.updateCustomMeal ?? {});
  if (!meal) {
    throw new CustomMealSourceError('invalid_response', 'updateCustomMeal returned no meal.');
  }
  return meal;
}

/** Deletes a custom meal by id. */
export async function deleteCustomMeal(user: User, id: string): Promise<void> {
  const mutation = `
    mutation DeleteCustomMeal($id: UUID!) {
      deleteCustomMeal(id: $id) {
        id
      }
    }
  `;

  await gql<{ deleteCustomMeal?: { id?: string | null } | null }>(user, mutation, { id });
}

// ─── Share link ───────────────────────────────────────────────────────────────

/**
 * Generates a share token for a custom meal.
 * Returns a deep-link URL the user can share.
 * Rate-limited server-side (D-028).
 */
export async function createMealShareLink(
  user: User,
  mealId: string
): Promise<{ shareToken: string; shareUrl: string }> {
  const mutation = `
    mutation CreateMealShareLink($meal_id: UUID!) {
      createMealShareLink(meal_id: $meal_id) {
        share_token
        share_url
      }
    }
  `;

  const data = await gql<{
    createMealShareLink?: { share_token?: string | null; share_url?: string | null } | null;
  }>(user, mutation, { meal_id: mealId });

  const shareToken = data.createMealShareLink?.share_token;
  const shareUrl = data.createMealShareLink?.share_url;

  if (!shareToken || !shareUrl) {
    throw new CustomMealSourceError(
      'invalid_response',
      'createMealShareLink returned no token or URL.'
    );
  }

  return { shareToken, shareUrl };
}

// ─── Recipe import ────────────────────────────────────────────────────────────

/**
 * Previews the shared meal data for a given share token before importing.
 * Returns the SharedMealSnapshot without creating a local copy.
 * Ref: D-022, D-023
 */
export async function previewSharedMeal(
  user: User,
  shareToken: string
): Promise<SharedMealSnapshot> {
  const query = `
    query PreviewSharedMeal($share_token: String!) {
      previewSharedMeal(share_token: $share_token) {
        name
        total_grams
        calories
        carbs
        proteins
        fats
      }
    }
  `;

  const data = await gql<{
    previewSharedMeal?: {
      name?: string | null;
      total_grams?: number | null;
      calories?: number | null;
      carbs?: number | null;
      proteins?: number | null;
      fats?: number | null;
    } | null;
  }>(user, query, { share_token: shareToken });

  const raw = data.previewSharedMeal;
  if (
    !raw?.name ||
    raw.total_grams == null ||
    raw.calories == null ||
    raw.carbs == null ||
    raw.proteins == null ||
    raw.fats == null
  ) {
    throw new CustomMealSourceError(
      'invalid_response',
      'previewSharedMeal returned incomplete snapshot.'
    );
  }

  return {
    name: raw.name,
    totalGrams: raw.total_grams,
    calories: raw.calories,
    carbs: raw.carbs,
    proteins: raw.proteins,
    fats: raw.fats,
  };
}

/**
 * Imports a shared meal as a recipient-owned copy.
 * Idempotent: same token + same recipient returns existing copy (D-021).
 * Ref: D-018, D-019, D-021, D-023
 */
export async function importSharedMeal(
  user: User,
  shareToken: string
): Promise<CustomMeal> {
  const mutation = `
    mutation ImportSharedMeal($share_token: String!) {
      importSharedMeal(share_token: $share_token) {
        id
        name
        total_grams
        calories
        carbs
        proteins
        fats
        ingredient_cost
        image_url
        owner_uid
        created_at
        updated_at
      }
    }
  `;

  const data = await gql<{ importSharedMeal?: RawMeal | null }>(user, mutation, {
    share_token: shareToken,
  });

  const meal = mapRawMeal(data.importSharedMeal ?? {});
  if (!meal) {
    throw new CustomMealSourceError('invalid_response', 'importSharedMeal returned no meal.');
  }
  return meal;
}
