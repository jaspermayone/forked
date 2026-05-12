import { spawnSync, execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

function ab(args: string[]): { stdout: string; stderr: string; ok: boolean } {
  const result = spawnSync("agent-browser", args, { encoding: "utf-8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ok: result.status === 0,
  };
}

const CDN_VIDEO_PATTERNS = [
  /cdninstagram\.com.*\.mp4/i,
  /instagram\.f[a-z]{3}\d+.*\.mp4/i,
];

function parseHarForVideoUrl(harPath: string): string | null {
  const raw = readFileSync(harPath, "utf-8");
  const har = JSON.parse(raw);
  const entries: any[] = har?.log?.entries ?? [];

  for (const entry of entries) {
    const url: string = entry?.request?.url ?? "";
    const contentType: string = entry?.response?.content?.mimeType ?? "";
    if (
      CDN_VIDEO_PATTERNS.some((p) => p.test(url)) ||
      contentType.includes("video/mp4")
    ) {
      return url;
    }
  }
  return null;
}

/** Downloads the reel video to outDir. Returns path to .mp4 or null if not found. */
export async function acquireVideo(
  url: string,
  outDir: string
): Promise<string | null> {
  mkdirSync(outDir, { recursive: true });
  const harPath = join(outDir, "reel.har");

  ab(["open", url]);
  ab(["wait", "--load", "networkidle"]);
  ab(["network", "har", "start"]);
  // Let the reel play through once (~30s typical)
  execSync("sleep 35");
  ab(["network", "har", "stop", harPath]);
  ab(["close"]);

  if (!existsSync(harPath)) return null;

  const videoUrl = parseHarForVideoUrl(harPath);
  if (!videoUrl) return null;

  const outPath = join(outDir, "video.mp4");
  const dl = spawnSync("curl", ["-sL", "-o", outPath, videoUrl], {
    encoding: "utf-8",
    timeout: 60_000,
  });

  return dl.status === 0 && existsSync(outPath) ? outPath : null;
}

/** Screenshot sampling fallback when HAR capture finds no video URL. */
export async function acquireFramesViaScreenshots(
  url: string,
  outDir: string,
  maxFrames = 80
): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });

  ab(["open", url]);
  ab(["wait", "--load", "networkidle"]);
  execSync("sleep 2");

  const frames: string[] = [];

  for (let i = 0; i < maxFrames; i++) {
    const framePath = join(outDir, `frame_${String(i).padStart(4, "0")}.png`);
    const shot = ab(["screenshot", framePath]);
    if (shot.ok && existsSync(framePath)) {
      frames.push(framePath);
    }
    // Check if reel ended (replay button visible)
    const snap = ab(["snapshot"]);
    if (snap.stdout.includes("Play again") || snap.stdout.includes("Replay")) {
      break;
    }
    execSync("sleep 0.5");
  }

  ab(["close"]);
  return frames;
}
