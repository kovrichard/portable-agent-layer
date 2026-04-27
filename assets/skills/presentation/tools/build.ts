#!/usr/bin/env bun
// presentation skill — build a deck folder to a single self-contained HTML.
//
// Usage:
//   bun build.ts <deck-dir>

import { constants as fsConst } from "node:fs";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("usage: build.ts <deck-dir>");
    process.exit(1);
  }
  const deckDir = resolve(argv[0]);

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

  // Author surface: either a slides/ folder (preferred — many small files) or a single content.md.
  // slides/ wins if present. Files inside are sorted by filename, then joined with the slide separator.
  const slidesDir = join(deckDir, "slides");
  let contentMd: string;
  if (await exists(slidesDir)) {
    const files = (await readdir(slidesDir)).filter((f) => f.endsWith(".md")).sort();
    if (files.length === 0) {
      console.error(`slides/ is empty at ${slidesDir}`);
      process.exit(1);
    }
    const parts = await Promise.all(files.map((f) => readText(join(slidesDir, f))));
    contentMd = parts.map((p) => p.trim()).join("\n\n---\n\n") + "\n";
  } else {
    contentMd = await readText(join(deckDir, "content.md"));
  }

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

  const distDir = join(deckDir, "dist");
  await mkdir(distDir, { recursive: true });
  const outPath = join(distDir, "index.html");
  await writeFile(outPath, html, "utf8");

  const sizeMb = (Buffer.byteLength(html) / 1024 / 1024).toFixed(2);
  console.log(`✓ built ${outPath}  (${sizeMb} MB self-contained)`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
