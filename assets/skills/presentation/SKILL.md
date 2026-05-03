---
name: presentation
description: Build branded HTML presentations from markdown using Reveal.js. Multi-template registry per user (each template = brand color, logo, fonts, footer, aspect). Per-deck workflow: scaffold → edit one markdown file per slide in slides/ → build → present. Output: a `<deck-name>/` subdir with a self-contained HTML and a concatenated markdown sibling. 14 layouts including data-display patterns (big-stat, metric-grid). Use when creating slide decks, talks, workshop slides, lectures, or pitch decks.
argument-hint: <deck-dir> to build, OR `setup-template` to add a brand template, OR `new <deck-dir> --template <name>` to scaffold a deck, OR `list-templates`
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
  [--footer "Your Brand · 2026"] \
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
bun ~/.pal/skills/presentation/tools/build.ts <deck-dir> [--out <dir>] [--force]
```

Output files (where `<deck-name>` = basename of `<deck-dir>`):

- `<deck-name>.md` — the concatenated source (all `slides/*.md` joined with `---` separators), written to disk **first** so you can inspect, diff, or feed it into other tooling.
- `<deck-name>.html` — the self-contained presentation (CSS, JS, fonts, logo all inlined). Email it, USB-stick it, host it anywhere.

Default location: `--out` defaults to the **deck-dir itself**, and the files land flat at `<deck-dir>/<deck-name>.{html,md}` — next to your slides, regardless of where you ran the build from. The scaffolder's `.gitignore` already covers them.

Override: pass `--out <dir>` to redirect elsewhere. When `--out` is *not* the deck-dir, a `<deck-name>/` subdir is created under it so multiple decks can coexist in one collection folder.

`--force` overwrites an existing build. Without it, the build refuses to clobber `<deck-name>.{md,html}`.

### Step 3.5 (optional but recommended): Lint with the doctor

```bash
bun ~/.pal/skills/presentation/tools/doctor.ts <deck-dir> [--strict]
```

Catches authoring failures before you ever open the browser:

- Slide missing `data-layout` directive (silently defaults to `content`).
- Title or subtitle exceeding the visual budget (h1 > 60 chars, h2 > 100).
- Layout-content mismatch — `comparison` without a `<div class="compare">`, `metric-grid` without `<div class="metrics">`, `two-column` missing column wrappers, etc.
- Overflow heuristics — `agenda` > 10 items, `content` > 7 bullets, `code` block > 25 lines, `table` > 10 rows, `metric-grid` ≠ 3 metrics.
- **Visual-line budget**: any bullet-bearing slide (`content`, `agenda`, `comparison`, `two-column`) with > 10 flattened list lines (top-level + sub-bullets combined). 10 fits cleanly; 11+ overflows even when each line is short.
- Image referenced via `![](assets/...)` but the file is missing.
- Layout requirements — `big-stat` without an h1, `quote` / `pull-quote` without a `> blockquote`.

Exit codes: `0` = clean, `1` = errors found (or warnings under `--strict`), `2` = usage error. Run before each build in your iteration loop, or wire it into a pre-commit hook.

### Step 4: Open

Open `<out>/<deck-name>/<deck-name>.html` in your browser. Iterate by editing a slide, re-running the build, and refreshing the tab. Reveal shortcuts: `F` = fullscreen, `S` = speaker notes window, `?` = keyboard shortcuts, `Esc` = overview.

## Deck folder layout

```
<deck-dir>/
├── slides.config.yml       # template name, deck title, language, aspect override
├── slides/                 # one markdown file per slide; concatenated at build time
│   ├── 001.md
│   ├── 002.md
│   └── …
├── overrides.css           # optional — per-deck CSS overrides
└── assets/                 # images / videos referenced from slides/*.md
```

Build output lands flat inside the deck-dir by default (`<deck-dir>/<deck-name>.{html,md}`), or under `<out>/<deck-name>/` when `--out` is explicit. Both shapes are covered by the scaffolder's `.gitignore`.

(Legacy: a single `content.md` at the deck root still works — see Step 2.)

## Content principles

The doctor enforces *structural* discipline (slide budgets, layout-content match, missing assets). These rules are about *content* — what goes on the slide and in the notes. They apply to every deck regardless of type. For type-specific rules, see the "see also" links at the bottom of this section.

### Core rules

- **A slide carries what the *learner* takes away — never what happens in the room.** "We will discuss CI/CD agents" is not a slide; "CodeRabbit and CodeAnt cost ~$15/dev/mo at this scale" is.
- **Less is more on bullets.** The doctor caps `content` at 7 bullets; the content rule is stricter — 3–5 is usually right. One bullet is not a slide; either expand or fold into the previous one.
- **Two ideas → two slides.** If a slide carries two takeaways, split.
- **No sentences on slides or in notes.** Exceptions: quotes, code comments, single callout sentences. Everything else is bullets, including notes.
- **A title-only slide is valid only as a `section` divider.** Single-word slides and single-bullet slides are not valid — split or expand.
- **Vocabulary consistency.** Pick one word per concept ("agent" vs "assistant", "tool" vs "capability") and use it everywhere. Drift confuses the audience.
- **Layout choice = content choice, not decoration.** `big-stat` says "this number *is* the point." `comparison` says "you have to choose between these." `quote` says "someone earned the right to say this." Wrong layout muddies the message.
- **Define jargon before using it.** First use of a non-obvious term gets a parenthesized gloss or its own glossary slide. After that, no.

### Bullet & sub-bullet structure

- **Top-level bullet = one fact or one claim.** 6–12 words. If you need more, split or use a sub-bullet.
- **Sub-bullets = elaboration of the parent.** A list, an example, a clarification. 2–8 words each. Don't start a new claim at a sub-bullet — that's a top-level bullet.
- **Never use em-dash continuations to extend a bullet.** `- Foo — bar — baz` is prose pretending to be a bullet. Convert to:
  ```markdown
  - Foo
    - bar
    - baz
  ```
  Em-dash is reserved for: title qualifiers ("Block 4 — Landscape"), and anticipated Q&A in notes (`"Question?" — short answer`).
- **Stable parallel structure inside a bullet group.** If bullet 1 starts with a verb, bullets 2–N start with verbs. If bullet 1 is `Name: description`, the rest match.
- **Concrete over abstract.** Show paths, file names, numbers, command snippets in backticks. "the project file" is weaker than `./CLAUDE.md`.

### Notes structure

Notes are the speaker's working surface during delivery. They must be scannable, not readable. Strict format:

1. **Source links first**, one per line, before any explanation. Multiple links are fine if the slide cites multiple sources. The speaker should never scroll to find a link they're about to open in the browser.
2. **Named beats as top-level bullets.** A "beat" is a named chunk of context — `Eval setup`, `Headline numbers`, `Why X wins`, `Common output`, `Anticipated questions`. The beat name lets the speaker jump.
3. **Sub-bullets under each beat.** Same 2–8 word budget. Lists, edge cases, examples. No prose.
4. **Quotes nest under a `- Quote` beat** as a markdown blockquote (`>`). Quotes are the only place full sentences are allowed in notes.
5. **Anticipated Q&A near the end.** Format: `- "Question?" — short answer`. The em-dash here separates the quote from the answer; this is the legal use.
6. **Forward references are terse.** "more in Day 2 when you build your own", "see Block 2 for X". Not "we'll discuss this later" prose.

### Voice

- **Declarative, not hedging.** "Anthropic's holdout" beats "Anthropic has chosen a different approach." If you mean it, say it; if you don't, cut it.
- **Opinionated where the room expects opinion.** Workshops are taught, not narrated. State which option you'd pick and why.
- **Concrete identifiers visible.** File paths, version numbers, URLs, exact tool names. The audience should be able to type what's on the slide and have it work.

### Examples

**Bad slide — describes the room, not the takeaway:**

```markdown
<!-- .slide: data-layout="content" -->
## Code Review Agents

- We will look at three vendors
- Pricing comparison
- Live demo of CodeRabbit
```

**Good slide — what the learner walks away with:**

```markdown
<!-- .slide: data-layout="content" -->
## Code review agents — when each wins

- CodeRabbit: best for large PRs, weakest at C# specifics
- CodeAnt: tightest C# rules, no PR summary
- Custom (Claude Code in CI): controllable, you pay per token
```

**Bad notes — prose, no source link:**

```markdown
Note: We should talk about EchoLeak here. It was a vulnerability in Microsoft 365 Copilot discovered in 2025 that allowed prompt injection through email content. The attack worked by sending a crafted email that the Copilot assistant would later read and execute instructions from. This is a good example of why we need to think about prompt injection in agentic systems.
```

**Good notes — link first, bullets, anticipated questions:**

```markdown
Note:
- [EchoLeak (CVE-2025-32711) — Microsoft writeup](https://msrc.microsoft.com/...)
- Zero-click prompt injection in M365 Copilot via crafted email
- Attack surface: any agent that reads attacker-controlled content
- Mitigations
  - Tool allowlists, not denylists
  - Human-in-loop on data exfil tools
- "Could this happen with Claude Code?" — yes, via any tool that reads external text (web fetch, MCP server, log file)
```

### See also (type-specific rules)

- **Workshops, training, hands-on sessions:** [`WORKSHOP.md`](WORKSHOP.md)

(Future: `PITCH.md`, `LECTURE.md`, `INTERNAL_REVIEW.md` — coming soon.)

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

## Layouts (v2 — 14 total)

| Layout | When | Notes |
|---|---|---|
| `title` | Cover slide | Big title, accent rule, brand logo prominent |
| `section` | Section divider | Full-bleed brand-primary gradient + accent rule |
| `content` | Default | Title + bullets / paragraphs |
| `two-column` | Side-by-side content | Use `<div class="col-left">` / `<div class="col-right">` |
| `image-text` | Image + text combo | Use `<div class="image">` / `<div class="text">` |
| `quote` | Big italic blockquote | Use markdown `>` syntax; oversized accent glyph |
| `closing` | Thank-you / Q&A | Mirrors title styling on gradient brand BG |
| `agenda` | Numbered list | Numbered ol, large type, generous whitespace |
| `table` | Tabular data | Markdown tables with zebra rows + accent header |
| `comparison` | 2–3 option boxes side-by-side | Use `<div class="compare">` + `<div class="option">` children |
| `code` | Code-focused | Triple-backtick fenced blocks with language tag |
| `big-stat` | One number does the work | `# 87%` + `## caption`. Wrap unit in `<em class="unit">%</em>` |
| `metric-grid` | 3-up KPI cards | `<div class="metrics">` with `<div class="metric">` children (`.label`, `.value`, `.delta.up\|.down`) |
| `pull-quote` | Oversized in-line quote | Display-font italic, accent rule on left, em-dashed attribution on a paragraph after |

## Image utility classes

Composable on any `<img>` or wrapper element:

| Class | Effect |
|---|---|
| `image-rounded` | `--radius-md` corners |
| `image-shadow` | `--shadow-lg` drop |
| `image-bleed` | Fill container, `object-fit: cover` |
| `image-duotone` | Brand-tinted monochrome via filter chain |
| `image-overlay` | Adds a brand-gradient scrim from transparent → primary at 75% bottom |

## Design tokens

The skill ships a token system in `theme-base/base.css`. Templates only declare two anchors (`--brand-primary`, `--brand-accent`); the rest derives via `color-mix(in oklch, …)`.

| Token group | Values |
|---|---|
| Color scales | `--brand-primary-{50..900}`, `--brand-accent-{50..900}`, `--neutral-{50..950}` |
| Semantic | `--brand-bg`, `--brand-fg`, `--brand-muted`, `--brand-surface`, `--brand-divider` |
| Type | `--text-{xs..6xl}`, `--text-display`, `--leading-*`, `--tracking-*` |
| Spacing | `--space-{0,px,0.5,1..7}` |
| Radius | `--radius-{sm,md,lg,xl,full}` |
| Shadow | `--shadow-{sm,md,lg,xl}` |
| Motion | `--duration-{fast,base,slow}`, `--ease-{out,in-out}` |

Templates that need to override a derived token (dark theme, brand-tinted surface) can do so in `template.css`.

## After authoring slides — always surface the run commands

When you (the assistant) author or edit slides for the user, **end your response with the exact `build` command** the user can run themselves. The user's iteration loop is small manual edits in `slides/*.md` plus a browser refresh; they need the command in the conversation, not buried in docs.

Print this block as the closing of any turn that touches slides:

```bash
# lint — catches overflow, missing assets, layout-content mismatches
# bash / PowerShell / Git Bash:
bun ~/.pal/skills/presentation/tools/doctor.ts <deck-dir>
# Windows cmd.exe:
bun %USERPROFILE%\.pal\skills\presentation\tools\doctor.ts <deck-dir>

# build — writes <cwd>/<deck-name>/<deck-name>.{html,md}
# bash / PowerShell / Git Bash:
bun ~/.pal/skills/presentation/tools/build.ts <deck-dir>
# Windows cmd.exe (no ~ expansion):
bun %USERPROFILE%\.pal\skills\presentation\tools\build.ts <deck-dir>

# add --out <dir> to override the output parent, --force to overwrite an existing build
# add --strict to doctor to promote warnings to errors
```

Substitute `<deck-dir>` with the actual deck path. Do this even when you also ran the build yourself — the user wants the command on hand for their own re-runs. **On Windows, check the user's shell before printing**: `cmd.exe` does not expand `~`, so if the user runs commands from a `C:\…>` prompt, print the `%USERPROFILE%` form. PowerShell, Git Bash, WSL, and Mac/Linux all expand `~` correctly.

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
