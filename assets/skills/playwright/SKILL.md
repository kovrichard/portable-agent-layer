---
name: playwright
description: "Capture a screenshot of a URL or local page and load it into context for a visual check. Use when asked to check visually, use playwright, screenshot a page, see or look at the design yourself, or verify a layout on desktop and mobile widths."
argument-hint: <url> [--viewport WxH] [--full-page] [--selector <css>]
---

## Overview

Take a screenshot of a running page and `Read` it into context so you can see the rendered result yourself — for design review, responsive checks (desktop + mobile widths), and confirming a layout fix actually looks right. This skill returns an **image**, not page data.

## Engine selection (handled by the tool)

The bundled tool picks the best available local engine automatically:

1. **System `playwright-cli`** (Microsoft's stateful agent CLI) — used when it is on `PATH` and no exact viewport/full-page is requested (its `screenshot` command can't set those).
2. **PAL-installed Playwright, launched via Node** — the cross-platform-safe path (Playwright's Chromium hangs under Bun on Windows). Honors `--viewport`, `--full-page`, and `--selector` precisely.

If neither engine is usable, the tool prints `NO_PLAYWRIGHT_CLI` and exits non-zero — only then use the **Playwright MCP** (tier 3) in step 4.

## Workflow

1. Resolve the URL. If it's a local app, make sure the dev server is already running first.
2. Run the tool (it prints the absolute PNG path as its last stdout line):

   ```bash
   node ~/.pal/skills/playwright/tools/shot.mjs <url> \
     [--viewport 1440x900] [--full-page] [--selector "<css>"] [-o <out.png>]
   ```

3. `Read` the printed path so the screenshot enters your context. For a responsive check, run once per width (e.g. `--viewport 1440x900` then `--viewport 390x844`) and Read each.
4. If the tool exits with `NO_PLAYWRIGHT_CLI`:
   - If Playwright MCP tools (`mcp__playwright__browser_*`) are available: `browser_navigate` to the URL, `browser_take_screenshot` to a file, then `Read` it.
   - Otherwise, tell the user Playwright isn't installed and suggest running `pal cli install`.

## Output format

The screenshot image (via `Read`) plus one line stating the URL and viewport captured. Add a review only if the caller asked you to assess the design.

## When to use

- "check visually", "use playwright", "screenshot this", "see/look at the design yourself", "does this look right", desktop/mobile layout verification.

## Do NOT use

- To scrape page text or DOM data — fetch the page directly instead; this returns an image.
- To measure computed styles, element sizes, or horizontal overflow — use the Playwright MCP `browser_evaluate` for metrics; this skill does not return numbers.
