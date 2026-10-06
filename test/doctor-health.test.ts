import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  hookErrorFindings,
  migrationFindings,
  updateFinding,
} from "../src/cli/doctor/health";
import {
  apiKeyFindings,
  cursorPlanFinding,
  leakedEnvFindings,
  oauthTokenFindings,
  routeFinding,
} from "../src/cli/doctor/inference";
import { palEnvPath } from "../src/hooks/lib/pal-env";

const NOW = Date.parse("2026-10-04T19:00:00Z");
const MINUTE = 60_000;
const at = (minutesAgo: number) => NOW - minutesAgo * MINUTE;
const noToken = { now: NOW };

describe("hook errors", () => {
  test("one warning per failing hook, with its count and newest message", () => {
    const findings = hookErrorFindings(
      [
        { source: "rating", count: 3, last: "timed out", lastAt: at(5) },
        { source: "agenda", count: 1, last: "bad json", lastAt: at(5) },
      ],
      noToken
    );

    expect(findings.map((f) => f.id)).toEqual([
      "hook-errors.rating",
      "hook-errors.agenda",
    ]);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].title).toContain("3 times");
    expect(findings[0].title).toContain("timed out");
  });

  test("says how long ago the newest failure was, so a fixed one reads as old", () => {
    const title = (minutesAgo: number) =>
      hookErrorFindings(
        [{ source: "rating", count: 1, last: "boom", lastAt: at(minutesAgo) }],
        noToken
      )[0].title;

    expect(title(45)).toContain("last 45m ago");
    expect(title(150)).toContain("last 2h ago");
  });

  test("no errors passes", () => {
    expect(hookErrorFindings([], noToken)[0].severity).toBe("ok");
  });

  const expiredLogin = {
    source: "inference",
    count: 38,
    last: "Failed to authenticate: OAuth session expired and could not be refreshed",
    lastAt: at(75),
  };

  const rejectedBy = (auth: string) => ({
    ...expiredLogin,
    lastMessage: `caller=rating sessionId=s1 auth=${auth} exited=1 binary=claude`,
  });

  test("an expired native login fails and says to log in again, never mentioning a token", () => {
    const [finding] = hookErrorFindings([rejectedBy("native")], noToken);

    expect(finding.severity).toBe("fail");
    expect(finding.title).toContain("38");
    expect(finding.fix?.command).toBe("claude auth login");
    expect(finding.fix?.say).not.toContain("TOKEN");
  });

  test("a line logged before spawns were tagged reads as the native login", () => {
    const [finding] = hookErrorFindings([expiredLogin], noToken);
    expect(finding.fix?.command).toBe("claude auth login");
  });

  test("a rejected token warns and says to renew it", () => {
    const [finding] = hookErrorFindings([rejectedBy("token")], noToken);

    expect(finding.severity).toBe("warn");
    expect(finding.title).toContain("last 1h ago");
    expect(finding.fix?.command).toBe("claude setup-token");
    expect(finding.fix?.say).toContain("CLAUDE_CODE_OAUTH_TOKEN was rejected");
  });
});

describe("the optional CLAUDE_CODE_OAUTH_TOKEN", () => {
  test("says nothing when no token is set anywhere", () => {
    expect(oauthTokenFindings({}, {})).toEqual([]);
  });

  test("a well-formed token passes, from the shell or from the file", () => {
    expect(oauthTokenFindings({ CLAUDE_CODE_OAUTH_TOKEN: "abc" }, {})[0].severity).toBe(
      "ok"
    );
    expect(oauthTokenFindings({}, { CLAUDE_CODE_OAUTH_TOKEN: "abc" })[0].severity).toBe(
      "ok"
    );
  });

  test.each([
    ["empty in the file", {}, { CLAUDE_CODE_OAUTH_TOKEN: "" }],
    ["empty in the shell", { CLAUDE_CODE_OAUTH_TOKEN: "" }, {}],
    ["a space inside", {}, { CLAUDE_CODE_OAUTH_TOKEN: "abc def" }],
    ["a stray quote", { CLAUDE_CODE_OAUTH_TOKEN: 'abc"' }, {}],
  ])("warns when malformed: %s", (_label, shell, file) => {
    const ids = oauthTokenFindings(shell, file).map((f) => f.id);
    expect(ids).toContain("oauth.malformed");
  });

  test("warns when the shell's copy shadows a different one in the file", () => {
    const findings = oauthTokenFindings(
      { CLAUDE_CODE_OAUTH_TOKEN: "tok-shell-A1" },
      { CLAUDE_CODE_OAUTH_TOKEN: "tok-file-B2" }
    );
    expect(findings.map((f) => f.id)).toEqual(["oauth.shadowed"]);
    expect(findings[0].title).not.toContain("tok-");
  });

  test("the same token in both places passes", () => {
    const findings = oauthTokenFindings(
      { CLAUDE_CODE_OAUTH_TOKEN: "same" },
      { CLAUDE_CODE_OAUTH_TOKEN: "same" }
    );
    expect(findings.map((f) => f.severity)).toEqual(["ok"]);
  });
});

describe("pending migrations", () => {
  test("each warns, with the command that runs it", () => {
    const [finding] = migrationFindings([
      { id: "v9-x", description: "Move the thing", detail: "2 files" },
    ]);

    expect(finding.severity).toBe("warn");
    expect(finding.title).toContain("Move the thing (2 files)");
    expect(finding.fix?.command).toBe("pal cli migrate");
  });
});

describe("a waiting update", () => {
  const cache = (available: boolean) => ({
    checkedAt: "2026-10-04T00:00:00Z",
    available,
    current: "1.0.0",
    latest: "1.0.1",
    mode: "package" as const,
  });

  test("warns with both versions and the update command", () => {
    const finding = updateFinding(cache(true));

    expect(finding.severity).toBe("warn");
    expect(finding.title).toContain("1.0.1");
    expect(finding.title).toContain("1.0.0");
    expect(finding.fix?.command).toBe("pal cli update");
  });

  test("none waiting passes", () => {
    expect(updateFinding(cache(false)).severity).toBe("ok");
    expect(updateFinding(null).severity).toBe("ok");
  });
});

describe("variables that only PAL's own subprocesses should carry", () => {
  test("a leak into the shell fails, with the command that clears it", () => {
    const findings = leakedEnvFindings({ PAL_INFERENCE_DEPTH: "2" }, "linux");

    const depth = findings.find((f) => f.id === "env.PAL_INFERENCE_DEPTH");
    expect(depth?.severity).toBe("fail");
    expect(depth?.fix?.command).toBe("unset PAL_INFERENCE_DEPTH");
  });

  test("on Windows the command is PowerShell's", () => {
    const [finding] = leakedEnvFindings({ PAL_SPAWNED_INFERENCE: "1" }, "win32").filter(
      (f) => f.severity === "fail"
    );

    expect(finding.fix?.command).toBe("Remove-Item Env:PAL_SPAWNED_INFERENCE");
  });

  test("a clean shell passes", () => {
    expect(leakedEnvFindings({}, "linux").every((f) => f.severity === "ok")).toBe(true);
  });
});

describe("API keys", () => {
  test("an unset key is optional and says what it unlocks", () => {
    const gemini = apiKeyFindings({}).find((f) => f.id === "key.PAL_GEMINI_API_KEY");

    expect(gemini?.severity).toBe("optional");
    expect(gemini?.title).toContain("YouTube");
  });

  test("a set key passes", () => {
    const gemini = apiKeyFindings({ PAL_GEMINI_API_KEY: "x" }).find(
      (f) => f.id === "key.PAL_GEMINI_API_KEY"
    );

    expect(gemini?.severity).toBe("ok");
  });
});

describe("inference route", () => {
  test("names the model background inference will use", () => {
    const finding = routeFinding({
      agent: "codex",
      route: "codex-spawn",
      reason: "codex binary on PATH",
      model: "gpt-6-luna",
    });

    expect(finding?.title).toBe(
      "Inference: codex-spawn on gpt-6-luna (codex binary on PATH)"
    );
  });

  test("an API route names its model too", () => {
    const finding = routeFinding({
      agent: "claude",
      route: "anthropic-api",
      reason: "fallback",
      model: "haiku",
    });

    expect(finding?.title).toContain("anthropic-api on haiku");
  });
});

describe("cursor plan", () => {
  const about = (model: string, tier: string) =>
    `About Cursor CLI\n\nCLI Version         1.0\nModel               ${model}\nSubscription Tier   ${tier}\nOS                  linux (x64)\n`;

  test("a free plan with a named model warns and says to switch to Auto", () => {
    const finding = cursorPlanFinding(about("GPT-5.6 Luna 272K Low", "Free"));

    expect(finding?.severity).toBe("warn");
    expect(finding?.title).toContain("GPT-5.6 Luna 272K Low");
    expect(finding?.fix?.say).toContain("Auto");
  });

  test("a free plan on Auto passes", () => {
    expect(cursorPlanFinding(about("Auto", "Free"))?.severity).toBe("ok");
  });

  test("a paid plan with a named model passes", () => {
    expect(cursorPlanFinding(about("GPT-5.6 Luna 272K Low", "Pro"))?.severity).toBe("ok");
  });

  test("unreadable output gives no finding", () => {
    expect(cursorPlanFinding("")).toBeNull();
  });
});

describe("~/.pal/.env", () => {
  const expiredLogin = {
    source: "inference",
    count: 2,
    last: "Failed to authenticate: OAuth session expired and could not be refreshed",
    lastAt: Date.now(),
  };
  let home: string;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {
      PAL_HOME: process.env.PAL_HOME,
      TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    };
    home = mkdtempSync(resolve(tmpdir(), "pal-doctor-env-"));
    process.env.PAL_HOME = home;
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  });

  afterEach(() => {
    if (saved.PAL_HOME === undefined) delete process.env.PAL_HOME;
    else process.env.PAL_HOME = saved.PAL_HOME;
    if (saved.TOKEN !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = saved.TOKEN;
    rmSync(home, { recursive: true, force: true });
  });

  test("a rejected token is renewed in ~/.pal/.env", () => {
    const [finding] = hookErrorFindings([
      { ...expiredLogin, lastMessage: "caller=rating auth=token exited=1" },
    ]);
    expect(finding.fix?.say).toContain(palEnvPath());
  });

  test("a token in ~/.pal/.env is read by default", () => {
    writeFileSync(palEnvPath(), "CLAUDE_CODE_OAUTH_TOKEN=from-pal-env\n");
    expect(oauthTokenFindings({}).map((f) => f.id)).toEqual(["oauth"]);
  });

  test("an inference key in ~/.pal/.env passes, and a missing one points there", () => {
    writeFileSync(palEnvPath(), "PAL_ANTHROPIC_API_KEY=from-pal-env\n");
    const findings = apiKeyFindings({});
    const byId = (id: string) => findings.find((f) => f.id === id);

    expect(byId("key.PAL_ANTHROPIC_API_KEY")?.severity).toBe("ok");
    expect(byId("key.PAL_OPENAI_API_KEY")?.fix?.say).toContain(palEnvPath());
  });

  test("a shipped skill's key in ~/.pal/.env passes, and a missing one points there", () => {
    writeFileSync(palEnvPath(), "PAL_GEMINI_API_KEY=from-pal-env\n");
    const findings = apiKeyFindings({});
    const byId = (id: string) => findings.find((f) => f.id === id);

    expect(byId("key.PAL_GEMINI_API_KEY")?.severity).toBe("ok");
    expect(byId("key.PAL_XAI_API_KEY")?.fix?.say).toContain(palEnvPath());
  });
});
