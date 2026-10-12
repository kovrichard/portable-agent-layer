import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { agentDirOverrides } from "../src/hooks/lib/paths";
import { reload } from "../src/hooks/lib/settings";
import { collectEvents } from "../src/tools/lib/collectors";
import {
  claudeBilling,
  codexBilling,
  opencodeBilling,
} from "../src/tools/lib/collectors/billing";
import { freshTestDir } from "./lib/test-home";

// Field names from each agent's own files: ~/.claude.json's oauthAccount,
// Codex's auth.json auth_mode, opencode's auth.json (Oauth / Api / WellKnown in
// its src/auth/index.ts). Every credential slot holds a sentinel.

const SECRET = "SENTINEL-CREDENTIAL-7731";
const LONG_AGO = new Date("2026-10-12T10:00:00.000Z");

let home: string;

function writeJson(path: string, value: unknown): string {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
  return path;
}

function claudeConfig(oauthAccount: Record<string, unknown> | null, extra = {}) {
  return writeJson(resolve(home, "claude.json"), {
    ...(oauthAccount && { oauthAccount }),
    ...extra,
  });
}

const MAX_5X = {
  accountUuid: SECRET,
  emailAddress: SECRET,
  billingType: "stripe_subscription",
  organizationType: "claude_max",
  organizationRateLimitTier: "default_claude_max_5x",
  hasExtraUsageEnabled: true,
  subscriptionCreatedAt: "2026-06-03T15:59:02.326506Z",
};

function everythingWritten(): string {
  const dirs = ["memory/events", "memory/content", "memory/state"].map((d) =>
    resolve(home, d)
  );
  return dirs
    .filter(existsSync)
    .flatMap((dir) => readdirSync(dir).map((f) => resolve(dir, f)))
    .map((f) => readFileSync(f, "utf-8"))
    .join("\n");
}

function modelCalls(): Record<string, unknown>[] {
  const dir = resolve(home, "memory", "events");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((f) => readFileSync(resolve(dir, f), "utf-8").trim().split("\n"))
    .map((l) => JSON.parse(l))
    .filter((e) => e.type === "model_call");
}

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  process.env.PAL_HOME = home;
  for (const { env } of agentDirOverrides()) process.env[env] = resolve(home, env);
  process.env.XDG_DATA_HOME = resolve(home, "data");
  mkdirSync(resolve(home, "memory", "state"), { recursive: true });
  reload();
});

describe("Claude Code's billing, from ~/.claude.json", () => {
  test("a subscription names its plan tier and whether extra usage is on", () => {
    const billingAt = claudeBilling(claudeConfig(MAX_5X));
    expect(billingAt("2026-10-12T10:00:00Z")).toEqual({
      billing: "subscription",
      plan: "default_claude_max_5x",
      extraUsage: true,
    });
  });

  test("a call from before the subscription began is unknown, not the plan of today", () => {
    const billingAt = claudeBilling(claudeConfig(MAX_5X));
    expect(billingAt("2026-05-01T10:00:00Z").billing).toBe("unknown");
  });

  test("an API key login is api billing", () => {
    const billingAt = claudeBilling(claudeConfig(null, { primaryApiKey: SECRET }));
    expect(billingAt("2026-10-12T10:00:00Z")).toEqual({
      billing: "api",
      plan: null,
      extraUsage: null,
    });
  });

  test("no file, or nothing that says, is unknown", () => {
    expect(
      claudeBilling(resolve(home, "missing.json"))("2026-10-12T10:00:00Z").billing
    ).toBe("unknown");
    expect(claudeBilling(claudeConfig(null))("2026-10-12T10:00:00Z").billing).toBe(
      "unknown"
    );
  });
});

describe("Codex's billing, from auth.json's auth_mode alone", () => {
  const auth = (fields: Record<string, unknown>) =>
    writeJson(resolve(home, "codex", "auth.json"), fields);

  test("an API key is api billing", () => {
    expect(
      codexBilling(auth({ auth_mode: "apikey", OPENAI_API_KEY: SECRET })).billing
    ).toBe("api");
  });

  test("a ChatGPT login is a subscription", () => {
    const path = auth({ auth_mode: "chatgpt", tokens: { id_token: SECRET } });
    expect(codexBilling(path).billing).toBe("subscription");
  });

  test("anything else is unknown", () => {
    expect(codexBilling(auth({})).billing).toBe("unknown");
    expect(codexBilling(resolve(home, "none.json")).billing).toBe("unknown");
  });
});

describe("opencode's billing, per provider, from auth.json's type", () => {
  const authPath = () =>
    writeJson(resolve(home, "opencode", "auth.json"), {
      anthropic: { type: "oauth", refresh: SECRET, access: SECRET, expires: 1 },
      openai: { type: "api", key: SECRET },
    });

  test("an OAuth login is a subscription, an API key is api billing", () => {
    const billingOf = opencodeBilling(authPath());
    expect(billingOf("anthropic").billing).toBe("subscription");
    expect(billingOf("openai").billing).toBe("api");
  });

  test("a provider with no login, or no provider, is unknown", () => {
    const billingOf = opencodeBilling(authPath());
    expect(billingOf("google").billing).toBe("unknown");
    expect(billingOf(undefined).billing).toBe("unknown");
  });
});

describe("billing lands on every collected model call", () => {
  function claudeTranscript(): void {
    const projects = resolve(home, "PAL_CLAUDE_DIR", "projects");
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-10-12T10:00:00.000Z",
      sessionId: "ses-1",
      cwd: home,
      message: {
        id: "m1",
        model: "claude-opus-5-5",
        usage: { input_tokens: 4, output_tokens: 2 },
      },
    });
    const transcript = resolve(projects, "-p", "s.jsonl");
    writeJson(transcript, {});
    writeFileSync(transcript, `${line}\n`);
    utimesSync(transcript, LONG_AGO, LONG_AGO);
  }

  function codexRollout(): void {
    const codexDir = resolve(home, "PAL_CODEX_DIR");
    const rollout = resolve(
      codexDir,
      "sessions",
      "2026",
      "10",
      "12",
      "rollout-thr_1.jsonl"
    );
    const lines = [
      {
        type: "session_meta",
        payload: { session_id: "thr_1", cwd: home, model_provider: "openai" },
      },
      { type: "turn_context", payload: { model: "gpt-6-codex" } },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { total_tokens: 10 },
            last_token_usage: { input_tokens: 8, output_tokens: 2, total_tokens: 10 },
          },
        },
      },
    ].map((line) => JSON.stringify({ timestamp: "2026-10-12T10:00:00.000Z", ...line }));
    writeJson(rollout, {});
    writeFileSync(rollout, `${lines.join("\n")}\n`);
  }

  function opencodeMessage(): void {
    const opencodeDir = resolve(home, "data", "opencode");
    mkdirSync(opencodeDir, { recursive: true });
    const db = new Database(resolve(opencodeDir, "opencode.db"), { create: true });
    db.run(
      "CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT)"
    );
    const created = LONG_AGO.getTime();
    const message = {
      role: "assistant",
      modelID: "gpt-6",
      providerID: "openai",
      path: { cwd: home },
      time: { created, completed: created + 1000 },
      tokens: { input: 8, output: 2 },
    };
    db.run("INSERT INTO message VALUES ('msg_1', 'ses_1', ?1, ?1, ?2)", [
      created,
      JSON.stringify(message),
    ]);
    db.close();
  }

  test("a Claude Code call carries the subscription it was billed under", () => {
    writeJson(resolve(home, ".claude.json"), { oauthAccount: MAX_5X });
    claudeTranscript();
    collectEvents();
    expect(modelCalls()).toEqual([
      expect.objectContaining({
        billing: "subscription",
        plan: "default_claude_max_5x",
        extraUsage: true,
      }),
    ]);
  });

  test("no credential value ever leaves the files it sits in", () => {
    writeJson(resolve(home, ".claude.json"), {
      oauthAccount: { ...MAX_5X, accessToken: SECRET },
      primaryApiKey: SECRET,
    });
    claudeTranscript();
    codexRollout();
    writeJson(resolve(home, "PAL_CODEX_DIR", "auth.json"), {
      auth_mode: "chatgpt",
      OPENAI_API_KEY: SECRET,
      tokens: { id_token: SECRET, access_token: SECRET, refresh_token: SECRET },
    });
    opencodeMessage();
    writeJson(resolve(home, "data", "opencode", "auth.json"), {
      openai: { type: "api", key: SECRET },
      anthropic: { type: "oauth", refresh: SECRET, access: SECRET, expires: 1 },
    });
    collectEvents();
    expect(modelCalls().map((e) => [e.runtime, e.billing])).toEqual([
      ["claude", "subscription"],
      ["opencode", "api"],
      ["codex", "subscription"],
    ]);
    expect(everythingWritten()).not.toContain(SECRET);
  });
});
