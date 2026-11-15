import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { collectExportFiles } from "../src/core/export";
import { paths } from "../src/core/paths";
import { claudeLoginFrom, readAgentLogin } from "../src/inference/agent-login";
import {
  isLoginCacheStale,
  loginCacheFile,
  readLoginCache,
  refreshLogin,
  refreshLoginOnStart,
} from "../src/inference/login-cache";
import { debugHome } from "./lib/fake-spawn";
import {
  cachedLogin,
  EXPIRES_AT,
  EXPIRES_AT_EPOCH,
  fakeClaudeOnPath,
  fakeRunner,
  NOW,
  statusJson,
} from "./lib/login-fixture";

let home = { home: "", log: () => "" };
let claude = "";

beforeEach(() => {
  home = debugHome(import.meta.file);
  claude = fakeClaudeOnPath(home.home);
});

const hoursBefore = (hours: number) =>
  new Date(NOW.getTime() - hours * 3600 * 1000).toISOString();

function writeCache(text: string): void {
  writeFileSync(loginCacheFile(), text, "utf-8");
}

describe("reading the Claude login", () => {
  test("valid status JSON becomes the cache object with the expiry in seconds", () => {
    const { run, calls } = fakeRunner({ stdout: statusJson() });

    expect(readAgentLogin("claude", run, NOW)).toEqual({
      kind: "known",
      login: {
        checkedAt: NOW.toISOString(),
        loggedIn: true,
        authMethod: "claude.ai",
        expiresAt: EXPIRES_AT,
        expiresAtEpoch: EXPIRES_AT_EPOCH,
      },
    });
    expect(calls).toEqual([{ argv: [claude, "auth", "status"], timeoutMs: 2000 }]);
  });

  test("a missing loginExpiresAt gives null expiry fields", () => {
    const login = claudeLoginFrom(statusJson({ loginExpiresAt: undefined }), NOW);

    expect(login?.expiresAt).toBeNull();
    expect(login?.expiresAtEpoch).toBeNull();
  });

  test("an unreadable loginExpiresAt gives null expiry fields", () => {
    const login = claudeLoginFrom(statusJson({ loginExpiresAt: "soon" }), NOW);

    expect(login?.expiresAt).toBeNull();
    expect(login?.expiresAtEpoch).toBeNull();
  });

  test("a logged-out status keeps loggedIn false and a missing method as null", () => {
    const login = claudeLoginFrom(
      statusJson({ loggedIn: false, authMethod: undefined }),
      NOW
    );

    expect(login?.loggedIn).toBe(false);
    expect(login?.authMethod).toBeNull();
  });

  test.each([
    ["not JSON", "Logged in as someone"],
    ["JSON without loggedIn", JSON.stringify({ authMethod: "claude.ai" })],
    ["a JSON string", JSON.stringify("loggedIn")],
    ["JSON null", "null"],
  ])("%s is not a login", (_name, stdout) => {
    expect(claudeLoginFrom(stdout, NOW)).toBeNull();
  });

  test("a non-Claude agent is unknown and nothing runs", () => {
    const { run, calls } = fakeRunner({ stdout: statusJson() });

    expect(readAgentLogin("codex", run, NOW)).toEqual({ kind: "unknown" });
    expect(calls).toEqual([]);
  });

  test("claude missing from PATH is a failure and nothing runs", () => {
    process.env.PATH = resolve(home.home, "empty");
    const { run, calls } = fakeRunner({ stdout: statusJson() });

    expect(readAgentLogin("claude", run, NOW)).toEqual({
      kind: "failed",
      reason: "claude is not on PATH",
    });
    expect(calls).toEqual([]);
  });
});

describe("the login cache", () => {
  test("a refresh writes the login to cache/claude-login.json", () => {
    const { run } = fakeRunner({ stdout: statusJson() });
    refreshLogin("claude", run, NOW);

    expect(loginCacheFile()).toBe(resolve(home.home, "cache", "claude-login.json"));
    expect(JSON.parse(readFileSync(loginCacheFile(), "utf-8"))).toEqual(cachedLogin());
    expect(readdirSync(paths.cache())).toEqual(["claude-login.json"]);
  });

  test.each([
    ["a non-zero exit", { code: 1, stdout: statusJson() }, "exited with 1"],
    ["a timeout", { code: null, stdout: "", timedOut: true }, "timed out"],
    ["output that is not JSON", { stdout: "Logged in" }, "did not print the expected"],
  ])("%s leaves the cache untouched and fails", (_name, reply, reason) => {
    const before = JSON.stringify(cachedLogin({ checkedAt: hoursBefore(30) }));
    writeCache(before);
    const read = refreshLogin("claude", fakeRunner(reply).run, NOW);

    expect(read.kind).toBe("failed");
    expect(read.kind === "failed" && read.reason).toContain(
      `claude auth status ${reason}`
    );
    expect(readFileSync(loginCacheFile(), "utf-8")).toBe(before);
  });

  test("an unknown agent writes no cache", () => {
    refreshLogin("cursor", fakeRunner({ stdout: statusJson() }).run, NOW);

    expect(existsSync(loginCacheFile())).toBe(false);
  });

  test("a cache 23 hours old is fresh and one 25 hours old is stale", () => {
    expect(isLoginCacheStale(cachedLogin({ checkedAt: hoursBefore(23) }), NOW)).toBe(
      false
    );
    expect(isLoginCacheStale(cachedLogin({ checkedAt: hoursBefore(25) }), NOW)).toBe(
      true
    );
  });

  test("exactly 24 hours old is still fresh", () => {
    expect(isLoginCacheStale(cachedLogin({ checkedAt: hoursBefore(24) }), NOW)).toBe(
      false
    );
  });

  test("no cache, or one with an unreadable time, is stale", () => {
    expect(isLoginCacheStale(null, NOW)).toBe(true);
    expect(isLoginCacheStale(cachedLogin({ checkedAt: "yesterday" }), NOW)).toBe(true);
  });

  test("a malformed or incomplete cache file reads as no cache", () => {
    writeCache("{ half");
    expect(readLoginCache()).toBeNull();
    writeCache(JSON.stringify({ loggedIn: true }));
    expect(readLoginCache()).toBeNull();
    writeCache("null");
    expect(readLoginCache()).toBeNull();
  });

  test("the cache folder is not part of an export", () => {
    writeCache(JSON.stringify(cachedLogin()));

    expect(existsSync(loginCacheFile())).toBe(true);
    expect(collectExportFiles().filter((file) => file.includes("claude-login"))).toEqual(
      []
    );
  });
});

describe("the refresh at session start", () => {
  function printedDuring(work: () => void): unknown[] {
    const printed: unknown[] = [];
    const spies = [
      spyOn(console, "log").mockImplementation((...a) => printed.push(a)),
      spyOn(process.stdout, "write").mockImplementation((chunk) => {
        printed.push(chunk);

        return true;
      }),
    ];

    try {
      work();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }

    return printed;
  }

  test("a stale cache is refreshed", () => {
    writeCache(JSON.stringify(cachedLogin({ checkedAt: hoursBefore(25) })));
    const { run, calls } = fakeRunner({ stdout: statusJson() });
    refreshLoginOnStart("claude", run, NOW);

    expect(calls).toHaveLength(1);
    expect(readLoginCache()).toEqual(cachedLogin());
  });

  test("a missing cache is written", () => {
    refreshLoginOnStart("claude", fakeRunner({ stdout: statusJson() }).run, NOW);

    expect(readLoginCache()).toEqual(cachedLogin());
  });

  test("a fresh cache is left alone and nothing runs", () => {
    const fresh = JSON.stringify(cachedLogin({ checkedAt: hoursBefore(1) }));
    writeCache(fresh);
    const { run, calls } = fakeRunner({ stdout: statusJson() });
    refreshLoginOnStart("claude", run, NOW);

    expect(calls).toEqual([]);
    expect(readFileSync(loginCacheFile(), "utf-8")).toBe(fresh);
  });

  test("another agent runs nothing", () => {
    const { run, calls } = fakeRunner({ stdout: statusJson() });
    refreshLoginOnStart("opencode", run, NOW);

    expect(calls).toEqual([]);
  });

  test("a failing agent call does not throw, prints nothing and is logged", () => {
    const run = fakeRunner({ code: 1 }).run;

    expect(printedDuring(() => refreshLoginOnStart("claude", run, NOW))).toEqual([]);
    expect(home.log()).toContain("ERROR login-refresh: claude auth status exited with 1");
  });

  test("a runner that throws is swallowed and logged", () => {
    const run = fakeRunner(() => {
      throw new Error("spawn exploded");
    }).run;

    expect(printedDuring(() => refreshLoginOnStart("claude", run, NOW))).toEqual([]);
    expect(home.log()).toContain("ERROR login-refresh: spawn exploded");
  });
});
