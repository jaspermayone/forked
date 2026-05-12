import { spawnSync, execSync } from "child_process";

function ab(args: string[]): { stdout: string; stderr: string; ok: boolean } {
  const result = spawnSync("agent-browser", args, { encoding: "utf-8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ok: result.status === 0,
  };
}

function extractTextContent(line: string): string {
  const match = line.match(/"([\s\S]+?)"\s*(?:\[|$)/);
  return match ? match[1].trim() : "";
}

function extractRef(line: string): string | null {
  const match = line.match(/\[ref=([^\]]+)\]/);
  return match ? match[1] : null;
}

function indentOf(line: string): number {
  return line.search(/\S/);
}

// UI chrome that's definitely not recipe content
const UI_NOISE =
  /^(Audio is muted|Audio image|Video player|Press to play|Play again|Replay|Log In|Sign Up|Follow|Like|Comment|Share|More options|Peaceful Reveries|Carefree Days)/i;

// Music attribution: "Artist · Song title · Explicit" / "· Original Audio"
const MUSIC_LINE = /·\s*(explicit|original\s+audio)/i;

/**
 * Find the caption button for the target reel.
 * Looks for the first button in <main> that isn't a UI control.
 * No upper length limit — the full recipe can be hundreds of chars inline.
 */
function findCaptionButton(
  lines: string[]
): { idx: number; indent: number; ref: string | null } | null {
  let inMain = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!inMain) {
      if (/^\s*-\s+main\b/.test(line)) inMain = true;
      continue;
    }

    if (!line.includes("button")) continue;

    const text = extractTextContent(line);
    if (text.length < 5) continue;
    if (UI_NOISE.test(text)) continue;
    if (MUSIC_LINE.test(text)) continue;
    if (/^(Audio|Video|Play|Press|Like|Comment|Share|Follow|Save|More|Navigate|Go back|Pause|Mute|Unmute|Repost|Send)/i.test(text)) continue;

    return { idx: i, indent: indentOf(line), ref: extractRef(line) };
  }

  return null;
}

/**
 * Collect the caption text.
 * When the button's own inline text is already long (full recipe inline),
 * return it directly to avoid duplicating with its child StaticText nodes.
 * Otherwise traverse the subtree to pick up expanded/multiline content.
 */
function extractCaptionSubtree(
  lines: string[],
  captionIdx: number,
  captionIndent: number
): string {
  const captionText = extractTextContent(lines[captionIdx]);

  // Full recipe is already inline in the button text — return it directly.
  if (captionText.length > 200) return captionText;

  const segments: string[] = [];
  if (captionText) segments.push(captionText);

  for (let i = captionIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const indent = indentOf(line);

    // Stop at same-indent button (= next reel's caption)
    if (indent <= captionIndent && line.includes("button")) break;
    // Stop at anything shallower
    if (indent < captionIndent) break;

    // Skip image / icon alt text
    if (/^\s*-\s+(img|image|svg|icon)\b/i.test(line)) continue;

    const text = extractTextContent(line);
    if (!text || text.length < 2) continue;
    if (UI_NOISE.test(text)) continue;
    if (MUSIC_LINE.test(text)) continue;
    if (!segments.includes(text)) segments.push(text);
  }

  return segments.join("\n");
}

export async function scrapeCaption(url: string): Promise<string | null> {
  ab(["open", url]);
  ab(["wait", "--load", "networkidle"]);
  execSync("sleep 6");

  const snap1 = ab(["snapshot"]);
  if (!snap1.ok || !snap1.stdout) {
    ab(["close"]);
    return null;
  }

  const lines1 = snap1.stdout.split("\n");

  // Detect HTTP error pages (429 rate-limit, 5xx, etc.) before wasting time
  const errorHeading = lines1.find(l => /heading ".*?(isn't working|error|too many requests)/i.test(l));
  const http4xx5xx = lines1.find(l => /HTTP ERROR \d{3}/.test(l));
  if (errorHeading || http4xx5xx) {
    const code = (http4xx5xx?.match(/HTTP ERROR (\d+)/) ?? [])[1] ?? "?";
    console.log(`[caption] HTTP ${code} error page — Instagram blocked the request`);
    ab(["close"]);
    return null;
  }

  const cap1 = findCaptionButton(lines1);

  if (!cap1) {
    ab(["close"]);
    return null;
  }

  const firstPass = extractCaptionSubtree(lines1, cap1.idx, cap1.indent);

  if (firstPass.length > 400) {
    ab(["close"]);
    return firstPass;
  }

  // Caption looks truncated — click to expand
  if (cap1.ref) {
    ab(["click", `ref=${cap1.ref}`]);
    execSync("sleep 2");
  }

  // Also click any explicit "…more" link
  for (const line of lines1) {
    if (!/\bmore\b/i.test(line) || !/button|link/.test(line)) continue;
    const text = extractTextContent(line);
    if (/options|audio|share|comment|follow/i.test(text)) continue;
    const ref = extractRef(line);
    if (ref && ref !== cap1.ref) {
      ab(["click", `ref=${ref}`]);
      execSync("sleep 1");
      break;
    }
  }

  const snap2 = ab(["snapshot"]);
  ab(["close"]);

  if (!snap2.ok || !snap2.stdout) return firstPass || null;

  const lines2 = snap2.stdout.split("\n");
  const cap2 = findCaptionButton(lines2);
  if (!cap2) return firstPass || null;

  const secondPass = extractCaptionSubtree(lines2, cap2.idx, cap2.indent);
  return secondPass.length > firstPass.length ? secondPass : firstPass;
}
