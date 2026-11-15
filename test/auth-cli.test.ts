import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { describeLogin, runAuth } from "../src/cli/auth";
import { loginCacheFile, readLoginCache } from "../src/hooks/lib/login-cache";
import { debugHome } from "./lib/fake-spawn";
import {
  cachedLogin,
  fakeClaudeOnPath,
  fakeRunner,
  NOW,
  statusJson,
} from "./lib/login-fixture";

let out: string[] = [];
let err: string[] = [];
let spies: ReturnType<typeof spyOn>[] = [];

beforeEach(() => {
  for (const spy of spies) spy.mockRestore();
  const { home } = debugHome(import.meta.file);
  fakeClaudeOnPath(home);
  out = [];
  err = [];
  spies = [
    spyOn(console, "log").mockImplementation((...a) => out.push(a.join(" "))),
    spyOn(console, "error").mockImplementation((...a) => err.push(a.join(" "))),
  ];
});

const DAY_MS = 24 * 3600 * 1000;
const cached = cachedLogin({ checkedAt: "2026-11-15T08:00:00.000Z" });

function writeCache(text: string): void {
  writeFileSync(loginCacheFile(), text, "utf-8");
}

describe("pal cli auth", () => {
  test("prints the cached answer in words and runs nothing", () => {
    writeCache(JSON.stringify(cached));
    const { run, calls } = fakeRunner({ stdout: statusJson() });

    expect(runAuth({}, "claude", run, NOW)).toBe(0);
    expect(out).toEqual([
      "claude: logged in (claude.ai); login expires on 2026-12-05T15:52:29.450Z, 20 days left",
    ]);
    expect(calls).toEqual([]);
  });

  test("with no cache yet, reads from the agent and writes the cache", () => {
    expect(runAuth({}, "claude", fakeRunner({ stdout: statusJson() }).run, NOW)).toBe(0);

    expect(out).toEqual([
      "claude: logged in (claude.ai); login expires on 2026-12-05T15:52:29.450Z, 20 days left",
    ]);
    expect(readLoginCache()).toEqual(cachedLogin());
  });

  test("--refresh reads from the agent and rewrites the cache", () => {
    writeCache(JSON.stringify(cached));
    const { run, calls } = fakeRunner({ stdout: statusJson() });

    expect(runAuth({ refresh: true }, "claude", run, NOW)).toBe(0);
    expect(calls).toHaveLength(1);
    expect(readLoginCache()).toEqual(cachedLogin());
  });

  test("--json prints the cache object", () => {
    writeCache(JSON.stringify(cached));

    expect(runAuth({ json: true }, "claude", fakeRunner({}).run, NOW)).toBe(0);
    expect(JSON.parse(out.join("\n"))).toEqual(cached);
    expect(out.join("\n")).toBe(JSON.stringify(cached, null, 2));
  });

  test("a failing agent call says so on stderr, exits 1 and keeps the cache", () => {
    const before = JSON.stringify(cached);
    writeCache(before);

    expect(runAuth({ refresh: true }, "claude", fakeRunner({ code: 2 }).run, NOW)).toBe(
      1
    );
    expect(err).toEqual(["claude: claude auth status exited with 2"]);
    expect(out).toEqual([]);
    expect(readFileSync(loginCacheFile(), "utf-8")).toBe(before);
  });

  test("another agent does not report an expiry, and --json prints null", () => {
    writeCache(JSON.stringify(cached));
    const { run, calls } = fakeRunner({ stdout: statusJson() });

    expect(runAuth({}, "codex", run, NOW)).toBe(0);
    expect(runAuth({ json: true }, "codex", run, NOW)).toBe(0);
    expect(out).toEqual([
      "codex: this agent does not report when its login expires",
      "null",
    ]);
    expect(calls).toEqual([]);
  });
});

describe("the words for a login", () => {
  const known = (fields: Parameters<typeof cachedLogin>[0]) =>
    describeLogin("claude", { kind: "known", login: cachedLogin(fields) }, NOW);
  const epochIn = (ms: number) => Math.floor((NOW.getTime() + ms) / 1000);

  test("under a day left is counted in hours", () => {
    expect(known({ expiresAtEpoch: epochIn(5.5 * 3600 * 1000) })).toEndWith(
      ", 5 hours left"
    );
  });

  test("exactly one day left is counted in days", () => {
    expect(known({ expiresAtEpoch: epochIn(DAY_MS) })).toEndWith(", 1 days left");
  });

  test("an expiry now or in the past is expired", () => {
    expect(known({ expiresAtEpoch: epochIn(0) })).toBe(
      "claude: logged in (claude.ai); login expired on 2026-12-05T15:52:29.450Z"
    );
    expect(known({ expiresAtEpoch: epochIn(-DAY_MS) })).toContain("login expired on");
  });

  test("no expiry says the agent does not report one", () => {
    const words =
      "claude: logged in (claude.ai); this agent does not report when its login expires";

    expect(known({ expiresAt: null, expiresAtEpoch: null })).toBe(words);
    expect(known({ expiresAt: null })).toBe(words);
    expect(known({ expiresAtEpoch: null })).toBe(words);
  });

  test("a logged-out login says so", () => {
    expect(known({ loggedIn: false })).toStartWith("claude: not logged in; ");
  });
});
