# Deck folder

One markdown file per slide under `slides/`. Files are concatenated at build time in filename order (use leading zeros: `001.md`, `002.md`, …). **Don't put `---` separators inside slide files** — the separator is added between files at build time.

Build: `bun ~/.pal/skills/presentation/tools/build.ts .`

Output lands at `<cwd>/<deck-name>/<deck-name>.html` — open it in your browser and refresh after each rebuild.

Layout per slide:
```markdown
<!-- .slide: data-layout="content" -->
## Slide title
- bullet
```

Available layouts: title, section, content, two-column, image-text, quote, closing, agenda, table, comparison, code, big-stat, metric-grid, pull-quote. See the skill's SKILL.md for details on each.
