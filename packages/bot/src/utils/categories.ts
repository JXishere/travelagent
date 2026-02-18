// Shared category mappings — maps meal types and times of day to spot categories

/** Explicit meal type → spot categories */
export const MEAL_TYPE_CATEGORIES: Record<string, string[]> = {
  breakfast: ["breakfast", "cafe"],
  brunch: ["breakfast", "cafe"],
  lunch: ["lunch", "cafe"],
  dinner: ["dinner"],
  coffee: ["cafe"],
  cafe: ["cafe"],
  dessert: ["cafe"],
  drinks: ["nightlife"],
  bar: ["nightlife"],
  supper: ["nightlife", "dinner"],
  "late night": ["nightlife", "dinner"],
};

/** Time of day → spot categories */
export const TIME_OF_DAY_CATEGORIES: Record<string, string[]> = {
  morning: ["breakfast", "cafe"],
  afternoon: ["lunch", "cafe", "activity"],
  evening: ["dinner", "nightlife", "activity"],
  "late-night": ["nightlife", "dinner"],
};

/** Default food categories when nothing specific is requested */
export const DEFAULT_CATEGORIES = ["breakfast", "lunch", "dinner", "cafe"];

/**
 * Resolve spot categories from a meal type and/or time of day.
 * Meal type takes priority over time of day.
 */
export function resolveCategories(
  mealType?: string,
  timeOfDay?: string
): string[] | null {
  if (mealType) {
    return MEAL_TYPE_CATEGORIES[mealType.toLowerCase()] ?? null;
  }
  if (timeOfDay) {
    return TIME_OF_DAY_CATEGORIES[timeOfDay.toLowerCase()] ?? null;
  }
  return DEFAULT_CATEGORIES;
}
