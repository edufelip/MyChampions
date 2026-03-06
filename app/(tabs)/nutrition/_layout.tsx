import { Stack } from 'expo-router';

/**
 * Nutrition tab stack.
 * Keeps bottom tabs visible while allowing nested nutrition routes.
 */
export default function NutritionTabLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
