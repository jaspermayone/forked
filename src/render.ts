import { Recipe } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonLd(recipe: Recipe): string {
  const obj: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    "name": recipe.title ?? "Untitled Recipe",
    "recipeIngredient": recipe.ingredients,
    "recipeInstructions": recipe.steps.map((s, i) => ({
      "@type": "HowToStep",
      "position": i + 1,
      "text": s,
    })),
  };
  if (recipe.servings) obj["recipeYield"] = recipe.servings;
  if (recipe.time)     obj["totalTime"]   = recipe.time;
  if (recipe.notes.length) obj["description"] = recipe.notes.join(" ");
  return JSON.stringify(obj, null, 2);
}

export function renderHtml(recipe: Recipe): string {
  const title = recipe.title ? esc(recipe.title) : "Untitled Recipe";

  const meta: string[] = [];
  if (recipe.servings) meta.push(`Serves: ${esc(recipe.servings)}`);
  if (recipe.time) meta.push(`Time: ${esc(recipe.time)}`);

  const ingredientItems = recipe.ingredients
    .map((i) => `      <li class="ingredient" itemprop="recipeIngredient">${esc(i)}</li>`)
    .join("\n");

  const stepItems = recipe.steps
    .map((s, idx) => `      <li itemprop="recipeInstructions" itemscope itemtype="https://schema.org/HowToStep">
        <meta itemprop="position" content="${idx + 1}">
        <span itemprop="text">${esc(s)}</span>
      </li>`)
    .join("\n");

  const notesBlock =
    recipe.notes.length > 0
      ? `    <h2>Notes</h2>\n    <p class="summary" itemprop="description">${recipe.notes.map(esc).join("<br>\n")}</p>`
      : "";

  const yieldAttr  = recipe.servings ? ` itemprop="recipeYield"` : "";
  const timeAttr   = recipe.time     ? ` itemprop="totalTime"`   : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <base target="_blank">
  <title>${title}</title>
  <script type="application/ld+json">
${jsonLd(recipe)}
  </script>
</head>
<body>
  <article class="hrecipe" itemscope itemtype="https://schema.org/Recipe">
    <h1 class="fn p-name" itemprop="name">${title}</h1>
${meta.length > 0 ? `    <p>
      ${recipe.servings ? `<span class="yield"${yieldAttr}>${esc(recipe.servings)}</span>` : ""}
      ${recipe.time     ? `<span class="duration"${timeAttr}>${esc(recipe.time)}</span>` : ""}
    </p>` : ""}
    <h2>Ingredients</h2>
    <ul class="ingredients" itemprop="recipeIngredient">
${ingredientItems}
    </ul>
    <h2>Instructions</h2>
    <ol class="instructions" itemprop="recipeInstructions">
${stepItems}
    </ol>
${notesBlock}
  </article>
</body>
</html>`;
}
