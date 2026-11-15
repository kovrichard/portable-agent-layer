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
const RESET = "\x1b[0m";

let HOME: string;

function writeCacheFile(name: string, text: string): void {
  mkdirSync(resolve(HOME, ".pal", "cache"), { recursive: true });
  writeFileSync(resolve(HOME, ".pal", "cache", name), text, "utf-8");
}

function health(fields: Record<string, unknown>): void {
  writeCacheFile(
    "health.json",
    JSON.stringify({ checkedAt: new Date().toISOString(), worst: null, ...fields })
  );
}

function rejected(auth: string): void {
  writeCacheFile("login-rejected.json", JSON.stringify({ at: "2026-11-15", auth }));
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

function healthLines(output = render()): string[] {
  return output.split("\n").filter((line) => line.includes("pal cli doctor"));
}

function expectLine(colour: string, words: string): void {
  const lines = healthLines();
  expect(lines).toHaveLength(1);

  if (isWindows) {
    expect(lines[0]).toStartWith(colour);

    for (const part of words.split(" — ")) expect(lines[0]).toContain(part);
  } else {
    expect(lines[0]).toBe(`${colour}⚠️  ${words}${RESET}`);
  }
}

beforeEach(() => {
  HOME = freshTestDir(import.meta.file);
});

describe("the health line", () => {
  test("a rejected token is named in red", () => {
    rejected("token");
    expectLine(RED, "Claude token rejected — pal cli doctor");
  });

  test("a rejected native login is named in red", () => {
    rejected("native");
    expectLine(RED, "Claude login rejected — pal cli doctor");
  });

  test("a rejected login counts every failure the doctor found as more", () => {
    rejected("token");
    health({ failing: 2, warnings: 4, worst: "Something else" });
    expectLine(RED, "Claude token rejected (+2 more) — pal cli doctor");
  });

  test("a malformed rejected-login record still says the login was rejected", () => {
    writeCacheFile("login-rejected.json", "{ not json");
    expectLine(RED, "Claude login rejected — pal cli doctor");
  });

  test("one failure is named in red", () => {
    health({ failing: 1, warnings: 3, worst: "TELOS is not scaffolded" });
    expectLine(RED, "TELOS is not scaffolded — pal cli doctor");
  });

  test("more failures add how many more", () => {
    health({ failing: 3, warnings: 0, worst: "TELOS is not scaffolded" });
    expectLine(RED, "TELOS is not scaffolded (+2 more) — pal cli doctor");
  });

  test("a failure without a name still shows", () => {
    health({ failing: 1, warnings: 0 });
    expectLine(RED, "Doctor found a failure — pal cli doctor");
  });

  test("only warnings show a count in yellow", () => {
    health({ failing: 0, warnings: 3 });
    expectLine(YELLOW, "3 warnings — pal cli doctor");
  });

  test("one warning is singular", () => {
    health({ failing: 0, warnings: 1 });
    expectLine(YELLOW, "1 warning — pal cli doctor");
  });

  test("all fine shows nothing", () => {
    health({ failing: 0, warnings: 0 });
    expect(healthLines()).toEqual([]);
  });

  test("no cache files show nothing", () => {
    expect(healthLines()).toEqual([]);
  });

  test("a malformed health.json shows nothing and leaves the rest of the statusline intact", () => {
    const intact = render();
    writeCacheFile("health.json", "{ not json");
    const output = render();

    expect(healthLines(output)).toEqual([]);
    expect(output).toBe(intact);
    expect(output).toContain("[Opus]");
  });

  test("counts that are not numbers show nothing", () => {
    health({ failing: "two", warnings: "three", worst: "Broken" });
    expect(healthLines()).toEqual([]);
  });

  test("the rest of the statusline is the same with a health line as without", () => {
    const intact = render();
    health({ failing: 1, warnings: 0, worst: "Broken" });
    const withHealth = render();
    const withoutHealthLine = withHealth
      .split("\n")
      .filter((line) => !line.includes("pal cli doctor"))
      .join("\n");

    expect(withoutHealthLine).toBe(intact);
  });

  test("a label is printed as it is, never as an escape sequence", () => {
    health({ failing: 1, warnings: 0, worst: "C:\\new %s path" });
    expectLine(RED, "C:\\new %s path — pal cli doctor");
  });
});

describe("the removed pieces", () => {
  test("no hook error count and no login expiry line, whatever the log and cache say", () => {
    mkdirSync(resolve(HOME, ".pal", "debug"), { recursive: true });
    const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
    writeFileSync(
      resolve(HOME, ".pal", "debug", "debug.log"),
      `[${stamp}] ERROR rating: boom\n`,
      "utf-8"
    );
    writeCacheFile(
      "claude-login.json",
      JSON.stringify({ expiresAtEpoch: Math.floor(Date.now() / 1000) - 60 })
    );
    const output = render();

    expect(output).not.toContain("hook err");
    expect(output).not.toContain("Claude login expire");
  });
});

describe("the Windows statusline", () => {
  const ps1 = () => readFileSync(resolve(repo, "assets", "statusline.ps1"), "utf-8");

  test("mirrors the shell line's files, words and thresholds", () => {
    const source = ps1();

    expect(source).toContain('Join-Path $env:USERPROFILE ".pal\\cache"');
    expect(source).toContain('Join-Path $palCache "health.json"');
    expect(source).toContain('Join-Path $palCache "login-rejected.json"');
    expect(source).toContain('$rejectedLabel = "Claude login rejected"');
    expect(source).toContain('$rejectedLabel = "Claude token rejected"');
    expect(source).toContain('.auth -eq "token"');
    expect(source).toContain('"Doctor found a failure"');
    expect(source).toContain('"1 warning"');
    expect(source).toContain('"$healthWarnings warnings"');
    expect(source).toContain('$healthLabel += " (+$healthMore more)"');
    expect(source).toContain("$healthMore = $healthFailing - 1");
    expect(source).toContain("$healthMore = $healthFailing\n");
    expect(source).toContain(
      '$HEALTH_LINE = "! $healthLabel $([char]0x2014) pal cli doctor"'
    );
  });

  test("drops the hook error count and the login expiry line", () => {
    const source = ps1();

    expect(source).not.toContain("hook err");
    expect(source).not.toContain("debug.log");
    expect(source).not.toContain("claude-login.json");
    expect(source).not.toContain("Claude login expire");
  });
});
