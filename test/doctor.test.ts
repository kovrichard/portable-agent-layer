import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  extractLayout,
  type Finding,
  lintSlide,
} from "../assets/skills/presentation/tools/doctor";

// Helper — lint a single slide given its body. Creates a throwaway deck dir
// only when the rule needs to resolve an asset path (image-text, missing-asset).
async function lint(body: string, opts: { deckDir?: string } = {}): Promise<Finding[]> {
  const deckDir = opts.deckDir ?? tmpdir();
  const r = await lintSlide({ name: "test.md", body }, deckDir);
  return r.findings;
}

function ruleNames(findings: Finding[]): string[] {
  return findings.map((f) => f.rule).sort();
}

describe("extractLayout", () => {
  test("reads the data-layout from the slide directive", () => {
    expect(extractLayout(`<!-- .slide: data-layout="quote" -->\n# x`)).toBe("quote");
  });

  test("defaults to 'content' when no directive present", () => {
    expect(extractLayout(`# Just a title`)).toBe("content");
  });
});

describe("global rules", () => {
  test("no-layout fires when directive is missing", async () => {
    const f = await lint(`# Some title\n- bullet`);
    expect(ruleNames(f)).toContain("no-layout");
  });

  test("long-title fires for h1 over 60 chars", async () => {
    const long = "X".repeat(75);
    const f = await lint(`<!-- .slide: data-layout="title" -->\n# ${long}`);
    expect(ruleNames(f)).toContain("long-title");
  });

  test("long-subtitle fires for h2 over 100 chars", async () => {
    const long = "Y".repeat(120);
    const f = await lint(`<!-- .slide: data-layout="title" -->\n# Title\n## ${long}`);
    expect(ruleNames(f)).toContain("long-subtitle");
  });

  test("missing-asset fires when image file is absent", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="content" -->\n## x\n![alt](assets/no-such.png)`
    );
    expect(ruleNames(f)).toContain("missing-asset");
  });

  test("missing-asset is suppressed inside fenced code", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="content" -->\n## x\n\`\`\`\n![alt](assets/example.png)\n\`\`\``
    );
    expect(ruleNames(f)).not.toContain("missing-asset");
  });

  test("missing-asset is suppressed for http(s) and data: URLs", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="content" -->\n## x\n![](https://example.com/foo.png)\n![](data:image/svg+xml;base64,abc)`
    );
    expect(ruleNames(f)).not.toContain("missing-asset");
  });

  test("missing-asset resolves against deck dir for present files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "doctor-asset-"));
    try {
      mkdirSync(join(dir, "assets"));
      writeFileSync(join(dir, "assets", "diagram.png"), "");
      const f = await lint(
        `<!-- .slide: data-layout="content" -->\n## x\n![alt](assets/diagram.png)`,
        { deckDir: dir }
      );
      expect(ruleNames(f)).not.toContain("missing-asset");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Note: speaker notes are stripped before counting headings", async () => {
    // Title in body, a long h1 inside Note: should NOT trigger long-title.
    const long = "Z".repeat(75);
    const f = await lint(
      `<!-- .slide: data-layout="title" -->\n# Short\n\nNote: # ${long} — speaker note`
    );
    expect(ruleNames(f)).not.toContain("long-title");
  });
});

describe("agenda rules", () => {
  test("agenda-overflow fires for >10 items", async () => {
    const items = Array.from({ length: 12 }, (_, i) => `${i + 1}. item`).join("\n");
    const f = await lint(`<!-- .slide: data-layout="agenda" -->\n## A\n${items}`);
    expect(ruleNames(f)).toContain("agenda-overflow");
  });

  test("agenda passes with exactly 10 items", async () => {
    const items = Array.from({ length: 10 }, (_, i) => `${i + 1}. item`).join("\n");
    const f = await lint(`<!-- .slide: data-layout="agenda" -->\n## A\n${items}`);
    expect(ruleNames(f)).not.toContain("agenda-overflow");
  });

  test("agenda-empty fires when no list items", async () => {
    const f = await lint(`<!-- .slide: data-layout="agenda" -->\n## just a title`);
    expect(ruleNames(f)).toContain("agenda-empty");
  });
});

describe("content rules", () => {
  test("content-bullets fires for >7 top-level bullets", async () => {
    const bullets = Array.from({ length: 9 }, (_, i) => `- bullet ${i}`).join("\n");
    const f = await lint(`<!-- .slide: data-layout="content" -->\n## c\n${bullets}`);
    expect(ruleNames(f)).toContain("content-bullets");
  });

  test("content passes with 7 bullets", async () => {
    const bullets = Array.from({ length: 7 }, (_, i) => `- bullet ${i}`).join("\n");
    const f = await lint(`<!-- .slide: data-layout="content" -->\n## c\n${bullets}`);
    expect(ruleNames(f)).not.toContain("content-bullets");
  });
});

describe("comparison rules", () => {
  test("comparison-wrapper fires when missing the .compare div", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="comparison" -->\n## c\n**A** vs **B**`
    );
    expect(ruleNames(f)).toContain("comparison-wrapper");
  });

  test("comparison-empty fires when no .option blocks", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="comparison" -->\n## c\n<div class="compare"></div>`
    );
    expect(ruleNames(f)).toContain("comparison-empty");
  });

  test("comparison-count fires for >3 options", async () => {
    const opts = Array.from({ length: 4 }, () => `<div class="option">x</div>`).join(
      "\n"
    );
    const f = await lint(
      `<!-- .slide: data-layout="comparison" -->\n## c\n<div class="compare">\n${opts}\n</div>`
    );
    expect(ruleNames(f)).toContain("comparison-count");
  });
});

describe("metric-grid rules", () => {
  test("metric-grid-wrapper fires when missing the .metrics div", async () => {
    const f = await lint(`<!-- .slide: data-layout="metric-grid" -->\n## m`);
    expect(ruleNames(f)).toContain("metric-grid-wrapper");
  });

  test("metric-grid-count fires for non-3 metric count", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="metric-grid" -->\n## m\n<div class="metrics"><div class="metric">a</div><div class="metric">b</div></div>`
    );
    expect(ruleNames(f)).toContain("metric-grid-count");
  });

  test("metric-grid passes with exactly 3 metrics", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="metric-grid" -->\n## m\n<div class="metrics"><div class="metric">a</div><div class="metric">b</div><div class="metric">c</div></div>`
    );
    expect(ruleNames(f).filter((r) => r.startsWith("metric-grid"))).toEqual([]);
  });
});

describe("two-column / image-text wrapper rules", () => {
  test("two-column-wrappers fires when columns missing", async () => {
    const f = await lint(`<!-- .slide: data-layout="two-column" -->\n## t`);
    expect(ruleNames(f)).toContain("two-column-wrappers");
  });

  test("two-column passes with both columns present", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="two-column" -->\n## t\n<div class="col-left">L</div><div class="col-right">R</div>`
    );
    expect(ruleNames(f)).not.toContain("two-column-wrappers");
  });

  test("image-text-wrappers fires when wrappers missing", async () => {
    const f = await lint(`<!-- .slide: data-layout="image-text" -->\n## i`);
    expect(ruleNames(f)).toContain("image-text-wrappers");
  });
});

describe("big-stat rules", () => {
  test("big-stat-no-h1 fires without an h1", async () => {
    const f = await lint(`<!-- .slide: data-layout="big-stat" -->\n## just caption`);
    expect(ruleNames(f)).toContain("big-stat-no-h1");
  });

  test("big-stat-multi-h1 fires for >1 h1", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="big-stat" -->\n# 87%\n# 92%\n## caption`
    );
    expect(ruleNames(f)).toContain("big-stat-multi-h1");
  });
});

describe("quote / pull-quote rules", () => {
  test("quote-no-blockquote fires for quote layout without > syntax", async () => {
    const f = await lint(`<!-- .slide: data-layout="quote" -->\nplain paragraph`);
    expect(ruleNames(f)).toContain("quote-no-blockquote");
  });

  test("pull-quote with blockquote passes", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="pull-quote" -->\n> a quote\n\n— attrib`
    );
    expect(ruleNames(f).filter((r) => r === "quote-no-blockquote")).toEqual([]);
  });
});

describe("code rules", () => {
  test("code-no-block fires when no fenced code present", async () => {
    const f = await lint(`<!-- .slide: data-layout="code" -->\n## c\nno code here`);
    expect(ruleNames(f)).toContain("code-no-block");
  });

  test("code-too-long fires for blocks over 25 lines", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const f = await lint(
      `<!-- .slide: data-layout="code" -->\n\`\`\`ts\n${lines}\n\`\`\``
    );
    expect(ruleNames(f)).toContain("code-too-long");
  });
});

describe("notes-code-too-long", () => {
  test("fires for code blocks in notes over 30 lines", async () => {
    const lines = Array.from({ length: 35 }, (_, i) => `line ${i}`).join("\n");
    const f = await lint(
      `<!-- .slide: data-layout="content" -->\n## c\n- bullet here\n\nNote:\n- intro\n\n\`\`\`ts\n${lines}\n\`\`\``
    );
    expect(ruleNames(f)).toContain("notes-code-too-long");
  });

  test("does not fire for code blocks in body (handled by code-too-long)", async () => {
    const lines = Array.from({ length: 35 }, (_, i) => `line ${i}`).join("\n");
    const f = await lint(
      `<!-- .slide: data-layout="code" -->\n\`\`\`ts\n${lines}\n\`\`\``
    );
    expect(ruleNames(f)).not.toContain("notes-code-too-long");
  });

  test("does not fire when notes have no code blocks", async () => {
    const f = await lint(
      `<!-- .slide: data-layout="content" -->\n## c\n- bullet\n\nNote:\n- just bullets`
    );
    expect(ruleNames(f)).not.toContain("notes-code-too-long");
  });
});

describe("table rules", () => {
  test("table-rows fires for tables over 10 rows", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => `| ${i} | x |`).join("\n");
    const f = await lint(
      `<!-- .slide: data-layout="table" -->\n## t\n| a | b |\n|---|---|\n${rows}`
    );
    expect(ruleNames(f)).toContain("table-rows");
  });
});
