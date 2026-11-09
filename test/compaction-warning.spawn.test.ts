import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { eventsSince } from "../src/hooks/lib/events";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

const REPO_ROOT = resolve(import.meta.dir, "..");
const HOOK = resolve(REPO_ROOT, "src/hooks/UserPromptOrchestrator.ts");
const TAIL =
  'Before the next long step, record where the work stands: pal cli progress stopped "<where it stands, what comes next>".';
let home: string;
let since: Date;
let session: string;
let counter = 0;

beforeEach(() => {
  home = freshTestDir(import.meta.file);
  mkdirSync(resolve(home, "memory"), { recursive: true });
  mkdirSync(resolve(home, "claude-dir"), { recursive: true });
  writeFileSync(resolve(home, "memory", "pal-settings.json"), "{}");
  since = new Date(Date.now() - 1000);
  session = `warn-${Date.now()}-${counter++}`;
});

function transcriptWith(tokens: number): string {
  const path = resolve(home, "t.jsonl");
  const usage = { input_tokens: 10, cache_read_input_tokens: tokens - 10 };
  writeFileSync(path, `${JSON.stringify({ message: { usage } })}\n`);
  return path;
}

function submit(tokens: number, prompt = "please continue with the work") {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PAL_HOME: home,
    PAL_CLAUDE_DIR: resolve(home, "claude-dir"),
    PAL_AGENT: "claude",
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "500000",
  };
  delete env.PAL_SPAWNED_INFERENCE;
  const result = spawnSync("bun", ["run", HOOK], {
    cwd: REPO_ROOT,
    env: env as NodeJS.ProcessEnv,
    input: JSON.stringify({
      session_id: session,
      prompt,
      transcript_path: transcriptWith(tokens),
      cwd: REPO_ROOT,
    }),
    encoding: "utf-8",
    timeout: SPAWN_HEAVY_TEST_MS - 2000,
  });
  return result.stdout ?? "";
}

const events = () =>
  eventsSince("compaction_near", since).filter((e) => e.session === session);
const warningLines = (out: string) =>
  out.split("\n").filter((l) => l.includes("auto-compaction"));

describe("compaction warning in the prompt context", () => {
  beforeEach(() => {
    process.env.PAL_HOME = home;
  });

  test("a predicted prompt gets the exact line and a live event", () => {
    const out = submit(400_000);
    expect(warningLines(out)).toEqual([
      `Context: 400k tokens, auto-compaction at 467k (67k left). ${TAIL}`,
    ]);
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      trigger: "threshold",
      mode: "live",
      predicted: true,
    });
  });

  test("the warning line goes last", () => {
    const lines = submit(400_000)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("</system-reminder"));
    expect(lines.at(-1)).toStartWith("Context: 400k tokens");
  });

  test("a prompt under the margin gets no line and a shadow event", () => {
    const out = submit(300_000);
    expect(out).not.toContain("auto-compaction");
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ mode: "shadow", predicted: false });
  });

  test("the line repeats on every predicted prompt", () => {
    const first = submit(400_000);
    const second = submit(420_000);
    expect(warningLines(first)).toHaveLength(1);
    expect(warningLines(second)).toEqual([
      `Context: 420k tokens, auto-compaction at 467k (47k left). ${TAIL}`,
    ]);
    expect(events().map((e) => e.mode)).toEqual(["live", "live"]);
  });

  test("thousands are rounded to the nearest whole k", () => {
    const out = submit(400_500);
    expect(warningLines(out)[0]).toStartWith(
      "Context: 401k tokens, auto-compaction at 467k (67k left)."
    );
  });

  test("past the compaction point the line shows 0k left", () => {
    const out = submit(480_000);
    expect(warningLines(out)[0]).toStartWith(
      "Context: 480k tokens, auto-compaction at 467k (0k left)."
    );
    expect(events()[0]).toMatchObject({ mode: "live", predicted: true });
  });

  test("an empty prompt injects nothing and keeps the event shadow", () => {
    const out = submit(400_000, "");
    expect(out).not.toContain("auto-compaction");
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ mode: "shadow", predicted: true });
  });
});

describe("other callers of getPromptContext", () => {
  test("a call without the orchestrator (opencode) carries no warning", async () => {
    process.env.PAL_HOME = home;
    process.env.PAL_AGENT = "claude";
    process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = "500000";
    const { getPromptContext } = await import("../src/hooks/handlers/inject-retrieval");
    const ctx = await getPromptContext("anything goes here", session);
    delete process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW;
    expect(ctx ?? "").not.toContain("auto-compaction");
  });
});
