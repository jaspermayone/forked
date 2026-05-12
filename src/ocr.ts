import Tesseract from "tesseract.js";

const NOISE_LINE_MIN_LEN = 3;
const NOISE_NON_ALPHA_THRESHOLD = 0.8;

function isNoiseLine(line: string): boolean {
  if (line.length < NOISE_LINE_MIN_LEN) return true;
  const alphaCount = (line.match(/[a-z0-9°½¼¾⅓⅔]/gi) ?? []).length;
  return alphaCount / line.length < 1 - NOISE_NON_ALPHA_THRESHOLD;
}

function normalizeText(text: string): string {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => !isNoiseLine(l))
    .join("\n");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function deduplicateLines(allLines: string[]): string[] {
  const unique: string[] = [];
  for (const line of allLines) {
    const isDup = unique.some(
      (u) => u === line || (line.length > 5 && levenshtein(u, line) <= 3)
    );
    if (!isDup) unique.push(line);
  }
  return unique;
}

export async function ocrFrames(framePaths: string[]): Promise<string> {
  const worker = await Tesseract.createWorker("eng");
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.AUTO as any,
    tessedit_char_whitelist:
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?;:()/-°½¼¾⅓⅔⅛⅜⅝⅞\n",
  });

  const allLines: string[] = [];

  for (const framePath of framePaths) {
    const { data } = await worker.recognize(framePath);
    const cleaned = normalizeText(data.text);
    const lines = cleaned.split("\n").filter((l) => l.length > 0);
    allLines.push(...lines);
  }

  await worker.terminate();

  return deduplicateLines(allLines).join("\n");
}
