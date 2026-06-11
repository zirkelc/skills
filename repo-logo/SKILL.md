---
name: repo-logo
description: Generate a logo and a social banner for a GitHub repository and optionally add them to the repo (logo into the README, banner as the repo's social preview). Use when the user wants a repo logo, README logo, repo banner, GitHub social preview, or repo card image.
argument-hint: "[repo name or URL, e.g. zirkelc/skills, plus optional style hint like 'minimal dark blue']"
---

# Repo Logo & Banner

Design a **logo** and a **social banner** for a GitHub repository, render them to PNG, let the user iterate, and (on confirmation) wire them into the repo: the logo goes into the README, the banner becomes the repo's social preview.

Author the artwork as **SVG** (full control over shapes, gradients, and typography) and rasterize to PNG with the bundled `render.mjs` (which uses `@resvg/resvg-js`). This produces exact-dimension, crisp output with no system image tools required.

## Recommended sizes

- **Logo** — square. GitHub has no official README logo size; the convention is a square logo *displayed* at ~150–200px wide. Render the source PNG larger for crispness on HiDPI screens: design at `512×512`, render at `512` (or `1024` for 2x). Use a transparent background so it sits on both README themes. GitHub renders the README in **light or dark mode**, so the logo must read on both (see the theme decision in Step 2).
- **Banner / social preview** — `1280×640` (2:1 aspect ratio). Minimum `640×320`. Must be PNG/JPG/GIF **under 1 MB**. Keep all important content (logo, title, tagline) inside a **~80px safe margin** from every edge (the GitHub repo-card template reserves a ~40pt border at 2x), because the card is cropped differently across platforms.

## Argument Hint

If the user passed an argument it may contain:
- **A repo** — `owner/name` or a full GitHub URL. Use it as the target.
- **A style hint** — e.g. `minimal`, `dark`, `playful mascot`, brand colors. Fold it into the design proposals in Step 2.

If no repo is given, ask for one.

## Step 1: Resolve the Repo and Read Its README

Resolve the repo to `owner/name`. Then gather context with the GitHub CLI:

- Metadata (design cues): `gh repo view <owner>/<repo> --json name,description,primaryLanguage,repositoryTopics,homepageUrl,owner,url`
- README (raw): `gh api repos/<owner>/<repo>/readme -H "Accept: application/vnd.github.raw"`

**Read the README fully.** Note anything that should inform the design: the project's purpose and domain, the tech stack, any existing colors/emoji/branding, and whether a logo or banner already exists (so you don't duplicate or clash).

If `gh` is not authenticated or the repo is private/inaccessible, say so and ask how to proceed.

## Step 2: Propose Designs and Ask Questions

Based on the README, propose **1–3 concrete design directions** for the logo (and how the banner extends it). For each, state the style (e.g. minimal icon, lettermark/monogram, wordmark, mascot), a color palette (hex), the typography, and the motif and how it ties to the project.

Ask any clarifying questions in the same message, e.g.:
- Preferred colors / brand palette, or freedom to choose?
- Vibe (minimal / technical / playful / corporate)?
- A symbol or letterform that must appear? A tagline for the banner (default: the repo description)?

**Also decide on theme support for the logo.** GitHub renders the README in light or dark mode, and the logo must read on both. Recommend the simpler option and let the user choose:
- **One logo** — a single theme-neutral version (transparent background, colors with enough contrast on both a near-white and a near-black background). Preferred when it reads cleanly on both.
- **Two logos** — separate light-mode and dark-mode versions, embedded with `<picture>` for automatic switching. Recommend this **only when one version can't read on both themes** — e.g. dark ink/strokes that vanish on a dark background, or light marks that vanish on a light background. Propose two if your design needs it for readability; otherwise default to one.

(The social-preview **banner is always a single image** — it's served to external link unfurlers that have no light/dark mode, so it needs no theme variants. It carries its own background fill.)

**Wait for the user to confirm a direction** (and one-vs-two logos) before generating. Keep proposals short.

## Step 3: Set Up the Working Directory and Rasterizer

Create a working directory in the OS temp folder, install the rasterizer once, and copy the bundled `render.mjs` (next to this SKILL.md) into it so Node resolves `@resvg/resvg-js` from the workdir:

```bash
WORK="$(mktemp -d "${TMPDIR:-/tmp}/repo-logo-XXXXXX")"
cd "$WORK" && npm init -y >/dev/null 2>&1 && npm i @resvg/resvg-js@2 >/dev/null 2>&1
cp "<this skill dir>/render.mjs" "$WORK/render.mjs" && echo "ready: $WORK"
```

Replace `<this skill dir>` with the directory this SKILL.md lives in. All SVGs and PNGs also live in `$WORK`. Tell the user the path.

## Step 4: Author the Designs as SVG

Write the SVG files in `$WORK` using the Write tool, following the theme decision from Step 2.

**Logo** — `width="512" height="512"` (square `viewBox="0 0 512 512"`), transparent background. Must stay legible when shrunk to ~32px (favicon scale): bold shapes, few elements, generous negative space.
- **One logo:** write `logo.svg`.
- **Two logos:** write `logo-light.svg` (shown in **light** mode — use dark-colored marks) and `logo-dark.svg` (shown in **dark** mode — use light-colored marks). Keep the two identical except for the colors that need to flip; usually only the ink/stroke color changes while accent colors stay.

**Banner** — always one file, `banner.svg` — `width="1280" height="640"` (`viewBox="0 0 1280 640"`). Compose the logo motif + the project name + an optional tagline. Keep every important element within the inner `1120×480` region (≥80px from each edge). Give it a solid or gradient background fill (banners are not shown on transparent surfaces, and the social preview has no light/dark mode).

Design notes:
- **Fonts:** resvg renders text with installed system fonts (loaded by default). Use widely available families (e.g. `Helvetica, Arial, sans-serif`; `Georgia, serif`) for predictable output. If a specific font matters, load it explicitly in Step 5 via `font.fontFiles` pointing at a `.ttf`/`.otf` path. If the exact letterforms must be guaranteed regardless of fonts, draw the wordmark as `<path>` instead of `<text>`.
- Keep the logo and banner visually consistent (shared palette, shapes, type).

## Step 5: Rasterize to PNG

Run the bundled script once per SVG you authored. It renders to an exact width (height follows the SVG aspect ratio), loads system fonts, and prints the final dimensions and byte size:

```bash
# node render.mjs <input.svg> <output.png> <width> [background]
cd "$WORK"
# One logo:
node render.mjs logo.svg       logo.png       512    # transparent background
# Or two logos (theme variants):
node render.mjs logo-light.svg logo-light.png 512
node render.mjs logo-dark.svg  logo-dark.png  512
# Banner (always one):
node render.mjs banner.svg     banner.png     1280   # pass e.g. "#0d1117" to force a solid fill
```

Verify dimensions and the banner's file size (must stay under the 1 MB social-preview limit):

```bash
cd "$WORK" && sips -g pixelWidth -g pixelHeight logo.png banner.png 2>/dev/null
ls -l "$WORK/banner.png"   # must be < 1048576 bytes (1 MB)
```

If `banner.png` exceeds 1 MB, simplify the SVG (fewer gradients/filters) or re-render the banner through a JPG/quantization step.

## Step 6: Review and Iterate

Read the rendered PNGs back with the Read tool so you (and the user) can see them, and report the file paths. Ask for feedback.

If you made **two logo variants**, sanity-check each against the theme it targets: `logo-light.png` must read on a near-white background and `logo-dark.png` on a near-black one. Transparent PNGs may appear on a checkerboard in the Read preview — judge contrast against the intended theme background, not the preview.

On any change request, **return to Step 4**, edit the SVGs, re-render, and review again. Loop until the user confirms the images. Do not move on to integration until confirmed.

## Step 7: Integrate Into the Repo (Only After Confirmation)

Ask: **"Want me to add these to the repo — logo into the README, and banner as the social preview?"** Handle the two independently; the user may want only one.

### 7a. Logo → README

1. **Get the repo locally.** Check whether a local clone already exists (ask the user for the path, or look in the usual workspace). If none, ask whether to clone and where, then `git clone`. Never assume a path.
2. **Copy the assets.** Copy every file you produced — each as **both PNG and SVG** — into the repo at a sensible location (default `assets/`; match an existing convention like `.github/` or `docs/` if the repo already uses one). Create the directory if needed. Keeping the editable SVG sources alongside the PNGs lets the artwork be tweaked and re-rendered later.
   ```bash
   mkdir -p "<repo>/assets"
   # one logo:
   cp "$WORK"/logo.{png,svg} "$WORK"/banner.{png,svg} "<repo>/assets/"
   # or two logos:
   cp "$WORK"/logo-light.{png,svg} "$WORK"/logo-dark.{png,svg} "$WORK"/banner.{png,svg} "<repo>/assets/"
   ```
3. **Confirm placement in the README.** Default is the logo centered at the very top, above the title. Confirm the spot, then insert one of:

   **One logo:**
   ```html
   <p align="center">
     <img src="assets/logo.png" alt="<repo name> logo" width="200" />
   </p>
   ```

   **Two logos** — `<picture>` switches automatically with the reader's GitHub theme:
   ```html
   <p align="center">
     <picture>
       <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png" />
       <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.png" />
       <img src="assets/logo-light.png" alt="<repo name> logo" width="200" />
     </picture>
   </p>
   ```
   The plain `<img>` is the fallback for renderers that ignore `<picture>` — point it at the light variant. Set `width` on the `<img>` (150–200 is typical); GitHub honors it for the whole `<picture>`.
4. **Commit.** Stage the asset files and the README. Use a conventional commit (e.g. `docs: add repo logo and banner assets`). **Ask before pushing** unless the user already said to push.

### 7b. Banner → Social Preview

There is **no `gh` CLI command or public API** to set the social preview — it is a web-UI-only setting (Settings → General → "Social preview"). So either:

- **Browser automation (preferred):** use the **agent-browser** skill to open `https://github.com/<owner>/<repo>/settings`, scroll to the **Social preview** section, click **Edit → Upload an image**, and upload `banner.png`. This needs a browser session already logged in to GitHub.
- **Manual fallback:** if automation isn't available or fails, give the user the exact path to `banner.png` and these steps: open the repo's **Settings**, scroll to **Social preview**, click **Edit → Upload an image**, select `banner.png`, done.

## Step 8: Summary

Tell the user:
- The temp paths to `logo.png` and `banner.png`.
- What was integrated: the committed assets (`logo`/`banner`, PNG + SVG) and README change (and whether it was pushed), and whether the social preview was uploaded or is awaiting manual upload.
- Any follow-ups (e.g. "push the README commit", "upload the banner in Settings").
