import { Recipe } from "./types";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderHtml(recipe: Recipe): string {
  const title = recipe.title ? esc(recipe.title) : "Untitled Recipe";

  const meta: string[] = [];
  if (recipe.servings) meta.push(`Serves: ${esc(recipe.servings)}`);
  if (recipe.time) meta.push(`Time: ${esc(recipe.time)}`);

  const ingredientItems = recipe.ingredients
    .map((i) => `      <li>${esc(i)}</li>`)
    .join("\n");

  const stepItems = recipe.steps
    .map((s) => `      <li>${esc(s)}</li>`)
    .join("\n");

  const notesBlock =
    recipe.notes.length > 0
      ? `    <h2>Notes</h2>\n    <p>${recipe.notes.map(esc).join("<br>\n")}</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title}</title></head>
<body>
  <article>
    <h1>${title}</h1>
${meta.length > 0 ? `    <p>${meta.join(" · ")}</p>` : ""}
    <h2>Ingredients</h2>
    <ul>
${ingredientItems}
    </ul>
    <h2>Instructions</h2>
    <ol>
${stepItems}
    </ol>
${notesBlock}
  </article>
</body>
</html>`;
}
