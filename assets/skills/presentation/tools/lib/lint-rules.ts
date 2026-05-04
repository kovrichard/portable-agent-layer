// presentation skill — rule registry.
//
// Each rule is a small object with a `check` function that emits Findings.
// Slide-scope rules run once per slide; deck-scope rules run once over the
// whole deck. Adding a rule = appending to the array. The runner in
// doctor.ts is layout-agnostic — `appliesTo` controls which slides a rule
// runs on.

import { resolve } from "node:path";
import {
  codeBlockLineCounts,
  countAllListItems,
  countAtxHeading,
  countTopLevelListItems,
  fileExists,
  findImageRefs,
  hasLayoutDirective,
  stripCodeAndLinks,
  tableRowCount,
} from "./lint-helpers";
import type { Finding, Rule, SlideContext } from "./lint-types";

const BULLET_LAYOUTS = new Set(["content", "agenda", "comparison", "two-column"]);

function isBulletLayout(ctx: SlideContext): boolean {
  return BULLET_LAYOUTS.has(ctx.layout);
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
        const abs = resolve(ctx.deckDir, ref);
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
      // Em-dash continuation in body bullets is disallowed by SKILL.md content
      // rules. Em-dash is reserved for title qualifiers in headings ("Block 4
      // — Landscape") and Q&A format in notes (`"Question?" — short answer`).
      // Inside the slide body, a bullet of the form `- foo — bar` is prose
      // pretending to be a bullet. Convert to a sub-bullet instead.
      const findings: Finding[] = [];
      for (const line of ctx.bodyNoNotes.split("\n")) {
        const m = line.match(/^(\s*)(?:[-*]\s+|\d+\.\s+)(.*)$/);
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
];

// Helpers also exported for tests / external runners.
export { countAtxHeading };
