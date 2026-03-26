---
name: create-pdf
description: Convert markdown files into a styled PDF report using md-to-pdf. Use when creating a PDF from existing markdown files, combining markdown into a report, or converting .md to .pdf.
argument-hint: <file paths, glob pattern, or directory containing .md files>
---

## Overview

Combine one or more markdown files into a single styled PDF using `bunx --bun md-to-pdf`. This skill handles concatenation, page breaks, styling, and conversion. It does NOT generate content — use the `research` skill or other content-generation workflows first, then pipe the resulting markdown files into this skill.

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

### Step 2: Combine with Page Breaks

Concatenate all files with page break dividers between them:

```bash
cat \
  first_file.md \
  <(echo -e '\n\n<div style="page-break-before: always"></div>\n\n---\n\n') \
  second_file.md \
  <(echo -e '\n\n<div style="page-break-before: always"></div>\n\n---\n\n') \
  third_file.md \
  ... \
  > /tmp/combined_raw.md
```

For many files, generate the cat command dynamically rather than typing each one.

### Step 3: Add PDF Frontmatter

Prepend YAML frontmatter with styling, then append the combined content:

```bash
cat > <output_name>.md << 'FRONTMATTER'
---
pdf_options:
  format: A4
  margin: 25mm
  printBackground: true
stylesheet: https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown.css
body_class: markdown-body
css: |-
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.6; color: #1a1a1a; }
  h1 { font-size: 22px; border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { font-size: 17px; }
  h3 { font-size: 14px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 10px; }
  th { background: #f0f0f0; }
  blockquote { border-left: 3px solid #666; padding-left: 12px; color: #444; }
  hr { border: none; border-top: 1px solid #ccc; margin: 20px 0; }
  a { color: #0366d6; text-decoration: none; }
---

FRONTMATTER
cat /tmp/combined_raw.md >> <output_name>.md
```

The user may request custom styling (font size, margins, colors). Override the defaults above accordingly.

### Step 4: Generate PDF

```bash
bunx --bun md-to-pdf <output_name>.md
```

### Step 5: Verify and Report

```bash
ls -lh <output_name>.pdf
```

Report the file path and size to the user.

## Translation Variant

If the user asks to translate markdown files and then create a PDF:

1. Spawn **parallel subagents** to translate files — batch 2-4 files per agent, all agents in a **single message**
2. Each agent reads the source file, translates all text content to the target language, and writes to `<original_name>_<lang>.md`
3. Rules for translation agents:
   - Keep all markdown formatting, links, and structure identical
   - Keep source/link titles in their original language; translate surrounding text
   - Translate naturally, not word-for-word; use proper domain terminology
4. After all agents complete, run Steps 2-5 above on the translated files
5. Output filename gets a `_<lang>` suffix (e.g., `report_hu.pdf`)

**Batch sizing for translation agents:**

| Files | Agents | Files per agent |
|-------|--------|-----------------|
| 1-4   | 1-2    | 2 each          |
| 5-10  | 3-4    | 2-3 each        |
| 11+   | 5      | 3-4 each        |

## Important

- Use `bunx --bun md-to-pdf` (NOT npx) for PDF conversion
- This skill only converts — it does not research or generate content
- Individual markdown files are preserved alongside the PDF for future editing
- If `md-to-pdf` is not installed, `bunx` will auto-install it on first run
- Always verify the PDF exists before reporting success
