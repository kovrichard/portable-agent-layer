---
name: presentation
description: Build branded HTML presentations from markdown using Reveal.js. Multi-template registry per user (each template = brand color, logo, fonts, footer, aspect). Per-deck workflow: scaffold → edit one markdown file per slide in slides/ → build → present. Output: single self-contained HTML. Use when creating slide decks, talks, workshop slides, lectures, or pitch decks.
argument-hint: <deck-dir> to build, OR `setup-template` to add a brand template, OR `new <deck-dir> --template <name>` to scaffold a deck, OR `list-templates`, OR `present <deck-dir>`
---

## Overview

Renders a deck folder (markdown + config) to a single self-contained HTML presentation using Reveal.js, themed by one of the user's registered brand templates. Decks stay in plain markdown for git-friendliness; templates own brand identity (color, logo, fonts, footer); the skill itself is brand-neutral.

**Three-layer separation:**

1. **Skill** (this folder) — brand-neutral engine: Reveal.js vendored offline, base CSS, 11 layout components, build pipeline.
2. **Templates** — user-owned brand assets at `~/.pal-data/presentation-templates/<name>/` (override-able). Registered in `~/.pal-data/presentation-templates/registry.json`. Multi-template — one user can have several brands.
3. **Decks** — one folder per presentation, anywhere in user's filesystem. Contains `slides.config.yml`, a `slides/` folder of one-markdown-file-per-slide, `assets/`.

## Workflow

### Step 0 (one-time per brand): Set up a template

Interactive:
```bash
bun ~/.pal/skills/presentation/tools/setup-template.ts
```

Walks through 9 fields: name, storage path, logo file, primary color, accent color, footer text, logo placement, fonts, aspect ratio. Optional: generate a showcase deck demonstrating every layout.

Non-interactive (Claude can drive it):
```bash
bun ~/.pal/skills/presentation/tools/setup-template.ts \
  --name <slug> \
  --logo <abs-path-to-logo.svg> \
  --primary "#0E1335" \
  [--accent "#FFB84D"] \
  [--footer "Konvert7 · 2026"] \
  [--logo-placement "footer"] \
  [--fonts "system"] \
  [--aspect "16:9"] \
  [--showcase] \
  [--yes]
```

Defaults if omitted: accent = derived complementary of primary; logo-placement = footer; fonts = system; aspect = 16:9.

### Step 1: Scaffold a deck

```bash
bun ~/.pal/skills/presentation/tools/new-deck.ts <deck-dir> --template <name> [--title "Deck title"]
```

If `--template` is omitted and only one template is registered, that one is used. If multiple are registered, the command lists them and exits. Adds `--showcase` to scaffold a demo deck with every layout exercised.

### Step 2: Author content

Each slide is its own markdown file under `<deck-dir>/slides/`. Files are concatenated at build time in filename order (`001.md`, `002.md`, `003-foo.md`, …) — use leading zeros so sort order is stable. **Do not put `---` separators inside slide files** — the separator is added between files at build time.

Authoring this way means: a malformed edit only takes down its own slide, slides can be reordered by renaming, and parallel writes don't conflict.

Per-slide conventions (inside each file):
- Speaker notes: lines starting with `Note:`.
- Layout directive: `<!-- .slide: data-layout="..." -->` at the top.
- See "Layouts" below for the available layout names.

Backwards compatible: if `slides/` doesn't exist, the build falls back to a single `<deck-dir>/content.md` with `---` separators between slides.

### Step 3: Build

```bash
bun ~/.pal/skills/presentation/tools/build.ts <deck-dir>
```

Produces `<deck-dir>/dist/index.html` — a single self-contained HTML file (CSS, JS, fonts, logo all inlined). Email it, USB-stick it, host it anywhere.

### Step 4: Present

```bash
bun ~/.pal/skills/presentation/tools/present.ts <deck-dir>
```

Builds (if missing or stale) and opens in the default browser. `F` = fullscreen, `S` = speaker notes window, `?` = keyboard shortcuts.

## Deck folder layout

```
<deck-dir>/
├── slides.config.yml       # template name, deck title, language, aspect override
├── slides/                 # one markdown file per slide; concatenated at build time
│   ├── 001.md
│   ├── 002.md
│   └── …
├── overrides.css           # optional — per-deck CSS overrides
├── assets/                 # images / videos referenced from slides/*.md
└── dist/                   # build output (gitignored automatically)
    └── index.html
```

(Legacy: a single `content.md` at the deck root still works — see Step 2.)

## Content conventions

```markdown
<!-- .slide: data-layout="title" -->
# Deck title
## Subtitle line

Note: Speaker note for the title slide.

---

<!-- .slide: data-layout="content" -->
## Today's three points
- First
- Second
- Third

---

<!-- .slide: data-layout="two-column" -->
## Title

<div class="col-left">

Left content here, can include **markdown**.

</div>

<div class="col-right">

Right content.

</div>

---

<!-- .slide: data-layout="closing" -->
# Thank you
## Questions?
```

## Layouts (v1)

| Layout | When | Notes |
|---|---|---|
| `title` | Cover slide | Big title, optional subtitle, brand logo prominent |
| `section` | Section divider | Full-bleed accent background, large white title |
| `content` | Default | Title + bullets / paragraphs |
| `two-column` | Side-by-side content | Use `<div class="col-left">` / `<div class="col-right">` |
| `image-text` | Image + text combo | Use `<div class="image">` / `<div class="text">` |
| `quote` | Big italic blockquote | Use markdown `>` syntax |
| `closing` | Thank-you / Q&A | Mirrors title styling on accent BG |
| `agenda` | Numbered list | Numbered ol, large type, generous whitespace |
| `table` | Tabular data | Markdown tables, styled with zebra rows + accent header |
| `comparison` | 2–3 option boxes side-by-side | Use `<div class="compare">` with `<div class="option">` children |
| `code` | Code-focused | Triple-backtick fenced blocks with language tag |

## Other commands

```bash
bun ~/.pal/skills/presentation/tools/list-templates.ts
```

Prints all registered templates with their primary color and storage path.

## When to use this skill

- Building a workshop deck, internal presentation, conference talk, sales pitch, lecture
- A user mentioning a deck / slides / talk / lecture / "prezentáció" / equivalent in their language
- The user already has a template registered and wants to make a new deck

Do NOT use when:
- A static one-pager / handout PDF is needed → use `consulting-report` or `create-pdf`
- The user wants editable PowerPoint specifically (v1 doesn't export pptx; deferred to v2)
