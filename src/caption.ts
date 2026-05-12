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
  // Pull quoted text out of accessibility snapshot lines like:
  //   - button "some text here" [ref=e38]
  //   - StaticText "some text here"
  const match = line.match(/"([\s\S]+?)"\s*(?:\[|$)/);
  return match ? match[1].trim() : "";
}

export async function scrapeCaption(url: string): Promise<string | null> {
  ab(["open", url]);
  ab(["wait", "--load", "networkidle"]);
  // Let dynamic content settle
  execSync("sleep 3");

  const snapshot = ab(["snapshot"]);
  ab(["close"]);

  if (!snapshot.ok || !snapshot.stdout) return null;

  const lines = snapshot.stdout.split("\n");
  const candidates = lines
    .filter((l) => l.includes("StaticText") || l.includes("button"))
    .map((l) => extractTextContent(l))
    .filter((t) => t.length > 200);

  if (candidates.length === 0) return null;

  // The caption is the longest text node
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}
