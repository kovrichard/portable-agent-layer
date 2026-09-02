---
name: humanize
license: MIT
description: "Rewrites text to remove AI slop and make it sound human: eliminates em-dashes and en-dashes, LLM tell-words (delve, leverage, robust, seamless), 'not just X, it's Y' constructions, rule-of-three padding, boilerplate openers/closers, hedging, and decorative emoji, while preserving meaning and voice. Use when asked to humanize text, de-slop, remove AI dashes or em-dashes, strip AI tells, make writing sound human, or clean AI-generated prose."
argument-hint: <text, or a file path, or empty to rewrite the previous message>
metadata:
  source: portable-agent-layer
  triggers:
    - "humanize"
    - "ai slop"
    - "em dash"
    - "emdash"
    - "sound human"
    - "de-slop"
    - "remove ai tells"
    - "less robotic"
---

# Humanize

Rewrite the given content to strip AI-writing tells and return a human-sounding version. This is a rewrite, not a summary: preserve the author's meaning, facts, argument, structure, and voice. Never add new claims.

## Input handling

Resolve the input in this order:

1. **File path argument**: if `$ARGUMENTS` is a path to an existing file, read it. Ask the user whether to rewrite the file in place or output the rewrite in the response; if the request already made this clear, skip the question.
2. **Inline text argument**: if `$ARGUMENTS` is text, rewrite that text.
3. **No argument**: rewrite the most recent generated content or the immediately preceding message in the conversation.

## Rule 1: zero AI dashes (the headline rule)

The output must contain **zero em-dashes (—) and zero en-dashes (–) used as sentence punctuation**. Resolve every one by exactly one of:

- Splitting into two sentences.
- Replacing with a comma.
- Wrapping the aside in parentheses.
- Replacing with a colon (when the dash introduces an explanation or list).
- Restructuring the clause so no separator is needed.

Pick whichever reads most naturally per instance; do not mechanically apply one substitute everywhere. A plain hyphen inside a genuine compound word ("well-known", "off-the-shelf") is fine. A spaced or unspaced dash joining clauses is not. Numeric ranges ("pages 3–7") may keep an en-dash only in technical or reference contexts; in prose, prefer "to".

## Workflow

1. Resolve the input per **Input handling** above.
2. Scan the content and inventory every violation of the rules below before rewriting, so you can report counts afterward.
3. Rewrite the content, applying all of the following transformations:
   - **Dashes**: apply Rule 1 to every em-dash and en-dash.
   - **Antithesis constructions**: rewrite every "It's not just X, it's Y" and "not only… but also" into a direct statement of what the thing is.
   - **Rule-of-three padding**: collapse empty tricolons ("faster, cheaper, and more scalable" when only one quality matters) down to the item(s) that carry real information.
   - **LLM tell-words**: replace with a plain equivalent: delve (dig into, examine), tapestry, testament, underscore (show), pivotal, crucial (important, or cut), robust (reliable, or cut), seamless (cut, or state the actual behavior), elevate (improve), unlock, harness, leverage (use), navigate when figurative (handle, deal with), realm (area), landscape (field, market, or cut), ever-evolving, fast-paced (cut), game-changer, foster (encourage, or cut), embark (start), myriad, plethora (many), boasts (has), meticulous (careful).
   - **Boilerplate openers/closers**: delete "In today's world", "In conclusion", "Overall", "At the end of the day", "Let's dive in", "It's worth noting that", "Needless to say", and equivalents. If a closer carried a real point, keep the point and drop the frame.
   - **Hedging and throat-clearing**: cut filler that adds no information ("It's important to remember that", "Generally speaking", "In many ways", "Arguably").
   - **Inflation**: remove reflexive superlatives and marketing adjectives ("incredible", "powerful", "cutting-edge", "world-class"). Prefer a concrete claim over vague praise; if no concrete claim exists in the source, drop the praise rather than invent one.
   - **Decoration**: strip decorative emoji and gratuitous bold sprinkled through prose. Keep bold only where it marks genuine structure (a defined term, a table header, a key already emphasized deliberately and sparingly).
4. Verify: search the rewritten output for `—` and `–` and confirm zero sentence-punctuation hits remain.
5. Verify meaning: confirm the rewrite makes the same claims as the original, in the same order, at roughly the same length. If a sentence lost its point during de-slopping, restore the point in plain words.
6. If operating on a file and the user chose in-place editing, write the rewrite back to the file.

## Output format

Return, in order:

1. The fully rewritten content (or, if a file was edited in place, state which file was edited instead of repeating the content).
2. A short bullet list of changes by category with counts, for example:
   - removed 7 em-dashes (4 split into sentences, 2 commas, 1 colon)
   - replaced "leverage" → "use" ×3, "seamless" cut ×2
   - rewrote 2 "not just X, it's Y" constructions
   - cut 2 boilerplate closers, 1 opener
   - stripped 5 decorative emoji

## When to use

- The user asks to humanize, de-slop, or "make it sound human / less like AI".
- The user asks to remove em-dashes, AI dashes, or AI tells from text.
- The user wants AI-generated prose cleaned up before publishing, without changing what it says.

## Do NOT use

- To condense or shorten content. Humanize preserves length and structure.
- To pull insights, quotes, or ideas out of content: that is `extract-wisdom`. Humanize returns the whole text, rewritten in place.
- To change the argument, add claims, or restructure a document. Humanize changes wording, never meaning.
