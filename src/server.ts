import express from "express";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { runPipeline } from "./pipeline";
import { renderHtml } from "./render";
import { JobStatus } from "./types";

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
  jobs.set(jobId, { status: "pending", progress: "Queued…" });

  res.json({ jobId });

  // Run pipeline async
  (async () => {
    jobs.set(jobId, { status: "running", progress: "Starting…" });

    try {
      const result = await runPipeline(url, jobId, (msg) => {
        const job = jobs.get(jobId);
        if (job) job.progress = msg;
      });

      jobs.set(jobId, {
        status: "done",
        progress: "Complete",
        result,
      });
    } catch (err: any) {
      jobs.set(jobId, {
        status: "error",
        progress: "Failed",
        error: err?.message ?? String(err),
      });
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

app.listen(PORT, () => {
  console.log(`Forked running at http://localhost:${PORT}`);
});
