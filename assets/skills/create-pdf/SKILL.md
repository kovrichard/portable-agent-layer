---
name: create-pdf
description: "Convert markdown files into a styled PDF. Use when creating a PDF from existing markdown files, combining markdown into a report, or converting .md to .pdf."
argument-hint: <file paths, glob pattern, or directory containing .md files>
---

## Overview

Combine one or more markdown files into a single styled PDF. Pipeline: Markdown → HTML → PDF via a headless browser.

This skill handles concatenation, page breaks, styling, and conversion. It does NOT generate content — use the `research` skill or other content-generation workflows first, then pipe the resulting markdown files into this skill.

## Input

The user provides one of:
- **Explicit file paths**: `/path/to/file1.md /path/to/file2.md ...`
- **A glob pattern**: `/path/to/report/*.md`
- **A directory**: `/path/to/report/` (all `.md` files inside, sorted alphabetically)

If no output filename is specified, derive it from the directory name or first file: `<name>.pdf` in the same directory as the input files.

## Workflow

### Step 1: Resolve Input Files

Determine the list of markdown files and their order:
- If explicit paths: use as given
- If glob/directory: list and sort alphabetically (files prefixed with `00_` come first naturally)
- Confirm the file list and order with the user if more than 5 files

### Step 2: Combine (only if multiple files)

For a single input file, skip this step and pass it directly to the tool in Step 3.

For multiple files, concatenate with page break dividers between them into a single temp markdown:

```bash
cat \
  first_file.md \
  <(echo -e '\n\n<div style="page-break-before: always"></div>\n\n---\n\n') \
  second_file.md \
  <(echo -e '\n\n<div style="page-break-before: always"></div>\n\n---\n\n') \
  third_file.md \
  > /tmp/combined.md
```

For many files, generate the cat command dynamically rather than typing each one.

### Step 3: Render to PDF

Invoke the skill tool. Flags:
- `--pdf <path>` — explicit output PDF path (default: `<input_basename>.pdf` next to the input)
- `--html <path>` — explicit intermediate HTML path (default: `<input_basename>.html` next to the input; kept for inspection/re-printing)

Single-file example:

```bash
node ~/.pal/skills/create-pdf/tools/md-to-html-pdf.mjs /path/to/report.md --pdf /path/to/report.pdf
```

Multi-file example (after Step 2):

```bash
node ~/.pal/skills/create-pdf/tools/md-to-html-pdf.mjs /tmp/combined.md --pdf /path/to/report.pdf --html /path/to/report.html
```

The tool writes the self-contained HTML (inline CSS, UTF-8) and the PDF, and prints both paths + sizes on stdout.

### Step 4: Verify and Report

```bash
ls -lh <output>.pdf
```

Report the file path and size to the user.

## Styling

Default styling (A4, 25mm margins, GitHub-ish look, table-friendly, page-break-aware headings) is baked into the tool. Margins and header/footer are configurable per-render via flags — no source edits needed:

- `--margin <css>` — page margin on all four sides (default `25mm`). E.g. `--margin 12mm` for a denser one-pager.
- `--header <html|file>` / `--footer <html|file>` — running header/footer on every page. The value is either an inline HTML string or a path to an HTML file. Templates may use Playwright's injected classes: `pageNumber`, `totalPages`, `date`, `title`, `url`.

```bash
node ~/.pal/skills/create-pdf/tools/md-to-html-pdf.mjs report.md --pdf report.pdf \
  --margin 18mm \
  --header '<div style="font-size:9px;width:100%;text-align:center;color:#888">CONFIDENTIAL</div>' \
  --footer '<div style="font-size:9px;width:100%;text-align:right;padding-right:12mm;color:#888"><span class="pageNumber"></span>/<span class="totalPages"></span></div>'
```

Header/footer templates **need an explicit `font-size`** (Playwright defaults them to 0) and render *inside* the page margin — widen `--margin` so they have room. Do NOT also add CSS `@page` margin-box rules; they duplicate. For deeper changes (fonts, base CSS), edit the `css` string in `tools/md-to-html-pdf.ts` (the `.mjs` is generated from it — never edit the `.mjs`).

## Translation Variant

If the user asks to translate markdown files and then create a PDF:

1. Spawn **parallel subagents** to translate files — batch 2-4 files per agent, all agents in a **single message** (skip parallelism when there is only one file; a single coherent translator is faster and more consistent)
2. Each agent reads the source file, translates all text content to the target language, and writes to `<original_name>_<lang>.md`
3. Rules for translation agents:
   - Keep all markdown formatting, links, and structure identical
   - Keep source/link titles in their original language; translate surrounding text
   - Translate naturally, not word-for-word; use proper domain terminology
4. After all agents complete, run Steps 2-4 above on the translated files
5. Output filename gets a `_<lang>` suffix (e.g., `report_hu.pdf`)

**Batch sizing for translation agents:**

| Files | Agents | Files per agent |
|-------|--------|-----------------|
| 1     | 0      | done inline     |
| 2-4   | 1-2    | 2 each          |
| 5-10  | 3-4    | 2-3 each        |
| 11+   | 5      | 3-4 each        |

## Important

- This skill only converts — it does not research or generate content
- Individual markdown files are preserved alongside the PDF for future editing
- The intermediate HTML is also preserved — open it in a browser to inspect or Print-to-PDF manually
- Always verify the PDF exists before reporting success
