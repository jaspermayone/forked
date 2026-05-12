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

/**
 * Normalize inline formatting that accessibility snapshots and OCR produce
 * before we try to split into lines. Handles cases like:
 *   "* 1 lb beef * 1 tsp garlic 1. Cook the beef 2. Season..."
 * which would otherwise be treated as a single unstructured line.
 */
function normalizeText(raw: string): string {
  return raw
    // ⬇️ / ▼ / ➡️ used on Instagram before the recipe block → newline
    .replace(/[⬇️▼⬆️▲➡️◀️»]\s*/gu, "\n")
    // Inline bullet points: "text * next item" or "text • next" → newline before bullet
    .replace(/(?<=\S)\s+([*•·])\s+/g, "\n$1 ")
    // Inline numbered items not at line start: " 1. " or " 2) " → newline
    .replace(/(?<=\S)\s+(\d{1,2}[.)]\s+)/g, "\n$1")
    // Collapse 3+ newlines to 2
    .replace(/\n{3,}/g, "\n\n");
}

export function parseRecipe(text: string): Omit<Recipe, "confidence"> {
  const normalized = normalizeText(text);
  const lines = normalized
    // Split on newlines, or on sentence-ending periods — but NOT after digits
    // (which would incorrectly split "1. Cook..." into "1." and "Cook...").
    .split(/\n|(?<=[^.\d]\.)[ \t]+(?=[A-Z])/)
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
      let candidate = line;

      // Instagram titles are often "Dish name 🍔 Short blurb..." all on one line.
      // If an emoji immediately follows the dish name, take only the text before it.
      const emojiBreak = candidate.match(/^([\w][\w\s,'/()-]+?)\s*[\u{1F300}-\u{1FAFF}]/u);
      if (emojiBreak && emojiBreak[1].trim().length > 3) {
        candidate = emojiBreak[1].trim();
      } else if (candidate.length > 80) {
        // Long line with no leading emoji — take text up to the first sentence end
        const sentBreak = candidate.match(/^(.*?[!?])\s+[A-Z]/);
        if (sentBreak) candidate = sentBreak[1];
        else candidate = candidate.slice(0, 80).replace(/\s+\S+$/, "");
      }

      // Strip any remaining food emojis
      title = candidate
        .replace(/\s*[\u{1F300}-\u{1FAFF}]+\s*/gu, " ")
        .trim();
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
