import { beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { assets } from "../src/core/paths";
import { capturingLog } from "../src/targets/log";
import { copyPalDocs, removePalDocs } from "../src/targets/pal-docs";
import { scaffoldPalSettings, scaffoldTelos } from "../src/targets/scaffold";
import { copySkills, removeSkills } from "../src/targets/skills";
import {
  installStatusline,
  removeStatusline,
  statuslineLauncher,
} from "../src/targets/statusline";
import { removeOnceReleased } from "./lib/remove-once-released";
import { testHome } from "./lib/test-home";

const HOME = testHome(import.meta.file);
// copySkills also symlinks into platform.agentsDir(), so PAL_AGENTS_DIR must be
// redirected too or the test writes into the developer's real ~/.agents.
const ENV = {
  PAL_HOME: HOME,
  PAL_CLAUDE_DIR: resolve(HOME, ".claude"),
  PAL_CURSOR_DIR: resolve(HOME, ".cursor"),
  PAL_COPILOT_DIR: resolve(HOME, ".copilot"),
  PAL_CODEX_DIR: resolve(HOME, ".codex"),
  PAL_GEMINI_DIR: resolve(HOME, ".gemini"),
  PAL_AGENTS_DIR: resolve(HOME, ".agents"),
};
const SCRIPT = process.platform === "win32" ? "statusline.ps1" : "statusline.sh";
const packageStatusline = () =>
  process.platform === "win32"
    ? assets.statuslineScriptPs1()
    : assets.statuslineScriptBash();

beforeEach(() => {
  removeOnceReleased(HOME);
  mkdirSync(HOME, { recursive: true });

  for (const [key, value] of Object.entries(ENV)) {
    process.env[key] = value;
  }
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
  test("a new home gets settings.json at its root, from the template", () => {
    scaffoldPalSettings();

    expect(existsSync(resolve(HOME, "settings.json"))).toBe(true);
    expect(existsSync(resolve(HOME, "memory", "pal-settings.json"))).toBe(false);
  });

  test("a home whose settings have not moved gets no second copy", () => {
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    writeFileSync(resolve(HOME, "memory", "pal-settings.json"), "{}");

    scaffoldPalSettings();

    expect(existsSync(resolve(HOME, "settings.json"))).toBe(false);
  });

  test("leaves an existing settings file's own keys intact", () => {
    mkdirSync(resolve(HOME, "memory"), { recursive: true });
    const dst = resolve(HOME, "memory", "pal-settings.json");
    writeFileSync(dst, JSON.stringify({ mine: true }));

    scaffoldPalSettings();

    expect(JSON.parse(readFileSync(dst, "utf-8")).mine).toBe(true);
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
    expect(installStatusline("claude")).toBe(true);
    expect(existsSync(resolve(ENV.PAL_CLAUDE_DIR, SCRIPT))).toBe(true);
  });

  test("installs into the cursor directory when targeted", () => {
    expect(installStatusline("cursor")).toBe(true);
    expect(existsSync(resolve(ENV.PAL_CURSOR_DIR, SCRIPT))).toBe(true);
    expect(existsSync(resolve(ENV.PAL_CLAUDE_DIR, SCRIPT))).toBe(false);
  });

  test("defaults to the claude target", () => {
    installStatusline();

    expect(existsSync(resolve(ENV.PAL_CLAUDE_DIR, SCRIPT))).toBe(true);
  });

  test("removes only the targeted agent's script", () => {
    installStatusline("claude");
    installStatusline("cursor");

    expect(removeStatusline("cursor")).toBe(true);

    expect(existsSync(resolve(ENV.PAL_CURSOR_DIR, SCRIPT))).toBe(false);
    expect(existsSync(resolve(ENV.PAL_CLAUDE_DIR, SCRIPT))).toBe(true);
  });

  test("reports success when there is nothing to remove", () => {
    expect(removeStatusline("claude")).toBe(true);
  });

  test("writes a launcher for the package's script, not a copy", () => {
    installStatusline("claude");

    const installed = readFileSync(resolve(ENV.PAL_CLAUDE_DIR, SCRIPT), "utf-8");
    expect(installed).toBe(statuslineLauncher(packageStatusline()));
  });

  test("warns and reports failure when the launcher cannot be written", async () => {
    mkdirSync(resolve(ENV.PAL_CLAUDE_DIR, SCRIPT), { recursive: true });
    const logged: string[] = [];

    const installed = await capturingLog(
      (_level, message) => logged.push(message),
      async () => installStatusline("claude")
    );

    expect(installed).toBe(false);
    expect(logged.join("\n")).toContain("Failed to install statusline script");
  });
});

describe("statusline launcher", () => {
  const header = "# PAL status line: runs the package's script, rewritten on install";

  test("on macOS and Linux it execs the package's bash script", () => {
    expect(statuslineLauncher("/pkg/assets/statusline.sh", "darwin")).toBe(
      `#!/bin/bash\n${header}\nexec bash '/pkg/assets/statusline.sh'\n`
    );
  });

  test("on Windows it pipes its input into the package's PowerShell script", () => {
    expect(statuslineLauncher("C:\\pkg\\assets\\statusline.ps1", "win32")).toBe(
      `${header}\r\n$input | & 'C:\\pkg\\assets\\statusline.ps1'\r\n`
    );
  });

  test("escapes a single quote in the path for bash", () => {
    expect(statuslineLauncher("/o'neil/statusline.sh", "linux")).toContain(
      `exec bash '/o'\\''neil/statusline.sh'`
    );
  });

  test("escapes a single quote in the path for PowerShell", () => {
    expect(statuslineLauncher("C:\\o'neil\\statusline.ps1", "win32")).toContain(
      `& 'C:\\o''neil\\statusline.ps1'`
    );
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

  test("removes the agent's links and names each skill", () => {
    const claudeSkills = resolve(ENV.PAL_CLAUDE_DIR, "skills");
    const count = copySkills(claudeSkills);

    const removed = removeSkills(claudeSkills);

    expect(removed).toHaveLength(count);
    expect(readdirSync(claudeSkills)).toHaveLength(0);
  });

  test.skipIf(process.platform === "win32")(
    "a skill it cannot link is an error naming the skill, and the rest still run",
    async () => {
      const store = resolve(HOME, "skills");
      mkdirSync(store, { recursive: true });
      chmodSync(store, 0o500);
      const logged: { level: string; message: string }[] = [];

      try {
        const count = await capturingLog(
          (level, message) => logged.push({ level, message }),
          async () => copySkills(resolve(ENV.PAL_CLAUDE_DIR, "skills"))
        );
        expect(count).toBe(0);
      } finally {
        chmodSync(store, 0o700);
      }

      const errors = logged.filter((entry) => entry.level === "error");
      expect(errors.length).toBeGreaterThan(1);
      expect(errors[0]?.message).toMatch(/^Could not install skill \S+ — \S/);
    }
  );

  test("a missing skills folder is an error naming the folder", () => {
    const savedPkg = process.env.PAL_PKG;
    process.env.PAL_PKG = HOME;

    try {
      expect(() => copySkills(resolve(ENV.PAL_CLAUDE_DIR, "skills"))).toThrow(
        `PAL's skills folder is missing: ${resolve(HOME, "assets", "skills")}`
      );
    } finally {
      if (savedPkg === undefined) delete process.env.PAL_PKG;
      else process.env.PAL_PKG = savedPkg;
    }
  });

  test("keeps the shared skill store other agents link through", () => {
    const count = copySkills(resolve(ENV.PAL_CLAUDE_DIR, "skills"));

    removeSkills(resolve(ENV.PAL_CURSOR_DIR, "skills"));

    expect(readdirSync(resolve(HOME, "skills"))).toHaveLength(count);
    expect(lstatSync(resolve(ENV.PAL_AGENTS_DIR, "skills")).isSymbolicLink()).toBe(true);
  });
});
