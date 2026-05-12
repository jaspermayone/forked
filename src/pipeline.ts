import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { scrapeCaption } from "./caption";
import { acquireVideo, acquireFramesViaScreenshots } from "./acquire";
import { extractFrames, dedupFrames } from "./frames";
import { ocrFrames } from "./ocr";
import { parseRecipe } from "./parse";
import { scoreRecipe } from "./confidence";
import { claudeVisionFallback } from "./fallback";
import { renderHtml } from "./render";
import { PipelineResult, Recipe } from "./types";

const CAPTION_CONFIDENCE_THRESHOLD = 0.45;

export type ProgressCallback = (msg: string) => void;

export async function runPipeline(
  url: string,
  jobId: string,
  onProgress: ProgressCallback = () => {}
): Promise<PipelineResult> {
  const tmpDir = join(process.cwd(), "tmp", jobId);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // ── Step 1: Caption scrape ─────────────────────────────────────────────
    onProgress("Scraping caption…");
    const caption = await scrapeCaption(url);

    if (caption) {
      onProgress("Parsing caption text…");
      const partial = parseRecipe(caption);
      const confidence = scoreRecipe(partial);
      const recipe: Recipe = { ...partial, confidence };

      if (confidence >= CAPTION_CONFIDENCE_THRESHOLD) {
        onProgress("Done (caption path).");
        return { recipe, source: "caption", jobId };
      }
      onProgress(
        `Caption confidence ${confidence.toFixed(2)} < ${CAPTION_CONFIDENCE_THRESHOLD} — trying video pipeline…`
      );
    } else {
      onProgress("No caption found — trying video pipeline…");
    }

    // ── Step 2: Video acquisition ──────────────────────────────────────────
    onProgress("Acquiring video…");
    const videoDir = join(tmpDir, "video");
    const videoPath = await acquireVideo(url, videoDir);

    let framePaths: string[];

    if (videoPath) {
      onProgress("Extracting frames via ffmpeg…");
      const framesDir = join(tmpDir, "frames");
      const allFrames = extractFrames(videoPath, framesDir);

      if (allFrames.length > 0) {
        onProgress(`Deduplicating ${allFrames.length} frames…`);
        framePaths = await dedupFrames(allFrames);
        onProgress(`${framePaths.length} unique frames after dedup.`);
      } else {
        // ffmpeg got 0 frames — CDN URL was likely a redirect/error body; fall through
        onProgress("ffmpeg got 0 frames from CDN URL — falling back to screenshot sampling…");
        const screenshotsDir = join(tmpDir, "screenshots");
        framePaths = await acquireFramesViaScreenshots(url, screenshotsDir);
        onProgress(`Captured ${framePaths.length} screenshots.`);
      }
    } else {
      onProgress("No usable video URL — falling back to screenshot sampling…");
      const screenshotsDir = join(tmpDir, "screenshots");
      framePaths = await acquireFramesViaScreenshots(url, screenshotsDir);
      onProgress(`Captured ${framePaths.length} screenshots.`);
    }

    if (framePaths.length === 0) {
      throw new Error("No frames captured — cannot proceed.");
    }

    // ── Step 3: OCR ────────────────────────────────────────────────────────
    onProgress("Running OCR on frames…");
    const ocrText = await ocrFrames(framePaths);

    onProgress("Parsing OCR output…");
    const ocrPartial = parseRecipe(ocrText);
    const ocrConfidence = scoreRecipe(ocrPartial);
    const ocrRecipe: Recipe = { ...ocrPartial, confidence: ocrConfidence };

    if (ocrConfidence >= CAPTION_CONFIDENCE_THRESHOLD) {
      onProgress("Done (OCR path).");
      return { recipe: ocrRecipe, source: "ocr", jobId };
    }

    onProgress(
      `OCR confidence ${ocrConfidence.toFixed(2)} < ${CAPTION_CONFIDENCE_THRESHOLD} — calling Claude vision…`
    );

    // ── Step 4: Claude vision fallback ─────────────────────────────────────
    onProgress("Sending frames to Claude vision…");
    const claudePartial = await claudeVisionFallback(framePaths, ocrPartial);
    const claudeConfidence = scoreRecipe(claudePartial);
    const claudeRecipe: Recipe = {
      ...claudePartial,
      confidence: claudeConfidence,
    };

    onProgress("Done (Claude vision path).");
    return { recipe: claudeRecipe, source: "claude", jobId };
  } finally {
    // Clean up tmp dir
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

// ── CLI entry point ──────────────────────────────────────────────────────────
if (require.main === module) {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: tsx src/pipeline.ts <reel-url>");
    process.exit(1);
  }
  const { v4: uuidv4 } = require("uuid");
  runPipeline(url, uuidv4(), (msg) => console.log(`[pipeline] ${msg}`))
    .then((result) => {
      console.log("\n── Recipe ──────────────────────────────────────");
      console.log(JSON.stringify(result.recipe, null, 2));
      console.log("\n── HTML ────────────────────────────────────────");
      console.log(renderHtml(result.recipe));
    })
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
