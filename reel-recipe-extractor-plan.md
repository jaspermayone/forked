# Forked — Implementation Plan

## Overview

**Forked** is a web app (with a CLI core) that takes an Instagram Reel URL and outputs clean
semantic HTML suitable for reader-mode tools like pare.dunkirk.sh.

Lives at `forked.jaspermayone.com`, hosted on Dippet (Mac mini).

Runs on a Mac mini. No AI by default; Claude vision is a fallback for low-confidence
output only.

### Key finding from auth test

The accessibility snapshot for a public Reel contains the full caption text,
including the complete recipe, in a single DOM node. For most recipe Reels, the
creator pastes the full recipe into the caption. Caption scraping is therefore
the primary extraction path -- it's free, instant, and requires no video processing.
OCR is the fallback for Reels where the recipe only appears on screen.

---

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | Node.js (TypeScript) | Good ecosystem for this; easy agent-browser integration |
| Browser automation | agent-browser | CLI tool, shell out from Node |
| Video frame extraction | ffmpeg | Extract frames from downloaded video |
| OCR | tesseract.js | Node bindings, no separate install needed |
| Perceptual hashing | sharp + imghash | Frame dedup before OCR |
| Web server | Express | Simple, serves the web UI and API |
| Frontend | Vanilla HTML/JS | No framework needed for this scope |
| AI fallback | Anthropic SDK (claude-sonnet-4-5) | Vision API, only on low-confidence frames |

---

## Project Structure

```
reel-recipe/
├── src/
│   ├── server.ts           # Express app, routes
│   ├── pipeline.ts         # Orchestrates the full extraction pipeline
│   ├── caption.ts          # PRIMARY: agent-browser DOM scrape of caption text
│   ├── acquire.ts          # FALLBACK: agent-browser open URL, get video
│   ├── frames.ts           # ffmpeg: extract frames, pHash dedup
│   ├── ocr.ts              # tesseract.js: OCR per frame, merge results
│   ├── parse.ts            # Heuristic recipe structure parser (shared)
│   ├── confidence.ts       # Score the parsed output
│   ├── fallback.ts         # Claude vision for low-confidence cases
│   └── render.ts           # Render structured recipe to HTML
├── public/
│   └── index.html          # Web UI (URL input + result display)
├── tmp/                    # Scratch space for frames, video (gitignored)
├── package.json
└── README.md
```

---

## Pipeline Detail

The pipeline tries extraction methods in order, stopping at the first
high-confidence result:

```
1. Caption scrape  →  parse  →  confidence check  →  render   (fast, free)
2. Video OCR       →  parse  →  confidence check  →  render   (slow, local)
3. Claude vision   →  parse  →  render                        (API cost)
```

---

### Step 1: Caption scrape (`caption.ts`) — PRIMARY PATH

Open the Reel with agent-browser and take an accessibility snapshot. Extract
the caption text node, which Instagram renders as a large `button` or `generic`
element in the accessibility tree containing the full post text.

**Verified behavior (from auth test, 2026-05-12):** The accessibility snapshot
for a public Reel contains the complete caption -- including full ingredient list
and numbered steps -- in a single DOM node. No login required. Example node:

```
- button "Garlic parmesan cheeseburger bombs 🍔 ... RECIPE ⬇️ * 1 lb 80/20
  ground beef ... 1. Cook the ground beef on medium heat ..." [ref=e38]
```

Implementation:

```typescript
// caption.ts
export async function scrapeCaption(url: string): Promise<string | null> {
  ab(["open", url]);
  ab(["wait", "--load", "networkidle"]);
  sleep(3000);
  const snapshot = ab(["snapshot"]);

  // Find longest text node in <main> -- that's the caption
  const lines = snapshot.stdout.split("\n");
  const candidates = lines
    .filter(l => l.includes("StaticText") || l.includes("button"))
    .map(l => extractTextContent(l))
    .filter(t => t && t.length > 200);  // captions are long

  // Pick the longest candidate
  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}
```

Pass the raw caption string to `parse.ts`. If `captionConfidence < 0.6`,
fall through to the video pipeline.

---

### Step 2: Acquire (`acquire.ts`) — VIDEO FALLBACK

Only runs if caption scrape returns confidence < 0.6.

Use agent-browser to open the Reel and capture the video URL from network
traffic, or fall back to screenshot sampling if the video can't be grabbed
directly.

**Primary path — HAR capture:**
```bash
agent-browser open <url>
agent-browser wait --load networkidle
agent-browser network har start
agent-browser wait 45000              # let the reel play through once
agent-browser network har stop tmp/<id>.har
agent-browser close
```

Parse the HAR for requests to `cdninstagram.com` with a `.mp4` extension or
`video/mp4` content-type. Download that URL with a plain HTTP GET (no auth
needed for CDN URLs once captured).

**Fallback path — screenshot sampling:**
If no video URL found in HAR, take a screenshot every 500ms for the duration
of the video (detect end by watching for the replay button to appear in the
accessibility tree).

```bash
agent-browser screenshot tmp/<id>/frame_001.png
agent-browser wait 500
agent-browser screenshot tmp/<id>/frame_002.png
# ... loop
```

Screenshot sampling produces larger sets of frames but skips ffmpeg.

**Auth test:** On first run, attempt the Reel URL without any session state.
Log whether the page loaded content or a login wall. This tells us immediately
if public Reels work unauthenticated. (Hypothesis: yes, CDN video URLs are
public once discovered.)

---

### Step 3: Frame extraction + dedup (`frames.ts`)

If we got a video file:
```bash
ffmpeg -i tmp/<id>.mp4 -r 4 tmp/<id>/frames/frame_%04d.png
```

4fps is enough to catch even fast-flashing text. A 30-second reel = ~120 frames.

**Perceptual hash dedup:**
Compute pHash for each frame using `sharp` + `imghash`. Compare adjacent
frames. If hamming distance < threshold (e.g. 8), discard the duplicate.
Typically reduces frame count by 60-80% for slow recipes, less for karaoke-style.

Only OCR the unique frames.

---

### Step 4: OCR (`ocr.ts`)

Run `tesseract.js` on each unique frame.

Config:
- Language: `eng` (add `spa` etc. later if needed)
- PSM 6 (assume a single uniform block of text) or PSM 3 (auto) -- test both
- Whitelist: printable ASCII + common cooking characters (°, ½, ¼, ⅓, etc.)

Post-OCR cleanup per frame:
- Strip lines that are < 3 characters (noise)
- Strip lines that are > 80% non-alphanumeric (graphical artifacts)
- Normalize whitespace

Merge all frame text into a single deduplicated list. Use exact string
matching first, then fuzzy match (Levenshtein distance < 3) to catch
OCR inconsistencies across frames (e.g. "2 cups flour" vs "2 cups flcur").

---

### Step 5: Heuristic parser (`parse.ts`)

Takes the merged text lines and produces a structured recipe object:

```typescript
interface Recipe {
  title: string | null
  servings: string | null
  time: string | null
  ingredients: string[]
  steps: string[]
  notes: string[]
  confidence: number   // 0-1, set by confidence.ts
}
```

**Heuristics:**

Title:
- First non-trivial line (> 4 chars, not a quantity)
- OR line that appears in the first 10% of frames

Ingredients:
- Matches: `^\d[\d/\s]*\s+(cup|tbsp|tsp|oz|lb|g|ml|clove|pinch|handful)` etc.
- OR lines starting with a bullet/dash
- OR short lines (< 40 chars) that appear early in the video

Steps:
- Numbered lines (`1.`, `Step 1`, etc.)
- OR longer lines (> 40 chars) that aren't ingredients
- OR lines that appear in sequence across frames (temporal ordering)

Notes:
- Everything that doesn't fit above

---

### Step 6: Confidence scoring (`confidence.ts`)

Score 0-1 based on:
- Did we find a title? (+0.2)
- Did we find >= 2 ingredients? (+0.3)
- Did we find >= 1 step? (+0.2)
- Are ingredient lines parseable (have quantities)? (+0.15)
- Low noise ratio in OCR output? (+0.15)

If confidence < 0.6, trigger the AI fallback.

---

### Step 7: AI fallback (`fallback.ts`)

Only runs on low-confidence results. Send a representative sample of frames
(max 10, selected for text density) to Claude vision:

```
System: You are extracting a recipe from video frames. Return only JSON.
User: [frame images]
      Extract the complete recipe from these frames. Return:
      { title, servings, time, ingredients: string[], steps: string[], notes: string[] }
      Reconstruct partial/flashing text. If something appears across multiple
      frames, include it once.
```

Parse the JSON response and merge with any high-confidence fields already
extracted by the heuristic pass.

---

### Step 8: HTML renderer (`render.ts`)

Outputs clean semantic HTML. No CSS classes, no styling -- just structure that
reader-mode tools can parse.

```html
<!DOCTYPE html>
<html lang="en">
<head><title>{title}</title></head>
<body>
  <article>
    <h1>{title}</h1>
    <p>Serves: {servings} · Time: {time}</p>
    <h2>Ingredients</h2>
    <ul>
      <li>{ingredient}</li>
    </ul>
    <h2>Instructions</h2>
    <ol>
      <li>{step}</li>
    </ol>
    <h2>Notes</h2>
    <p>{notes}</p>
  </article>
</body>
</html>
```

This is intentionally bare. pare.dunkirk.sh and similar tools strip styling
anyway and rely on semantic tags.

---

## Web UI (`public/index.html`)

Single page:
- URL input field
- Submit button
- Status display (pipeline progress)
- Result panel with:
  - Rendered preview of the recipe
  - "Copy HTML" button (copies the raw HTML to clipboard)
  - "Open in pare" button (opens `https://pare.dunkirk.sh` -- user pastes manually,
    or we could use a URL fragment if pare supports it)
  - Download as `.html` button

The frontend polls `GET /api/status/:jobId` while the pipeline runs.

---

## API (`server.ts`)

```
POST /api/extract        body: { url: string }
                         returns: { jobId: string }

GET  /api/status/:jobId  returns: { status, progress, result? }

GET  /api/result/:jobId  returns: HTML file download
```

Jobs are in-memory for now (single user, Mac mini). Add a SQLite job store
later if needed.

---

## Server setup (Alastor)

Dependencies to install:
```bash
brew install ffmpeg        # or apt install ffmpeg if Alastor is Linux
npm install -g agent-browser
agent-browser install      # downloads Chrome for Testing
```

Then:
```bash
npm install
npm run build
npm start                  # starts Express on port 3000
```

Expose via Caddy on Alastor. Add to Caddyfile:
```
forked.jaspermayone.com {
    reverse_proxy localhost:3000
}
```

---

## Build order

1. ~~Auth test script~~ **DONE** -- public Reels confirmed accessible; caption
   contains full recipe text in accessibility snapshot
2. `caption.ts` -- DOM scrape of caption text from accessibility snapshot
3. `parse.ts` + `confidence.ts` -- structure the text (works for both caption
   and OCR output; build once, use for both paths)
4. `render.ts` -- HTML output
5. `server.ts` + web UI -- wrap caption path in a working web app end-to-end
6. `acquire.ts` -- video fallback; get a video file or frames from a real Reel
7. `frames.ts` -- ffmpeg extraction + pHash dedup
8. `ocr.ts` -- tesseract on frames, merge output, feed into existing `parse.ts`
9. `fallback.ts` -- Claude vision; add last, once we know where heuristics fail

---

## Resolved questions

- **Public access without auth**: Confirmed. Public Reels load fully without
  login. The nav bar shows "Log In" / "Sign Up" links but the content is
  unblocked.
- **Caption as primary source**: Confirmed. The full recipe (ingredients +
  numbered steps) is present in the accessibility snapshot caption node.
  OCR is a fallback, not the primary path.

## Open questions / risks

- **Instagram bot detection**: agent-browser runs a real Chrome, which helps.
  But Instagram may detect headless mode. The `--headed` flag + a real Chrome
  profile (`--profile Default`) may be needed.
- **Video URL stability**: CDN URLs from the HAR may expire. Need to download
  immediately after capture.
- **Karaoke-style text at 4fps**: May still miss sub-250ms flashes. Can bump
  to 8fps at cost of more frames to OCR. Or use ffmpeg's scene detection filter
  to extract frames only on visual change.
- **Tesseract accuracy on stylized fonts**: Some Reels use decorative fonts.
  May need preprocessing (contrast boost, binarization) with sharp before OCR.
