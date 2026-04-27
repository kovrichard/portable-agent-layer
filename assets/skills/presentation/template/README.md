# Deck folder

Edit `content.md` — slides separated by `---` on its own line.

Build: `bun ~/.pal/skills/presentation/tools/build.ts .`
Present: `bun ~/.pal/skills/presentation/tools/present.ts .`

Layout per slide:
```markdown
<!-- .slide: data-layout="content" -->
## Slide title
- bullet
```

Available layouts: title, section, content, two-column, image-text, quote, closing, agenda, table, comparison, code. See the skill's SKILL.md for details on each.
