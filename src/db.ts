import { Database } from "bun:sqlite";
import { join } from "path";
import { PipelineResult } from "./types";
import { renderHtml } from "./render";

const DB_PATH = join(process.cwd(), "recipes.db");

let db: Database;

export function initDb(): void {
  db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS recipes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT,
      source      TEXT NOT NULL,
      confidence  REAL NOT NULL,
      url         TEXT NOT NULL,
      recipe_json TEXT NOT NULL,
      html        TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    )
  `);
}

export interface RecipeRow {
  id: number;
  title: string | null;
  source: string;
  confidence: number;
  url: string;
  recipe_json: string;
  html: string;
  created_at: number;
}

export function saveRecipe(url: string, result: PipelineResult): number {
  const html = renderHtml(result.recipe);
  const res = db.query(`
    INSERT INTO recipes (title, source, confidence, url, recipe_json, html, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    result.recipe.title ?? null,
    result.source,
    result.recipe.confidence,
    url,
    JSON.stringify(result.recipe),
    html,
    Date.now()
  );
  return Number(res.lastInsertRowid);
}

export function listRecipes(): Omit<RecipeRow, "html" | "recipe_json">[] {
  return db
    .query("SELECT id, title, source, confidence, url, created_at FROM recipes ORDER BY created_at DESC")
    .all() as Omit<RecipeRow, "html" | "recipe_json">[];
}

export function getRecipe(id: number): RecipeRow | null {
  return (db.query("SELECT * FROM recipes WHERE id = ?").get(id) as RecipeRow) ?? null;
}

export function deleteRecipe(id: number): boolean {
  const res = db.query("DELETE FROM recipes WHERE id = ?").run(id);
  return res.changes > 0;
}
