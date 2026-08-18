import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import {
  copyPalDocs,
  copySkills,
  copyStatusline,
  removePalDocs,
  removeSkills,
  removeStatusline,
  scaffoldPalSettings,
  scaffoldTelos,
} from "../src/targets/lib";

const HOME = resolve(import.meta.dir, "../.test-home-targets-install");
// copySkills also symlinks into platform.agentsDir(), so PAL_AGENTS_DIR must be
// redirected too or the test writes into the developer's real ~/.agents.
const ENV = {
  PAL_HOME: HOME,
  PAL_CLAUDE_DIR: resolve(HOME, ".claude"),
  PAL_CURSOR_DIR: resolve(HOME, ".cursor"),
  PAL_COPILOT_DIR: resolve(HOME, ".copilot"),
  PAL_CODEX_DIR: resolve(HOME, ".codex"),
  PAL_AGENTS_DIR: resolve(HOME, ".agents"),
};
const saved: Record<string, string | undefined> = {};
const SCRIPT = process.platform === "win32" ? "statusline.ps1" : "statusline.sh";

beforeEach(() => {
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
  mkdirSync(HOME, { recursive: true });
  for (const [key, value] of Object.entries(ENV)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
});

afterEach(() => {
  for (const key of Object.keys(ENV)) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  if (existsSync(HOME)) rmSync(HOME, { recursive: true });
});

describe("scaffoldTelos", () => {
  test("creates the telos directory from the shipped templates", () => {
    scaffoldTelos();

    const telos = resolve(HOME, "telos");
    expect(existsSync(telos)).toBe(true);
    expect(readdirSync(telos).filter((f) => f.endsWith(".md")).length).toBeGreaterThan(0);
  });

  test("never overwrites a file the user already edited", () => {
    scaffoldTelos();
    const first = readdirSync(resolve(HOME, "telos")).find((f) => f.endsWith(".md"));
    const target = resolve(HOME, "telos", first as string);
    writeFileSync(target, "my own words");

    scaffoldTelos();

    expect(readFileSync(target, "utf-8")).toBe("my own words");
  });
});

describe("scaffoldPalSettings", () => {
  test("creates pal-settings.json from the template", () => {
    scaffoldPalSettings();

    expect(existsSync(resolve(HOME, "memory", "pal-settings.json"))).toBe(true);
  });

  test("leaves an existing settings file's own keys intact", () => {
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    const dst = resolve(HOME, "memory", "pal-settings.json");
    writeFileSync(dst, JSON.stringify({ mine: true }));

    scaffoldPalSettings();

    expect(JSON.parse(readFileSync(dst, "utf-8")).mine).toBe(true);
  });

  test("strips a deprecated PROJECTS.md entry from loadAtStartup.files", () => {
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    const dst = resolve(HOME, "memory", "pal-settings.json");
    writeFileSync(
      dst,
      JSON.stringify({
        loadAtStartup: { files: ["telos/GOALS.md", "memory/PROJECTS.md"] },
      })
    );

    scaffoldPalSettings();

    expect(JSON.parse(readFileSync(dst, "utf-8")).loadAtStartup.files).toEqual([
      "telos/GOALS.md",
    ]);
  });

  test("leaves loadAtStartup alone when nothing is deprecated", () => {
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    const dst = resolve(HOME, "memory", "pal-settings.json");
    const files = ["telos/GOALS.md", "telos/MISSION.md"];
    writeFileSync(dst, JSON.stringify({ loadAtStartup: { files } }));

    scaffoldPalSettings();

    expect(JSON.parse(readFileSync(dst, "utf-8")).loadAtStartup.files).toEqual(files);
  });

  test("survives a malformed settings file", () => {
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    const dst = resolve(HOME, "memory", "pal-settings.json");
    writeFileSync(dst, "{ not json");

    expect(() => scaffoldPalSettings()).not.toThrow();
    expect(readFileSync(dst, "utf-8")).toBe("{ not json");
  });
});

describe("PAL docs", () => {
  test("copies the shipped docs and links the agent tools", () => {
    const count = copyPalDocs();

    expect(count).toBeGreaterThan(0);
    expect(readdirSync(resolve(HOME, "docs")).length).toBe(count);
    expect(lstatSync(resolve(HOME, "tools")).isSymbolicLink()).toBe(true);
  });

  test("removes both the docs directory and the tools link", () => {
    copyPalDocs();

    removePalDocs();

    expect(existsSync(resolve(HOME, "docs"))).toBe(false);
    expect(existsSync(resolve(HOME, "tools"))).toBe(false);
  });

  test("removing when nothing was installed is harmless", () => {
    expect(() => removePalDocs()).not.toThrow();
  });
});

describe("statusline install", () => {
  test("installs the script into the claude directory", () => {
    expect(copyStatusline("claude")).toBe(true);
    expect(existsSync(resolve(ENV.PAL_CLAUDE_DIR, SCRIPT))).toBe(true);
  });

  test("installs into the cursor directory when targeted", () => {
    expect(copyStatusline("cursor")).toBe(true);
    expect(existsSync(resolve(ENV.PAL_CURSOR_DIR, SCRIPT))).toBe(true);
    expect(existsSync(resolve(ENV.PAL_CLAUDE_DIR, SCRIPT))).toBe(false);
  });

  test("defaults to the claude target", () => {
    copyStatusline();

    expect(existsSync(resolve(ENV.PAL_CLAUDE_DIR, SCRIPT))).toBe(true);
  });

  test("removes only the targeted agent's script", () => {
    copyStatusline("claude");
    copyStatusline("cursor");

    expect(removeStatusline("cursor")).toBe(true);

    expect(existsSync(resolve(ENV.PAL_CURSOR_DIR, SCRIPT))).toBe(false);
    expect(existsSync(resolve(ENV.PAL_CLAUDE_DIR, SCRIPT))).toBe(true);
  });

  test("reports success when there is nothing to remove", () => {
    expect(removeStatusline("claude")).toBe(true);
  });
});

describe("shipped skills", () => {
  test("links every shipped skill into both the PAL store and the agent dir", () => {
    const claudeSkills = resolve(ENV.PAL_CLAUDE_DIR, "skills");

    const count = copySkills(claudeSkills);

    expect(count).toBeGreaterThan(0);
    expect(readdirSync(resolve(HOME, "skills"))).toHaveLength(count);
    expect(readdirSync(claudeSkills)).toHaveLength(count);
    expect(
      lstatSync(resolve(claudeSkills, readdirSync(claudeSkills)[0])).isSymbolicLink()
    ).toBe(true);
  });

  test("links the agents skills directory at the PAL store", () => {
    copySkills(resolve(ENV.PAL_CLAUDE_DIR, "skills"));

    expect(lstatSync(resolve(ENV.PAL_AGENTS_DIR, "skills")).isSymbolicLink()).toBe(true);
  });

  test("is idempotent across repeated installs", () => {
    const claudeSkills = resolve(ENV.PAL_CLAUDE_DIR, "skills");
    const first = copySkills(claudeSkills);

    expect(copySkills(claudeSkills)).toBe(first);
    expect(readdirSync(claudeSkills)).toHaveLength(first);
  });

  test("removes what it linked and names each skill", () => {
    const claudeSkills = resolve(ENV.PAL_CLAUDE_DIR, "skills");
    const count = copySkills(claudeSkills);

    const removed = removeSkills(claudeSkills);

    expect(removed).toHaveLength(count);
    expect(readdirSync(claudeSkills)).toHaveLength(0);
    expect(readdirSync(resolve(HOME, "skills"))).toHaveLength(0);
  });
});
