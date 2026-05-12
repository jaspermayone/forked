#!/usr/bin/env npx tsx
/**
 * test-public-reel.ts
 *
 * Validates whether a public Instagram Reel is accessible without auth.
 * Checks for login walls, video element presence, and CDN video URL capture.
 *
 * Usage:
 *   npx tsx test-public-reel.ts <reel-url>
 *   npx tsx test-public-reel.ts https://www.instagram.com/reel/ABC123/
 *
 * Prerequisites:
 *   npm install -g agent-browser
 *   agent-browser install
 *   npm install tsx --save-dev   (or install globally)
 */

import { execSync, spawnSync } from "child_process";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REEL_URL = process.argv[2];
const WAIT_MS = 8000;         // time to let the page settle after load
const HAR_RECORD_MS = 35000;  // how long to record HAR (covers one full reel loop)
const TMP_DIR = join(tmpdir(), `reel-test-${Date.now()}`);
const HAR_PATH = join(TMP_DIR, "reel.har");
const SCREENSHOT_PATH = join(TMP_DIR, "screenshot.png");

// Signals that Instagram is showing a login wall.
// Excludes bare "Log in" / "Sign up" which appear in the nav on every page.
const LOGIN_WALL_SIGNALS = [
  "You must log in",
  "Log in to see photos",
  "Log in to Instagram",
  "Create an account to see",
  'dialog "Log in"',
  'dialog "Sign up"',
];

// What we expect to see on a real recipe reel
const CONTENT_SIGNALS = [
  "video",       // video element in accessibility tree
  "Reels",
  "Like",
  "Comment",
];

// CDN patterns for Instagram video URLs
const CDN_VIDEO_PATTERNS = [
  /cdninstagram\.com.*\.mp4/i,
  /instagram\.f[a-z]{3}\d+.*\.mp4/i,
  /video\/mp4/i,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ab(args: string[], label?: string): { stdout: string; stderr: string; ok: boolean } {
  if (label) process.stdout.write(`  → ${label}... `);
  const result = spawnSync("agent-browser", args, { encoding: "utf-8" });
  const ok = result.status === 0;
  if (label) console.log(ok ? "✓" : "✗");
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ok,
  };
}

function sleep(ms: number, label?: string): void {
  if (label) process.stdout.write(`  → ${label}... `);
  execSync(`sleep ${ms / 1000}`);
  if (label) console.log("✓");
}

function checkAgentBrowser(): boolean {
  try {
    execSync("agent-browser --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function parseHar(harPath: string): { videoUrls: string[]; allRequests: number } {
  const raw = readFileSync(harPath, "utf-8");
  const har = JSON.parse(raw);
  const entries: any[] = har?.log?.entries ?? [];

  const videoUrls: string[] = [];

  for (const entry of entries) {
    const url: string = entry?.request?.url ?? "";
    const contentType: string =
      entry?.response?.content?.mimeType ?? "";

    const isVideo =
      CDN_VIDEO_PATTERNS.some((p) => p.test(url)) ||
      contentType.includes("video/mp4");

    if (isVideo && !videoUrls.includes(url)) {
      videoUrls.push(url);
    }
  }

  return { videoUrls, allRequests: entries.length };
}

function checkLoginWall(snapshotText: string): string | null {
  for (const signal of LOGIN_WALL_SIGNALS) {
    if (snapshotText.toLowerCase().includes(signal.toLowerCase())) {
      return signal;
    }
  }
  return null;
}

function checkContentPresent(snapshotText: string): string[] {
  return CONTENT_SIGNALS.filter((s) =>
    snapshotText.toLowerCase().includes(s.toLowerCase())
  );
}

function separator(char = "─", len = 60) {
  console.log(char.repeat(len));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\n🎬 Instagram Public Reel Auth Test\n");
  separator();

  // 0. Validate inputs
  if (!REEL_URL) {
    console.error("Error: no URL provided.\n");
    console.error("Usage: npx tsx test-public-reel.ts <reel-url>");
    process.exit(1);
  }

  if (!REEL_URL.includes("instagram.com/reel")) {
    console.warn(`Warning: URL doesn't look like a Reel: ${REEL_URL}`);
    console.warn("Continuing anyway...\n");
  }

  if (!checkAgentBrowser()) {
    console.error("Error: agent-browser not found.");
    console.error("Install with: npm install -g agent-browser && agent-browser install");
    process.exit(1);
  }

  mkdirSync(TMP_DIR, { recursive: true });
  console.log(`Temp dir: ${TMP_DIR}`);
  console.log(`Target:   ${REEL_URL}\n`);

  const results: Record<string, any> = {};

  // ---------------------------------------------------------------------------
  // Test 1: Can we open the page without auth?
  // ---------------------------------------------------------------------------
  separator();
  console.log("TEST 1: Page load without auth\n");

  let opened = ab(["open", REEL_URL], "Opening URL");
  results.pageOpened = opened.ok;

  if (!opened.ok) {
    console.log(`  stderr: ${opened.stderr.trim()}`);
  }

  // Wait for the page to settle
  ab(["wait", "--load", "networkidle"], "Waiting for networkidle");
  sleep(WAIT_MS, `Waiting ${WAIT_MS}ms for dynamic content`);

  // ---------------------------------------------------------------------------
  // Test 2: Screenshot
  // ---------------------------------------------------------------------------
  separator();
  console.log("TEST 2: Screenshot\n");

  const shot = ab(["screenshot", SCREENSHOT_PATH], "Taking screenshot");
  results.screenshotOk = shot.ok && existsSync(SCREENSHOT_PATH);

  if (results.screenshotOk) {
    console.log(`  Saved: ${SCREENSHOT_PATH}`);
  } else {
    console.log("  Screenshot failed or file not written.");
  }

  // ---------------------------------------------------------------------------
  // Test 3: Accessibility snapshot — login wall detection
  // ---------------------------------------------------------------------------
  separator();
  console.log("TEST 3: Login wall detection\n");

  const snapshot = ab(["snapshot"], "Getting accessibility snapshot");
  const snapshotText = snapshot.stdout;

  const loginSignal = checkLoginWall(snapshotText);
  const contentSignals = checkContentPresent(snapshotText);

  results.loginWallDetected = loginSignal !== null;
  results.loginWallSignal = loginSignal;
  results.contentSignalsFound = contentSignals;

  if (loginSignal) {
    console.log(`  ⚠️  Login wall detected: "${loginSignal}"`);
  } else {
    console.log("  ✓  No login wall signals found");
  }

  if (contentSignals.length > 0) {
    console.log(`  ✓  Content signals present: ${contentSignals.join(", ")}`);
  } else {
    console.log("  ✗  No expected content signals found in snapshot");
  }

  // Print a snippet of the snapshot for manual inspection
  const snapshotLines = snapshotText.split("\n").slice(0, 30);
  console.log("\n  Snapshot preview (first 30 lines):");
  snapshotLines.forEach((l) => console.log(`    ${l}`));

  // ---------------------------------------------------------------------------
  // Test 4: HAR capture — video URL discovery
  // ---------------------------------------------------------------------------
  separator();
  console.log("TEST 4: Video URL discovery via HAR\n");

  // Close and reopen to get a clean HAR from the start of video playback
  ab(["close"], "Closing browser");
  ab(["open", REEL_URL], "Reopening for HAR capture");
  ab(["wait", "--load", "networkidle"], "Waiting for networkidle");
  ab(["network", "har", "start"], "Starting HAR recording");
  sleep(HAR_RECORD_MS, `Recording for ${HAR_RECORD_MS / 1000}s`);
  ab(["network", "har", "stop", HAR_PATH], "Stopping HAR recording");

  results.harCaptured = existsSync(HAR_PATH);

  if (results.harCaptured) {
    const { videoUrls, allRequests } = parseHar(HAR_PATH);
    results.videoUrlsFound = videoUrls;
    results.totalHarRequests = allRequests;

    console.log(`  HAR captured: ${allRequests} total requests`);

    if (videoUrls.length > 0) {
      console.log(`  ✓  Video URLs found: ${videoUrls.length}`);
      videoUrls.forEach((u, i) => {
        // Truncate long URLs for display
        const display = u.length > 100 ? u.slice(0, 97) + "..." : u;
        console.log(`    [${i + 1}] ${display}`);
      });
    } else {
      console.log("  ✗  No video URLs found in HAR");
      console.log("     This may mean the video is served via HLS/DASH segments,");
      console.log("     or Instagram used a non-standard CDN URL pattern.");
    }
  } else {
    console.log("  ✗  HAR file not written");
    results.videoUrlsFound = [];
    results.totalHarRequests = 0;
  }

  // ---------------------------------------------------------------------------
  // Test 5: Video element presence in page
  // ---------------------------------------------------------------------------
  separator();
  console.log("TEST 5: Video element check\n");

  const videoEval = ab(
    ["eval", "JSON.stringify({ videoCount: document.querySelectorAll('video').length, videoSrc: document.querySelector('video')?.src || document.querySelector('video source')?.src || null })"],
    "Checking for video element via JS"
  );

  let videoInfo: { videoCount: number; videoSrc: string | null } = {
    videoCount: 0,
    videoSrc: null,
  };

  try {
    // agent-browser eval output may include extra lines; find the JSON
    const jsonLine = videoEval.stdout
      .split("\n")
      .find((l) => l.trim().startsWith("{"));
    if (jsonLine) videoInfo = JSON.parse(jsonLine);
  } catch {
    // parse failed, leave defaults
  }

  results.videoElementCount = videoInfo.videoCount;
  results.videoSrcFromDom = videoInfo.videoSrc;

  if (videoInfo.videoCount > 0) {
    console.log(`  ✓  ${videoInfo.videoCount} video element(s) found in DOM`);
    if (videoInfo.videoSrc) {
      const display =
        videoInfo.videoSrc.length > 100
          ? videoInfo.videoSrc.slice(0, 97) + "..."
          : videoInfo.videoSrc;
      console.log(`  ✓  video.src: ${display}`);

      if (!results.videoUrlsFound?.length) {
        results.videoUrlsFound = [videoInfo.videoSrc];
      }
    } else {
      console.log("  ⚠  video element found but src is empty (may be blob: URL or lazy-loaded)");
    }
  } else {
    console.log("  ✗  No video elements found in DOM");
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------
  ab(["close"], "Closing browser");

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  separator("═");
  console.log("\n📋 RESULTS SUMMARY\n");

  const checks = [
    {
      label: "Page opened without auth",
      pass: results.pageOpened,
    },
    {
      label: "Screenshot captured",
      pass: results.screenshotOk,
    },
    {
      label: "No login wall detected",
      pass: !results.loginWallDetected,
      detail: results.loginWallDetected ? `"${results.loginWallSignal}"` : null,
    },
    {
      label: "Content signals present",
      pass: results.contentSignalsFound?.length > 0,
      detail: results.contentSignalsFound?.join(", "),
    },
    {
      label: "HAR captured",
      pass: results.harCaptured,
    },
    {
      label: "Video URL(s) found",
      pass: results.videoUrlsFound?.length > 0,
      detail: results.videoUrlsFound?.length
        ? `${results.videoUrlsFound.length} URL(s)`
        : "none",
    },
    {
      label: "Video element in DOM",
      pass: results.videoElementCount > 0,
      detail: results.videoElementCount
        ? `${results.videoElementCount} element(s)`
        : null,
    },
  ];

  for (const check of checks) {
    const icon = check.pass ? "✅" : "❌";
    const detail = check.detail ? `  (${check.detail})` : "";
    console.log(`  ${icon}  ${check.label}${detail}`);
  }

  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;

  console.log(`\n  ${passed}/${total} checks passed`);

  separator("═");

  // Verdict
  const canProceed =
    !results.loginWallDetected &&
    results.pageOpened &&
    (results.videoUrlsFound?.length > 0 || results.videoElementCount > 0);

  if (canProceed) {
    console.log("\n✅ VERDICT: Public access confirmed. Pipeline can proceed without auth.\n");
    if (results.videoUrlsFound?.length > 0) {
      console.log("   HAR-based video download path is viable.");
    } else {
      console.log("   No CDN URL found in HAR — fall back to screenshot sampling.");
    }
  } else if (results.loginWallDetected) {
    console.log("\n❌ VERDICT: Login wall detected. Auth flow required before building pipeline.\n");
    console.log("   Next step: use agent-browser --session-name instagram to log in once,");
    console.log("   then save state with: agent-browser state save instagram-auth.json\n");
  } else {
    console.log("\n⚠️  VERDICT: Inconclusive. Page opened but no video content detected.\n");
    console.log("   Check the screenshot manually:", SCREENSHOT_PATH);
    console.log("   Check the snapshot output above for clues.\n");
  }

  // Keep temp dir for inspection
  console.log(`Temp files kept at: ${TMP_DIR}`);
  console.log("  Delete when done: rm -rf " + TMP_DIR + "\n");

  process.exit(canProceed ? 0 : 1);
}

main().catch((err) => {
  console.error("\nUnhandled error:", err);
  process.exit(1);
});