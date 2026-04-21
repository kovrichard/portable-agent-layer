---
name: consulting-report
description: Produce branded consulting-report PDFs from a structured report directory (cover page, linked TOC, headers/footers with page numbers, typography system, callout boxes, findings + recommendations). Use when generating an assessment report, strategic review, or consulting deliverable PDF.
argument-hint: <report-dir> OR `scaffold <target-dir>` to start a new report
---

## Overview

Renders a structured consulting-report directory to a branded PDF: cover page, linked table of contents, page-numbered headers/footers, typography system (Georgia body + Inter headings), colored callout boxes for findings and recommendations, tables with zebra striping.

Each report lives in its own directory with data (TypeScript) + narrative (Markdown) + diagrams (images). The skill provides a scaffolder to spin up new reports from a template and a generator to render them.

**Default brand:** Konvert7. Override per report via the `brand` block in `report-data.ts`.

## Report Directory Layout

```
<report-dir>/
├── content/
│   ├── report-data.ts          # report structure (schema: ConsultingReport)
│   ├── executive-summary.md    # narrative sections
│   └── …
├── diagrams/                   # source images (PNG/JPG)
├── diagrams-compressed/        # generated — ignore
└── <client>-<title>-<date>.{pdf,html}  # output
```

## Workflow

### Step 1: Scaffold a new report (skip if the report directory already exists)

```bash
bun ~/.pal/skills/consulting-report/tools/scaffold.ts <target-dir> \
  --client "Client Name" \
  --title "Report Title"
```

Creates the directory, stamps today's date + client + title into `report-data.ts`, and writes a starter `executive-summary.md`. If the target directory already exists, the command errors — move or remove first.

### Step 2: Fill in content

Edit:

- `<dir>/content/report-data.ts` — cover metadata, sections list, optional findings / recommendations / conclusion / appendix. Each `section.content` is either an inline markdown string OR a `.md` filename relative to `content/`.
- `<dir>/content/*.md` — the narrative sections referenced from `report-data.ts`.
- `<dir>/diagrams/` — drop PNG/JPG images. Reference them from markdown with relative paths, e.g. `![alt](../diagrams-compressed/architecture.jpg)`.

### Step 3: Render

```bash
bun ~/.pal/skills/consulting-report/tools/generate-pdf.ts <report-dir>
```

Output: `<dir>/<client-slug>-<title-slug>-<date>.pdf` and matching `.html`. Override with `--pdf <path>` / `--html <path>`.

The generator:
- Loads `content/report-data.ts` dynamically
- Compresses `diagrams/*` to JPEG 70% / 1200px via `sips` (macOS); silently skips if `sips` is absent
- Renders cover, auto-generated linked TOC, sections, findings, recommendations, conclusion, appendix
- Prints via Playwright with page-numbered header/footer templates

### Step 4: Verify

```bash
ls -lh <dir>/*.pdf
```

Open the PDF. Check: cover centered and branded; TOC links jump; findings render in red/amber boxes by severity; recommendations in blue boxes with priority badges; every page has the CONFIDENTIAL footer and page number.

## Report Schema

```ts
interface ConsultingReport {
  clientName: string;
  reportTitle: string;
  reportDate: string;
  classification: string;          // e.g., "CONFIDENTIAL"
  version: string;
  brand?: { businessName: string; brandLabel?: string; logoPath?: string; };
  sections: Section[];
  findings?: Finding[];            // renders as red/amber/blue boxes by severity
  recommendations?: Recommendation[];  // blue boxes with priority badges
  conclusion?: Conclusion;
  supportingEvidence?: Record<string, string[]>;  // appendix
}

interface Section { id: string; title: string; content: string; subsections?: Section[]; }
interface Finding { id: string; title: string; severity: "critical"|"high"|"medium"|"low"; evidence: string; impact?: string; }
interface Recommendation { id: string; title: string; priority: "immediate"|"short-term"|"long-term"; detail: string; owner?: string; }
interface Conclusion { assessorNote?: string; contextNote?: string; closingRemarks?: string; }
```

## Styling

The typography system (Georgia body 10.5pt / Inter headings), color palette (navy #1B2A4A, blue #2E5090, red #DC2626, amber #D97706, green #059669), callout boxes, badges, table styling, cover layout, and header/footer templates are baked into `tools/generate-pdf.ts`. To customize: edit the `css()` function and the `renderPdf()` header/footer strings in one place.

Do NOT combine CSS `@page` margin-box rules with the Playwright `displayHeaderFooter` templates — they duplicate.

## Demo

A runnable demo lives at `~/.pal/skills/consulting-report/demo/`:

```bash
bun ~/.pal/skills/consulting-report/tools/generate-pdf.ts ~/.pal/skills/consulting-report/demo
```

Inspect the produced PDF to see the full layout (cover, TOC, sections, findings, recommendations, conclusion, appendix) before writing your own report.

## Important

- Reports live wherever you want; the skill only needs the `<report-dir>` path
- The scaffolder refuses to overwrite an existing directory
- Images go in `diagrams/`; reference them from markdown via `diagrams-compressed/<name>.jpg` so the compressed output is used
- Heading anchor IDs come from `section.id` — keep them unique and slug-safe
- Every report re-renders deterministically from source; the PDF and HTML are disposable artifacts
