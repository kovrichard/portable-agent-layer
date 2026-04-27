#!/usr/bin/env bun

// presentation skill — build (if stale) and open the deck in default browser.
//
// Usage:
//   bun present.ts <deck-dir>

import { spawn } from "node:child_process";
import { constants as fsConst } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, fsConst.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isStale(deckDir: string, distHtml: string): Promise<boolean> {
  if (!(await exists(distHtml))) return true;
  const distMtime = (await stat(distHtml)).mtimeMs;
  const candidates = ["content.md", "slides.config.yml", "overrides.css"];
  for (const f of candidates) {
    const p = join(deckDir, f);
    if (await exists(p)) {
      if ((await stat(p)).mtimeMs > distMtime) return true;
    }
  }
  return false;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error("usage: present.ts <deck-dir>");
    process.exit(1);
  }
  const deckDir = resolve(argv[0]);
  const distHtml = join(deckDir, "dist", "index.html");

  if (await isStale(deckDir, distHtml)) {
    console.log("→ rebuilding (deck has changed since last build)…");
    const buildScript = fileURLToPath(new URL("./build.ts", import.meta.url));
    await new Promise<void>((res, rej) => {
      const p = spawn("bun", [buildScript, deckDir], { stdio: "inherit" });
      p.on("exit", (c) => (c === 0 ? res() : rej(new Error(`build exited ${c}`))));
    });
  }

  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawn(opener, [distHtml], { detached: true, stdio: "ignore" }).unref();
  console.log(`→ opened ${distHtml}`);
  console.log(
    "  F = fullscreen · S = speaker notes · ? = keyboard shortcuts · Esc = overview"
  );
}

main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
