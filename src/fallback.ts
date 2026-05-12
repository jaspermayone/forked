import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { Recipe } from "./types";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are extracting a recipe from video frames. Return only valid JSON with no markdown wrapping.`;

const USER_PROMPT = `Extract the complete recipe from these video frames. Return:
{
  "title": string | null,
  "servings": string | null,
  "time": string | null,
  "ingredients": string[],
  "steps": string[],
  "notes": string[]
}
Reconstruct partial or flashing text across frames. If something appears in multiple frames, include it once.`;

export async function claudeVisionFallback(
  framePaths: string[],
  partialRecipe: Omit<Recipe, "confidence">
): Promise<Omit<Recipe, "confidence">> {
  // Select up to 10 frames (spread evenly)
  const selected = selectFrames(framePaths, 10);

  const imageContent: Anthropic.ImageBlockParam[] = selected.map(
    (framePath) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: readFileSync(framePath).toString("base64"),
      },
    })
  );

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...imageContent,
          { type: "text", text: USER_PROMPT },
        ],
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  let parsed: Partial<Omit<Recipe, "confidence">>;
  try {
    parsed = JSON.parse(text);
  } catch {
    // JSON parse failed — return partial recipe unchanged
    return partialRecipe;
  }

  // Merge: prefer Claude's output but keep high-confidence fields from heuristic pass
  return {
    title: partialRecipe.title ?? parsed.title ?? null,
    servings: partialRecipe.servings ?? parsed.servings ?? null,
    time: partialRecipe.time ?? parsed.time ?? null,
    ingredients:
      parsed.ingredients && parsed.ingredients.length > 0
        ? parsed.ingredients
        : partialRecipe.ingredients,
    steps:
      parsed.steps && parsed.steps.length > 0
        ? parsed.steps
        : partialRecipe.steps,
    notes: [
      ...(partialRecipe.notes ?? []),
      ...(parsed.notes ?? []),
    ].filter((v, i, a) => a.indexOf(v) === i),
  };
}

function selectFrames(paths: string[], max: number): string[] {
  if (paths.length <= max) return paths;
  const step = paths.length / max;
  return Array.from({ length: max }, (_, i) => paths[Math.floor(i * step)]);
}
