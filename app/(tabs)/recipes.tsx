/**
 * Tab route: /(tabs)/recipes
 * Student only -> SC-215 Custom Meal Library & Quick Log
 */
import CustomMealLibraryScreen from '@/app/(tabs)/nutrition/custom-meals/index';

export default function RecipesTabRoute() {
  return <CustomMealLibraryScreen hideHeader />;
}
