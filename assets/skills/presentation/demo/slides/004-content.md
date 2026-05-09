<!-- .slide: data-layout="content" -->
## Content layout

The default. Title at top, body below.

- Bullets work as you'd expect
- Sub-bullets too
  - Like this
  - And this
- **Bold**, *italic*, `inline code`, [links](https://example.com)

Note:
- [Reveal.js print docs](https://revealjs.com/pdf-export/)
- Why this slide demonstrates print-with-notes
  - Long enough to cross a page break in the trainer print-out
  - Mixes link, bullet hierarchy, blockquote, inline code
  - Lets you verify the multi-page flow without authoring a fixture deck
- Default layout — when to leave it off
  - You want title + body, no special shape
  - You want the layout-agnostic spacing rules to kick in
  - You want the doctor to skip layout-shape checks
- Bullet hygiene reminder (per SKILL.md)
  - 2–15 words at top level, 2–10 at sub
  - No prose paragraphs — the `prose-paragraph-in-body` rule will warn
  - Em-dash continuation in bullets is also flagged
- Quote example
  > Slides are a delivery surface, not a document. Prose belongs in notes.
- Anticipated questions
  - "Why a 30-line cap on notes code blocks?" — single `<pre>` blocks don't break across printed pages; longer blocks clip
  - "Can I disable the trainer-notes printout?" — yes, remove the notes injection block from the `.then()` in skeleton.html in your local override
  - "Does the speaker view (S key) still work?" — yes, the injection only affects print, not the speaker view path
- Forward references
  - more on layout-specific rules in the `code` and `table` slides
  - more on print-view polish in `base.css` under "Trainer notes in print"
- Closing beats
  - The print-with-notes feature exists so a trainer can hand a delegate a printed deck and a printed prep packet at once
  - Ordering is `[Slide 1][Notes 1][Slide 2][Notes 2]…` so flipping pages reads in delivery order
  - Slides without a `Note:` block produce zero extra pages — title cards stay clean
