---
name: consulting-report
license: MIT
description: "Build a beautifully-typeset consulting-report PDF from a typed data file and a React layout. Use when generating an assessment, strategic review, operational readiness check, or any McKinsey-style consulting deliverable as a PDF."
argument-hint: scaffold <target-dir> | dev <report-dir> | <report-dir> (render PDF)
metadata:
  source: portable-agent-layer
  triggers:
    - "consulting-report"
    - "consulting report"
    - "to pdf"
    - "design a pdf"
    - "beautiful pdf"
---

## Overview

Every report is a self-contained Next.js app: typed report data in `lib/report-data.ts`, layout composed from React components in `app/page.tsx`, font via `next/font/google` (Inter), Tailwind v4 for styling. `bun run dev` gives a live preview while authoring; the PDF is rendered by Playwright against a static export.

## Authoring contract — what belongs where

The split is deliberate. Don't edit the template for one report; don't put report data in the template.

| File | Lives in | Edited by |
|------|----------|-----------|
| `lib/types.ts` | Template | Skill maintainer only (when adding new section types) |
| `lib/report-data.ts` | Project | **You.** Replace the scaffolded placeholder with your data. |
| `app/page.tsx` | Project | **You.** Compose your layout from the components in `@/components`. |
| `components/*.tsx` | Template | Skill maintainer only (when adding new primitives) |
| `app/globals.css` | Project (copied from template) | Brand colors and project-specific overrides only. |

**Tunable parameters** (e.g., the "TUNABLE" marker on configuration rows) take their label from the data:

```ts
// In your project's report-data.ts:
{ name: "Decision band thresholds", currentValue: "16–20 strong …",
  tunable: true, tunableLabel: "Owner edit" }
```

The component renders whatever `tunableLabel` you provide; the template never hardcodes a person's name.

**Custom band labels** (Scorecard / BandBadge): the `band` field is a free-form string. Pass `bandStyles` to `<Scorecard>` to map your band labels to colors:

```tsx
<Scorecard
  scorecard={...}
  bandStyles={{
    Greenlit: { color: "...", background: "...", borderColor: "..." },
    Investigate: { ... },
    Hold: { ... },
  }}
/>
```

**Configurable columns** (ConfigurationTable, TuningLog): pass a `columns` prop to override the default schema. See each component's source for the column type.

**Rubric levels** (RubricTable): supports any number of levels — the colors sample the default palette evenly. Pass `palette` to override.

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
node ~/.pal/skills/consulting-report/tools/generate-pdf.mjs <report-dir>
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
node ~/.pal/skills/consulting-report/tools/generate-pdf.mjs ~/.pal/skills/consulting-report/demo
```

Renders the bundled Acme Industries example end-to-end. Inspect the resulting PDF to see the full layout before authoring your own.

## Important

- Run on Node (Playwright); the tool ships as a compiled `.mjs` so no `--experimental-strip-types` is needed
- Bundled fonts come from Google Fonts via `next/font/google` — no licensing surface, no CDN at runtime, glyphs embedded at build time
- Reports are disposable artifacts of `lib/report-data.ts` + `app/page.tsx`; commit the source, not the PDF
- The scaffolder runs `bun install` inside the target by default — pass `--no-install` to skip
- Header/footer templates render with `displayHeaderFooter: true` in Playwright; don't combine with CSS `@page` margin-box rules
