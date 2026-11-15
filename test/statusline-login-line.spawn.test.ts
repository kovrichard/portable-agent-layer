import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { POWERSHELL_SPAWN_TEST_MS, SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

const isWindows = process.platform === "win32";
setDefaultTimeout(isWindows ? POWERSHELL_SPAWN_TEST_MS : SPAWN_HEAVY_TEST_MS);

const repo = resolve(import.meta.dir, "..");
const SESSION_JSON = JSON.stringify({
  model: { display_name: "Opus" },
  workspace: { current_dir: "/tmp" },
});
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";

let HOME: string;

function writeCache(text: string): void {
  mkdirSync(resolve(HOME, ".pal", "cache"), { recursive: true });
  writeFileSync(resolve(HOME, ".pal", "cache", "claude-login.json"), text, "utf-8");
}

function cacheExpiringIn(seconds: number): void {
  writeCache(
    JSON.stringify({
      checkedAt: new Date().toISOString(),
      loggedIn: true,
      authMethod: "claude.ai",
      expiresAt: "2026-12-05T15:52:29.450Z",
      expiresAtEpoch: Math.floor(Date.now() / 1000) + seconds,
    })
  );
}

function render(): string {
  const env = { ...process.env, HOME, USERPROFILE: HOME, DARK_FACTORY_HOME: "" };
  const run = isWindows
    ? spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve(repo, "assets", "statusline.ps1"),
        ],
        { input: SESSION_JSON, encoding: "utf-8", env }
      )
    : spawnSync("bash", [resolve(repo, "assets", "statusline.sh")], {
        input: SESSION_JSON,
        encoding: "utf-8",
        env,
      });

  return run.stdout ?? "";
}

function loginLines(): string[] {
  return render()
    .split("\n")
    .filter((line) => line.includes("Claude login"));
}

function withoutNonAscii(text: string): string[] {
  return text.split(/[^\x20-\x7e]+/).filter((part) => part.trim());
}

function expectLine(colour: string, words: string): void {
  const lines = loginLines();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toStartWith(colour);

  if (isWindows) {
    for (const part of withoutNonAscii(words)) expect(lines[0]).toContain(part.trim());
  } else {
    expect(lines[0]).toBe(`${colour}🔑 ${words}\x1b[0m`);
  }
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 24 * HOUR;

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
});

describe("the Claude login line", () => {
  test("more than 7 days left shows nothing", () => {
    cacheExpiringIn(20 * DAY);
    expect(loginLines()).toEqual([]);
  });

  test("7 days or fewer left warns in days", () => {
    cacheExpiringIn(3 * DAY + 5 * MINUTE);
    expectLine(YELLOW, "Claude login expires in 3d");
  });

  test("the warning starts at 7 days left", () => {
    cacheExpiringIn(7 * DAY - MINUTE);
    expectLine(YELLOW, "Claude login expires in 6d");
    cacheExpiringIn(7 * DAY + 5 * MINUTE);
    expect(loginLines()).toEqual([]);
  });

  test("under a day left warns in hours", () => {
    cacheExpiringIn(5 * HOUR + 5 * MINUTE);
    expectLine(YELLOW, "Claude login expires in 5h");
  });

  test("an expired login says how to log in again, in the error colour", () => {
    cacheExpiringIn(-HOUR);
    expectLine(RED, "Claude login expired — run: claude auth login");
  });

  test("no cache file shows nothing", () => {
    expect(loginLines()).toEqual([]);
  });

  test("a null epoch shows nothing", () => {
    writeCache(
      JSON.stringify({ checkedAt: new Date().toISOString(), expiresAtEpoch: null })
    );
    expect(loginLines()).toEqual([]);
  });

  test("a malformed cache shows nothing and leaves the rest of the line intact", () => {
    writeCache("{ not json");
    const output = render();
    expect(output).not.toContain("Claude login");
    expect(output).toContain("[Opus]");
    writeCache(JSON.stringify({ expiresAtEpoch: "soon" }));
    expect(loginLines()).toEqual([]);
  });
});

describe("the Windows statusline", () => {
  test("mirrors the shell line's cache, thresholds and words", () => {
    const ps1 = readFileSync(resolve(repo, "assets", "statusline.ps1"), "utf-8");
    expect(ps1).toContain('".pal\\cache\\claude-login.json"');
    expect(ps1).toContain("ConvertFromUtf32(0x1F511)");
    expect(ps1).toContain("Claude login expired $([char]0x2014) run: claude auth login");
    expect(ps1).toContain("Claude login expires in $([math]::Floor($loginLeft / 3600))h");
    expect(ps1).toContain(
      "Claude login expires in $([math]::Floor($loginLeft / 86400))d"
    );
    expect(ps1).toContain("$loginLeft -lt 86400");
    expect(ps1).toContain("$loginLeft -le 604800");
    expect(ps1).toContain("$loginLeft -le 0");
  });
});
