# consulting-report Template Refactor — Generic & Modular

## Context

The `consulting-report` skill template currently leaks Transcend-specific concepts that should be project data, not template scaffolding. Two distinct problems:

1. **Font**: Source Serif 4 is wired as the body font — Rico finds it unreadable. Replace with Inter throughout.

2. **Template carries Transcend/playbook-specific concepts**:
   - **"Soma" is hardcoded** as class names (`config-soma-tune`, `soma-tune-marker`) and label text (`<span>SOMA TUNE</span>`) inside generic components and CSS. The components live in the skill template — this means any future report inherits Soma's name regardless of who owns it.
   - **Counts and shapes are hardcoded**: `RubricTable` assumes 5 levels (CSS uses `.rubric-header-1..5`), bands are pinned to "Strong/Promising/Park/Decline," `TuningLog`/`ConfigurationTable` columns are baked into JSX.
   - **Default `ReportData` opinionates** about which 9 sections exist (executiveSummary, situationAssessment, findings, ...). Section list is hardcoded in `app/page.tsx`. New reports must edit every section.

**Goal**: template provides generic primitives and types only; project folders provide the data that shapes the final report.

**Rollout**: Rico prefers the fully-generic / section-registry approach (option 3) but accepts iterative delivery. This plan delivers **Phase 1 now** (de-Soma, configurable counts, types/data split, font fix). Phases 2 and 3 are scoped but deferred.

---

## Current State Audit

**Source template:** `/Users/rico/Development/git/portable-agent-layer/assets/skills/consulting-report/template/`
**Installed via symlink to:** `~/.pal/skills/consulting-report/template/`
**Live project example:** `/Users/rico/Library/CloudStorage/.../transcend/A6/report/`

| File | Issue |
|------|-------|
| `app/layout.tsx` | Imports Source Serif 4 from `next/font/google`; wires `--font-source-serif`; sets body class to `font-body` (resolves to serif). |
| `app/globals.css` | `--font-body: var(--font-source-serif), Georgia, serif;` makes serif the body default. CSS classes `.config-soma-tune` and `.soma-tune-marker` baked in. |
| `components/configuration-table.tsx` | Literal `<span className="config-soma-tune">SOMA TUNE</span>` in JSX. |
| `components/rubric-table.tsx` | CSS classes `.rubric-header-1..5` assume exactly 5 levels. |
| `components/scorecard.tsx` | Renders `BandBadge` with hardcoded `Band = "Strong" \| "Promising" \| "Park" \| "Decline"` type. |
| `components/band-badge.tsx` | `Band` union type pins band names. Color classes `.band-strong/promising/park/decline` in CSS. |
| `components/tuning-log.tsx` | Six columns hardcoded in JSX header + rows (Date, Parameter, Old, New, Rationale, Approver). |
| `lib/report-data.ts` | Types live with the `reportData` data const. `ReportData` interface pins 9 specific sections; default data has opinionated strings like `"Strategic Assessment & Transformation Roadmap"`. Playbook types (Dimension, Scorecard, etc.) named generically but mixed in. |
| `app/page.tsx` | Hardcodes 9 sections in a fixed order, renders them with fixed components. Forces every new report to edit. |

---

## Phase 1 — Deliver now

### 1.1 Font fix

| File | Change |
|------|--------|
| `template/app/layout.tsx` | Drop `Source_Serif_4` import + variable. Remove `${sourceSerif.variable}` from `<html>` className. Keep Inter. |
| `template/app/globals.css` | `--font-body: var(--font-inter), system-ui, sans-serif` (matches `--font-sans`). Remove `--font-source-serif` references. Keep `Georgia, serif` only as a fallback inside `.quote-block::before` if the curly-quote glyph design still wants it; otherwise drop. |
| `transcend/A6/report/app/layout.tsx` | Same change in the live project. |
| `transcend/A6/report/app/globals.css` | Same change. |

### 1.2 De-Soma the template

Rename the leaked specifics into generic terms. Projects can re-label via data, not by editing the template.

**Type renames** (`template/lib/types.ts`, see §1.4):
- `somaTune?: boolean` → `tunable?: boolean`
- `somaTuneNote?: string` → `tuningNote?: string`

**CSS renames** (`template/app/globals.css`):
- `.config-soma-tune` → `.config-tunable`
- `.soma-tune-marker` → `.tunable-marker`

**Default label** (`components/configuration-table.tsx`):
- Replace literal `SOMA TUNE` with `{p.tunableLabel ?? "TUNABLE"}`. The data carries the label per parameter (e.g., A6 sets `tunableLabel: "Soma tune"` on its parameters).

**Project-side update** (A6):
- `transcend/A6/report/lib/report-data.ts`: rename `somaTune` → `tunable`; add `tunableLabel: "Soma tune"` where shown. The "Soma" string lives only in the project data file, not the template.
- `transcend/A6/report/app/page.tsx`: replace `<span className="soma-tune-marker">Soma tune</span>` with `<span className="tunable-marker">Soma tune</span>` (the marker class stays generic; the "Soma" text is project copy).

### 1.3 Make component counts configurable

**`RubricTable`** — currently assumes 5 levels.
- Accept any `levels.length` from the data.
- Per-level header coloring: compute via `getLevelColor(score, maxScore)` helper that returns a color from a default 2-color gradient (red → green) or from an optional `colorPalette` prop.
- Drop `.rubric-header-1..5` CSS in favor of inline `style` from the helper.

**`TuningLog`** — currently 6 fixed columns.
- New prop `columns: { key: keyof TuningLogEntry; header: string }[]` with a sensible default matching today's columns.
- Header row + body rows render from `columns`.
- `entries` becomes generic enough to carry extra fields; consider `Record<string, string>` entries with column keys.

**`ConfigurationTable`** — currently 4 fixed columns (Parameter, Value, Location, Rationale).
- Same pattern as TuningLog: `columns` prop with default matching today.
- Each row is keyed by `columns[i].key`.

**Bands (Scorecard / BandBadge)** — band names pinned in the type union.
- Replace `Band` union with `string`.
- New optional prop `bandStyles?: Record<string, { color: string; bg: string; border: string }>` on `BandBadge`.
- Default style map covers `Strong/Promising/Park/Decline` for back-compat with existing reports.
- Projects can declare their own bands (e.g., `"Greenlit" | "Investigate" | "Decline"`) via data + a custom style map.

**`Scorecard`** — gates list and scores list are already data-driven; no count change needed. The `total / 20` literal in JSX gets generalized to `total / maxTotal` (computed from dimensions.length × max level score, or passed as prop).

### 1.4 Types-vs-data split

**New file** `template/lib/types.ts` — every interface that was in `report-data.ts` (Finding, Recommendation, TimelinePhase, ReportData, RubricLevel, Dimension, ScorecardGate, ScorecardScore, Scorecard, ConfigurationParameter, TuningLogEntry).

**Template's `template/lib/report-data.ts`** becomes a minimal stub:
```ts
import type { ReportData } from "./types";
export const reportData: ReportData = { /* placeholder, replace in project */ };
```

The stub keeps the file path scaffolders rely on, but it's clearly an example, not a content store.

**Component imports** updated from `@/lib/report-data` → `@/lib/types`.

**Project's `lib/report-data.ts`** — only data. A6/report's data file already follows this pattern (it imports types from `@/lib/report-data` today; the import path updates to `@/lib/types` after the split).

### 1.5 Update SKILL.md

Add a short "Authoring a report" section to `~/.pal/skills/consulting-report/SKILL.md`:
- Template = primitives + types only. Don't edit the template for one report.
- Each report owns `lib/report-data.ts` (data) and `app/page.tsx` (layout). Edit those, not the components.
- New tunable parameters: `tunable`, `tunableLabel`, `bandStyles`, column configs.

---

## Phase 1.5 — Migrate styles from globals.css to Tailwind utilities

### Why this lands between Phase 1 and Phase 2

Phase 1 cleans up the names and shapes. Phase 1.5 cleans up the styling layer. Doing the migration *after* de-Soma means we don't move classes we're about to delete; doing it *before* Phase 2 means the data-driven renderer is built against a cleaner styling system from day one.

### Can we even do this while keeping PDF rendering?

Yes — fully. PDF rendering was not the reason globals.css grew big. The template is already on Tailwind v4 (`@import "tailwindcss"`, `@theme` tokens). The current CSS-class-heavy approach was a consistency choice with the original components, not a constraint. Tailwind utilities render through `next build` → static export → Playwright PDF without issue. The migration is style organization, not capability.

### What must stay in CSS

- `@page` block (page size + margins) — Playwright/print engine reads it from CSS, no Tailwind equivalent.
- `@media print` rules (break-inside, page-break-after on cover, link color resets).
- `@theme` design tokens (colors, fonts) — Tailwind v4's source of truth.
- Pseudo-elements that aren't trivially expressible as utilities — notably `.quote-block::before` for the curly-quote glyph. Either keep the class or use Tailwind's `before:` variants with `content-['…']`.

### What moves to utilities

- All component layout, spacing, color, typography, borders, shadows.
- The page-level container (`.report-container`), section headings, table styling.
- Existing classes that were essentially aliases (`.callout-label`, `.exhibit-header`) inline into the components.

### Conditional / variant styling

Two cases need a strategy:

1. **Score badges (1–5)** — different colors per score.
2. **Band badges (Strong / Promising / Park / Decline / project-defined)** — different colors per band.

Two options:

| Option | How |
|--------|-----|
| **`class-variance-authority` (cva)** | Add as a dep. Define variant maps inline in component files. Most ergonomic. |
| **Hand-rolled helper** | A tiny `cn(...)` + lookup table inside the component. Zero deps. Slightly more verbose. |

**Recommendation: hand-rolled.** The PAL repo already has a `cn` utility (`template/lib/utils.ts`). Adding `cva` introduces a transitive dep for two components' worth of variants — not worth it. The helper looks like:

```ts
const scoreClasses: Record<number, string> = {
  1: "bg-red-100 text-red-700 border-red-300",
  2: "bg-orange-100 text-orange-700 border-orange-300",
  3: "bg-amber-100 text-amber-700 border-amber-300",
  4: "bg-lime-100 text-lime-700 border-lime-300",
  5: "bg-emerald-100 text-emerald-700 border-emerald-300",
};
```

Bands use the same pattern with a `bandStyles` map (already proposed in Phase 1.3) — that map naturally becomes a `Record<string, string>` of Tailwind classes.

### Migration plan (component by component)

For each component: read current class → write utility-equivalent → drop the class from globals.css → re-render and visually diff against the v0.1 PDF.

| Component | Effort | Notes |
|-----------|--------|-------|
| `Callout`, `Section`, `Exhibit`, `QuoteBlock` | Small | Mostly layout + colors; QuoteBlock keeps the `::before` selector. |
| `SeverityBadge` | Small | Variant map of 4 severities. |
| `StatGrid`, `ComparisonTable` | Medium | Tables — verbose but mechanical. |
| `CoverPage`, `TableOfContents` | Medium | Cover keeps `page-break-after: always` via Tailwind `break-after-page`. |
| `Timeline` | Medium | Vertical line + dots — `relative` + `before:` pseudo. |
| `FindingCard`, `RecommendationCard` | Small | Card layout. |
| **New (mine)** `ScoreBadge`, `BandBadge` | Small | Variant helpers as above. |
| `RubricTable` | Medium | Generic N-column table; coloring via inline `style` or variant helper. |
| `Scorecard` | Large | Most complex layout — nested tables, grid metadata, callout-style rows. Save for last. |
| `TemplateBlock` | Small | Wrapper + `<pre><code>` styling. |
| `ConfigurationTable`, `TuningLog` | Small-Medium | Mostly table styling. |

### Where the CSS file lands after migration

`globals.css` shrinks to:
- `@import "tailwindcss";`
- `@theme { ... }` (tokens)
- A small `body` rule (or move to layout.tsx Tailwind classes)
- `.quote-block::before` (one pseudo-element rule)
- `@media print { ... }` (5–10 lines for break behavior)
- `@page { ... }` (3 lines)
- `@source` directives

Target: under 80 lines, down from ~850.

### Verification — Phase 1.5

1. **Visual diff.** Re-render A6 PDF after each component migration; compare against the Phase 1 baseline PDF. Pages should be visually identical (within sub-pixel rendering differences).
2. **Class-grep.** After migration, `grep -E "\.(callout|exhibit|section|scorecard|rubric|tuning|config|score|band|template)-" template/app/globals.css` should return only the entries we deliberately kept (quote-block::before, @page, @media print rules).
3. **Bundle size.** Sanity check Tailwind's tree-shake — the static export's CSS file should not grow significantly. (If it does, the unused classes weren't fully removed from globals.css.)

---

## Phases 2 and 3 — Scoped, deferred

### Phase 2 — Data-driven section rendering

Goal: a new report doesn't need to write `app/page.tsx`. Data declares a `sections: Section[]` array; template renders each.

```ts
type Section =
  | { type: "cover"; ... }
  | { type: "toc"; items: TocItem[] }
  | { type: "prose"; id: string; title: string; markdown: string }
  | { type: "configuration"; id, title, parameters, columns? }
  | { type: "rubric"; id, title, dimensions: Dimension[] }
  | { type: "scorecards"; id, title, scorecards: Scorecard[] }
  | { type: "tuning-log"; id, title, entries, columns?, emptyRows? }
  | { type: "table"; id, title, columns, rows };
```

Renderer: `<SectionRenderer sections={data.sections} />` maps each to its component. Built-in renderer ships with the template; projects can swap or extend it.

**Trade-offs:**
- (+) Most reports become "just fill in data."
- (−) Loses ad-hoc JSX freedom (no inline icons, custom layouts) — projects can drop down to a custom layout when they need.
- Need MDX or pre-rendered markdown for prose sections.

Defer until Phase 1 lands and we've seen 1–2 more reports to validate the section catalogue.

### Phase 3 — Section type registry

Goal: third-party reports can register new section types beyond the built-in catalogue.

```ts
const renderer = createSectionRenderer();
renderer.register("custom-foo", FooSection);
```

This is the full "modular" vision. Build only after Phase 2 settles.

---

## Out of Scope

- MDX support for prose sections (Phase 2 concern).
- A scaffolding wizard that picks a "report flavor" template.
- Theme tokens beyond the existing `@theme` block.
- Light/dark mode.
- The existing `severity-badge` / `finding-card` / `recommendation-card` — these are already opinionated about a "findings + recommendations" report shape but Rico isn't asking to touch them. Leave them.

---

## Critical Files

| File | Phase 1 action |
|------|----------------|
| `template/app/layout.tsx` | Drop Source Serif 4 |
| `template/app/globals.css` | Body font → Inter; rename `.config-soma-tune` → `.config-tunable`, `.soma-tune-marker` → `.tunable-marker`; drop `.rubric-header-1..5` (replace with computed inline styles) |
| `template/lib/types.ts` | **NEW** — all interfaces |
| `template/lib/report-data.ts` | Trim to minimal stub |
| `template/components/configuration-table.tsx` | Add `columns` prop with default; use `tunableLabel` |
| `template/components/tuning-log.tsx` | Add `columns` prop with default |
| `template/components/rubric-table.tsx` | Support N levels; remove `.rubric-header-{score}` class |
| `template/components/band-badge.tsx` | `band: string` (not union); `bandStyles?` prop; default styles |
| `template/components/scorecard.tsx` | `maxTotal` prop (default 20); update import path |
| `~/.pal/skills/consulting-report/SKILL.md` | Doc the new authoring contract |
| `transcend/A6/report/lib/report-data.ts` | Rename `somaTune` → `tunable`; add `tunableLabel: "Soma tune"`; import types from `@/lib/types` |
| `transcend/A6/report/app/page.tsx` | Update marker class name; nothing else |
| `transcend/A6/report/app/layout.tsx` | Drop Source Serif 4 (mirror the template change) |
| `transcend/A6/report/app/globals.css` | Mirror the body-font + CSS rename changes |

After all template edits → run `bun ~/.pal/cli install:all` (or equivalent) to propagate via symlink (it's already a symlink, no install actually needed — but verify).

---

## Verification

1. **TypeScript check.** Run `bun tsc --noEmit` (or `tsc` via the package script) in `transcend/A6/report/` — must pass after type renames.
2. **Re-render A6 PDF.** `node --experimental-strip-types $(realpath ~/.pal/skills/consulting-report/tools/generate-pdf.ts) "transcend/A6/report"`. Verify:
   - 33 pages (no truncation)
   - Body text now renders in Inter, not Source Serif (visual confirm — read p.3 / p.8)
   - "Soma tune" labels still appear at the same locations (because the **project data** provides the label, even though the template no longer hardcodes "Soma")
   - Brand colors (Dodger Blue) unchanged
3. **Default scaffold smoke test.** `bun ~/.pal/skills/consulting-report/tools/scaffold.ts /tmp/test-default --client "Acme" --title "Test Report"` followed by a PDF render. The default placeholder report should still build and render without errors after the type split.
4. **De-Soma grep.** `grep -ri "soma" template/` in the source repo should return zero matches (case-insensitive) after the refactor. **This is the "demonstrate, don't assert" check.**

---

## What Happens Next

Phase 1 is the immediate iteration. Phases 2 and 3 stay in this plan as a roadmap; Rico decides when to pick them up after seeing Phase 1 land and after the next report exercise reveals which section-types actually recur.
