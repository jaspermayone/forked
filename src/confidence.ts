import { Recipe } from "./types";

const UNIT_PATTERN =
  /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|ml|cloves?|pinch|handful)\b/i;

export function scoreRecipe(recipe: Omit<Recipe, "confidence">): number {
  let score = 0;

  if (recipe.title && recipe.title.length > 3) score += 0.2;
  if (recipe.ingredients.length >= 2) score += 0.3;
  if (recipe.steps.length >= 1) score += 0.2;

  // Bonus: ingredients have quantities/units (parseable)
  const parseable = recipe.ingredients.filter(
    (i) => /\d/.test(i) && UNIT_PATTERN.test(i)
  );
  if (recipe.ingredients.length > 0) {
    const ratio = parseable.length / recipe.ingredients.length;
    score += 0.15 * ratio;
  }

  // Bonus: low noise — steps look like real sentences
  if (recipe.steps.length > 0) {
    const goodSteps = recipe.steps.filter(
      (s) => s.length > 15 && /[a-z]/.test(s)
    );
    const ratio = goodSteps.length / recipe.steps.length;
    score += 0.15 * ratio;
  }

  return Math.min(1, Math.round(score * 100) / 100);
}
