#!/usr/bin/env bun
// Build a deck folder into <deck-name>.md and a self-contained <deck-name>.html; SKILL.md has the layout.
// Usage: pal cli skill run presentation build <deck-dir> [--out <dir>] [--force]

import { constants as fsConst } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { dataUri, escapeForTextarea, readText } from "./lib/inline";
import { THEME_BASE, VENDOR_REVEAL } from "./lib/paths";
import { getTemplate } from "./lib/registry";

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

// `../assets/X` from a slide becomes `assets/X` for the concat at the deck root;
// a bare `X.png` is left for the doctor to flag.
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

// A missing image stays as written for the doctor to flag, so build never crashes
// on an author's mistake.
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
  const raw = basename(resolve(deckDir));
  const slug = raw.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

  return slug || "deck";
}

// Baked in at build time so reveal.js navigation and Highlight re-runs cannot strip it;
// layouts.css scales code from 1.0 at 15 lines down to 0.6 at 25.
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
  const extras = layoutMatch[1].replace(/\s+style="--code-scale:\s*[^"]+"/i, "").trim();
  const attrs = extras
    ? `${extras} style="--code-scale: ${scale}"`
    : `style="--code-scale: ${scale}"`;
  const newDirective = `<!-- .slide: data-layout="code" ${attrs} -->`;

  return slideMarkdown.replace(layoutMatch[0], newDirective);
}

// Like injectCodeScale: font and padding shrink together, from 1.0 at 4 rows to
// 0.6 at 10, because shrinking only the font is dampened by fixed padding.
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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseBuildArgs(argv: string[]) {
  if (argv.length === 0) fail("usage: build.ts <deck-dir> [--out <dir>] [--force]");
  const deckDir = resolve(argv[0]);
  let outRoot = deckDir;
  let force = false;

  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--out") outRoot = resolve(argv[++i]);
    else if (argv[i] === "--force") force = true;
  }

  return { deckDir, outRoot, force };
}

async function readDeckConfig(deckDir: string) {
  const cfgPath = join(deckDir, "slides.config.yml");
  if (!(await exists(cfgPath))) fail(`slides.config.yml not found at ${cfgPath}`);
  const cfg = parseSimpleYaml(await readText(cfgPath));
  if (!cfg.template) fail("slides.config.yml missing 'template'");

  return { cfg, templateName: cfg.template };
}

async function refuseOverwrite(paths: string[]): Promise<void> {
  const collisions: string[] = [];

  for (const p of paths) if (await exists(p)) collisions.push(p);

  if (collisions.length === 0) return;
  console.error("refusing to overwrite existing output (pass --force to replace):");

  for (const p of collisions) console.error(`  - ${p}`);
  process.exit(1);
}

// Flat in the deck folder by default; under <slug>/ for any other --out, so decks
// can share one folder.
function deckOutputPaths(deckDir: string, outRoot: string) {
  const slug = deckSlug(deckDir);
  const outDir = resolve(outRoot) === deckDir ? deckDir : join(outRoot, slug);

  return {
    outDir,
    concatPath: join(outDir, `${slug}.md`),
    htmlPath: join(outDir, `${slug}.html`),
  };
}

async function readTemplateAssets(templateName: string) {
  const template = await getTemplate(templateName);
  const tplYml = parseSimpleYaml(await readText(join(template.path, "template.yml")));
  const tplCss = await readText(join(template.path, "template.css"));
  const logoFile = join(template.path, tplYml.logo || "logo.svg");
  const logoUri = await dataUri(logoFile);

  return { tplYml, tplCss, logoUri };
}

async function readVendorAssets() {
  return {
    baseCss: await readText(join(THEME_BASE, "base.css")),
    layoutsCss: await readText(join(THEME_BASE, "layouts.css")),
    skeleton: await readText(join(THEME_BASE, "skeleton.html")),
    revealCss: await readText(join(VENDOR_REVEAL, "reveal.css")),
    highlightCss: await readText(
      join(VENDOR_REVEAL, "plugin", "highlight", "github-dark.css")
    ),
    revealJs: await readText(join(VENDOR_REVEAL, "reveal.js")),
    markdownJs: await readText(join(VENDOR_REVEAL, "plugin", "markdown", "markdown.js")),
    highlightJs: await readText(
      join(VENDOR_REVEAL, "plugin", "highlight", "highlight.js")
    ),
    notesJs: await readText(join(VENDOR_REVEAL, "plugin", "notes", "notes.js")),
  };
}

async function readDeckOverridesCss(deckDir: string): Promise<string> {
  const overridesPath = join(deckDir, "overrides.css");
  if (await exists(overridesPath)) {
    return `<style>${await readText(overridesPath)}</style>`;
  }

  return "";
}

function fontsLinkFor(tplYml: Record<string, string>): string {
  return tplYml.fonts && tplYml.fonts !== "system"
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="${tplYml.fonts}">`
    : "";
}

// Only the HTML embeds image bytes; the concat on disk keeps `assets/X` paths for
// previewing the markdown directly.
async function renderDeckHtml(
  deckDir: string,
  concatPath: string,
  cfg: Record<string, string>,
  templateName: string
): Promise<string> {
  const { tplYml, tplCss, logoUri } = await readTemplateAssets(templateName);
  const aspect = cfg.aspect || tplYml.aspect || "16:9";
  const [width, height] = ASPECTS[aspect] || ASPECTS["16:9"];
  const { skeleton, ...vendor } = await readVendorAssets();
  const contentMd = await inlineImagesInMarkdown(
    await readFile(concatPath, "utf8"),
    deckDir
  );

  const subs: Record<string, string> = {
    LANG: cfg.lang || "en",
    TITLE: cfg.title || "Presentation",
    FONTS_LINK: fontsLinkFor(tplYml),
    REVEAL_CSS: vendor.revealCss,
    HIGHLIGHT_CSS: vendor.highlightCss,
    BASE_CSS: vendor.baseCss,
    LAYOUTS_CSS: vendor.layoutsCss,
    TEMPLATE_CSS: tplCss,
    LOGO_DATA_URI: logoUri,
    DECK_OVERRIDES_CSS: await readDeckOverridesCss(deckDir),
    CONTENT_MD: escapeForTextarea(contentMd),
    REVEAL_JS: vendor.revealJs,
    MARKDOWN_PLUGIN_JS: vendor.markdownJs,
    HIGHLIGHT_PLUGIN_JS: vendor.highlightJs,
    NOTES_PLUGIN_JS: vendor.notesJs,
    WIDTH: String(width),
    HEIGHT: String(height),
  };

  // A function replacer keeps $-sequences in the inserted text from being interpreted.
  return skeleton.replace(/\{\{(\w+)\}\}/g, (_, k) => subs[k] ?? "");
}

async function main() {
  const { deckDir, outRoot, force } = parseBuildArgs(process.argv.slice(2));
  const { cfg, templateName } = await readDeckConfig(deckDir);
  const { outDir, concatPath, htmlPath } = deckOutputPaths(deckDir, outRoot);

  if (!force) await refuseOverwrite([concatPath, htmlPath]);

  const concatMd = await buildConcat(deckDir);
  await mkdir(outDir, { recursive: true });
  await writeFile(concatPath, concatMd, "utf8");

  const html = await renderDeckHtml(deckDir, concatPath, cfg, templateName);
  await writeFile(htmlPath, html, "utf8");

  const sizeMb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
  console.log(`✓ concat   ${concatPath}`);
  console.log(`✓ html     ${htmlPath}  (${sizeMb} MB self-contained)`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
