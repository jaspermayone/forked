import { spawnSync } from "child_process";
import { mkdirSync, readdirSync } from "fs";
import { join } from "path";
// @ts-ignore — no types shipped with imghash
import imghash from "imghash";

const PHASH_THRESHOLD = 8; // hamming distance below which frames are considered duplicates

function hammingDistance(a: string, b: string): number {
  let dist = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const va = parseInt(a[i], 16);
    const vb = parseInt(b[i], 16);
    const xor = va ^ vb;
    dist += xor.toString(2).split("").filter((c) => c === "1").length;
  }
  return dist;
}

/** Extract frames from video at 4fps into outDir. Returns sorted frame paths. */
export function extractFrames(videoPath: string, outDir: string): string[] {
  mkdirSync(outDir, { recursive: true });

  spawnSync(
    "ffmpeg",
    ["-i", videoPath, "-r", "4", join(outDir, "frame_%04d.png"), "-y"],
    { encoding: "utf-8" }
  );

  return readdirSync(outDir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => join(outDir, f));
}

/** Deduplicate frames using perceptual hashing. Returns unique frame paths. */
export async function dedupFrames(framePaths: string[]): Promise<string[]> {
  if (framePaths.length === 0) return [];

  const unique: string[] = [];
  const hashes: string[] = [];

  for (const framePath of framePaths) {
    let hash: string;
    try {
      hash = await imghash.hash(framePath, 16);
    } catch {
      unique.push(framePath);
      hashes.push("");
      continue;
    }

    const isDup = hashes.some(
      (h) => h && hammingDistance(hash, h) < PHASH_THRESHOLD
    );

    if (!isDup) {
      unique.push(framePath);
      hashes.push(hash);
    }
  }

  return unique;
}
