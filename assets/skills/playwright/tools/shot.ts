#!/usr/bin/env node
// playwright skill tool: capture a screenshot of a URL and print its absolute path.
//
// Engine selection (see chooseTier):
//   Tier 1 — system `playwright-cli` binary (Microsoft's stateful agent CLI), when on
//            PATH and no exact viewport/full-page is requested.
//   Tier 2 — PAL-installed Playwright, launched via Node. (Playwright's chromium.launch
//            hangs under Bun on Windows — the same Node exception create-pdf relies on.)
// If neither engine works, prints NO_PLAYWRIGHT_CLI on stderr and exits non-zero so the
// caller (SKILL.md) can fall back to the Playwright MCP.
//
// pal-build:mjs — ships as a compiled shot.mjs sibling (scripts/build-skill-tools.ts).
// Run under Node via the compiled file (a .ts under node_modules can't be type-stripped;
// plain .mjs needs no stripping and runs on every OS, keeping the Windows fallback):
//   node ~/.pal/skills/playwright/tools/shot.mjs <url> [opts]

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chooseTier, parseArgs, type ShotOptions } from "./shot-lib.ts";

function playwrightCliAvailable(): boolean {
  try {
    return spawnSync("playwright-cli", ["--version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

function runViaCli(opts: ShotOptions, out: string): boolean {
  // playwright-cli writes a `.playwright-cli/` session dir (logs + page snapshots)
  // into its cwd. Run it inside a throwaway temp dir so nothing lands in the user's
  // repo, then remove it. `out` is already absolute, so the screenshot is unaffected.
  // Cross-platform: os.tmpdir + fs.mkdtemp/rm — no shell, no platform-specific paths.
  const work = mkdtempSync(join(tmpdir(), "pal-pwcli-"));
  const run = (args: string[], quiet = false) =>
    spawnSync("playwright-cli", args, { stdio: quiet ? "ignore" : "inherit", cwd: work });
  try {
    if (run(["open", opts.url]).status !== 0) return false;
    const args = ["screenshot", `--filename=${out}`];
    if (opts.selector) args.push(opts.selector);
    const shot = run(args);
    run(["close"], true);
    return shot.status === 0 && existsSync(out);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// "unavailable" = the engine itself can't run (package or Chromium missing) → MCP fallback.
// "error" = the engine ran but the page/screenshot failed → a real error, not an MCP case.
type NodeResult = "ok" | "unavailable" | "error";

async function runViaNode(opts: ShotOptions, out: string): Promise<NodeResult> {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return "unavailable"; // package not resolvable
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch();
  } catch (e) {
    console.error(`chromium launch failed: ${(e as Error).message}`);
    return "unavailable"; // browser not installed / can't launch
  }

  try {
    const page = await browser.newPage(opts.viewport ? { viewport: opts.viewport } : {});
    await page.goto(opts.url, { waitUntil: "networkidle" });
    if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
    if (opts.selector) await page.locator(opts.selector).screenshot({ path: out });
    else await page.screenshot({ path: out, fullPage: opts.fullPage });
    return existsSync(out) ? "ok" : "error";
  } catch (e) {
    console.error(`screenshot failed: ${(e as Error).message}`);
    return "error";
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  let opts: ShotOptions;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }

  const out = opts.out ? resolve(opts.out) : join(tmpdir(), `pal-shot-${Date.now()}.png`);
  const tier = chooseTier({
    cliAvailable: playwrightCliAvailable(),
    viewport: opts.viewport,
    fullPage: opts.fullPage,
  });

  if (tier === "cli" && runViaCli(opts, out)) {
    console.log(out);
    return;
  }

  const result = await runViaNode(opts, out);
  if (result === "ok") {
    console.log(out);
    return;
  }
  if (result === "unavailable") {
    console.error("NO_PLAYWRIGHT_CLI");
    process.exit(3); // no local engine → caller falls back to Playwright MCP
  }
  process.exit(1); // engine ran but the capture failed — a real error, not an MCP case
}

await main();
