import { beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, dirname, resolve } from "node:path";
import { linkFile } from "./lib/links";
import { runSync } from "./lib/run";
import { freshTestDir } from "./lib/test-home";

const CLI = resolve(import.meta.dir, "../src/cli/index.ts");
let SANDBOX: string;
const at = (...parts: string[]) => resolve(SANDBOX, ...parts);

function write(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
}

const removedHook = () =>
  `bun run ${at("old", "src", "hooks", "PostToolOrchestrator.ts")}`;

function plantLeftovers(): void {
  write(at("home", "memory", "pal-settings.json"), {
    identity: { ai: { name: "A" }, principal: { name: "P" } },
    loadAtStartup: { _docs: "old", files: ["~/.pal/PROJECTS.md"] },
    dynamicContext: { learningDigest: true },
  });
  write(at("home", "debug", "debug.log.prev"), "[2026-01-01 00:00:00] INFO old: line\n");
  write(at(".claude", "settings.json"), {
    permissions: { allow: ["Read(//*)", "Grep(//*)", "Glob(//*)"] },
    hooks: { PostToolUse: [{ hooks: [{ type: "command", command: removedHook() }] }] },
  });
  write(at(".opencode", "plugins", "pai-plugin.ts"), "// old plugin name\n");
  write(at("home", "AGENTS.md"), "# agents\n");
  mkdirSync(at(".copilot"), { recursive: true });
  linkFile(at("home", "AGENTS.md"), at(".copilot", "copilot-instructions.md"));
}

function fakeClaudeOnPath(): string {
  const bin = at("bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(resolve(bin, "claude"), "#!/bin/sh\necho 1.0.0\n");
  chmodSync(resolve(bin, "claude"), 0o755);
  return [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter);
}

function pal(...args: string[]) {
  const { PAL_SKIP_DOCTOR: _skip, ...env } = process.env;
  return runSync(["bun", "run", CLI, "cli", ...args], {
    env: {
      ...env,
      PATH: fakeClaudeOnPath(),
      PAL_HOME: at("home"),
      PAL_SKIP_BROWSER_INSTALL: "1",
      PAL_CLAUDE_DIR: at(".claude"),
      PAL_OPENCODE_DIR: at(".opencode"),
      PAL_CURSOR_DIR: at(".cursor"),
      PAL_COPILOT_DIR: at(".copilot"),
      PAL_CODEX_DIR: at(".codex"),
      PAL_GEMINI_DIR: at(".gemini"),
      PAL_AGENTS_DIR: at(".agents"),
    },
    timeout: 60000,
  });
}

const json = (path: string) => JSON.parse(readFileSync(path, "utf-8"));
let doctorIds: string[];

beforeAll(() => {
  SANDBOX = freshTestDir(import.meta.file);
  plantLeftovers();
  pal("install", "--claude");
  const report = JSON.parse(pal("doctor", "--json").stdout);
  doctorIds = report.findings
    .filter((f: { severity: string }) => f.severity === "fail" || f.severity === "warn")
    .map((f: { id: string }) => f.id);
}, 120000);

describe.skipIf(process.platform === "win32")(
  "one install removes what older versions left",
  () => {
    test("settings keys and startup files PAL no longer reads", () => {
      const settings = json(at("home", "memory", "pal-settings.json"));
      expect(settings.dynamicContext.learningDigest).toBeUndefined();
      expect(settings.loadAtStartup._docs).toBeUndefined();
      expect(settings.loadAtStartup.files).toEqual([]);
    });

    test("Claude Code permission rules and hooks that no longer apply", () => {
      const settings = json(at(".claude", "settings.json"));
      expect(settings.permissions.allow).not.toContain("Grep(//*)");
      expect(settings.permissions.allow).not.toContain("Glob(//*)");
      expect(JSON.stringify(settings.hooks)).not.toContain("PostToolOrchestrator");
    });

    test("files under names PAL no longer uses", () => {
      expect(existsSync(at(".opencode", "plugins", "pai-plugin.ts"))).toBe(false);
      expect(existsSync(at(".copilot", "copilot-instructions.md"))).toBe(false);
      expect(existsSync(at("home", "debug", "debug.log.prev"))).toBe(false);
      expect(existsSync(at("home", "debug", "debug.log.1"))).toBe(true);
    });

    test("the doctor finds nothing left to migrate or clean", () => {
      expect(
        doctorIds.filter((id) =>
          /^migration\.|^settings\.unknown|hooks\.scripts/.test(id)
        )
      ).toEqual([]);
    });
  }
);
