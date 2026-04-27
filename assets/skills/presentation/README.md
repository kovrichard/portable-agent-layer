# presentation

PAL skill for building branded HTML presentations from markdown using Reveal.js. Multi-template (one user can register multiple brands), single self-contained HTML output, brand-neutral engine.

See `SKILL.md` for the full workflow. TL;DR:

```bash
# one-time per brand
bun ~/.pal/skills/presentation/tools/setup-template.ts

# per deck
bun ~/.pal/skills/presentation/tools/new-deck.ts ~/decks/my-talk --template my-brand
$EDITOR ~/decks/my-talk/content.md
bun ~/.pal/skills/presentation/tools/present.ts ~/decks/my-talk
```

Layouts: title, section, content, two-column, image-text, quote, closing, agenda, table, comparison, code.

PDF export (v1.1): use the browser's print-to-PDF (`Cmd+P` in the open deck) — Reveal supports `?print-pdf` query mode for clean page breaks. Standalone PDF tooling (decktape) deferred until requested.

PPTX import (v2): not yet supported.
