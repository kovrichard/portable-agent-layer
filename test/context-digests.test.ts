import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { writeContextDigests } from "../src/hooks/handlers/context-digests";
import { removeOnceReleased } from "./lib/remove-once-released";

const ROOT = resolve(import.meta.dir, "../.test-home-context-digests");
const GEMINI_DIR = resolve(ROOT, ".gemini");
const PLUGIN_DIR = resolve(GEMINI_DIR, "config", "plugins", "pal");
const AGENT_DIR_VARS = {
  PAL_HOME: resolve(ROOT, "home"),
  PAL_CURSOR_DIR: resolve(ROOT, ".cursor"),
  PAL_COPILOT_DIR: resolve(ROOT, ".copilot"),
  PAL_GEMINI_DIR: GEMINI_DIR,
};

beforeEach(() => {
  removeOnceReleased(ROOT);
  mkdirSync(resolve(ROOT, "home", "docs"), { recursive: true });
  writeFileSync(
    resolve(ROOT, "home", "docs", "STEERING_RULES.md"),
    "# Steer carefully\n"
  );
  Object.assign(process.env, AGENT_DIR_VARS);
});

afterEach(() => {
  for (const v of Object.keys(AGENT_DIR_VARS)) delete process.env[v];
  removeOnceReleased(ROOT);
});

describe("writeContextDigests for Antigravity", () => {
  test("writes each source as an always-on rule in the PAL plugin", () => {
    mkdirSync(PLUGIN_DIR, { recursive: true });

    writeContextDigests();

    const rule = readFileSync(resolve(PLUGIN_DIR, "rules", "pal-steering.md"), "utf-8");
    expect(rule).toBe(
      "---\ntrigger: always_on\ndescription: PAL steering rules\n---\n\n# Steer carefully"
    );
  });

  test("creates nothing when the PAL plugin is not installed", () => {
    writeContextDigests();

    expect(existsSync(GEMINI_DIR)).toBe(false);
  });
});
