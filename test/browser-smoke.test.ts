import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Actually launches a browser, which no other test does.
 *
 * This exists because chromium.launch once hung under Bun on Windows, and the
 * workaround — running the tool under Node via a compiled .mjs — outlived the bug
 * by months precisely because nothing exercised the real launch. A unit test over
 * tier selection cannot catch that class of failure; only starting a browser can.
 *
 * Opt-in rather than skip-if-missing: a guard that quietly passes when Chromium is
 * absent would recreate exactly the blindness this test exists to remove. CI sets
 * the flag and installs the browser, so a missing Chromium there is a failure, not
 * a silent skip.
 */
const ENABLED = process.env.PAL_BROWSER_SMOKE === "1";

const SHOT = resolve(import.meta.dir, "../assets/skills/playwright/tools/shot.ts");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

let DIR: string;

beforeAll(() => {
  DIR = mkdtempSync(resolve(tmpdir(), "pal-browser-smoke-"));
});

afterAll(() => {
  if (DIR) rmSync(DIR, { recursive: true, force: true });
});

describe.skipIf(!ENABLED)("browser smoke", () => {
  test("launches a browser under bun and writes a real PNG", () => {
    const page = resolve(DIR, "probe.html");
    const out = resolve(DIR, "probe.png");
    writeFileSync(
      page,
      '<!doctype html><meta charset="utf-8"><body style="background:#0b1020">' +
        '<h1 style="color:#8ef;font:600 40px system-ui">pal browser smoke</h1></body>'
    );

    // --viewport forces the in-process Playwright tier: without it the tool prefers
    // a system playwright-cli when one is on PATH, and the launch under test would
    // never happen.
    const res = spawnSync(
      "bun",
      [SHOT, pathToFileURL(page).href, "--viewport", "640x360", "-o", out],
      { encoding: "utf-8", timeout: 120_000 }
    );

    expect(res.stdout + res.stderr).not.toContain("NO_PLAYWRIGHT_CLI");
    expect(res.status).toBe(0);

    const png = readFileSync(out);
    expect(png.subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(png.byteLength).toBeGreaterThan(1000);
  }, 150_000);
});
