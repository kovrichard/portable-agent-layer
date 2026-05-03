#!/usr/bin/env bun
// presentation skill — scaffold a new deck folder.
//
// Usage:
//   bun new-deck.ts <deck-dir> [--template <name>] [--title "Deck title"] [--showcase]

import { constants as fsConst } from "node:fs";
import { access, copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { SKILL_DEMO, SKILL_TEMPLATE } from "./lib/paths";
import { listTemplates } from "./lib/registry";

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
    console.error(
      'usage: new-deck.ts <deck-dir> [--template <name>] [--title "Deck title"] [--showcase]'
    );
    process.exit(1);
  }
  const target = resolve(argv[0]);
  let templateName: string | undefined;
  let title = "New deck";
  let showcase = false;
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--template") templateName = argv[++i];
    else if (argv[i] === "--title") title = argv[++i];
    else if (argv[i] === "--showcase") showcase = true;
  }

  if (await exists(target)) {
    console.error(`target already exists: ${target}`);
    process.exit(1);
  }

  const all = await listTemplates();
  if (all.length === 0) {
    console.error("no templates registered. run setup-template.ts first.");
    process.exit(1);
  }

  if (!templateName) {
    if (all.length === 1) templateName = all[0].name;
    else {
      console.error("multiple templates registered, specify --template <name>:");
      for (const t of all) console.error(`  - ${t.name}  (${t.meta.primary})`);
      process.exit(1);
    }
  }
  if (!all.find((t) => t.name === templateName)) {
    console.error(`template "${templateName}" not registered`);
    process.exit(1);
  }

  await mkdir(target, { recursive: true });
  await mkdir(join(target, "assets"), { recursive: true });

  const cfg = `template: ${templateName}
title: ${JSON.stringify(title)}
lang: en
# aspect: "16:9"  # optional, falls back to template default
`;
  await writeFile(join(target, "slides.config.yml"), cfg, "utf8");

  // Author surface = slides/ folder of small files (one slide per file). At build time they're
  // concatenated in filename order. One file per slide means a malformed edit only takes down
  // its own slide, and parallel writes don't conflict.
  const sourceSlidesDir = join(showcase ? SKILL_DEMO : SKILL_TEMPLATE, "slides");
  const slidesDir = join(target, "slides");
  await mkdir(slidesDir, { recursive: true });
  const sourceFiles = (await readdir(sourceSlidesDir))
    .filter((f) => f.endsWith(".md"))
    .sort();
  for (const f of sourceFiles) {
    await copyFile(join(sourceSlidesDir, f), join(slidesDir, f));
  }

  // Build output lands in this deck-dir by default — flat (slug.html, slug.md)
  // when --out defaults to the deck-dir, or under slug/ when --out is explicit.
  // Pre-ignore both shapes.
  const slug =
    basename(target)
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "deck";
  await writeFile(
    join(target, ".gitignore"),
    `${slug}.html\n${slug}.md\n${slug}/\n`,
    "utf8"
  );

  console.log(`✓ deck scaffolded at ${target}`);
  console.log(`  template:   ${templateName}`);
  console.log(`  showcase:   ${showcase ? "yes" : "no"}`);
  console.log(`  slides:     ${sourceFiles.length} file(s) in slides/`);
  console.log(`\nNext:`);
  console.log(`  $EDITOR ${slidesDir}/`);
  console.log(`  bun ~/.pal/skills/presentation/tools/build.ts ${target}`);
  console.log(`  # output → ${target}/${slug}.html  (override with --out <dir>)`);
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
