import { beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inferenceViaClaudeSpawn } from "../src/inference/inference-agents";
import { inferenceViaCliSpawn } from "../src/inference/inference-spawn";
import {
  CLAUDE_LOGIN_REJECTED,
  loginRejectedFile,
  noteClaudeLogin,
} from "../src/inference/login-rejected";
import { debugHome, type FakeRun, withFakeSpawn } from "./lib/fake-spawn";
import { restoreEnv, savedEnv } from "./lib/inference-dispatch-fixture";
import { removeOnceReleased } from "./lib/remove-once-released";

const BASELINE = savedEnv();
let home = { home: "", log: () => "" };

beforeEach(() => {
  restoreEnv(BASELINE);
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  home = debugHome(import.meta.file);
});

const claudeOut = (fields: Record<string, unknown>) =>
  JSON.stringify({ type: "result", ...fields });
const REJECTED: FakeRun = {
  code: 1,
  stdout: claudeOut({
    result: 'Failed to authenticate. API Error: 401 {"type":"error"}',
    is_error: true,
  }),
};
const ANSWERED: FakeRun = { stdout: claudeOut({ result: "hi" }) };

async function claude(run: FakeRun, token?: string) {
  if (token) process.env.CLAUDE_CODE_OAUTH_TOKEN = token;

  try {
    return (
      await withFakeSpawn([run], () => inferenceViaClaudeSpawn("claude", { user: "q" }))
    ).value;
  } finally {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }
}

function recorded(): { at: string; auth: string } {
  return JSON.parse(readFileSync(loginRejectedFile(), "utf-8"));
}

function alreadyRejected(): void {
  writeFileSync(loginRejectedFile(), '{"at":"then","auth":"token"}\n', "utf-8");
}

describe("a rejected Claude login", () => {
  test("is recorded with the token mode the call ran in, and the time", async () => {
    const before = Date.now();
    await claude(REJECTED, "sk-ant-oat01-fake");
    const record = recorded();

    expect(loginRejectedFile()).toBe(resolve(home.home, "cache", "login-rejected.json"));
    expect(record.auth).toBe("token");
    expect(Date.parse(record.at)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(record.at)).toBeLessThanOrEqual(Date.now());
  });

  test("is recorded as native without a token", async () => {
    await claude(REJECTED);

    expect(recorded().auth).toBe("native");
  });

  test("is written as one JSON line with the given time", () => {
    noteClaudeLogin("native", REJECTED as { code: number; stdout: string }, new Date(0));

    expect(readFileSync(loginRejectedFile(), "utf-8")).toBe(
      '{"at":"1970-01-01T00:00:00.000Z","auth":"native"}\n'
    );
  });

  test("matches what Claude prints, and only that", () => {
    expect(CLAUDE_LOGIN_REJECTED.test("Failed to authenticate. API Error: 401")).toBe(
      true
    );
    expect(CLAUDE_LOGIN_REJECTED.test("Rate limited")).toBe(false);
  });
});

describe("what is not a rejected Claude login", () => {
  test("another agent failing with the same text writes nothing", async () => {
    await withFakeSpawn([REJECTED], () =>
      inferenceViaCliSpawn("/usr/bin/codex", ["exec"], "q", { user: "q" })
    );

    expect(existsSync(loginRejectedFile())).toBe(false);
  });

  test("a Claude failure with other text writes nothing", async () => {
    await claude({
      code: 1,
      stdout: claudeOut({ result: "Overloaded", is_error: true }),
    });

    expect(existsSync(loginRejectedFile())).toBe(false);
  });
});

describe("a Claude call that succeeds", () => {
  test("deletes the record of a rejected login", async () => {
    alreadyRejected();
    await claude(ANSWERED);

    expect(existsSync(loginRejectedFile())).toBe(false);
  });

  test("does nothing when there is no record", async () => {
    await claude(ANSWERED);

    expect(existsSync(loginRejectedFile())).toBe(false);
    expect(home.log()).not.toContain("inference:login-rejected");
  });

  test("leaves the record alone for another agent", async () => {
    alreadyRejected();
    await withFakeSpawn([ANSWERED], () =>
      inferenceViaCliSpawn("/usr/bin/codex", ["exec"], "q", { user: "q" })
    );

    expect(recorded().auth).toBe("token");
  });
});

describe("a record that cannot be written or deleted", () => {
  function blockTheRecord(): void {
    removeOnceReleased(loginRejectedFile());
    mkdirSync(loginRejectedFile(), { recursive: true });
  }

  test("a failed write is logged and the result is the same as without it", async () => {
    const unblocked = await claude(REJECTED);
    blockTheRecord();
    const blocked = await claude(REJECTED);

    expect(blocked).toEqual(unblocked);
    expect(blocked.success).toBe(false);
    expect(home.log()).toContain("inference:login-rejected");
  });

  test("a failed delete is logged and the result is the same as without it", async () => {
    const unblocked = await claude(ANSWERED);
    blockTheRecord();
    const blocked = await claude(ANSWERED);

    expect(blocked).toEqual(unblocked);
    expect(blocked.output).toBe("hi");
    expect(home.log()).toContain("inference:login-rejected");
  });
});
