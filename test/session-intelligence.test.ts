import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { captureSessionIntelligence } from "../src/hooks/handlers/session-intelligence";
import {
  isRecaptureWorthwhile,
  markCaptured,
  readCapture,
} from "../src/hooks/lib/capture-store";

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
