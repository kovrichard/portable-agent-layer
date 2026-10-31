import { beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  captureSessionIntelligence,
  openingAndClosing,
} from "../src/hooks/handlers/session-intelligence";
import {
  claimHandoffSummary,
  isRecaptureWorthwhile,
  markCaptured,
  readCapture,
} from "../src/hooks/lib/capture-store";
import { readTree, scopeOf } from "../src/hooks/lib/progress-tree";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { readProjectHistory } from "../src/hooks/lib/work-tracking";
import { claudeReplying, prependPath, writeFakeBin } from "./fixtures/fake-bin";
import { removeOnceReleased } from "./lib/remove-once-released";
import { SPAWN_HEAVY_TEST_MS } from "./lib/spawn-heavy";
import { freshTestDir } from "./lib/test-home";

setDefaultTimeout(SPAWN_HEAVY_TEST_MS);

// Every case here fails a guard that returns before canInfer(), so no inference
// is ever reached. That is the point: the gating is what decides whether a
// session costs a model call at all, and it used to be unreachable from a test.

let HOME: string;
const ORIGINAL_PATH = process.env.PATH;

beforeEach(() => {
  process.env.PATH = ORIGINAL_PATH;
  process.env.PAL_INFERENCE_DISABLED = "1";
  HOME = freshTestDir(import.meta.file);
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
  // Backstop: if a guard failed to fire, this stops the handler reaching a real
  // model rather than letting the test quietly make a network call.
  delete process.env.PAL_ANTHROPIC_API_KEY;
  process.env.PAL_AGENT = "codex";
});

function transcript(messageCount: number, padding: number): string {
  const messages = Array.from({ length: messageCount }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i} ${"x".repeat(padding)}`,
  }));
  return JSON.stringify(messages);
}

function sessionNodes(session: string) {
  return [...readTree(scopeOf(process.cwd()), undefined, session).nodes.values()];
}

/** Learning files, wherever under the month directories they landed. */
function learningFiles(): string[] {
  const dir = resolve(HOME, "memory", "learning", "session");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".md"));
}

describe("what is not worth a model call", () => {
  test("a session of five messages writes nothing", async () => {
    await captureSessionIntelligence(transcript(5, 500));
    expect(learningFiles()).toEqual([]);
  });

  test("a transcript under 2000 characters writes nothing, however many turns", async () => {
    const short = transcript(20, 0);
    expect(short.length).toBeLessThan(2000);
    await captureSessionIntelligence(short);
    expect(learningFiles()).toEqual([]);
  });

  test("an unparseable transcript writes nothing rather than throwing", async () => {
    await captureSessionIntelligence("{not json");
    expect(learningFiles()).toEqual([]);
  });

  test("an empty transcript writes nothing", async () => {
    await captureSessionIntelligence("");
    expect(learningFiles()).toEqual([]);
  });
});

describe("the reply the model reads", () => {
  test("keeps a long reply's closing question to the user", () => {
    const reply = `Verdict first. ${"detail ".repeat(200)}Push it now, or keep going?`;
    const window = openingAndClosing(reply, 300);
    expect(window.startsWith("Verdict first.")).toBe(true);
    expect(window.endsWith("Push it now, or keep going?")).toBe(true);
    expect(window.length).toBeLessThan(620);
  });

  test("leaves a short reply whole", () => {
    expect(openingAndClosing("Done. Anything else?", 300)).toBe("Done. Anything else?");
  });
});

describe("a session already captured", () => {
  test("is not captured again when it has barely grown", async () => {
    markCaptured("s1", 20);
    await captureSessionIntelligence(transcript(24, 500), "s1");
    expect(learningFiles()).toEqual([]);
  });

  test("a session that has grown enough is no longer stopped here", async () => {
    markCaptured("s1", 20);
    // Asserting on the decision, not on what follows it: past this guard the
    // handler reaches the inference gate, whose answer depends on the machine.
    expect(isRecaptureWorthwhile(readCapture("s1"), 40)).toBe(true);
  });
});

describe("an unfinished session", () => {
  let binDir: string;

  beforeEach(() => {
    binDir = freshTestDir(import.meta.file);
    delete process.env.PAL_INFERENCE_DISABLED;
    delete process.env[SPAWN_GUARD_ENV.SENTINEL];
    delete process.env[SPAWN_GUARD_ENV.DEPTH];
    process.env.PAL_AGENT = "claude";
    const reply = {
      title: "Handoff wiring",
      summary: "We traced the handoff.",
      insights: "",
      status: "in-progress",
      done: "Traced where the handoff is written.",
      next: "Write the next step into the progress tree, then run the gates.",
      waitingOn: "",
    };
    writeFakeBin(binDir, "claude", claudeReplying(JSON.stringify(JSON.stringify(reply))));
    prependPath(binDir);
  });

  test("leaves the model's next step on the session's node for the next session", async () => {
    await captureSessionIntelligence(transcript(12, 300), "s-open");

    expect(sessionNodes("s-open")).toMatchObject([
      {
        title: "Handoff wiring",
        status: "active",
        stoppedAt:
          "Next: Write the next step into the progress tree, then run the gates.",
      },
    ]);
    expect(existsSync(resolve(HOME, "memory", "state", "last-handoff.json"))).toBe(false);
  });

  test("records project history but writes no session-learning file", async () => {
    await captureSessionIntelligence(transcript(12, 300), "s-history");

    expect(readProjectHistory(process.cwd()).map((e) => e.session)).toContain(
      "s-history"
    );
    expect(learningFiles()).toEqual([]);
  });

  test("files the session under the folder it started in, not the one it ended in", async () => {
    const startDir = freshTestDir(import.meta.file);
    const savedStart = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = startDir;
    try {
      await captureSessionIntelligence(transcript(12, 300), "s-moved");

      expect(readProjectHistory(startDir).map((e) => [e.title, e.session])).toEqual([
        ["Handoff wiring", "s-moved"],
      ]);
    } finally {
      if (savedStart === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedStart;
      removeOnceReleased(startDir);
    }
  });

  test("records no history when the model gave no summary", async () => {
    writeFakeBin(binDir, "claude", "process.exit(1);\n");

    await captureSessionIntelligence(transcript(12, 300), "s-no-model");

    expect(readProjectHistory(process.cwd())).toEqual([]);
  });

  test("summarises the handoff again after a new message, before the history is due", async () => {
    markCaptured("s-turn", 20);
    claimHandoffSummary("s-turn", 10);

    await captureSessionIntelligence(transcript(22, 300), "s-turn");

    expect(sessionNodes("s-turn").map((n) => n.title)).toEqual(["Handoff wiring"]);
    expect(learningFiles()).toEqual([]);
    expect(readProjectHistory(process.cwd())).toEqual([]);
  });

  test("does not summarise the same turn twice", async () => {
    markCaptured("s-twice", 20);
    claimHandoffSummary("s-twice", 11);

    await captureSessionIntelligence(transcript(22, 300), "s-twice");

    expect(sessionNodes("s-twice")).toEqual([]);
  });
});
