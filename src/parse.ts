import { Recipe } from "./types";

// Unit patterns for ingredient detection
const UNIT_PATTERN =
  /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|ml|milliliters?|cloves?|pinch|handful|bunch|cans?|packages?|slices?|pieces?|strips?|stalks?|sprigs?|heads?|fillets?)\b/i;

const QUANTITY_PATTERN = /^\s*[\d½¼¾⅓⅔⅛⅜⅝⅞][\d\s\-\/½¼¾⅓⅔⅛⅜⅝⅞]*/;

const STEP_NUMBER_PATTERN = /^\s*(step\s*)?\d+[.):\s]/i;

const BULLET_PATTERN = /^\s*[-•*·]\s+/;

// Markers that precede the ingredients list
const INGREDIENTS_HEADER = /\b(ingredients?|you('ll)? need|what you need)\b/i;

// Markers that precede the instructions
const STEPS_HEADER =
  /\b(instructions?|steps?|directions?|method|how to make|how to prepare)\b/i;

const NOTES_HEADER = /\b(notes?|tips?|tricks?|variations?|substitutions?)\b/i;

function looksLikeIngredient(line: string): boolean {
  return (QUANTITY_PATTERN.test(line) && UNIT_PATTERN.test(line)) ||
    (BULLET_PATTERN.test(line) && line.length < 80);
}

function looksLikeStep(line: string): boolean {
  return STEP_NUMBER_PATTERN.test(line) || line.trim().length > 40;
}

function cleanLine(line: string): string {
  return line
    .replace(BULLET_PATTERN, "")
    .replace(/^\s*(step\s*\d+[.):\s]*)/i, "")
    .trim();
}

export function parseRecipe(text: string): Omit<Recipe, "confidence"> {
  const lines = text
    .split(/\n|(?<=\.)\s+(?=[A-Z0-9])/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  let title: string | null = null;
  let servings: string | null = null;
  let time: string | null = null;
  const ingredients: string[] = [];
  const steps: string[] = [];
  const notes: string[] = [];

  // Extract title: first non-trivial line that isn't a quantity or emoji-only
  for (const line of lines) {
    if (line.length > 4 && !QUANTITY_PATTERN.test(line) && !/^[^\w]+$/.test(line)) {
      title = line.replace(/\s*[🍔🍕🍝🍜🥘🍲🥗🥙🌮🌯🥪🥫🍱🍛🍜🍣🍤🍙🍘🍥🥮🍡🥟🥠🥡🍦🍧🍨🍩🍪🎂🍰🧁🥧🍫🍬🍭🍮🍯]+\s*/g, "").trim();
      break;
    }
  }

  // Extract servings and time from text
  const servingsMatch = text.match(
    /(?:serves?|servings?|makes?|yield[s]?)[:\s]+(\d+(?:\s*[-–]\s*\d+)?(?:\s*people|\s*servings?)?)/i
  );
  if (servingsMatch) servings = servingsMatch[1].trim();

  const timeMatch = text.match(
    /(?:(?:total\s+)?(?:cook(?:ing)?|prep(?:aration)?|ready|bake)\s+)?(?:time|takes?)[:\s]+(\d+(?:\s*[-–]\s*\d+)?\s*(?:min(?:utes?)?|hours?|hrs?))/i
  );
  if (timeMatch) time = timeMatch[1].trim();

  // Section-aware parsing: track which section we're in
  type Section = "preamble" | "ingredients" | "steps" | "notes";
  let section: Section = "preamble";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Section header detection
    if (INGREDIENTS_HEADER.test(line) && line.length < 60) {
      section = "ingredients";
      continue;
    }
    if (STEPS_HEADER.test(line) && line.length < 60) {
      section = "steps";
      continue;
    }
    if (NOTES_HEADER.test(line) && line.length < 60) {
      section = "notes";
      continue;
    }

    const cleaned = cleanLine(line);
    if (!cleaned) continue;

    if (section === "ingredients") {
      ingredients.push(cleaned);
    } else if (section === "steps") {
      steps.push(cleaned);
    } else if (section === "notes") {
      notes.push(cleaned);
    } else {
      // Preamble: classify by heuristic
      if (looksLikeIngredient(line)) {
        ingredients.push(cleaned);
      } else if (STEP_NUMBER_PATTERN.test(line)) {
        steps.push(cleaned);
      }
      // Otherwise: preamble text (title, intro, etc.) — skip
    }
  }

  // Fallback: if we found no structure, attempt a flat parse
  if (ingredients.length === 0 && steps.length === 0) {
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line === title) continue;
      const cleaned = cleanLine(line);
      if (looksLikeIngredient(line)) {
        ingredients.push(cleaned);
      } else if (looksLikeStep(line)) {
        steps.push(cleaned);
      } else {
        notes.push(cleaned);
      }
    }
  }

  return { title, servings, time, ingredients, steps, notes };
}
