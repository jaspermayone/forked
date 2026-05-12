import "dotenv/config";
import express from "express";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { runPipeline } from "./pipeline";
import { renderHtml } from "./render";
import { initDb, saveRecipe, listRecipes, getRecipe, deleteRecipe } from "./db";
import { JobStatus } from "./types";

initDb();

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "[warn] ANTHROPIC_API_KEY is not set — Claude vision fallback will fail.\n" +
    "       Set it in your environment or create a .env file:\n" +
    "       echo 'ANTHROPIC_API_KEY=sk-ant-...' >> .env"
  );
}

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use(express.static(join(__dirname, "../public")));

// In-memory job store (single-user, Mac mini)
const jobs = new Map<string, JobStatus>();

// ── POST /api/extract ────────────────────────────────────────────────────────
app.post("/api/extract", (req, res) => {
  const { url } = req.body as { url?: string };

  if (!url || !url.includes("instagram.com")) {
    res.status(400).json({ error: "Invalid Instagram URL" });
    return;
  }

  const jobId = uuidv4();
  const startEntry = { ts: Date.now(), msg: "Queued" };
  jobs.set(jobId, { status: "pending", progress: "Queued", logs: [startEntry] });

  res.json({ jobId });

  // Run pipeline async
  (async () => {
    const job = jobs.get(jobId)!;
    job.status = "running";
    job.progress = "Starting…";
    job.logs.push({ ts: Date.now(), msg: "Starting pipeline…" });

    const short = jobId.slice(0, 8);
    const log = (msg: string) => {
      const j = jobs.get(jobId);
      if (!j) return;
      j.progress = msg;
      j.logs.push({ ts: Date.now(), msg });
      console.log(`[${short}] ${msg}`);
    };

    console.log(`[${short}] job started  url=${url}`);

    try {
      const result = await runPipeline(url, jobId, log);

      const j = jobs.get(jobId)!;
      j.status = "done";
      j.progress = "Complete";
      const doneMsg = `done — ${result.source} path, confidence ${(result.recipe.confidence * 100).toFixed(0)}%`;
      j.logs.push({ ts: Date.now(), msg: `Done — extracted via ${result.source} (confidence ${(result.recipe.confidence * 100).toFixed(0)}%)` });
      j.result = result;
      j.dbId = saveRecipe(url, result);
      console.log(`[${short}] ${doneMsg}`);
    } catch (err: any) {
      const j = jobs.get(jobId)!;
      j.status = "error";
      j.progress = "Failed";
      j.error = err?.message ?? String(err);
      j.logs.push({ ts: Date.now(), msg: `Error: ${j.error}` });
      console.error(`[${short}] error: ${j.error}`);
    }
  })();
});

// ── GET /api/status/:jobId ────────────────────────────────────────────────────
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json(job);
});

// ── GET /api/result/:jobId ────────────────────────────────────────────────────
app.get("/api/result/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || job.status !== "done" || !job.result) {
    res.status(404).json({ error: "Result not ready" });
    return;
  }

  const html = renderHtml(job.result.recipe);
  const title = job.result.recipe.title ?? "recipe";
  const filename = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename}.html"`
  );
  res.send(html);
});

// ── GET /api/recipes ─────────────────────────────────────────────────────────
app.get("/api/recipes", (_req, res) => {
  res.json(listRecipes());
});

// ── GET /api/recipes/:id ──────────────────────────────────────────────────────
app.get("/api/recipes/:id", (req, res) => {
  const row = getRecipe(Number(req.params.id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const { html: _html, ...meta } = row;
  res.json({ ...meta, recipe: JSON.parse(row.recipe_json) });
});

// ── GET /api/recipes/:id/html ─────────────────────────────────────────────────
app.get("/api/recipes/:id/html", (req, res) => {
  const row = getRecipe(Number(req.params.id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const filename = (row.title ?? "recipe")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.html"`);
  res.send(row.html);
});

// ── DELETE /api/recipes/:id ───────────────────────────────────────────────────
app.delete("/api/recipes/:id", (req, res) => {
  const ok = deleteRecipe(Number(req.params.id));
  if (!ok) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Forked running at http://localhost:${PORT}`);
});
