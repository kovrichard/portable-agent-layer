// The deck lint rules; add one by appending to the array, and `appliesTo` picks its slides.

import { resolve } from "node:path";
import {
  codeBlockLineCounts,
  countAllListItems,
  countAtxHeading,
  countTopLevelListItems,
  extractNotes,
  fileExists,
  findImageRefs,
  hasLayoutDirective,
  hasNestedChildren,
  listItems,
  stripCodeAndLinks,
  tableRowCount,
  wordCount,
} from "./lint-helpers";
import type { Finding, Rule, SlideContext } from "./lint-types";

const BULLET_LAYOUTS = new Set(["content", "agenda", "comparison", "two-column"]);

function isBulletLayout(ctx: SlideContext): boolean {
  return BULLET_LAYOUTS.has(ctx.layout);
}

function rhythmRunAt(
  shapes: string[],
  i: number,
  minLength: Record<number, number>
): { period: number; length: number } | null {
  for (const p of [1, 2, 3]) {
    let runLen = p;

    while (i + runLen < shapes.length && shapes[i + runLen] === shapes[i + runLen - p]) {
      runLen++;
    }

    if (runLen >= minLength[p]) return { period: p, length: runLen }; // smallest period wins
  }

  return null;
}

function isNonProseLine(line: string, trimmed: string): boolean {
  if (!trimmed) return true;

  if (/^#/.test(trimmed)) return true; // heading

  if (/^\s*(?:[-*]\s|\d+\.\s)/.test(line)) return true; // any-indent bullet

  if (/^>/.test(trimmed)) return true; // blockquote

  if (/^<!--/.test(trimmed)) return true; // comment

  return /^<\/?\w/.test(trimmed); // html tag
}

function isExerciseSlide(ctx: SlideContext): boolean {
  // Detect by filename (what I see) OR by h2 prefix (what the room sees).
  if (/exercise/i.test(ctx.name)) return true;

  if (ctx.heads2.some((h) => /^Exercise\b/i.test(h))) return true;

  return false;
}

export const RULES: Rule[] = [
  // ── Global rules (run on every slide) ───────────────────────────────────

  {
    name: "no-layout",
    scope: "slide",
    check: (ctx) => {
      if (hasLayoutDirective(ctx.body)) return [];

      return [
        {
          rule: "no-layout",
          severity: "W",
          msg: "no <!-- .slide: data-layout=\"...\" --> directive — defaults to 'content'",
        },
      ];
    },
  },

  {
    name: "long-title",
    scope: "slide",
    check: (ctx) => {
      const findings: Finding[] = [];

      for (const h of ctx.heads1) {
        if (h.length > 60) {
          findings.push({
            rule: "long-title",
            severity: "W",
            msg: `h1 is ${h.length} chars (soft limit 60): "${h.slice(0, 50)}…"`,
          });
        }
      }

      return findings;
    },
  },

  {
    name: "long-subtitle",
    scope: "slide",
    check: (ctx) => {
      const findings: Finding[] = [];

      for (const h of ctx.heads2) {
        if (h.length > 100) {
          findings.push({
            rule: "long-subtitle",
            severity: "W",
            msg: `h2 is ${h.length} chars (soft limit 100)`,
          });
        }
      }

      return findings;
    },
  },

  {
    name: "missing-asset",
    scope: "slide",
    check: async (ctx) => {
      const findings: Finding[] = [];

      for (const ref of findImageRefs(ctx.bodyNoNotes)) {
        // `../assets/X` is relative to slides/, plain `assets/X` to the deck root.
        const base = ref.startsWith("../") ? resolve(ctx.deckDir, "slides") : ctx.deckDir;
        const abs = resolve(base, ref);
        if (!(await fileExists(abs))) {
          findings.push({
            rule: "missing-asset",
            severity: "E",
            msg: `image referenced but not found: ${ref}`,
          });
        }
      }

      return findings;
    },
  },

  {
    name: "bullet-emdash-continuation",
    scope: "slide",
    check: (ctx) => {
      // SKILL.md keeps em-dashes for heading qualifiers and Q&A notes; `- foo — bar`
      // in the body is prose posing as a bullet and belongs in a sub-bullet.
      const findings: Finding[] = [];

      for (const line of ctx.bodyNoNotes.split("\n")) {
        const m = new RegExp(/^(\s*)(?:[-*]\s+|\d+\.\s+)(.*)$/).exec(line);
        if (!m) continue;
        const stripped = stripCodeAndLinks(m[2]);
        if (/\s—\s/.test(stripped)) {
          findings.push({
            rule: "bullet-emdash-continuation",
            severity: "W",
            msg: `em-dash continuation in bullet: "${m[2].trim().slice(0, 60)}…" — convert to sub-bullet`,
          });
        }
      }

      return findings;
    },
  },

  {
    name: "slide-line-budget",
    scope: "slide",
    appliesTo: isBulletLayout,
    check: (ctx) => {
      // 10 fits cleanly on a slide; 11+ overflows even when each line is short.
      const all = countAllListItems(ctx.bodyNoNotes);
      if (all <= 10) return [];

      return [
        {
          rule: "slide-line-budget",
          severity: "W",
          msg: `${all} list lines (top-level + sub-bullets) — slide fits 10 cleanly`,
        },
      ];
    },
  },

  // ── Content-quality rules (Tier 1) ──────────────────────────────────────

  {
    // 2-15 words, looser than SKILL.md's 6-12 so only egregious bullets fire; a label
    // bullet with children has no minimum, and the comparison layout is exempt.
    name: "bullet-length-top-level",
    scope: "slide",
    appliesTo: (ctx) => isBulletLayout(ctx) && ctx.layout !== "comparison",
    check: (ctx) => {
      const findings: Finding[] = [];
      const items = listItems(ctx.bodyNoNotes);
      items.forEach((item, idx) => {
        if (item.indent !== 0) return;
        const wc = wordCount(item.content);
        const isLabel = hasNestedChildren(items, idx);
        const tooShort = wc < 2 && !isLabel;
        const tooLong = wc > 15;
        if (tooShort || tooLong) {
          findings.push({
            rule: "bullet-length-top-level",
            severity: "W",
            msg: `top-level bullet has ${wc} words (target 2–15): "${item.content.trim().slice(0, 50)}…"`,
          });
        }
      });

      return findings;
    },
  },

  {
    // Sub-bullets should land 2–10 words. They are elaborations of the parent,
    // not new claims, so they stay short.
    name: "bullet-length-sub",
    scope: "slide",
    appliesTo: isBulletLayout,
    check: (ctx) => {
      const findings: Finding[] = [];

      for (const item of listItems(ctx.bodyNoNotes)) {
        if (item.indent === 0) continue;
        const wc = wordCount(item.content);
        if (wc < 2 || wc > 10) {
          findings.push({
            rule: "bullet-length-sub",
            severity: "W",
            msg: `sub-bullet has ${wc} words (target 2–10): "${item.content.trim().slice(0, 50)}…"`,
          });
        }
      }

      return findings;
    },
  },

  {
    // If you cite, cite first: notes with a source link start with it or with a
    // "Sources" parent; notes without links are analysis and exempt.
    name: "notes-link-first",
    scope: "slide",
    appliesTo: (ctx) =>
      ctx.layout === "content" ||
      ctx.layout === "big-stat" ||
      ctx.layout === "comparison" ||
      ctx.layout === "table",
    check: (ctx) => {
      const notes = extractNotes(ctx.body);
      if (!notes.trim()) return [];

      // No links anywhere = analysis-only notes; rule doesn't apply.
      if (!/\[[^\]]+\]\([^)]+\)/.test(notes)) return [];
      const items = listItems(notes);
      if (items.length === 0) return [];
      const first = items[0].content.trim();
      if (/^\[[^\]]+\]\([^)]+\)/.test(first)) return [];

      // "Sources" / "Per-X sources" parent whose children are links — allowed.
      if (/^(per-\w+ )?sources?\b/i.test(first)) {
        const sub = items.slice(1).find((it) => it.indent > items[0].indent);
        if (sub && /^\[[^\]]+\]\([^)]+\)/.test(sub.content.trim())) return [];
      }

      return [
        {
          rule: "notes-link-first",
          severity: "W",
          msg: `notes have a source link, but first bullet isn't one: "${first.slice(0, 50)}…"`,
        },
      ];
    },
  },

  {
    // A bare paragraph is usually speaker narration leaked onto the slide; only content
    // and agenda slides are checked, since two-column and image-text host prose.
    name: "prose-paragraph-in-body",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "content" || ctx.layout === "agenda",
    check: (ctx) => {
      const findings: Finding[] = [];
      const lines = ctx.bodyNoNotes.split("\n");
      let inFence = false;

      for (const line of lines) {
        if (/^```/.test(line)) {
          inFence = !inFence;
          continue;
        }

        if (inFence) continue;
        const trimmed = line.trim();
        if (isNonProseLine(line, trimmed)) continue;

        if (trimmed.length > 80) {
          findings.push({
            rule: "prose-paragraph-in-body",
            severity: "W",
            msg: `prose paragraph in body (${trimmed.length} chars): "${trimmed.slice(0, 60)}…"`,
          });
        }
      }

      return findings;
    },
  },

  {
    // "Exercise — " tells the room the mode changed; this em-dash is a legal title qualifier.
    name: "exercise-title-prefix",
    scope: "slide",
    appliesTo: isExerciseSlide,
    check: (ctx) => {
      const h2 = ctx.heads2[0];
      if (!h2) {
        return [
          {
            rule: "exercise-title-prefix",
            severity: "W",
            msg: "exercise slide has no h2 title",
          },
        ];
      }

      if (/^Exercise\s+—\s+\S/.test(h2)) return [];

      return [
        {
          rule: "exercise-title-prefix",
          severity: "W",
          msg: `exercise title should start with "Exercise — ": "${h2.slice(0, 50)}"`,
        },
      ];
    },
  },

  {
    // The four facilitation beats are top-level note bullets the speaker scans while
    // delivering; each missing beat is its own warning.
    name: "exercise-note-beats",
    scope: "slide",
    appliesTo: isExerciseSlide,
    check: (ctx) => {
      const notes = extractNotes(ctx.body);
      const findings: Finding[] = [];
      const required = [
        "Facilitation",
        "Common output",
        "Common mistakes",
        "Anticipated questions",
      ];

      for (const beat of required) {
        const re = new RegExp(
          String.raw`^[-*]\s+${beat.replace(/\s+/g, "\\s+")}\b`,
          "im"
        );
        if (!re.test(notes)) {
          findings.push({
            rule: "exercise-note-beats",
            severity: "W",
            msg: `exercise notes missing beat: "${beat}"`,
          });
        }
      }

      return findings;
    },
  },

  {
    // big-stat is for numbers. The h1 must contain a digit; if it doesn't,
    // the wrong layout was probably chosen.
    name: "big-stat-needs-digit",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "big-stat",
    check: (ctx) => {
      if (ctx.heads1.length === 0) return []; // covered by big-stat-no-h1
      const h1 = ctx.heads1[0];
      if (/\d/.test(h1)) return [];

      return [
        {
          rule: "big-stat-needs-digit",
          severity: "W",
          msg: `big-stat h1 has no digit: "${h1}" — big-stat is for numbers`,
        },
      ];
    },
  },

  // ── Layout-specific rules ───────────────────────────────────────────────

  {
    name: "title-no-h1",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "title" || ctx.layout === "closing",
    check: (ctx) => {
      if (ctx.heads1.length > 0) return [];

      return [
        {
          rule: "title-no-h1",
          severity: "E",
          msg: "missing h1 (deck title)",
        },
      ];
    },
  },

  {
    name: "section-no-h1",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "section",
    check: (ctx) => {
      if (ctx.heads1.length > 0) return [];

      return [
        {
          rule: "section-no-h1",
          severity: "W",
          msg: "section divider with no h1",
        },
      ];
    },
  },

  {
    name: "agenda-bounds",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "agenda",
    check: (ctx) => {
      const findings: Finding[] = [];
      const items = countTopLevelListItems(ctx.bodyNoNotes);
      if (items > 10) {
        findings.push({
          rule: "agenda-overflow",
          severity: "W",
          msg: `${items} items — agenda fits 10 cleanly; split into two slides`,
        });
      }

      if (items === 0) {
        findings.push({
          rule: "agenda-empty",
          severity: "E",
          msg: "agenda layout has no list items",
        });
      }

      return findings;
    },
  },

  {
    name: "content-bullets",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "content",
    check: (ctx) => {
      const items = countTopLevelListItems(ctx.bodyNoNotes);
      if (items <= 7) return [];

      return [
        {
          rule: "content-bullets",
          severity: "W",
          msg: `${items} bullets — content slides fit ~7 cleanly`,
        },
      ];
    },
  },

  {
    name: "comparison-shape",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "comparison",
    check: (ctx) => {
      const findings: Finding[] = [];
      const body = ctx.bodyNoNotes;
      if (!body.includes('class="compare"')) {
        findings.push({
          rule: "comparison-wrapper",
          severity: "E",
          msg: 'missing <div class="compare"> wrapper',
        });
      }

      const options = (body.match(/class="option"/g) || []).length;
      if (options === 0) {
        findings.push({
          rule: "comparison-empty",
          severity: "E",
          msg: "no .option blocks found",
        });
      } else if (options > 3) {
        findings.push({
          rule: "comparison-count",
          severity: "W",
          msg: `${options} options — comparison fits 2–3 cleanly`,
        });
      }

      return findings;
    },
  },

  {
    name: "metric-grid-shape",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "metric-grid",
    check: (ctx) => {
      const findings: Finding[] = [];
      const body = ctx.bodyNoNotes;
      if (!body.includes('class="metrics"')) {
        findings.push({
          rule: "metric-grid-wrapper",
          severity: "E",
          msg: 'missing <div class="metrics"> wrapper',
        });
      }

      const metrics = (body.match(/class="metric"/g) || []).length;
      if (metrics === 0) {
        findings.push({
          rule: "metric-grid-empty",
          severity: "E",
          msg: "no .metric blocks found",
        });
      } else if (metrics !== 3) {
        findings.push({
          rule: "metric-grid-count",
          severity: "W",
          msg: `${metrics} metrics — grid is 3-column, expects exactly 3`,
        });
      }

      return findings;
    },
  },

  {
    name: "two-column-wrappers",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "two-column",
    check: (ctx) => {
      const body = ctx.bodyNoNotes;
      if (body.includes('class="col-left"') && body.includes('class="col-right"')) {
        return [];
      }

      return [
        {
          rule: "two-column-wrappers",
          severity: "E",
          msg: 'missing <div class="col-left"> or <div class="col-right">',
        },
      ];
    },
  },

  {
    name: "image-text-wrappers",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "image-text",
    check: (ctx) => {
      const body = ctx.bodyNoNotes;
      if (body.includes('class="image"') && body.includes('class="text"')) {
        return [];
      }

      return [
        {
          rule: "image-text-wrappers",
          severity: "E",
          msg: 'missing <div class="image"> or <div class="text">',
        },
      ];
    },
  },

  {
    name: "big-stat-shape",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "big-stat",
    check: (ctx) => {
      const findings: Finding[] = [];

      if (ctx.heads1.length === 0) {
        findings.push({
          rule: "big-stat-no-h1",
          severity: "E",
          msg: "missing h1 (the stat itself)",
        });
      } else if (ctx.heads1.length > 1) {
        findings.push({
          rule: "big-stat-multi-h1",
          severity: "W",
          msg: "multiple h1s — big-stat shows one number",
        });
      }

      return findings;
    },
  },

  {
    name: "quote-blockquote",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "quote" || ctx.layout === "pull-quote",
    check: (ctx) => {
      if (/^>\s+/m.test(ctx.bodyNoNotes)) return [];

      return [
        {
          rule: "quote-no-blockquote",
          severity: "E",
          msg: "no blockquote (`> ...`) found",
        },
      ];
    },
  },

  {
    name: "code-shape",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "code",
    check: (ctx) => {
      const findings: Finding[] = [];
      const blocks = codeBlockLineCounts(ctx.bodyNoNotes);
      if (blocks.length === 0) {
        findings.push({
          rule: "code-no-block",
          severity: "E",
          msg: "no fenced code block found",
        });
      }

      for (const n of blocks) {
        if (n > 25) {
          findings.push({
            rule: "code-too-long",
            severity: "W",
            msg: `code block has ${n} lines — fits ~25 before overflow`,
          });
        }
      }

      return findings;
    },
  },

  {
    name: "table-rows",
    scope: "slide",
    appliesTo: (ctx) => ctx.layout === "table",
    check: (ctx) => {
      const rows = tableRowCount(ctx.bodyNoNotes);
      if (rows <= 10) return [];

      return [
        {
          rule: "table-rows",
          severity: "W",
          msg: `${rows} table rows — gets cramped past ~8`,
        },
      ];
    },
  },

  {
    // Printed notes pages split lists cleanly, but a fenced code block cannot split
    // and is clipped past one page, so warn at 30 lines.
    name: "notes-code-too-long",
    scope: "slide",
    check: (ctx) => {
      const notes = extractNotes(ctx.body);
      if (!notes.trim()) return [];
      const findings: Finding[] = [];

      for (const n of codeBlockLineCounts(notes)) {
        if (n > 30) {
          findings.push({
            rule: "notes-code-too-long",
            severity: "W",
            msg: `notes code block has ${n} lines — won't break across printed pages cleanly (limit 30)`,
          });
        }
      }

      return findings;
    },
  },

  // ── Deck-scope rules (Tier 3) ───────────────────────────────────────────

  {
    // Flags a run of slide shapes repeating with period 1 (4+), 2 (3 cycles) or 3 (3 cycles);
    // a content slide's shape is its bullet count plus flat or nested.
    name: "monotone-rhythm",
    scope: "deck",
    check: (ctx) => {
      const shape = (s: SlideContext): string => {
        if (s.layout !== "content") return s.layout;
        const items = listItems(s.bodyNoNotes);
        const top = items.filter((it) => it.indent === 0).length;
        const hasSubs = items.some((it) => it.indent > 0);

        return `content:${top}:${hasSubs ? "nested" : "flat"}`;
      };

      const shapes = ctx.slides.map(shape);
      const used = new Array(shapes.length).fill(false);
      const minLength: Record<number, number> = { 1: 4, 2: 6, 3: 9 };
      const findings: Finding[] = [];

      for (let i = 0; i < shapes.length; i++) {
        if (used[i]) continue;

        const run = rhythmRunAt(shapes, i, minLength);
        if (!run) continue;
        const { period: chosenPeriod, length: chosenLen } = run;

        const startName = ctx.slides[i].name;
        const endName = ctx.slides[i + chosenLen - 1].name;
        const cycles = Math.floor(chosenLen / chosenPeriod);
        const sig =
          chosenPeriod === 1
            ? `shape "${shapes[i]}"`
            : `period ${chosenPeriod} pattern (${shapes.slice(i, i + chosenPeriod).join(" → ")})`;
        findings.push({
          rule: "monotone-rhythm",
          severity: "W",
          msg: `${cycles} cycles of ${sig} across ${chosenLen} slides (${startName} → ${endName}) — vary layout or nest some bullets`,
        });

        for (let k = i; k < i + chosenLen; k++) used[k] = true;
      }

      return findings;
    },
  },

  {
    // Flags only an empty block: a section slide last, or two in a row; whether the
    // next slide earns the block stays a human call.
    name: "block-needs-opener",
    scope: "deck",
    check: (ctx) => {
      const findings: Finding[] = [];

      for (let i = 0; i < ctx.slides.length; i++) {
        const slide = ctx.slides[i];
        if (slide.layout !== "section") continue;
        const next = ctx.slides[i + 1];
        if (!next) {
          findings.push({
            rule: "block-needs-opener",
            severity: "W",
            msg: `section "${slide.name}" is the last slide — no opener follows`,
          });
          continue;
        }

        if (next.layout === "section") {
          findings.push({
            rule: "block-needs-opener",
            severity: "W",
            msg: `section "${slide.name}" followed by another section "${next.name}" — empty block`,
          });
        }
      }

      return findings;
    },
  },
];

// Helpers also exported for tests / external runners.
export { countAtxHeading };
