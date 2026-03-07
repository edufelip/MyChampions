import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NutritionPlanDetail, TrainingPlanDetail } from './plan-builder-source';

const NUTRITION_PLAN_CACHE_PREFIX = 'cache.nutrition_plan.';
const TRAINING_PLAN_CACHE_PREFIX = 'cache.training_plan.';

export async function getCachedNutritionPlan(planId: string): Promise<NutritionPlanDetail | null> {
  try {
    const data = await AsyncStorage.getItem(NUTRITION_PLAN_CACHE_PREFIX + planId);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export async function setCachedNutritionPlan(plan: NutritionPlanDetail): Promise<void> {
  try {
    await AsyncStorage.setItem(NUTRITION_PLAN_CACHE_PREFIX + plan.id, JSON.stringify(plan));
  } catch {
    // Ignore cache write errors
  }
}

export async function getCachedTrainingPlan(planId: string): Promise<TrainingPlanDetail | null> {
  try {
    const data = await AsyncStorage.getItem(TRAINING_PLAN_CACHE_PREFIX + planId);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export async function setCachedTrainingPlan(plan: TrainingPlanDetail): Promise<void> {
  try {
    await AsyncStorage.setItem(TRAINING_PLAN_CACHE_PREFIX + plan.id, JSON.stringify(plan));
  } catch {
    // Ignore cache write errors
  }
}
