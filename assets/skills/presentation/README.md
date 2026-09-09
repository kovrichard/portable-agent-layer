# presentation

PAL skill for building branded HTML presentations from markdown using Reveal.js. Multi-template (one user can register multiple brands), single self-contained HTML output, brand-neutral engine.

See `SKILL.md` for the full workflow. TL;DR:

```bash
# one-time per brand
pal cli skill run presentation setup-template

# per deck
pal cli skill run presentation new-deck ~/decks/my-talk --template my-brand
$EDITOR ~/decks/my-talk/slides/
pal cli skill run presentation build ~/decks/my-talk
# → ./my-talk/my-talk.html (and ./my-talk/my-talk.md — concatenated source)
# open the .html in your browser; refresh after each rebuild
```

Output: `<cwd>/<deck-name>/<deck-name>.html` (self-contained) plus `<deck-name>.md` (concatenated source). Override the parent dir with `--out <dir>`; pass `--force` to overwrite an existing build.

Layouts (14): title, section, content, two-column, image-text, quote, closing, agenda, table, comparison, code, big-stat, metric-grid, pull-quote.

Image utilities: `image-rounded`, `image-shadow`, `image-bleed`, `image-duotone`, `image-overlay`.

PDF export: use the browser's print-to-PDF (`Cmd+P` in the open deck) — Reveal supports `?print-pdf` query mode for clean page breaks. Standalone PDF tooling (decktape) deferred until requested.

PPTX import: not yet supported.
