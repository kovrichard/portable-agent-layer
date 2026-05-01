---
name: consulting-report
description: Build a beautifully-typeset consulting-report PDF from a typed data file and a React layout. Use when generating an assessment, strategic review, operational readiness check, or any McKinsey-style consulting deliverable as a PDF.
argument-hint: scaffold <target-dir> | dev <report-dir> | <report-dir> (render PDF)
---

## Overview

Every report is a self-contained Next.js app: typed report data in `lib/report-data.ts`, layout composed from React components in `app/page.tsx`, fonts via `next/font/google` (Source Serif 4 + Inter), Tailwind v4 for styling. `bun run dev` gives a live preview while authoring; the PDF is rendered by Playwright against a static export.

## Workflow

### 1. Scaffold a new report

```bash
bun ~/.pal/skills/consulting-report/tools/scaffold.ts <target-dir> \
  [--client "Client Name"] [--title "Report Title"] [--no-install]
```

Creates `<target-dir>` from the template and runs `bun install` inside. If `--client` / `--title` are passed, they're stamped into `lib/report-data.ts`. The scaffolder refuses to overwrite an existing directory.

### 2. Fill in the content

Two files do the work:

- **`lib/report-data.ts`** — typed metadata: client, title, date, classification, consultancy name, executive summary, situation assessment, findings, risk analysis, strategic opportunity, recommendations, target state, roadmap, call to action. The `ReportData` interface guides what's required.
- **`app/page.tsx`** — the layout. Composes `<CoverPage/>`, `<Section/>`, `<Exhibit/>`, `<FindingCard/>`, `<RecommendationCard/>`, `<Callout/>`, `<Timeline/>`, etc. against the data. Edit freely — section titles, intros, ordering, custom JSX, anything.

Static images go in `public/`; reference them from JSX as `<img src="/your-image.png">`.

### 3. Live preview while authoring

```bash
bun ~/.pal/skills/consulting-report/tools/dev.ts <report-dir>
```

Wraps `bun run dev` in the report directory. Open the URL printed by Next, edit `app/page.tsx` or `lib/report-data.ts`, browser hot-reloads.

### 4. Render the PDF

```bash
node --experimental-strip-types ~/.pal/skills/consulting-report/tools/generate-pdf.ts <report-dir>
```

Runs `next build` (which produces a static export at `out/`), then Playwright loads it via a tiny in-process HTTP server and prints the PDF with page-numbered header/footer. Output:

```
<report-dir>/<client-slug>-<title-slug>-<date>.pdf
```

Override with `--pdf <path>`. Pass `--skip-build` to re-render the PDF from the existing `out/` without re-building.

Run with **Node**, not Bun — Playwright's `chromium.launch()` hangs under Bun on Windows.

## Directory Layout

```
<report-dir>/
├── app/
│   ├── layout.tsx        # font wiring (Inter + Source Serif 4)
│   ├── page.tsx          # the report's layout — edit freely
│   └── globals.css       # design tokens via @theme + custom CSS
├── components/           # report primitives — edit if you need new shapes
│   ├── cover-page.tsx
│   ├── table-of-contents.tsx
│   ├── section.tsx
│   ├── exhibit.tsx
│   ├── stat-grid.tsx
│   ├── comparison-table.tsx
│   ├── finding-card.tsx
│   ├── recommendation-card.tsx
│   ├── severity-badge.tsx
│   ├── callout.tsx
│   ├── quote-block.tsx
│   └── timeline.tsx
├── lib/
│   ├── report-data.ts    # all your content
│   └── utils.ts
├── public/               # static images, optional
├── package.json          # exact-pinned: next, react, tailwindcss, etc.
├── tsconfig.json
├── next.config.js
└── postcss.config.mjs
```

## Component Cheatsheet

- `<CoverPage clientName reportTitle reportDate classification consultancyName preTitle />` — full-bleed cover
- `<TableOfContents items={[{id, title}, …]} title?>` — linked TOC, anchors to section IDs
- `<Section id title>` — top-level section with bottom-rule heading; `id` enables TOC links
- `<Exhibit number title source?>` — bordered card for figures, tables, side data
- `<StatGrid stats={[{value, label, caption?}, …]} />` — large-number grid for executive summary
- `<ComparisonTable leftLabel rightLabel rows={[{metric, left, right}, …]} metricLabel?>` — current vs. target side-by-side
- `<FindingCard finding={f} index={i} />` — driven by `Finding` type, includes severity badge
- `<RecommendationCard recommendation={r} index={i} />` — driven by `Recommendation` type, includes priority badge
- `<Callout label?>` — left-rule emphasis block (default label "Key Takeaway")
- `<QuoteBlock quote attribution role? />` — pull-quote with serif quote mark
- `<Timeline phases={r.roadmap} />` — vertical timeline with dotted line
- `<SeverityBadge severity />` — pill badge: critical / high / medium / low

## Demo

```bash
node --experimental-strip-types ~/.pal/skills/consulting-report/tools/generate-pdf.ts ~/.pal/skills/consulting-report/demo
```

Renders the bundled Acme Industries example end-to-end. Inspect the resulting PDF to see the full layout before authoring your own.

## Important

- Run on Node ≥ 22.6 (Playwright + `--experimental-strip-types`)
- Bundled fonts come from Google Fonts via `next/font/google` — no licensing surface, no CDN at runtime, glyphs embedded at build time
- Reports are disposable artifacts of `lib/report-data.ts` + `app/page.tsx`; commit the source, not the PDF
- The scaffolder runs `bun install` inside the target by default — pass `--no-install` to skip
- Header/footer templates render with `displayHeaderFooter: true` in Playwright; don't combine with CSS `@page` margin-box rules
