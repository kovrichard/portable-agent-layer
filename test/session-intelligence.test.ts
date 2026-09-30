import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  captureSessionIntelligence,
  openingAndClosing,
} from "../src/hooks/handlers/session-intelligence";
import {
  isRecaptureWorthwhile,
  markCaptured,
  readCapture,
} from "../src/hooks/lib/capture-store";
import { SPAWN_GUARD_ENV } from "../src/hooks/lib/spawn-guard";
import { readProjectHistory } from "../src/hooks/lib/work-tracking";
import { prependPath, writeFakeBin } from "./fixtures/fake-bin";

// Every case here fails a guard that returns before canInfer(), so no inference
// is ever reached. That is the point: the gating is what decides whether a
// session costs a model call at all, and it used to be unreachable from a test.

let HOME: string;
let API_KEY: string | undefined;

beforeEach(() => {
  HOME = mkdtempSync(resolve(tmpdir(), "pal-si-"));
  process.env.PAL_HOME = HOME;
  mkdirSync(resolve(HOME, "memory", "state"), { recursive: true });
  // Backstop: if a guard failed to fire, this stops the handler reaching a real
  // model rather than letting the test quietly make a network call.
  API_KEY = process.env.PAL_ANTHROPIC_API_KEY;
  delete process.env.PAL_ANTHROPIC_API_KEY;
  process.env.PAL_AGENT = "codex";
});

afterEach(() => {
  delete process.env.PAL_HOME;
  delete process.env.PAL_AGENT;
  if (API_KEY !== undefined) process.env.PAL_ANTHROPIC_API_KEY = API_KEY;
  rmSync(HOME, { recursive: true, force: true });
});

function transcript(messageCount: number, padding: number): string {
  const messages = Array.from({ length: messageCount }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i} ${"x".repeat(padding)}`,
  }));
  return JSON.stringify(messages);
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
    markCaptured("s1", "/learning/a.md", 20);
    await captureSessionIntelligence(transcript(24, 500), "s1");
    expect(learningFiles()).toEqual([]);
  });

  test("a session that has grown enough is no longer stopped here", async () => {
    markCaptured("s1", "/learning/a.md", 20);
    // Asserting on the decision, not on what follows it: past this guard the
    // handler reaches the inference gate, whose answer depends on the machine.
    expect(isRecaptureWorthwhile(readCapture("s1"), 40)).toBe(true);
  });
});

describe("an unfinished session", () => {
  let binDir: string;
  let savedPath: string | undefined;

  beforeEach(() => {
    binDir = mkdtempSync(resolve(tmpdir(), "pal-si-bin-"));
    savedPath = process.env.PATH;
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
      next: "Wire the model handoff into last-handoff.json, then run the gates.",
      waitingOn: "",
    };
    writeFakeBin(
      binDir,
      "claude",
      `console.log(${JSON.stringify(JSON.stringify(reply))});\n`
    );
    prependPath(binDir);
  });

  afterEach(() => {
    process.env.PATH = savedPath;
    process.env.PAL_INFERENCE_DISABLED = "1";
    rmSync(binDir, { recursive: true, force: true });
  });

  test("leaves the model's handoff for the next session, not the raw last exchange", async () => {
    await captureSessionIntelligence(transcript(12, 300), "s-open");

    const handoffs = JSON.parse(
      readFileSync(resolve(HOME, "memory", "state", "last-handoff.json"), "utf-8")
    );
    expect(handoffs[process.cwd()]).toMatchObject({
      title: "Handoff wiring",
      status: "in-progress",
      handoff:
        "Done: Traced where the handoff is written.\n" +
        "Next: Wire the model handoff into last-handoff.json, then run the gates.",
      source: "auto",
      sessionId: "s-open",
    });
  });

  test("files the session under the folder it started in, not the one it ended in", async () => {
    const startDir = mkdtempSync(resolve(tmpdir(), "pal-si-start-"));
    const savedStart = process.env.CLAUDE_PROJECT_DIR;
    process.env.CLAUDE_PROJECT_DIR = startDir;
    try {
      await captureSessionIntelligence(transcript(12, 300), "s-moved");

      expect(readProjectHistory(startDir).map((e) => e.title)).toEqual([
        "Handoff wiring",
      ]);
    } finally {
      if (savedStart === undefined) delete process.env.CLAUDE_PROJECT_DIR;
      else process.env.CLAUDE_PROJECT_DIR = savedStart;
      rmSync(startDir, { recursive: true, force: true });
    }
  });
});
