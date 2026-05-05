#!/usr/bin/env bun
// presentation skill — build a deck folder to a self-contained HTML.
//
// Usage:
//   bun build.ts <deck-dir> [--out <dir>] [--force]
//
// Output:
//   <out>/<deck-name>/<deck-name>.md     concatenated slides (written first)
//   <out>/<deck-name>/<deck-name>.html   self-contained presentation
//
// --out defaults to the deck-dir itself (output lands at <deck-dir>/<deck-name>/,
// which the scaffolder gitignores). The deck-name subdir is always created
// inside --out, even when --out is explicitly provided. Existing files in
// the subdir are preserved unless --force is passed.

import { constants as fsConst } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { dataUri, escapeForTextarea, readText } from "./lib/inline";
import { THEME_BASE, VENDOR_REVEAL } from "./lib/paths";
import { getTemplate } from "./lib/registry";

// Walk markdown line-by-line, skipping fenced code blocks, applying `transform`
// to each non-fenced line. Used by both the concat-step path rewrite and the
// HTML-step image inliner so neither touches example image syntax inside ``` blocks.
async function mapMarkdownOutsideFences(
  md: string,
  transform: (line: string) => string | Promise<string>
): Promise<string> {
  const out: string[] = [];
  let inFence = false;
  for (const line of md.split("\n")) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    out.push(inFence ? line : await transform(line));
  }
  return out.join("\n");
}

// Rewrite `../assets/X` (the natural relative path from a `slides/*.md` file)
// to `assets/X` so the concatenated markdown — which lives at the deck root —
// resolves images correctly when previewed directly. Bare `X.png` references
// (no path) are left to the doctor to flag; we don't guess where they live.
function rewriteImageRefsForConcat(md: string): Promise<string> {
  return mapMarkdownOutsideFences(md, (line) =>
    line.replace(/(!\[[^\]]*\]\()([^)]+)(\))/g, (whole, open, ref, close) => {
      const trimmed = ref.trim();
      if (/^(https?:|data:)/i.test(trimmed)) return whole;
      if (trimmed.startsWith("../assets/")) {
        return `${open}${trimmed.slice(3)}${close}`;
      }
      return whole;
    })
  );
}

// Inline every local image reference in the concatenated markdown as a data: URI
// so the resulting HTML is truly self-contained (emailable, USB-stickable).
// Resolves refs against `deckDir` (the concat-md's location). Missing files are
// left untouched — the doctor flags them; build doesn't crash on author errors.
async function inlineImagesInMarkdown(md: string, deckDir: string): Promise<string> {
  return mapMarkdownOutsideFences(md, async (line) => {
    const matches = [...line.matchAll(/(!\[[^\]]*\]\()([^)]+)(\))/g)];
    if (matches.length === 0) return line;
    let result = line;
    for (const m of matches) {
      const [whole, open, ref, close] = m;
      const trimmed = ref.trim();
      if (/^(https?:|data:)/i.test(trimmed)) continue;
      const abs = resolve(deckDir, trimmed);
      try {
        await access(abs, fsConst.F_OK);
      } catch {
        continue;
      }
      // dataUri returns `url("data:...")` for CSS use; strip the `url("…")` wrapper for <img>.
      const wrapped = await dataUri(abs);
      const inner = wrapped.replace(/^url\("/, "").replace(/"\)$/, "");
      result = result.replace(whole, `${open}${inner}${close}`);
    }
    return result;
  });
}

const ASPECTS: Record<string, [number, number]> = {
  "16:9": [1920, 1080],
  "16:10": [1920, 1200],
  "4:3": [1440, 1080],
};

// Minimal YAML reader — only handles flat key: value lines (sufficient for slides.config.yml + template.yml).
function parseSimpleYaml(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of s.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-zA-Z_][\w-]*):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      try {
        v = JSON.parse(v.replace(/^'(.*)'$/, '"$1"'));
      } catch {
        v = v.slice(1, -1);
      }
    }
    out[m[1]] = v;
  }
  return out;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConst.F_OK);
    return true;
  } catch {
    return false;
  }
}

function deckSlug(deckDir: string): string {
  // Filesystem-safe name. Falls back to "deck" if basename is empty (shouldn't happen).
  const raw = basename(resolve(deckDir));
  const slug = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "deck";
}

// Build-time injection: code-layout slides with > 15 lines of code get a
// `style="--code-scale: X"` attribute baked into the slide directive. CSS in
// layouts.css multiplies the base code font by this variable. Linear from 1.0
// at 15 lines to 0.6 at 25 lines; clamped at 0.6 beyond. Build-time keeps the
// attribute on the rendered <section>, so navigation/Highlight re-runs cannot
// strip it.
function injectCodeScale(slideMarkdown: string): string {
  const layoutRe = /<!--\s*\.slide:\s*data-layout="code"([^>]*)-->/i;
  const layoutMatch = layoutRe.exec(slideMarkdown);
  if (!layoutMatch) return slideMarkdown;

  const codeRe = /```[^\n]*\n([\s\S]*?)\n```/;
  const codeMatch = codeRe.exec(slideMarkdown);
  if (!codeMatch) return slideMarkdown;

  const lines = codeMatch[1].split("\n").length;
  if (lines <= 15) return slideMarkdown;

  const scale = Math.max(0.6, 1 - (lines - 15) * 0.04).toFixed(2);
  // Don't double-inject if a previous build already set it.
  const extras = layoutMatch[1].replace(/\s+style="--code-scale:\s*[^"]+"/i, "").trim();
  const attrs = extras
    ? `${extras} style="--code-scale: ${scale}"`
    : `style="--code-scale: ${scale}"`;
  const newDirective = `<!-- .slide: data-layout="code" ${attrs} -->`;
  return slideMarkdown.replace(layoutMatch[0], newDirective);
}

// Build-time injection: table-layout slides with > 4 rows get a
// `style="--table-scale: X"` attribute baked into the slide directive. CSS
// multiplies cell font-size AND cell padding by this var so both shrink
// together (font-only shrinking is dampened by static padding). Linear from
// 1.0 at 4 rows to 0.6 at ≥10 rows. Mirrors `injectCodeScale`.
function injectTableScale(slideMarkdown: string): string {
  const layoutRe = /<!--\s*\.slide:\s*data-layout="table"([^>]*)-->/i;
  const layoutMatch = layoutRe.exec(slideMarkdown);
  if (!layoutMatch) return slideMarkdown;

  // Count markdown table rows (lines starting with `|`) excluding the
  // separator (`| --- | --- |`) which doesn't render as a row.
  const sepRe = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/;
  let rows = 0;
  for (const line of slideMarkdown.split("\n")) {
    if (/^\s*\|/.test(line) && !sepRe.test(line)) rows++;
  }
  if (rows <= 4) return slideMarkdown;

  const scale = Math.max(0.6, 1 - (rows - 4) * 0.067).toFixed(2);
  const extras = layoutMatch[1].replace(/\s+style="--table-scale:\s*[^"]+"/i, "").trim();
  const attrs = extras
    ? `${extras} style="--table-scale: ${scale}"`
    : `style="--table-scale: ${scale}"`;
  const newDirective = `<!-- .slide: data-layout="table" ${attrs} -->`;
  return slideMarkdown.replace(layoutMatch[0], newDirective);
}

async function buildConcat(deckDir: string): Promise<string> {
  const slidesDir = join(deckDir, "slides");
  if (await exists(slidesDir)) {
    const files = (await readdir(slidesDir)).filter((f) => f.endsWith(".md")).sort();
    if (files.length === 0) {
      throw new Error(`slides/ is empty at ${slidesDir}`);
    }
    const parts = await Promise.all(files.map((f) => readText(join(slidesDir, f))));
    const joined = `${parts.map((p) => injectTableScale(injectCodeScale(p.trim()))).join("\n\n---\n\n")}\n`;
    return rewriteImageRefsForConcat(joined);
  }
  const legacy = join(deckDir, "content.md");
  if (await exists(legacy)) {
    return await readText(legacy);
  }
  throw new Error(`no slides/ directory or content.md found in ${deckDir}`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("usage: build.ts <deck-dir> [--out <dir>] [--force]");
    process.exit(1);
  }
  const deckDir = resolve(argv[0]);

  let outRoot = deckDir;
  let force = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--out") outRoot = resolve(argv[++i]);
    else if (argv[i] === "--force") force = true;
  }

  const cfgPath = join(deckDir, "slides.config.yml");
  if (!(await exists(cfgPath))) {
    console.error(`slides.config.yml not found at ${cfgPath}`);
    process.exit(1);
  }
  const cfg = parseSimpleYaml(await readText(cfgPath));
  const templateName = cfg.template;
  if (!templateName) {
    console.error("slides.config.yml missing 'template'");
    process.exit(1);
  }

  const slug = deckSlug(deckDir);
  // When --out is the deck-dir itself (the default), write directly into it —
  // no extra <slug>/ subdir. Otherwise create the subdir so multiple decks
  // can coexist under one shared --out.
  const outDir = resolve(outRoot) === deckDir ? deckDir : join(outRoot, slug);
  const concatPath = join(outDir, `${slug}.md`);
  const htmlPath = join(outDir, `${slug}.html`);

  if (!force) {
    const collisions: string[] = [];
    if (await exists(concatPath)) collisions.push(concatPath);
    if (await exists(htmlPath)) collisions.push(htmlPath);
    if (collisions.length > 0) {
      console.error("refusing to overwrite existing output (pass --force to replace):");
      for (const p of collisions) console.error(`  - ${p}`);
      process.exit(1);
    }
  }

  // Step 1 — concatenate slides to a single on-disk markdown artifact.
  const concatMd = await buildConcat(deckDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(concatPath, concatMd, "utf8");

  // Step 2 — build self-contained HTML, sourcing content from the on-disk concat.
  const template = await getTemplate(templateName);
  const tplYml = parseSimpleYaml(await readText(join(template.path, "template.yml")));
  const tplCss = await readText(join(template.path, "template.css"));
  const logoFile = join(template.path, tplYml.logo || "logo.svg");
  const logoUri = await dataUri(logoFile);

  const aspect = cfg.aspect || tplYml.aspect || "16:9";
  const [width, height] = ASPECTS[aspect] || ASPECTS["16:9"];

  const baseCss = await readText(join(THEME_BASE, "base.css"));
  const layoutsCss = await readText(join(THEME_BASE, "layouts.css"));
  const skeleton = await readText(join(THEME_BASE, "skeleton.html"));
  const revealCss = await readText(join(VENDOR_REVEAL, "reveal.css"));
  const highlightCss = await readText(
    join(VENDOR_REVEAL, "plugin", "highlight", "github-dark.css")
  );
  const revealJs = await readText(join(VENDOR_REVEAL, "reveal.js"));
  const markdownJs = await readText(
    join(VENDOR_REVEAL, "plugin", "markdown", "markdown.js")
  );
  const highlightJs = await readText(
    join(VENDOR_REVEAL, "plugin", "highlight", "highlight.js")
  );
  const notesJs = await readText(join(VENDOR_REVEAL, "plugin", "notes", "notes.js"));

  // Read the concat back from disk, then inline image refs as data: URIs so
  // the HTML is self-contained. The on-disk concat keeps plain `assets/X` paths
  // for direct markdown preview; only the HTML embeds full image bytes.
  const contentMdRaw = await readFile(concatPath, "utf8");
  const contentMd = await inlineImagesInMarkdown(contentMdRaw, deckDir);

  let deckOverridesCss = "";
  const overridesPath = join(deckDir, "overrides.css");
  if (await exists(overridesPath)) {
    deckOverridesCss = `<style>${await readText(overridesPath)}</style>`;
  }

  const fontsLink =
    tplYml.fonts && tplYml.fonts !== "system"
      ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${tplYml.fonts}">`
      : "";

  // Use a function for replacements so $-sequences in the inserted text aren't interpreted by JS.
  const subs: Record<string, string> = {
    LANG: cfg.lang || "en",
    TITLE: cfg.title || "Presentation",
    FONTS_LINK: fontsLink,
    REVEAL_CSS: revealCss,
    HIGHLIGHT_CSS: highlightCss,
    BASE_CSS: baseCss,
    LAYOUTS_CSS: layoutsCss,
    TEMPLATE_CSS: tplCss,
    LOGO_DATA_URI: logoUri,
    DECK_OVERRIDES_CSS: deckOverridesCss,
    CONTENT_MD: escapeForTextarea(contentMd),
    REVEAL_JS: revealJs,
    MARKDOWN_PLUGIN_JS: markdownJs,
    HIGHLIGHT_PLUGIN_JS: highlightJs,
    NOTES_PLUGIN_JS: notesJs,
    WIDTH: String(width),
    HEIGHT: String(height),
  };

  const html = skeleton.replace(/\{\{(\w+)\}\}/g, (_, k) => subs[k] ?? "");
  await writeFile(htmlPath, html, "utf8");

  const sizeMb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
  console.log(`✓ concat   ${concatPath}`);
  console.log(`✓ html     ${htmlPath}  (${sizeMb} MB self-contained)`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
