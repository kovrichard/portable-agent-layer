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
// --out defaults to process.cwd(). The deck-name subdir is always created
// inside --out, even when --out is explicitly provided. Existing files in
// the subdir are preserved unless --force is passed.

import { constants as fsConst } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { dataUri, escapeForTextarea, readText } from "./lib/inline";
import { THEME_BASE, VENDOR_REVEAL } from "./lib/paths";
import { getTemplate } from "./lib/registry";

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

async function buildConcat(deckDir: string): Promise<string> {
  const slidesDir = join(deckDir, "slides");
  if (await exists(slidesDir)) {
    const files = (await readdir(slidesDir)).filter((f) => f.endsWith(".md")).sort();
    if (files.length === 0) {
      throw new Error(`slides/ is empty at ${slidesDir}`);
    }
    const parts = await Promise.all(files.map((f) => readText(join(slidesDir, f))));
    return `${parts.map((p) => p.trim()).join("\n\n---\n\n")}\n`;
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

  let outRoot = process.cwd();
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
  const outDir = join(outRoot, slug);
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
    join(VENDOR_REVEAL, "plugin", "highlight", "monokai.css")
  );
  const revealJs = await readText(join(VENDOR_REVEAL, "reveal.js"));
  const markdownJs = await readText(
    join(VENDOR_REVEAL, "plugin", "markdown", "markdown.js")
  );
  const highlightJs = await readText(
    join(VENDOR_REVEAL, "plugin", "highlight", "highlight.js")
  );
  const notesJs = await readText(join(VENDOR_REVEAL, "plugin", "notes", "notes.js"));

  const contentMd = await readFile(concatPath, "utf8");

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
