---
name: create-pdf
description: Generate a structured PDF report from a topic or content using parallel research/writing agents and md-to-pdf. Use when creating a report, generating a PDF, writing a document, or producing a structured multi-section PDF.
argument-hint: <topic, outline, or content description>
---

## Overview

Create professional PDF reports by orchestrating parallel subagents for content generation, writing results as structured markdown files, then converting to PDF via `bunx md-to-pdf`.

## Workflow

### Phase 1: Plan the Report Structure

Based on the user's request, determine:

1. **Report topic and scope**
2. **Section breakdown** — identify 5-15 discrete sections/chapters
3. **Output directory** — ask the user or default to `~/Documents/<kebab-case-topic>/`
4. **Language** — detect from the user's request or ask
5. **File naming** — each section: `YYYYMMDD_snake_case_title.md` (use today's date if no specific date applies)

Present the outline to the user for approval before proceeding.

### Phase 2: Parallel Content Generation

Spawn **parallel subagents** to write sections simultaneously. Batch sections across agents — each agent handles 2-4 sections depending on total count.

**Agent spawning rules:**
- All agent spawns for a batch MUST be in a **single message** for true parallel execution
- Each agent gets a clear, self-contained prompt with: section title, scope, key points to cover, tone/style, and the output file path
- Agents write their sections directly as markdown files
- For research-heavy reports: use `investigative-researcher`, `multi-perspective-researcher`, and `claude-researcher` agent types to get different perspectives
- For content-heavy reports: use `general-purpose` agents with detailed writing instructions

**Prompt template for each agent:**
```
Read [any reference files if applicable].
Write a detailed markdown file at [output path] covering:
- Section title: [title]
- Scope: [what to cover]
- Key points: [specific items to include]
- Tone: [objective/persuasive/technical/casual]
- Structure: Use ## for main headings, ### for sub-sections
- Include sources with full URLs where applicable
```

**Batch sizing guide:**

| Total sections | Agents | Sections per agent |
|----------------|--------|--------------------|
| 3-6 | 2-3 | 2 each |
| 7-12 | 3-4 | 2-3 each |
| 13+ | 5 | 3-4 each |

### Phase 3: Overview File

After all agents complete, write a `00_overview.md` file containing:
- Report title and date
- Methodology description
- Table of contents linking to each section
- Executive summary synthesizing key findings from all sections

### Phase 4: Combine and Convert to PDF

**Step 1: Combine all markdown files into one.**

Concatenate files in order with page break dividers between sections:

```bash
cat \
  00_overview.md \
  <(echo -e '\n\n<div style="page-break-before: always"></div>\n\n---\n\n') \
  YYYYMMDD_section_one.md \
  <(echo -e '\n\n<div style="page-break-before: always"></div>\n\n---\n\n') \
  YYYYMMDD_section_two.md \
  ... \
  > /tmp/combined_raw.md
```

**Step 2: Add PDF frontmatter.**

Prepend YAML frontmatter with styling, then append the combined content:

```bash
cat > <report_name>.md << 'FRONTMATTER'
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
cat /tmp/combined_raw.md >> <report_name>.md
```

**Step 3: Generate the PDF.**

```bash
bunx --bun md-to-pdf <report_name>.md
```

**Step 4: Verify.**

```bash
ls -lh <report_name>.pdf
```

Report the file path and size to the user.

### Phase 5: Translation (Optional)

If the user requests translation to another language:

1. Spawn parallel agents (same batching as Phase 2) to translate each markdown file
2. Translated files get the same name with a `_<lang>` suffix (e.g., `_hu`, `_de`, `_es`)
3. Keep all markdown formatting, links, and structure identical — only translate text content
4. Keep source link titles in their original language; translate surrounding descriptive text
5. Combine and convert the translated files to PDF using the same Phase 4 process with a `_<lang>` suffix on the final filename

## Important

- All subagent spawns for a batch MUST be in a **single message** for true parallel execution
- Do NOT run agents sequentially — that defeats the purpose of parallel generation
- Each agent writes its own files directly — the orchestrating agent only combines and converts
- Always verify the final PDF exists and report its size
- Use `bunx --bun md-to-pdf` (NOT npx) for PDF conversion
- Individual markdown files are kept alongside the PDF so the user can edit and regenerate
